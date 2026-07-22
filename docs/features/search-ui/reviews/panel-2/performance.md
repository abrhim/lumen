# Panel-2 (adversarial meta-review) — Performance

Reviewer: PANEL-2 ADVERSARIAL, evaluating panel-1/performance.md against the
search-ui plan, the shipped search-endpoint (search.ts, api.search.tsx, plan +
A1–A9), and the three red-first harness files.

## Stance

Mostly signal. The panel's top three findings form a genuinely valuable,
tightly-coupled cluster: PU-1 is a real, live-verified data-loss defect in the
plan's cursor *design* (3-field `tier|score|id` cursor over a shipped 4-field
`(tier, sub, score DESC, id)` sort order that permanently drops the entire
jst/moment sub-partition), and PU-2/PU-3 are the two harness holes that would
let exactly that bug ship green. The remaining three (PU-4/5/6) are correct-but-
inconsequential perf caveats and a bundle-preference whose own cited precedent
cuts against it.

## Tags

| ID | Tag | Rationale |
|----|-----|-----------|
| PU-1 | material | Real cursor-design data-loss bug. search.ts:271/369/505-514 sort `(tier, sub, score DESC, id)` (REL-5); plan.md:26 + F1 cursor omit `sub` — a 3-col keyset permanently drops every jst/moment row once page-1 fills with sub=0. Plan F1 (plan.md:48) even states the order as 3-col, so plan contradicts shipped code. Fix (add `sub`) is correct and minimal. |
| PU-2 | material | Plan makes the bounded-query CPERF-6 guard a day-one deliverable (plan.md:13,52). Verified: search.loader.test.ts:14-16 pins `user:null` + mocks getPublicCollectionIds/searchAll, so the entitled branch (api.search.tsx:94-100 `SELECT id FROM lumen.collections`; collection-access.server.ts:29 getEntitlements) is never exercised — the `<=1` assert can't fail on the path that issues extra queries. Adding an admin-session case fulfills a binding plan requirement. |
| PU-3 | material | Verified: search-cursor-harness.test.ts:51-55 refetches limitPerGroup:25 (no cursor) and asserts it equals ids1 — pure page-1 determinism, not cross-page continuity. This is the exact hole that lets PU-1 pass green (no-dup + determinism both hold under the buggy cursor). Fix's literal `limitPerGroup:50` clamps to 25 (search.ts:146-149) so needs adjustment, but the diagnosis is right and material; a broken test fix fails loudly, not a shipped regression. |
| PU-4 | noise | Correct but inconsequential. Keyset was chosen for deterministic pages (search-endpoint decision 3), never for index-seek cost; the plan makes no index-seek claim. Verified per-page 105-118ms is well within the p95<500ms budget (search-endpoint decision 7). "Document cost" is a doc nicety; "cap pages" edges into deferred abuse-hardening (plan.md:28). No change to shipped correctness/quality. |
| PU-5 | noise | Bundle micro-preference; its own precedent refutes it. Verified: the only lazy() split (GraphOverlay/ForceLayout/RadialLayout) is explicitly for the heavy d3 physics stack (code comment B23). AppMenu (176 lines, radix Popover) — the actual small always-present global-chrome precedent — is eagerly imported in root.tsx:11. A "minimal (input only)" hotkey-triggered instant-search modal is the AppMenu case, not the d3 case; lazy-loading it trades trivial baseline savings for first-open latency. |
| PU-6 | noise | Speculative, no jank measurement (unlike PU-1/PU-4's live probes). Verified no virtualization dep in apps/web/package.json — but a few-hundred cheap text rows render fine without windowing; the deep-scroll scenario is the research-tool journey the plan explicitly defers (plan.md:17, reader-first). Row-cap overlaps deferred scope; adding windowing would complicate F11 (selection-survives-append). Doesn't change shipped quality. |

## Notes on the material cluster

PU-1 + PU-3 are coupled: with visibleCollections `['phase-b']` the F1 harness may
not even surface jst rows, so page-1/page-2 never cross the sub-boundary — the
harness cannot catch PU-1 as written. PU-1's own fix line ("extend F1 to a query
with enough matches in *both* subs") is the right joint remedy. PU-2 is a
distinct, independently-material harness gap on the entitled visibility path.

Stale-doc note honored: search-endpoint A9's "owed" M3 re-window is APPLIED to
prod; no finding here depended on that pending event.
