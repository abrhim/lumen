# Canon Spine — design input (2026-07-06)

Decisions from design discussion (Abram + Claude), input to the canon-spine
feature plan. The governing principle, twice over:

1. **The canon spine is relational; knowledge is a graph.** Scripture structure
   (volume → book → chapter → verse → word) is fixed hierarchy and gets real
   tables with FKs. Everything *about* scripture (principles, people, art,
   cross-references, notes) is claims, and stays in `entities` + `edges` under
   collections.
2. **The spine carries no collection_id.** Core corpus is unconditionally
   visible; a reader with every collection off is still holding scripture.
   Boundary test for every future dataset: *is it THE canonical reading, or a
   reading/claim ABOUT it?* (JST = collection. Strong's alignments = collection.
   Words index = spine.)

## Schema

```sql
CREATE TABLE lumen.volumes (
  id          TEXT PRIMARY KEY,          -- 'ot','nt','bom','dc','pgp', later 'apocrypha','tanakh'…
  name        TEXT NOT NULL,
  abbrev      TEXT,
  tradition   TEXT NOT NULL,             -- 'hebrew'|'christian'|'restoration'|… (promoted from metadata.canon)
  source      TEXT,                      -- text provenance, e.g. 'lds-doc-project' (until a translations table exists)
  sort_order  INT  NOT NULL,
  UNIQUE (tradition, sort_order)         -- each tradition orders its own shelf
);

CREATE TABLE lumen.books (
  id          TEXT PRIMARY KEY,          -- '1-ne','dc','luke' (unchanged slugs)
  volume_id   TEXT NOT NULL REFERENCES lumen.volumes(id),
  name        TEXT NOT NULL,
  abbrev      TEXT,
  sort_order  INT  NOT NULL,
  UNIQUE (volume_id, sort_order)
);

CREATE TABLE lumen.chapters (
  id          TEXT PRIMARY KEY,          -- '1-ne-3' = verse-id prefix by construction
  book_id     TEXT NOT NULL REFERENCES lumen.books(id),
  number      INT  NOT NULL CHECK (number > 0),
  verse_count INT  NOT NULL,
  UNIQUE (book_id, number)
);

ALTER TABLE lumen.verses ADD COLUMN chapter_id TEXT REFERENCES lumen.chapters(id);
-- transition: volume_id/book_id/chapter_number retained until consumer sweep completes, then dropped

CREATE TABLE lumen.words (               -- rebuild of the empty table
  id          TEXT PRIMARY KEY,          -- '1-ne-3-7-w12'
  verse_id    TEXT NOT NULL REFERENCES lumen.verses(id),
  position    INT  NOT NULL CHECK (position > 0),
  surface     TEXT NOT NULL,             -- word-level queries never touch verse text
  normalized  TEXT NOT NULL,
  char_start  INT  NOT NULL,             -- offsets into verses.text: highlighting is a slice,
  char_end    INT  NOT NULL,             -- never a client-side re-tokenization
  UNIQUE (verse_id, position)
);
```

Key calls:
- **Ids are today's slugs** — URLs, 253k edges, Neo4j all stable.
- **verses.text is the single canonical string**; words are an index into it
  (surface/normalized for search-direction, offsets for reading-direction).
  Scripture is never reconstructed from tokens — worst tokenizer bug is a
  mis-highlight, never a misprint.
- **Nothing derivable stored** (chapter counts per book = indexed count).
- **Summaries stay in entities** (regenerable AI claims, not spine).
- `verses.text` assumes one translation; flagged for panels — spine must not
  paint us into a corner for multi-translation futures (ties to volumes.source).

## Migration (Postgres DDL is transactional; 0 users)

- **P1 (one transaction):** create volumes/books/chapters; volumes+books from
  entities (dc book row inserted explicitly — the D&C fix becomes a row);
  **chapters derived from lumen.verses** (`GROUP BY book_id, chapter_number`),
  not from drifted chapter entities; verses.chapter_id backfilled + NOT NULL +
  FK; summary entities stamped metadata.chapter_id (id-parsing convention
  retires).
- **P2:** consumer sweep — queries.ts rewritten on spine (UNION heuristic and
  jsonb casts die); loaders simplify; prev/next chapter uses real bounds.
- **P3:** verification — row-for-row diff of every old query vs new; zero FK
  orphans; full harness + live smoke; edges/art/graph untouched (verse ids
  never moved).
- **P4:** drop verses transition columns; deprecate volume/book/chapter
  entities (linger only as Neo4j mirror source until graph chapter-id
  alignment — separate cleanup).
- **Words (same feature):** tokenizer as pure harnessed function (offsets +
  normalization are the whole contract); ~1.2M rows batched; match-rate logging.

## Breaking changes

- **Ring 1:** queries.ts (intended; all structural queries rewrite).
- **Ring 2:** the MCP server consumes @lumen/scripture (resolveReference →
  getBooksByVolume/getChapterNumbers) and deploys separately — **coordinated
  MCP redeploy is a named plan step.**
- **Ring 3:** ingest-phase-a (updated or frozen with tombstone), Neo4j backfill
  (node sources move to spine), art ingest already compatible (chapter refs =
  'X-N' = chapters.id).
- **Open design question for panels:** arbitrary ids in lumen.edges now resolve
  to spine ∪ entities — consumers need one lookup convention (candidate: a
  `lumen.nodes` view).

## Collections side-effects (decided)

- The `canon` collection retires naturally (its members are the deprecated
  structural entities).
- `collection_id IS NULL` is promoted from fail-open hack to designed rule:
  **no collection = core corpus = unconditionally visible.** Documented, kept
  deliberately in graph/panel filters.
- Hiding whole canons (Apocrypha for non-Catholics) is **library scoping** via
  volumes.tradition + a future scope preference (cookie) — not collections.
- Text provenance lives on volumes.source until a translations table exists.

## Fast-follows stacked on the spine (separate features)

- Strong's alignment: STEPBible TAGOT/TAGNT → word→strongs edges ('strongs' collection).
- TSKe: verse↔verse edges w/ anchor_phrase metadata resolved to word positions
  at ingest ('tsk' collection; OpenBible votes as ranking metadata).
- Collections user-half: resolution function, cookie transport, toggle UI.
