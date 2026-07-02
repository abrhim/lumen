export interface Neo4jHttpConfig {
  uri: string;
  username: string;
  password: string;
  database: string;
  layers?: Record<string, string>;
  entityTypes?: string[];
  logger?: Neo4jLogger;
  /** Per-request timeout in ms. Defaults to 20_000. */
  timeoutMs?: number;
}

export interface Neo4jHttpClientConfig extends Neo4jHttpConfig {
  fetch?: typeof globalThis.fetch;
}

export interface Neo4jLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface TypedValue {
  $type: string;
  _value: unknown;
}

export interface QueryResponse {
  data?: { fields: string[]; values: unknown[][] };
  errors?: Array<{ code: string; message: string }>;
}

export interface LayerQueryable {
  query<T = Record<string, unknown>>(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<T[]>;
}

export interface Neo4jClient {
  query<T = Record<string, unknown>>(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<T[]>;
  raw<T = Record<string, unknown>>(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<T[]>;
  layer: Record<string, LayerQueryable>;
  cross(layerNames: string[]): LayerQueryable;
}
