#!/usr/bin/env node
/**
 * Production half of the edges uniqueness migration
 * (docs/design/second-show.md §1). The supabase/ migration file carries the
 * plain CREATE for the local stack; production builds the same index
 * CONCURRENTLY so lumen.edges (880k rows, live readers) is never locked.
 *
 * CONCURRENTLY cannot run inside a transaction, so unlike every other
 * migration script here there is deliberately NO BEGIN/COMMIT around the
 * build. A failed concurrent build leaves an INVALID index behind — the
 * script detects that, drops it, and exits nonzero so a re-run starts clean.
 *
 * The two partial unique indexes are intentionally untouched:
 *   - idx_edges_phaseb_unique is load-bearing (backfill-phase-b.ts startup
 *     gate + WHERE-form ON CONFLICT inference).
 *   - idx_edges_unshaken_unique drops only WITH the loader change that
 *     moves its ON CONFLICT to the four-column form.
 *
 * Idempotent. Requires the admin DSN (repo-root .env).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let dsn = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;
if (!dsn) {
	try {
		dsn = readFileSync(join(ROOT, '.env'), 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
	} catch {}
}
if (!dsn) {
	console.error('migrate-edges-unique: DATABASE_URL required');
	process.exit(1);
}

const client = new pg.Client({ connectionString: dsn });
await client.connect();

// Pre-check: the unique index can only build if the data is already unique.
const { rows: dupes } = await client.query(`
	SELECT from_id, to_id, rel_type, collection_id, count(*)::int AS n
	FROM lumen.edges GROUP BY 1,2,3,4 HAVING count(*) > 1 LIMIT 5`);
if (dupes.length > 0) {
	console.error('migrate-edges-unique: ABORT — duplicate tuples exist:', JSON.stringify(dupes));
	console.error('fall back to per-collection partial indexes (plan §1 fallback)');
	await client.end();
	process.exit(1);
}
console.log('  ✓ pre-check: no duplicate (from,to,rel_type,collection_id) tuples');

const { rows: existing } = await client.query(`
	SELECT i.indisvalid FROM pg_class c
	JOIN pg_index i ON i.indexrelid = c.oid
	WHERE c.relname = 'idx_edges_unique' AND c.relnamespace = 'lumen'::regnamespace`);
if (existing.length > 0 && existing[0].indisvalid) {
	console.log('  ✓ idx_edges_unique already exists and is valid — nothing to do');
} else {
	if (existing.length > 0) {
		// a previous concurrent build died mid-flight; clear the invalid remnant
		console.log('  ! dropping INVALID remnant of idx_edges_unique');
		await client.query('DROP INDEX CONCURRENTLY lumen.idx_edges_unique');
	}
	console.log('  … building idx_edges_unique CONCURRENTLY (no lock on edges)');
	await client.query(`
		CREATE UNIQUE INDEX CONCURRENTLY idx_edges_unique
		ON lumen.edges (from_id, to_id, rel_type, collection_id)`);
	await client.query('ANALYZE lumen.edges');
}

const checks = [
	['idx_edges_unique exists and is VALID', `SELECT i.indisvalid AS ok FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname='idx_edges_unique' AND c.relnamespace='lumen'::regnamespace`, (r) => r[0]?.ok === true],
	['it is UNIQUE on the four columns', `SELECT i.indisunique AS u, i.indnatts::int AS n FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname='idx_edges_unique' AND c.relnamespace='lumen'::regnamespace`, (r) => r[0]?.u === true && r[0]?.n === 4],
	['idx_edges_phaseb_unique untouched (load-bearing)', `SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='lumen' AND indexname='idx_edges_phaseb_unique'`, (r) => r[0].n === 1],
	['idx_edges_unshaken_unique still present (drops with the loader change)', `SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='lumen' AND indexname='idx_edges_unshaken_unique'`, (r) => r[0].n === 1],
];
let bad = 0;
for (const [name, q, ok] of checks) {
	const { rows } = await client.query(q);
	if (ok(rows)) console.log(`  ✓ ${name}`);
	else { bad += 1; console.error(`  ✗ ${name}: ${JSON.stringify(rows)}`); }
}
await client.end();
if (bad) { console.error(`migrate-edges-unique: ${bad} invariant(s) FAILED`); process.exit(1); }
console.log('migrate-edges-unique: OK');
