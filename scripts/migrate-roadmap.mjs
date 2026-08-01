#!/usr/bin/env node
/**
 * Roadmap features + votes (Abram, 2026-08-01). Editorial features
 * (admin-curated, world-readable) with Comeau-style multi-votes: an
 * authed user can press up to VOTE_CAP times per feature; standings are
 * SUM(count), public. Idempotent; run with ADMIN_DATABASE_URL or
 * DATABASE_URL (repo-root .env).
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
	console.error('migrate-roadmap: DATABASE_URL required');
	process.exit(1);
}

const VOTE_CAP = 10;

const DDL = `
CREATE TABLE IF NOT EXISTS lumen.roadmap_features (
	id          text PRIMARY KEY,
	title       text NOT NULL,
	detail      text,
	state       text NOT NULL DEFAULT 'proposed'
	            CHECK (state IN ('proposed','planned','building','shipped','declined')),
	sort_order  int,
	created_at  timestamptz NOT NULL DEFAULT now(),
	started_at  timestamptz,
	shipped_at  timestamptz,
	CONSTRAINT roadmap_title_len CHECK (char_length(title) <= 120),
	CONSTRAINT roadmap_detail_len CHECK (char_length(detail) <= 500),
	CONSTRAINT roadmap_id_shape CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE IF NOT EXISTS lumen.roadmap_votes (
	feature_id  text NOT NULL REFERENCES lumen.roadmap_features(id) ON DELETE CASCADE,
	voter_id    uuid NOT NULL,
	count       int  NOT NULL DEFAULT 1 CHECK (count >= 1 AND count <= ${VOTE_CAP}),
	created_at  timestamptz NOT NULL DEFAULT now(),
	updated_at  timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (feature_id, voter_id)
);
CREATE INDEX IF NOT EXISTS roadmap_votes_feature_idx ON lumen.roadmap_votes (feature_id);

-- state transitions stamp their dates; dates never drift from states
CREATE OR REPLACE FUNCTION lumen.roadmap_stamp_state() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.state = 'building' AND NEW.started_at IS NULL THEN NEW.started_at := now(); END IF;
	IF NEW.state = 'shipped' AND NEW.shipped_at IS NULL THEN NEW.shipped_at := now(); END IF;
	RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS roadmap_stamp_state ON lumen.roadmap_features;
CREATE TRIGGER roadmap_stamp_state BEFORE INSERT OR UPDATE ON lumen.roadmap_features
	FOR EACH ROW EXECUTE FUNCTION lumen.roadmap_stamp_state();

-- one atomic press: insert-or-increment, capped; INVOKER so RLS applies
CREATE OR REPLACE FUNCTION lumen.roadmap_vote(p_feature_id text)
RETURNS int LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE new_count int;
BEGIN
	INSERT INTO lumen.roadmap_votes (feature_id, voter_id, count)
	VALUES (p_feature_id, (SELECT auth.uid()), 1)
	ON CONFLICT (feature_id, voter_id)
	DO UPDATE SET count = LEAST(lumen.roadmap_votes.count + 1, ${VOTE_CAP}), updated_at = now()
	RETURNING count INTO new_count;
	RETURN new_count;
END $$;

-- one retraction: decrement own count; the last press deletes the row
CREATE OR REPLACE FUNCTION lumen.roadmap_unvote(p_feature_id text)
RETURNS int LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE new_count int;
BEGIN
	UPDATE lumen.roadmap_votes
	SET count = count - 1, updated_at = now()
	WHERE feature_id = p_feature_id AND voter_id = (SELECT auth.uid()) AND count > 1
	RETURNING count INTO new_count;
	IF new_count IS NULL THEN
		DELETE FROM lumen.roadmap_votes
		WHERE feature_id = p_feature_id AND voter_id = (SELECT auth.uid());
		new_count := 0;
	END IF;
	RETURN new_count;
END $$;

ALTER TABLE lumen.roadmap_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE lumen.roadmap_votes ENABLE ROW LEVEL SECURITY;

-- features: world-readable, API-writable by NOBODY (admin curation only)
DROP POLICY IF EXISTS roadmap_features_select ON lumen.roadmap_features;
CREATE POLICY roadmap_features_select ON lumen.roadmap_features
	FOR SELECT TO anon, authenticated, lumen_read USING (true);

-- votes: authed users own their row — read/insert/update own; no deletes
DROP POLICY IF EXISTS roadmap_votes_select ON lumen.roadmap_votes;
CREATE POLICY roadmap_votes_select ON lumen.roadmap_votes
	FOR SELECT TO authenticated USING (voter_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS roadmap_votes_delete ON lumen.roadmap_votes;
CREATE POLICY roadmap_votes_delete ON lumen.roadmap_votes
	FOR DELETE TO authenticated USING (voter_id = (SELECT auth.uid()));
-- the app server aggregates COUNTS over lumen_read; voter ids never
-- serialize to clients (loader discipline, enforced in roadmap.server)
DROP POLICY IF EXISTS roadmap_votes_read_server ON lumen.roadmap_votes;
CREATE POLICY roadmap_votes_read_server ON lumen.roadmap_votes
	FOR SELECT TO lumen_read USING (true);
DROP POLICY IF EXISTS roadmap_votes_insert ON lumen.roadmap_votes;
CREATE POLICY roadmap_votes_insert ON lumen.roadmap_votes
	FOR INSERT TO authenticated WITH CHECK (voter_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS roadmap_votes_update ON lumen.roadmap_votes;
CREATE POLICY roadmap_votes_update ON lumen.roadmap_votes
	FOR UPDATE TO authenticated
	USING (voter_id = (SELECT auth.uid()))
	WITH CHECK (voter_id = (SELECT auth.uid()));

-- grants: PostgREST roles read features; votes go through the RPC (and
-- bounded direct DML on own rows); lumen_read aggregates counts server-side
GRANT USAGE ON SCHEMA lumen TO anon, authenticated;
GRANT SELECT ON lumen.roadmap_features TO anon, authenticated, lumen_read;
GRANT SELECT, INSERT, UPDATE, DELETE ON lumen.roadmap_votes TO authenticated;
GRANT SELECT ON lumen.roadmap_votes TO lumen_read;
REVOKE ALL ON lumen.roadmap_votes FROM anon;
REVOKE EXECUTE ON FUNCTION lumen.roadmap_vote(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION lumen.roadmap_unvote(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lumen.roadmap_vote(text) TO authenticated;
GRANT EXECUTE ON FUNCTION lumen.roadmap_unvote(text) TO authenticated;
`;

const SEED = [
	// state, sort, id, title
	['building', 1, 'layout-consistency', 'Consistent layout and typography on every page'],
	['building', 2, 'sign-in-with-google', 'Sign in with Google'],
	['planned', 1, 'feedback-form', 'A feedback form'],
	['planned', 2, 'tags-on-notes', 'Tags on notes, with colors'],
	['proposed', null, 'references-panel', 'A references panel on notes: read a linked source in full without leaving the note'],
	['proposed', null, 'licensed-cross-references', 'Replace generated cross-references with a licensed set'],
	['proposed', null, 'scripture-citation-index', 'The Scripture Citation Index'],
	['proposed', null, 'gc-talk-sources', 'Link General Conference talks as sources'],
	['proposed', null, 'home-resume', 'Home page: resume where you left off, recent activity'],
	['proposed', null, 'collection-summaries', 'Summary pages for collections'],
	['proposed', null, 'graph-explore', 'More ways to explore the graph'],
	['shipped', 1, 'personal-notes', 'Notes, with links to verses, people, episodes, other notes, and web pages'],
	['shipped', 2, 'guest-writing', 'Writing works signed out; an account is only needed to save'],
	['shipped', 3, 'global-nav', 'Global navigation, and a settings page'],
	['shipped', 4, 'strongs-and-art', "Browse pages for Strong's and for art"],
];

const client = new pg.Client({ connectionString: dsn });
await client.connect();
try {
	await client.query('BEGIN');
	await client.query(DDL);
	for (const [state, sort, id, title] of SEED) {
		await client.query(
			`INSERT INTO lumen.roadmap_features (id, title, state, sort_order)
			 VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
			[id, title, state, sort],
		);
	}
	await client.query('COMMIT');
} catch (err) {
	await client.query('ROLLBACK');
	console.error('migrate-roadmap: FAILED —', err.message);
	process.exit(1);
}

// invariants
const checks = [
	['features table + RLS', `SELECT relrowsecurity FROM pg_class WHERE oid = 'lumen.roadmap_features'::regclass`, (r) => r[0].relrowsecurity === true],
	['votes table + RLS', `SELECT relrowsecurity FROM pg_class WHERE oid = 'lumen.roadmap_votes'::regclass`, (r) => r[0].relrowsecurity === true],
	['6 policies across the two tables', `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='lumen' AND tablename IN ('roadmap_features','roadmap_votes')`, (r) => r[0].n === 6],
	['anon holds no vote DML', `SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_schema='lumen' AND table_name='roadmap_votes' AND grantee='anon'`, (r) => r[0].n === 0],
	['authenticated cannot write features', `SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_schema='lumen' AND table_name='roadmap_features' AND grantee='authenticated' AND privilege_type <> 'SELECT'`, (r) => r[0].n === 0],
	['vote RPC exists, anon lacks EXECUTE', `SELECT count(*)::int AS n FROM information_schema.routine_privileges WHERE routine_schema='lumen' AND routine_name='roadmap_vote' AND grantee='anon'`, (r) => r[0].n === 0],
	['seed present', `SELECT count(*)::int AS n FROM lumen.roadmap_features`, (r) => r[0].n >= 15],
	['count cap constraint', `SELECT count(*)::int AS n FROM information_schema.check_constraints WHERE constraint_schema='lumen' AND check_clause LIKE '%${VOTE_CAP}%'`, (r) => r[0].n >= 1],
];
let bad = 0;
for (const [name, q, ok] of checks) {
	const { rows } = await client.query(q);
	if (ok(rows)) console.log(`  ✓ ${name}`);
	else { bad += 1; console.error(`  ✗ ${name}: ${JSON.stringify(rows)}`); }
}
await client.end();
if (bad) { console.error(`migrate-roadmap: ${bad} invariant(s) FAILED`); process.exit(1); }
console.log('migrate-roadmap: OK');
