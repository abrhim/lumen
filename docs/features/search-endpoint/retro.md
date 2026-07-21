# Retro — search-endpoint

Code-complete 2026-07-21 on `feature/search-endpoint`, merged with main
(routes.ts + B7 visibility unification), suites 110/110 + 186/187 (the one
red is main's pre-existing CPERF-6 guard trip) + scripts 189/189, e2e smoked
including the delta-marker fix (⟪sware⟫ for q=swore). NOT yet deployed —
merge-to-main + worker deploy and the two prod data re-runs (M2 435-variant
kjv apply, M3 re-window of 178 oversize moments) await explicit go-ahead.
M1–M4 database work has been live in prod since ship day.

## 1. Plan accuracy
**Drift: 3/5.** Structure held completely — M1→M5 shipped in order, every
invariant gate ran, rollback discipline never needed. But decision 2's letter
needed two amendments (A1: `SET LOCAL` unimplementable through Db.execute;
A8: per-leg predicate form after B14 showed `%` unreachable for long episode
titles), and decision 8's window bounds were violated in shipped prod data
(B26: flush-after-append). Nine amendments total (A1–A9), all
implementation-verified.

## 2. Panel signal vs noise
- Plan stage: 74 findings → 54 material, dissent 0.27.
- Code stage: 52 findings (8 roles) → 42 material / 7 noise / 2 risky / 1
  out-of-scope, dissent **0.19** — the highest-signal panel this workflow has
  produced. Four roles independently converged on B2 (visibility phase
  outside the loader try), and the performance reviewer's every claim
  reproduced under the verifier's own EXPLAIN probes to near-identical
  numbers (0.806ms vs claimed 1.0ms).
- The first code-panel run was KILLED with the session (~8 min in, 614k
  tokens, zero returned results). One completed reviewer's findings were
  salvaged from its subagent transcript; the other 7 re-ran from the
  persisted workflow script at full fidelity.

## 3. Harness coverage delta
28 confirmed bugs; **7 harness-attributable** (TESC-1..7 — again the top
provenance class, repeating the user-roles lesson), headlined by B4: nothing
pinned `meta.mode === 'combined'`, so a permanently broken primary path
passed 40 green tests. The post-fix suite pins mode, per-kind payloads,
degraded-event wiring, and the admin branch. The feature's first-ever stress
test (150 req @ c5) found zero runtime failures — consistent with the bug
population being contract/latent-class, not crash-class.

## 4. Wasted effort
The killed panel run (614k tokens, one salvageable result) is the single
biggest waste line. Root cause: panel results lived only in the workflow's
return value; the session kill destroyed seven completed-or-nearly-complete
reviews. Secondary waste: the suite agent's `tsc -b` false-greened on a stale
incremental cache and the fix-verifiers had to catch the type break
themselves.

## 5. Recommendations
1. **Workflows must persist per-agent artifacts incrementally** (write each
   reviewer's file on completion), so a session kill can never destroy
   finished work again.
2. **`tsc -b` requires `--force` in any verification context** — stale
   .tsbuildinfo produces false greens after cross-package type changes.
3. Parallel file-exclusive fix clusters need a dedicated **integration
   stage** for cross-cluster type contracts (`number|null` widening broke at
   the seam both sides had correctly implemented).
4. Ops commits that bump versioned keys (graph:v2 / vconn:v3) must update
   their test pins in the same commit — both were red on main.
5. Punch-listed for the media feature: CPERF-6 guard trip (db.execute ×3 on
   a plain chapter view; deliberately NOT re-pinned here).
6. Phase-b data debt from A5 stands: `melchisedec-1`/`melchizedek-1`
   entity-level duplicate.

## 6. Quality signals
```json
{
  "feature_slug": "search-endpoint",
  "tier": "large",
  "plan_to_code_drift": 3,
  "panel_2_dissent_rate": 0.19,
  "post_merge_bugs_caught": null,
  "panel_agent_invocations": 32,
  "bug_yield_per_panel_agent": 0.875,
  "skill_version": "38b3cbd"
}
```

## 7. Provenance histogram
- **code-origin (12):** B1 B2 B3 B12 B13 B14 B15 B16 B21 B23 B24 B25 —
  route/searchAll logic, all repro'd red→green.
- **harness-origin (7):** B4 B5 B8 B9 B10 B11 + B6's missing pins — tests
  too weak to catch their own bug class.
- **migration-script-origin (6):** B17 B18 B19 B26 B27 B28 — invariant and
  windowing defects, two requiring deferred prod re-runs.
- **coordination-origin (3):** B7 B20 B22 — branch-vs-main drift and
  documentation MUSTs, closed at merge time.
