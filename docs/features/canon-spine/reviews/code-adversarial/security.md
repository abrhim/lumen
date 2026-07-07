| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| CSEC-1 | material | Confirmed: SPINE_DDL DROPs+recreates `lumen.words` without ENABLE RLS/policy, wiping the RLS convention `setup-triggers-and-rls.sql` and plan.md (SEC-5) already established for it. |
| CSEC-2 | material | Confirmed: line 124 GRANT includes `migration_state`. Low blast radius (no secrets in rows) but violates least-privilege; one-line fix. |
| CSEC-3 | material | Confirmed: smoke's catch (line 100) uses a bespoke regex, not the shared `scrub()` in migrate/ingest; genuinely misses `password=` query-param leaks. |
| CSEC-4 | risky | Both sub-claims true, but smoke issues no multi-statement DDL, so :6543 is functionally safe there; extracting a shared `loadAdminUrl` module outweighs the near-zero real exposure. |
| CSEC-5 | material | Confirmed existence-only marker check (line 156-157). Worse than stated: plan.md's MIG-8 "+ human confirmation" gate for P4 isn't implemented at all. |
| CSEC-6 | material | Confirmed: all 3 scripts `require(apps/web/node_modules/postgres)`; root package.json has `pg` but not `postgres` — reach-in is deliberate, not incidental. Trivial fix: add root devDependency. |

**Overall stance:** mostly signal. Every finding's factual claim checked out against the actual code (SPINE_DDL, `loadAdminUrl`, the P4 gate, the GRANT list, and the cross-workspace `require`), and five of six have fixes that are small relative to the gap they close — CSEC-1 in particular is worse than framed, since it contradicts the project's own stated RLS-convention commitment in plan.md, and CSEC-5 undersells that P4's "human confirmation" gate from the plan is simply absent from the code. Only CSEC-4 is overstated: smoke never runs multi-statement DDL, so the missing :6543 guard has no demonstrated failure mode there, and the proposed dedup fix costs more than the bug is worth.
