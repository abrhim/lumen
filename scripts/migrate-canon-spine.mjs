// Canon-spine migration: normalize scripture structure into FK'd tables.
//   node scripts/migrate-canon-spine.mjs --dry-run                  # full run + checks, then ROLLBACK
//   node scripts/migrate-canon-spine.mjs                            # P1: build spine (one transaction)
//   node scripts/migrate-canon-spine.mjs --drop-transition-columns --confirm  # P4: gated point of no return
//
// DEPLOYMENT ORDER (CCOR-1): the rewritten query layer reads these spine
// tables and the stamped summary metadata. P1 MUST run against prod before
// any web deploy of the canon-spine branch, or every scripture route breaks.
//
// Requires an ADMIN session-mode connection: DATABASE_URL in the repo-root
// .env (port 5432; transaction-mode pooling breaks multi-statement DDL —
// verified at startup by a live probe, not just the port string).
// Exit codes: 0 success, 1 fatal/invariant-abort. Single-runner constraint:
// never run concurrently with any ingest script.
//
// Design: docs/design/canon-spine.md · Plan: docs/features/canon-spine/plan.md
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- pure helpers (unit-tested in scripts/__tests__) ----------

/** Chapters derive from verse ground truth, never from drifted chapter entities. */
export function deriveChapters(verseRows) {
  const byKey = new Map();
  for (const v of verseRows) {
    const key = `${v.book_id} | ${v.chapter_number}`;
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }
  return [...byKey.entries()]
    .map(([key, verse_count]) => {
      const [book_id, n] = key.split(' | ');
      return { id: `${book_id}-${n}`, book_id, number: Number(n), verse_count };
    })
    .sort((a, b) => (a.book_id === b.book_id ? a.number - b.number : a.book_id < b.book_id ? -1 : 1));
}

/** Key-based row diff (order-insensitive) for old-vs-new query parity (FM-6/COR-4). */
export function diffQueryParity(oldRows, newRows, keyField = 'id') {
  const keyOf = (r) => (r && r[keyField] !== undefined ? String(r[keyField]) : JSON.stringify(r));
  const left = new Map(oldRows.map((r) => [keyOf(r), r]));
  const right = new Map(newRows.map((r) => [keyOf(r), r]));
  const diffs = [];
  for (const [k, l] of left) {
    const r = right.get(k);
    if (!r) diffs.push({ key: k, left: l, right: null });
    else if (JSON.stringify(l) !== JSON.stringify(r)) diffs.push({ key: k, left: l, right: r });
  }
  for (const [k, r] of right) if (!left.has(k)) diffs.push({ key: k, left: null, right: r });
  return diffs;
}

export function scrub(message) {
  return String(message)
    .replace(/\b(postgres(?:ql)?|https?):\/\/[^@\s]*@/gi, '$1://<redacted>@')
    .replace(/password=[^&\s]+/gi, 'password=<redacted>');
}

/** P4 preflight (CMIG-2/CSEC-5): irreversible drop needs marker AND --confirm. */
export function p4Preflight(argv, markerRows) {
  if (!argv.includes('--confirm')) {
    return { ok: false, reason: 'P4 refused: pass --confirm to acknowledge the irreversible column drop (plan MIG-8: marker + human confirmation)' };
  }
  if (!markerRows || markerRows.length === 0) {
    return { ok: false, reason: 'P4 refused: no canon-spine-p3-verified marker — run smoke-canon-spine.mjs first' };
  }
  return { ok: true, reason: null };
}

// ---------- I/O ----------

const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));

function loadAdminUrl() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) throw new Error('repo-root .env with admin DATABASE_URL is required (gate Q9)');
  const url = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
  if (!url) throw new Error('DATABASE_URL not found in repo-root .env');
  if (/:6543\b/.test(url)) throw new Error('DATABASE_URL uses port 6543 (transaction-mode pooling) — session mode (5432) is required for this migration');
  return url;
}

// Exported for DDL-shape repro tests (B1/B2/B17/B20 in bugs.md).
export const SPINE_DDL = `
CREATE TABLE IF NOT EXISTS lumen.volumes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  abbrev TEXT,
  tradition TEXT NOT NULL,
  source TEXT,
  sort_order INT NOT NULL,
  UNIQUE (tradition, sort_order)
);
CREATE TABLE IF NOT EXISTS lumen.books (
  id TEXT PRIMARY KEY,
  volume_id TEXT NOT NULL REFERENCES lumen.volumes(id),
  name TEXT NOT NULL,
  abbrev TEXT,
  sort_order INT NOT NULL,
  UNIQUE (volume_id, sort_order)
);
CREATE TABLE IF NOT EXISTS lumen.chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES lumen.books(id),
  number INT NOT NULL CHECK (number > 0),
  UNIQUE (book_id, number)
);
ALTER TABLE lumen.verses ADD COLUMN IF NOT EXISTS chapter_id TEXT;
CREATE TABLE IF NOT EXISTS lumen.words (
  id TEXT PRIMARY KEY,
  verse_id TEXT NOT NULL REFERENCES lumen.verses(id),
  position INT NOT NULL CHECK (position > 0),
  surface TEXT NOT NULL,
  normalized TEXT NOT NULL,
  char_start INT NOT NULL,
  char_end INT NOT NULL,
  UNIQUE (verse_id, position)
);
CREATE TABLE IF NOT EXISTS lumen.migration_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verses_chapter_id ON lumen.verses (chapter_id, verse_number);
CREATE INDEX IF NOT EXISTS idx_chapters_book ON lumen.chapters (book_id, number);
-- words search index is deliberately NOT here: UNIQUE (verse_id, position)
-- already indexes the read path, and idx_words_normalized is created by
-- ingest-words.mjs AFTER the ~1.2M-row bulk load (CPERF-7).
ALTER TABLE lumen.volumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lumen.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE lumen.chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE lumen.words ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS volumes_read ON lumen.volumes;
DROP POLICY IF EXISTS books_read ON lumen.books;
DROP POLICY IF EXISTS chapters_read ON lumen.chapters;
DROP POLICY IF EXISTS words_read ON lumen.words;
CREATE POLICY volumes_read ON lumen.volumes FOR SELECT USING (true);
CREATE POLICY books_read ON lumen.books FOR SELECT USING (true);
CREATE POLICY chapters_read ON lumen.chapters FOR SELECT USING (true);
CREATE POLICY words_read ON lumen.words FOR SELECT USING (true);
GRANT SELECT ON lumen.volumes, lumen.books, lumen.chapters, lumen.words TO lumen_read;
`;

/**
 * Session-mode probe (CMIG-3): a custom GUC set in one top-level statement
 * must be visible in the next. Under transaction-mode pooling the statements
 * can land on different backends and the setting vanishes — the port-string
 * check alone can't catch portless/proxied DSNs.
 */
export async function assertSessionMode(sql) {
  await sql.unsafe(`SET "lumen.session_probe" = 'canon-spine'`);
  const [row] = await sql.unsafe(`SELECT current_setting('lumen.session_probe', true) AS v`);
  if (row?.v !== 'canon-spine') {
    throw new Error('connection is not session-mode (SET did not persist across statements) — use the port-5432 session pooler');
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dropColumns = process.argv.includes('--drop-transition-columns');
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  log('migration_start', { startedAt, dryRun, phase: dropColumns ? 'P4' : 'P1' });

  let sql;
  try {
    const require = createRequire(import.meta.url);
    const postgres = require('postgres');
    sql = postgres(loadAdminUrl(), { prepare: false, max: 1 });
  } catch (err) {
    log('migration_fatal', { message: scrub(err.message) });
    process.exit(1);
  }

  const checks = [];
  const check = (name, expected, actual) => {
    const pass = JSON.stringify(expected) === JSON.stringify(actual);
    checks.push({ name, pass });
    log('invariant_check', { name, expected, actual, pass });
    if (!pass) throw new Error(`invariant failed: ${name}`);
  };

  let exitCode = 0;
  try {
    await assertSessionMode(sql);

    if (dropColumns) {
      // ---- P4: gated point of no return ----
      const marker = await sql`SELECT value FROM lumen.migration_state WHERE key = 'canon-spine-p3-verified'`;
      const preflight = p4Preflight(process.argv, marker);
      if (!preflight.ok) throw new Error(preflight.reason);
      await sql.begin(async (tx) => {
        // re-assert the marker inside the tx (CMIG-5 — no check/act gap)
        const m = await tx`SELECT 1 FROM lumen.migration_state WHERE key = 'canon-spine-p3-verified'`;
        if (m.length === 0) throw new Error('P4 refused: marker vanished between preflight and transaction');
        // plan promise (CDATA-3): structural entities are deprecated in place at P4
        await tx`
          UPDATE lumen.entities
          SET metadata = jsonb_set(metadata, '{deprecated}', 'true'::jsonb)
          WHERE entity_type IN ('volume', 'book', 'chapter')`;
        await tx`ALTER TABLE lumen.verses DROP COLUMN IF EXISTS volume_id`;
        await tx`ALTER TABLE lumen.verses DROP COLUMN IF EXISTS book_id`;
        await tx`ALTER TABLE lumen.verses DROP COLUMN IF EXISTS chapter_number`;
        // audit row (CDATA-6): irreversible op leaves in-DB evidence
        await tx`
          INSERT INTO lumen.migration_state (key, value)
          VALUES ('canon-spine-p4-done', ${tx.json({ at: startedAt })})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()`;
        if (dryRun) throw new Error('DRY_RUN_ROLLBACK');
      }).catch((e) => { if (e.message !== 'DRY_RUN_ROLLBACK') throw e; log('dry_run_rollback', {}); });
      log('migration_done', { phase: 'P4', dryRun, elapsedMs: Date.now() - t0 });
      return;
    }

    // ---- P1: build the spine, one transaction ----
    await sql.begin(async (tx) => {
      // Prod predates canon-spine with a legacy lumen.words (surface_form, no
      // offsets). Replace it ONLY when provably empty — the B1 guarantee (a
      // populated words table is never dropped) must hold, so any rows in a
      // wrong-shape table abort for manual review instead.
      const wordsShape = await tx`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'lumen' AND table_name = 'words'`;
      if (wordsShape.length > 0 && !wordsShape.some((c) => c.column_name === 'char_start')) {
        const legacyRows = await tx`SELECT count(*)::int AS n FROM lumen.words`;
        if (legacyRows[0].n > 0) {
          throw new Error(`legacy lumen.words has ${legacyRows[0].n} rows but the pre-spine shape — refusing to drop; migrate or clear it manually`);
        }
        await tx`DROP TABLE lumen.words`;
        log('legacy_words_replaced', { rows: 0, missingColumn: 'char_start' });
      }

      await tx.unsafe(SPINE_DDL);
      log('ddl_applied', { elapsedMs: Date.now() - t0 });

      // volumes ← entities (tradition = metadata.canon verbatim, per gate Q8)
      const volEntities = await tx`
        SELECT id, name, metadata FROM lumen.entities WHERE entity_type = 'volume'`;
      const badVols = volEntities.filter((v) => !v.metadata?.canon || v.metadata?.sort_order == null);
      check('volumes_metadata_complete', 0, badVols.length);
      for (const v of volEntities) {
        await tx`
          INSERT INTO lumen.volumes (id, name, abbrev, tradition, source, sort_order)
          VALUES (${v.id}, ${v.name}, ${v.metadata.abbrev ?? null}, ${v.metadata.canon}, 'lds-doc-project', ${v.metadata.sort_order})
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, abbrev = EXCLUDED.abbrev,
            tradition = EXCLUDED.tradition, source = EXCLUDED.source, sort_order = EXCLUDED.sort_order`;
      }
      log('volumes_done', { rows: volEntities.length });

      // books ← entities, pre-validated (DATA-8), + the explicit dc row
      const bookEntities = await tx`
        SELECT id, name, metadata FROM lumen.entities WHERE entity_type = 'book'`;
      const badBooks = bookEntities.filter(
        (b) => !b.metadata?.volume_id || b.metadata?.sort_order == null,
      );
      check('books_metadata_complete', 0, badBooks.length);
      for (const b of bookEntities) {
        await tx`
          INSERT INTO lumen.books (id, volume_id, name, abbrev, sort_order)
          VALUES (${b.id}, ${b.metadata.volume_id}, ${b.name}, ${b.metadata.abbrev ?? null}, ${b.metadata.sort_order})
          ON CONFLICT (id) DO UPDATE SET volume_id = EXCLUDED.volume_id, name = EXCLUDED.name,
            abbrev = EXCLUDED.abbrev, sort_order = EXCLUDED.sort_order`;
      }
      await tx`
        INSERT INTO lumen.books (id, volume_id, name, abbrev, sort_order)
        VALUES ('dc', 'dc', 'Doctrine and Covenants', 'D&C', 0)
        ON CONFLICT (id) DO NOTHING`;
      log('books_done', { rows: bookEntities.length + 1 });

      // every verse book must have a book row (the D&C class, checked not assumed)
      const orphanBooks = await tx`
        SELECT DISTINCT v.book_id FROM lumen.verses v
        LEFT JOIN lumen.books b ON b.id = v.book_id WHERE b.id IS NULL`;
      check('every_verse_book_has_book_row', [], orphanBooks.map((r) => r.book_id));

      // chapters ← derived from verses (ground truth); verse_count is NOT
      // stored (gate Q7 — nothing derivable stored)
      const verseKeys = await tx`
        SELECT book_id, chapter_number FROM lumen.verses
        GROUP BY book_id, chapter_number`;
      const chapters = verseKeys.map((r) => ({
        id: `${r.book_id}-${r.chapter_number}`,
        book_id: r.book_id,
        number: r.chapter_number,
      }));
      for (const batch of chunk(chapters, 500)) {
        await tx`
          INSERT INTO lumen.chapters (id, book_id, number)
          SELECT r.id, r.book_id, r.number
          FROM jsonb_to_recordset(${tx.json(batch)}) AS r(id text, book_id text, number int)
          ON CONFLICT (id) DO NOTHING`;
      }
      const chapterCount = await tx`SELECT count(*)::int AS n FROM lumen.chapters`;
      check('chapters_match_distinct_pairs', verseKeys.length, chapterCount[0].n);
      log('chapters_done', { rows: chapterCount[0].n });

      // verses.chapter_id via JOIN to the inserted chapters (DATA-3 — no second concat)
      await tx`
        UPDATE lumen.verses v SET chapter_id = c.id
        FROM lumen.chapters c
        WHERE c.book_id = v.book_id AND c.number = v.chapter_number
          AND v.chapter_id IS DISTINCT FROM c.id`;
      const nullChapter = await tx`SELECT count(*)::int AS n FROM lumen.verses WHERE chapter_id IS NULL`;
      check('verses_chapter_id_backfilled', 0, nullChapter[0].n);
      const notNullAlready = await tx`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'lumen' AND table_name = 'verses' AND column_name = 'chapter_id'`;
      if (notNullAlready[0]?.is_nullable === 'YES') {
        await tx`ALTER TABLE lumen.verses ALTER COLUMN chapter_id SET NOT NULL`;
        await tx`ALTER TABLE lumen.verses ADD CONSTRAINT verses_chapter_fk FOREIGN KEY (chapter_id) REFERENCES lumen.chapters(id)`;
      }
      log('verses_done', { updated: true });

      // volume_id is the ONE verse field whose source table changes (verse row →
      // joined books row) with no by-construction guarantee (CAPI-1). Assert
      // zero drift while the old column still exists to compare against.
      const volDrift = await tx`
        SELECT count(*)::int AS n FROM lumen.verses v
        JOIN lumen.chapters c ON c.id = v.chapter_id
        JOIN lumen.books b ON b.id = c.book_id
        WHERE b.volume_id IS DISTINCT FROM v.volume_id`;
      check('volume_id_parity_via_join', 0, volDrift[0].n);

      // summaries stamped with chapter_id (id convention retires) + resolution
      // check (COR-9). Live ids are PREFIXED: 'summary-1-chr-1' → '1-chr-1'
      // (first dry run failed 1582/1582 on the assumed '-summary' suffix).
      await tx`
        UPDATE lumen.entities
        SET metadata = jsonb_set(metadata, '{chapter_id}', to_jsonb(regexp_replace(id, '^summary-', '')))
        WHERE entity_type = 'chapter_summary'`;
      const orphanSummaries = await tx`
        SELECT count(*)::int AS n FROM lumen.entities e
        WHERE e.entity_type = 'chapter_summary'
          AND NOT EXISTS (SELECT 1 FROM lumen.chapters c WHERE c.id = e.metadata->>'chapter_id')`;
      check('summaries_resolve_to_chapters', 0, orphanSummaries[0].n);

      // lumen.nodes: literal union, ALWAYS including deprecated entities (DATA-1)
      await tx`
        CREATE OR REPLACE VIEW lumen.nodes AS
          SELECT id, 'volume'::text AS kind, name FROM lumen.volumes
          UNION ALL SELECT id, 'book', name FROM lumen.books
          UNION ALL SELECT id, 'chapter', id FROM lumen.chapters
          UNION ALL SELECT id, 'verse', reference FROM lumen.verses
          UNION ALL SELECT id, 'word', surface FROM lumen.words
          UNION ALL SELECT id, entity_type, name FROM lumen.entities
        -- contract (CDATA-2): existence/id-lookup only. Structural ids (volumes/
        -- books/chapters) return MULTIPLE rows — the spine row plus the retained
        -- deprecated entity — with no ordering guarantee. Consumers must never
        -- assume one row per id, and must re-apply collection visibility.`;
      await tx`GRANT SELECT ON lumen.nodes TO lumen_read`;

      // parity checks (FM-6): old SQL vs new SQL, key-based
      const parityPairs = [
        ['getVolumeList',
          tx`SELECT id, name FROM lumen.entities WHERE entity_type = 'volume' ORDER BY id`,
          tx`SELECT id, name FROM lumen.volumes ORDER BY id`],
        ['getChapterNumbers_1ne',
          tx`SELECT DISTINCT chapter_number AS n FROM lumen.verses WHERE book_id = '1-ne' ORDER BY chapter_number`,
          tx`SELECT number AS n FROM lumen.chapters WHERE book_id = '1-ne' ORDER BY number`],
        ['getVersesByChapter_1ne3',
          tx`SELECT id, text FROM lumen.verses WHERE book_id = '1-ne' AND chapter_number = 3`,
          tx`SELECT id, text FROM lumen.verses WHERE chapter_id = '1-ne-3'`],
        ['books_table',
          tx`SELECT id FROM lumen.entities WHERE entity_type = 'book'
             UNION SELECT 'dc' ORDER BY id`,
          tx`SELECT id FROM lumen.books ORDER BY id`],
        ['getBooksByVolume_ot',
          tx`SELECT id, name FROM lumen.entities
             WHERE entity_type = 'book' AND metadata->>'volume_id' = 'ot' ORDER BY id`,
          tx`SELECT id, name FROM lumen.books WHERE volume_id = 'ot' ORDER BY id`],
        ['getPassage_1ne3_1_to_4_5',
          tx`SELECT id FROM lumen.verses
             WHERE book_id = '1-ne'
               AND (chapter_number, verse_number) >= (3, 1)
               AND (chapter_number, verse_number) <= (4, 5)`,
          tx`SELECT v.id FROM lumen.verses v
             JOIN lumen.chapters c ON c.id = v.chapter_id
             WHERE c.book_id = '1-ne'
               AND (c.number, v.verse_number) >= (3, 1)
               AND (c.number, v.verse_number) <= (4, 5)`],
        ['searchScriptures_faith_bom',
          tx`SELECT id FROM lumen.verses
             WHERE search_vector @@ plainto_tsquery('english', 'faith') AND volume_id = 'bom'`,
          tx`SELECT v.id FROM lumen.verses v
             JOIN lumen.chapters c ON c.id = v.chapter_id
             JOIN lumen.books b ON b.id = c.book_id
             WHERE v.search_vector @@ plainto_tsquery('english', 'faith') AND b.volume_id = 'bom'`],
      ];
      for (const [name, oldQ, newQ] of parityPairs) {
        const [oldRows, newRows] = await Promise.all([oldQ, newQ]);
        const diffs = diffQueryParity(oldRows, newRows, 'id' in (oldRows[0] ?? {}) ? 'id' : 'n');
        log('query_parity', { query: name, mismatchCount: diffs.length, sample: diffs.slice(0, 5) });
        check(`parity_${name}`, 0, diffs.length);
      }

      // any P1 re-run re-mutates spine state, so the P3 verification is void
      // until smoke passes again (CSEC-5/CDATA-5, sans hash machinery)
      await tx`DELETE FROM lumen.migration_state WHERE key = 'canon-spine-p3-verified'`;
      await tx`
        INSERT INTO lumen.migration_state (key, value)
        VALUES ('canon-spine-p1', ${tx.json({ at: startedAt, dryRun, checks: checks.length })})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()`;

      if (dryRun) throw new Error('DRY_RUN_ROLLBACK');
    }).catch((e) => {
      if (e.message === 'DRY_RUN_ROLLBACK') log('dry_run_rollback', { note: 'full run executed, all checks passed, nothing committed' });
      else throw e;
    });

    log('migration_done', {
      phase: 'P1', dryRun, startedAt, finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - t0, checks: checks.length, allPassed: checks.every((c) => c.pass),
    });
  } catch (err) {
    exitCode = 1;
    log('migration_fatal', { message: scrub(err.message), elapsedMs: Date.now() - t0 });
  } finally {
    await sql.end();
    process.exit(exitCode);
  }
}

export function chunk(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
