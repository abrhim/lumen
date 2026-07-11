// Grant a role to a user (user-roles D11 — how Abram becomes admin #1).
//   node --import tsx scripts/grant-role.mjs <email> <role> [--dry-run]
//
// --import tsx is REQUIRED: the entitlement keys are imported from the F13
// TypeScript source of truth (apps/web/app/lib/entitlements-keys.ts) so the
// script validates grants against the exact set the runtime gates on — a
// typo'd key must fail loudly HERE, not silently-closed at runtime (D5/H6b).
//
// Requires an ADMIN session-mode connection: DATABASE_URL in the repo-root
// .env (port 5432) — resolves the email against auth.users, which the app
// role cannot read. Writes ONLY lumen.user_roles (D3: no JWT stamp, no
// auth.users write). Idempotent (ON CONFLICT DO NOTHING).
// Exit codes: 0 success, 1 fatal/validation/invariant-abort.
//
// Plan: docs/features/user-roles/plan.md (D5, D11); harness H6/H6b.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scrub, assertSessionMode, loadAdminUrl } from './migrate-user-roles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function log(event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

/** argv → {email, role, dryRun} or {error} — pure, unit-tested (H6). */
export function parseArgs(argv) {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const dryRun = argv.includes('--dry-run');
  const [email, role] = positional;
  if (!email || !role) return { error: 'usage: node --import tsx scripts/grant-role.mjs <email> <role> [--dry-run]' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: `"${email}" is not an email address` };
  if (!/^[a-z][a-z0-9-]*$/.test(role)) return { error: `"${role}" is not a role slug (lowercase kebab)` };
  return { email, role, dryRun };
}

/** Role-row decision (H6b): the role must exist and every entitlement it
 * grants must be a known key from the F13 shared source — refuse unknowns
 * loudly at grant time (D5). Pure, unit-tested. */
export function decideRole(roleRow, knownEntitlements) {
  if (!roleRow) return { ok: false, code: 'unknown_role' };
  const known = new Set(knownEntitlements);
  const unknown = (roleRow.entitlements ?? []).filter((k) => !known.has(k));
  if (unknown.length > 0) return { ok: false, code: 'unknown_entitlement_keys', unknown };
  return { ok: true };
}

/** Email-resolution decision (H6): exactly one live auth.users row. Pure. */
export function decideUser(userRows) {
  if (!userRows || userRows.length === 0) return { ok: false, code: 'unknown_email' };
  if (userRows.length > 1) return { ok: false, code: 'ambiguous_email', count: userRows.length };
  return { ok: true, userId: userRows[0].id };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    log('grant_fatal', { message: parsed.error });
    process.exit(1);
  }
  const { email, role, dryRun } = parsed;
  log('grant_start', { startedAt: new Date().toISOString(), role, dryRun, operator: process.env.USER ?? null });

  // F13: the same list the runtime gates on. Needs the tsx loader.
  let ENTITLEMENTS;
  try {
    ({ ENTITLEMENTS } = await import(join(ROOT, 'apps/web/app/lib/entitlements-keys.ts')));
  } catch (err) {
    log('grant_fatal', {
      message: `cannot import entitlements-keys.ts (${scrub(err.message)}) — run with: node --import tsx scripts/grant-role.mjs`,
    });
    process.exit(1);
  }

  let sql;
  try {
    const require = createRequire(import.meta.url);
    const postgres = require('postgres');
    sql = postgres(loadAdminUrl(), { prepare: false, max: 1 });
  } catch (err) {
    log('grant_fatal', { message: scrub(err.message) });
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

    await sql.begin(async (tx) => {
      // H6b/D5: role exists and grants only known keys — nothing written otherwise
      const [roleRow] = await tx`SELECT slug, entitlements FROM lumen.roles WHERE slug = ${role}`;
      const roleDecision = decideRole(roleRow, ENTITLEMENTS);
      if (!roleDecision.ok) {
        log('grant_refused', { code: roleDecision.code, role, unknown: roleDecision.unknown ?? [] });
        throw new Error(`refused: ${roleDecision.code}`);
      }

      // H6: email → auth.users.id (admin DSN only — the app role can't read auth)
      const users = await tx`
        SELECT id FROM auth.users
        WHERE lower(email) = lower(${email}) AND deleted_at IS NULL`;
      const userDecision = decideUser(users);
      if (!userDecision.ok) {
        log('grant_refused', { code: userDecision.code, count: userDecision.count ?? 0 });
        throw new Error(`refused: ${userDecision.code}`);
      }
      const userId = userDecision.userId;

      const [before] = await tx`
        SELECT EXISTS(SELECT 1 FROM lumen.user_roles WHERE user_id = ${userId} AND role_slug = ${role}) AS present`;

      // idempotent upsert; granted_by stays NULL for script grants (no in-app
      // admin identity exists yet — the operator is logged above instead)
      await tx`
        INSERT INTO lumen.user_roles (user_id, role_slug)
        VALUES (${userId}, ${role})
        ON CONFLICT (user_id, role_slug) DO NOTHING`;
      log('grant_upsert', { alreadyPresent: before.present });

      // the grant is actually visible where the runtime will look for it
      const [after] = await tx`
        SELECT EXISTS(SELECT 1 FROM lumen.user_roles WHERE user_id = ${userId} AND role_slug = ${role}) AS present`;
      check('grant_present', true, after.present);
      const ents = await tx`
        SELECT DISTINCT unnest(r.entitlements) AS ent
        FROM lumen.user_roles ur JOIN lumen.roles r ON r.slug = ur.role_slug
        WHERE ur.user_id = ${userId} ORDER BY ent`;
      log('user_entitlements_now', { entitlements: ents.map((e) => e.ent) });

      if (dryRun) throw new Error('DRY_RUN_ROLLBACK');
    }).catch((e) => {
      if (e.message !== 'DRY_RUN_ROLLBACK') throw e;
      log('dry_run_rollback', { note: 'all checks passed, nothing committed' });
    });

    log('grant_done', { role, dryRun });
  } catch (err) {
    exitCode = 1;
    log('grant_fatal', { message: scrub(err.message) });
  } finally {
    await sql.end();
  }
  process.exit(exitCode);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
