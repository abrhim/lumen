# Panel aggregates — strongs
## panel-1
### correctness-data
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

### perf-obs
# Panel-1 / performance+observability review — strongs

| ID | Severity | Where in plan | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| PO-1 | High | plan.md L77-79 (word-tags fetch joins loader's Promise.all) | Adds a 7th parallel query to a `max:5` pool (db.server.ts). Worst case (Bible verse + graph open) rises from ~7 concurrent/2 queued today to 8/3 queued — unmeasured. | State the queuing math explicitly; measure added p95 latency on verse-tap before/after; consider deferring wordTags fetch outside the shared batch if it regresses. |
| PO-2 | High | plan.md L50-52 (`word_tags` DDL `+ GIN(strongs)`) | GIN index is listed inside schema DDL, built before/with the 790k-row bulk load — contradicts the house CPERF-7 precedent (`idx_words_normalized`, `idx_edges_to_rel` both built post-bulk-load). | Move `CREATE INDEX ... GIN(strongs)` to run after the bulk insert (in-tx, like `idx_edges_to_rel`), not in the upfront DDL block. |
| PO-3 | High | plan.md L66-68 (`getWordTags` "one round trip") + harness `strongs-queries.test.ts` | LEFT JOIN to lexicon on an unnested multi-strongs array can multiply rows per word; no GROUP BY/json_agg shape is specified or pinned, risking row-count blowup past the stated ≤~50/verse and broken `entries[]` grouping. | Specify `GROUP BY word_id` + `json_agg(lexicon fields)` in the query; add a harness assertion pinning one-row-per-word output for a multi-strongs fixture. |
| PO-4 | Medium | plan.md L62-64 (ingest: "ONE transaction, delete-then-insert... house events") | No batch size, per-batch/wall-clock estimate, or WAL note for the ~790k-row single-tx ingest, though `ingest-openbible-refs.mjs` (PERF-3, BATCH_SIZE=5000) and `ingest-words.mjs` (elapsedMs logging) set this precedent at smaller scale. | Document batch size (e.g. 5,000-10,000), estimated wall-clock for ~790k rows, and log `elapsedMs` per batch/book like the two precedent scripts. |
| PO-5 | Medium | plan.md L55-57 (parser: "stream kjvfull.xml by verse milestone") | Word "stream" is used but the plan never states whether the 25.4MB file is read via a true streaming reader or `readFileSync` + regex walk in memory — ambiguous for implementation and review. | State the approach explicitly (a single `readFileSync` is fine at 25MB); reserve "stream" for the row-batching stage to avoid confusion. |
| PO-6 | Low | plan.md L62-64 (ingest "house events" vs. L79 named `wordtags_degraded`) | Ingest events are left unnamed ("house events") while the loader-side degraded event is explicitly named — inconsistent specificity vs. `ingest-openbible-refs.mjs`, which names every event (`openbible_ingest_start`, `source_loaded`, ...). | Name the ingest events now, e.g. `strongs_ingest_start/spans_parsed/alignment_skipped/strongs_ingest_done/strongs_ingest_fatal`. |
| PO-7 | Medium | plan.md L80-84 (smoke: "coverage ratio of tagged Bible words reported") | Coverage-ratio check has no defined pass/fail floor — "reported" only, unlike `skipCapVerdict`'s 1% cap or `smoke-openbible.mjs`'s hardcoded count assertion (`n.n > 344799`). | Define an explicit floor (e.g. ≥90% of Bible words tagged) so smoke fails on a coverage regression instead of only printing a number. |

### security-contract
# Panel 1 — security + api-contract review: strongs plan

| ID | Severity | Where in plan | Problem (≤25 words) | Fix (≤30 words) |
|---|---|---|---|---|
| SC-1 | High | Source decision, KJV2006 bullet (l.27-29) | "Verify the module .conf verbatim during implementation" names no field/anchor and no fallback if the conf isn't public-domain as expected. | Pin the exact `.conf` key (e.g. `DistributionLicense`/`About`) to check and the abort action if it doesn't read public domain, before ingest runs. |
| SC-2 | High | Source decision, STEPBible bullet (l.30-32); Q4 (l.124-125) | STEPBible TBESH is CC BY but researcher flagged an Online Bible permission notice inside the 'Meaning' field; plan has no attribution UI (house precedent: openbible credit line) and no handling for the embedded notice. | Add a CC BY/STEPBible credit near the word-study panel (per openbible precedent) and decide explicitly: preserve, strip, or relocate the embedded notice text — don't let 400-char truncation silently cut it. |
| SC-3 | Critical | Scope item 1, word_tags DDL (l.49-52); Files touched (l.89-94) | `word_tags.word_id` FK to `lumen.words(id)` has no ON DELETE clause; `ingest-words.mjs` does per-batch `DELETE FROM words WHERE verse_id IN (...)` — any future words re-ingest will hit an FK violation once word_tags exists. | Add `ON DELETE CASCADE` and document/enforce that any `ingest-words.mjs` re-run must be followed by an `ingest-strongs.mjs` re-run, or tags silently vanish. |
| SC-4 | Medium | Scope item 2, getWordTags shape (l.66-69) vs UI scope item 3 (l.71-79) and Q4 (l.124-125) | `entries` is typed `{strongs_no, translit, gloss}` but the UI (and Q4's truncation default) require rendering `definition`, which the shape omits entirely. | Add `definition` to the `entries` element shape now, before it's pinned for MCP consumption; keep `gloss` (short) and `definition` (long) distinct fields. |
| SC-5 | Low | Failure modes (l.96-116); UI section (l.71-79) | No failure mode/harness assertion pins that translit/gloss/definition render as plain text (JSX), unlike FM-7's slice-equality guarantee for verse text — leaves an implicit-only guard against `dangerouslySetInnerHTML` on ~14k rows of external TSV text. | Add a failure mode/unit assertion: lexicon fields render via plain JSX text nodes only, never `dangerouslySetInnerHTML`, matching FM-7's rigor for the word layer. |
| SC-6 | Medium | Scope item 2, getVersesByStrongs (l.69-70) | Return shape is entirely unpinned ("verses whose words carry the number") — no field list, unlike `CrossRefRow`/`getWordTags`'s explicit shapes — leaves the MCP-later contract undefined. | Define the row shape explicitly (verse_id, reference, text, matched word_id(s)) before implementation, same rigor as `CrossRefRow` in crossrefs.ts. |

### ux-a11y
# Panel-1 / ux+accessibility review — strongs

| ID | Severity | Where in plan | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| UA-1 | High | Scope §3 (UI) vs `scripture.tsx` L841-843 (`PanelBody` blockquote: `text-sm` italic, 14px) | Interactive words live in a 14px blockquote, not the 19px chapter text; word bounding boxes at that size are far under any usable tap target, guaranteeing mis-taps on short words. | State the real target size (14px) explicitly; pad each word's hit area (invisible inline padding/negative-margin trick) rather than relying on the glyph box. |
| UA-2 | High | Q1 ("subtle affordance: dotted underline on hover/focus, no visual noise at rest") | Touch has no hover, and focus only applies to keyboard users — a touch reader gets zero visual cue that any word is tappable, so the whole feature is undiscoverable on mobile. | Give tagged words a low-contrast always-on affordance (e.g. faint dotted underline) on touch, reserving "no noise" for hover-capable pointers via `@media (hover:hover)`. |
| UA-3 | High | Scope §3 ("tapping opens a Word study accordion item") — no AT semantics specified | Turning ~20+ words per verse into individually focusable/interactive elements makes a screen reader announce the whole verse as a wall of buttons, destroying normal reading flow. | Default the blockquote to plain text for AT; add an opt-in "Word study" toggle that swaps in the interactive span layer only when requested. |
| UA-4 | Medium | Scope §3 ("tapping opens... accordion, house pattern, below citations") vs accordion placement (below chips, after art) | Tapping a word above triggers a state change in an accordion that can be a full scroll-length away, with no stated focus move or announcement — sighted keyboard/low-vision users may not notice anything happened. | On word activation, move focus to the opened accordion's content (or trigger) and/or scroll it into view; announce via a live region for anyone not looking at it. |
| UA-5 | Medium | Scope §3 vs Failure mode 7 ("word layer renders EXACTLY the verse text... no layout shift" per lens, unaddressed in plan) | Plan never states how the selected-word state is styled; if selection uses a border, bold, or outline that adds width, tapping a word can reflow the sentence around it. | Specify selection styling as background-color/underline only (no width-changing properties) so the char-offset-sliced text never reflows on tap. |
| UA-6 | Medium | Q4 (400-char clamp + expand) vs mobile Sheet (`max-h-[75dvh] overflow-y-auto`, L732-734) | Expanding a lexicon definition inside an accordion inside an already-scrolled 75dvh sheet isn't addressed: expand can push the cross-ref accordion further down with no indication content moved. | Scroll the expanded definition into view within the sheet's scroll container on expand; keep expand/collapse height changes animated so the shift is visible, not a jump. |
| UA-7 | Medium | Q2 (multi-strongs: "show all entries stacked") | "Stacked" isn't specified for structure: unclear if each entry is its own list item with independent expand state, or a single 400-char clamp shared across N glosses — affects both readability and SR grouping. | Define stacked entries as a labelled list (e.g. `<ol>` of definitions), each with its own Q4 clamp/expand, grouped under one heading naming the tapped word. |
| UA-8 | Medium | Scope §3 (word spans as tappable elements) — no keyboard model stated | If each tagged word is a native tab stop, a keyboard user must tab through 20+ word spans per verse before reaching the accordion or next control, breaking normal tab flow through prose. | Use a single tab stop with roving tabindex + arrow-key movement across tagged words (like a toolbar), not sequential per-word tabbing. |

## panel-2
### tagger-a
# Panel 2 — ADVERSARIAL Review (tagger-a) — Panel 1 Correctness-Data + Security-Contract (strongs)

Verified against the source XML (`kjvfull.xml`, 25.4MB, re-derived every count
with a structural non-nested `<w>...</w>` extractor — not substring `grep`),
`scripts/ingest-words.mjs`, `scripts/ingest-openbible-refs.mjs`,
`packages/scripture/src/crossrefs.ts`, `scripts/__tests__/strongs.test.mjs`,
`packages/scripture/src/__tests__/strongs-queries.test.ts`,
`apps/web/app/routes/__tests__/scripture.loader.test.ts`, and
`apps/web/app/routes/scripture.tsx`. No implementation exists yet
(`ingest-strongs.mjs`, `strongs.ts` are absent — plan-stage only); the two
test files above already exist as failing/import-erroring harness stubs.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| CD-1 | material | Verified: 34 transChange elements contain a `<w>`; 33 wrap genuinely non-empty tagged spans (1 wraps only an already-excluded empty `<w/>`). Blanket-skip claim is false. |
| CD-2 | material | Verified but **undercounted**, not overcounted: 633 doesn't match anything real — actual is 359 "purely empty to naive regex" `<w>` spans, 6,878 total `<w>` containing nested `divineName`, across 5,816 verses (18.7% of all Bible verses). |
| CD-3 | risky | Count exact (116, all `title type="psalm"`, all tagged) and panel-1's own text says "confirmed harmless today" — real coverage gap, not a live bug. |
| CD-4 | risky | Count exact (556 verses, unbalanced `<q>`, Matt.5.3/5.48 confirmed). Design already never reads `<q>` balance, so this is a missing regression fixture for an already-safe-by-construction case, not a proven defect. |
| CD-5 | risky | Verified exact: real John 3:16 has `<w src="17"/><w src="12"/>` before "For"; fixture in `strongs.test.mjs:29` has only `src="17"`. Real fixture-fidelity gap, low stakes. |
| CD-6 | risky | No ingest code exists yet to confirm tx scope; genuine plan-text ambiguity ("same script" ≠ "same transaction") worth resolving before implementation, not a confirmed bug. |
| CD-7 | material | Verified directly against `strongs-queries.test.ts:16-27`: zero assertion on `entries[]` order for multi-strongs spans, despite plan's own Q2 promising "show all entries stacked." Cheap, concrete fix (`WITH ORDINALITY`). |
| SC-1 | material | Verified: no `.conf`-parsing precedent exists anywhere in `scripts/*.mjs`; plan text genuinely names no field/abort action. Directly repeats the TSKe license-mistake shape (`retro.md:15`) if skipped. |
| SC-2 | material | Credit-line precedent verified real (`scripture.tsx:1001-1170`, "CC-BY credit... per amendment 10"); Q4's 400-char truncation default (plan.md L124-125) genuinely risks silently cutting an un-checked embedded notice. TBESH file itself not in my verification set. |
| SC-3 | material | Verified exactly: `ingest-words.mjs:104` does `DELETE FROM lumen.words WHERE verse_id IN (...)` per batch; plan's word_tags DDL (L50-51) has no `ON DELETE` clause. Confirmed Critical. |
| SC-4 | material | Verified against loader test mock (`scripture.loader.test.ts:181`): `entries` shape is exactly `{strongs_no, translit, gloss}`, no `definition` — directly contradicts Q4's own truncation-of-definition default. |
| SC-5 | risky | Real, sound defensive ask (no `dangerouslySetInnerHTML` exists in `scripture.tsx` today, confirmed by grep) but purely preventive — nothing to violate yet since no lexicon-rendering code exists. |
| SC-6 | material | Verified against `strongs-queries.test.ts:30-39`: test only checks substrings (`@>`, `lumen.verses`, limit value), no field-shape assertion — confirms shape is genuinely unpinned, unlike `CrossRefRow` (`crossrefs.ts:17`). |

## Stance

**CD-2 is the standout adversarial catch: panel-1's own headline number is
wrong, and wrong in the dangerous direction.** I could not reconstruct "633"
under any parse of the file — not total `<seg><divineName>` occurrences
(6,880), not `<w>`-wrapped ones (6,878), not the subset that reads as fully
empty to a naive `[^<]*` capture (359, the case matching panel-1's own Ps
3:1/23:1 example), not distinct affected verses (5,816). The qualitative
claim is completely sound and the fix (strip nested tags when extracting `<w>`
text) is correct and necessary — but the true blast radius is ~9x panel-1's
figure at the verse level. That matters operationally: 5,816/31,102 verses
(18.7%) is nowhere near the plan's own 1% skip-cap abort threshold (Failure
mode #5) — if this parsing bug ships unfixed, the ingest doesn't quietly lose
633 tags, it **aborts outright** on first run. I kept CD-2 material (it would
survive regardless as a verified High correctness finding either way), but
the rationale and severity framing in panel-1's writeup should be corrected
before it goes into the fix queue, or the fix gets deprioritized against a
number that undersells the real risk.

**CD-1 is accurate to within a rounding edge**: panel-1's "34... wrap a
tagged, non-empty `<w>`" is one off — 34 is the total count of transChange
elements containing *any* `<w>` (including one that wraps only an already-
excluded empty `<w/>`); 33 is the count that actually wrap non-empty tagged
content and would be silently dropped. Doesn't change the verdict.

**CD-7 and SC-4/SC-6 are upgraded from what a skim would suggest** because I
checked them against artifacts that already exist on disk, not just plan
prose: the two harness test files
(`strongs-queries.test.ts`, `scripture.loader.test.ts`) are real, currently
in the repo, and confirm every claim — no ordinality assertion, no
`definition` field in the mocked shape, no field-shape assertion on
`getVersesByStrongs`. These aren't "the plan is vague" complaints; they're
"the checked-in harness stub already encodes the gap" findings, which is
about as verified as a pre-implementation review gets.

**SC-2 is the one finding I could only partially verify** — the "Online Bible
permission notice inside TBESH's Meaning field" claim rests on the TBESH
source file, which wasn't in my verification set (only `kjvfull.xml` was
provided). I verified the surrounding claims (credit-line precedent is real;
Q4's truncation default is real and does create genuine risk if an
un-inspected notice sits in a truncated field) and kept it material on that
basis plus its High severity, but the core embedded-notice premise is
inherited from panel-1's research, not independently re-confirmed here.

**Net**: 8 material (CD-1, CD-2, CD-7, SC-1, SC-2, SC-3, SC-4, SC-6), 5 risky
(CD-3, CD-4, CD-5, CD-6, SC-5), 0 noise, 0 out-of-scope. No finding was
refuted outright; the only correction is CD-2's count, which understates
rather than overstates the problem.

### tagger-b
# Panel-2 adversarial / tagger-b — strongs

Roles: perf-obs + ux-a11y. Meta-reviews panel-1's `perf-obs.md` and
`ux-a11y.md` against `plan.md`, the live `scripture.tsx` /
`db.server.ts` code, and the `ingest-openbible-refs.mjs` /
`ingest-words.mjs` precedents. Context weighed throughout: single user
(Abram), personal app, Abram explicitly wants tappable words.

## Verification notes (what was checked against the repo)

- `apps/web/app/routes/scripture.tsx:856` — panel blockquote is
  `font-reading text-sm italic` (14px), confirming UA-1's premise exactly.
- `apps/web/app/routes/scripture.tsx:745` — mobile `SheetContent` is
  `max-h-[75dvh] overflow-y-auto`, confirming UA-6's premise exactly.
- `apps/web/app/lib/db.server.ts:32` — per-request postgres client is
  created with `max: 5`; `scripture.tsx:338` currently holds a 6-item
  `Promise.all` against that same client (verses, summary,
  publicCollections, artRows, chapterRows, crossRefsRaw) — a word-tags
  fetch per plan L77-79 would be the 7th, confirming PO-1's premise.
  Caveat: `loadConnections`/`loadGraph` (the "graph open" half of PO-1's
  worst case) run against Neo4j, not this pg client — the specific
  "8/3 queued" arithmetic mixes pools, but the core concern (unmeasured
  7th concurrent pg query against max:5) stands on its own.
- `scripts/ingest-openbible-refs.mjs:221-232` and
  `scripts/ingest-words.mjs:131-142` — both build their index AFTER the
  batch-insert loop, inside the transaction; `ingest-openbible-refs.mjs:22`
  documents `BATCH_SIZE = 5000` with a wall-clock estimate comment
  (`PERF-3`). Confirms both PO-2's and PO-4's precedent citations exactly.
- `packages/scripture/src/__tests__/strongs-queries.test.ts:16-27` — the
  existing harness for `getWordTags` only asserts `LEFT JOIN`,
  `strongs_lexicon`, `char_start` substrings; it does not assert
  `GROUP BY`/`json_agg`/one-row-per-word. Confirms PO-3: the row-shape
  invariant is genuinely unpinned in the harness as it stands today.
- `scripts/smoke-openbible.mjs:41` — `check('openbible edges present
  (expanded > source rows)', n.n > 344799, ...)` — confirms PO-7's
  precedent citation (hardcoded floor vs. "reported only").
- `scripts/ingest-strongs.mjs` and `scripts/smoke-strongs.mjs` do not
  exist yet — consistent with harness-first staging (red tests already
  committed in `scripts/__tests__/strongs.test.mjs`).
- Accordion is a real house pattern (`Accordion`/`AccordionItem` from
  `components/ui/accordion.tsx`, radix-based) already used for cross-refs
  at `scripture.tsx:1026`, sitting at the bottom of `PanelBody` (blockquote
  → art → chips → cross-refs accordion), confirming UA-4's distance
  premise.

## Table

| ID | Tag | Rationale (≤25 words) | Stance |
|---|---|---|---|
| PO-1 | material | Verified: pool `max:5`, 6-item `Promise.all` already exists; 7th unmeasured query is real. "Graph open" clause conflates Neo4j with the pg pool — trim that phrase. | Affirm High, narrow the scenario |
| PO-2 | material | Verified against both `ingest-openbible-refs.mjs` and `ingest-words.mjs`: GIN/B-tree indexes are built post-loop, in-tx. Plan's DDL-block phrasing genuinely invites the wrong order. | Affirm High |
| PO-3 | material | Verified: current harness (`strongs-queries.test.ts`) doesn't assert GROUP BY/json_agg or one-row-per-word. Real gap for a multi-strongs word before implementation locks the shape. | Affirm High |
| PO-4 | material | Verified precedent (`BATCH_SIZE=5000`, `elapsedMs` logging, wall-clock comment) exists at smaller scale and plan is silent on both for ~790k rows. Cheap to add now. | Affirm Medium |
| PO-5 | noise | Plan's own text pairs "stream" with "(regular format, regex walk)" in the same clause — already signals in-memory regex, not a true SAX stream. Ambiguity is smaller than claimed. | Downgrade — self-resolving in context |
| PO-6 | noise | Same plan bullet also elides `--dry-run` flag semantics, "session probe," and "scrub" specifics without complaint — "house events" is consistent shorthand, not a real inconsistency signal. | Downgrade — inconsistent nitpick |
| PO-7 | material | Verified precedent (`smoke-openbible.mjs:41`, hardcoded `n.n > 344799`) exists; plan's coverage check has no analogous floor. Cheap, prevents silent regression. | Affirm Medium |
| UA-1 | material | Verified: blockquote is literally `text-sm` (14px), confirmed at scripture.tsx:856. Directly affects Abram's own mis-taps on the touch device he'll use — not a hypothetical AT concern. | Affirm High |
| UA-2 | material | Hover-only affordance is a real, well-known touch-discoverability failure; plan's own mobile Sheet proves touch is in scope for Abram himself, not just AT users. | Affirm High |
| UA-3 | risky | Concern (wall-of-buttons for AT) is plausible but Abram is the sole user with no stated screen-reader use. Proposed fix (opt-in toggle + alternate render mode) is disproportionate scope for a personal app. | Downgrade High→risky, lighter fix needed |
| UA-4 | material | Verified panel order (blockquote top → art → chips → cross-refs accordion bottom) plus mobile 75dvh sheet: a word tap causing an off-screen state change is a real UX confusion for Abram directly, any ability. | Affirm Medium |
| UA-5 | material | Plan specifies no selection styling and Failure mode 7 only covers initial render, not tap-state; a reflow-on-tap bug would visibly annoy Abram regardless of AT status. | Affirm Medium |
| UA-6 | material | Verified: sheet is exactly `max-h-[75dvh] overflow-y-auto` (scripture.tsx:745); a 400-char-expand inside a nested scroll region disorienting the sole user is a concrete, general UX risk. | Affirm Medium |
| UA-7 | material | "Stacked" is genuinely unspecified structurally; ambiguity causes rework regardless of AT — Abram himself needs to read multi-entry results cleanly. Keep the SR-grouping clause but it's secondary. | Affirm Medium, reweight rationale |
| UA-8 | material | Not AT-specific: 20+ per-word tab stops break normal keyboard flow for any keyboard user, and this codebase already treats keyboard nav as a first-class path (Back button, nav links) for the single user. | Affirm Medium |

## Summary

- 12 material (PO-1, PO-2, PO-3, PO-4, PO-7, UA-1, UA-2, UA-4, UA-5, UA-6,
  UA-7, UA-8)
- 2 noise (PO-5, PO-6)
- 1 risky (UA-3)
- 0 out-of-scope

Net read: panel-1's perf-obs findings are well-grounded against real
precedent (idx-post-bulk-load, BATCH_SIZE, coverage-floor patterns all
verified in the actual ingest scripts) with two low-value items (PO-5,
PO-6) that are self-resolving or inconsistently applied. Panel-1's
ux-a11y findings are strong where they describe Abram's own direct
experience (tap targets, discoverability, reflow, sheet nesting, keyboard
flow) — the "one user, personal app" framing does not make those
optional. The one item that leans on hypothetical screen-reader use
(UA-3) is downgraded from a hard architectural fork (opt-in toggle +
alternate render mode) to "risky": worth a lighter-weight mitigation
(e.g. a single `aria-label` framing the word layer as supplementary,
without gating the whole feature behind a toggle), not the full fix as
proposed.

