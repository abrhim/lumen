// Migration (remediation v2 item 3): phase-b duplicate edge tuples — provenance
// MERGE. Verified anatomy (2026-07-20, full population): exactly 1,578 groups of
// (from_id, to_id, rel_type) × exactly 2 rows each, every group pairing
// metadata.source 'ai-generated' (carries reason + relationship) with
// 'bible-bom-curated' (carries neither). "Keep the richest" would delete
// curation provenance — REFUTED; the merge keeps the curated row as survivor.
//
// Pre-flight (runs in DRY_RUN too): full-population dup-group aggregates must
// match the verified anatomy EXACTLY (1,578 groups, all 2-row, all
// ai+curated pairs; rel_type composition reported). ANY divergence → halt
// exit 2 before any COMMIT (the plan's stop condition).
// Escrow: full row images (to_jsonb — every column, drift-immune) of all
// 3,156 dup-group rows to data/escrow/ (gitignored) BEFORE the tx. edges has
// no PK: restore = delete group by natural key + reinsert images
// (buildRestorePlan/restoreStatements below encode that plan).
// One tx: SELECT ... FOR UPDATE (ctid logged only — never a restore key) →
// re-verify 1+1 shape in-tx → survivor UPDATE (curated row gains the AI
// row's reason/relationship + metadata.sources) → DELETE the AI row by
// predicate → in-tx invariants (1,578 updates, 1,578 deletes, counts ==
// escrow group sizes, 0 dup groups remaining) → CREATE UNIQUE INDEX
// idx_edges_phaseb_unique INSIDE the same tx (dups gone → index valid → zero
// corruption window). idx_edges_unshaken_unique is NEVER touched
// (ingest-podcast/load.mjs ON CONFLICT arbiter) — asserted still present.
//
//   node --import tsx scripts/migrate-phaseb-dedupe.mjs            # dry-run
//   COMMIT=1 node --import tsx scripts/migrate-phaseb-dedupe.mjs  # apply
// Exit 0 success/dry-run clean, 1 fatal, 2 pre-flight divergence or
// invariant abort. Runs only inside a no-ingest/no-backfill window.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scrubSecrets } from './ingest-podcast/util.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// data/* is gitignored — prod row images never land in git (item 7 precedent)
const ESCROW_DIR = join(ROOT, 'data', 'escrow');

// ── expectations (the plan's numbers — divergence halts) ────────────────────

export const EXPECTED_DUP_GROUPS = 1578;
/** metadata->>'source' pair every group must carry, SORTED. */
export const SOURCE_PAIR = ['ai-generated', 'bible-bom-curated'];
/** Canonical survivor stamp — curated first. The writer's in-memory collapse
 * (backfill-phase-b.ts) imports this to produce the identical DB shape. */
export const MERGED_SOURCES = ['bible-bom-curated', 'ai-generated'];
export const PHASEB_INDEX_NAME = 'idx_edges_phaseb_unique';
export const UNSHAKEN_INDEX_NAME = 'idx_edges_unshaken_unique';

// ── SQL (exported consts, house style) ──────────────────────────────────────

/** Full-population dup-group census with per-group source composition
 * (array_agg NOT distinct — an ai+ai pair must show as two elements). */
export const DUP_GROUPS_SQL = `
SELECT from_id, to_id, rel_type, count(*)::int AS n,
       array_agg(metadata->>'source' ORDER BY metadata->>'source') AS sources,
       bool_or(metadata ? 'sources') AS has_sources
FROM lumen.edges
WHERE collection_id = 'phase-b'
GROUP BY from_id, to_id, rel_type
HAVING count(*) > 1
ORDER BY from_id, to_id, rel_type`;

export const INDEX_EXISTS_SQL = `
SELECT EXISTS (SELECT 1 FROM pg_indexes
  WHERE schemaname = 'lumen' AND indexname = $1) AS pass`;

/** Rows already carrying the canonical merged sources stamp — pre-flight
 * expects 0 (a failed run rolls back; a succeeded run has no dup groups). */
export const STAMPED_COUNT_SQL = `
SELECT count(*)::int AS n FROM lumen.edges
WHERE collection_id = 'phase-b'
  AND metadata->'sources' = '${JSON.stringify(MERGED_SOURCES)}'::jsonb`;

/** Full row images of every dup-group member. to_jsonb = every column,
 * immune to schema.ts drift (item 6). ctid is a log handle ONLY. */
export const ESCROW_ROWS_SQL = `
SELECT e.ctid::text AS row_ref, to_jsonb(e) AS row
FROM lumen.edges e
WHERE e.collection_id = 'phase-b'
  AND (e.from_id, e.to_id, e.rel_type) IN (
    SELECT from_id, to_id, rel_type FROM lumen.edges
    WHERE collection_id = 'phase-b'
    GROUP BY from_id, to_id, rel_type
    HAVING count(*) > 1)
ORDER BY e.from_id, e.to_id, e.rel_type, e.metadata->>'source'`;

/** In-tx lock of every dup-group row. FOR UPDATE holds them for the tx;
 * house precedent: target by predicate, ctid for logging only. */
export const LOCK_GROUP_ROWS_SQL = `
SELECT e.ctid::text AS row_ref, e.from_id, e.to_id, e.rel_type,
       e.metadata->>'source' AS source,
       (e.metadata ? 'sources') AS has_sources_row
FROM lumen.edges e
WHERE e.collection_id = 'phase-b'
  AND (e.from_id, e.to_id, e.rel_type) IN (
    SELECT from_id, to_id, rel_type FROM lumen.edges
    WHERE collection_id = 'phase-b'
    GROUP BY from_id, to_id, rel_type
    HAVING count(*) > 1)
FOR UPDATE`;

/** Survivor merge: the curated row gains the AI row's reason + relationship
 * (jsonb_strip_nulls drops either key if the AI row lacks it) and the
 * canonical sources array; every other survivor key is preserved
 * (metadata.source stays 'bible-bom-curated'). A (curated, ai) pair sharing
 * the tuple IS a dup group by definition, so no extra group predicate. */
export const MERGE_UPDATE_SQL = `
UPDATE lumen.edges s
SET metadata = s.metadata
  || jsonb_strip_nulls(jsonb_build_object(
       'reason', a.metadata->'reason',
       'relationship', a.metadata->'relationship'))
  || jsonb_build_object('sources', '${JSON.stringify(MERGED_SOURCES)}'::jsonb)
FROM lumen.edges a
WHERE s.collection_id = 'phase-b' AND a.collection_id = 'phase-b'
  AND a.from_id = s.from_id AND a.to_id = s.to_id AND a.rel_type = s.rel_type
  AND s.metadata->>'source' = 'bible-bom-curated'
  AND a.metadata->>'source' = 'ai-generated'`;

/** Predicate-targeted delete of the AI member of every merged pair. */
export const DELETE_AI_SQL = `
DELETE FROM lumen.edges a
WHERE a.collection_id = 'phase-b'
  AND a.metadata->>'source' = 'ai-generated'
  AND EXISTS (
    SELECT 1 FROM lumen.edges s
    WHERE s.collection_id = 'phase-b'
      AND s.from_id = a.from_id AND s.to_id = a.to_id AND s.rel_type = a.rel_type
      AND s.metadata->>'source' = 'bible-bom-curated')`;

export const REMAINING_DUP_GROUPS_SQL = `
SELECT count(*)::int AS n FROM (
  SELECT 1 FROM lumen.edges
  WHERE collection_id = 'phase-b'
  GROUP BY from_id, to_id, rel_type
  HAVING count(*) > 1) d`;

export const CREATE_PHASEB_INDEX_SQL = `
CREATE UNIQUE INDEX ${PHASEB_INDEX_NAME}
  ON lumen.edges (from_id, to_id, rel_type)
  WHERE collection_id = 'phase-b'`;

// ── pure helpers (exported + unit-tested) ───────────────────────────────────

/**
 * Pre-flight classifier over the full dup-group census. Accepts ONLY the
 * verified anatomy: expectedCount groups, every group exactly 2 rows whose
 * metadata.source pair is exactly {ai-generated, bible-bom-curated}.
 * Rejects ai+ai pairs, 3-row groups, missing/NULL sources, count drift.
 */
export function classifyDupGroups(groups, expectedCount = EXPECTED_DUP_GROUPS) {
	const reasons = [];
	if (groups.length !== expectedCount) {
		reasons.push(`group_count ${groups.length} != expected ${expectedCount}`);
	}
	for (const g of groups) {
		const key = `${g.from_id} -> ${g.to_id} [${g.rel_type}]`;
		if (Number(g.n) !== 2) {
			reasons.push(`group ${key}: ${g.n} rows (expected exactly 2)`);
			continue;
		}
		const sources = [...(g.sources ?? [])].map((s) => s ?? '<null>').sort();
		if (sources.length !== 2 || sources[0] !== SOURCE_PAIR[0] || sources[1] !== SOURCE_PAIR[1]) {
			reasons.push(`group ${key}: source pair [${sources.join(', ')}] != [${SOURCE_PAIR.join(', ')}]`);
		}
		// MERGE_UPDATE_SQL literal-stamps the canonical sources array — provably
		// equivalent to a JS union ONLY when no row already carries one
		if (g.has_sources === true) {
			reasons.push(`group ${key}: a row already carries metadata.sources — literal stamp would clobber; human review`);
		}
	}
	return { ok: reasons.length === 0, reason_count: reasons.length, reasons: reasons.slice(0, 25) };
}

/** rel_type composition of the dup-group census — reported in pre-flight. */
export function relTypeComposition(groups) {
	const out = {};
	for (const g of groups) out[g.rel_type] = (out[g.rel_type] ?? 0) + 1;
	return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
}

/** Regroup FOR UPDATE-locked rows into classifier input (in-tx re-check). */
export function groupsFromLockedRows(rows) {
	const byKey = new Map();
	for (const r of rows) {
		const k = `${r.from_id}\u0000${r.to_id}\u0000${r.rel_type}`;
		if (!byKey.has(k)) {
			byKey.set(k, { from_id: r.from_id, to_id: r.to_id, rel_type: r.rel_type, n: 0, sources: [], has_sources: false });
		}
		const g = byKey.get(k);
		g.n += 1;
		g.sources.push(r.source);
		if (r.has_sources_row === true) g.has_sources = true;
	}
	return [...byKey.values()];
}

export const dupGroupKey = (r) => `${r.from_id} ${r.to_id} ${r.rel_type}`;

/** Escrow↔lock ROW-IDENTITY check: counts and shape matching is not enough —
 * the locked set must be exactly the escrowed groups, else the merge touches
 * rows the escrow cannot restore. */
export function escrowLockKeyDiff(escrowRows, lockedRows) {
	const escrowKeys = new Set(escrowRows.map((r) => dupGroupKey(r.row)));
	const lockedKeys = new Set(lockedRows.map((r) => dupGroupKey(r)));
	return {
		missing: [...escrowKeys].filter((k) => !lockedKeys.has(k)).length,
		extra: [...lockedKeys].filter((k) => !escrowKeys.has(k)).length,
	};
}

/**
 * DB-merge shape in JS — the writer's in-memory collapse MUST produce exactly
 * what MERGE_UPDATE_SQL produces: survivor keys preserved, reason +
 * relationship taken from the AI row when present, canonical sources array.
 */
export function buildMergedMetadata(survivorMeta, otherMeta) {
	const merged = { ...(survivorMeta ?? {}) };
	if (otherMeta?.reason !== undefined && otherMeta.reason !== null) merged.reason = otherMeta.reason;
	if (otherMeta?.relationship !== undefined && otherMeta.relationship !== null) {
		merged.relationship = otherMeta.relationship;
	}
	merged.sources = unionSources(survivorMeta, otherMeta);
	return merged;
}

/** Union of provenance across metadata objects (sources[] or scalar source),
 * canonical order: bible-bom-curated, ai-generated, then encounter order. */
export function unionSources(...metas) {
	const seen = [];
	for (const m of metas) {
		const list = Array.isArray(m?.sources) ? m.sources : m?.source != null ? [m.source] : [];
		for (const s of list) if (typeof s === 'string' && !seen.includes(s)) seen.push(s);
	}
	return [
		...seen.filter((s) => s === MERGED_SOURCES[0]),
		...seen.filter((s) => s === MERGED_SOURCES[1]),
		...seen.filter((s) => s !== MERGED_SOURCES[0] && s !== MERGED_SOURCES[1]),
	];
}

/** Escrow payload: full row images grouped-by-count metadata for invariants. */
export function buildEscrowPayload(escrowRows, meta = {}) {
	const groupKeys = new Set();
	for (const r of escrowRows) {
		groupKeys.add(`${r.row.from_id}\u0000${r.row.to_id}\u0000${r.row.rel_type}`);
	}
	return {
		script: 'migrate-phaseb-dedupe',
		...meta,
		group_count: groupKeys.size,
		row_count: escrowRows.length,
		rows: escrowRows.map((r) => ({ row_ref: r.row_ref, row: r.row })),
	};
}

/** Escrow ↔ census cross-check: same groups, same per-group row counts,
 * full row images carry at least the natural key + collection + metadata. */
export function validateEscrow(payload, groups) {
	const errors = [];
	const byKey = new Map(groups.map((g) => [`${g.from_id}\u0000${g.to_id}\u0000${g.rel_type}`, Number(g.n)]));
	const counts = new Map();
	for (const { row } of payload.rows) {
		for (const col of ['from_id', 'to_id', 'rel_type', 'collection_id', 'metadata']) {
			if (!(col in (row ?? {}))) errors.push(`escrow row missing column ${col}`);
		}
		if (!row) continue;
		const k = `${row.from_id}\u0000${row.to_id}\u0000${row.rel_type}`;
		counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	if (payload.group_count !== byKey.size) {
		errors.push(`escrow group_count ${payload.group_count} != census ${byKey.size}`);
	}
	if (payload.row_count !== payload.rows.length) {
		errors.push(`escrow row_count ${payload.row_count} != rows ${payload.rows.length}`);
	}
	for (const [k, n] of byKey) {
		if (counts.get(k) !== n) {
			errors.push(`group ${k.split('\u0000').join(' | ')}: escrowed ${counts.get(k) ?? 0} rows, census ${n}`);
		}
	}
	for (const k of counts.keys()) {
		if (!byKey.has(k)) errors.push(`escrow has group absent from census: ${k.split('\u0000').join(' | ')}`);
	}
	return errors.slice(0, 25);
}

/**
 * Restore plan from an escrow payload (edges has no PK): per natural-key
 * group, delete-by-natural-key then reinsert the full row images. Pure —
 * returns structured ops; restoreStatements renders SQL descriptors.
 */
export function buildRestorePlan(payload) {
	const ops = [];
	const seen = new Set();
	for (const { row } of payload.rows) {
		const k = `${row.from_id}\u0000${row.to_id}\u0000${row.rel_type}\u0000${row.collection_id}`;
		if (seen.has(k)) continue;
		seen.add(k);
		ops.push({
			op: 'delete_group',
			key: { collection_id: row.collection_id, from_id: row.from_id, to_id: row.to_id, rel_type: row.rel_type },
		});
	}
	for (const { row } of payload.rows) ops.push({ op: 'insert_row', row });
	return ops;
}

/** Render restore ops as parameterized statement descriptors {text, values}.
 * All deletes precede all inserts (buildRestorePlan's op order). */
export function restoreStatements(ops) {
	const stmts = [];
	for (const op of ops) {
		if (op.op === 'delete_group') {
			stmts.push({
				text: 'DELETE FROM lumen.edges WHERE collection_id = $1 AND from_id = $2 AND to_id = $3 AND rel_type = $4',
				values: [op.key.collection_id, op.key.from_id, op.key.to_id, op.key.rel_type],
			});
			continue;
		}
		const cols = Object.keys(op.row).sort();
		for (const c of cols) {
			if (!/^[a-z_][a-z0-9_]*$/.test(c)) throw new Error(`unsafe column name in escrow image: ${c}`);
		}
		stmts.push({
			text: `INSERT INTO lumen.edges (${cols.join(', ')}) VALUES (${cols
				.map((c, i) => `$${i + 1}${c === 'metadata' ? '::jsonb' : ''}`)
				.join(', ')})`,
			values: cols.map((c) => (c === 'metadata' ? JSON.stringify(op.row[c]) : op.row[c])),
		});
	}
	return stmts;
}

// ── the transaction (exported; exercised with a fake sql) ───────────────────

export class InvariantAbort extends Error {
	constructor(reason) {
		super(`INVARIANT_ABORT:${reason}`);
		this.reason = reason;
	}
}

/**
 * The merge tx. Locks every dup-group row, re-verifies the 1+1 shape in-tx,
 * merges, deletes, checks invariants, creates the partial unique index, then
 * rolls back unless commit. Returns { status: 'applied' | 'dry_run_ok' |
 * 'aborted', reason }. Throws only on infrastructure errors.
 */
export async function runDedupeTx(sql, { escrow, preStampedCount = 0, commit = false, log = () => {} }) {
	const expectedGroups = escrow.group_count;
	try {
		await sql.begin(async (tx) => {
			await tx.unsafe(`SET LOCAL statement_timeout = '600s'`);

			const locked = await tx.unsafe(LOCK_GROUP_ROWS_SQL);
			if (locked.length !== escrow.row_count) {
				throw new InvariantAbort(`locked_rows_${locked.length}_escrow_${escrow.row_count}`);
			}
			const verdict = classifyDupGroups(groupsFromLockedRows(locked), expectedGroups);
			if (!verdict.ok) throw new InvariantAbort(`locked_shape:${verdict.reasons[0] ?? 'unknown'}`);
			const keyDiff = escrowLockKeyDiff(escrow.rows, locked);
			if (keyDiff.missing || keyDiff.extra) {
				throw new InvariantAbort(`escrow_lock_key_mismatch_missing_${keyDiff.missing}_extra_${keyDiff.extra}`);
			}
			log('tx_locked', { rows: locked.length, groups: expectedGroups });

			const upd = await tx.unsafe(MERGE_UPDATE_SQL);
			if (upd.count !== expectedGroups) {
				throw new InvariantAbort(`update_count_${upd.count}_expected_${expectedGroups}`);
			}
			const del = await tx.unsafe(DELETE_AI_SQL);
			if (del.count !== expectedGroups) {
				throw new InvariantAbort(`delete_count_${del.count}_expected_${expectedGroups}`);
			}
			if (upd.count + del.count !== escrow.row_count) {
				throw new InvariantAbort(`touched_${upd.count + del.count}_escrow_${escrow.row_count}`);
			}
			log('tx_merged', { updated: upd.count, deleted: del.count });

			const [dup] = await tx.unsafe(REMAINING_DUP_GROUPS_SQL);
			if (Number(dup.n) !== 0) throw new InvariantAbort(`dup_groups_remaining_${dup.n}`);
			const [stamped] = await tx.unsafe(STAMPED_COUNT_SQL);
			if (Number(stamped.n) !== Number(preStampedCount) + expectedGroups) {
				throw new InvariantAbort(`stamped_${stamped.n}_expected_${Number(preStampedCount) + expectedGroups}`);
			}

			// idx_edges_unshaken_unique is never touched — prove it survived
			const [unshaken] = await tx.unsafe(INDEX_EXISTS_SQL, [UNSHAKEN_INDEX_NAME]);
			if (unshaken.pass !== true) throw new InvariantAbort('unshaken_index_missing');

			await tx.unsafe(CREATE_PHASEB_INDEX_SQL);
			const [idx] = await tx.unsafe(INDEX_EXISTS_SQL, [PHASEB_INDEX_NAME]);
			if (idx.pass !== true) throw new InvariantAbort('phaseb_index_absent_after_create');
			log('tx_index_created', { index: PHASEB_INDEX_NAME });

			if (!commit) throw new Error('DRY_RUN_ROLLBACK');
		});
		log('dedupe_applied', { commit: true, groups: expectedGroups });
		return { status: 'applied', reason: null };
	} catch (err) {
		if (err.message === 'DRY_RUN_ROLLBACK') {
			log('dedupe_dry_run_ok', { commit: false, groups: expectedGroups });
			return { status: 'dry_run_ok', reason: null };
		}
		if (err instanceof InvariantAbort) {
			log('dedupe_aborted', { reason: err.reason });
			return { status: 'aborted', reason: err.reason };
		}
		throw err;
	}
}

// ── runner ──────────────────────────────────────────────────────────────────

const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));

async function main() {
	const commit = process.env.COMMIT === '1';
	let sql;
	try {
		const envPath = join(ROOT, '.env');
		if (!existsSync(envPath)) throw new Error('root .env with DATABASE_URL required');
		const url = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
		if (!url) throw new Error('DATABASE_URL not found in root .env');
		const require = createRequire(import.meta.url);
		const postgres = require('postgres');
		sql = postgres(url, { prepare: false, max: 1 });
	} catch (err) {
		console.error('FATAL:', scrubSecrets(err.message));
		process.exit(1);
	}

	try {
		await sql.unsafe(`SET statement_timeout = '600s'`); // session-wide (max: 1)

		// ── pre-flight: full-population aggregates, runs in DRY_RUN too ──
		const groups = await sql.unsafe(DUP_GROUPS_SQL);
		log('preflight_composition', { groups: groups.length, rel_types: relTypeComposition(groups) });
		const verdict = classifyDupGroups(groups);
		const [phasebIdx] = await sql.unsafe(INDEX_EXISTS_SQL, [PHASEB_INDEX_NAME]);
		const [unshakenIdx] = await sql.unsafe(INDEX_EXISTS_SQL, [UNSHAKEN_INDEX_NAME]);
		const [preStamped] = await sql.unsafe(STAMPED_COUNT_SQL);
		const failures = [];
		if (!verdict.ok) failures.push(...verdict.reasons);
		if (phasebIdx.pass === true) failures.push(`${PHASEB_INDEX_NAME} already exists`);
		if (unshakenIdx.pass !== true) failures.push(`${UNSHAKEN_INDEX_NAME} missing (wrong database?)`);
		if (Number(preStamped.n) !== 0) failures.push(`${preStamped.n} rows already carry the merged sources stamp`);
		log('preflight', {
			ok: failures.length === 0,
			groups: groups.length,
			expected_groups: EXPECTED_DUP_GROUPS,
			phaseb_index_present: phasebIdx.pass === true,
			unshaken_index_present: unshakenIdx.pass === true,
			pre_stamped_rows: Number(preStamped.n),
			failures: failures.slice(0, 25),
		});
		if (failures.length > 0) {
			log('halt', { reason: 'preflight_divergence', commit: false });
			await sql.end();
			process.exit(2);
		}

		// ── escrow: full row images BEFORE the tx ──
		const escrowRows = await sql.unsafe(ESCROW_ROWS_SQL);
		const escrow = buildEscrowPayload(escrowRows, {
			started_at: new Date().toISOString(),
			commit,
			expected_groups: EXPECTED_DUP_GROUPS,
		});
		const escrowErrors = validateEscrow(escrow, groups);
		if (escrowErrors.length > 0) {
			log('halt', { reason: 'escrow_mismatch', errors: escrowErrors, commit: false });
			await sql.end();
			process.exit(2);
		}
		mkdirSync(ESCROW_DIR, { recursive: true });
		const escrowPath = join(ESCROW_DIR, `phaseb-dedupe-${escrow.started_at.replace(/[:.]/g, '-')}.json`);
		writeFileSync(escrowPath, JSON.stringify(escrow, null, '\t'));
		log('escrow_written', { path: escrowPath, rows: escrow.row_count, groups: escrow.group_count });

		// ── the tx (dry-run = full fidelity via thrown rollback, index incl.) ──
		const outcome = await runDedupeTx(sql, { escrow, preStampedCount: Number(preStamped.n), commit, log });
		if (outcome.status === 'aborted') {
			log('halt', { reason: outcome.reason, commit, escrow: escrowPath });
			await sql.end();
			process.exit(2);
		}

		// ── post-state report (post-commit verifies reality; post-dry-run the
		// index/merge checks are expected to report the untouched state) ──
		const [dupAfter] = await sql.unsafe(REMAINING_DUP_GROUPS_SQL);
		const [idxAfter] = await sql.unsafe(INDEX_EXISTS_SQL, [PHASEB_INDEX_NAME]);
		const [stampedAfter] = await sql.unsafe(STAMPED_COUNT_SQL);
		let postFailures = 0;
		if (commit) {
			for (const [name, pass] of [
				['dup_groups_zero', Number(dupAfter.n) === 0],
				['phaseb_index_present', idxAfter.pass === true],
				['survivors_stamped', Number(stampedAfter.n) === EXPECTED_DUP_GROUPS],
			]) {
				log('invariant_check', { name, pass });
				if (!pass) postFailures += 1;
			}
		}
		log('migration_done', {
			commit,
			status: outcome.status,
			dup_groups_now: Number(dupAfter.n),
			phaseb_index_present: idxAfter.pass === true,
			stamped_rows_now: Number(stampedAfter.n),
			escrow: escrowPath,
		});
		await sql.end();
		process.exit(postFailures > 0 ? 2 : 0);
	} catch (err) {
		console.error('FATAL:', scrubSecrets(err.message));
		await sql.end();
		process.exit(1);
	}
}

// No top-level await here (house guard uses `await main()`): backfill-phase-b.ts
// imports this module's pure helpers under tsx's CJS transform, which rejects TLA.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error('FATAL:', scrubSecrets(err?.message ?? String(err)));
		process.exit(1);
	});
}
