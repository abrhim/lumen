# Highlighting

Design input, 2026-08-02 (v2, revised after review). Simplified Technical
English.

Supersedes v1 in this file. v1 designed verse-level marks. It shipped, and it
was the wrong feature: the reader marks a PASSAGE, not a row. This version
follows the Gospel Library model.

## Purpose

The reader marks the exact words they choose: one word, one verse, or several
consecutive verses. Marks are private. A mark can carry a note.

This is also how a person writes a note on a phone. They select the words. The
app makes the anchor. They type no reference.

## The model

- Long press a word. Handles appear. Drag them to extend the selection.
- 10 colours. 3 styles: highlight, underline, text colour.
- The picker is TWO axes: 10 colours, and a 3-way style toggle. Not 30 buttons.
- A mark can sit inside another mark.
- The menu carries Note and Copy.

Out of scope: tags.

## What actually survives from v1

A review corrected an earlier claim here. Most of v1 does NOT survive.

Kept:

- The table `lumen.highlights`, its RLS policies, and its grants.
- The rule that marks are read through the caller's own PostgREST client, never
  over Hyperdrive. `lumen_read` holds no grant, so the database enforces it.
- The resource-route write shape (a fetcher that does not revalidate the
  chapter) and the idea of an optimistic layer.

Rewritten:

- `chapterHighlights` filters `.is("start_offset", null)` and returns
  `Record<verseNumber, colour>`. It cannot carry a range, a style, or a group.
- `pendingMarks` is keyed by verse number and holds one colour. Same problem.
- `api.highlight` accepts only `verse`, `chapter`, `colour`. It needs offsets,
  style, group, and a delete path.
- `toggleVerseHighlight` uses `.maybeSingle()`, which ERRORS on more than one
  row. Layering makes several rows per verse normal, so this must go.

## Schema

### Two tables, not one

A mark is one thing. Its geometry is per verse. v1's single table cannot express
that: colour, style and note would be duplicated across a mark's rows with
nothing keeping them equal.

```sql
-- the mark: identity and every property that belongs to the WHOLE mark
CREATE TABLE lumen.highlight_marks (
	id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	owner_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	chapter_id text NOT NULL REFERENCES lumen.chapters(id) ON DELETE CASCADE,
	color      text NOT NULL CHECK (color IN (/* the 10 */)),
	style      text NOT NULL DEFAULT 'highlight'
	           CHECK (style IN ('highlight','underline','text')),
	note_id    uuid REFERENCES lumen.notes(id) ON DELETE SET NULL,
	quote      text CHECK (char_length(quote) <= 4000),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

-- the geometry: one row per verse the mark touches
CREATE TABLE lumen.highlight_spans (
	mark_id      uuid NOT NULL REFERENCES lumen.highlight_marks(id) ON DELETE CASCADE,
	verse_id     text NOT NULL REFERENCES lumen.verses(id) ON DELETE CASCADE,
	start_offset int NOT NULL,
	end_offset   int NOT NULL,
	PRIMARY KEY (mark_id, verse_id),
	CONSTRAINT span_range CHECK (end_offset > start_offset AND start_offset >= 0)
);
```

`note_id` now lives on the mark, so one note covers the whole passage. A
per-row `note_id` gave a three-verse mark three notes and no way to agree.

Whole-verse marking becomes a span from 0 to the verse's length. There is no
NULL-offset special case any more, and therefore no partial unique index and no
nondeterministic "which row wins".

Migrating v1 rows: each existing row becomes one mark plus one span with
`start_offset = 0` and `end_offset = char_length(verse.text)`.

### Three artefacts must change together

This is where the first attempt would have failed the gate.

1. `scripts/migrate-highlights.mjs` — its DDL is `CREATE TABLE IF NOT EXISTS`,
   so re-running it after an ALTER is a silent no-op. Its invariant at the end
   asserts `highlights_one_per_verse_idx` EXISTS, so dropping that index makes
   the script exit 1. The script needs new DDL and new invariants, not an edit.
2. `supabase/migrations/` — a NEW timestamped file. This is what the local stack
   and CI apply. The generated baseline is not hand-edited.
3. `apps/web/app/lib/highlight-colors.ts`, `app/app.css`, and
   `e2e/highlights.spec.ts` all hard-code FIVE colours. The e2e asserts
   `toHaveCount(5)`.

CLAUDE.md lists migrations and anything under `supabase/` as escalate-first.
Confirm before running.

## Offsets

Offsets count characters in the verse's own text. Scripture text never changes,
so this is a stable anchor and no fuzzy anchoring is needed.

### The verse link is NOT the text container

The `<a>` for a verse contains, in document order:

1. the gutter `<span>`, whose text is the VERSE NUMBER — it is visually
   `absolute` but comes first in the DOM;
2. the verse text;
3. the margin dots;
4. `<span class="sr-only">, your note</span>` on noted verses.

Walking the link's children and adding text lengths therefore shifts every
offset by the width of the verse number, and by 11 more characters when the
verse carries a note. Marks would land on the wrong words and the data would be
quietly wrong.

**Wrap the verse text in its own element** — one `<span data-verse-text>` around
the `VerseWords` output or the bare string — and make that element the ONLY
thing the helper walks. Nothing else in the link may contribute an offset.

### Two DOM shapes

- **Not a Bible book**: the text is one text node. `range.startOffset` is
  already the character offset.
- **A Bible book**: `VerseWords` emits word `<span>`s with bare text between
  them. Walk the container's children in order and add their text lengths.

### Snapping

`tokenize()` returns every word with `char_start` and `char_end` in the verse's
own text, and `VerseWords` builds its spans from those same numbers.

- Move the start back to the `char_start` of the token containing it.
- Move the end forward to the `char_end` of the token containing it.
- The result is ONE contiguous range. Interior punctuation is inside it, because
  the range is a single interval and not a set of tokens. "verily, verily" must
  paint as one band, not two with a white gap.
- If an endpoint falls in a gap between tokens, move it OUTWARD to the nearest
  token edge.
- If the whole selection falls in a gap, there is no mark. Do not post.

## Render

The renderer cannot paint by wrapping existing spans, because a mark can start
and end inside them and can cross the bare text between them.

**Re-segment.** For each verse, take the mark boundaries that fall in it, sort
them, and cut the verse text into segments. Emit each segment with the marks
that cover it. This handles overlap and layering as the normal case, which they
now are.

- `highlight` paints a background tint. Reading ink stays the darkest thing on
  the line at all 10 colours.
- `underline` and `text` do not paint a background. If `<mark>` is used, reset
  the user-agent background.
- A SELECTED verse keeps the blue selection and moves its marks to the edge.
  Selection is transient; a mark is a decision; mixing the backgrounds is mud.

## Gestures

### Desktop

- Drag across text to select. `draggable={false}` on the verse link already
  allows this.
- The menu opens near the selection once the selection settles.

### Mobile

- **Tap a word** opens the Strong's entry. Unchanged.
- **Long press** starts a selection. iOS draws the handles.
- Verse text needs `-webkit-touch-callout: none`, or a long press opens the iOS
  link preview instead. It may also need `-webkit-user-select: text`.
  **Long-press selection inside an `<a>` on iOS is UNVERIFIED. Test it on a real
  device before building the menu.** If it cannot be made to work, the verse
  stops being a link and the URL state moves to the verse number.
- Suppressing the callout removes the system Copy. The menu MUST carry Copy.

### The click router must be re-ordered

`scripture.tsx` returns early whenever a selection is live, BEFORE any other
branch. So "click a mark to edit it" cannot work as written: with a selection
present the click does nothing.

New order: mark hit → word → verse select. And the range-mark hook must NOT
reuse `data-hl`, which today means "the verse number, mark the whole verse".
Use a separate attribute or the click lands on the wrong target.

On the Book of Mormon and the Doctrine and Covenants the word branch is gated by
`isBibleBook`, so a tap meant to dismiss a selection navigates to `?verse=N`.
Decide what a tap does while a selection is live.

### Both gestures survive

Tap and long press are different events, as are click and drag. The conflict is
also narrow: word study runs on Bible books only.

The menu carries **Look up** for one-word selections, so word study is reachable
from the selection too. If tap proves fumble-prone, tap can retire without
losing the feature. Do not add a setting.

## Selection boundaries

- The chapter summary and the art strip sit ABOVE the verse list. A drag that
  starts there gives an endpoint inside no verse. Clamp to the first verse the
  selection actually intersects; ignore endpoints outside any verse.
- A selection cannot cross a chapter, because one chapter renders at a time.
- Test a selection that starts mid-verse and ends mid-verse three verses later.

## Signed out

A signed-out reader can still select text. The menu appears with Copy and Look
up, and the colours are a sign-in door. Do not show a picker that cannot save.

## Build order

1. Schema: both tables, the 10 colours across all four files, the v1 migration.
2. `data-verse-text` wrapper, then the offset helper, with unit tests for both
   DOM shapes. No UI yet.
3. Selection detection and the menu shell.
4. Colours and styles; the write path and the new read shape.
5. Re-segmenting renderer, with overlap.
6. Note from a mark.
7. Copy and Look up.

## Risks

- The offset helper is the feature. Wrong offsets corrupt data silently. Unit
  test it before any UI exists.
- iOS long-press selection inside a link is unproven. Test early — it can force
  the link out of the verse.
- iOS draws the selection handles. We can read the selection; we cannot style
  them.
- Four source comments cite "slice 1/2" of the old design and will go stale.

## Open questions

- Do marks appear in search? Propose: not in v1.
- Do marks show in the margin dot rail? Propose: yes, after step 5.
- Export? Propose: later. `quote` on the mark makes it easy.
