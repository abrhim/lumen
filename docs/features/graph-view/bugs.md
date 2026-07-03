# Bugs — graph-view

Code-panel: 8 specialists, 61 findings. Code-adversarial: 8 taggers — 32 material,
9 risky, 14 noise, 3 out-of-scope, plus 3 findings *refuted with evidence* (CUX-1
remount claim — fiber-level trace; COBS-4 crash-boundary claim — Await IS a class
boundary; CDATA-3 — contradicted by the live verify run) and 1 net-new finding
raised by a tagger (B15). One finding empirically benchmarked against prod Neo4j
(CPERF-1). Dedup applied; severity = highest across raisers.

## Confirmed bugs

| # | Title | Sev | Cat | Source (raised_by) | Fix |
|---|---|---|---|---|---|
| B1 | Stale-graph window: pending dim clears when loaderData commits, before deferred data lands (startTransition holds old tree undimmed) | med | correctness | CCOR-1 (correctness, adv-correctness) | request echo in GraphPanelData + overlay-level resolved tracking; dim rendered outside the Suspense boundary |
| B2 | `truncated.total` undercounts at depth≥2 (capped-frontier counting) vs FM-2 "reported accurately" | med | correctness | CCOR-3 | document lower-bound semantics in NeighborhoodResult; UI renders "N+" at depth>1; plan-amendment note |
| B3 | Each layer traverses twice (count + collect) — verified equal-or-faster merged on prod | med | perf | CPERF-1 (perf, adv-perf w/ live benchmark) | single collect per layer; total = size(), layer = slice |
| B4 | Edge collection uncapped server-side; force-layout gate ignores edge count | med | perf/security | CPERF-2 + CSEC-2 (partial) | Cypher LIMIT on edges CALL; `useForce` gates on edges.length too |
| B5 | Legend toggle tears down + restarts the whole simulation | med | perf/ux | CPERF-3 + CUX-5 (≥2 reviewers) | ForceLayout receives full vm + hiddenTypes; visibility toggled via refs, sim untouched |
| B6 | Hiding all types → blank canvas, no message; `isEmpty` checks unfiltered nodes | med | correctness | CCOR-7 | pure `filterVM` in graph-model + distinct all-hidden copy |
| B7 | Layout control shows stale `force` selection (aria-checked lies) when force is non-viable | med | correctness/a11y | CCOR-4 | derive effectiveLayout; disable force option when non-viable |
| B8 | Charset-invalid `?graph` silently no-ops instead of overlay not-found; optimistic/server disagree | med | api-contract | CAPI-1 + CAPI-5 (≥2) | invalid ids resolve a not-found GraphPanelData without querying/caching; regex narrowed (CSEC-4 opportunistic) |
| B9 | KV write DoS: junk/not-found `?graph` cached 7 days; free tier = 1,000 writes/day | high | security (carve-out) | CSEC-1 | graph-specific cache path: only `found:true` cached 7d; not-found/degraded never written |
| B10 | Literal NUL bytes made backfill script binary/undiffable | low | security | CSEC-6 | fixed (printable delimiter) — this commit |
| B11 | Conflicting PG edge rows logged but still stamped (last-write-wins, contradicts own header) | med | data-integrity | CDATA-1 | partition conflicts out of stamp set + sample log |
| B12 | `--verify` has no per-edge reconcile — violates DATA-7 carve-out text | high | data-integrity (carve-out) | CDATA-2 | page LM edges, reconcile against PG multi-map |
| B13 | verify paging SKIP/LIMIT without ORDER BY — unstable pagination | med | data-integrity | CDATA-4 | ORDER BY id / elementId in paged queries |
| B14 | verify `observedNodes` Map collapses colliding ids (280/262 live) | med | data-integrity | CDATA-5 | detect + report per-id divergence while folding pages |
| B15 | verify `dirty` ignores `missingFromGraph` — a class-level join miss (1,533 chapters) reads "clean" | med | data-integrity | raised by adv-data-integrity | missing sample ids logged per class + report block; documented exclusion rationale |
| B16 | No invoker-ref focus restore (UX-10 conformance); fragile across 3 entry points | med | ux/a11y | CUX-2 | capture invoker on open; onCloseAutoFocus restores |
| B17 | Controls: pending disables client-only Layout/View; native `disabled` drops focus; role=radio without roving tabindex | med | a11y | CUX-6 + CA11Y-4 + CA11Y-1 (right-sized) (≥2) | aria-pressed toggle buttons; only Depth gated, via aria-disabled |
| B18 | aria-live regions mount with final text (SRs likely never announce) + Title reads raw entityId + no announce/focus on view switch | med | a11y | CA11Y-2 + CA11Y-5 + CA11Y-9 | single persistent live region in overlay filled via effect; generic Title; focus list on switch |
| B19 | Log conformance: elapsedMs missing; graph_not_found shape sparse; cache hits re-log; no KV-hit test | med | observability | COBS-1 + COBS-6 + COBS-2/3/7 (≥2) | timing captured; shape parity; origin-only logging via B9's cache path; KV-hit test |
| B20 | Backfill credential scrubbing is convention-only (PG DSN path unscrubbed); no scrub()/test | med | security | COBS-5 + CSEC-5 (≥2) | scrub() helper on all error logging + node:test |
| B21 | `centerUnion` includes StrongsWord/JstReading — plan lists word surfaces Out | low | api-contract | CAPI-6 | exclude from center union |
| B22 | ForceLayout O(E×N) `.some()` node-membership scan | low | perf | CPERF-7 | Set lookup |
| B23 | d3 stack ships to radial-only/reduced-motion users (no layout chunk split) | med | perf | CPERF-5 | React.lazy both layouts inside overlay |
| B24 | Recenter ring too faint (UX-5 intent) + depth-1 impossible truncation advice + faint-token contrast | low | ux/a11y | CUX-3 + CUX-4 + CA11Y-7 | stroke up; copy varies by depth; text-muted-foreground swaps |

All 24 fixed in cbe0be0 (B10 in the NUL-replacement edit within the same commit).

Repro tests: loader (B8, B9, B19-cache-hit), package harness (B3 single-pass, B4 edge LIMIT), graph-model (B6 filterVM), backfill node:test (B11 partition, B13 ORDER BY, B20 scrub). UI-interaction bugs B1, B5, B7, B16–B18, B24: **repro-deferred** — no component-test infra in apps/web; manual recipes recorded below; logic extracted to pure functions where feasible (B6).

Manual recipes (repro-deferred): B1 recenter on hub, observe no dim until data lands · B5 toggle legend, sim restarts · B7 recenter to >220-node hub with force selected · B16 open graph from chip, Esc, observe focus · B17 tab through controls while pending · B18 VoiceOver announce on load.

## Needs investigation
(none — every ambiguous finding was resolved by an adversarial tagger with code/live evidence)

## Preference (captured for learnings)
- CAPI-2 backfill report field naming; CAPI-4 surplus exports; CDATA-6/7 extra sample logging; CPERF-8 collections-query caching; CUX-7 sheet↔overlay transition choreography; CA11Y-6 hover-dim contrast (transient, mouse-only); CCOR-5 SSR matchMedia divergence (narrow, self-healing); CCOR-2 edgeRefs index coupling (inert while caller pre-filters — comment added in fix B5).

## Out-of-scope
- CAPI-3 (three found-shape conventions — re-litigates rejected API-2); CAPI-7 (derive rel-type allowlist — conflicts with fail-closed posture; design follow-up); CA11Y-3 (canvas keyboard nav — deferred with A11Y-1/7); CPERF-6 (PENDING_FOREVER — refuted as bounded); CPERF-4 partial (IN-visited scan — bounded by B4's cap; revisit if hub latency regresses).

## Provenance histogram (for retro)
| Origin | Count |
|---|---|
| Should have been caught by plan | 2 (B2 FM-2 wording vs bounded counting; B15 verify-semantics unspecified) |
| Should have been caught by harness | 4 (B3, B4, B8, B19 — all assertable contract gaps) |
| Should have been caught by panel-1 | 0 (panel-1 ran pre-code; these are implementation defects) |
| Should have been caught by panel-2 | 0 |
| Genuinely emergent / refactor artifact | 18 (implementation-stage defects caught by code-panel as designed) |
