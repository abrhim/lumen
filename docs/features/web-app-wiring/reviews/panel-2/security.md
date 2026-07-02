# Panel-2 Adversarial Security Review — web-app-wiring

Reviewer: PANEL-2 ADVERSARIAL (security). Verified each panel-1 finding against actual code/config in /Users/abram/code/lumen (wrangler.json, .dev.vars, headers.server.test.ts, scripts/setup-triggers-and-rls.sql, packages/scripture/src/graph/*, resolve-reference.ts) rather than taking panel-1's claims at face value.

| ID | Tag | Rationale (≤ 25 words) |
|----|-----|-------------------------|
| SEC-1 | material | Verified: superuser bypasses confirmed RLS public-read policies (setup-triggers-and-rls.sql). Fix is a standard scoped role, proportionate. Safety carve-out applies anyway. |
| SEC-2 | risky | Confirmed live secret in gitignored, untracked `.dev.vars`. Real but low-blast-radius; fix bundles out-of-scope pre-commit tooling onto a dev-only rotation deferred to Phase 5. |
| SEC-3 | risky | No CSP confirmed (headers.server.test.ts has only 4 headers). Reasonable hardening but justification conflates with SEC-4; low-risk read-only Phase-1 surface. |
| SEC-4 | noise | Verified no `dangerouslySetInnerHTML` anywhere in repo. Asks to "confirm" a safe framework default already true — nothing actionable. |
| SEC-5 | risky | Cache key spec genuinely unstated; overlaps independently-raised COR-4. Real gap but blast radius is self-poisoning within one KV namespace, not cross-tenant. |
| SEC-6 | out-of-scope | Verified `exploreGraph`'s `[*1..${depth}]` is real unparameterized interpolation, but confirmed unreachable — this feature only calls `find-cross-references.ts`'s parameterized query. |
| SEC-7 | out-of-scope | Plan and panel-1 both state this is accepted-by-design; repo public by explicit owner decision. Nothing to fix within this feature. |
| SEC-8 | noise | `resolveReference`/loaders return structured data, not raw exceptions; standard RR7 error boundaries don't leak stack traces by default. Thin, unconfirmed real gap. |
| SEC-9 | risky | Legitimate hygiene, trivial fix (key prefix string), but no collision exists today — single feature, single binding. Theoretical/future-only risk. |
| SEC-10 | noise | Queries are parameterized so no injection risk; length bound is a DoS nicety CF Workers' own request/exec limits already largely cover. |

## Overall stance

Panel-1's list is honest and mostly grounded in real code (verified RLS policies, verified missing CSP, verified live secret, verified unparameterized `exploreGraph` depth) rather than speculative — but several findings ask for fixes disproportionate to a read-only, no-auth, Phase-1 proof-of-stack (SEC-2, SEC-3, SEC-9 bundle process/tooling asks onto small findings). SEC-1 is the one finding that's unambiguously real and cheap to fix now before write paths get bolted on later; it should not wait. SEC-6/SEC-7 are correctly scoped out — one targets dead code for this feature, the other restates an accepted design tradeoff already documented in the plan. SEC-4/SEC-8/SEC-10 ask to "confirm" or "note" things that hold true by default (React escaping, parameterized queries, structured error returns) and add no new safeguard.
