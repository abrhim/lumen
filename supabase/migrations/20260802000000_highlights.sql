-- Whole-verse (and later part-verse) marks on scripture.
--
-- Design: docs/design/highlighting.md. Scripture text never changes, so a verse
-- id plus two character offsets is a stable anchor and none of the usual
-- fuzzy-anchoring machinery is needed. Slice 1 writes whole-verse marks only
-- (empty offsets); the offset columns ship now so the part-verse slice needs no
-- second migration.
--
-- lumen_read deliberately holds NO grant. Marks are read through the caller's
-- own PostgREST client, never over Hyperdrive, which caches reads ~60s — a mark
-- must survive a reload immediately. Mirrors scripts/migrate-highlights.mjs.

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
