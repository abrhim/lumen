import { describe, it, expect, vi } from 'vitest';
// Harness (graph-view): written before implementation — see docs/features/graph-view/plan.md
import { getNeighborhood } from '../graph/get-neighborhood';
import type { Neo4jClient } from '@lumen/neo4j-http';

/** Mock client that captures the Cypher + params handed to the lumen layer. */
function capturingNeo4j(rows: unknown[] = []) {
  const captured: { query: string; params: Record<string, unknown> }[] = [];
  const client = {
    query: vi.fn(),
    raw: vi.fn(),
    cross: vi.fn(),
    layer: new Proxy({} as any, {
      get() {
        return {
          query: vi.fn(async (q: string, p: Record<string, unknown>) => {
            captured.push({ query: q, params: p });
            return rows;
          }),
        };
      },
    }),
  } as unknown as Neo4jClient;
  return { client, captured };
}

const NEIGHBORHOOD_ROW = {
  center: { id: '1-ne-3-7', name: null, labels: ['Verse'], collection_id: 'canon' },
  nodes: [
    { id: 'obedience', name: 'Obedience', labels: ['Principle'], collection_id: 'phase-b' },
    { id: 'nephi-1', name: 'Nephi', labels: ['Person'], collection_id: 'phase-b' },
  ],
  edges: [
    { from: '1-ne-3-7', to: 'obedience', rel_type: 'TEACHES', collection_id: 'phase-b' },
    { from: '1-ne-3-7', to: 'nephi-1', rel_type: 'MENTIONS', collection_id: 'phase-b' },
  ],
  total: 2,
};

describe('getNeighborhood — public contract (graph-view harness)', () => {
  it('returns found/center/nodes/edges/truncated for a known entity', async () => {
    const { client } = capturingNeo4j([NEIGHBORHOOD_ROW]);
    const result = await getNeighborhood(client, '1-ne-3-7', { depth: 1 });
    expect(result.found).toBe(true);
    expect(result.center?.id).toBe('1-ne-3-7');
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(2);
    expect(result.truncated).toEqual({ shown: 2, total: 2 });
  });

  it('reports accurate truncation when the graph exceeds caps (FM-2)', async () => {
    const { client } = capturingNeo4j([{ ...NEIGHBORHOOD_ROW, total: 213 }]);
    const result = await getNeighborhood(client, '1-ne-3-7', { depth: 1 });
    expect(result.truncated.shown).toBe(2);
    expect(result.truncated.total).toBe(213);
  });

  it('returns found:false for an unknown entity without throwing (FM-3)', async () => {
    const { client } = capturingNeo4j([]);
    const result = await getNeighborhood(client, 'nonexistent-entity', { depth: 1 });
    expect(result.found).toBe(false);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('rejects out-of-range or non-integer depth before any Cypher runs (FM-4)', async () => {
    const { client, captured } = capturingNeo4j([NEIGHBORHOOD_ROW]);
    for (const depth of [0, 4, 2.5, -1, NaN]) {
      await expect(getNeighborhood(client, '1-ne-3-7', { depth: depth as any })).rejects.toThrow();
    }
    expect(captured).toHaveLength(0);
  });

  it('rejects relTypes/nodeTypes outside the allowlist; no caller string reaches Cypher (FM-5)', async () => {
    const { client, captured } = capturingNeo4j([NEIGHBORHOOD_ROW]);
    await expect(
      getNeighborhood(client, '1-ne-3-7', { depth: 1, relTypes: ['TEACHES', 'X]->() DELETE (n'] }),
    ).rejects.toThrow();
    await expect(
      getNeighborhood(client, '1-ne-3-7', { depth: 1, nodeTypes: ['Verse', 'KB_abram_meetings'] }),
    ).rejects.toThrow();
    expect(captured).toHaveLength(0);
    // valid subsets pass through
    const ok = await getNeighborhood(client, '1-ne-3-7', { depth: 1, relTypes: ['TEACHES'] });
    expect(ok.found).toBe(true);
    expect(captured[0].query).not.toContain('DELETE');
  });

  it('passes collections as a bound parameter, never interpolated (collections contract)', async () => {
    const { client, captured } = capturingNeo4j([NEIGHBORHOOD_ROW]);
    await getNeighborhood(client, '1-ne-3-7', { depth: 1, collections: ['canon', 'phase-b'] });
    expect(captured[0].params.collections).toEqual(['canon', 'phase-b']);
    expect(captured[0].query).not.toContain("'canon'");
  });

  it('constrains every traversal hop to LM-layer labels — shared-instance isolation (FM-8)', async () => {
    const { client, captured } = capturingNeo4j([NEIGHBORHOOD_ROW]);
    await getNeighborhood(client, '1-ne-3-7', { depth: 2 });
    const q = captured[0].query;
    // center match and traversal must both carry layer-placeholder label constraints
    expect(q).toMatch(/\{Verse\}/);
    // no unlabeled node group in any relationship pattern: every `(x` in a
    // pattern must be followed by a label or a labels()-filter must exist
    expect(/WHERE[\s\S]*labels\(/.test(q) || !/\]\s*-\s*\(\s*\w+\s*\)/.test(q)).toBe(true);
  });

  it('survives a KV-style JSON round trip without shape loss (FM-7)', async () => {
    const { client } = capturingNeo4j([NEIGHBORHOOD_ROW]);
    const result = await getNeighborhood(client, '1-ne-3-7', { depth: 1 });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('includes edges/nodes missing collection_id by default — fail-open pre-backfill (FM-6)', async () => {
    const row = {
      ...NEIGHBORHOOD_ROW,
      edges: [{ from: '1-ne-3-7', to: 'obedience', rel_type: 'TEACHES', collection_id: null }],
      nodes: [{ id: 'obedience', name: 'Obedience', labels: ['Principle'], collection_id: null }],
      total: 1,
    };
    const { client } = capturingNeo4j([row]);
    const result = await getNeighborhood(client, '1-ne-3-7', { depth: 1, collections: ['canon'] });
    expect(result.edges).toHaveLength(1);
    expect(result.nodes).toHaveLength(1);
  });
});
