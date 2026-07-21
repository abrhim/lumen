// One-shot idempotent D&C + PGP graph spine sync (remediation plan v2 item 1 +
// D3 + Write-protocol Neo4j bullets — docs/ops/remediation-plan.md).
//
//   node --import tsx scripts/backfill-neo4j-spine.mjs                    # counts-only dry-run (default)
//   COMMIT=1 node --import tsx scripts/backfill-neo4j-spine.mjs          # write (PGP canary gate built in)
//   node --import tsx scripts/backfill-neo4j-spine.mjs --verify          # read-only acceptance checks
//   --volume=pgp|dc|all   scope (default all; write order is always PGP before D&C)
//   SYNC_RUN=<id>         override the generated sync_run stamp
//
// Exit codes: 0 clean, 1 fatal (config/connection), 2 halt / expectation or
// acceptance mismatch. Scope: MERGE the dc+pgp LM_Verse spine (expected
// creations 3,360 dc + 635 pgp), CREATE LM_Chapter moses-ch-1 only-if-absent,
// CONTAINS chapter->verse for every created verse, then the phase-b edge
// slice incident to the created verses. Idempotent converge-to-parity: MERGE
// everywhere, sync_run stamped via ON CREATE SET ONLY so matched pre-existing
// elements never gain it and delete-by-sync_run can never touch them.
//
// DELIBERATE DIVERGENCES (documented per plan):
// - HALT IMMEDIATELY on any batch error / per-batch count mismatch /
//   cumulative-created overshoot — an explicit deviation from
//   backfill-neo4j-collections.mjs's continue-on-failure style. Post-halt a
//   per-volume count snapshot is written to docs/ops/spine-sync/.
// - New CONTAINS rels are stamped collection_id 'canon'; legacy CONTAINS from
//   the original build carry 'phase-b'. Deliberate divergence, reported in
//   the dry-run output.
// - Slice edges whose endpoint is a chapter under a PG-style id (e.g.
//   LM_Chapter 'moses-1' — graph chapters are ALL '-ch-' form) are MATCH-only
//   skips, counted against the pre-probe expectation. The CONTAINS phase
//   recreates chapter->verse structure through the legacy chapter-id mapper,
//   so nothing structural is lost. NEVER create a chapter under a PG-style id.
// - Endpoint resolution is ALWAYS by the exact label carried in edge metadata
//   from_label/to_label — never a label union: id 'dc' exists as BOTH LM_Book
//   and LM_Volume. Non-verse endpoints are MATCH-only (entity-node
//   creations = 0 is asserted, not assumed).
//
// Post-sync (manual, per write protocol): bump KV key versions
// vconn:v2 -> v3 and graph:v1 -> v2 in scripture.tsx and deploy, or a clean
// sync stays invisible for up to 7 days.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { resolveGraphId, chunk, scrub } from './backfill-neo4j-collections.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BATCH_SIZE = 2000;
const SNAPSHOT_DIR = join(ROOT, 'docs', 'ops', 'spine-sync');

// Plan pins (remediation-plan.md item 1, verified live 2026-07-20). A PG count
// that diverges means the plan's premises are stale — halt before any write.
export const PLAN = {
  dc: { pgVerses: 3654, pgChapters: 138, preExistingGraphVerses: 294, expectedVerseCreate: 3360 },
  pgp: { pgVerses: 635, pgChapters: 16, preExistingGraphVerses: 0, expectedVerseCreate: 635 },
};
export const VOLUME_ORDER = ['pgp', 'dc']; // canary first, always

export const MOSES_CH_1 = { id: 'moses-ch-1', name: 'Moses 1', chapter_number: 1, book_id: 'moses' };
export const EXPECTED_MISSING_CHAPTERS = [MOSES_CH_1.id];

// Graph label allowlist (house list) — labels are interpolated into Cypher,
// so they are validated by membership, never trusted from metadata raw.
export const SPINE_GRAPH_LABELS = [
  'LM_Verse', 'LM_Principle', 'LM_Person', 'LM_Place', 'LM_Chapter', 'LM_Book',
  'LM_Volume', 'LM_StrongsWord', 'LM_JstReading', 'LM_ChapterSummary',
  'LM_NaveTopic', 'LM_Era', 'LM_Event', 'LM_Symbol',
];
const REL_TYPE_RE = /^[A-Z][A-Z_]*$/;

// ---------- pure helpers (unit-tested in scripts/__tests__/spine-backfill.test.mjs) ----------

// ALL 1,581 graph chapters use legacy '{book}-ch-{n}' ids; js-h/js-m use the
// long form. NEVER emit a PG-style '{book}-{n}' id (would mint duplicates).
const LONG_FORM_BOOKS = { 'js-h': 'joseph-smith-history', 'js-m': 'joseph-smith-matthew' };

export function graphChapterId(bookId, chapterNumber) {
  const n = Number(chapterNumber);
  if (!bookId || !Number.isInteger(n) || n < 1) throw new Error(`bad chapter key: ${bookId} ${chapterNumber}`);
  return `${LONG_FORM_BOOKS[bookId] ?? bookId}-ch-${n}`;
}

/** PG '{book}-{n}' -> legacy graph chapter id. */
export function mapPgChapterId(pgChapterId) {
  const m = String(pgChapterId).match(/^(.+)-([0-9]+)$/);
  if (!m) throw new Error(`unmappable PG chapter id: ${pgChapterId}`);
  return graphChapterId(m[1], Number(m[2]));
}

/** 'Doctrine and Covenants 4:2' style, from PG book/chapter/verse naming. */
export function buildReference(bookName, chapterNumber, verseNumber) {
  return `${bookName} ${Number(chapterNumber)}:${Number(verseNumber)}`;
}

/**
 * PG verse join row -> LM_Verse node props (shape conformed to a live synced
 * D&C verse, verified 2026-07-20) + the mapped CONTAINS chapter id.
 */
export function buildVerseRow(r) {
  const built = buildReference(r.book_name, r.chapter_number, r.verse_number);
  return {
    props: {
      id: r.id,
      text: r.text,
      reference: r.reference ?? built,
      collection_id: 'canon',
      volume_id: r.volume_id,
      book_id: r.book_id,
      chapter_number: Number(r.chapter_number),
      verse_number: Number(r.verse_number),
    },
    chapterGraphId: graphChapterId(r.book_id, r.chapter_number),
    referenceMismatch: r.reference != null && r.reference !== built,
  };
}

/**
 * Split the volume's PG verses against the observed graph state.
 * observed: Map(id -> {present, sync_run}). The slice (edge-phase scope) is
 * STABLE across re-runs: absent nodes plus nodes this backfill created on a
 * prior attempt (they carry sync_run; the pre-existing 294 never do).
 */
export function classifyVerseTargets(pgRows, observed) {
  const toCreate = [];
  const preExisting = [];
  const syncedPrior = [];
  for (const row of pgRows) {
    const seen = observed.get(row.props.id);
    if (!seen || !seen.present) toCreate.push(row);
    else if (seen.sync_run != null) syncedPrior.push(row);
    else preExisting.push(row);
  }
  return { toCreate, preExisting, syncedPrior, sliceRows: [...toCreate, ...syncedPrior] };
}

export function assertGraphLabel(label) {
  if (!SPINE_GRAPH_LABELS.includes(label)) throw new Error(`label not in allowlist: ${label}`);
  return label;
}

export function assertRelType(relType) {
  if (!REL_TYPE_RE.test(String(relType))) throw new Error(`bad rel_type: ${relType}`);
  return relType;
}

function graphSafeProps(props) {
  return Object.values(props).every((v) =>
    v === null || ['string', 'number', 'boolean'].includes(typeof v) ||
    (Array.isArray(v) && v.every((x) => ['string', 'number', 'boolean'].includes(typeof x))));
}

const toObj = (m) => {
  if (m == null) return {};
  if (typeof m !== 'string') return m;
  try { return JSON.parse(m); } catch { return {}; }
};

/**
 * PG phase-b edge row -> resolved slice edge. Labels come from metadata
 * from_label/to_label (EXACT match, never a union — the dc Book/Volume
 * collision). Verse endpoints resolve by exact PG id; entity endpoints via
 * the house resolveGraphId over entities.metadata->>'neo4j_id'.
 */
export function buildEdgeRow(r) {
  const meta = toObj(r.metadata);
  const fromLabel = meta.from_label;
  const toLabel = meta.to_label;
  if (!SPINE_GRAPH_LABELS.includes(fromLabel) || !SPINE_GRAPH_LABELS.includes(toLabel)) {
    return { invalid: true, reason: 'missing_or_unknown_label', from_id: r.from_id, to_id: r.to_id, rel_type: r.rel_type };
  }
  if (!REL_TYPE_RE.test(String(r.rel_type))) {
    return { invalid: true, reason: 'bad_rel_type', from_id: r.from_id, to_id: r.to_id, rel_type: r.rel_type };
  }
  // chapter-endpoint edges are skipped by design (PG chapter ids never match
  // the graph's legacy '-ch-' ids; the CONTAINS phase owns that class) — so
  // anything chapter-endpoint that is NOT CONTAINS would be silently lost
  // semantic content. Checked invariant, not a comment.
  if ((fromLabel === 'LM_Chapter' || toLabel === 'LM_Chapter') && r.rel_type !== 'CONTAINS') {
    return { invalid: true, reason: 'chapter_endpoint_non_contains', from_id: r.from_id, to_id: r.to_id, rel_type: r.rel_type };
  }
  const props = { ...meta };
  delete props.from_label;
  delete props.to_label;
  props.collection_id = 'phase-b';
  if (!graphSafeProps(props)) {
    return { invalid: true, reason: 'nested_props', from_id: r.from_id, to_id: r.to_id, rel_type: r.rel_type };
  }
  const from = fromLabel === 'LM_Verse' ? r.from_id : resolveGraphId(r.from_id, { neo4j_id: r.from_neo4j_id ?? null });
  const to = toLabel === 'LM_Verse' ? r.to_id : resolveGraphId(r.to_id, { neo4j_id: r.to_neo4j_id ?? null });
  return { fromLabel, toLabel, relType: r.rel_type, from, to, props };
}

export const edgeGroupKey = (e) => `${e.fromLabel}|${e.toLabel}|${e.relType}`;
export const edgeTupleKey = (e) => `${e.from} | ${e.to} | ${e.relType}`;
export const endpointKey = (label, id) => `${label}|${id}`;

/**
 * Batch planner for edge rows: dup tuples (1,578 known in phase-b) must land
 * in the SAME batch, or a rel created in batch N gets MERGE-matched carrying
 * this run's sync_run in batch N+1 and double-counts as created (false
 * overshoot halt). Groups rows by tuple, greedy-fills batches; a tuple group
 * is never split. The last partial batch is always emitted — the exact
 * 19x2000-truncation class that caused this backfill.
 */
export function planEdgeBatches(rows, size = BATCH_SIZE) {
  const byTuple = new Map();
  for (const r of rows) {
    const k = edgeTupleKey(r);
    const list = byTuple.get(k) ?? [];
    list.push(r);
    byTuple.set(k, list);
  }
  const batches = [];
  let current = [];
  // deterministic dup-tuple props: MERGE is first-row-wins, and the PG slice
  // arrives unordered — sort each group so the curated row leads (matching
  // item 3's survivor choice), tie-broken by source string.
  const curatedRank = (r) => (r.props?.source === 'bible-bom-curated' ? 0 : 1);
  for (const group of byTuple.values()) {
    group.sort((a, b) =>
      curatedRank(a) - curatedRank(b)
      || String(a.props?.source ?? '').localeCompare(String(b.props?.source ?? '')));
    if (current.length > 0 && current.length + group.length > size) {
      batches.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Rows the graph write will skip (a MATCH-only endpoint absent from the
 * graph). willExist = Set of `${label}|${id}` covering probed-present
 * endpoints plus the slice verses about to be created. Dup rows of a skipped
 * tuple each count — skips are row-level, mirroring the write.
 */
export function computeExpectedSkips(edgeRows, willExist) {
  let skippedRows = 0;
  const byLabel = {};
  const skippedTupleKeys = new Set();
  for (const e of edgeRows) {
    const missFrom = !willExist.has(endpointKey(e.fromLabel, e.from));
    const missTo = !willExist.has(endpointKey(e.toLabel, e.to));
    if (!missFrom && !missTo) continue;
    skippedRows += 1;
    skippedTupleKeys.add(edgeTupleKey(e));
    for (const [miss, label] of [[missFrom, e.fromLabel], [missTo, e.toLabel]]) {
      if (miss) byLabel[label] = (byLabel[label] ?? 0) + 1;
    }
  }
  return { skippedRows, skippedTuples: skippedTupleKeys.size, byLabel };
}

/**
 * Mandatory stop conditions (write protocol): per-batch created+matched must
 * equal batch size (minus pre-probed expected skips for edge batches), and
 * cumulative created must never exceed the dry-run expectation.
 */
export function classifyBatchOutcome({ batchRows, touchedRows, expectedSkips = 0, cumulativeCreated, expectedCreated }) {
  const reasons = [];
  if (touchedRows + expectedSkips !== batchRows) reasons.push('created_plus_matched_mismatch');
  if (cumulativeCreated > expectedCreated) reasons.push('cumulative_created_overshoot');
  return { halt: reasons.length > 0, reasons };
}

export function unexpectedChapterMissing(missing) {
  return missing.filter((id) => !EXPECTED_MISSING_CHAPTERS.includes(id));
}

export function parseVolumesArg(argv) {
  const raw = argv.find((a) => a.startsWith('--volume='))?.slice(9) ?? 'all';
  if (raw === 'all') return [...VOLUME_ORDER];
  if (!VOLUME_ORDER.includes(raw)) throw new Error(`--volume must be pgp|dc|all, got: ${raw}`);
  return [raw];
}

export function syncRunId(env = {}, now = new Date()) {
  if (env.SYNC_RUN && env.SYNC_RUN.trim()) return env.SYNC_RUN.trim();
  return `spine-${now.toISOString().replace(/[:.]/g, '-')}`;
}

// ---------- Cypher builders (exported for tests; sync_run via ON CREATE SET only) ----------

export const VERSE_STATE_PROBE = `
  UNWIND $ids AS vid
  OPTIONAL MATCH (v:LM_Verse {id: vid})
  RETURN vid AS id, v IS NOT NULL AS present, v.sync_run AS sync_run`;

export const CHAPTER_STATE_PROBE = `
  UNWIND $ids AS cid
  OPTIONAL MATCH (c:LM_Chapter {id: cid})
  RETURN cid AS id, c IS NOT NULL AS present`;

export const VERSE_MERGE = `
  UNWIND $rows AS row
  MERGE (v:LM_Verse {id: row.props.id})
  ON CREATE SET v = row.props, v.sync_run = $syncRun
  RETURN count(v) AS touchedRows,
         count(DISTINCT elementId(v)) AS distinctTouched,
         count(DISTINCT CASE WHEN v.sync_run = $syncRun THEN elementId(v) END) AS createdDistinct`;

export const CHAPTER_MERGE = `
  MERGE (c:LM_Chapter {id: $id})
  ON CREATE SET c.name = $name, c.chapter_number = $chapter_number, c.book_id = $book_id, c.sync_run = $syncRun
  RETURN count(c) AS touchedRows,
         count(DISTINCT elementId(c)) AS distinctTouched,
         count(DISTINCT CASE WHEN c.sync_run = $syncRun THEN elementId(c) END) AS createdDistinct`;

export const CONTAINS_MERGE = `
  UNWIND $rows AS row
  MATCH (c:LM_Chapter {id: row.chapterId})
  MATCH (v:LM_Verse {id: row.verseId})
  MERGE (c)-[r:CONTAINS]->(v)
  ON CREATE SET r.collection_id = 'canon', r.sync_run = $syncRun
  RETURN count(r) AS touchedRows,
         count(DISTINCT elementId(r)) AS distinctTouched,
         count(DISTINCT CASE WHEN r.sync_run = $syncRun THEN elementId(r) END) AS createdDistinct`;

// row-grouped so parallel rels / dup-id nodes never multiply the row count
export const CONTAINS_STATE_PROBE = `
  UNWIND $rows AS row
  OPTIONAL MATCH (c:LM_Chapter {id: row.chapterId})
  OPTIONAL MATCH (v:LM_Verse {id: row.verseId})
  OPTIONAL MATCH (c)-[r:CONTAINS]->(v)
  WITH row, count(DISTINCT c) AS cs, count(DISTINCT v) AS vs, count(r) AS rels
  RETURN count(row) AS total,
         sum(CASE WHEN cs > 0 THEN 1 ELSE 0 END) AS chaptersFound,
         sum(CASE WHEN vs > 0 THEN 1 ELSE 0 END) AS versesFound,
         sum(CASE WHEN rels > 0 THEN 1 ELSE 0 END) AS relsFound`;

export function endpointProbeCypher(label) {
  assertGraphLabel(label);
  return `
  UNWIND $ids AS eid
  OPTIONAL MATCH (n:${label} {id: eid})
  RETURN eid AS id, n IS NOT NULL AS present`;
}

export function edgeMergeCypher(fromLabel, toLabel, relType) {
  assertGraphLabel(fromLabel);
  assertGraphLabel(toLabel);
  assertRelType(relType);
  return `
  UNWIND $rows AS row
  MATCH (a:${fromLabel} {id: row.from})
  MATCH (b:${toLabel} {id: row.to})
  MERGE (a)-[r:${relType}]->(b)
  ON CREATE SET r = row.props, r.sync_run = $syncRun
  RETURN count(r) AS touchedRows,
         count(DISTINCT elementId(r)) AS distinctTouched,
         count(DISTINCT CASE WHEN r.sync_run = $syncRun THEN elementId(r) END) AS createdDistinct`;
}

export function edgeStateProbeCypher(fromLabel, toLabel, relType) {
  assertGraphLabel(fromLabel);
  assertGraphLabel(toLabel);
  assertRelType(relType);
  return `
  UNWIND $tuples AS t
  OPTIONAL MATCH (a:${fromLabel} {id: t.from})-[r:${relType}]->(b:${toLabel} {id: t.to})
  WITH t, count(r) AS rels
  RETURN count(t) AS tuples, sum(CASE WHEN rels > 0 THEN 1 ELSE 0 END) AS existingTuples`;
}

// ---------- probe + phase runners (fake-cypher testable) ----------

export async function probeVerseState(cypher, pgIds, batchSize = BATCH_SIZE) {
  const observed = new Map();
  for (const ids of chunk(pgIds, batchSize)) {
    const rows = await cypher(VERSE_STATE_PROBE, { ids });
    for (const r of rows) observed.set(r.id, { present: !!r.present, sync_run: r.sync_run ?? null });
  }
  return observed;
}

export async function probeIdsPresent(cypher, statement, ids, batchSize = BATCH_SIZE) {
  const present = new Set();
  for (const batch of chunk(ids, batchSize)) {
    const rows = await cypher(statement, { ids: batch });
    for (const r of rows) if (r.present) present.add(r.id);
  }
  return present;
}

/**
 * Run one write phase with the mandatory stop conditions. HALTS IMMEDIATELY
 * (returns, caller exits 2) on any batch error, created+matched mismatch, or
 * cumulative-created overshoot — never continues remaining batches.
 */
export async function runMergePhase({ phase, batches, statement, paramsForBatch, cypher, expectedCreated, expectedSkipsForBatch = () => 0, log = () => {} }) {
  let created = 0;
  let matched = 0;
  let skipped = 0;
  for (let i = 0; i < batches.length; i++) {
    const rows = batches[i];
    let res;
    try {
      [res] = await cypher(statement, paramsForBatch(rows));
    } catch (err) {
      log('phase_batch_error', { phase, batch: i + 1, of: batches.length, message: scrub(err.message) });
      return { halted: true, reason: 'batch_error', batch: i + 1, created, matched, skipped };
    }
    const touched = Number(res?.touchedRows ?? 0);
    const distinctTouched = Number(res?.distinctTouched ?? 0);
    const createdDistinct = Number(res?.createdDistinct ?? 0);
    const expectedSkips = expectedSkipsForBatch(rows, i);
    created += createdDistinct;
    matched += distinctTouched - createdDistinct;
    skipped += rows.length - touched;
    const verdict = classifyBatchOutcome({
      batchRows: rows.length, touchedRows: touched, expectedSkips,
      cumulativeCreated: created, expectedCreated,
    });
    log('phase_batch', {
      phase, batch: i + 1, of: batches.length, rows: rows.length, touched,
      createdDistinct, matchedDistinct: distinctTouched - createdDistinct,
      expectedSkips, halt: verdict.halt, reasons: verdict.reasons,
    });
    if (verdict.halt) return { halted: true, reason: verdict.reasons.join(','), batch: i + 1, created, matched, skipped };
  }
  // end-of-phase exact-match: overshoot is caught per-batch above; UNDERSHOOT
  // is only visible here — the plan's stop condition says 'diverging', not
  // 'exceeding', so a phase that silently created too few halts too.
  if (created !== expectedCreated) {
    log('phase_created_mismatch', {
      phase, expected: expectedCreated, actual: created,
      direction: created < expectedCreated ? 'undershoot' : 'overshoot',
    });
    return { halted: true, reason: 'created_expected_mismatch', created, matched, skipped };
  }
  return { halted: false, created, matched, skipped };
}

// ---------- I/O ----------

const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));

function loadConfig() {
  const wrangler = JSON.parse(readFileSync(join(ROOT, 'apps/web/wrangler.json'), 'utf8'));
  const devVars = readFileSync(join(ROOT, 'apps/web/.dev.vars'), 'utf8');
  const neo4jPassword = devVars.match(/^NEO4J_PASSWORD=(.+)$/m)?.[1]?.trim();
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) throw new Error('root .env with DATABASE_URL required');
  const pgUrl = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
  if (!neo4jPassword || !pgUrl) throw new Error('missing credentials (apps/web/.dev.vars, root .env)');
  return {
    pgUrl,
    neo4jEndpoint: `${wrangler.vars.NEO4J_URI.replace('neo4j+s://', 'https://')}/db/${wrangler.vars.NEO4J_DATABASE}/query/v2`,
    neo4jAuth: 'Basic ' + Buffer.from(`${wrangler.vars.NEO4J_USER}:${neo4jPassword}`).toString('base64'),
  };
}

function makeCypher(cfg) {
  return async (statement, parameters = {}) => {
    const res = await fetch(cfg.neo4jEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: cfg.neo4jAuth },
      body: JSON.stringify({ statement, parameters }),
    });
    const body = await res.json();
    if (!res.ok || body.errors?.length) {
      throw new Error(`neo4j query failed: ${scrub(body.errors?.[0]?.message ?? res.status)}`);
    }
    const fields = body.data?.fields ?? [];
    return (body.data?.values ?? []).map((v) => Object.fromEntries(fields.map((f, i) => [f, v[i]])));
  };
}

async function collectGraphVerseIds(cypher, volumeId, prefixes) {
  const ids = [];
  for (let skip = 0; ; skip += 10000) {
    // stable ORDER BY pagination (house B13)
    const page = await cypher(`
      MATCH (v:LM_Verse)
      WHERE v.volume_id = $vol OR any(p IN $prefixes WHERE v.id STARTS WITH p)
      RETURN v.id AS id ORDER BY id SKIP ${skip} LIMIT 10000`, { vol: volumeId, prefixes });
    for (const r of page) ids.push(r.id);
    if (page.length < 10000) break;
  }
  return ids;
}

// ---------- snapshots (Neo4j escrow-equivalent: per-volume directional counts) ----------

async function volumeSnapshot(cypher, ctx, volumeId) {
  const { prefixes, pgIds } = ctx.volumes[volumeId];
  const graphIds = await collectGraphVerseIds(cypher, volumeId, prefixes);
  const graphSet = new Set(graphIds);
  const pgSet = new Set(pgIds);
  const missingInGraph = pgIds.filter((id) => !graphSet.has(id));
  const orphanedInGraph = graphIds.filter((id) => !pgSet.has(id));
  const [synced] = await cypher(`
    MATCH (v:LM_Verse)
    WHERE (v.volume_id = $vol OR any(p IN $prefixes WHERE v.id STARTS WITH p)) AND v.sync_run IS NOT NULL
    RETURN count(v) AS n`, { vol: volumeId, prefixes });
  const [contains] = await cypher(`
    MATCH (:LM_Chapter)-[r:CONTAINS]->(v:LM_Verse)
    WHERE v.volume_id = $vol OR any(p IN $prefixes WHERE v.id STARTS WITH p)
    RETURN count(r) AS n`, { vol: volumeId, prefixes });
  return {
    pgVerses: pgIds.length,
    graphVerses: graphIds.length,
    graphVersesSyncStamped: Number(synced?.n ?? 0),
    containsRels: Number(contains?.n ?? 0),
    // directional, never netted
    pgNotInGraph: missingInGraph.length,
    graphNotInPg: orphanedInGraph.length,
    pgNotInGraphSample: missingInGraph.slice(0, 10),
    graphNotInPgSample: orphanedInGraph.slice(0, 10),
  };
}

async function writeSnapshot(cypher, ctx, phase, syncRun) {
  try {
    const volumes = {};
    for (const vol of Object.keys(ctx.volumes)) volumes[vol] = await volumeSnapshot(cypher, ctx, vol);
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const file = join(SNAPSHOT_DIR, `${syncRun}-${phase}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify({ sync_run: syncRun, phase, at: new Date().toISOString(), volumes }, null, 1));
    log('snapshot_written', { phase, file, volumes });
    return volumes;
  } catch (err) {
    log('snapshot_failed', { phase, message: scrub(err.message) });
    return null;
  }
}

// ---------- acceptance (read-only) ----------

async function containsCoverage(cypher, rows) {
  let total = 0;
  let covered = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const [res] = await cypher(`
      UNWIND $rows AS row
      OPTIONAL MATCH (c:LM_Chapter {id: row.chapterId})-[r:CONTAINS]->(v:LM_Verse {id: row.verseId})
      WITH row, count(r) AS rels
      RETURN count(row) AS total, sum(CASE WHEN rels > 0 THEN 1 ELSE 0 END) AS covered`,
      { rows: batch.map((r) => ({ chapterId: r.chapterGraphId, verseId: r.props.id })) });
    total += Number(res?.total ?? 0);
    covered += Number(res?.covered ?? 0);
  }
  return { total, covered };
}

async function volumeAcceptance(cypher, ctx, volumeId) {
  const { prefixes, pgRows } = ctx.volumes[volumeId];
  const checks = [];
  const push = (name, pass, detail = {}) => checks.push({ name, pass, ...detail });

  const snap = await volumeSnapshot(cypher, ctx, volumeId);
  push('directional_parity_pg_to_graph', snap.pgNotInGraph === 0, { missing: snap.pgNotInGraph, sample: snap.pgNotInGraphSample });
  push('directional_parity_graph_to_pg', snap.graphNotInPg === 0, { orphaned: snap.graphNotInPg, sample: snap.graphNotInPgSample });

  const [dups] = await cypher(`
    MATCH (v:LM_Verse)
    WHERE v.volume_id = $vol OR any(p IN $prefixes WHERE v.id STARTS WITH p)
    WITH v.id AS id, count(*) AS c WHERE c > 1
    RETURN count(*) AS dupIds`, { vol: volumeId, prefixes });
  push('zero_duplicate_verse_id_label_pairs', Number(dups?.dupIds ?? 0) === 0, { dup_ids: Number(dups?.dupIds ?? 0) });

  const cov = await containsCoverage(cypher, pgRows);
  push('contains_coverage_full_volume', cov.covered === cov.total, cov);

  if (volumeId === 'pgp') {
    const [moses] = await cypher(`MATCH (c:LM_Chapter {id: $id}) RETURN count(c) AS n`, { id: MOSES_CH_1.id });
    push('moses_ch_1_exists_exactly_once', Number(moses?.n ?? 0) === 1, { count: Number(moses?.n ?? 0) });
  }

  if (volumeId === 'dc') {
    push('dc_verse_count_exact', snap.graphVerses === PLAN.dc.pgVerses, { graph: snap.graphVerses, expected: PLAN.dc.pgVerses });

    const [pre] = await cypher(`
      MATCH (v:LM_Verse)
      WHERE (v.volume_id = 'dc' OR v.id STARTS WITH 'dc-') AND v.sync_run IS NULL
      OPTIONAL MATCH (x)-[r:CROSS_REF]->(v)
      RETURN count(DISTINCT v) AS preCount, count(r) AS crossRefs`);
    const [preContains] = await cypher(`
      MATCH (v:LM_Verse)
      WHERE (v.volume_id = 'dc' OR v.id STARTS WITH 'dc-') AND v.sync_run IS NULL
      OPTIONAL MATCH (:LM_Chapter)-[r:CONTAINS]->(v)
      RETURN count(r) AS contains`);
    push('preexisting_294_intact', Number(pre?.preCount ?? 0) === PLAN.dc.preExistingGraphVerses, { pre_count: Number(pre?.preCount ?? 0) });
    push('preexisting_inbound_cross_ref_gte_900', Number(pre?.crossRefs ?? 0) >= 900, { cross_refs: Number(pre?.crossRefs ?? 0) });
    push('preexisting_inbound_contains_gte_294', Number(preContains?.contains ?? 0) >= 294, { contains: Number(preContains?.contains ?? 0) });

    // the dc Book/Volume collision: no double-labeled node, no true graph
    // self-loop, no NEW (sync_run-stamped) cross-type edges between the two
    const [dbl] = await cypher(`MATCH (n:LM_Book {id: 'dc'}) WHERE n:LM_Volume RETURN count(n) AS n`);
    push('zero_double_labeled_dc_nodes', Number(dbl?.n ?? 0) === 0, { count: Number(dbl?.n ?? 0) });
    let selfLoops = 0;
    for (const label of ['LM_Book', 'LM_Volume']) {
      const [sl] = await cypher(`MATCH (a:${label} {id: 'dc'})-[r]->(b:${label} {id: 'dc'}) WHERE a = b RETURN count(r) AS n`);
      selfLoops += Number(sl?.n ?? 0);
    }
    push('zero_graph_self_loops_on_dc', selfLoops === 0, { self_loops: selfLoops });
    const [crossType] = await cypher(`
      MATCH (a:LM_Book {id: 'dc'})-[r]-(b:LM_Volume {id: 'dc'})
      WHERE r.sync_run IS NOT NULL RETURN count(r) AS n`);
    push('zero_new_cross_type_edges_on_dc', Number(crossType?.n ?? 0) === 0, { count: Number(crossType?.n ?? 0) });

    const [twoHop] = await cypher(`MATCH p = (:LM_Verse {id: 'dc-76-22'})-[*1..2]-() RETURN count(p) AS n`);
    push('two_hop_from_dc_76_22_positive', Number(twoHop?.n ?? 0) > 0, { paths: Number(twoHop?.n ?? 0) });
  }

  const pass = checks.every((c) => c.pass);
  log('acceptance', { volume: volumeId, pass, checks });
  return { pass, checks };
}

// ---------- main ----------

async function main() {
  const verifyOnly = process.argv.includes('--verify');
  const commit = !verifyOnly && process.env.COMMIT === '1';
  const mode = verifyOnly ? 'verify' : commit ? 'write' : 'dry-run';
  let scopedVolumes;
  let cfg;
  try {
    scopedVolumes = parseVolumesArg(process.argv);
    cfg = loadConfig();
  } catch (err) {
    console.error('FATAL:', scrub(err.message));
    process.exit(1);
  }
  if (verifyOnly && process.env.COMMIT === '1') log('warn', { note: 'COMMIT=1 ignored: --verify is read-only' });
  const syncRun = syncRunId(process.env);
  const cypher = makeCypher(cfg);
  const require = createRequire(import.meta.url);
  const postgres = require('postgres');
  const sql = postgres(cfg.pgUrl, { prepare: false, max: 1, connection: { statement_timeout: 120000 } });

  let exitCode = 0;
  const halt = async (ctx, reason, detail = {}) => {
    log('halt', { sync_run: syncRun, reason, ...detail });
    if (ctx) await writeSnapshot(cypher, ctx, `halt-${reason}`, syncRun);
    exitCode = 2;
  };

  try {
    await sql`SET default_transaction_read_only = on`; // PG is read-only in every mode
    // the read-only rail is a session GUC — under transaction pooling the SET
    // would silently not persist. Fail-closed probe (canon-spine pattern):
    await sql.unsafe(`SET "lumen.session_probe" = 'spine-sync'`);
    const [sessionProbe] = await sql.unsafe(`SELECT current_setting('lumen.session_probe', true) AS v`);
    if (sessionProbe?.v !== 'spine-sync') {
      throw new Error('connection is not session-mode (SET did not persist) — the read-only GUC cannot be trusted; use the port-5432 session pooler');
    }
    log('spine_sync_start', { mode, volumes: scopedVolumes, sync_run: syncRun, startedAt: new Date().toISOString() });
    log('divergence_note', {
      contains_collection_id: "new CONTAINS stamped collection_id 'canon' + sync_run; legacy CONTAINS from the original build carry 'phase-b' — deliberate divergence per plan item 1",
      chapter_endpoint_slice_edges: 'slice edges targeting PG-style chapter ids are MATCH-only skips (graph chapters are all -ch- form); CONTAINS phase recreates structure via the legacy mapper',
    });

    // ---- PG state (read-only session) ----
    const pgVerseRows = await sql`
      SELECT v.id, v.text, v.reference, v.verse_number,
             c.id AS chapter_id, c.number AS chapter_number, c.book_id,
             b.name AS book_name, b.volume_id
      FROM lumen.verses v
      JOIN lumen.chapters c ON c.id = v.chapter_id
      JOIN lumen.books b ON b.id = c.book_id
      WHERE b.volume_id IN ('dc', 'pgp')
      ORDER BY b.volume_id, c.book_id, c.number, v.verse_number`;
    const pgChapterRows = await sql`
      SELECT c.id, c.number, c.book_id, b.volume_id
      FROM lumen.chapters c JOIN lumen.books b ON b.id = c.book_id
      WHERE b.volume_id IN ('dc', 'pgp') ORDER BY c.book_id, c.number`;
    const pgBookRows = await sql`
      SELECT id, volume_id, name FROM lumen.books WHERE volume_id IN ('dc', 'pgp')`;

    const ctx = { volumes: {} };
    for (const vol of VOLUME_ORDER) {
      const rows = pgVerseRows.filter((r) => r.volume_id === vol).map(buildVerseRow);
      ctx.volumes[vol] = {
        pgRows: rows,
        pgIds: rows.map((r) => r.props.id),
        prefixes: pgBookRows.filter((b) => b.volume_id === vol).map((b) => `${b.id}-`),
        pgChapters: pgChapterRows.filter((c) => c.volume_id === vol),
      };
    }

    // ---- plan pins: PG counts must match the plan exactly (else stale premises) ----
    const pinFailures = [];
    for (const vol of VOLUME_ORDER) {
      const { pgIds, pgChapters } = ctx.volumes[vol];
      if (pgIds.length !== PLAN[vol].pgVerses) pinFailures.push({ vol, pin: 'pg_verses', expected: PLAN[vol].pgVerses, actual: pgIds.length });
      if (pgChapters.length !== PLAN[vol].pgChapters) pinFailures.push({ vol, pin: 'pg_chapters', expected: PLAN[vol].pgChapters, actual: pgChapters.length });
    }
    const referenceMismatches = VOLUME_ORDER.flatMap((vol) => ctx.volumes[vol].pgRows.filter((r) => r.referenceMismatch));
    log('pg_state_loaded', {
      perVolume: Object.fromEntries(VOLUME_ORDER.map((v) => [v, { verses: ctx.volumes[v].pgIds.length, chapters: ctx.volumes[v].pgChapters.length }])),
      planPinFailures: pinFailures,
      referenceMismatches: referenceMismatches.length,
      referenceMismatchSample: referenceMismatches.slice(0, 5).map((r) => r.props.id),
    });
    if (pinFailures.length > 0) {
      await halt(null, 'pg_plan_pin_mismatch', { pinFailures });
      return;
    }

    if (verifyOnly) {
      let allPass = true;
      for (const vol of scopedVolumes) {
        const { pass } = await volumeAcceptance(cypher, ctx, vol);
        if (!pass) allPass = false;
      }
      log('verify_done', { sync_run: syncRun, clean: allPass });
      if (!allPass) exitCode = 2;
      return;
    }

    // ---- graph probes (read-only; establishes every write expectation) ----
    const targets = {};
    for (const vol of scopedVolumes) {
      const observed = await probeVerseState(cypher, ctx.volumes[vol].pgIds);
      const t = classifyVerseTargets(ctx.volumes[vol].pgRows, observed);
      targets[vol] = t;
      log('verse_probe', {
        volume: vol,
        pgVerses: ctx.volumes[vol].pgIds.length,
        wouldCreate: t.toCreate.length,
        wouldMatch: t.preExisting.length + t.syncedPrior.length,
        preExistingNoSyncRun: t.preExisting.length,
        syncedByPriorRun: t.syncedPrior.length,
        sliceVerses: t.sliceRows.length,
      });
      // stable invariant: the untouched pre-existing set never changes size
      if (t.preExisting.length !== PLAN[vol].preExistingGraphVerses) {
        await halt(ctx, 'preexisting_count_mismatch', { volume: vol, expected: PLAN[vol].preExistingGraphVerses, actual: t.preExisting.length });
        return;
      }
    }

    // chapters: every mapped id must exist, except moses-ch-1 (created here)
    const mappedChapterIds = [...new Set(scopedVolumes.flatMap((vol) =>
      ctx.volumes[vol].pgChapters.map((c) => graphChapterId(c.book_id, c.number))))];
    const chaptersPresent = await probeIdsPresent(cypher, CHAPTER_STATE_PROBE, mappedChapterIds);
    const chaptersMissing = mappedChapterIds.filter((id) => !chaptersPresent.has(id));
    const badMissing = unexpectedChapterMissing(chaptersMissing);
    log('chapter_probe', {
      mapped: mappedChapterIds.length, present: chaptersPresent.size,
      missing: chaptersMissing, unexpectedMissing: badMissing,
      wouldCreate: chaptersMissing.length,
    });
    if (badMissing.length > 0) {
      await halt(ctx, 'unexpected_missing_chapters', { unexpectedMissing: badMissing });
      return;
    }

    // CONTAINS expectations per volume (slice rows only — every created verse)
    const containsPlan = {};
    for (const vol of scopedVolumes) {
      const rows = targets[vol].sliceRows.map((r) => ({ chapterId: r.chapterGraphId, verseId: r.props.id }));
      let total = 0;
      let rels = 0;
      for (const batch of chunk(rows, BATCH_SIZE)) {
        const [res] = await cypher(CONTAINS_STATE_PROBE, { rows: batch });
        total += Number(res?.total ?? 0);
        rels += Number(res?.relsFound ?? 0);
      }
      containsPlan[vol] = { rows, expectedCreate: total - rels, existing: rels };
      log('contains_probe', { volume: vol, targetRows: total, wouldCreate: total - rels, wouldMatch: rels });
    }

    // ---- edge slice: PG phase-b edges incident to the slice verse ids ----
    const sliceIds = scopedVolumes.flatMap((vol) => targets[vol].sliceRows.map((r) => r.props.id));
    const sliceIdSet = new Set(sliceIds);
    const pgEdgeRows = sliceIds.length === 0 ? [] : await sql`
      SELECT e.from_id, e.to_id, e.rel_type, e.metadata,
             fe.metadata->>'neo4j_id' AS from_neo4j_id,
             te.metadata->>'neo4j_id' AS to_neo4j_id
      FROM lumen.edges e
      LEFT JOIN lumen.entities fe ON fe.id = e.from_id
      LEFT JOIN lumen.entities te ON te.id = e.to_id
      WHERE e.collection_id = 'phase-b'
        AND (e.from_id = ANY(${sliceIds}) OR e.to_id = ANY(${sliceIds}))`;
    const built = pgEdgeRows.map(buildEdgeRow);
    const invalidEdges = built.filter((e) => e.invalid);
    const edgeRows = built.filter((e) => !e.invalid);
    const byRelType = {};
    for (const e of edgeRows) byRelType[e.relType] = (byRelType[e.relType] ?? 0) + 1;
    log('edge_slice_loaded', {
      pgRows: pgEdgeRows.length, valid: edgeRows.length, invalid: invalidEdges.length,
      invalidSample: invalidEdges.slice(0, 5), byRelType,
    });
    // the chapter-endpoint invariant halts in BOTH modes — a violation means
    // the 'skipping chapter endpoints loses nothing structural' premise is
    // false, and a dry-run must surface that before any COMMIT run.
    const chapterViolations = invalidEdges.filter((e) => e.reason === 'chapter_endpoint_non_contains');
    if (chapterViolations.length > 0) {
      await halt(ctx, 'chapter_endpoint_non_contains', {
        count: chapterViolations.length, sample: chapterViolations.slice(0, 5),
      });
      return;
    }
    if (invalidEdges.length > 0 && commit) {
      await halt(ctx, 'invalid_edge_rows', { invalid: invalidEdges.length });
      return;
    }

    // endpoint existence pre-probe: distinct (id,label) pairs; slice verses
    // will exist by edge-phase time and are exempt from probing
    const endpointsByLabel = new Map();
    for (const e of edgeRows) {
      for (const [label, id] of [[e.fromLabel, e.from], [e.toLabel, e.to]]) {
        if (label === 'LM_Verse' && sliceIdSet.has(id)) continue;
        const set = endpointsByLabel.get(label) ?? new Set();
        set.add(id);
        endpointsByLabel.set(label, set);
      }
    }
    const willExist = new Set(sliceIds.map((id) => endpointKey('LM_Verse', id)));
    const missingEndpointsByLabel = {};
    for (const [label, idSet] of endpointsByLabel) {
      const present = await probeIdsPresent(cypher, endpointProbeCypher(label), [...idSet]);
      for (const id of present) willExist.add(endpointKey(label, id));
      const missing = [...idSet].filter((id) => !present.has(id));
      if (missing.length) missingEndpointsByLabel[label] = { count: missing.length, sample: missing.slice(0, 5) };
    }
    const skipPlan = computeExpectedSkips(edgeRows, willExist);

    // group by (fromLabel, toLabel, relType) for exact-label statements
    const groups = new Map();
    for (const e of edgeRows) {
      const k = edgeGroupKey(e);
      const g = groups.get(k) ?? [];
      g.push(e);
      groups.set(k, g);
    }
    const edgePlan = [];
    for (const key of [...groups.keys()].sort()) {
      const rows = groups.get(key);
      const [fromLabel, toLabel, relType] = key.split('|');
      const tuples = new Map();
      for (const r of rows) if (!tuples.has(edgeTupleKey(r))) tuples.set(edgeTupleKey(r), r);
      const willExistTuples = [...tuples.values()].filter((t) =>
        willExist.has(endpointKey(t.fromLabel, t.from)) && willExist.has(endpointKey(t.toLabel, t.to)));
      let existingTuples = 0;
      for (const batch of chunk(willExistTuples, BATCH_SIZE)) {
        const [res] = await cypher(edgeStateProbeCypher(fromLabel, toLabel, relType),
          { tuples: batch.map((t) => ({ from: t.from, to: t.to })) });
        existingTuples += Number(res?.existingTuples ?? 0);
      }
      edgePlan.push({
        key, fromLabel, toLabel, relType, rows,
        tupleCount: tuples.size, willExistTuples: willExistTuples.length,
        expectedCreate: willExistTuples.length - existingTuples, existingTuples,
      });
    }
    log('edge_slice_expectations', {
      entityNodeCreations: 0, // MATCH-only endpoints: asserted, never MERGEd
      expectedSkippedRows: skipPlan.skippedRows,
      skippedRowsByMissingLabel: skipPlan.byLabel,
      missingEndpointsByLabel,
      groups: edgePlan.map(({ key, rows, tupleCount, willExistTuples, existingTuples, expectedCreate }) => ({
        key, rows: rows.length, tuples: tupleCount, willExistTuples, wouldMatch: existingTuples, wouldCreate: expectedCreate,
      })),
    });

    if (!commit) {
      // counts-only dry-run report
      log('dry_run_done', {
        sync_run: syncRun,
        wouldCreate: {
          ...Object.fromEntries(scopedVolumes.map((v) => [v, {
            LM_Verse: targets[v].toCreate.length,
            CONTAINS: containsPlan[v].expectedCreate,
          }])),
          LM_Chapter: chaptersMissing.length,
          edges: edgePlan.reduce((a, g) => a + g.expectedCreate, 0),
          entityNodes: 0,
        },
        wouldMatch: Object.fromEntries(scopedVolumes.map((v) => [v, {
          LM_Verse: targets[v].preExisting.length + targets[v].syncedPrior.length,
          CONTAINS: containsPlan[v].existing,
        }])),
        expectedEdgeSkips: skipPlan.skippedRows,
        invalidEdgeRows: invalidEdges.length,
      });
      if (invalidEdges.length > 0) exitCode = 2;
      return;
    }

    // ================= WRITE MODE =================
    // Order: PGP verses -> moses-ch-1 -> PGP CONTAINS -> [PGP acceptance
    // gate] -> D&C verses -> D&C CONTAINS -> edge slice. A dc-scoped run
    // still requires the PGP canary acceptance to pass first.
    // pre-write snapshot is the Neo4j escrow-equivalent — fail-CLOSED: no
    // baseline on disk means no recovery reference, so no writes happen.
    const preSnapshot = await writeSnapshot(cypher, ctx, 'pre', syncRun);
    if (!preSnapshot) {
      await halt(ctx, 'pre_snapshot_write_failed');
      return;
    }

    if (!scopedVolumes.includes('pgp')) {
      const gate = await volumeAcceptance(cypher, ctx, 'pgp');
      if (!gate.pass) {
        await halt(ctx, 'pgp_canary_gate_failed_for_dc_run');
        return;
      }
    }

    for (const vol of scopedVolumes) {
      // verses: MERGE the full PG volume set (ON CREATE SET only — the
      // pre-existing set is never modified; matched counts prove it)
      const verseBatches = chunk(ctx.volumes[vol].pgRows, BATCH_SIZE);
      const verseRun = await runMergePhase({
        phase: `${vol}_verses`, batches: verseBatches, statement: VERSE_MERGE,
        paramsForBatch: (rows) => ({ rows: rows.map((r) => ({ props: r.props })), syncRun }),
        cypher, expectedCreated: targets[vol].toCreate.length, log,
      });
      if (verseRun.halted) { await halt(ctx, `verse_phase_halt_${verseRun.reason}`, { volume: vol, ...verseRun }); return; }
      log('phase_done', { phase: `${vol}_verses`, ...verseRun });

      if (vol === 'pgp' && chaptersMissing.includes(MOSES_CH_1.id)) {
        const chapterRun = await runMergePhase({
          phase: 'moses_ch_1', batches: [[MOSES_CH_1]], statement: CHAPTER_MERGE,
          paramsForBatch: () => ({ ...MOSES_CH_1, syncRun }),
          cypher, expectedCreated: 1, log,
        });
        if (chapterRun.halted) { await halt(ctx, `chapter_phase_halt_${chapterRun.reason}`, chapterRun); return; }
        log('phase_done', { phase: 'moses_ch_1', ...chapterRun });
      }

      const containsBatches = chunk(containsPlan[vol].rows, BATCH_SIZE);
      const containsRun = await runMergePhase({
        phase: `${vol}_contains`, batches: containsBatches, statement: CONTAINS_MERGE,
        paramsForBatch: (rows) => ({ rows, syncRun }),
        cypher, expectedCreated: containsPlan[vol].expectedCreate, log,
      });
      if (containsRun.halted) { await halt(ctx, `contains_phase_halt_${containsRun.reason}`, { volume: vol, ...containsRun }); return; }
      log('phase_done', { phase: `${vol}_contains`, ...containsRun });

      if (vol === 'pgp') {
        // canary acceptance gate: D&C phases run only on full pass
        const gate = await volumeAcceptance(cypher, ctx, 'pgp');
        if (!gate.pass) { await halt(ctx, 'pgp_canary_acceptance_failed'); return; }
        log('canary_gate', { pass: true, note: scopedVolumes.includes('dc') ? 'proceeding to D&C automatically' : 'pgp-only run' });
      }
    }

    // edge slice (after all verse/CONTAINS phases)
    let totalSkipped = 0;
    for (const g of edgePlan) {
      const batches = planEdgeBatches(g.rows, BATCH_SIZE);
      const run = await runMergePhase({
        phase: `edges_${g.key}`, batches, statement: edgeMergeCypher(g.fromLabel, g.toLabel, g.relType),
        paramsForBatch: (rows) => ({ rows: rows.map((r) => ({ from: r.from, to: r.to, props: r.props })), syncRun }),
        cypher, expectedCreated: g.expectedCreate,
        expectedSkipsForBatch: (rows) => computeExpectedSkips(rows, willExist).skippedRows,
        log,
      });
      totalSkipped += run.skipped;
      if (run.halted) { await halt(ctx, `edge_phase_halt_${run.reason}`, { group: g.key, ...run }); return; }
      log('phase_done', { phase: `edges_${g.key}`, ...run });
    }
    if (totalSkipped !== skipPlan.skippedRows) {
      await halt(ctx, 'edge_skip_expectation_mismatch', { expected: skipPlan.skippedRows, actual: totalSkipped });
      return;
    }
    log('edge_slice_done', { skippedRows: totalSkipped, expectedSkippedRows: skipPlan.skippedRows, entityNodeCreations: 0 });

    await writeSnapshot(cypher, ctx, 'post', syncRun);

    let allPass = true;
    for (const vol of scopedVolumes) {
      const { pass } = await volumeAcceptance(cypher, ctx, vol);
      if (!pass) allPass = false;
    }
    if (!allPass) exitCode = 2;
    log('spine_sync_done', {
      sync_run: syncRun, clean: allPass, finishedAt: new Date().toISOString(),
      postSyncReminder: 'bump KV key versions vconn:v2->v3 and graph:v1->v2 in scripture.tsx and deploy (write protocol)',
    });
  } catch (err) {
    exitCode = 1;
    log('spine_sync_fatal', { sync_run: syncRun, message: scrub(err.message) });
  } finally {
    await sql.end();
    process.exit(exitCode);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
