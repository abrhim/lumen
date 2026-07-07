# Retro — tske-cross-references

Shipped 2026-07-07: 614,209 vote-ranked OpenBible cross-reference edges live
in prod (0 unmapped of 344,799 source rows), verse panel swapped to Postgres
with hybrid curated fallback + cross-canon merge, both smokes green, deployed.

## 1. Plan accuracy
**Drift: 2/5.** The plan's architecture held (spine-validated ingest, one-tx
atomicity, UNION ALL query, panel design), but two product-level gaps were
found only at code review: the old panel's collection-unfiltered behavior
meant Bible verses showed curated cross-canon bridges the new routing hid
(B3, resolved by Abram: merge), and per-source trust labels were silently
dropped (B9). Both were removed-behavior questions a plan-stage audit of the
outgoing code path would have caught. The source itself pivoted pre-plan
(TSKe → OpenBible) on a license finding — naming kept, scope clean.

## 2. Panel signal vs noise
- Plan stage: 52 findings → 33 material / 7 risky / 10 noise / 2 out-of-scope,
  dissent **0.769**. Panel-2 empirically refuted mechanisms (from/to ≈ 53/47
  random) and verified data claims (18 cross-book ranges hiding in the "655").
- Code stage: 35 findings → 18 material / 8 risky / 8 noise / 1 out-of-scope,
  dissent **0.743** — PLUS a parallel 8-angle sweep that contributed the two
  best product catches (B3 cross-canon regression, B8 count inflation) and
  one real defect nobody else saw (B6 lexicographic ordering).
- Convergence was the story: B1 found by 4 independent reviewers (2 repros),
  B4 by 5. Independent convergence ≈ certainty.

## 3. Harness coverage delta
Of 17 confirmed bugs, 4 were harness-attributable. The standout is B2: the
loader-test mock returned the wrong SHAPE and the never-throw degrade wrapper
swallowed every resulting TypeError — 19/19 tests green while zero cross-ref
data ever flowed. **Never-throw wrappers invert test-failure semantics: the
harness must assert the non-degraded path explicitly or it tests nothing.**
That's a new failure class for the learnings file, distinct from web-app-
wiring's "mock-only tests hid data-shape bugs" (same family, sharper edge).

## 4. Wasted effort
Near zero this run. All 16 of my panel agents returned (security took 14.5
min but landed; the retro rule — relaunch-inline on failure — never fired).
The 8-angle sweep I didn't launch overlapped the panels on ~40% of findings,
but its unique catches (B3/B6/B8/B9) paid for the redundancy. Implementing
fixes in parallel with the adversarial tail saved ~20 minutes and cost
nothing — every fix survived its tag.

## 5. Recommendations
1. Add a removed-behavior audit to PLANNING for replacement features: diff
   what the old code path returned (filters, fields, labels) against the new
   design before panels run — B3/B9 were knowable from the deleted Cypher.
2. Any loader test of a never-throw/degrade wrapper MUST include a
   non-degraded happy-path assertion; shape-drift in mocks otherwise passes
   silently (B2 class).
3. When a feature replaces a data source, spot-check famous entities in BOTH
   the old and new source during planning (votes=271 style canaries) — cheap
   and they carried the smoke suite.

## 6. Quality signals
```json
{
  "feature_slug": "tske-cross-references",
  "tier": "large",
  "plan_to_code_drift": 2,
  "panel_2_dissent_rate": 0.769,
  "post_merge_bugs_caught": null,
  "panel_agent_invocations": 28,
  "bug_yield_per_panel_agent": 0.61,
  "skill_version": "dba5c97"
}
```

## 7. Provenance histogram
| Origin | Count |
|---|---|
| Should have been caught by plan | 2 (B3, B9) |
| Should have been caught by harness | 4 (B1, B2, B10, B14) |
| Should have been caught by panel-1 | 2 (B5, B13) |
| Should have been caught by panel-2 | 0 |
| Genuinely emergent / refactor artifact | 9 (B4, B6, B7, B8, B11, B12, B15, B16, B17) |
