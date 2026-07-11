// user-roles migration: role-based entitlements + the auth.users→lumen bridge.
//   node scripts/migrate-user-roles.mjs --dry-run   # full run + checks, ROLLBACK
//   node scripts/migrate-user-roles.mjs             # apply (one transaction)
//
// DEPLOYMENT ORDER: must run against prod BEFORE the web deploy of the
// user-roles branch — the admin loader reads lumen.app_users / user_roles.
//
// Requires an ADMIN session-mode connection: DATABASE_URL in the repo-root
// .env (port 5432). The connecting role MUST be bypassrls (postgres) with
// auth USAGE — the whole bridge depends on it (see invariant bridge_owner_*).
// Exit codes: 0 success, 1 fatal/invariant-abort.
//
// Plan: docs/features/user-roles/plan.md (Decisions D1-D5, D11)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function scrub(message) {
  // \S+@ (greedy, backtracks to the LAST @ before the host) — [^@\s]*@ stopped
  // at the FIRST @ and leaked the password tail when the password contains @ (CR-7)
  return String(message)
    .replace(/\b(postgres(?:ql)?|https?):\/\/\S+@/gi, '$1://<redacted>@')
    .replace(/password=[^&\s]+/gi, 'password=<redacted>');
}

function log(event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

export function loadAdminUrl() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) throw new Error('repo-root .env with admin DATABASE_URL required');
  const url = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
  if (!url) throw new Error('DATABASE_URL not found in repo-root .env');
  if (/:6543\b/.test(url)) throw new Error('session-mode connection required (port 5432)');
  return url;
}

export async function assertSessionMode(sql) {
  await sql.unsafe(`SET "lumen.session_probe" = 'user-roles'`);
  const [row] = await sql.unsafe(`SELECT current_setting('lumen.session_probe', true) AS v`);
  if (row?.v !== 'user-roles') {
    throw new Error('connection is not session-mode (SET did not persist) — use the port-5432 session pooler');
  }
}

/**
 * DDL (D1/D2). The app_users view is owned by the connecting role (postgres,
 * bypassrls) and pinned security_invoker=false so it reads auth.users as the
 * OWNER — lumen_read gets the projection while still being denied auth schema
 * access. COALESCE makes every sortable column NON-NULL so keyset paging is
 * correct (D2: created_at is nullable in auth.users).
 */
export const USER_ROLES_DDL = `
CREATE TABLE IF NOT EXISTS lumen.roles (
  slug         text PRIMARY KEY,
  label        text NOT NULL,
  entitlements text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lumen.user_roles (
  user_id    uuid NOT NULL,
  role_slug  text NOT NULL REFERENCES lumen.roles(slug) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid,
  PRIMARY KEY (user_id, role_slug)
);
-- F2: no separate index on user_id — the composite PK (user_id, role_slug)
-- leads on user_id and covers every lookup. Drop the redundant one an earlier
-- run created (idempotent; no-op on a fresh DB).
DROP INDEX IF EXISTS lumen.idx_user_roles_user;

-- entitlement keys must stay in lockstep with the F13 source of truth:
-- apps/web/app/lib/entitlements-keys.ts (grant-role.mjs validates against it)
INSERT INTO lumen.roles (slug, label, entitlements)
VALUES ('admin', 'Administrator', ARRAY['admin.users'])
ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label, entitlements = EXCLUDED.entitlements;

CREATE OR REPLACE VIEW lumen.app_users
WITH (security_invoker = false) AS
SELECT
  u.id,
  COALESCE(u.email, '')                                   AS email,
  u.raw_user_meta_data->>'name'                           AS display_name,
  u.raw_user_meta_data->>'full_name'                      AS full_name,
  COALESCE(u.created_at, 'epoch'::timestamptz)            AS created_at,
  COALESCE(u.last_sign_in_at, 'epoch'::timestamptz)       AS last_sign_in_at,
  (u.email_confirmed_at IS NOT NULL)                      AS is_confirmed,
  (u.banned_until IS NOT NULL AND u.banned_until > now()) AS is_banned,
  COALESCE(u.is_anonymous, false)                         AS is_anonymous,
  (u.deleted_at IS NOT NULL)                              AS is_deleted
FROM auth.users u;

-- CR-2: CREATE OR REPLACE VIEW PRESERVES a pre-existing owner — a re-run
-- against a wrong-owner view would otherwise commit green while the bridge
-- silently returns 0 rows. Pin the owner explicitly (idempotent).
ALTER VIEW lumen.app_users OWNER TO postgres;

GRANT SELECT ON lumen.roles, lumen.user_roles, lumen.app_users TO lumen_read;
`;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  log('migration_start', { startedAt: new Date().toISOString(), dryRun, feature: 'user-roles' });

  let sql;
  try {
    const require = createRequire(import.meta.url);
    const postgres = require('postgres');
    sql = postgres(loadAdminUrl(), { prepare: false, max: 1 });
  } catch (err) {
    log('migration_fatal', { message: scrub(err.message) });
    process.exit(1);
  }

  const check = (name, expected, actual) => {
    const pass = JSON.stringify(expected) === JSON.stringify(actual);
    log('invariant_check', { name, expected, actual, pass });
    if (!pass) throw new Error(`invariant failed: ${name}`);
  };

  let exitCode = 0;
  try {
    await assertSessionMode(sql);

    // D1 precondition: the connecting role MUST be bypassrls with auth USAGE,
    // or the view silently returns 0 rows (auth.users RLS-enabled, 0 policies).
    const [owner] = await sql`
      SELECT current_user AS role, rolbypassrls,
             has_schema_privilege(current_user, 'auth', 'USAGE') AS auth_usage
      FROM pg_roles WHERE rolname = current_user`;
    check('bridge_owner_bypassrls', true, owner.rolbypassrls);
    check('bridge_owner_auth_usage', true, owner.auth_usage);

    await sql.begin(async (tx) => {
      await tx.unsafe(USER_ROLES_DDL);

      // the admin role seed exists with the right entitlement
      const [role] = await tx`SELECT entitlements FROM lumen.roles WHERE slug = 'admin'`;
      check('admin_role_seeded', ['admin.users'], role.entitlements);

      // CR-2: assert the view's ACTUAL post-DDL state — owner must be
      // bypassrls (or auth.users' RLS-on/0-policies filter silently empties
      // the bridge) and security_invoker must be pinned false.
      const [view] = await tx`
        SELECT r.rolname AS owner, r.rolbypassrls,
               COALESCE(c.reloptions @> ARRAY['security_invoker=false'], false) AS invoker_off
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_roles r ON r.oid = c.relowner
        WHERE n.nspname = 'lumen' AND c.relname = 'app_users'`;
      log('app_users_owner', { owner: view?.owner });
      check('app_users_owner_bypassrls', true, view?.rolbypassrls ?? false);
      check('app_users_security_invoker_off', true, view?.invoker_off ?? false);

      // CR-5: the DENIAL half of the bridge — the app role must NOT be able
      // to reach the auth schema directly.
      const [neg] = await tx`
        SELECT has_schema_privilege('lumen_read', 'auth', 'USAGE') AS auth_usage`;
      check('lumen_read_no_auth_usage', false, neg.auth_usage);

      // the bridge actually returns — INFORMATIONAL ONLY (CR-6): 0 broken and
      // 0 users look identical here; the CR-2 owner check above is the guard
      const [bridge] = await tx`SELECT count(*)::int AS n FROM lumen.app_users`;
      log('bridge_probe', { app_users_rows: bridge.n });

      // lumen_read got SELECT on all three, and nothing more (DISTINCT: two
      // grantors would otherwise duplicate privilege_type and false-fail, CR-8)
      const grants = await tx`
        SELECT table_name, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
        FROM information_schema.role_table_grants
        WHERE grantee = 'lumen_read' AND table_schema = 'lumen'
          AND table_name IN ('roles', 'user_roles', 'app_users')
        GROUP BY table_name ORDER BY table_name`;
      check(
        'lumen_read_select_only',
        [
          { table_name: 'app_users', privs: 'SELECT' },
          { table_name: 'roles', privs: 'SELECT' },
          { table_name: 'user_roles', privs: 'SELECT' },
        ],
        grants.map((g) => ({ table_name: g.table_name, privs: g.privs })),
      );

      if (dryRun) throw new Error('DRY_RUN_ROLLBACK');
    }).catch((e) => {
      if (e.message !== 'DRY_RUN_ROLLBACK') throw e;
      log('dry_run_rollback', { note: 'all checks passed, nothing committed' });
    });

    log('migration_done', { dryRun });
  } catch (err) {
    exitCode = 1;
    log('migration_fatal', { message: scrub(err.message) });
  } finally {
    await sql.end();
  }
  process.exit(exitCode);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
