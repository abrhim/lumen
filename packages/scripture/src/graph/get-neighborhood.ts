import type { Neo4jClient } from '@lumen/neo4j-http';

/**
 * Every LM node label the graph layer may touch. The Neo4j instance is shared
 * with other knowledge bases (KB_*, DS_*) — every node group in every pattern
 * must carry one of these placeholders or traversal leaks across tenants.
 */
export const GRAPH_ENTITY_TYPES = [
  'Verse', 'Principle', 'Person', 'Place', 'Chapter', 'Book', 'Volume',
  'StrongsWord', 'JstReading', 'ChapterSummary', 'NaveTopic', 'Era', 'Event', 'Symbol',
] as const;

/** Default neighbor types for the graph view — content, not structural containment. */
export const GRAPH_NODE_TYPES = [
  'Verse', 'Principle', 'Person', 'Place', 'Symbol', 'NaveTopic', 'Era', 'Event',
] as const;

/** Semantic relationship allowlist for the graph view (structural containment excluded). */
export const GRAPH_REL_TYPES = [
  'CROSS_REF', 'TEACHES', 'MENTIONS', 'LOCATED_AT',
  'PARALLELS', 'EXTENDS', 'CONTRASTS', 'TYPIFIES', 'HAS_SYMBOL', 'SETTING_OF',
  'SUMMARIZES', 'APPEARS_IN', 'FEATURES', 'COVERS', 'PARENT_OF', 'REFERENCES', 'MAPS_TO',
] as const;

// Hard server-side ceilings — caller-supplied caps are clamped, never trusted (SEC-8).
const DEFAULT_PER_DEPTH_CAP = 75;
const DEFAULT_TOTAL_CAP = 400;
const MAX_PER_DEPTH_CAP = 150;
const MAX_TOTAL_CAP = 600;

export interface NeighborhoodNode {
  id: string;
  name: string | null;
  labels: string[];
  collection_id: string | null;
}

export interface NeighborhoodEdge {
  from: string;
  to: string;
  rel_type: string;
  collection_id: string | null;
}

export interface NeighborhoodResult {
  found: boolean;
  center: NeighborhoodNode | null;
  nodes: NeighborhoodNode[];
  edges: NeighborhoodEdge[];
  truncated: { shown: number; total: number };
}

export interface NeighborhoodOpts {
  depth: 1 | 2 | 3;
  /** Explicit collection ids (caller resolves "public" from Postgres — COR-2). Omit = no filter. */
  collections?: string[];
  relTypes?: string[];
  nodeTypes?: string[];
  perDepthCap?: number;
  totalCap?: number;
}

interface RawRow {
  center: NeighborhoodNode;
  nodes: (NeighborhoodNode | null)[];
  edges: (NeighborhoodEdge | null)[];
  total: number;
}

function clampCap(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`cap must be a positive integer, got ${String(value)}`);
  }
  return Math.min(value, max);
}

function labelUnion(types: readonly string[]): string {
  return types.map((t) => `{${t}}`).join('|');
}

const stripLayerPrefix = (label: string) => label.replace(/^LM_/, '');

function toNode(n: NeighborhoodNode): NeighborhoodNode {
  return {
    id: n.id,
    name: n.name ?? null,
    labels: (n.labels ?? []).map(stripLayerPrefix),
    collection_id: n.collection_id ?? null,
  };
}

/**
 * Bounded, collection-filterable neighborhood of any LM entity, for the graph
 * view and future collection-scoped surfaces.
 *
 * Traversal is expanded layer by layer with a Cypher-side LIMIT per layer
 * (never `[*1..N]` — variable-length paths enumerate every path before LIMIT
 * applies, which explodes on hub verses). Totals are counted per layer from
 * the already-capped previous frontier, so the counting work is bounded too.
 * Edges are collected among ALL visited nodes (sibling↔sibling included),
 * then deduped: exact duplicates and reciprocal pairs collapse to one link.
 */
export async function getNeighborhood(
  neo4j: Neo4jClient,
  entityId: string,
  opts: NeighborhoodOpts,
): Promise<NeighborhoodResult> {
  const { depth } = opts;
  if (depth !== 1 && depth !== 2 && depth !== 3) {
    throw new Error(`depth must be an integer 1–3, got ${String(depth)}`);
  }

  const relTypes = opts.relTypes ?? [...GRAPH_REL_TYPES];
  for (const t of relTypes) {
    if (!(GRAPH_REL_TYPES as readonly string[]).includes(t)) {
      throw new Error(`relType "${t}" is not in the graph allowlist`);
    }
  }
  const nodeTypes = opts.nodeTypes ?? [...GRAPH_NODE_TYPES];
  for (const t of nodeTypes) {
    if (!(GRAPH_ENTITY_TYPES as readonly string[]).includes(t)) {
      throw new Error(`nodeType "${t}" is not in the graph allowlist`);
    }
  }

  const perDepthCap = clampCap(opts.perDepthCap, DEFAULT_PER_DEPTH_CAP, MAX_PER_DEPTH_CAP);
  const totalCap = clampCap(opts.totalCap, DEFAULT_TOTAL_CAP, MAX_TOTAL_CAP);
  const collections = opts.collections ?? null;

  // Everything interpolated below is allowlist-validated or a clamped integer;
  // entityId and collections travel as bound parameters.
  const rels = relTypes.join('|');
  const centerUnion = labelUnion(GRAPH_ENTITY_TYPES);
  const nodeUnion = labelUnion(nodeTypes);
  // Fail-open on missing collection_id: pre-backfill data stays visible (FM-6).
  const filter = (rel: string, node: string) =>
    `($collections IS NULL OR ${rel}.collection_id IN $collections OR ${rel}.collection_id IS NULL)
     AND ($collections IS NULL OR ${node}.collection_id IN $collections OR ${node}.collection_id IS NULL)`;

  const layers: string[] = [];
  const layerVars: string[] = [];
  const totalVars: string[] = [];
  for (let d = 1; d <= depth; d++) {
    const lv = `l${d}`;
    const tv = `t${d}`;
    const carried = ['c', ...layerVars].join(', ');
    const source =
      d === 1
        ? 'WITH c, c AS s' // carry c too — a plain `WITH c AS s` drops it from scope
        : `UNWIND l${d - 1} AS s`;
    const exclude = ['s <> n', 'n <> c', ...layerVars.map((v) => `NOT n IN ${v}`)].join(' AND ');
    const body = `
      WITH ${carried}
      ${source}
      MATCH (s)-[r${d}:${rels}]-(n:${nodeUnion})
      WHERE ${exclude} AND ${filter(`r${d}`, 'n')}`;
    layers.push(`CALL {${body}
      RETURN count(DISTINCT n) AS ${tv}
    }
    CALL {${body}
      WITH DISTINCT n LIMIT ${perDepthCap}
      RETURN collect(n) AS ${lv}
    }`);
    layerVars.push(lv);
    totalVars.push(tv);
  }

  const query = `
    MATCH (c:${centerUnion} {id: $id})
    WITH c LIMIT 1
    ${layers.join('\n')}
    WITH c, (${layerVars.join(' + ')}) AS others, (${totalVars.join(' + ')}) AS total
    WITH c, others[0..${totalCap}] AS others, total
    CALL {
      WITH c, others
      WITH [c] + others AS visited
      UNWIND visited AS a
      MATCH (a)-[r:${rels}]-(b:${nodeUnion})
      WHERE b IN visited
        AND ($collections IS NULL OR r.collection_id IN $collections OR r.collection_id IS NULL)
      WITH DISTINCT r
      RETURN collect({
        from: startNode(r).id,
        to: endNode(r).id,
        rel_type: type(r),
        collection_id: r.collection_id
      }) AS edges
    }
    RETURN
      { id: c.id, name: coalesce(c.name, c.reference), labels: labels(c), collection_id: c.collection_id } AS center,
      [n IN others | { id: n.id, name: coalesce(n.name, n.reference), labels: labels(n), collection_id: n.collection_id }] AS nodes,
      edges,
      total`;

  const rows = await neo4j.layer.lumen.query<RawRow>(query, { id: entityId, collections });

  if (rows.length === 0) {
    return { found: false, center: null, nodes: [], edges: [], truncated: { shown: 0, total: 0 } };
  }

  const row = rows[0];

  const seenNodes = new Set<string>();
  const nodes: NeighborhoodNode[] = [];
  for (const n of row.nodes ?? []) {
    if (!n || n.id == null || seenNodes.has(n.id)) continue;
    seenNodes.add(n.id);
    nodes.push(toNode(n));
  }

  // Exact duplicates AND reciprocal A→B/B→A pairs collapse to one link (COR-1).
  const seenEdges = new Set<string>();
  const edges: NeighborhoodEdge[] = [];
  for (const e of row.edges ?? []) {
    if (!e || e.from == null || e.to == null) continue;
    const key = `${e.rel_type}|${[e.from, e.to].sort().join('→')}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ from: e.from, to: e.to, rel_type: e.rel_type, collection_id: e.collection_id ?? null });
  }

  return {
    found: true,
    center: toNode(row.center),
    nodes,
    edges,
    truncated: { shown: nodes.length, total: row.total ?? nodes.length },
  };
}
