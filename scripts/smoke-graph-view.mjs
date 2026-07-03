// Live-data smoke for the graph-view feature (plan: harness scope).
// Run: node --import tsx scripts/smoke-graph-view.mjs
// Asserts against the REAL Neo4j instance: hub caps + truncation accuracy,
// cross-tenant isolation (shared instance!), and the not-found shape.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { createNeo4jClient } = await import(join(root, 'packages/neo4j-http/src/index.ts'));
const { getNeighborhood, GRAPH_ENTITY_TYPES } = await import(
  join(root, 'packages/scripture/src/graph/get-neighborhood.ts')
);

const wrangler = JSON.parse(readFileSync(join(root, 'apps/web/wrangler.json'), 'utf8'));
const devVars = readFileSync(join(root, 'apps/web/.dev.vars'), 'utf8');
const password = devVars.match(/^NEO4J_PASSWORD=(.+)$/m)?.[1]?.trim();
if (!password) throw new Error('NEO4J_PASSWORD not found in apps/web/.dev.vars');

const neo4j = createNeo4jClient({
  uri: wrangler.vars.NEO4J_URI,
  username: wrangler.vars.NEO4J_USER,
  password,
  database: wrangler.vars.NEO4J_DATABASE,
  layers: { lumen: 'LM' },
  entityTypes: [...GRAPH_ENTITY_TYPES],
  timeoutMs: 15_000,
});

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// 1. Hub verse at depth 2: caps hold, truncation is accurate, tenants isolated.
const t0 = Date.now();
const hub = await getNeighborhood(neo4j, '1-ne-3-7', { depth: 2 });
const elapsed = Date.now() - t0;
check('hub verse found', hub.found === true);
check('caps hold', hub.nodes.length <= 600, `${hub.nodes.length} nodes`);
check('truncation accurate', hub.truncated.total >= hub.truncated.shown,
  `shown ${hub.truncated.shown} of ${hub.truncated.total}`);
check('edges collected (incl. siblings)', hub.edges.length > 0, `${hub.edges.length} edges`);
const contentTypes = new Set(GRAPH_ENTITY_TYPES);
const alien = [...hub.nodes, hub.center].filter(
  (n) => n && !n.labels.every((l) => contentTypes.has(l)),
);
check('cross-tenant isolation (FM-8)', alien.length === 0,
  alien.length ? `leaked labels: ${JSON.stringify(alien.slice(0, 3).map((n) => n.labels))}` : 'no KB_*/DS_* labels');
check('depth-2 latency sane', elapsed < 10_000, `${elapsed}ms`);

// 2. Principle center at depth 1.
const prin = await getNeighborhood(neo4j, 'obedience', { depth: 1 });
check('principle center resolves', prin.found === true && prin.center?.labels.includes('Principle'));
check('principle has verse neighbors', prin.nodes.some((n) => n.labels.includes('Verse')));

// 3. Unknown entity → found:false, no throw (FM-3).
const missing = await getNeighborhood(neo4j, 'graph-view-smoke-nonexistent', { depth: 1 });
check('unknown entity is found:false', missing.found === false && missing.nodes.length === 0);

// 4. Duplicate-edge dedupe holds on real data (COR-1: prod has parallel CROSS_REFs).
const dupPair = await getNeighborhood(neo4j, '1-cor-1-27', { depth: 1 });
const keys = dupPair.edges.map((e) => `${e.rel_type}|${[e.from, e.to].sort().join('→')}`);
check('no duplicate edge keys on real data', new Set(keys).size === keys.length);

console.log(failures === 0 ? 'SMOKE PASS' : `SMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
