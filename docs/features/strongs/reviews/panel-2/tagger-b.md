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
