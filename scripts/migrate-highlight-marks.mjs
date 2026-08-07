#!/usr/bin/env node
/**
 * Highlighting v2 schema — docs/design/highlighting.md.
 *
 * v1 stored one row per verse and nothing else. A passage mark spans verses,
 * so colour, style and note stop being per-verse facts: three rows of one mark
 * could disagree about all three, and a three-verse mark got three notes.
 *
 *   highlight_marks  — the mark. Colour, style, note, quote. One row.
 *   highlight_spans  — the geometry. One row per verse the mark touches.
 *
 * v1's table is LEFT IN PLACE and its rows are copied across. The reader still
 * reads it until the code switches; a later change drops it. The v1 colour
 * CHECK is widened to the same ten so the live path keeps working meanwhile.
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
	console.error('migrate-highlight-marks: DATABASE_URL required');
	process.exit(1);
}

/** Ten, matching apps/web/app/lib/highlight-colors.ts and app.css. */
const COLORS = ['yellow', 'orange', 'red', 'pink', 'purple', 'blue', 'teal', 'green', 'brown', 'grey'];
const COLOR_SQL = COLORS.map((c) => `'${c}'`).join(',');

const DDL = `
CREATE TABLE IF NOT EXISTS lumen.highlight_marks (
	id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	owner_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	chapter_id text NOT NULL REFERENCES lumen.chapters(id) ON DELETE CASCADE,
	color      text NOT NULL,
	style      text NOT NULL DEFAULT 'highlight',
	note_id    uuid REFERENCES lumen.notes(id) ON DELETE SET NULL,
	quote      text,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT mark_quote_len CHECK (char_length(quote) <= 4000)
);

-- constraints added separately so a re-run WIDENS them; the CREATE TABLE above
-- is IF NOT EXISTS and would silently skip a changed CHECK (the trap that made
-- the v1 script un-editable)
ALTER TABLE lumen.highlight_marks DROP CONSTRAINT IF EXISTS mark_color;
ALTER TABLE lumen.highlight_marks ADD CONSTRAINT mark_color CHECK (color IN (${COLOR_SQL}));
ALTER TABLE lumen.highlight_marks DROP CONSTRAINT IF EXISTS mark_style;
ALTER TABLE lumen.highlight_marks ADD CONSTRAINT mark_style
	CHECK (style IN ('highlight','underline','text'));

CREATE TABLE IF NOT EXISTS lumen.highlight_spans (
	mark_id      uuid NOT NULL REFERENCES lumen.highlight_marks(id) ON DELETE CASCADE,
	verse_id     text NOT NULL REFERENCES lumen.verses(id) ON DELETE CASCADE,
	start_offset int NOT NULL,
	end_offset   int NOT NULL,
	PRIMARY KEY (mark_id, verse_id),
	CONSTRAINT span_range CHECK (end_offset > start_offset AND start_offset >= 0)
);

-- the reader query: my marks in this chapter, then their spans
CREATE INDEX IF NOT EXISTS highlight_marks_owner_chapter_idx
	ON lumen.highlight_marks (owner_id, chapter_id);
CREATE INDEX IF NOT EXISTS highlight_spans_verse_idx
	ON lumen.highlight_spans (verse_id);

CREATE OR REPLACE FUNCTION lumen.highlight_marks_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS highlight_marks_touch ON lumen.highlight_marks;
CREATE TRIGGER highlight_marks_touch BEFORE UPDATE ON lumen.highlight_marks
	FOR EACH ROW EXECUTE FUNCTION lumen.highlight_marks_touch();

ALTER TABLE lumen.highlight_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE lumen.highlight_spans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marks_select ON lumen.highlight_marks;
CREATE POLICY marks_select ON lumen.highlight_marks
	FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS marks_insert ON lumen.highlight_marks;
CREATE POLICY marks_insert ON lumen.highlight_marks
	FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS marks_update ON lumen.highlight_marks;
CREATE POLICY marks_update ON lumen.highlight_marks
	FOR UPDATE TO authenticated
	USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS marks_delete ON lumen.highlight_marks;
CREATE POLICY marks_delete ON lumen.highlight_marks
	FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));

-- spans carry no owner column; ownership is the mark's, checked by EXISTS so a
-- span can never be attached to, or read from, someone else's mark
DROP POLICY IF EXISTS spans_select ON lumen.highlight_spans;
CREATE POLICY spans_select ON lumen.highlight_spans
	FOR SELECT TO authenticated USING (EXISTS (
		SELECT 1 FROM lumen.highlight_marks m
		WHERE m.id = mark_id AND m.owner_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS spans_insert ON lumen.highlight_spans;
CREATE POLICY spans_insert ON lumen.highlight_spans
	FOR INSERT TO authenticated WITH CHECK (EXISTS (
		SELECT 1 FROM lumen.highlight_marks m
		WHERE m.id = mark_id AND m.owner_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS spans_update ON lumen.highlight_spans;
CREATE POLICY spans_update ON lumen.highlight_spans
	FOR UPDATE TO authenticated USING (EXISTS (
		SELECT 1 FROM lumen.highlight_marks m
		WHERE m.id = mark_id AND m.owner_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS spans_delete ON lumen.highlight_spans;
CREATE POLICY spans_delete ON lumen.highlight_spans
	FOR DELETE TO authenticated USING (EXISTS (
		SELECT 1 FROM lumen.highlight_marks m
		WHERE m.id = mark_id AND m.owner_id = (SELECT auth.uid())));

GRANT SELECT, INSERT, UPDATE, DELETE ON lumen.highlight_marks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON lumen.highlight_spans TO authenticated;
REVOKE ALL ON lumen.highlight_marks FROM anon;
REVOKE ALL ON lumen.highlight_spans FROM anon;
-- lumen_read gets NOTHING. Marks are read through the caller's own PostgREST
-- client, never over Hyperdrive, which caches reads ~60s — a mark must survive
-- a reload immediately.
REVOKE ALL ON lumen.highlight_marks FROM lumen_read;
REVOKE ALL ON lumen.highlight_spans FROM lumen_read;

-- widen v1's colour CHECK to the same ten, so the live v1 path keeps working
-- while the picker offers all of them
ALTER TABLE lumen.highlights DROP CONSTRAINT IF EXISTS highlights_color_check;
ALTER TABLE lumen.highlights DROP CONSTRAINT IF EXISTS highlights_color;
ALTER TABLE lumen.highlights ADD CONSTRAINT highlights_color CHECK (color IN (${COLOR_SQL}));
`;

/** v1 row → one mark + one whole-verse span. Keyed off the v1 row id so a
 * re-run cannot duplicate. */
const BACKFILL = `
INSERT INTO lumen.highlight_marks (id, owner_id, chapter_id, color, style, created_at)
SELECT h.id, h.owner_id, h.chapter_id, h.color, 'highlight', h.created_at
FROM lumen.highlights h
ON CONFLICT (id) DO NOTHING;

INSERT INTO lumen.highlight_spans (mark_id, verse_id, start_offset, end_offset)
SELECT h.id, h.verse_id, 0, char_length(v.text)
FROM lumen.highlights h
JOIN lumen.verses v ON v.id = h.verse_id
WHERE char_length(v.text) > 0
ON CONFLICT (mark_id, verse_id) DO NOTHING;
`;

const client = new pg.Client({ connectionString: dsn });
await client.connect();
try {
	await client.query('BEGIN');
	await client.query(DDL);
	await client.query(BACKFILL);
	await client.query('COMMIT');
} catch (err) {
	await client.query('ROLLBACK');
	console.error('migrate-highlight-marks: FAILED —', err.message);
	process.exit(1);
}

const checks = [
	['both tables carry RLS', `SELECT count(*)::int AS n FROM pg_class WHERE relnamespace='lumen'::regnamespace AND relname IN ('highlight_marks','highlight_spans') AND relrowsecurity`, (r) => r[0].n === 2],
	['eight owner-scoped policies', `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='lumen' AND tablename IN ('highlight_marks','highlight_spans')`, (r) => r[0].n === 8],
	['anon holds nothing', `SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_schema='lumen' AND table_name IN ('highlight_marks','highlight_spans') AND grantee='anon'`, (r) => r[0].n === 0],
	['lumen_read holds nothing (Hyperdrive staleness)', `SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_schema='lumen' AND table_name IN ('highlight_marks','highlight_spans') AND grantee='lumen_read'`, (r) => r[0].n === 0],
	['ten colours on the mark', `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid='lumen.highlight_marks'::regclass AND conname='mark_color'`, (r) => COLORS.every((c) => r[0].d.includes(`'${c}'`))],
	['ten colours on the v1 table too', `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid='lumen.highlights'::regclass AND conname='highlights_color'`, (r) => COLORS.every((c) => r[0].d.includes(`'${c}'`))],
	['three styles', `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid='lumen.highlight_marks'::regclass AND conname='mark_style'`, (r) => ['highlight', 'underline', 'text'].every((s) => r[0].d.includes(`'${s}'`))],
	['every v1 mark carried across', `SELECT (SELECT count(*) FROM lumen.highlights) = (SELECT count(*) FROM lumen.highlight_marks m JOIN lumen.highlights h ON h.id = m.id) AS ok`, (r) => r[0].ok === true],
	['every carried mark has its span', `SELECT count(*)::int AS n FROM lumen.highlight_marks m WHERE NOT EXISTS (SELECT 1 FROM lumen.highlight_spans s WHERE s.mark_id = m.id)`, (r) => r[0].n === 0],
	['no span escapes its verse text', `SELECT count(*)::int AS n FROM lumen.highlight_spans s JOIN lumen.verses v ON v.id = s.verse_id WHERE s.end_offset > char_length(v.text)`, (r) => r[0].n === 0],
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
	console.error(`migrate-highlight-marks: ${bad} invariant(s) FAILED`);
	process.exit(1);
}
console.log('migrate-highlight-marks: OK');
