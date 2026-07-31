// Migration (personal-notes A6/A7): lumen.notes + lumen.note_anchors + RLS
// + create_note_with_anchors RPC. House style (migrate-media-collections.mjs
// conventions verbatim): exported DDL, DRY_RUN default with COMMIT=1 gate,
// one-transaction DDL, JSON-line events, named invariants, scrubSecrets.
//   node scripts/migrate-notes.mjs            # dry-run
//   COMMIT=1 node scripts/migrate-notes.mjs   # apply
// Exit 0 success/clean, 1 fatal, 2 invariant failure.
//
// Deployment order (A16): this migration + smoke-notes-rls green FIRST, then
// the Supabase exposed-schemas config change (dashboard — add `lumen`) with a
// curl probe, THEN the worker deploy. Signed-out /api/search byte-diff after.
//
// Rollback (BLAST-7): the schema is purely ADDITIVE — `wrangler rollback`
// stays safe at every step. DROP TABLE lumen.note_anchors, lumen.notes is
// legitimate ONLY while the only rows are smoke rows; that window closes at
// the first real user note, after which it is roll-forward-only (dropping
// the tables is user-data destruction).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scrubSecrets } from './ingest-podcast/util.mjs';

// A6 (CF-6/9/10/11/24/32/33/36/38/39/53). Notes:
//  - owner_id: NOT NULL DEFAULT auth.uid(), FK → auth.users ON DELETE CASCADE
//    (account deletion never strands personal notes — CF-24).
//  - UNIQUE (id, owner_id) exists so the anchors composite FK can make
//    cross-owner anchor forgery STRUCTURALLY impossible (CF-11 — plain FK
//    existence checks bypass RLS).
//  - search: GENERATED english tsvector (CF-33: config pinned; the app's
//    call shape is textSearch('search', q, {config:'english',type:'websearch'})).
//  - body cap 64 KiB (CF-32, gate-ratified) — well under the tsvector cliff.
//  - note_anchors is IMMUTABLE: no updated_at, no UPDATE grant, no UPDATE
//    policy (CF-53 — an anchor "update" is semantically delete+insert).
//  - soft-delete is enforced at RLS (CF-10): SELECT policies hide tombstones
//    (anchors via EXISTS-live-note), UPDATE USING carries deleted_at IS NULL.
export const NOTES_DDL = `
CREATE TABLE IF NOT EXISTS lumen.notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  body_md    text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  search     tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(body_md, ''))) STORED,
  CONSTRAINT notes_body_size CHECK (octet_length(body_md) <= 65536),
  CONSTRAINT notes_id_owner_uniq UNIQUE (id, owner_id)
);
COMMENT ON COLUMN lumen.notes.deleted_at IS
  'Purge deadline, not an archive: rows are purgeable once deleted_at < now() - interval ''30 days''. No v1 purge job; no user-facing retention promise (CF-36).';

-- Recorded deviation from A5's projection: the reader-rail register needs a
-- derived TITLE per anchored note, and the pinned one-call anchors fetch may
-- never ship bodies (CF-52). A bounded generated first-line column lets the
-- anchors embed carry ≤120 chars instead of the body; the client strips
-- markdown from it with the shared stripper (A14).
ALTER TABLE lumen.notes ADD COLUMN IF NOT EXISTS title_line text
  GENERATED ALWAYS AS (left(split_part(body_md, E'\n', 1), 120)) STORED;

CREATE TABLE IF NOT EXISTS lumen.note_anchors (
  note_id    uuid NOT NULL,
  owner_id   uuid NOT NULL DEFAULT auth.uid(),
  kind       text NOT NULL CHECK (kind IN ('verse', 'chapter', 'entity', 'transcript')),
  ref_id     text NOT NULL CHECK (char_length(ref_id) <= 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, kind, ref_id),
  CONSTRAINT note_anchors_note_owner_fk
    FOREIGN KEY (note_id, owner_id) REFERENCES lumen.notes (id, owner_id) ON DELETE CASCADE
);
COMMENT ON TABLE lumen.note_anchors IS
  'Immutable rows (no UPDATE grant/policy by design — CF-53); ownership agreement with the note is structural via the composite FK (CF-11).';

-- Indexes: exactly these four objects (incl. notes_id_owner_uniq above).
-- Deliberate omissions (DATA-5): no standalone owner_id index
-- (idx_notes_owner_recent prefix covers it); no note_id index on anchors
-- (PK prefix covers it). Partial predicates match the RLS-injected
-- deleted_at IS NULL qual, which is what makes them eligible.
CREATE INDEX IF NOT EXISTS idx_notes_owner_recent
  ON lumen.notes (owner_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notes_search
  ON lumen.notes USING gin (search) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_note_anchors_owner_ref
  ON lumen.note_anchors (owner_id, kind, ref_id);

-- First updated_at trigger in the repo (CF-53): one generic function,
-- notes-only trigger. collections' drift-on-update stays as-is.
CREATE OR REPLACE FUNCTION lumen.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS notes_set_updated_at ON lumen.notes;
CREATE TRIGGER notes_set_updated_at
  BEFORE UPDATE ON lumen.notes
  FOR EACH ROW EXECUTE FUNCTION lumen.set_updated_at();

ALTER TABLE lumen.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lumen.notes FORCE ROW LEVEL SECURITY;
ALTER TABLE lumen.note_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE lumen.note_anchors FORCE ROW LEVEL SECURITY;

-- Four explicit per-command policies on notes, three on anchors (no UPDATE
-- — deliberate), all TO authenticated, initplan idiom (CF-38 style).
DROP POLICY IF EXISTS notes_select ON lumen.notes;
CREATE POLICY notes_select ON lumen.notes FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND deleted_at IS NULL);
DROP POLICY IF EXISTS notes_insert ON lumen.notes;
CREATE POLICY notes_insert ON lumen.notes FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS notes_update ON lumen.notes;
CREATE POLICY notes_update ON lumen.notes FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND deleted_at IS NULL)
  WITH CHECK (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS notes_delete ON lumen.notes;
-- Dormant by design: no DELETE grant on lumen.notes exists (the absent grant
-- is the wall, pinned by authenticated_exact_grant_shape). CP-57 recorded
-- SAFER PATH: if a purge / hard-delete feature is ever built (the ratified
-- trash-restore consequence), add "AND deleted_at IS NULL" to this USING
-- clause in THAT migration and update the invariant in the same commit.
CREATE POLICY notes_delete ON lumen.notes FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS note_anchors_select ON lumen.note_anchors;
CREATE POLICY note_anchors_select ON lumen.note_anchors FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM lumen.notes n
      WHERE n.id = note_id AND n.deleted_at IS NULL
    )
  );
DROP POLICY IF EXISTS note_anchors_insert ON lumen.note_anchors;
CREATE POLICY note_anchors_insert ON lumen.note_anchors FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS note_anchors_delete ON lumen.note_anchors;
CREATE POLICY note_anchors_delete ON lumen.note_anchors FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

-- CF-10 under real Postgres semantics (harness-revision, sanctioned
-- 2026-07-30): an UPDATE's NEW row is checked against the SELECT policies
-- whenever the statement reads the table (any WHERE clause) — verified
-- empirically here: WITH CHECK (true) still rejects, relaxing the SELECT
-- policy alone accepts. Since our SELECT policy hides tombstones BY
-- DESIGN, no same-role UPDATE (PostgREST, RPC-invoker, or plain SQL) can
-- ever create one. Soft delete is therefore SECURITY DEFINER (owner:
-- postgres, BYPASSRLS): the explicit owner/live predicate below carries
-- the entire security boundary — it mirrors the notes_update policy
-- verbatim. anon/PUBLIC hold no EXECUTE; auth.uid() IS NULL matches
-- nothing (owner_id is NOT NULL).
CREATE OR REPLACE FUNCTION lumen.soft_delete_note(p_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_count integer;
BEGIN
  UPDATE lumen.notes SET deleted_at = now()
  WHERE id = p_id
    AND owner_id = auth.uid()
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;

-- A7 (CF-25): create is ONE transaction. SECURITY INVOKER — RLS applies in
-- full; owner_id is auth.uid() via column default, never caller-supplied.
-- Anchor inserts are idempotent (double-capture safe).
CREATE OR REPLACE FUNCTION lumen.create_note_with_anchors(p_body_md text, p_anchors jsonb DEFAULT '[]'::jsonb)
RETURNS lumen.notes
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_note lumen.notes;
BEGIN
  INSERT INTO lumen.notes (body_md) VALUES (p_body_md) RETURNING * INTO v_note;
  INSERT INTO lumen.note_anchors (note_id, owner_id, kind, ref_id)
  SELECT v_note.id, v_note.owner_id, a.value->>'kind', a.value->>'ref_id'
  FROM jsonb_array_elements(coalesce(p_anchors, '[]'::jsonb)) AS a
  ON CONFLICT DO NOTHING;
  RETURN v_note;
END
$fn$;
`;

// A6 exposure discipline (CF-6/CF-9): the grant surface is the dangerous
// half of exposing schema `lumen` to PostgREST.
//  - authenticated gets USAGE + COLUMN-scoped CRUD on EXACTLY the two notes
//    tables (notes: no DELETE — the app only soft-deletes; anchors: no
//    UPDATE — immutable).
//  - lumen.notes/note_anchors: explicit REVOKE from lumen_read + anon —
//    setup-readonly-role.sql:16's ALTER DEFAULT PRIVILEGES auto-granted
//    SELECT to lumen_read at CREATE (CF-9: "don't write a GRANT" is not
//    "no grant exists"). B19/CP-20: that default-privilege ENTRY is now
//    neutralized too, so the next CREATE TABLE lumen.* cannot re-open D3.
//  - Idempotent negative-space revokes on the sensitive relations from BOTH
//    API roles, and no EXECUTE anywhere in lumen beyond the two app RPCs.
export const GRANTS_SQL = `
GRANT USAGE ON SCHEMA lumen TO authenticated;

-- B27/CP-28 (DATA-4): table-wide INSERT/UPDATE let an authenticated user
-- stamp created_at, INSERT a born-dead row (deleted_at pre-set — invisible
-- to every code path, dodging the app entirely), or fight the updated_at
-- trigger that LWW ordering depends on, all on their OWN rows. Grant exactly
-- the columns the app writes. REVOKE ALL first: revoking a table-level
-- privilege also drops its column-level descendants, so re-runs converge.
REVOKE ALL ON lumen.notes, lumen.note_anchors FROM authenticated;
GRANT SELECT ON lumen.notes TO authenticated;
GRANT INSERT (body_md) ON lumen.notes TO authenticated;
-- deleted_at stays UPDATE-able for the ratified trash/restore consequence.
-- It is NOT a tombstone-forging vector: an UPDATE that sets it is checked
-- against the tombstone-hiding SELECT policy (harness-revision 1, verified
-- empirically), so no statement from the authenticated role can commit one —
-- soft delete is the SECURITY DEFINER RPC precisely because of that.
GRANT UPDATE (body_md, deleted_at) ON lumen.notes TO authenticated;
GRANT SELECT, DELETE ON lumen.note_anchors TO authenticated;
GRANT INSERT (note_id, owner_id, kind, ref_id) ON lumen.note_anchors TO authenticated;

REVOKE ALL ON lumen.notes, lumen.note_anchors FROM lumen_read, anon;

-- B19/CP-20 (SEC-3): setup-readonly-role.sql:16 left an
-- \`ALTER DEFAULT PRIVILEGES IN SCHEMA lumen GRANT SELECT ON TABLES TO
-- lumen_read\` entry in place — every FUTURE lumen table (note_versions,
-- trash/restore, shares) would be auto-granted SELECT to the app's shared
-- search credential with no assertion between it and prod. Neutralize the
-- entry itself. Default-privilege entries are grantor-scoped: this must run
-- as the role that created it (postgres — the migration's admin DSN).
-- Already-granted per-table SELECTs elsewhere in lumen are untouched;
-- lumen_read keeps reading the canon tables it was built for.
ALTER DEFAULT PRIVILEGES IN SCHEMA lumen REVOKE SELECT ON TABLES FROM lumen_read;

REVOKE ALL ON lumen.app_users, lumen.user_roles, lumen.roles, lumen.migration_state
  FROM authenticated, anon;

-- B20/CP-21 (SEC-2/BR-7): \`GRANT USAGE ON SCHEMA lumen\` + Postgres' default
-- PUBLIC EXECUTE made every PRE-EXISTING lumen function (kjv_delta, the two
-- trigger functions) reachable as /rpc/ for any signed-in user; the
-- forward-only ALTER DEFAULT PRIVILEGES below never touched them. Sweep the
-- whole schema, then grant back exactly the two functions the app calls.
-- CONVENTION for future lumen migrations: a new function starts with no
-- EXECUTE for PUBLIC/anon/authenticated — grant it explicitly or callers
-- get 42501.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA lumen FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA lumen REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lumen.create_note_with_anchors(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION lumen.soft_delete_note(uuid) TO authenticated;
-- Named-grantee restoration of ONE pre-existing PUBLIC reach: the shipped
-- search-endpoint harness runs as lumen_read and calls lumen.kjv_delta
-- directly (search-harness.test.ts H16). PUBLIC → lumen_read converts an
-- everyone-including-anon grant into the one role that actually needs it;
-- the two trigger functions stay revoked (postgres owns and fires them).
GRANT EXECUTE ON FUNCTION lumen.kjv_delta(text) TO lumen_read;
`;

const INVARIANTS = [
	{
		name: 'notes_table_exists',
		sql: `SELECT to_regclass('lumen.notes') IS NOT NULL AS pass`,
	},
	{
		name: 'note_anchors_table_exists',
		sql: `SELECT to_regclass('lumen.note_anchors') IS NOT NULL AS pass`,
	},
	{
		name: 'rls_enabled_and_forced_both_tables',
		sql: `SELECT count(*) = 2 AS pass FROM pg_class c
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'lumen' AND c.relname IN ('notes','note_anchors')
        AND c.relrowsecurity AND c.relforcerowsecurity`,
	},
	{
		name: 'notes_policy_set_is_four_per_command',
		sql: `SELECT count(*) = 4 AND count(DISTINCT cmd) = 4 AS pass
      FROM pg_policies WHERE schemaname = 'lumen' AND tablename = 'notes'
        AND roles = '{authenticated}'`,
	},
	{
		name: 'anchors_policy_set_is_three_no_update',
		sql: `SELECT count(*) = 3 AND count(*) FILTER (WHERE cmd = 'UPDATE') = 0 AS pass
      FROM pg_policies WHERE schemaname = 'lumen' AND tablename = 'note_anchors'
        AND roles = '{authenticated}'`,
	},
	{
		// column_privileges leg added with B27: table-level REVOKEs are visible
		// in role_table_grants, but a stray column-level GRANT would not be.
		name: 'lumen_read_anon_zero_grants_on_notes_tables',
		sql: `SELECT
        (SELECT count(*) FROM information_schema.role_table_grants
         WHERE table_schema = 'lumen' AND table_name IN ('notes','note_anchors')
           AND grantee IN ('lumen_read','anon')) = 0
      AND
        (SELECT count(*) FROM information_schema.column_privileges
         WHERE table_schema = 'lumen' AND table_name IN ('notes','note_anchors')
           AND grantee IN ('lumen_read','anon')) = 0 AS pass`,
	},
	{
		// B27/CP-28: the shape is COLUMN-scoped now — notes carries only a
		// table-level SELECT; INSERT/UPDATE exist per-column. column_privileges
		// expands table-level grants across every column, so the SELECT leg is
		// deliberately asserted at table level and the write legs per column.
		name: 'authenticated_exact_grant_shape',
		sql: `SELECT
        (SELECT array_agg(privilege_type::text ORDER BY privilege_type::text)
         FROM information_schema.role_table_grants
         WHERE table_schema='lumen' AND table_name='notes' AND grantee='authenticated')
        = ARRAY['SELECT']
      AND
        (SELECT array_agg(column_name::text ORDER BY column_name::text)
         FROM information_schema.column_privileges
         WHERE table_schema='lumen' AND table_name='notes' AND grantee='authenticated'
           AND privilege_type = 'INSERT')
        = ARRAY['body_md']
      AND
        (SELECT array_agg(column_name::text ORDER BY column_name::text)
         FROM information_schema.column_privileges
         WHERE table_schema='lumen' AND table_name='notes' AND grantee='authenticated'
           AND privilege_type = 'UPDATE')
        = ARRAY['body_md','deleted_at']
      AND
        (SELECT array_agg(privilege_type::text ORDER BY privilege_type::text)
         FROM information_schema.role_table_grants
         WHERE table_schema='lumen' AND table_name='note_anchors' AND grantee='authenticated')
        = ARRAY['DELETE','SELECT']
      AND
        (SELECT array_agg(column_name::text ORDER BY column_name::text)
         FROM information_schema.column_privileges
         WHERE table_schema='lumen' AND table_name='note_anchors' AND grantee='authenticated'
           AND privilege_type = 'INSERT')
        = ARRAY['kind','note_id','owner_id','ref_id'] AS pass`,
	},
	{
		// 'PUBLIC' in the grantee filter per B20/CP-21 (BR-7): schema USAGE
		// activates a PUBLIC-grantee table grant for every API role, and the
		// two-role filter was structurally blind to it.
		name: 'authenticated_anon_public_zero_grants_elsewhere_in_lumen',
		sql: `SELECT count(*) = 0 AS pass
      FROM information_schema.role_table_grants
      WHERE table_schema = 'lumen' AND grantee IN ('authenticated','anon','PUBLIC')
        AND table_name NOT IN ('notes','note_anchors')`,
	},
	{
		// B19/CP-20: the standing footgun, pinned. setup-readonly-role.sql:16's
		// default-privilege entry must no longer name lumen_read for relations,
		// or the next CREATE TABLE lumen.* re-opens D3 silently.
		name: 'lumen_default_acl_no_lumen_read_on_tables',
		sql: `SELECT count(*) = 0 AS pass
      FROM pg_default_acl d JOIN pg_namespace n ON d.defaclnamespace = n.oid
      WHERE n.nspname = 'lumen' AND d.defaclobjtype = 'r'
        AND d.defaclacl::text LIKE '%lumen_read=%'`,
	},
	{
		// B20/CP-21: role_table_grants cannot see pg_proc.proacl at all. anon
		// must reach NO lumen function (schema USAGE + default PUBLIC EXECUTE
		// was the hole), and authenticated exactly the two the app calls.
		name: 'anon_zero_execute_on_every_lumen_function',
		sql: `SELECT count(*) = 0 AS pass
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'lumen'
        AND has_function_privilege('anon', p.oid, 'EXECUTE')`,
	},
	{
		name: 'authenticated_execute_exactly_the_two_app_rpcs',
		sql: `SELECT coalesce(array_agg(p.proname::text ORDER BY p.proname::text), ARRAY[]::text[])
        = ARRAY['create_note_with_anchors','soft_delete_note'] AS pass
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'lumen'
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')`,
	},
	{
		name: 'anchors_composite_fk_cascades',
		sql: `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'note_anchors_note_owner_fk' AND confdeltype = 'c'
    ) AS pass`,
	},
	{
		name: 'owner_fk_to_auth_users_cascades',
		sql: `SELECT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_class f ON c.confrelid = f.oid
      JOIN pg_namespace fn ON f.relnamespace = fn.oid
      WHERE t.relname = 'notes' AND fn.nspname = 'auth' AND f.relname = 'users'
        AND c.contype = 'f' AND c.confdeltype = 'c'
    ) AS pass`,
	},
	{
		name: 'body_size_check_present',
		sql: `SELECT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'notes_body_size' AND contype = 'c'
    ) AS pass`,
	},
	{
		name: 'updated_at_trigger_present',
		sql: `SELECT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'notes_set_updated_at' AND NOT tgisinternal
    ) AS pass`,
	},
	{
		// NB: snowball does NOT stem KJV -eth forms ("believeth" ≠ "believe")
		// — a normal inflection is the honest config-alignment probe.
		name: 'search_column_english_stemming',
		sql: `SELECT to_tsvector('english', 'planting seeds of faith')
      @@ websearch_to_tsquery('english', 'plant') AS pass`,
	},
	{
		// B45/CP-49(1): the EXECUTE half was pinned only on the soft-delete
		// sibling — mirrored here so the two RPC invariants are symmetric.
		name: 'create_rpc_present_and_invoker',
		sql: `SELECT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'lumen' AND p.proname = 'create_note_with_anchors'
        AND NOT p.prosecdef
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) AS pass`,
	},
	{
		// B45/CP-49(2): the single most important hardening property of a
		// DEFINER function owned by a BYPASSRLS role — and a CREATE OR REPLACE
		// that drops the clause otherwise passes every other invariant.
		name: 'both_rpcs_pin_empty_search_path',
		sql: `SELECT count(*) = 2 AS pass
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'lumen'
        AND p.proname IN ('create_note_with_anchors','soft_delete_note')
        AND p.proconfig @> ARRAY['search_path=""']`,
	},
	{
		// DEFINER by necessity (see the DDL comment): its WHERE mirrors the
		// notes_update policy; also pin that anon holds no EXECUTE on it.
		name: 'soft_delete_rpc_definer_and_anon_locked',
		sql: `SELECT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'lumen' AND p.proname = 'soft_delete_note'
        AND p.prosecdef
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) AS pass`,
	},
	{
		// B28/CP-29: the "exactly these four objects" pin lived only in the DDL
		// comment. Four pinned objects + the two implicit PKs, and nothing else
		// (a hand-applied index or a failed CREATE INDEX on re-run was
		// invisible to COMMIT=1 exit 2). The partial predicates are pinned
		// separately: they are only correct BECAUSE they match the
		// RLS-injected deleted_at IS NULL qual — dropping one silently
		// de-optimizes every list and search read.
		name: 'index_set_is_exactly_pinned',
		sql: `SELECT
        (SELECT array_agg(indexname::text ORDER BY indexname::text)
         FROM pg_indexes
         WHERE schemaname = 'lumen' AND tablename IN ('notes','note_anchors'))
        = ARRAY['idx_note_anchors_owner_ref','idx_notes_owner_recent','idx_notes_search',
                'note_anchors_pkey','notes_id_owner_uniq','notes_pkey']
      AND
        (SELECT count(*) FROM pg_index i JOIN pg_class c ON i.indexrelid = c.oid
         WHERE c.relname IN ('idx_notes_owner_recent','idx_notes_search')
           AND i.indpred IS NOT NULL) = 2 AS pass`,
	},
	{
		// B28/CP-29: the recorded A5 deviation — getChapterNoteAnchors
		// hard-codes notes(title_line) and fails at runtime if it drifts.
		name: 'title_line_generated_bounded',
		sql: `SELECT EXISTS (
      SELECT 1 FROM pg_attribute a
      JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'lumen.notes'::regclass AND a.attname = 'title_line'
        AND a.attgenerated = 's'
        AND pg_get_expr(d.adbin, d.adrelid) LIKE '%split_part(body_md%'
        AND pg_get_expr(d.adbin, d.adrelid) LIKE '%120%'
    ) AS pass`,
	},
];

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
		sql = postgres(url, { prepare: false, max: 1 });
	} catch (err) {
		console.error('FATAL:', scrubSecrets(err.message));
		process.exit(1);
	}

	try {
		await sql.begin(async (tx) => {
			await tx.unsafe(NOTES_DDL);
			await tx.unsafe(GRANTS_SQL);
			if (!commit) throw new Error('DRY_RUN_ROLLBACK');
		});
		console.log(JSON.stringify({ event: 'migration_applied', commit: true }));
	} catch (err) {
		if (err.message === 'DRY_RUN_ROLLBACK') {
			console.log(JSON.stringify({ event: 'migration_dry_run_ok', commit: false }));
		} else {
			console.error('FATAL:', scrubSecrets(err.message));
			await sql.end();
			process.exit(1);
		}
	}

	// invariants run outside the tx: post-commit they verify reality; after a
	// dry-run the table checks are expected to fail — report, don't judge.
	let failures = 0;
	for (const inv of INVARIANTS) {
		try {
			const rows = await sql.unsafe(inv.sql);
			const pass = rows[0]?.pass === true;
			console.log(JSON.stringify({ event: 'invariant_check', name: inv.name, pass }));
			if (!pass) failures += 1;
		} catch (err) {
			console.log(
				JSON.stringify({ event: 'invariant_check', name: inv.name, pass: false, error: scrubSecrets(err.message) }),
			);
			failures += 1;
		}
	}
	await sql.end();
	if (commit && failures > 0) process.exit(2);
	console.log(JSON.stringify({ event: 'migration_done', commit, invariant_failures: failures }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
