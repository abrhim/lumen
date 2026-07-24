// graph-centrality.mjs — centrality measures over the claims graph.
//
// Computes, over lumen.edges minus the structural spine (CONTAINS,
// HAS_SUMMARY, COVERS, SUMMARIZES, IN_VOLUME):
//   - harmonic closeness (exact, BFS) for the top-20 nodes by degree
//   - sampled betweenness (Brandes, K=150 sources) for the whole graph
//
// Read-only; needs DATABASE_URL (repo-root .env). Used for landing-ring
// curation and the edge-ranking design (docs/design/edge-ranking.md).
// First run (2026-07-22): Jesus Christ leads every measure — degree 10,930
// (7.5× runner-up), betweenness 27× runner-up, closeness 1.4× runner-up.
// Caveat: output needs a human filter — known data debt (the "NA" place
// node, melchisedec/melchizedek dup) ranks high on every measure.

import postgres from 'postgres';
import { readFileSync } from 'fs';

const url =
  process.env.DATABASE_URL ??
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .match(/^DATABASE_URL=(.+)$/m)[1]
    .replace(/^"|"$/g, '');
const sql = postgres(url, { max: 1, prepare: false });

const STRUCTURAL = ['CONTAINS', 'HAS_SUMMARY', 'COVERS', 'SUMMARIZES', 'IN_VOLUME'];

console.error('loading edges…');
const edges = await sql`
  SELECT from_id, to_id FROM lumen.edges
  WHERE rel_type <> ALL(${STRUCTURAL})`;
console.error(`  ${edges.length} claim edges`);

const idx = new Map();
const ids = [];
const id_ = (s) => {
  let i = idx.get(s);
  if (i === undefined) { i = ids.length; idx.set(s, i); ids.push(s); }
  return i;
};
const src = new Int32Array(edges.length), dst = new Int32Array(edges.length);
for (let k = 0; k < edges.length; k++) {
  src[k] = id_(edges[k].from_id);
  dst[k] = id_(edges[k].to_id);
}
const V = ids.length, E = edges.length;
console.error(`  ${V} nodes`);

// undirected CSR
const deg = new Int32Array(V);
for (let k = 0; k < E; k++) { deg[src[k]]++; deg[dst[k]]++; }
const off = new Int32Array(V + 1);
for (let v = 0; v < V; v++) off[v + 1] = off[v] + deg[v];
const adj = new Int32Array(2 * E);
const cur = off.slice(0, V);
for (let k = 0; k < E; k++) {
  adj[cur[src[k]]++] = dst[k];
  adj[cur[dst[k]]++] = src[k];
}

const order = Array.from({ length: V }, (_, v) => v).sort((a, b) => deg[b] - deg[a]);
const candidates = order.slice(0, 20);

// harmonic closeness (robust to disconnection): sum of 1/d over reachable
const dist = new Int32Array(V);
const queue = new Int32Array(V);
function harmonic(s) {
  dist.fill(-1); dist[s] = 0;
  let head = 0, tail = 0; queue[tail++] = s;
  let h = 0;
  while (head < tail) {
    const v = queue[head++];
    const dv = dist[v];
    if (dv > 0) h += 1 / dv;
    for (let p = off[v]; p < off[v + 1]; p++) {
      const w = adj[p];
      if (dist[w] < 0) { dist[w] = dv + 1; queue[tail++] = w; }
    }
  }
  return h;
}
console.error('closeness…');
const closeness = new Map(candidates.map((c) => [c, harmonic(c)]));

// sampled betweenness (Brandes), K sources; deterministic LCG seed
const K = 150;
const bc = new Float64Array(V);
const sigma = new Float64Array(V);
const delta = new Float64Array(V);
const preds = Array.from({ length: V }, () => []);
let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
console.error(`betweenness (${K} samples)…`);
for (let iter = 0; iter < K; iter++) {
  const s = order[Math.floor(rnd() * V * 0.5)];
  dist.fill(-1); sigma.fill(0); delta.fill(0);
  dist[s] = 0; sigma[s] = 1;
  let head = 0, tail = 0; queue[tail++] = s;
  const stackOrder = [];
  while (head < tail) {
    const v = queue[head++];
    stackOrder.push(v);
    const dv = dist[v];
    for (let p = off[v]; p < off[v + 1]; p++) {
      const w = adj[p];
      if (dist[w] < 0) { dist[w] = dv + 1; queue[tail++] = w; }
      if (dist[w] === dv + 1) { sigma[w] += sigma[v]; preds[w].push(v); }
    }
  }
  for (let i = stackOrder.length - 1; i >= 0; i--) {
    const w = stackOrder[i];
    const pw = preds[w];
    for (let j = 0; j < pw.length; j++) {
      const v = pw[j];
      delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
    }
    if (w !== s) bc[w] += delta[w];
    pw.length = 0;
  }
  if ((iter + 1) % 30 === 0) console.error(`  ${iter + 1}/${K}`);
}

const topBy = (arr, n) =>
  Array.from({ length: V }, (_, v) => v).sort((a, b) => arr[b] - arr[a]).slice(0, n);
const topBC = topBy(bc, 15);

const wanted = [...new Set([...candidates, ...topBC])].map((v) => ids[v]);
const names = await sql`
  SELECT id, name, entity_type AS t FROM lumen.entities WHERE id = ANY(${wanted})
  UNION ALL
  SELECT id, reference, 'verse' FROM lumen.verses WHERE id = ANY(${wanted})`;
const nameOf = new Map(names.map((r) => [r.id, `${r.name} [${r.t}]`]));
const label = (v) => nameOf.get(ids[v]) ?? ids[v];

console.log('\n== sampled betweenness (share of shortest paths through the node) ==');
const maxBC = bc[topBC[0]];
for (const v of topBC)
  console.log(`${(bc[v] / maxBC).toFixed(3).padStart(7)}  deg=${String(deg[v]).padStart(5)}  ${label(v)}`);

console.log('\n== harmonic closeness (nearness to the whole graph; top-20-degree candidates) ==');
const cSorted = [...closeness.entries()].sort((a, b) => b[1] - a[1]);
for (const [v, h] of cSorted)
  console.log(`${h.toFixed(0).padStart(7)}  deg=${String(deg[v]).padStart(5)}  ${label(v)}`);

await sql.end();
