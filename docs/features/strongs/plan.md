# Plan — strongs (word-level Strong's concordance)

## Tier
**large** — data migration (2 new tables + ~790k-row word_tags ingest + ~14k
lexicon rows), public surface (interactive word layer in the verse panel, new
queries exported from @lumen/scripture), behavior change, ≥300 net-new lines.

> Delegation note: Abram delegated in-flight decisions ("you don't need me").
> Gates are self-approved with the defaults recorded here; everything is
> logged for review.

## Goal
Tap any word in the selected verse and see its original-language identity:
Strong's number(s), transliterated lemma, morphology, and definition, plus
"other verses using this word" — the payoff the canon-spine words table
(positions + char offsets) was built for.

## Source decision (pre-plan probes, 2026-07-08)
- **Tags: CrossWire KJV2006 OSIS** (`kjvfull.xml`, 25.4MB, downloaded +
  probed). "King James Version (1769) with Strongs Numbers and Morphology."
  Markup: `<w lemma="strong:H07225" morph="...">In the beginning</w>` — KJV
  PHRASES tagged per original word, on text that matches ours verbatim
  (Gen 1:1 compared byte-for-byte). Alignment is DETERMINISTIC sequential
  token matching with our own tokenizer — the STEPBible route (Berean-glossed
  tags, ~83% fuzzy coverage) is rejected. Empty `<w/>` elements (untranslated
  Greek articles) and `<transChange>` (translator-supplied italics) carry no
  tags — correct behavior, not gaps. License: KJV 1769 text is public domain;
  CrossWire distributes the tagged module as public domain (verify the module
  .conf verbatim during implementation — the TSKe lesson).
- **Lexicon: STEPBible TBESH (Hebrew) + TBESG (Greek)** — CC BY 4.0 verified
  verbatim by the researcher; both files already downloaded. Gloss,
  transliteration, definition per Strong's number.
- **Number normalization**: KJV2006 zero-pads (H07225), lexicons don't
  (H430); extended letters exist (H1254A). Canonical form: letter + integer
  (+ optional suffix), e.g. `H7225`, `G25`, `H1254A`; normalize BOTH sides;
  exported pure fn.

## Prior learnings surfaced
| Source | Learning | Application |
|---|---|---|
| tske retro | Verify licenses before planning around a dataset | KJV2006 replaced STEPBible tags after probing; .conf check at implement |
| tske retro | Never-throw wrappers need happy-path assertions | Word-tags loader test asserts non-degraded tags |
| art retro | Instance-level mapping beats vocabulary-level | Alignment is per-verse sequential, never per-word-string lookup |
| canon-spine retro | Probe live conventions; export constants; in-tx invariants | All probes done; parser/aligner/normalizer are exported pure fns |
| canon-spine | scripture never reconstructed from tokens | The interactive layer renders verse text via char offsets (slice), words only address it |

## Scope
- **In:**
  1. **Schema + ingest** (`scripts/ingest-strongs.mjs`, admin DSN):
     - `lumen.word_tags(word_id TEXT PK REFERENCES lumen.words(id),
       strongs TEXT[] NOT NULL, morph TEXT)` + GIN(strongs); RLS read policy +
       grant per convention.
     - `lumen.strongs_lexicon(strongs_no TEXT PK, lang TEXT, translit TEXT,
       gloss TEXT, definition TEXT)` + RLS + grant.
     - Parser: stream kjvfull.xml by verse milestone (regular format, regex
       walk); extract tagged spans {text, strongs[], morph}; skip empty `<w/>`
       and transChange.
     - Aligner: tokenize span text with OUR tokenize(); match sequentially
       against the verse's words rows (normalized equality); every matched
       word gets the span's strongs+morph. Verse-level mismatch → verse
       skipped + reported under a 1% cap (Bible verses only, ~31k).
     - ONE transaction, delete-then-insert, marker `strongs-ingest`, house
       events, --dry-run, session probe, scrub.
     - Lexicon ingest in the same script (TSV parse → upsert).
  2. **Queries** (`packages/scripture/src/strongs.ts`):
     - `getWordTags(db, verseId)` → per-word rows joined to lexicon:
       {word_id, position, char_start, char_end, strongs, morph, entries:
       [{strongs_no, translit, gloss}]} — one round trip.
     - `getVersesByStrongs(db, strongsNo, limit=20)` → verses whose words
       carry the number (GIN), canonical order.
  3. **UI (verse panel)**: the selected-verse blockquote becomes an
     interactive word layer — words with tags render as tappable spans built
     from char offsets (text.slice — never reconstructed); tapping opens a
     "Word study" accordion item (house pattern, below citations) with
     translit/Strong's no/morph/definition + up to 5 "also in" verse links
     (getVersesByStrongs, on demand). Bible verses only; BoM/D&C verses show
     no word layer (no tags exist). Word-tags fetch joins the loader's
     existing critical-path Promise.all (COR-2; never-throw + degraded flag +
     `wordtags_degraded` event).
  4. **Smoke** (`scripts/smoke-strongs.mjs`): counts (~790k tags expected
     magnitude), coverage ratio of tagged Bible words reported, zero orphan
     word_ids, canaries: gen-1-1 'beginning'→H7225, john-3-16 'loved'→G25
     morph robinson:V-AAI-3S; lexicon joins resolve for top numbers; re-run
     stability marker; EXPLAIN sanity on both queries.
- **Out:** morphology-code EXPANSION (store raw codes; TEHMC/TEGMC labels are
  a fast-follow), search-by-Strong's UI, word-study standalone pages, BoM
  Hebrew/Greek speculation, Neo4j mirroring, MCP adoption.

## Files touched
scripts/ingest-strongs.mjs (new) · scripts/__tests__/strongs.test.mjs (new:
harness) · scripts/smoke-strongs.mjs (new) · packages/scripture/src/strongs.ts
(new) + index export + __tests__/strongs-queries.test.ts (new) ·
apps/web/app/routes/scripture.tsx (panel word layer) + loader tests ·
scripts/setup-indexes.sql (inventory note).

## Failure modes (harness assertions)
1. Number normalization wrong (H07225≠H7225, suffix lost) → exhaustive unit
   cases incl. G-side and extended letters.
2. Span tokenization disagrees with our words (punct/case) → aligner unit
   tests on real probed verses (Gen 1:1 fixture incl. multi-word span,
   John 3:16 incl. empty `<w/>` + multi-strongs span, transChange skip).
3. Alignment drift mid-verse (extra/missing word) → whole-verse skip +
   counted, never partial-guess; unit test.
4. Tags attached to the wrong verse (milestone parsing) → parser unit on a
   fixture with adjacent verses; smoke canaries.
5. Cap semantics: skipped-verse ratio over BIBLE verse count; ≥1% aborts;
   boundary unit test (tske COBS-4 lesson).
6. Loader: word-tags fetch never throws; happy path asserts real tag rows
   (tske B2); vconn untouched; query-count guard updated.
7. Word layer renders EXACTLY the verse text (offsets slice; joins equal the
   original string) → pure helper property test.
8. Re-run duplicates → delete+insert one tx; smoke count-stable.
9. GIN query shape for getVersesByStrongs (SQL-shape test: @> array bind).
10. Lexicon rows missing for a used number → LEFT JOIN degrades to
    number-only display (test) + smoke reports unresolved-number count.

## Open questions (self-approved defaults, delegation noted)
- Q1 word-layer trigger: every tagged word always tappable. **Default: yes,
  subtle affordance (dotted underline on hover/focus), no visual noise at rest.**
- Q2 multi-strongs spans (e.g. G3588+G2316 'God'): show all entries stacked.
  **Default: yes.**
- Q3 phrase spans tag every member word identically ("In the beginning" ×3
  → H7225). **Default: yes — tapping any member shows the span's entry.**
- Q4 lexicon entry length: TBESH definitions can be long. **Default: gloss +
  first ~400 chars with expand.**

## Harness scope
**behavior** — harness-first; must fail initially.

## Drift baseline (filled at end of step 6)
- plan-hash: PENDING
- harness-hash: PENDING
