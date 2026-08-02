#!/usr/bin/env node
/**
 * Roles baseline (Abram, 2026-08-01): two roles, admin and user.
 *
 * The role machinery already shipped (migrate-user-roles.mjs — lumen.roles,
 * lumen.user_roles, the app_users bridge, entitlement gating). This adds
 * what was missing to actually USE it:
 *
 *   1. the `user` role — no entitlements, the explicit floor. It is the
 *      DEFAULT: a signed-in account with no lumen.user_roles row resolves
 *      to `user` in code (entitlements.server.ts), so there is no trigger
 *      on auth.users and no backfill to keep in sync.
 *   2. RLS on both role tables. anon/authenticated hold no grants today, so
 *      PostgREST cannot reach them at all — this is the second lock, so a
 *      grant added by mistake later still denies. lumen_read (the app's
 *      SELECT-only credential) gets explicit read policies: RLS applies to
 *      it, and WITHOUT these the entitlement join returns zero rows and
 *      every admin silently stops being one.
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
	console.error('migrate-roles-baseline: DATABASE_URL required');
	process.exit(1);
}

const DDL = `
-- the floor role: named, visible, and deliberately powerless
INSERT INTO lumen.roles (slug, label, entitlements)
VALUES ('user', 'User', ARRAY[]::text[])
ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label;

ALTER TABLE lumen.roles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lumen.user_roles ENABLE ROW LEVEL SECURITY;

-- the app server reads both to resolve entitlements; role rows are not
-- secret (they are the app's own vocabulary) and assignment rows never
-- serialize to clients — the loaders return entitlements, not voter-style
-- identity lists. No policy exists for anon/authenticated ON PURPOSE.
DROP POLICY IF EXISTS roles_read_server ON lumen.roles;
CREATE POLICY roles_read_server ON lumen.roles
	FOR SELECT TO lumen_read USING (true);
DROP POLICY IF EXISTS user_roles_read_server ON lumen.user_roles;
CREATE POLICY user_roles_read_server ON lumen.user_roles
	FOR SELECT TO lumen_read USING (true);
`;

const client = new pg.Client({ connectionString: dsn });
await client.connect();
try {
	await client.query('BEGIN');
	await client.query(DDL);
	await client.query('COMMIT');
} catch (err) {
	await client.query('ROLLBACK');
	console.error('migrate-roles-baseline: FAILED —', err.message);
	process.exit(1);
}

const checks = [
	[
		'exactly two roles: admin and user',
		`SELECT string_agg(slug, ',' ORDER BY slug) AS s FROM lumen.roles`,
		(r) => r[0].s === 'admin,user',
	],
	[
		'user role grants nothing',
		`SELECT coalesce(array_length(entitlements, 1), 0)::int AS n FROM lumen.roles WHERE slug = 'user'`,
		(r) => r[0].n === 0,
	],
	[
		'admin role still grants its entitlements',
		`SELECT coalesce(array_length(entitlements, 1), 0)::int AS n FROM lumen.roles WHERE slug = 'admin'`,
		(r) => r[0].n >= 1,
	],
	[
		'RLS on both role tables',
		`SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'lumen'::regnamespace
		   AND relname IN ('roles','user_roles') AND relrowsecurity`,
		(r) => r[0].n === 2,
	],
	[
		'lumen_read holds a read policy on both',
		`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'lumen'
		   AND tablename IN ('roles','user_roles') AND cmd = 'SELECT' AND roles::text LIKE '%lumen_read%'`,
		(r) => r[0].n === 2,
	],
	[
		'no policy opens these to anon or authenticated',
		`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'lumen'
		   AND tablename IN ('roles','user_roles')
		   AND (roles::text LIKE '%anon%' OR roles::text LIKE '%authenticated%' OR roles::text = '{public}')`,
		(r) => r[0].n === 0,
	],
	[
		'anon and authenticated hold no grants on either table',
		`SELECT count(*)::int AS n FROM information_schema.role_table_grants
		   WHERE table_schema = 'lumen' AND table_name IN ('roles','user_roles')
		     AND grantee IN ('anon','authenticated')`,
		(r) => r[0].n === 0,
	],
	[
		'lumen_read cannot WRITE either table',
		`SELECT count(*)::int AS n FROM information_schema.role_table_grants
		   WHERE table_schema = 'lumen' AND table_name IN ('roles','user_roles')
		     AND grantee = 'lumen_read' AND privilege_type <> 'SELECT'`,
		(r) => r[0].n === 0,
	],
];

let bad = 0;
for (const [name, q, ok] of checks) {
	const { rows } = await client.query(q);
	if (ok(rows)) console.log(`  ✓ ${name}`);
	else {
		bad += 1;
		console.error(`  ✗ ${name}: ${JSON.stringify(rows)}`);
	}
}
await client.end();
if (bad) {
	console.error(`migrate-roles-baseline: ${bad} invariant(s) FAILED`);
	process.exit(1);
}
console.log('migrate-roles-baseline: OK');
