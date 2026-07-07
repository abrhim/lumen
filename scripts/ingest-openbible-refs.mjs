// OpenBible.info cross-references → lumen.edges (collection 'openbible').
//   node --import tsx scripts/ingest-openbible-refs.mjs [--dry-run]
//
// Reads the VENDORED TSV (data/openbible/cross_references.txt — never the
// network, SEC-1). Ranges expand to one edge per target verse (gate Q3) with
// metadata {votes, range_start, range_end}; duplicates and self-refs are
// dropped pre-insert with named counts. The ENTIRE delete+insert runs in ONE
// transaction (DATA-1/COR-2 — no half-populated window). Requires the admin
// session-mode DATABASE_URL in repo-root .env (probed, not just port-checked).
//
// DEPLOYMENT ORDER: this ingest runs against prod BEFORE the web deploy of
// the tske-cross-references branch (Bible panels read the collection).
// Exit codes: 0 success, 1 fatal/invariant-abort (incl. FM-11 unmapped cap).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { assertSessionMode, scrub } from './migrate-canon-spine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = join(ROOT, 'data/openbible/cross_references.txt');
const BATCH_SIZE = 5000; // ~120 batches inside one tx; est. 2–4 min (PERF-3)
const UNMAPPED_CAP = 0.005; // FM-11: whole-run ratio over SOURCE rows (COR-5)

/** Known KJV-vs-modern versification drift (gate Q8). Applied to raw OSIS refs
 * before parsing; anything else unmappable counts toward the cap — never
 * clamped, never guessed (COR-1). */
export const VERSIFICATION_EXCEPTIONS = {
  '3John.1.15': '3John.1.14',
  'Rev.12.18': 'Rev.13.1',
};

/**
 * Pure row builder (unit-tested): TSV triplets → edge rows + unmapped refs.
 * - `verseCount(chapterId)` → verse count or null (drives range expansion AND
 *   existence validation — both endpoints must resolve to live verses).
 * - `nextChapter(chapterId)` → following chapter id in canonical order (for
 *   the 18 cross-book ranges, COR-4); optional for same-book ranges.
 */
export function buildEdgeRows(tsvRows, verseCount, nextChapter) {
  const rows = [];
  const unmapped = [];
  const { parseOsisRef, expandOsisRange } = osis();

  const verseExists = (id) => {
    const m = id.match(/^(.*)-(\d+)-(\d+)$/);
    if (!m) return false;
    const count = verseCount(`${m[1]}-${m[2]}`);
    return count !== null && Number(m[3]) >= 1 && Number(m[3]) <= count;
  };

  for (const [fromRaw, toRaw, votesRaw] of tsvRows) {
    const from = VERSIFICATION_EXCEPTIONS[fromRaw] ?? fromRaw;
    const votes = Number(votesRaw);
    if (!Number.isInteger(votes)) {
      unmapped.push(`${fromRaw} -> ${toRaw} (bad votes: ${votesRaw})`);
      continue;
    }
    const fromId = parseOsisRef(from);
    if (!fromId || !verseExists(fromId)) {
      unmapped.push(`${fromRaw} (from)`);
      continue;
    }

    let targets = null;
    let rangeStart = null;
    let rangeEnd = null;
    if (toRaw.includes('-')) {
      const [a, b] = toRaw.split('-');
      const startRef = VERSIFICATION_EXCEPTIONS[a] ?? a;
      const endRef = VERSIFICATION_EXCEPTIONS[b] ?? b;
      targets = expandOsisRange(startRef, endRef, verseCount, nextChapter);
      if (targets && targets.length > 0) {
        // a range containing the citing verse itself: drop the self member
        // BEFORE deriving range_start, or dedup would later orphan the
        // representative row and the whole card would vanish (CCOR-2)
        targets = targets.filter((t) => t !== fromId);
        if (targets.length === 0) targets = null;
      }
      if (targets) {
        rangeStart = targets[0];
        rangeEnd = targets[targets.length - 1];
        if (rangeEnd === rangeStart) { rangeStart = null; rangeEnd = null; targets = [targets[0]]; }
      }
    } else {
      const to = VERSIFICATION_EXCEPTIONS[toRaw] ?? toRaw;
      const toId = parseOsisRef(to);
      targets = toId && verseExists(toId) ? [toId] : null;
    }
    if (!targets) {
      unmapped.push(`${fromRaw} -> ${toRaw} (to)`);
      continue;
    }

    for (const toId of targets) {
      rows.push({
        from_id: fromId,
        to_id: toId,
        metadata: { votes, range_start: rangeStart, range_end: rangeEnd },
      });
    }
  }
  return { rows, unmapped };
}

/** Pure: whole-run unmapped-cap verdict (FM-11/COBS-4) — boundary is exclusive pass. */
export function unmappedCapVerdict(unmappedCount, sourceCount, cap) {
  const ratio = sourceCount === 0 ? 0 : unmappedCount / sourceCount;
  return { ratio: Number(ratio.toFixed(5)), pass: ratio < cap };
}

/** Pure: drop self-refs and duplicate (from,to) pairs keeping max votes (DATA-2/DATA-4). */
export function dedupeEdgeRows(rows) {
  let selfRefs = 0;
  const byPair = new Map();
  for (const r of rows) {
    if (r.from_id === r.to_id) { selfRefs++; continue; }
    const key = `${r.from_id}\t${r.to_id}`;
    const prev = byPair.get(key);
    if (!prev || (r.metadata.votes ?? -Infinity) > (prev.metadata.votes ?? -Infinity)) {
      byPair.set(key, r);
    }
  }
  return { rows: [...byPair.values()], selfRefs, duplicates: rows.length - selfRefs - byPair.size };
}

// tsx-transpiled TS import, resolved lazily so node --test can import this
// file's pure functions without the tsx loader when tests inject their own.
let osisModule = null;
function osis() {
  if (!osisModule) {
    throw new Error('osis module not loaded — call main() or set it in tests');
  }
  return osisModule;
}
export function _setOsisModule(m) { osisModule = m; }

const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const t0 = Date.now();
  log('openbible_ingest_start', { startedAt: new Date().toISOString(), dryRun, dataFile: DATA_FILE });

  // env/URL/client setup inside the scrubbed path — a malformed DSN must never
  // print unredacted (CSEC-1)
  let sql;
  try {
    osisModule = await import(join(ROOT, 'packages/scripture/src/osis-map.ts'));
    const envPath = join(ROOT, '.env');
    if (!existsSync(envPath)) throw new Error('repo-root .env with admin DATABASE_URL required');
    const url = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
    if (!url) throw new Error('DATABASE_URL not found in repo-root .env');
    if (/:6543\b/.test(url)) throw new Error('session-mode connection required (port 5432)');
    const require = createRequire(import.meta.url);
    const postgres = require('postgres');
    sql = postgres(url, { prepare: false, max: 1 });
  } catch (err) {
    log('openbible_ingest_fatal', { message: scrub(err.message) });
    process.exit(1);
  }

  let exitCode = 0;
  try {
    await assertSessionMode(sql);

    // canonical chapter order + verse counts from the spine (ground truth)
    const chapters = await sql`
      SELECT c.id, count(v.id)::int AS verses
      FROM lumen.chapters c
      JOIN lumen.books b ON b.id = c.book_id
      JOIN lumen.volumes vol ON vol.id = b.volume_id
      LEFT JOIN lumen.verses v ON v.chapter_id = c.id
      GROUP BY c.id, vol.sort_order, b.sort_order, c.number
      ORDER BY vol.sort_order, b.sort_order, c.number`;
    const countByChapter = new Map(chapters.map((c) => [c.id, c.verses]));
    const nextByChapter = new Map();
    for (let i = 0; i + 1 < chapters.length; i++) nextByChapter.set(chapters[i].id, chapters[i + 1].id);
    const verseCount = (id) => countByChapter.get(id) ?? null;
    const nextChapter = (id) => nextByChapter.get(id) ?? null;

    const sourceRows = readFileSync(DATA_FILE, 'utf8')
      .split('\n')
      .slice(1) // header
      .filter(Boolean)
      .map((l) => l.split('\t'));
    log('source_loaded', { rows: sourceRows.length });

    const { rows: builtRows, unmapped } = buildEdgeRows(sourceRows, verseCount, nextChapter);
    const verdict = unmappedCapVerdict(unmapped.length, sourceRows.length, UNMAPPED_CAP);
    log('openbible_unmapped_refs', {
      count: unmapped.length,
      ratio: verdict.ratio,
      sample: unmapped.slice(0, 10),
    });
    log('openbible_unmapped_threshold', { ratio: verdict.ratio, cap: UNMAPPED_CAP, pass: verdict.pass });
    if (!verdict.pass) {
      throw new Error(`unmapped ratio ${(verdict.ratio * 100).toFixed(2)}% breaches the ${UNMAPPED_CAP * 100}% cap (FM-11)`);
    }

    const { rows, selfRefs, duplicates } = dedupeEdgeRows(builtRows);
    log('openbible_dedup', { built: builtRows.length, selfRefs, duplicates, final: rows.length });

    // ---- ONE transaction: collection upsert + delete + insert (DATA-1) ----
    let deletedCount = 0;
    await sql.begin(async (tx) => {
      // public visibility explicit, not schema-default (CSEC-5); tier/category
      // self-correct on re-run like every other column (CDATA-3)
      await tx`
        INSERT INTO lumen.collections (id, name, description, tier, category, provenance, license, storage, public)
        VALUES ('openbible', 'OpenBible.info Cross References',
                'Vote-ranked Bible cross-references (openbible.info, adapted: ranges expanded to per-verse edges)',
                'app', 'cross-references', 'openbible.info', 'cc-by-4.0', 'vendored', true)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
          tier = EXCLUDED.tier, category = EXCLUDED.category, provenance = EXCLUDED.provenance,
          license = EXCLUDED.license, storage = EXCLUDED.storage, public = EXCLUDED.public`;

      const deleted = await tx`DELETE FROM lumen.edges WHERE collection_id = 'openbible'`;
      deletedCount = deleted.count;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        await tx`
          INSERT INTO lumen.edges (from_id, to_id, rel_type, collection_id, metadata, source)
          SELECT r.from_id, r.to_id, 'CROSS_REF', 'openbible', r.metadata, 'openbible'
          FROM jsonb_to_recordset(${tx.json(batch)}) AS r(from_id text, to_id text, metadata jsonb)`;
        inserted += batch.length;
      }

      // incoming-direction composite, built AFTER the bulk insert (CPERF-2 —
      // mirrors idx_edges_from_rel; the smoke EXPLAIN checks both directions)
      await tx`CREATE INDEX IF NOT EXISTS idx_edges_to_rel ON lumen.edges (to_id, rel_type)`;

      // in-tx invariant: every endpoint resolves to a live verse
      const [orph] = await tx`
        SELECT count(*)::int AS n FROM lumen.edges e
        WHERE e.collection_id = 'openbible'
          AND (NOT EXISTS (SELECT 1 FROM lumen.verses v WHERE v.id = e.from_id)
            OR NOT EXISTS (SELECT 1 FROM lumen.verses v WHERE v.id = e.to_id))`;
      log('invariant_check', { name: 'openbible_zero_orphan_endpoints', expected: 0, actual: orph.n, pass: orph.n === 0 });
      if (orph.n !== 0) throw new Error('invariant failed: openbible_zero_orphan_endpoints');

      // run marker: smoke compares live count against this (OBS-5 re-run stability)
      await tx`
        INSERT INTO lumen.migration_state (key, value)
        VALUES ('openbible-ingest', ${tx.json({ at: new Date().toISOString(), inserted, deleted: deleted.count, sourceRows: sourceRows.length })})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()`;

      if (dryRun) throw new Error('DRY_RUN_ROLLBACK');
      log('openbible_tx_done', { deleted: deleted.count, inserted });
    }).catch((e) => {
      if (e.message === 'DRY_RUN_ROLLBACK') log('dry_run_rollback', { note: 'all checks passed, nothing committed' });
      else throw e;
    });

    // dry runs report projected write volume too (COBS-3)
    log('openbible_ingest_done', { dryRun, deleted: deletedCount, inserted: rows.length, elapsedMs: Date.now() - t0 });
  } catch (err) {
    exitCode = 1;
    log('openbible_ingest_fatal', { message: scrub(err.message), elapsedMs: Date.now() - t0 });
  } finally {
    await sql.end();
    process.exit(exitCode);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
