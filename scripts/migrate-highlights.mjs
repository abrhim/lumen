#!/usr/bin/env node
/**
 * Highlights (Abram, 2026-08-02) — docs/design/highlighting.md.
 *
 * Slice 1 is whole-verse marks: empty offsets, one per verse per person. The
 * offset columns ship now so the part-verse slice needs no second migration.
 *
 * Scripture text never changes, so a verse id plus two character offsets is a
 * stable anchor. That is why there is no fuzzy-anchoring machinery here.
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
	console.error('migrate-highlights: DATABASE_URL required');
	process.exit(1);
}

const DDL = `
CREATE TABLE IF NOT EXISTS lumen.highlights (
	id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	owner_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	verse_id     text NOT NULL REFERENCES lumen.verses(id) ON DELETE CASCADE,
	chapter_id   text NOT NULL REFERENCES lumen.chapters(id) ON DELETE CASCADE,
	start_offset int,
	end_offset   int,
	quote        text,
	color        text NOT NULL DEFAULT 'yellow'
	             CHECK (color IN ('yellow','green','blue','pink','grey')),
	note_id      uuid REFERENCES lumen.notes(id) ON DELETE SET NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),

	-- the verse must sit in the chapter. Stored, not derived, so a chapter
	-- lookup is one index hit; this CHECK is what stops the two drifting.
	CONSTRAINT highlight_chapter_matches CHECK (verse_id LIKE chapter_id || '-%'),

	-- empty offsets mean the whole verse; otherwise both are present
	CONSTRAINT highlight_range CHECK (
		(start_offset IS NULL AND end_offset IS NULL)
		OR (start_offset IS NOT NULL AND end_offset IS NOT NULL
		    AND start_offset >= 0 AND end_offset > start_offset)
	),
	CONSTRAINT highlight_quote_len CHECK (char_length(quote) <= 2000)
);

CREATE INDEX IF NOT EXISTS highlights_owner_chapter_idx
	ON lumen.highlights (owner_id, chapter_id);

-- one whole-verse mark per verse per person (partial: part-verse marks are free
-- to repeat, since they cover different ranges)
CREATE UNIQUE INDEX IF NOT EXISTS highlights_one_per_verse_idx
	ON lumen.highlights (owner_id, verse_id)
	WHERE start_offset IS NULL;

CREATE OR REPLACE FUNCTION lumen.highlights_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS highlights_touch ON lumen.highlights;
CREATE TRIGGER highlights_touch BEFORE UPDATE ON lumen.highlights
	FOR EACH ROW EXECUTE FUNCTION lumen.highlights_touch();

ALTER TABLE lumen.highlights ENABLE ROW LEVEL SECURITY;

-- own rows only, all four verbs. Same shape as notes.
DROP POLICY IF EXISTS highlights_select ON lumen.highlights;
CREATE POLICY highlights_select ON lumen.highlights
	FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS highlights_insert ON lumen.highlights;
CREATE POLICY highlights_insert ON lumen.highlights
	FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS highlights_update ON lumen.highlights;
CREATE POLICY highlights_update ON lumen.highlights
	FOR UPDATE TO authenticated
	USING (owner_id = (SELECT auth.uid()))
	WITH CHECK (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS highlights_delete ON lumen.highlights;
CREATE POLICY highlights_delete ON lumen.highlights
	FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON lumen.highlights TO authenticated;
REVOKE ALL ON lumen.highlights FROM anon;
-- lumen_read gets NOTHING on purpose. Highlights are read through the caller's
-- own PostgREST client, never over Hyperdrive: Hyperdrive caches reads ~60s, and
-- a person who marks a verse and reloads must see the mark at once. This is the
-- trap that made a roadmap vote read back as zero (2026-08-01).
REVOKE ALL ON lumen.highlights FROM lumen_read;
`;

const client = new pg.Client({ connectionString: dsn });
await client.connect();
try {
	await client.query('BEGIN');
	await client.query(DDL);
	await client.query('COMMIT');
} catch (err) {
	await client.query('ROLLBACK');
	console.error('migrate-highlights: FAILED —', err.message);
	process.exit(1);
}

const checks = [
	['table + RLS on', `SELECT relrowsecurity FROM pg_class WHERE oid = 'lumen.highlights'::regclass`, (r) => r[0].relrowsecurity === true],
	['four owner-scoped policies', `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='lumen' AND tablename='highlights'`, (r) => r[0].n === 4],
	['anon holds nothing', `SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_schema='lumen' AND table_name='highlights' AND grantee='anon'`, (r) => r[0].n === 0],
	['lumen_read holds nothing (Hyperdrive staleness)', `SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_schema='lumen' AND table_name='highlights' AND grantee='lumen_read'`, (r) => r[0].n === 0],
	['authenticated holds all four verbs', `SELECT count(DISTINCT privilege_type)::int AS n FROM information_schema.role_table_grants WHERE table_schema='lumen' AND table_name='highlights' AND grantee='authenticated' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')`, (r) => r[0].n === 4],
	['one whole-verse mark per verse', `SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='lumen' AND indexname='highlights_one_per_verse_idx'`, (r) => r[0].n === 1],
	['chapter CHECK holds for every verse id', `SELECT count(*)::int AS n FROM lumen.verses WHERE id NOT LIKE chapter_id || '-%'`, (r) => r[0].n === 0],
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
	console.error(`migrate-highlights: ${bad} invariant(s) FAILED`);
	process.exit(1);
}
console.log('migrate-highlights: OK');
