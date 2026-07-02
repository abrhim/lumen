import { mapRow } from './mapper';
import { Neo4jQueryError, Neo4jAuthError } from './errors';
import { resolvePlaceholders, validateLayerQuery } from './layers';
import type {
  Neo4jHttpClientConfig,
  QueryResponse,
  LayerQueryable,
  Neo4jClient,
} from './types';

const LAYER_PREFIX_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

function normalizeUri(uri: string): string {
  return uri
    .replace(/^neo4j\+s:\/\//, 'https://')
    .replace(/^neo4j\+ssc:\/\//, 'https://')
    .replace(/^neo4j:\/\//, 'http://')
    .replace(/^bolt(\+s(?:sc)?)?:\/\//, 'https://')
    .replace(/\/$/, '');
}

export function createNeo4jClient(config: Neo4jHttpClientConfig): Neo4jClient {
  const fetchFn = config.fetch ?? globalThis.fetch;
  const baseUri = normalizeUri(config.uri);
  const endpoint = `${baseUri}/db/${config.database}/query/v2`;
  const authHeader =
    'Basic ' + btoa(`${config.username}:${config.password}`);
  const layers = config.layers ?? {};
  const entityTypes = config.entityTypes ?? [];
  const timeoutMs = config.timeoutMs ?? 20_000;

  for (const [name, prefix] of Object.entries(layers)) {
    if (!LAYER_PREFIX_RE.test(prefix)) {
      throw new Error(
        `Invalid layer prefix "${prefix}" for layer "${name}". Must match /^[A-Za-z][A-Za-z0-9_]*$/.`,
      );
    }
  }

  async function execute<T>(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/vnd.neo4j.query',
        Authorization: authHeader,
      },
      body: JSON.stringify({
        statement: cypher,
        parameters: params ?? {},
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await res.text();

    if (res.status === 401 || res.status === 403) {
      throw new Neo4jAuthError('Neo4j authentication failed');
    }

    if (!res.ok) {
      throw new Neo4jQueryError(
        'Neo.ClientError.Request.Invalid',
        `Neo4j returned HTTP ${res.status}`,
      );
    }

    let body: QueryResponse;
    try {
      body = JSON.parse(text) as QueryResponse;
    } catch {
      throw new Neo4jQueryError(
        'Neo.ClientError.Request.Invalid',
        'Invalid JSON response from Neo4j',
      );
    }

    if (body.errors?.length) {
      const err = body.errors[0];
      throw new Neo4jQueryError(err.code, err.message);
    }

    if (!body.data) return [];

    const { fields, values } = body.data;
    return values.map((row) => mapRow(fields, row) as T);
  }

  function makeLayerQueryable(prefix: string): LayerQueryable {
    return {
      async query<T = Record<string, unknown>>(
        cypher: string,
        params?: Record<string, unknown>,
      ): Promise<T[]> {
        validateLayerQuery(cypher, entityTypes);
        const resolved = resolvePlaceholders(cypher, prefix);
        return execute<T>(resolved, params);
      },
    };
  }

  const layerProxy = new Proxy({} as Record<string, LayerQueryable>, {
    get(_target, prop: string) {
      const prefix = layers[prop];
      if (!prefix) {
        throw new Error(`Unknown layer: "${prop}". Available: ${Object.keys(layers).join(', ')}`);
      }
      return makeLayerQueryable(prefix);
    },
  });

  return {
    query<T = Record<string, unknown>>(
      cypher: string,
      params?: Record<string, unknown>,
    ): Promise<T[]> {
      return execute<T>(cypher, params);
    },

    raw<T = Record<string, unknown>>(
      cypher: string,
      params?: Record<string, unknown>,
    ): Promise<T[]> {
      return execute<T>(cypher, params);
    },

    layer: layerProxy,

    cross(layerNames: string[]): LayerQueryable {
      const prefixes = layerNames.map((name) => {
        const prefix = layers[name];
        if (!prefix) {
          throw new Error(`Unknown layer: "${name}". Available: ${Object.keys(layers).join(', ')}`);
        }
        return prefix;
      });

      return {
        query<T = Record<string, unknown>>(
          cypher: string,
          params?: Record<string, unknown>,
        ): Promise<T[]> {
          const resolved = resolvePlaceholders(cypher, prefixes);
          return execute<T>(resolved, params);
        },
      };
    },
  };
}

