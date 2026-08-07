# Highlighting

Design input, 2026-08-02. Written in Simplified Technical English.

## Purpose

The reader marks scripture text. The reader keeps the marks. The marks are
private. A mark can carry a note.

Highlighting is also how a person makes a note on a phone. The person selects
the text. The app makes the anchor. The person types no reference.

## Why simple offsets are safe here

Most annotation systems store the quoted text and the text around it. They also
use fuzzy matching. They do this because documents change.

Scripture does not change. Therefore a verse id and two character offsets are
stable. Do not build fuzzy anchoring.

Store the quote anyway. The quote is not for recovery. The quote lets the app
show a list of highlights without a read of the verses table. The quote also
makes export simple.

## Schema

```sql
CREATE TABLE lumen.highlights (
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

  -- the verse must belong to the chapter. This check cannot drift.
  CONSTRAINT highlight_chapter_matches CHECK (verse_id LIKE chapter_id || '-%'),

  -- empty offsets mean the whole verse. Otherwise both offsets are present.
  CONSTRAINT highlight_range CHECK (
    (start_offset IS NULL AND end_offset IS NULL)
    OR (start_offset IS NOT NULL AND end_offset IS NOT NULL
        AND start_offset >= 0 AND end_offset > start_offset)
  ),
  CONSTRAINT highlight_quote_len CHECK (char_length(quote) <= 2000)
);

-- the reader query: my highlights in this chapter
CREATE INDEX highlights_owner_chapter_idx
  ON lumen.highlights (owner_id, chapter_id);

-- one whole-verse highlight per verse per person
CREATE UNIQUE INDEX highlights_one_per_verse_idx
  ON lumen.highlights (owner_id, verse_id)
  WHERE start_offset IS NULL;
```

`chapter_id` is stored, not derived. The CHECK makes it self-consistent. A
lookup by chapter is then one index hit and needs no join.

## Access rules

Copy the notes rules. Do not invent new ones.

- Enable RLS.
- Give `authenticated` SELECT, INSERT, UPDATE and DELETE on own rows only.
- Give `anon` nothing.
- Give `lumen_read` **nothing**.

The last rule matters. The app must read highlights through the user's own
PostgREST client, as notes do. It must NOT read them over `lumen_read`.
Hyperdrive caches reads for about 60 seconds. A person who marks a verse and
reloads must see the mark at once. This is the same trap that made a roadmap
vote read back as zero (2026-08-01).

## Read path

The chapter loader returns the caller's highlights for that chapter. One query.
Empty array when signed out.

## Gesture model

### Desktop

- Select text with the mouse. A small popover opens near the selection.
- The popover holds five colours, `Add note`, and `Copy`.
- Click an existing highlight. The same popover opens. It also holds `Remove`.

### Mobile

- **Tap a word** opens the Strong's entry. This does not change.
- **Long press** starts a text selection. iOS draws its own handles.
- The popover opens when the selection stops changing.
- **Tap a highlight** opens the popover.
- **Tap the verse number** marks the whole verse. This is the fast path and it
  needs no selection.

## The two conflicts

**1. A tap is already taken.** Every word is a span with `data-wpos`, and a tap
opens word study. Selection must therefore use long press only. Do not add a
second meaning to tap.

**2. iOS shows its own callout menu.** The app cannot add items to that menu.
Suppress it on verse text with `-webkit-touch-callout: none`. The app popover
then replaces it. The popover must include `Copy`, because suppressing the
callout removes the system copy action.

## Render

- **Whole verse**: put a class on the verse element. Do no offset work. This is
  most of the value.
- **Part of a verse**: wrap the range in `<mark>`. Offsets count characters in
  the verse's plain text, not in the DOM.
- Verse text is a list of word spans. Therefore a helper must walk the spans and
  add their lengths to convert a DOM range into a plain-text offset. Expect the
  bugs to be here. Test this helper on its own.
- Two highlights on one verse can overlap. Merge the ranges before render.

## Build order

1. Whole-verse highlights. Tap the verse number. No offsets.
2. The popover, colours, and remove.
3. `Add note` from a highlight.
4. Part-verse selection and the offset helper.
5. Highlights in the margin dots.

## Open questions

- Does a highlight appear in search results? Propose: later, not in v1.
- Does a highlight sync to the margin dot rail? Propose: yes, step 5.
- Can a person export highlights? Propose: later. The quote column makes it easy.
