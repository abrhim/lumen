# Panel 2 — adversarial review of Panel 1 UX — canon-spine

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| UX-1 | out-of-scope | "Next book →" is a new affordance beyond bounds-check fix (FM-10); plan's contract is byte-identical URLs/nav, not new navigation surfaces. |
| UX-2 | material | scripture.tsx is already being edited for real bounds (FM-10); reusing book.tsx's `unit` logic there is cheap and closes a genuine wording bug. |
| UX-3 | material | Same file, same fix as UX-2 — once `unit` exists in scripture.tsx, unit-aware `aria-label` is a free line, correctness not polish. |
| UX-4 | material | `packages/scripture` is already being rewritten this feature; exporting one `unit` helper prevents the exact duplicated-hardcoded-check drift the feature exists to kill. |
| UX-5 | out-of-scope | Correctly self-flagged by panel 1; `verse_count` surfacing is new UI, absent from plan scope, structural-data-only migration. |
| UX-6 | risky | Valid scope-creep risk (tradition data lands "free") but the ask is a plan.md doc line, not a code deliverable — guardrail, not implementation. |
| UX-7 | noise | Restates plan's existing explicit Out-list item ("Word-study UI... needs Strong's alignment first") verbatim; no new information. |
| UX-8 | risky | Real risk (joins replace jsonb reads) but P50/P95 assertions are disproportionate for a 0-user app; a one-line manual latency check suffices for FM-6. |
| UX-9 | noise | Affirms an invariant already stated verbatim in plan's Public contract; no action requested, nothing new to track. |

## Stance

Verified against source: `scripture.tsx` nav block (lines 549–561) confirms the hardcoded "Chapter N/N+1" text and `aria-label="Chapter navigation"` cited by UX-1/2/3; `book.tsx` line 52 (`bookId === "dc" ? "Section" : "Chapter"`) and line 69 aria-label confirm the unit-derivation asymmetry cited by UX-2/3/4; `home.tsx` loader (lines 23–40) confirms today's flat `volume_id` grouping with no tradition dimension, supporting UX-6's premise. Plan's Scope-Out list (plan.md lines 57–63) does not mention home.tsx/tradition-grouping, and plan's Files-touched list (lines 65–77) already includes `scripture.tsx`, `book.tsx`, and `packages/scripture/src/queries.ts`, which is the basis for tagging UX-2/3/4 material (cheap, in-file) versus UX-1/5 out-of-scope (net-new affordances/UI the plan never asked for).

The panel's overall discipline is good — it correctly self-polices UX-5 and largely respects the plan's Out list — but three items (UX-1, UX-6, UX-8) push toward scope beyond a data-layer migration: a new cross-book nav affordance, a plan-doc guardrail whose absence is a risk rather than a defect, and full latency-percentile tooling for an app with no traffic to characterize a baseline against. UX-7 and UX-9 add no information beyond what plan.md already states and should be dropped rather than tracked as separate line items. The four material items (UX-2/3/4, plus none needed for UX-5) are all low-cost corrections inside files the migration is already touching and should be folded into the sweep.
