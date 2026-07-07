// Backfill collection_id from Postgres (source of truth) onto Neo4j LM-layer
// nodes and relationships, so graph traversals can filter by collection.
//
//   node scripts/backfill-neo4j-collections.mjs --dry-run   # report, no writes
//   node scripts/backfill-neo4j-collections.mjs             # stamp
//   node scripts/backfill-neo4j-collections.mjs --verify    # diff Neo4j vs PG, no writes
//
// Exit codes: 0 success/clean-verify, 1 fatal (connection/config), 2 partial
// failure or verify mismatches. Idempotent: SET to the same value is a no-op;
// re-run after every ingest until an outbox/CDC pattern exists (plan DATA-9).
//
// Join subtleties (plan DATA-1/DATA-2): phase-b entity ids that collided in
// Postgres were namespaced to `{type}:{id}` with the original graph id kept in
// metadata.neo4j_id — the graph is matched on the resolved id. Parallel
// relationships matching one PG row are all stamped identically; PG rows that
// disagree for the same (from,to,rel_type) key are logged, never last-write-wins.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LM_LABEL_PREDICATE = `any(l IN labels(%s) WHERE l STARTS WITH 'LM_')`;
// Explicit label union so the planner uses the per-label id indexes — an
// unlabeled `MATCH (n {id})` scans every node in the shared instance per row.
const LM_LABELS = [
  'LM_Verse', 'LM_Principle', 'LM_Person', 'LM_Place', 'LM_Chapter', 'LM_Book',
  'LM_Volume', 'LM_StrongsWord', 'LM_JstReading', 'LM_ChapterSummary',
  'LM_NaveTopic', 'LM_Era', 'LM_Event', 'LM_Symbol',
];
const LM_UNION = LM_LABELS.join('|');
const BATCH_SIZE = 2000;

// ---------- pure helpers (unit-tested in scripts/__tests__) ----------

/** Resolve a Postgres entity id to the id the Neo4j node actually carries. */
export function resolveGraphId(pgId, metadata) {
  const meta = typeof metadata === 'string' ? safeParse(metadata) : (metadata ?? {});
  if (meta && typeof meta.neo4j_id === 'string' && meta.neo4j_id.length > 0) return meta.neo4j_id;
  return pgId;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

export function chunk(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export const edgeKey = (r) => `${r.from} | ${r.to} | ${r.rel_type}`;

/**
 * Split PG edge rows into stampable rows and conflicting keys (B11/DATA-1).
 * Rows whose key carries disagreeing collection_ids are EXCLUDED from
 * stamping — never batch-order last-write-wins — and reported for repair.
 */
export function partitionEdgeRows(edgeRows) {
  const byKey = new Map();
  for (const r of edgeRows) {
    const key = edgeKey(r);
    const cids = byKey.get(key) ?? new Set();
    cids.add(r.cid);
    byKey.set(key, cids);
  }
  const conflictKeys = new Set([...byKey.entries()].filter(([, c]) => c.size > 1).map(([k]) => k));
  return {
    clean: edgeRows.filter((r) => !conflictKeys.has(edgeKey(r))),
    conflicts: [...conflictKeys],
  };
}

/** Back-compat shim for the original detector contract. */
export function findConflictingEdgeRows(edgeRows) {
  return partitionEdgeRows(edgeRows).conflicts;
}

/** Strip credentials from anything headed to a log line (B20/SEC-10). */
export function scrub(message) {
  return String(message)
    .replace(/\b(postgres(?:ql)?|neo4j(?:\+s(?:sc)?)?|https?):\/\/[^@\s]*@/gi, '$1://<redacted>@')
    .replace(/password=[^&\s]+/gi, 'password=<redacted>');
}

/**
 * Diff desired PG state against observed Neo4j state (for --verify and for
 * interrupted-run convergence — COR-8). Returns what still needs stamping,
 * what disagrees, and graph elements with no PG counterpart.
 */
export function reconcile(desired, observed) {
  const pending = [];
  const mismatched = [];
  for (const [id, cid] of desired) {
    if (!observed.has(id)) continue; // absent from graph — counted as missing by caller
    const actual = observed.get(id);
    if (actual == null) pending.push(id);
    else if (actual !== cid) mismatched.push({ id, expected: cid, actual });
  }
  const orphans = [];
  for (const id of observed.keys()) {
    if (!desired.has(id)) orphans.push(id);
  }
  return { pending, mismatched, orphans };
}

// ---------- I/O ----------

function loadConfig() {
  const wrangler = JSON.parse(readFileSync(join(ROOT, 'apps/web/wrangler.json'), 'utf8'));
  const devVars = readFileSync(join(ROOT, 'apps/web/.dev.vars'), 'utf8');
  const neo4jPassword = devVars.match(/^NEO4J_PASSWORD=(.+)$/m)?.[1]?.trim();
  const env = readFileSync(join(ROOT, 'apps/web/.env'), 'utf8');
  const pgUrl = env.match(/HYPERDRIVE=(.+)/)?.[1]?.trim();
  if (!neo4jPassword || !pgUrl) throw new Error('missing credentials (apps/web/.dev.vars, apps/web/.env)');
  return {
    pgUrl,
    neo4jEndpoint: `${wrangler.vars.NEO4J_URI.replace('neo4j+s://', 'https://')}/db/${wrangler.vars.NEO4J_DATABASE}/query/v2`,
    neo4jAuth: 'Basic ' + Buffer.from(`${wrangler.vars.NEO4J_USER}:${neo4jPassword}`).toString('base64'),
  };
}

async function neo4jQuery(cfg, statement, parameters = {}) {
  const res = await fetch(cfg.neo4jEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: cfg.neo4jAuth },
    body: JSON.stringify({ statement, parameters }),
  });
  const body = await res.json();
  if (!res.ok || body.errors?.length) {
    // never echo the endpoint/credentials into thrown errors (SEC-10)
    throw new Error(`neo4j query failed: ${scrub(body.errors?.[0]?.message ?? res.status)}`);
  }
  const fields = body.data?.fields ?? [];
  return (body.data?.values ?? []).map((v) => Object.fromEntries(fields.map((f, i) => [f, v[i]])));
}

const log = (event, data) => console.log(JSON.stringify({ event, ...data }));

// Exported so the harness can assert stable pagination (B13).
export const VERIFY_NODE_PAGE_QUERY = (skip) => `
  MATCH (n) WHERE ${LM_LABEL_PREDICATE.replace('%s', 'n')}
  RETURN n.id AS id, n.collection_id AS cid
  ORDER BY id SKIP ${skip} LIMIT 10000`;

export const VERIFY_EDGE_PAGE_QUERY = (skip) => `
  MATCH (a)-[r]->(b)
  WHERE ${LM_LABEL_PREDICATE.replace('%s', 'a')} AND ${LM_LABEL_PREDICATE.replace('%s', 'b')}
  RETURN a.id AS from, type(r) AS rel_type, b.id AS to, r.collection_id AS cid
  ORDER BY elementId(r) SKIP ${skip} LIMIT 10000`;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const verifyOnly = process.argv.includes('--verify');
  const cfg = loadConfig();
  const require = createRequire(import.meta.url);
  const postgres = require(join(ROOT, 'apps/web/node_modules/postgres'));
  const sql = postgres(cfg.pgUrl, { prepare: false });
  const startedAt = new Date().toISOString();
  log('backfill_start', { startedAt, dryRun, verifyOnly });

  let exitCode = 0;
  try {
    // ---- desired state from Postgres ----
    // Spine tables are the structural source (canon-spine, DATA-2): the spine
    // carries no collection_id — its graph mirrors are stamped 'canon' by
    // construction. Knowledge entities keep their own collection_id.
    // Deprecated structural entities are EXCLUDED here (spine supersedes them
    // as mirror source); they remain in lumen.nodes for edge-endpoint lookup.
    const pgNodes = await sql`
      SELECT id, entity_type, collection_id, metadata->>'neo4j_id' AS neo4j_id
      FROM lumen.entities
      WHERE collection_id IS NOT NULL
        AND entity_type NOT IN ('volume', 'book', 'chapter')`;
    const skippedNullNodes = Number((await sql`
      SELECT count(*)::int AS n FROM lumen.entities WHERE collection_id IS NULL`)[0].n);
    const nodeGroups = new Map(); // entity_type -> rows
    for (const r of pgNodes) {
      const row = { id: resolveGraphId(r.id, { neo4j_id: r.neo4j_id }), cid: r.collection_id };
      const list = nodeGroups.get(r.entity_type) ?? [];
      list.push(row);
      nodeGroups.set(r.entity_type, list);
    }
    for (const [type, table] of [
      ['volume', sql`SELECT id FROM lumen.volumes`],
      ['book', sql`SELECT id FROM lumen.books`],
      ['chapter', sql`SELECT id FROM lumen.chapters`],
    ]) {
      const rows = await table;
      nodeGroups.set(type, rows.map((r) => ({ id: r.id, cid: 'canon' })));
    }
    const verseIds = await sql`SELECT id FROM lumen.verses`;
    nodeGroups.set('verse', verseIds.map((r) => ({ id: r.id, cid: 'canon' })));
    const nodeRowCount = [...nodeGroups.values()].reduce((a, g) => a + g.length, 0);

    const pgEdges = await sql`
      SELECT e.from_id, e.to_id, e.rel_type, e.collection_id,
             fe.metadata->>'neo4j_id' AS from_neo4j_id,
             te.metadata->>'neo4j_id' AS to_neo4j_id
      FROM lumen.edges e
      LEFT JOIN lumen.entities fe ON fe.id = e.from_id
      LEFT JOIN lumen.entities te ON te.id = e.to_id`;
    const edgeRows = pgEdges.map((r) => ({
      from: resolveGraphId(r.from_id, { neo4j_id: r.from_neo4j_id }),
      to: resolveGraphId(r.to_id, { neo4j_id: r.to_neo4j_id }),
      rel_type: r.rel_type,
      cid: r.collection_id,
    }));
    const { clean: stampableEdgeRows, conflicts } = partitionEdgeRows(edgeRows);
    log('pg_state_loaded', {
      nodes: nodeRowCount, skippedNullNodes, edges: edgeRows.length,
      conflictingEdgeKeys: conflicts.length, conflictSample: conflicts.slice(0, 5),
    });

    if (verifyOnly) {
      // ---- read-only diff of graph vs PG (DATA-7 safety carve-out) ----
      const desiredNodes = new Map(
        [...nodeGroups.values()].flat().map((r) => [r.id, r.cid]),
      );
      // Stable ORDER BY (B13) — SKIP/LIMIT without it can skip or duplicate
      // rows across pages. Id collisions (real in prod) are surfaced instead
      // of silently collapsed by the map fold (B14).
      const observedNodes = new Map();
      const collidingIds = new Map();
      for (let skip = 0; ; skip += 10000) {
        const page = await neo4jQuery(cfg, VERIFY_NODE_PAGE_QUERY(skip));
        for (const row of page) {
          if (observedNodes.has(row.id) && observedNodes.get(row.id) !== row.cid) {
            collidingIds.set(row.id, [observedNodes.get(row.id), row.cid]);
          }
          observedNodes.set(row.id, row.cid);
        }
        if (page.length < 10000) break;
      }
      const nodeDiff = reconcile(desiredNodes, observedNodes);
      const missingIds = [...desiredNodes.keys()].filter((id) => !observedNodes.has(id));
      log('verify_nodes', {
        graphNodes: observedNodes.size, unstamped: nodeDiff.pending.length,
        mismatched: nodeDiff.mismatched.length, orphans: nodeDiff.orphans.length,
        // present in PG, absent from graph — expected for classes never
        // exported (jst/strongs/naves, mismatched chapter ids); excluded from
        // `dirty` by design, surfaced with samples so class-level join misses
        // are visible rather than silently absorbed (B15)
        missingFromGraph: missingIds.length,
        missingSample: missingIds.slice(0, 10),
        collidingIds: collidingIds.size,
        collidingSample: [...collidingIds.entries()].slice(0, 5),
        mismatchSample: nodeDiff.mismatched.slice(0, 5),
      });

      // Per-edge reconcile (B12/DATA-7): every LM edge compared against the PG
      // key-set, not just an aggregate by value.
      const desiredEdges = new Map();
      for (const r of edgeRows) {
        const key = edgeKey(r);
        const set = desiredEdges.get(key) ?? new Set();
        set.add(r.cid);
        desiredEdges.set(key, set);
      }
      let edgeUnstamped = 0;
      let edgeMismatched = 0;
      let edgeOrphans = 0;
      const edgeMismatchSample = [];
      for (let skip = 0; ; skip += 10000) {
        const page = await neo4jQuery(cfg, VERIFY_EDGE_PAGE_QUERY(skip));
        for (const row of page) {
          const key = `${row.from} | ${row.to} | ${row.rel_type}`;
          const expected = desiredEdges.get(key);
          if (!expected) edgeOrphans++;
          else if (row.cid == null) edgeUnstamped++;
          else if (!expected.has(row.cid)) {
            edgeMismatched++;
            if (edgeMismatchSample.length < 5) edgeMismatchSample.push({ key, actual: row.cid, expected: [...expected] });
          }
        }
        if (page.length < 10000) break;
      }
      log('verify_edges', { unstamped: edgeUnstamped, mismatched: edgeMismatched, orphans: edgeOrphans, mismatchSample: edgeMismatchSample });

      const dirty = nodeDiff.pending.length + nodeDiff.mismatched.length + edgeUnstamped + edgeMismatched;
      if (dirty > 0) exitCode = 2;
      log('verify_done', { clean: dirty === 0 });
      return;
    }

    // ---- stamp nodes, per entity type so "missing" is self-explanatory ----
    // (jst_reading / strongs_word / naves_topic have no graph nodes yet — they
    // report as fully missing rather than looking like a broken join.)
    let nodesMatched = 0;
    let batchesFailed = 0;
    const nodesPerType = {};
    for (const [entityType, rows] of nodeGroups) {
      let typeMatched = 0;
      const batches = chunk(rows, BATCH_SIZE);
      for (let i = 0; i < batches.length; i++) {
        try {
          const [res] = await neo4jQuery(cfg, `
            UNWIND $rows AS row
            MATCH (n:${LM_UNION} {id: row.id})
            ${dryRun ? '' : 'SET n.collection_id = row.cid'}
            RETURN count(n) AS matched`, { rows: batches[i] });
          typeMatched += Number(res?.matched ?? 0);
        } catch (err) {
          batchesFailed++;
          log('node_batch_failed', { entityType, batch: i + 1, message: scrub(err.message) });
        }
      }
      nodesMatched += typeMatched;
      nodesPerType[entityType] = {
        pgRows: rows.length,
        matched: typeMatched,
        missing: Math.max(0, rows.length - typeMatched),
        // matched > pgRows ⇒ one id matches multiple LM nodes (cross-type id
        // collision in the graph) — every match gets the same stamp
        overmatched: Math.max(0, typeMatched - rows.length),
      };
      log('node_type_done', { entityType, ...nodesPerType[entityType] });
    }

    // ---- stamp edges (directed match; parallel rels all stamped alike) ----
    let edgesMatched = 0;
    // conflicting keys are excluded — repaired manually, never last-write-wins (B11)
    const edgeBatches = chunk(stampableEdgeRows, BATCH_SIZE);
    for (let i = 0; i < edgeBatches.length; i++) {
      try {
        const rows = edgeBatches[i];
        const [res] = await neo4jQuery(cfg, `
          UNWIND $rows AS row
          MATCH (a:${LM_UNION} {id: row.from})-[r]->(b:${LM_UNION} {id: row.to})
          WHERE type(r) = row.rel_type
          ${dryRun ? '' : 'SET r.collection_id = row.cid'}
          RETURN count(r) AS matched`, { rows });
        edgesMatched += Number(res?.matched ?? 0);
        log('edge_batch', { batch: i + 1, of: edgeBatches.length, rows: rows.length, matched: Number(res?.matched ?? 0) });
      } catch (err) {
        batchesFailed++;
        log('edge_batch_failed', { batch: i + 1, message: scrub(err.message) });
      }
    }

    if (batchesFailed > 0) exitCode = 2;
    log('backfill_done', {
      startedAt, finishedAt: new Date().toISOString(), dryRun,
      nodes: { pgRows: nodeRowCount, matched: nodesMatched, skippedNullCollection: skippedNullNodes, perType: nodesPerType },
      edges: { pgRows: edgeRows.length, stampable: stampableEdgeRows.length, matched: edgesMatched, conflictingKeys: conflicts.length },
      batchesFailed,
    });
  } catch (err) {
    exitCode = 1;
    log('backfill_fatal', { message: scrub(err.message) });
  } finally {
    await sql.end();
    process.exit(exitCode);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
