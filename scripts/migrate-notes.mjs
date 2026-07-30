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
//  - authenticated gets USAGE + table-scoped CRUD on EXACTLY the two notes
//    tables (notes: no DELETE — the app only soft-deletes; anchors: no
//    UPDATE — immutable).
//  - lumen.notes/note_anchors: explicit REVOKE from lumen_read + anon —
//    setup-readonly-role.sql:16's ALTER DEFAULT PRIVILEGES auto-granted
//    SELECT to lumen_read at CREATE (CF-9: "don't write a GRANT" is not
//    "no grant exists").
//  - Idempotent negative-space revokes on the sensitive relations from BOTH
//    API roles, and no PUBLIC EXECUTE on future lumen functions.
export const GRANTS_SQL = `
GRANT USAGE ON SCHEMA lumen TO authenticated;
GRANT SELECT, INSERT, UPDATE ON lumen.notes TO authenticated;
GRANT SELECT, INSERT, DELETE ON lumen.note_anchors TO authenticated;

REVOKE ALL ON lumen.notes, lumen.note_anchors FROM lumen_read, anon;

REVOKE ALL ON lumen.app_users, lumen.user_roles, lumen.roles, lumen.migration_state
  FROM authenticated, anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA lumen REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION lumen.create_note_with_anchors(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lumen.create_note_with_anchors(text, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION lumen.soft_delete_note(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lumen.soft_delete_note(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION lumen.set_updated_at() FROM PUBLIC, anon, authenticated;
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
		name: 'lumen_read_anon_zero_grants_on_notes_tables',
		sql: `SELECT count(*) = 0 AS pass
      FROM information_schema.role_table_grants
      WHERE table_schema = 'lumen' AND table_name IN ('notes','note_anchors')
        AND grantee IN ('lumen_read','anon')`,
	},
	{
		name: 'authenticated_exact_grant_shape',
		sql: `SELECT
        (SELECT array_agg(privilege_type::text ORDER BY privilege_type::text)
         FROM information_schema.role_table_grants
         WHERE table_schema='lumen' AND table_name='notes' AND grantee='authenticated')
        = ARRAY['INSERT','SELECT','UPDATE']
      AND
        (SELECT array_agg(privilege_type::text ORDER BY privilege_type::text)
         FROM information_schema.role_table_grants
         WHERE table_schema='lumen' AND table_name='note_anchors' AND grantee='authenticated')
        = ARRAY['DELETE','INSERT','SELECT'] AS pass`,
	},
	{
		name: 'authenticated_anon_zero_grants_elsewhere_in_lumen',
		sql: `SELECT count(*) = 0 AS pass
      FROM information_schema.role_table_grants
      WHERE table_schema = 'lumen' AND grantee IN ('authenticated','anon')
        AND table_name NOT IN ('notes','note_anchors')`,
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
		name: 'create_rpc_present_and_invoker',
		sql: `SELECT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'lumen' AND p.proname = 'create_note_with_anchors'
        AND NOT p.prosecdef
    ) AS pass`,
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
