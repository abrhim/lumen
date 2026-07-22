# Retro — search-ui

Shipped + iterated 2026-07-21→22 on `feature/search-ui`, live at
lumen.abramhimmer.workers.dev (final worker 892b818c). The `/search` page +
global modal + scope faceting + single-scope keyset pagination, built on the
already-live `/api/search`. Not "officially launched" (no announcement) — so
post-ship iteration ran directly against prod. Final: scripture 119/119, web
239/239, tsc -b --force clean; 30 code-panel bugs fixed + 3 user-found + a
design restraint pass, all deployed.

## 1. Plan accuracy
**Drift: 3/5.** Structure held; the one real plan defect was the cursor —
planned as `(tier, score, id)`, but the shipped ORDER BY is
`(tier, sub, score, id)` and the id tiebreak runs in DB collation while the
mint runs in JS code units. Panel-1 caught the missing `sub` (amended
pre-implementation, A-cursor); the code panel then caught the DEEPER
collation split (B1) that only shows on mixed-case-id legs — a two-layer bug
where the plan-stage fix was necessary but not sufficient. Eleven amendments
(A1–A11); the input-model ambiguity (Q6) that four roles independently
flagged was a genuine plan hole closed at the gate.

## 2. Panel signal vs noise
- Plan stage: 58 findings → 35 material, panel-2 dissent 0.40.
- Code stage: 52 findings → 44 material / 8 noise, dissent **0.15** — the
  tightest yet. The taggers independently re-reproduced the headline bugs on
  the live worker (collation dupe, error-body crash, pgp zero-Reference)
  rather than trusting the panel; the one kill that mattered was a perf
  finding re-litigating a ratified decision.

## 3. Harness coverage delta
30 confirmed bugs; the top provenance class stayed harness/test-shaped only
partly — the dominant class this round was **live-behavioral** (pagination
state, focus, SSR-boundary) that the node-only test env (no jsdom/RTL) can't
unit-drive, so ~11 page-component bugs rode code-panel live-probe evidence
instead of red-first unit pins. That's a real coverage gap: a browser-driven
e2e layer would have caught B2/B3/B5 before ship. The collation bug (B1) had
a harness pin that covered only the collation-neutral scripture leg (B30/CC-7)
— the pin existed but tested the wrong leg.

## 4. User-found bugs (the honest column)
Three bugs shipped past both panels and were caught by Abram in live testing:
B-U1 (Space reopens modal — pointer-returned focus), B-U2 (book reference
suppressed all groups), B-U3 (native search-cancel X off-brand). B-U2's mode
recurred as B6 (found ref + zero hits) — the panel caught the residual the
same day. Lesson: no browser e2e = focus/native-control/interaction bugs slip
every automated layer; the human tester is currently that layer.

## 5. Wasted effort / process misfires
- **Concurrent-session deploy regression (self-inflicted):** deployed from a
  feature worktree that had diverged from local main (another session's graph
  fix), silently reverting it live for ~minutes. Caught, merged, redeployed
  the union. Now memorialized ([[concurrent-session-deploy-hazard]]);
  pre-deploy `git log HEAD..main` is mandatory.
- **Scope-check misfire:** launched the full 30-bug fix workflow without first
  surfacing the high-vs-polish split; Abram rightly stopped to ask "what is
  this work." Should have presented the 5-high / 25-polish choice up front.
- One killed workflow (the first fix run) cost little — relaunched from the
  persisted script cleanly.

## 6. Recommendations
1. **Stand up a browser-driven e2e layer** (Playwright) — every user-found
   bug and ~11 code-panel bugs this round were interaction/focus/render bugs
   invisible to node-only vitest. Highest-leverage process gap.
2. **Keyset cursor pins must test a collation-divergent leg**, not just the
   neutral one — a pin on the wrong leg reads as coverage it doesn't provide.
3. **Present fix-scope (high vs polish) before launching a large fix cycle**,
   not after — a 30-bug workflow is a spend the human should choose into.
4. Pre-deploy divergence check is now non-negotiable for worktree deploys.

## 7. Quality signals
```json
{
  "feature_slug": "search-ui",
  "tier": "large",
  "plan_to_code_drift": 3,
  "panel_2_dissent_rate": 0.15,
  "post_merge_bugs_caught": 3,
  "panel_agent_invocations": 32,
  "bug_yield_per_panel_agent": 0.9375,
  "skill_version": "5eba758"
}
```

## 8. Provenance histogram
- **live-behavioral (13):** B2 B3 B5 B6 B9 B13 B15 B19 B21 B24 B28 B29 + B-U1
  — interaction/focus/SSR/render, node-untestable, panel-live-probed or
  human-found.
- **collation/keyset (3):** B1 B20 B30 — the cursor's SQL-vs-JS ordering split.
- **contract/observability (7):** B4 B10 B12 B16 B17 B25 B26.
- **rendering-correctness (4):** B7 B8 B11 B-U2/B-U3.
- **perf/bundle (3):** B14 B18(deferred) B27.
