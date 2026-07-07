// One-time alignment of lumen.edges endpoints to canon-spine ids.
//   node scripts/align-edge-chapter-ids.mjs [--dry-run]
//
// Two drift classes (found by smoke-canon-spine's edge check, 2026-07-07):
//  1. chapter endpoints in the retired 'X-ch-N' convention → spine 'X-N'
//     (41,042 endpoints; verified 100% resolve post-alignment)
//  2. four stale phase-b edges using long-form book ids
//     (joseph-smith-matthew → js-m, joseph-smith-history → js-h)
//
// Only endpoints that resolve NOWHERE in lumen.nodes are touched; any aligned
// row that would duplicate an existing edge is deleted instead of updated.
// Exit codes: 0 success, 1 fatal/invariant-abort.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { assertSessionMode, scrub } from './migrate-canon-spine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));

const envPath = join(ROOT, '.env');
if (!existsSync(envPath)) { console.error('root .env with DATABASE_URL required'); process.exit(1); }
const url = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
const require = createRequire(import.meta.url);
const postgres = require('postgres');
const sql = postgres(url, { prepare: false, max: 1 });

const dryRun = process.argv.includes('--dry-run');
const t0 = Date.now();
log('edge_align_start', { dryRun });

// endpoint is an orphan: resolves in none of the six lumen.nodes sources
const ORPHAN = (col) => `
  NOT EXISTS (SELECT 1 FROM lumen.volumes t WHERE t.id = e.${col})
  AND NOT EXISTS (SELECT 1 FROM lumen.books t WHERE t.id = e.${col})
  AND NOT EXISTS (SELECT 1 FROM lumen.chapters t WHERE t.id = e.${col})
  AND NOT EXISTS (SELECT 1 FROM lumen.verses t WHERE t.id = e.${col})
  AND NOT EXISTS (SELECT 1 FROM lumen.words t WHERE t.id = e.${col})
  AND NOT EXISTS (SELECT 1 FROM lumen.entities t WHERE t.id = e.${col})`;

let exitCode = 0;
try {
  await assertSessionMode(sql);

  await sql.begin(async (tx) => {
    // 1. long-form book ids (covers 'joseph-smith-matthew-ch-1' too — the
    //    -ch- alignment below then finishes those)
    const longform = await tx.unsafe(`
      UPDATE lumen.edges e SET
        from_id = replace(replace(from_id, 'joseph-smith-matthew', 'js-m'), 'joseph-smith-history', 'js-h'),
        to_id   = replace(replace(to_id,   'joseph-smith-matthew', 'js-m'), 'joseph-smith-history', 'js-h')
      WHERE from_id LIKE 'joseph-smith-%' OR to_id LIKE 'joseph-smith-%'`);
    log('longform_ids_fixed', { rows: longform.count });

    // 2a. delete orphan -ch-N rows whose aligned triple already exists
    for (const col of ['from_id', 'to_id']) {
      const dups = await tx.unsafe(`
        DELETE FROM lumen.edges e
        WHERE e.${col} ~ '-ch-\\d+$' AND ${ORPHAN(col)}
          AND EXISTS (
            SELECT 1 FROM lumen.edges d
            WHERE d.rel_type = e.rel_type
              AND d.from_id = CASE WHEN '${col}' = 'from_id' THEN regexp_replace(e.from_id, '-ch-(\\d+)$', '-\\1') ELSE e.from_id END
              AND d.to_id   = CASE WHEN '${col}' = 'to_id'   THEN regexp_replace(e.to_id,   '-ch-(\\d+)$', '-\\1') ELSE e.to_id END)`);
      log('duplicate_old_style_deleted', { column: col, rows: dups.count });
    }

    // 2b. align the rest
    for (const col of ['from_id', 'to_id']) {
      const upd = await tx.unsafe(`
        UPDATE lumen.edges e SET ${col} = regexp_replace(e.${col}, '-ch-(\\d+)$', '-\\1')
        WHERE e.${col} ~ '-ch-\\d+$' AND ${ORPHAN(col)}`);
      log('chapter_ids_aligned', { column: col, rows: upd.count });
    }

    // invariant: zero orphan endpoints remain, either direction
    for (const col of ['from_id', 'to_id']) {
      const [orph] = await tx.unsafe(`SELECT count(*)::int AS n FROM lumen.edges e WHERE ${ORPHAN(col)}`);
      log('invariant_check', { name: `zero_orphans_${col}`, expected: 0, actual: orph.n, pass: orph.n === 0 });
      if (orph.n !== 0) throw new Error(`invariant failed: zero_orphans_${col}`);
    }

    if (dryRun) throw new Error('DRY_RUN_ROLLBACK');
  }).catch((e) => {
    if (e.message === 'DRY_RUN_ROLLBACK') log('dry_run_rollback', { note: 'all checks passed, nothing committed' });
    else throw e;
  });

  log('edge_align_done', { dryRun, elapsedMs: Date.now() - t0 });
} catch (err) {
  exitCode = 1;
  log('edge_align_fatal', { message: scrub(err.message), elapsedMs: Date.now() - t0 });
} finally {
  await sql.end();
  process.exit(exitCode);
}
