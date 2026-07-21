// Migration (remediation v2 item 7): entity id rename, ledger-driven.
// Ledger: scripts/entity-renames.json — [{"from","to"}] — the SHARED renames
// ledger: item 3's writer (backfill-phase-b) reads this exact path/shape and
// applies it to entity ids and edge endpoints before upsert, so a re-run
// never re-mints a renamed id from the export.
//
// Per entry: escrow full-row images to a timestamped file BEFORE any tx;
// then ONE tx per entry — re-assert under FOR UPDATE that the from-row
// exists, carries ZERO edges (from_id OR to_id — abort if any appeared since
// verification), the to-id is unoccupied, and metadata.neo4j_id is NOT
// already set (then abort — needs human review); UPDATE id from -> to and
// stamp metadata.neo4j_id = from (house resolveGraphId contract — the graph
// node keeps the old id, PG↔graph resolution keeps working). In-tx
// invariants: exactly 1 row updated, to-id count 1, from-id count 0. Any
// abort HALTS the run — no COMMIT, remaining entries untouched.
//
//   node --import tsx scripts/migrate-entity-rename.mjs            # dry-run
//   COMMIT=1 node --import tsx scripts/migrate-entity-rename.mjs  # apply
// Exit 0 success/dry-run clean, 1 fatal, 2 assertion/invariant abort.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scrubSecrets } from './ingest-podcast/util.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LEDGER_PATH = join(ROOT, 'scripts', 'entity-renames.json');
// data/* is gitignored — prod row images never land in git
const ESCROW_DIR = join(ROOT, 'data', 'escrow');

// ── SQL (exported consts, house style) ──────────────────────────────────────

// Full-row image via to_jsonb: every column, immune to schema.ts drift (item 6)
export const ROW_IMAGE_SQL = `SELECT to_jsonb(e) AS row FROM lumen.entities e WHERE e.id = $1`;
export const LOCK_ROW_SQL = `SELECT to_jsonb(e) AS row FROM lumen.entities e WHERE e.id = $1 FOR UPDATE`;
export const EDGE_COUNT_SQL = `SELECT count(*)::int AS n FROM lumen.edges WHERE from_id = $1 OR to_id = $1`;
// lumen.edges has no FK to entities — SHARE MODE blocks concurrent edge
// writes (reads unaffected) for the sub-second tx, closing the re-assert race
export const LOCK_EDGES_SQL = `LOCK TABLE lumen.edges IN SHARE MODE`;
// informational only (surfaced for the ratifier — search_index.ref_id has no
// FK and is NOT covered by item 7's assertions); never an abort condition
export const SEARCH_INDEX_COUNT_SQL = `SELECT count(*)::int AS n FROM lumen.search_index WHERE ref_id = $1`;
// SQL-side stamp: jsonb || jsonb_build_object avoids round-tripping the whole
// metadata document through JS (numeric-precision hazard). Safe because
// classifyRename aborts metadata_not_object / neo4j_id_preexisting first.
export const RENAME_SQL = `UPDATE lumen.entities SET id = $2, metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('neo4j_id', $1::text) WHERE id = $1`;
export const ID_COUNT_SQL = `SELECT count(*)::int AS n FROM lumen.entities WHERE id = $1`;

// ── pure helpers (exported + unit-tested) ───────────────────────────────────

// entity ids are lowercase slugs; ':' allowed for `{type}:{id}` namespaced
// phase-b ids (house precedent in backfill-neo4j-collections)
export const ID_PATTERN = /^[a-z0-9][a-z0-9:-]*$/;

/** Validate ledger shape. Returns an array of error strings (empty = valid). */
export function validateLedger(entries) {
	if (!Array.isArray(entries)) return ['ledger must be a JSON array'];
	const errors = [];
	const froms = new Map(); // id -> first index
	const tos = new Map();
	entries.forEach((e, i) => {
		if (e === null || typeof e !== 'object' || Array.isArray(e)) {
			errors.push(`entry ${i}: not an object`);
			return;
		}
		const extra = Object.keys(e).filter((k) => k !== 'from' && k !== 'to');
		if (extra.length) errors.push(`entry ${i}: unknown keys [${extra.join(', ')}]`);
		for (const k of ['from', 'to']) {
			if (typeof e[k] !== 'string' || !ID_PATTERN.test(e[k])) {
				errors.push(`entry ${i}: ${k} must be a slug id, got ${JSON.stringify(e[k])}`);
			}
		}
		if (typeof e.from === 'string' && e.from === e.to) errors.push(`entry ${i}: from === to`);
		if (typeof e.from === 'string') {
			if (froms.has(e.from)) errors.push(`entry ${i}: duplicate from '${e.from}' (also entry ${froms.get(e.from)})`);
			else froms.set(e.from, i);
		}
		if (typeof e.to === 'string') {
			if (tos.has(e.to)) errors.push(`entry ${i}: duplicate target '${e.to}' (also entry ${tos.get(e.to)})`);
			else tos.set(e.to, i);
		}
	});
	// chained/swapped renames are order-dependent — refuse them outright
	for (const [to, i] of tos) {
		if (froms.has(to)) errors.push(`entry ${i}: target '${to}' is also entry ${froms.get(to)}'s from (chained rename)`);
	}
	return errors;
}

/**
 * Assertion classifier — the single gate for both the pre-tx scan and the
 * in-tx re-check. Order mirrors the spec: from exists → zero edges → to
 * unoccupied → metadata sane → no preexisting neo4j_id.
 */
export function classifyRename({ fromRow, edgeCount, toRow }) {
	if (!fromRow) return { ok: false, reason: 'from_row_missing' };
	if (Number(edgeCount) !== 0) return { ok: false, reason: 'edges_present' };
	if (toRow) return { ok: false, reason: 'to_id_occupied' };
	const meta = fromRow.metadata;
	if (meta != null && (typeof meta !== 'object' || Array.isArray(meta))) {
		return { ok: false, reason: 'metadata_not_object' }; // A1 string-scalar class — human review
	}
	if (meta != null && 'neo4j_id' in meta) return { ok: false, reason: 'neo4j_id_preexisting' };
	return { ok: true, reason: null };
}

/** Stamp metadata.neo4j_id = fromId (resolveGraphId contract). Non-mutating. */
export function transformMetadata(metadata, fromId) {
	const base = metadata == null ? {} : metadata;
	if (typeof base !== 'object' || Array.isArray(base)) throw new Error('metadata is not a jsonb object');
	if ('neo4j_id' in base) throw new Error('metadata.neo4j_id already set — needs human review');
	return { ...base, neo4j_id: fromId };
}

// ── the per-entry transaction (exported; exercised with a fake sql) ─────────

class RenameAbort extends Error {
	constructor(reason) {
		super(`RENAME_ABORT:${reason}`);
		this.reason = reason;
	}
}

/**
 * One rename in one tx. Re-asserts under FOR UPDATE, updates, checks in-tx
 * invariants, rolls back unless commit. Returns
 * { status: 'applied' | 'dry_run_ok' | 'aborted', reason }.
 * Throws only on infrastructure errors (caller treats those as fatal).
 */
export async function renameOne(sql, entry, { commit = false, log = () => {} } = {}) {
	try {
		await sql.begin(async (tx) => {
			await tx.unsafe(`SET LOCAL statement_timeout = '30s'`);
			// lumen.edges has no FK to entities, so FOR UPDATE on the entity row
			// cannot block a concurrent edge INSERT — SHARE MODE blocks edge
			// writes (reads unaffected) for this sub-second tx, closing the
			// re-assert race on the zero-edges assertion.
			await tx.unsafe(LOCK_EDGES_SQL);
			const fromRow = (await tx.unsafe(LOCK_ROW_SQL, [entry.from]))[0]?.row ?? null;
			const edgeCount = Number((await tx.unsafe(EDGE_COUNT_SQL, [entry.from]))[0]?.n ?? -1);
			const toRow = (await tx.unsafe(ROW_IMAGE_SQL, [entry.to]))[0]?.row ?? null;
			const verdict = classifyRename({ fromRow, edgeCount, toRow });
			if (!verdict.ok) throw new RenameAbort(verdict.reason);
			const res = await tx.unsafe(RENAME_SQL, [entry.from, entry.to]);
			if (res.count !== 1) throw new RenameAbort(`updated_rowcount_${res.count}`);
			// in-tx invariants: to-id unique, from-id gone — abort on mismatch
			const toN = Number((await tx.unsafe(ID_COUNT_SQL, [entry.to]))[0]?.n);
			const fromN = Number((await tx.unsafe(ID_COUNT_SQL, [entry.from]))[0]?.n);
			if (toN !== 1) throw new RenameAbort(`to_id_count_${toN}`);
			if (fromN !== 0) throw new RenameAbort(`from_id_count_${fromN}`);
			if (!commit) throw new Error('DRY_RUN_ROLLBACK');
		});
		log('rename_applied', { from: entry.from, to: entry.to });
		return { status: 'applied', reason: null };
	} catch (err) {
		if (err.message === 'DRY_RUN_ROLLBACK') {
			log('rename_dry_run_ok', { from: entry.from, to: entry.to });
			return { status: 'dry_run_ok', reason: null };
		}
		if (err instanceof RenameAbort) {
			log('rename_aborted', { from: entry.from, to: entry.to, reason: err.reason });
			return { status: 'aborted', reason: err.reason };
		}
		throw err;
	}
}

// ── runner ──────────────────────────────────────────────────────────────────

const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));

async function main() {
	const commit = process.env.COMMIT === '1';

	let ledger;
	try {
		ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
	} catch (err) {
		console.error('FATAL: cannot read ledger:', scrubSecrets(err.message));
		process.exit(1);
	}
	const ledgerErrors = validateLedger(ledger);
	if (ledgerErrors.length) {
		log('ledger_invalid', { errors: ledgerErrors });
		process.exit(1);
	}
	if (ledger.length === 0) {
		log('migration_done', { commit, entries: 0, note: 'empty ledger — nothing to do' });
		process.exit(0);
	}

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
		await sql.unsafe(`SET statement_timeout = '30s'`); // session-wide (max: 1)

		// ── scan + escrow: full-row images BEFORE any tx ──
		const escrow = {
			script: 'migrate-entity-rename',
			started_at: new Date().toISOString(),
			commit,
			entries: [],
		};
		let scanFailures = 0;
		for (const entry of ledger) {
			const fromRow = (await sql.unsafe(ROW_IMAGE_SQL, [entry.from]))[0]?.row ?? null;
			const edgeCount = Number((await sql.unsafe(EDGE_COUNT_SQL, [entry.from]))[0]?.n ?? -1);
			const toRow = (await sql.unsafe(ROW_IMAGE_SQL, [entry.to]))[0]?.row ?? null;
			let searchIndexRows = null;
			try {
				searchIndexRows = Number((await sql.unsafe(SEARCH_INDEX_COUNT_SQL, [entry.from]))[0]?.n);
			} catch {
				/* informational only — table may not exist in this env */
			}
			const verdict = classifyRename({ fromRow, edgeCount, toRow });
			log('scan', {
				from: entry.from,
				to: entry.to,
				from_row_present: fromRow !== null,
				edge_count: edgeCount,
				to_occupied: toRow !== null,
				search_index_rows: searchIndexRows,
				ok: verdict.ok,
				reason: verdict.reason,
			});
			if (!verdict.ok) scanFailures += 1;
			escrow.entries.push({
				from: entry.from,
				to: entry.to,
				edge_count: edgeCount,
				search_index_rows: searchIndexRows,
				from_row: fromRow,
				to_row: toRow,
			});
		}
		mkdirSync(ESCROW_DIR, { recursive: true });
		const escrowPath = join(ESCROW_DIR, `entity-rename-${escrow.started_at.replace(/[:.]/g, '-')}.json`);
		writeFileSync(escrowPath, JSON.stringify(escrow, null, '\t'));
		log('escrow_written', { path: escrowPath, entries: escrow.entries.length });
		if (scanFailures > 0) {
			log('halt', { reason: 'scan_assertions_failed', failures: scanFailures, commit, applied: 0 });
			await sql.end();
			process.exit(2);
		}

		// ── one tx per entry; halt on first abort, remaining entries untouched ──
		let applied = 0;
		let dryRunOk = 0;
		for (const entry of ledger) {
			const outcome = await renameOne(sql, entry, { commit, log });
			if (outcome.status === 'aborted') {
				log('halt', { reason: outcome.reason, from: entry.from, to: entry.to, applied, commit });
				await sql.end();
				process.exit(2);
			}
			if (outcome.status === 'applied') applied += 1;
			else dryRunOk += 1;
		}
		log('migration_done', { commit, entries: ledger.length, applied, dry_run_ok: dryRunOk, escrow: escrowPath });
		await sql.end();
	} catch (err) {
		console.error('FATAL:', scrubSecrets(err.message));
		await sql.end();
		process.exit(1);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
