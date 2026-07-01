import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createNeo4jClient } from '../client';
import { Neo4jQueryError, Neo4jAuthError } from '../errors';

const mockFetch = vi.fn();

function makeClient(layers?: Record<string, string>, entityTypes?: string[]) {
  return createNeo4jClient({
    uri: 'https://test.databases.neo4j.io',
    username: 'testuser',
    password: 'testpass',
    database: 'neo4j',
    layers,
    entityTypes,
    fetch: mockFetch as unknown as typeof globalThis.fetch,
  });
}

function mockQueryResponse(fields: string[], values: unknown[][]) {
  return {
    ok: true,
    status: 202,
    text: async () => JSON.stringify({ data: { fields, values } }),
  };
}

describe('createNeo4jClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // Failure mode 1 (integration): query returns mapped typed JSON
  it('executes a query and maps typed JSON response', async () => {
    mockFetch.mockResolvedValue(
      mockQueryResponse(['name', 'age'], [
        [{ $type: 'String', _value: 'Alice' }, { $type: 'Integer', _value: '30' }],
        [{ $type: 'String', _value: 'Bob' }, { $type: 'Integer', _value: '25' }],
      ]),
    );

    const client = makeClient();
    const results = await client.query('MATCH (n) RETURN n.name AS name, n.age AS age');

    expect(results).toEqual([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.databases.neo4j.io/db/neo4j/query/v2');
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual(expect.objectContaining({
      'Content-Type': 'application/json',
      Accept: 'application/vnd.neo4j.query',
    }));
    expect((opts.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    // C-09: Accept header must be the correct typed JSON content type for Query API v2
  });

  // Failure mode 4: auth failure → Neo4jAuthError
  it('throws Neo4jAuthError on 401', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => JSON.stringify({ errors: [{ code: 'Neo.ClientError.Security.Unauthorized', message: 'Bad creds' }] }),
    });

    const client = makeClient();
    await expect(client.query('RETURN 1')).rejects.toThrow(Neo4jAuthError);
  });

  // Failure mode 5: query error → Neo4jQueryError
  it('throws Neo4jQueryError on syntax error', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => JSON.stringify({
        errors: [{ code: 'Neo.ClientError.Statement.SyntaxError', message: 'Invalid input' }],
      }),
    });

    const client = makeClient();
    await expect(client.query('INVALID CYPHER')).rejects.toThrow(Neo4jQueryError);
  });

  // Failure mode 2: layer scoped queries
  describe('layer queries', () => {
    it('resolves {Label} placeholders in layer queries', async () => {
      mockFetch.mockResolvedValue(mockQueryResponse(['name'], [[{ $type: 'String', _value: 'Test' }]]));

      const client = makeClient({ kennedy: 'KB_dan_kennedy_umm', shreeve: 'KB_mike_shreeve' });
      await client.layer.kennedy.query('MATCH (n:{Principle}) RETURN n.name AS name');

      const body = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
      expect(body.statement).toContain('KB_dan_kennedy_umm_Principle');
    });

    it('rejects raw entity-type labels in layer queries when entityTypes configured', async () => {
      const client = makeClient(
        { kennedy: 'KB_dan_kennedy_umm' },
        ['Principle', 'Tactic', 'Person'],
      );
      await expect(
        client.layer.kennedy.query('MATCH (n:Principle) RETURN n'),
      ).rejects.toThrow(/Raw label "Principle"/);
    });

    it('allows raw labels when entityTypes is empty (no validation)', async () => {
      mockFetch.mockResolvedValue(mockQueryResponse(['n'], [[{ $type: 'Integer', _value: '1' }]]));
      const client = makeClient({ kennedy: 'KB_dan_kennedy_umm' });
      await expect(
        client.layer.kennedy.query('MATCH (n:Principle) RETURN n'),
      ).resolves.toBeDefined();
    });
  });

  // Failure mode 3: cross-layer queries
  describe('cross-layer queries', () => {
    it('resolves placeholders for multiple layers', async () => {
      mockFetch.mockResolvedValue(mockQueryResponse(['name'], [[{ $type: 'String', _value: 'Test' }]]));

      const client = makeClient({ kennedy: 'KB_dan_kennedy_umm', shreeve: 'KB_mike_shreeve' });
      await client.cross(['kennedy', 'shreeve']).query('MATCH (p:{Person}) RETURN p.name AS name');

      const body = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
      expect(body.statement).toContain('KB_dan_kennedy_umm_Person');
      expect(body.statement).toContain('KB_mike_shreeve_Person');
      expect(body.statement).toContain(' OR ');
    });
  });

  // Bug #4: fetch timeout
  it('passes AbortSignal.timeout to fetch', async () => {
    mockFetch.mockResolvedValue(
      mockQueryResponse(['n'], [[{ $type: 'Integer', _value: '1' }]]),
    );

    const client = makeClient();
    await client.query('RETURN 1 AS n');

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.signal).toBeDefined();
  });

  // Bug #7: non-2xx non-auth response
  it('throws Neo4jQueryError on non-2xx non-auth response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => '<html>Service Unavailable</html>',
    });

    const client = makeClient();
    await expect(client.query('RETURN 1')).rejects.toThrow(Neo4jQueryError);
    await expect(client.query('RETURN 1')).rejects.toThrow(/HTTP 503/);
  });

  // Bug #11: auth error sanitization
  it('does not leak Neo4j error details in auth error message', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ errors: [{ code: 'Neo.ClientError.Security.Unauthorized', message: 'password=s3cret leaked' }] }),
    });

    const client = makeClient();
    try {
      await client.query('RETURN 1');
      expect.unreachable();
    } catch (e: any) {
      expect(e).toBeInstanceOf(Neo4jAuthError);
      expect(e.message).toBe('Neo4j authentication failed');
      expect(e.message).not.toContain('s3cret');
    }
  });

  // raw escape hatch
  describe('raw queries', () => {
    it('passes Cypher through without placeholder processing', async () => {
      mockFetch.mockResolvedValue(mockQueryResponse(['n'], [[{ $type: 'Integer', _value: '42' }]]));

      const client = makeClient({ kennedy: 'KB_dan_kennedy_umm' });
      await client.raw('MATCH (n:SomeLabel) RETURN count(n) AS n');

      const body = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
      expect(body.statement).toBe('MATCH (n:SomeLabel) RETURN count(n) AS n');
    });
  });
});
