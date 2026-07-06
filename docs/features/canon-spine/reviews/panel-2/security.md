# Security review — canon-spine plan (PANEL-2 / ADVERSARIAL)

Verified against `scripts/setup-readonly-role.sql`, `scripts/setup-triggers-and-rls.sql`,
`docs/features/canon-spine/plan.md`, `docs/design/canon-spine.md`, and
`scripts/backfill-neo4j-collections.mjs` (scrub/credential precedent). Context applied:
low-traffic personal app, single developer — enterprise-grade process asks are downweighted;
concrete, verified, cheap-to-fix defects are not.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| SEC-1 | material | Verified: `ALTER DEFAULT PRIVILEGES` without `FOR ROLE` binds to the executing role only. Real break if migration connects as a different role. |
| SEC-2 | risky | No admin/DDL credential source exists anywhere in repo (checked env, scripts) — real gap, but fails loudly (permission denied), not silently. |
| SEC-3 | material | `scrub()` precedent is established and cheap (backfill-neo4j-collections.mjs); omitting it from two new scripts is an easy, real credential-leak regression. |
| SEC-4 | out-of-scope | Tokenizer input is trusted canon text (verses.text), not attacker-controlled — "injection" framing is wrong; naive-SQL breakage is a correctness bug, not a security one. |
| SEC-5 | material | Claim verified: policy-without-RLS-enabled silently no-ops in Postgres. Matches an existing 5-table repo convention; 3-line, zero-risk addition. |
| SEC-6 | material | Design doc itself flags this as an open question (Q1); `lumen.nodes` filtering vs. `getPublicCollectionIds` convention is genuinely unresolved and consumer-visible. |
| SEC-7 | noise | No real attack surface identified — `tokenize()` is a pure string splitter; worst case of misuse is a doc-comment gap, not a vulnerability. |
| SEC-8 | out-of-scope | Targets the word-study UI, which plan.md explicitly excludes from this feature ("Out": needs Strong's alignment first). Not this plan's surface. |

## Stance

SEC-1 checks out exactly as written: `ALTER DEFAULT PRIVILEGES IN SCHEMA lumen GRANT SELECT ON TABLES TO lumen_read` (no `FOR ROLE` clause) binds only to whichever role executes it, so if `migrate-canon-spine.mjs` connects under a different admin identity than whoever ran `setup-readonly-role.sql`, the app silently loses SELECT on every new spine table — this is a concrete, high-value fix regardless of the app's scale. SEC-3, SEC-5, and SEC-6 are similarly grounded in verified code/design facts (an established scrub() precedent, verified Postgres RLS-without-ENABLE behavior matching a 5-table repo pattern, and a gap the design doc itself calls out as unresolved), so all three earn `material` despite the low-stakes deployment context — they're cheap, precedent-backed, and concretely actionable. SEC-2 is real (no admin credential convention exists in this repo) but downgraded to `risky`: for a single developer, requiring the plan to pre-name an env var is closer to process than to a defect, and the failure mode is a loud permission error rather than a silent hole. SEC-4 and SEC-8 are misframed as security findings — SEC-4's "injectable" framing doesn't survive contact with the actual trust boundary (canon text, not user input), and SEC-8 targets a feature plan.md explicitly defers — while SEC-7 identifies no actual exploitable surface. Per instructions, SEC-1 and SEC-2 (both High in panel-1) survive synthesis regardless of these tags.
