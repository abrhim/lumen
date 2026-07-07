import { describe, it, expect, vi } from 'vitest';
import { findCrossReferences } from '../graph/find-cross-references';
import { getVerseConnections } from '../graph/get-verse-connections';
import { getPrinciple } from '../graph/get-principle';
import { getPerson } from '../graph/get-person';
import { searchByPrinciple } from '../graph/search-by-principle';
import { exploreGraph } from '../graph/explore-graph';
import type { Neo4jClient } from '@lumen/neo4j-http';

function mockNeo4j(queryFn: (...args: any[]) => any): Neo4jClient {
  return {
    query: vi.fn(),
    raw: vi.fn(),
    cross: vi.fn(),
    layer: new Proxy({} as any, {
      get() {
        return { query: queryFn };
      },
    }),
  };
}

describe('findCrossReferences', () => {
  it('returns cross references for a verse', async () => {
    const neo4j = mockNeo4j(vi.fn().mockResolvedValue([
      { verse_id: 'john-3-16', reference: 'John 3:16', text: 'For God so loved...', relationship: 'CROSS_REF', direction: 'outgoing', source: 'curated' },
    ]));

    const result = await findCrossReferences(neo4j, '1-ne-3-7');
    expect(result.verse_id).toBe('1-ne-3-7');
    expect(result.cross_reference_count).toBe(1);
    expect(result.cross_references[0].verse_id).toBe('john-3-16');
  });

  it('returns empty when no cross references exist', async () => {
    const neo4j = mockNeo4j(vi.fn().mockResolvedValue([]));
    const result = await findCrossReferences(neo4j, 'nonexistent');
    expect(result.cross_reference_count).toBe(0);
    expect(result.cross_references).toEqual([]);
  });
});

describe('exploreGraph — LM-layer isolation (graph-view plan, API-1)', () => {
  it('label-constrains the depth-1 center and connected nodes', async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const neo4j = mockNeo4j(queryFn);
    await exploreGraph(neo4j, '1-ne-3-7', 1);
    const q = queryFn.mock.calls[0][0] as string;
    expect(q).toContain(':{Verse}');
    expect(/\]\s*-\s*\(\s*\w+\s*\)/.test(q)).toBe(false);
  });

  it('constrains every hop of deep traversals, not just endpoints', async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const neo4j = mockNeo4j(queryFn);
    await exploreGraph(neo4j, '1-ne-3-7', 2);
    const q = queryFn.mock.calls[0][0] as string;
    expect(q).toMatch(/ALL\(\w+ IN nodes\(path\)/);
  });
});

describe('getVerseConnections (slimmed to entities — cross-refs moved to Postgres, API-2)', () => {
  it('returns principles and people in one shape, with NO cross_references field', async () => {
    const neo4j = mockNeo4j(vi.fn().mockResolvedValue([{
      principles: [{ id: 'obedience', name: 'Obedience' }],
      people: [{ id: 'nephi-1', name: 'Nephi' }],
    }]));

    const result = await getVerseConnections(neo4j, '1-ne-3-7');
    expect(result.verse_id).toBe('1-ne-3-7');
    expect(result.principles).toEqual([{ id: 'obedience', name: 'Obedience' }]);
    expect(result.people).toEqual([{ id: 'nephi-1', name: 'Nephi' }]);
    expect('cross_references' in result).toBe(false);
  });

  it('no longer queries CROSS_REF edges at all (one less Neo4j subquery)', async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const neo4j = mockNeo4j(queryFn);
    await getVerseConnections(neo4j, '1-ne-3-7');
    const q = queryFn.mock.calls[0][0] as string;
    expect(q).not.toContain('CROSS_REF');
    expect(q).toContain('TEACHES');
    expect(q).toContain('MENTIONS');
  });

  it('filters the null placeholder rows OPTIONAL MATCH collects on empty patterns', async () => {
    const neo4j = mockNeo4j(vi.fn().mockResolvedValue([{
      principles: [{ id: null, name: null }],
      people: [{ id: null, name: null }],
    }]));

    const result = await getVerseConnections(neo4j, '1-ne-3-1');
    expect(result.principles).toEqual([]);
    expect(result.people).toEqual([]);
  });

  it('returns an empty result (not an error) when the verse is missing from the graph', async () => {
    const neo4j = mockNeo4j(vi.fn().mockResolvedValue([]));
    const result = await getVerseConnections(neo4j, 'nonexistent');
    expect(result).toEqual({ verse_id: 'nonexistent', principles: [], people: [] });
  });
});

describe('getPrinciple', () => {
  it('returns principle with verses and related principles', async () => {
    const neo4j = mockNeo4j(vi.fn().mockResolvedValue([{
      id: 'faith',
      name: 'Faith',
      description: 'Trust in God',
      verses: [
        { verse_id: '1-ne-3-7', reference: '1 Nephi 3:7', text: 'I will go and do...' },
        { verse_id: null, reference: null, text: null },
      ],
      related_principles: [
        { id: 'hope', name: 'Hope', relationship: 'PARENT_OF' },
        { id: null, name: null, relationship: null },
      ],
    }]));

    const result = await getPrinciple(neo4j, 'faith');
    expect(result.found).toBe(true);
    expect(result.id).toBe('faith');
    expect(result.verse_count).toBe(1);
    expect(result.verses).toHaveLength(1);
    expect(result.related_principles).toHaveLength(1);
  });

  it('returns suggestions when principle not found', async () => {
    const queryFn = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'faith', name: 'Faith' }]);

    const neo4j = mockNeo4j(queryFn);
    const result = await getPrinciple(neo4j, 'fait');
    expect(result.found).toBe(false);
    expect(result.suggestions).toHaveLength(1);
  });
});

describe('getPerson', () => {
  it('returns person with verses and places', async () => {
    const neo4j = mockNeo4j(vi.fn().mockResolvedValue([{
      id: 'nephi-1',
      name: 'Nephi',
      description: 'Son of Lehi',
      properties: { era: 'pre-exilic' },
      verses: [{ verse_id: '1-ne-1-1', reference: '1 Nephi 1:1', text: 'I, Nephi...' }],
      places: [{ id: 'jerusalem', name: 'Jerusalem' }],
    }]));

    const result = await getPerson(neo4j, 'nephi-1');
    expect(result.found).toBe(true);
    expect(result.name).toBe('Nephi');
    expect(result.verse_count).toBe(1);
    expect(result.places).toHaveLength(1);
  });
});

describe('searchByPrinciple', () => {
  it('returns verses teaching a principle', async () => {
    const neo4j = mockNeo4j(vi.fn().mockResolvedValue([
      { verse_id: '1-ne-3-7', reference: '1 Nephi 3:7', text: 'I will go...', volume_id: 'bom', book_id: '1-ne' },
    ]));

    const result = await searchByPrinciple(neo4j, 'faith', undefined, 10);
    expect(result.principle_id).toBe('faith');
    expect(result.volume).toBe('all');
    expect(result.result_count).toBe(1);
  });

  it('filters by volume when specified', async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const neo4j = mockNeo4j(queryFn);
    await searchByPrinciple(neo4j, 'faith', 'bom', 5);
    const cypher = queryFn.mock.calls[0][0] as string;
    expect(cypher).toContain('v.volume_id = $volume');
  });
});

describe('exploreGraph', () => {
  it('returns depth-1 connections', async () => {
    const neo4j = mockNeo4j(vi.fn().mockResolvedValue([{
      id: 'faith',
      name: 'Faith',
      node_labels: ['LM_Principle'],
      properties: { id: 'faith', name: 'Faith' },
      connections: [
        { direction: 'outgoing', relationship: 'TEACHES', connected_id: '1-ne-3-7', connected_name: null, connected_labels: ['LM_Verse'], connected_description: '' },
        { direction: null, relationship: null, connected_id: null, connected_name: null, connected_labels: null, connected_description: null },
      ],
    }]));

    const result = await exploreGraph(neo4j, 'faith', 1);
    expect(result.found).toBe(true);
    expect(result.connection_count).toBe(1);
  });

  it('returns not found for missing entities', async () => {
    const neo4j = mockNeo4j(vi.fn().mockResolvedValue([]));
    const result = await exploreGraph(neo4j, 'nonexistent');
    expect(result.found).toBe(false);
  });

  it('uses depth parameter for multi-hop queries', async () => {
    const queryFn = vi.fn().mockResolvedValue([{
      id: 'faith',
      name: 'Faith',
      node_labels: ['LM_Principle'],
      properties: {},
      connections: [],
    }]);
    const neo4j = mockNeo4j(queryFn);

    await exploreGraph(neo4j, 'faith', 3);
    const cypher = queryFn.mock.calls[0][0] as string;
    expect(cypher).toContain('*1..3');
    expect(cypher).toContain('LIMIT 50');
  });

  it('applies relationship type filter', async () => {
    const queryFn = vi.fn().mockResolvedValue([{
      id: 'faith',
      name: 'Faith',
      node_labels: ['LM_Principle'],
      properties: {},
      connections: [],
    }]);
    const neo4j = mockNeo4j(queryFn);

    await exploreGraph(neo4j, 'faith', 1, ['TEACHES']);
    const cypher = queryFn.mock.calls[0][0] as string;
    expect(cypher).toContain('type(r) IN $relTypes');
  });
});
