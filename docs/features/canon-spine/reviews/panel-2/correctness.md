# Panel 2 — Adversarial Correctness Review — Panel 1 correctness.md (canon-spine)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| COR-1 | material | Confirmed: `queries.ts` L48-49 reads `chapter_number` directly; plan/Scope never names the P4-safe join replacement. High severity survives. |
| COR-2 | material | Confirmed: `spine-queries.test.ts` tests only volume/book `resolveReference`, never chapter/verse, `getPassage`, or `searchScriptures`, despite FM-7's claim. |
| COR-3 | material | Confirmed: `searchScriptures` L61-70 filters on `verses.volume_id`, a P4-dropped transition column; no join path specified anywhere in scope/design. |
| COR-4 | material | Confirmed: both `diffQueryParity` cases (canon-spine.test.mjs L23-29) are same-order; no permuted-equal case exists to catch ts_rank-tie false positives. |
| COR-5 | material | Design doc L68 states "nothing derivable stored," yet L43 stores `chapters.verse_count` NOT NULL with no reconciliation or recompute rule. Real contradiction. |
| COR-6 | risky | Real gap, but citation (queries.ts L106) supports OD-as-book, not id collision; collision implausible under current human-curated slug conventions. |
| COR-7 | material | Confirmed: scripture.tsx L558-560 renders `chapter+1` link unconditionally; plan commits to "real bounds" but never names the source query. |
| COR-8 | risky | Confirmed test gap (no `--`/bracket/pilcrow cases), but corpus is gitignored SQLite dump — can't confirm these chars occur in source text. |
| COR-9 | material | Confirmed: no failure mode (1-10) checks summary `metadata.chapter_id` resolves to `lumen.chapters`; orphan stamping would silently return null. |

## Stance

Panel 1's correctness review holds up well under adversarial re-verification: 7 of 9 findings are **material** — each was checked directly against `queries.ts`, the three harness files (`spine-queries.test.ts`, `canon-spine.test.mjs`, `tokenize.test.ts`), `scripture.tsx`, and the design doc's exact wording, and each is a real, present gap (not speculation about unwritten code) with an actionable, proportionate fix. Notably COR-5 was flagged for extra scrutiny (challenges a human-approved design doc) and survives on the merits: the design doc's own words — "Nothing derivable stored" (L68) alongside a stored `verse_count NOT NULL` column (L43) with no recompute/reconciliation rule — is a genuine, textual self-contradiction, not a nitpick.

Two findings are downgraded to **risky**: COR-6's underlying concern (no id-collision invariant between `books.id`/`chapters.id`) is real and ties to the plan's own open "lumen.nodes" question, but panel-1's supporting code citation doesn't actually back the claim, and collision requires an implausible human-authoring accident under current slug conventions — plausible, not demonstrated. COR-8's harness gap is confirmed (no `--`/bracket/pilcrow test cases), but the actual scripture corpus lives in a gitignored SQLite dump inaccessible to verification, so whether those characters occur in-corpus is asserted, not shown.

No findings were tagged noise or out-of-scope — every item traces to a concrete file/line and a concrete, checkable claim about this feature's own plan, design, or harness.
