#!/usr/bin/env node
/**
 * Production half of the enrichment-review migration
 * (supabase/migrations/20260819000000_enrichment_reviews.sql carries the
 * local half; the CLI applies that file inside a transaction, which is
 * fine here — this table is created empty, so there is no CONCURRENTLY
 * index build to keep out of a transaction).
 *
 * This script exists for the reason every migrate-*.mjs here exists: the
 * supabase/ file never runs against production. It applies the identical
 * DDL, then asserts the invariants that actually matter — that the table
 * is RLS-protected, that its policy exists, and above all that lumen_read
 * (the app's SELECT-only credential) holds NO privilege on it. The whole
 * design rests on review decisions being unreadable over Hyperdrive's
 * ~60s read cache; a stray grant would silently reintroduce the
 * stale-read bug class documented in the migration header.
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
	console.error('migrate-enrichment-reviews: DATABASE_URL required');
	process.exit(1);
}

const MIGRATION = join(ROOT, 'supabase/migrations/20260819000000_enrichment_reviews.sql');
const client = new pg.Client({ connectionString: dsn });
await client.connect();

const log = (event, data = {}) =>
	console.log(JSON.stringify({ event, at: new Date().toISOString(), ...data }));

let bad = 0;
try {
	// the supabase file IS the DDL — running it here keeps the two halves
	// from drifting the way hand-copied SQL always eventually does
	const ddl = readFileSync(MIGRATION, 'utf8');
	await client.query('BEGIN');
	await client.query(ddl);
	await client.query('COMMIT');
	log('enrichment_reviews_applied', { from: 'supabase/migrations/20260819000000_enrichment_reviews.sql' });

	const checks = [
		[
			'table exists',
			`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='lumen' AND tablename='enrichment_reviews'`,
			(r) => r[0].n === 1,
		],
		[
			'row level security enabled',
			`SELECT c.relrowsecurity AS ok FROM pg_class c WHERE c.relname='enrichment_reviews' AND c.relnamespace='lumen'::regnamespace`,
			(r) => r[0]?.ok === true,
		],
		[
			'admin policy present',
			`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='lumen' AND tablename='enrichment_reviews' AND policyname='enrichment_reviews_admin_all'`,
			(r) => r[0].n === 1,
		],
		[
			'lumen_read holds NO privilege (the whole design)',
			`SELECT count(*)::int AS n FROM information_schema.role_table_grants
			 WHERE table_schema='lumen' AND table_name='enrichment_reviews' AND grantee='lumen_read'`,
			(r) => r[0].n === 0,
		],
		[
			'authenticated can write',
			`SELECT count(*)::int AS n FROM information_schema.role_table_grants
			 WHERE table_schema='lumen' AND table_name='enrichment_reviews'
			   AND grantee='authenticated' AND privilege_type IN ('INSERT','UPDATE')`,
			(r) => r[0].n >= 2,
		],
		[
			'status is constrained to accepted|rejected',
			`SELECT count(*)::int AS n FROM pg_constraint
			 WHERE conrelid='lumen.enrichment_reviews'::regclass AND conname='enrichment_reviews_status_check'`,
			(r) => r[0].n === 1,
		],
	];
	for (const [name, q, ok] of checks) {
		const { rows } = await client.query(q);
		if (ok(rows)) console.log(`  ✓ ${name}`);
		else {
			bad += 1;
			console.error(`  ✗ ${name}: ${JSON.stringify(rows)}`);
		}
	}
} catch (err) {
	await client.query('ROLLBACK').catch(() => {});
	console.error('FATAL:', err.message);
	bad += 1;
} finally {
	await client.end();
}

console.log(bad ? `migrate-enrichment-reviews: ${bad} invariant(s) FAILED` : 'migrate-enrichment-reviews: OK');
process.exit(bad ? 1 : 0);
