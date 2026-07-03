# Retro — graph-view

Closed 2026-07-03. Full pipeline: plan → 8+8 plan panels → gate → harness-first
implementation → live backfill (253,499 edges stamped + verified) → 8+8 code
panels → 24 confirmed bugs → all fixed (cbe0be0) → 140 tests green.

## 1. Plan accuracy

**Drift: 2.** Core scope shipped as planned (collection-aware `getNeighborhood`,
backfill, URL-driven overlay, depth picker, entry points, contract-only
collections). Amendments were real but contained, and all logged in-flight:
PERF-4 proved unimplementable in the single-route architecture; the chapter
entry point moved to the summary node after a live probe; the backfill needed
label-union index seeks and a second node source (verses aren't entities). The
process caught each at the point of contact and recorded it.

## 2. Panel signal vs noise

Plan-stage panel-2: **material 43 / risky 19 / noise 8 / out-of-scope 6** →
dissent **0.816** (62/76). Code-stage adversarial: **material 32 / risky 10 /
noise 16 / out-of-scope 2** → dissent **0.70** (42/60). Both far above the 20%
collapse threshold. The code-stage adversarial pass earned special credit for
*refutations with evidence*: it killed 6 plausible findings — including a React
remount claim (CUX-1) that would have triggered a pointless state-lifting
refactor, a crash-boundary claim (COBS-4) disproven by reading react-router's
Await source, and one prediction (CDATA-3) contradicted by the live verify run.
One tagger empirically benchmarked both Cypher shapes against prod before
tagging (CPERF-1). One tagger raised a net-new finding of its own (B15).

## 3. Harness coverage delta

Initial harness caught **0 of 24** post-implementation bugs — but per the
provenance histogram, only 4 were harness-attributable gaps (B3, B4, B8, B19:
all assertable contract properties the harness didn't assert — Cypher shape,
cache discipline, log fields). 18 of 24 were genuinely emergent implementation
defects, which is what the code-stage panels exist for. 2 were plan-stage
(FM-2's "reported accurately" was unsatisfiable as written; verify semantics
under-specified). The live smoke earned its keep twice: it caught the
`WITH c AS s` scope bug and the index-blind unlabeled MATCH within minutes.
The big structural gap: **6 UI-interaction bugs were repro-deferred** because
apps/web has no component-test infrastructure — pure-logic extraction
(filterVM) covered some, manual recipes cover the rest.

## 4. Wasted effort

Remarkably little. The refuted-findings list is the anti-waste story: without
the adversarial pass, CUX-1 alone would have consumed a risky refactor. Idle
cost: three scheduled wake-ups waiting on taggers (~12 min wall-clock, no
token cost). The `findConflictingEdgeRows` → `partitionEdgeRows` back-compat
shim is minor cruft kept for test continuity.

## 5. Recommendations

1. Stand up component-test infrastructure (Testing Library + jsdom) in apps/web
   before the next UI-heavy feature — 6 of 24 confirmed bugs were repro-deferred
   for lack of it.
2. Panel briefs must instruct: verify data-shape claims against the LIVE store,
   not ingest source code — two specialists reasoned from scripts the live graph
   predates (chapter id format) and reached wrong conclusions.
3. When a review finding disputes framework semantics (React reconciliation,
   Suspense/transition behavior), require an adversarial source-trace before
   acting — both disputed claims this feature were resolved by reading vendored
   framework code, once in each direction.

## 6. Quality signals

```json
{
  "feature_slug": "graph-view",
  "tier": "large",
  "plan_to_code_drift": 2,
  "panel_2_dissent_rate": 0.816,
  "post_merge_bugs_caught": null,
  "panel_agent_invocations": 32,
  "bug_yield_per_panel_agent": 0.75,
  "skill_version": "df14f48"
}
```

(8 panel-1 + 8 panel-2 + 8 code-panel + 8 code-adversarial = 32; 24 confirmed
bugs / 32 = 0.75 — the highest yield of any feature to date, consistent with a
net-new subsystem plus a prod data migration.)

## 7. Provenance histogram

| Origin | Count |
|---|---|
| Should have been caught by plan | 2 (B2 FM-2 wording vs bounded counting; B15 verify-semantics unspecified) |
| Should have been caught by harness | 4 (B3, B4, B8, B19 — all assertable contract gaps) |
| Should have been caught by panel-1 | 0 |
| Should have been caught by panel-2 | 0 |
| Genuinely emergent / refactor artifact | 18 |
