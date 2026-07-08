# Panel 1 — Correctness + Data-Integrity (combined) Review — strongs plan

Reviewed `docs/features/strongs/plan.md` against the harness
(`scripts/__tests__/strongs.test.mjs`, `packages/scripture/src/__tests__/strongs-queries.test.ts`,
`apps/web/app/routes/__tests__/scripture.loader.test.ts`), `packages/scripture/src/tokenize.ts`,
`scripts/ingest-openbible-refs.mjs` (house ingest pattern), and the source
file `kjvfull.xml` (25.4MB, sampled directly with regex — Gen 1:1, Ps 3:1,
Ps 23:1, Isa 9:6, Song 1:1, Rev 22:21, John 3:16, Matt 19:14, Ezek 2:4,
2Cor 13:14, plus file-wide structural counts). Live prod verse text for
Ps 3:1 / Ps 23:1 was also queried (admin DSN) to settle the Psalm-title
question empirically rather than by inference.

| ID | Severity | Where in plan | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| CD-1 | High | plan.md L26-27, L57 ("skip empty `<w/>` and transChange" — "correct behavior, not gaps") | 34 real `<transChange>` elements (e.g. Matt 19:14 "it to be so") wrap a tagged, non-empty `<w>` with real strongs+morph — blanket-skipping them discards legitimate tags. | Only drop transChange text lacking a nested tagged `<w>`; extract and keep any nested `<w>` first. Add a Matt 19:14 fixture. |
| CD-2 | High | plan.md L55-56 (parser "regular format, regex walk"); no fixture covers this | 633 tagged `<w>` spans wrap `<seg><divineName>` (e.g. `<w lemma="strong:H03068"><seg><divineName>Lord</divineName></seg></w>` in Ps 3:1/23:1) — naive `[^<]*` text capture reads these as empty, dropping the tag or derailing sequential alignment. | Strip nested tags (not just match up to the first `<`) when extracting `<w>` span text; add Ps 3:1/Ps 23:1 divineName fixtures to strongs.test.mjs. |
| CD-3 | Medium | plan.md Source decision / Scope — no mention of Psalm titles | 116 Psalm titles (e.g. Ps 3's "A Psalm of David, when he fled from Absalom his son," itself tagged) sit entirely BEFORE the chapter's first `<verse sID>`, outside any verse span. Confirmed harmless today (live `ps-3-1` text excludes the title, matching the span) but undocumented and untested. | State explicitly that psalm-title tags are out of scope (no verse row exists for them); add a title-adjacent fixture (Ps 3 chapter head) so milestone-boundary regressions are caught. |
| CD-4 | Medium | plan.md L58-61 (aligner), Failure mode #4 | `<q who="Jesus">` (words-of-Christ) spans cross verse boundaries in 556 verses (e.g. opens Matt 5:3, doesn't close until Matt 5:48) — no fixture exercises a per-verse content slice with an unbalanced `<q>`. | Add a cross-verse `<q>` fixture (Matt 5:3-5:12 span) confirming the parser tracks only `<w>`/verse milestones, never `<q>` balance. |
| CD-5 | Low | strongs.test.mjs `JOHN_3_16` fixture (claimed "REAL probed KJV2006 markup"), vs plan.md L26 | Real John 3:16 markup has TWO consecutive empty `<w/>` elements (`src="17"`, `src="12"`) before "For"; the fixture has only one, understating a common pattern (8,033 empty `<w/>` elements file-wide, many consecutive). | Replace `JOHN_3_16` with the verbatim byte range from kjvfull.xml, including both empty `<w/>` elements. |
| CD-6 | Medium | plan.md L62-64 ("ONE transaction, delete-then-insert" for word_tags; "Lexicon ingest in the same script... upsert") | word_tags gets full delete+insert every run; `strongs_lexicon` gets upsert-only — a number removed/renamed upstream in TBESH/TBESG is never deleted, and the plan doesn't say whether the lexicon upsert shares the word_tags transaction. | State lexicon tx scope explicitly; add stale-row cleanup (delete lexicon rows absent from the current TSV) or document permanent accretion as intended. |
| CD-7 | Medium | plan.md L65-68 `getWordTags`; strongs-queries.test.ts (only asserts substrings like `LEFT JOIN`) | Nothing asserts `entries[]` preserves `strongs[]` array order for multi-strongs spans (Q2: "show all entries stacked") — a bare `LEFT JOIN unnest(strongs)` + aggregate can silently reorder entries relative to the source array. | Require `WITH ORDINALITY ... ORDER BY ordinality` (or equivalent) in the query; add a harness case asserting entries-order for a real 2-strongs span (e.g. John 3:16 "God" → G3588+G2316). |

## Traps checked with no bug found

- **Trap 5 (1% cap denominator):** verified — live `ot`+`nt` verse count is
  23,145 + 7,957 = 31,102, matching kjvfull.xml's own 31,102 `sID`/`eID`
  milestone pairs (balanced, zero mismatch) and the plan's "~31k" estimate.
  Single-chapter books (Obadiah, Philemon, 2/3 John, Jude) use `chapter.1`
  OSIS ids like any other book — no special-casing needed.
- **Trap 4 (word_tags PK = word_id, one span per word):** no verse has two
  distinct `<w>` spans covering the same English word position. The one
  suspicious signal (2,620 verses with a repeated `src="n"` index across
  sibling `<w>` tags) is a Robinson Greek-source-word cross-reference the
  parser never reads (only `text`/`strongs`/`morph` are extracted) — not an
  English-side collision.
- **Trap 3 (divine-name case rendering):** live text uses mixed-case "Lord"
  (`ps-23-1`: "The Lord is my shepherd"), matching kjvfull.xml's
  `<divineName>Lord</divineName>` content exactly — no ALL-CAPS convention in
  our data, and the aligner's normalized (lowercased) comparison would
  tolerate a case mismatch regardless.
- One malformed lemma (`strongs:G4314` — trailing "s" typo, 2Cor 13:14) exists
  file-wide but sits on an empty `<w/>` element already excluded by the
  empty-`<w/>`-skip rule — self-mitigated, not worth a fix.
