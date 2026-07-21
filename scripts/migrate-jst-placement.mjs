// Migration (remediation v2 item 4, per D1): stamp the 427 dangling JST
// entities — collection 'jst', metadata verse_id resolving to no lumen.verses
// row, verse number BEYOND the chapter's canonical end — with
//   metadata.placement       = 'beyond_canon_end'
//   metadata.anchor_verse_id = '<chapter_id>-<canonical max verse>'
// A placement hint, not a semantic claim (D1: true JST<->KJV alignment is a
// separate effort). Anything dangling that is NOT beyond-chapter-end is
// CORRUPTION -> halt exit 2, nothing written.
//
// House style: full-row JSON escrow BEFORE the tx, DRY_RUN default via thrown
// rollback (the dry-run runs the real UPDATE + every in-tx invariant, then
// rolls back — the reported would-touch count is exact), COMMIT=1 applies,
// in-tx invariants ABORT on mismatch, JSON-event logging, scrubSecrets.
//   node --import tsx scripts/migrate-jst-placement.mjs            # dry-run
//   COMMIT=1 node --import tsx scripts/migrate-jst-placement.mjs  # apply
// Exit 0 clean, 1 fatal, 2 corruption / count divergence / invariant failure.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scrubSecrets } from './ingest-podcast/util.mjs';
import { JST_DANGLING_SPLIT_SQL } from './stress-test-data.mjs';

// Plan expectation (remediation-plan.md item 4 / D1, re-verified 2026-07-20).
// Stop condition: any divergence from this count halts before COMMIT.
export const EXPECTED_TARGETS = 427;
export const PLACEMENT = 'beyond_canon_end';

// ── pure helpers (unit-tested) ──────────────────────────────────────────────

/** '<chapter_id>-<max canonical verse>' — e.g. anchorVerseId('gen-1', 31) =
 * 'gen-1-31', the anchor for jst-gen-1-32. Throws rather than mint a fake
 * anchor from bad input. */
export function anchorVerseId(chapterId, maxVerse) {
	if (typeof chapterId !== 'string' || chapterId.length === 0) {
		throw new Error(`anchorVerseId: bad chapterId ${JSON.stringify(chapterId)}`);
	}
	const n = Number(maxVerse);
	if (maxVerse == null || !Number.isInteger(n) || n < 1) {
		throw new Error(`anchorVerseId: bad maxVerse ${JSON.stringify(maxVerse)}`);
	}
	return `${chapterId}-${n}`;
}

/** Mirrors JST_DANGLING_SPLIT_SQL's additions/corrupt split, STRICTER on
 * NULLs: the SQL's FILTER clauses leave NULL comparisons (unparseable verse
 * number) counted in neither bucket; here every row lands somewhere, and
 * anything not provably beyond-chapter-end is corrupt. Rows need
 * { vnum, mx } (numbers or pg text-mode strings). */
export function splitDangling(rows) {
	const additions = [];
	const corrupt = [];
	for (const row of rows) {
		const vnum = Number(row.vnum);
		const mx = Number(row.mx);
		const isAddition =
			row.vnum != null && row.mx != null &&
			Number.isInteger(vnum) && Number.isInteger(mx) && vnum > mx;
		(isAddition ? additions : corrupt).push(row);
	}
	return { additions, corrupt };
}

/** Escrow document: throws unless the row set is exactly the expected size
 * and every row carries a restore-capable full row image (entities has PK
 * id — restore = UPDATE metadata from row_image by id). */
export function buildEscrow(rows, { expected, script = 'migrate-jst-placement.mjs', createdAt = new Date().toISOString() } = {}) {
	if (!Number.isInteger(expected)) throw new Error('buildEscrow: expected count required');
	if (rows.length !== expected) throw new Error(`escrow count ${rows.length} != expected ${expected}`);
	for (const r of rows) {
		if (!r.row_image || typeof r.row_image !== 'object') {
			throw new Error(`escrow row ${r.id}: missing full row_image`);
		}
		if (!r.row_image.metadata || typeof r.row_image.metadata !== 'object') {
			throw new Error(`escrow row ${r.id}: row_image.metadata not an object — restore would be lossy`);
		}
	}
	return {
		script,
		created_at: createdAt,
		expected,
		count: rows.length,
		restore_hint: 'lumen.entities has PK id — restore: per row, UPDATE lumen.entities SET metadata = <row_image.metadata> WHERE id = <id>',
		rows,
	};
}

// ── SQL (exported for tests; CTEs mirror JST_DANGLING_SPLIT_SQL verbatim) ───

// Row-level mirror of the harness split: the imported aggregate is the
// pre-flight gate; this one carries to_jsonb(e) full row images for escrow.
export const JST_TARGET_ROWS_SQL = `
WITH dangling AS (
  SELECT e.id, e.metadata->>'verse_id' vid, to_jsonb(e) row_image
  FROM lumen.entities e
  LEFT JOIN lumen.verses v ON v.id = e.metadata->>'verse_id'
  WHERE e.collection_id = 'jst' AND v.id IS NULL),
parsed AS (
  SELECT id, vid, row_image, regexp_replace(vid, '-[0-9]+$', '') chap,
         (regexp_match(vid, '-([0-9]+)$'))[1]::int vnum FROM dangling),
chapmax AS (
  SELECT chapter_id, max((regexp_match(id, '-([0-9]+)$'))[1]::int) mx
  FROM lumen.verses GROUP BY 1)
SELECT p.id, p.vid, p.chap, p.vnum, cm.mx, p.row_image
FROM parsed p LEFT JOIN chapmax cm ON cm.chapter_id = p.chap
ORDER BY p.id`;

// Stamp via jsonb || merge (SET, never REPLACE — every other metadata key
// survives); the anchor is derived IN SQL from lumen.verses chapmax. The
// targets CTE takes ONLY the additions branch (INNER JOIN chapmax = mx
// non-null, vnum > mx); the corrupt branch can never reach this statement —
// pre-flight aborts first.
export const JST_STAMP_UPDATE_SQL = `
WITH dangling AS (
  SELECT e.id, e.metadata->>'verse_id' vid
  FROM lumen.entities e
  LEFT JOIN lumen.verses v ON v.id = e.metadata->>'verse_id'
  WHERE e.collection_id = 'jst' AND v.id IS NULL),
parsed AS (
  SELECT id, regexp_replace(vid, '-[0-9]+$', '') chap,
         (regexp_match(vid, '-([0-9]+)$'))[1]::int vnum FROM dangling),
chapmax AS (
  SELECT chapter_id, max((regexp_match(id, '-([0-9]+)$'))[1]::int) mx
  FROM lumen.verses GROUP BY 1),
targets AS (
  SELECT p.id, p.chap, cm.mx
  FROM parsed p JOIN chapmax cm ON cm.chapter_id = p.chap
  WHERE p.vnum > cm.mx)
UPDATE lumen.entities e
SET metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object(
  'placement', '${PLACEMENT}',
  'anchor_verse_id', t.chap || '-' || t.mx::text)
FROM targets t
WHERE e.id = t.id AND e.collection_id = 'jst'
RETURNING e.id, e.metadata->>'placement' placement, e.metadata->>'anchor_verse_id' anchor`;

// In-tx invariant: 0 rows where placement stamped but anchor missing.
export const STAMPED_WITHOUT_ANCHOR_SQL = `
SELECT count(*)::int n FROM lumen.entities
WHERE collection_id = 'jst' AND metadata->>'placement' = '${PLACEMENT}'
  AND nullif(metadata->>'anchor_verse_id', '') IS NULL`;

// In-tx invariant: post-count of unanchored beyond-canon-end danglers == 0
// (the condition the sweep's I11 pin flips to hard-zero on).
export const POST_UNANCHORED_SQL = `
WITH dangling AS (
  SELECT e.id, e.metadata->>'verse_id' vid, e.metadata meta
  FROM lumen.entities e
  LEFT JOIN lumen.verses v ON v.id = e.metadata->>'verse_id'
  WHERE e.collection_id = 'jst' AND v.id IS NULL),
parsed AS (
  SELECT id, meta, regexp_replace(vid, '-[0-9]+$', '') chap,
         (regexp_match(vid, '-([0-9]+)$'))[1]::int vnum FROM dangling),
chapmax AS (
  SELECT chapter_id, max((regexp_match(id, '-([0-9]+)$'))[1]::int) mx
  FROM lumen.verses GROUP BY 1)
SELECT count(*)::int n
FROM parsed p JOIN chapmax cm ON cm.chapter_id = p.chap
WHERE p.vnum > cm.mx
  AND (p.meta->>'placement' IS DISTINCT FROM '${PLACEMENT}'
       OR nullif(p.meta->>'anchor_verse_id', '') IS NULL)`;

// In-tx invariant: every stamped anchor resolves to a REAL canonical verse
// (the semantic point of the anchor).
export const ANCHOR_RESOLVES_SQL = `
SELECT count(*)::int n FROM lumen.entities e
WHERE e.collection_id = 'jst' AND e.metadata->>'anchor_verse_id' IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM lumen.verses v WHERE v.id = e.metadata->>'anchor_verse_id')`;

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
	const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
	const commit = process.env.COMMIT === '1';
	let sql;
	try {
		const envPath = join(ROOT, '.env');
		if (!existsSync(envPath)) throw new Error('root .env with DATABASE_URL required');
		const url = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
		if (!url) throw new Error('DATABASE_URL not found in root .env');
		const require = createRequire(import.meta.url);
		const postgres = require('postgres');
		sql = postgres(url, {
			prepare: false,
			max: 1,
			connection: { statement_timeout: 120000 },
		});
	} catch (err) {
		console.error('FATAL:', scrubSecrets(err.message));
		process.exit(1);
	}

	try {
		// 1. Pre-flight gate: the harness's own aggregate split. NOTE the SQL
		// FILTERs leave unparseable-verse-number rows in NEITHER bucket, so the
		// total===EXPECTED check also closes that hole (a hidden row would make
		// total > additions + corrupt).
		const [split] = await sql.unsafe(JST_DANGLING_SPLIT_SQL);
		const total = Number(split.total);
		const additionsN = Number(split.additions);
		const corruptN = Number(split.corrupt);
		console.log(JSON.stringify({ event: 'preflight_split', total, additions: additionsN, corrupt: corruptN, expected: EXPECTED_TARGETS }));
		if (corruptN !== 0) {
			console.error(`CORRUPTION: ${corruptN} dangling jst rows are NOT beyond-chapter-end — halting, nothing written`);
			await sql.end();
			process.exit(2);
		}
		if (additionsN !== EXPECTED_TARGETS || total !== EXPECTED_TARGETS) {
			console.error(`COUNT DIVERGENCE: additions=${additionsN} total=${total}, plan expects exactly ${EXPECTED_TARGETS} — halting, nothing written`);
			await sql.end();
			process.exit(2);
		}

		// 2. Row-level fetch + client-side classifier (stricter than the SQL).
		const rows = await sql.unsafe(JST_TARGET_ROWS_SQL);
		const { additions: targetRows, corrupt: corruptRows } = splitDangling(rows);
		if (corruptRows.length !== 0 || targetRows.length !== EXPECTED_TARGETS) {
			console.error(`CLASSIFIER MISMATCH: client split additions=${targetRows.length} corrupt=${corruptRows.length} (expected ${EXPECTED_TARGETS}/0) — halting, nothing written`);
			await sql.end();
			process.exit(2);
		}

		// 3. Escrow full row images BEFORE the tx (both modes — a dry-run must
		// surface escrow-serialization failures before any COMMIT run).
		const escrow = buildEscrow(targetRows, { expected: EXPECTED_TARGETS });
		// data/* is gitignored — prod row images never land in git (house
		// convention shared with migrate-entity-rename.mjs)
		const escrowDir = join(ROOT, 'data', 'escrow');
		mkdirSync(escrowDir, { recursive: true });
		const escrowPath = join(escrowDir, `jst-placement-${escrow.created_at.replace(/[:.]/g, '-')}.json`);
		writeFileSync(escrowPath, JSON.stringify(escrow, null, 1));
		console.log(JSON.stringify({ event: 'escrow_written', path: escrowPath, rows: escrow.count }));

		// 4. Would-touch report: exact count + 10 samples with derived anchors.
		const samples = targetRows.slice(0, 10).map((r) => ({
			id: r.id,
			verse_id: r.vid,
			chapter: r.chap,
			verse_num: Number(r.vnum),
			chapter_max: Number(r.mx),
			anchor: anchorVerseId(r.chap, r.mx),
		}));
		console.log(JSON.stringify({ event: 'would_touch', count: targetRows.length, samples }));

		// 5. Single tx: UPDATE + in-tx invariants; DRY_RUN rolls back at the end
		// so the dry-run exercises the REAL statement and every invariant.
		const escrowIds = new Set(targetRows.map((r) => r.id));
		const anchorById = new Map(targetRows.map((r) => [r.id, anchorVerseId(r.chap, r.mx)]));
		try {
			await sql.begin(async (tx) => {
				const updated = await tx.unsafe(JST_STAMP_UPDATE_SQL);
				console.log(JSON.stringify({ event: 'updated', count: updated.count }));
				if (updated.count !== EXPECTED_TARGETS) {
					throw new Error(`INVARIANT: updated ${updated.count} rows, expected exactly ${EXPECTED_TARGETS}`);
				}
				if (updated.length !== escrowIds.size || updated.some((r) => !escrowIds.has(r.id))) {
					throw new Error('INVARIANT: updated id set != escrowed id set');
				}
				// Behavior parity: the SQL-derived stamp must equal the unit-tested
				// client derivation, row by row.
				const badStamp = updated.filter((r) => r.placement !== PLACEMENT || r.anchor !== anchorById.get(r.id));
				if (badStamp.length !== 0) {
					throw new Error(`INVARIANT: ${badStamp.length} rows stamped with wrong placement/anchor (first: ${JSON.stringify({ id: badStamp[0].id, placement: badStamp[0].placement, anchor: badStamp[0].anchor })})`);
				}
				for (const [name, text] of [
					['stamped_without_anchor', STAMPED_WITHOUT_ANCHOR_SQL],
					['post_unanchored_danglers', POST_UNANCHORED_SQL],
					['anchor_not_resolving', ANCHOR_RESOLVES_SQL],
				]) {
					const [{ n }] = await tx.unsafe(text);
					console.log(JSON.stringify({ event: 'in_tx_invariant', name, violations: Number(n) }));
					if (Number(n) !== 0) throw new Error(`INVARIANT: ${name} = ${n}, expected 0`);
				}
				if (!commit) throw new Error('DRY_RUN_ROLLBACK');
			});
			console.log(JSON.stringify({ event: 'migration_applied', commit: true, updated: EXPECTED_TARGETS, escrow: escrowPath }));
		} catch (err) {
			if (err.message === 'DRY_RUN_ROLLBACK') {
				console.log(JSON.stringify({ event: 'migration_dry_run_ok', commit: false, would_update: EXPECTED_TARGETS, escrow: escrowPath }));
			} else if (err.message.startsWith('INVARIANT')) {
				console.error('INVARIANT FAILURE (rolled back):', scrubSecrets(err.message));
				await sql.end();
				process.exit(2);
			} else {
				throw err;
			}
		}
		await sql.end();
		console.log(JSON.stringify({ event: 'migration_done', commit }));
	} catch (err) {
		console.error('FATAL:', scrubSecrets(err.message));
		await sql.end();
		process.exit(1);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
