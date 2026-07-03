# Panel-2 / api-contract adversarial review — graph-view

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| API-1 | material | Confirmed: `exploreGraph` still unlabeled while plan hardens the identical vector elsewhere; live MCP tool. Safety carve-out overrides scope-creep concern. |
| API-2 | risky | Real 3-way `found` shape drift confirmed by reading all three files, but doc-only fix, no consumer currently conflates the shapes. |
| API-3 | noise | Depth always needs a renderable value (picker); `?verse` legitimately has a null "no selection" state — different domains, not a real inconsistency. |
| API-4 | risky | Confirmed: harness never bounds `entityId`; it flows raw into URL, cache key, param. No injection risk (bound param) but real robustness gap. |
| API-5 | risky | Confirmed: no test asserts collection-array ordering/canonicalization; genuine cache-key duplication risk given central KV-cache design. |
| API-6 | noise | Pure calling-convention preference (opts-object vs positional); zero behavioral or contract impact, bikeshedding. |
| API-7 | material | Backfill exit codes/dry-run-on-failure genuinely unspecified for a script that runs against prod; plan itself flags migrations as always-escalate. |
| API-8 | noise | Verified harness already implements and locks the exact nesting claimed missing; ask is copy-into-prose, not a real gap. |
| API-9 | risky | Confirmed: no test covers omitted `?collections` resolving to defaults end-to-end, violating plan's own "every FM has a harness assertion" claim. |
| API-10 | noise | Confirmed accurate but zero functional impact — one-line plan filename fix, doesn't affect implementation or harness correctness. |

## Overall stance

Verified all ten findings against the actual harness/plan/source files rather than trusting panel-1's prose; nine held up factually, none were fabricated. The one clear must-fix is API-1 — `exploreGraph` shares the exact cross-tenant vector the plan explicitly names as dangerous enough to justify new hardening, and it's live behind a deployed MCP tool, so the safety carve-out makes it material despite living in a sibling function. API-7 earns material because it's an unspecified failure contract for a script that will run against production data. The remaining findings split between genuine but non-blocking contract gaps (API-2/4/5/9, mostly around entityId validation, cache-key canonicalization, and a harness coverage hole panel-1 was right to catch) and low-value nits where the "inconsistency" is either already correctly handled (API-8), justified by differing semantics (API-3), or purely stylistic (API-6, API-10).
