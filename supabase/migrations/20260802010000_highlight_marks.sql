-- Highlighting v2: passage marks. Design: docs/design/highlighting.md.
--
-- A mark spans verses, so colour, style and note belong to the MARK and only
-- geometry is per verse. v1's single table let three rows of one mark disagree
-- about all three, and gave a three-verse mark three notes.
--
-- v1's `highlights` table is left in place and its rows copied across; a later
-- change drops it once the reader no longer reads it.
--
-- Mirrors scripts/migrate-highlight-marks.mjs. Generated from its DDL — the
-- colour list is interpolated, not a template placeholder.

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
ALTER TABLE lumen.highlight_marks ADD CONSTRAINT mark_color CHECK (color IN ('yellow','orange','red','pink','purple','blue','teal','green','brown','grey'));
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
ALTER TABLE lumen.highlights ADD CONSTRAINT highlights_color CHECK (color IN ('yellow','orange','red','pink','purple','blue','teal','green','brown','grey'));
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
