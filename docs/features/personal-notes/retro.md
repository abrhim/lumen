# Retro — personal-notes (step 14, 2026-07-30)

## 1. Plan accuracy

**Drift score: 2/5.** The A1–A19 amendment set survived implementation
nearly intact — GROUP_KEYS frozen, canonical-form C(md) invariant, DEFINER
capture RPC, kill-switch gates, bundle isolation all shipped as designed.
Real deviations: soft-delete had to move to a SECURITY DEFINER RPC (a
Postgres semantics discovery no design doc anticipated: an UPDATE's NEW row
is checked against SELECT policies whenever the statement reads the table),
`title_line` became a bounded generated column, and Abram added a second
feature's worth of mid-stream scope (suggestion drilling, entity/episode
search in `[[`, live linked rail) that the plan never contained.

## 2. Panel signal vs noise

Code phase (steps 9–10): 73 canonical findings → **61 material / 2 risky /
7 noise / 3 out-of-scope**. Dissent rate = (61+2)/73 = **0.86**. One
promotion against a panel-2 tag (CP-50, contract rule) — recorded openly in
bugs.md; the meta itself had flagged that tag as most contestable.

## 3. Harness coverage delta

Bugs the initial harness should have caught but didn't (from bugs.md
provenance, confirmed post-fix):

- **B1** (autosave data loss) + **B2** (unstyled note surface): green suites
  were structurally blind — no concurrent-typing test, no computed-style
  probe. The harness pinned functions, not experience.
- **B8/B9/B19/B28/B43/B45**: the harness's own oracles had defects
  (self-test-less bundle guard with a proven false negative; missing
  negative controls; unpinned invariants). Oracle code needs oracle tests.
- **B5**: pinned A18's emission but never its consumption — a half-pinned
  contract is coverage theater (repeat of the unshaken-ingest lesson).
- **B54** (found at step 13, beyond the filter): Chromium natively
  smooth-scrolls a taller-than-viewport focused contenteditable on a
  keystroke — no assertion class in the harness could have named this in
  advance; what caught it was e2e specs asserting *viewport-relative
  geometry* plus scroll-API-trap forensics. The generalizable pin:
  "the page does not move while typing with a visible caret".

## 4. Wasted effort

Nothing rubber-stamped: panel-2 killed 7/73 and re-scoped 3, and the meta's
tie-breaks prevented two bad suppressions. The genuinely low-yield spend was
my own mid-saga theorizing on B54 — four plausible product suspects were
"fixed" (deferred activedescendant, anchor-gated ARIA timing) before a
5-minute bisect matrix exonerated all of them; two of those workarounds then
had to be reverted to satisfy the B10/B36 contracts. Bisect first, theorize
second. The 4-worker fix fan-out earned its cost (53 items cleared in one
pass) but produced 3 integration-only spec failures that took a further
session to converge — worker-local green is not integration green.

## 5. Recommendations

1. Pin a "page does not scroll while typing with a visible caret" e2e
   assertion in every editor-bearing feature; browser-native scroll bugs
   are invisible to every unit layer.
2. Give every custom test oracle (bundle guards, smoke probes) a
   `--self-test` negative control in the same PR that creates it.
3. When a UI defect survives one plausible fix, stop patching and run a
   suppression bisect matrix before the second fix — cap theorizing at one
   failed attempt.

## 6. Quality signals

```json
{
  "feature_slug": "personal-notes",
  "tier": "large",
  "plan_to_code_drift": 2,
  "panel_2_dissent_rate": 0.86,
  "post_merge_bugs_caught": null,
  "panel_agent_invocations": 19,
  "bug_yield_per_panel_agent": 2.79,
  "skill_version": "c0f4bb2"
}
```

(19 = 9 code-panel lanes + 9 adversarial taggers + 1 meta; 53 confirmed
work items / 19.)

## 7. Provenance histogram

Attributed by earliest-gate rule at work-item granularity. Most items are
implementation defects surfaced by panel-1 at step 9 — the pipeline working
as designed — so they file under "emergent".

| Origin | Count | Basis |
|---|---:|---|
| Should have been caught by plan | 0 | no confirmed bug traces to a wrong/missing plan invariant |
| Should have been caught by harness | 9 | B1, B2 (green suites structurally blind: no concurrent-typing test, no computed-style probe), B8, B9, B19, B28, B43, B45 (test-gap/oracle/invariant defects), B5 (harness pinned A18 emission only, never consumption) |
| Should have been caught by panel-1 | 0 | — |
| Should have been caught by panel-2 | 0 | no confirmed bug was noise/risky-suppressed (meta tie-breaks prevented CP-23/CP-47; recorded) |
| Genuinely emergent / implementation | 44 | remaining work items |

Post-filter addendum: **B54** (Chromium keystroke-reveal) files as
emergent/upstream-browser — reproduced at the pre-feature baseline, so it
predates every gate this pipeline ran.
