// Harness (user-roles H6/H6b): grant-role pure decision functions — arg
// parsing, role/entitlement validation (D5: unknown keys refuse loudly),
// email resolution. The DB-path behaviors (dry-run rollback, upsert) reuse
// the migrate-user-roles.mjs transaction pattern and are exercised live at
// grant time (D12).
// Run: node --import tsx --test scripts/__tests__/grant-role.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, decideRole, decideUser } from '../grant-role.mjs';
import { USER_ROLES_DDL } from '../migrate-user-roles.mjs';
import { ENTITLEMENTS } from '../../apps/web/app/lib/entitlements-keys.ts';

test('parseArgs: happy path, dry-run flag, positional order (H6)', () => {
  assert.deepEqual(parseArgs(['abram@soar.com', 'admin']), {
    email: 'abram@soar.com',
    role: 'admin',
    dryRun: false,
  });
  assert.deepEqual(parseArgs(['abram@soar.com', 'admin', '--dry-run']), {
    email: 'abram@soar.com',
    role: 'admin',
    dryRun: true,
  });
  // flag position doesn't matter
  assert.equal(parseArgs(['--dry-run', 'a@b.co', 'admin']).dryRun, true);
});

test('parseArgs: missing/invalid args → error (exit-1 path, H6)', () => {
  assert.ok(parseArgs([]).error);
  assert.ok(parseArgs(['abram@soar.com']).error);
  assert.ok(parseArgs(['not-an-email', 'admin']).error);
  assert.ok(parseArgs(['a@b.co', 'Admin']).error); // uppercase — not a slug
  assert.ok(parseArgs(['a@b.co', '-admin']).error); // must start alpha
});

test('parseArgs: unknown --flag fails LOUDLY, never silently drops to a real grant (B7)', () => {
  // a --dry-run typo must NOT fall through to dryRun:false and commit for real
  for (const typo of ['--dryrun', '--dry_run', '--dry-run=true', '--DRY-RUN', '--force']) {
    const r = parseArgs(['a@b.co', 'admin', typo]);
    assert.ok(r.error, `expected ${typo} to error`);
    assert.match(r.error, /unknown flag/);
  }
  // the exact flag still works
  assert.equal(parseArgs(['a@b.co', 'admin', '--dry-run']).dryRun, true);
});

test('decideRole: unknown role slug → refuse (H6)', () => {
  assert.deepEqual(decideRole(undefined, ENTITLEMENTS), { ok: false, code: 'unknown_role' });
});

test('decideRole: role granting an UNKNOWN entitlement key → refuse, keys listed (H6b/D5)', () => {
  const d = decideRole({ slug: 'admin', entitlements: ['admin.users', 'admin.typo'] }, ENTITLEMENTS);
  assert.equal(d.ok, false);
  assert.equal(d.code, 'unknown_entitlement_keys');
  assert.deepEqual(d.unknown, ['admin.typo']);
});

test('decideRole: all-known keys → ok; empty entitlements → ok (grants nothing, refuses nothing)', () => {
  assert.deepEqual(decideRole({ slug: 'admin', entitlements: ['admin.users'] }, ENTITLEMENTS), { ok: true });
  assert.deepEqual(decideRole({ slug: 'reader', entitlements: [] }, ENTITLEMENTS), { ok: true });
  assert.deepEqual(decideRole({ slug: 'reader', entitlements: null }, ENTITLEMENTS), { ok: true });
});

test('decideUser: unknown email → refuse; ambiguous → refuse; exactly one → ok (H6)', () => {
  assert.deepEqual(decideUser([]), { ok: false, code: 'unknown_email' });
  assert.deepEqual(decideUser([{ id: 'u1' }, { id: 'u2' }]), {
    ok: false,
    code: 'ambiguous_email',
    count: 2,
  });
  assert.deepEqual(decideUser([{ id: 'u1' }]), { ok: true, userId: 'u1' });
});

test('drift tripwire: every entitlement key seeded by the migration DDL is a known F13 key', () => {
  // the seed and the shared source must never drift — a key added to the DDL
  // without entering entitlements-keys.ts would be granted in the DB but
  // filtered (and only logged) at runtime
  const known = new Set(ENTITLEMENTS);
  const arrays = [...USER_ROLES_DDL.matchAll(/ARRAY\[([^\]]*)\]/g)];
  assert.ok(arrays.length > 0, 'expected at least one ARRAY[...] seed in the DDL');
  for (const [, inner] of arrays) {
    for (const key of inner.split(',').map((s) => s.trim().replace(/^'|'$/g, ''))) {
      assert.ok(known.has(key), `DDL seeds unknown entitlement key: ${key}`);
    }
  }
});
