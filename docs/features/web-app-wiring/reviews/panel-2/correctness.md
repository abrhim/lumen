# Panel-2 Adversarial Review — Correctness (web-app-wiring)

Reviewed against actual repo state: `apps/web/workers/app.ts`, `packages/neo4j-http/src/client.ts`,
`packages/scripture/src/slug-map.ts`, `apps/web/app/routes/__tests__/scripture.loader.test.ts`,
plus `plan.md` and the existing lib test harnesses (`db.server.test.ts`, `neo4j.server.test.ts`,
`cache.server.test.ts`, `headers.server.test.ts`).

Important context that changes the read on several findings: this is a **pre-implementation,
harness-first review**. Only test files and scaffolding exist (`apps/web/app/lib/__tests__/*`,
`apps/web/app/routes/__tests__/scripture.loader.test.ts`); `db.server.ts`, `neo4j.server.ts`,
`cache.server.ts`, `headers.server.ts`, and `routes/scripture.tsx` do not exist yet. `workers/app.ts`
is still the unmodified stub. Findings are adjudicated against the plan/harness contract, not against
code that hasn't been written.

| ID | Tag | Rationale (≤ 25 words) |
|----|-----|--------------------------|
| COR-1 | risky | Real gap, but plan.md Q1 already commits to adding the KV binding during implementation — not a missed step, just unfinished. Severity-high carve-out applies. |
| COR-2 | material | Genuine concurrent cold-start race; test only proves sequential reuse. Fix (assign-before-await) is proportionate, standard singleton pattern. |
| COR-3 | material | `buildVerseId` exported and unused by plan's inline construction; real drift risk across 3 sites, cheap fix. |
| COR-4 | material | 7-day TTL with zero version/invalidation lever is a real staleness risk; one-line prefix fix. |
| COR-5 | material | Verified: `workers/app.ts` returns `requestHandler(...)` unwrapped; thrown 404s risk missing headers unless the return itself is wrapped. |
| COR-6 | risky | Real coverage gap, but finding's own fix menu says "accept + document" is fine — single-flight de-dup would exceed the bug's impact at this stage. |
| COR-7 | material | Verified 20s `AbortSignal.timeout`; plan's own Aura 72h-idle-wake constraint makes this a real unstated latency budget. |
| COR-8 | noise | Speculative — cites a route-level regex that doesn't exist yet (route unwritten); `parseInt` vs `/^\d+$/` example given doesn't actually diverge. |
| COR-9 | risky | Real postgres.js-on-Workers concern, but Hyperdrive's upstream pooling is designed to absorb exactly this; liveness-check fix may duplicate Hyperdrive's job. |
| COR-10 | noise | Finding concedes existing generic "Neo4j throws" test already catches this path; asks only for a redundant named test. |

## Overall stance

Panel-1 correctness is solid on the two highs and most meds — COR-2 through COR-5 and COR-7 hold up
against the actual code (`workers/app.ts` unwrapped return and the 20s timeout are both verified, not
speculative). COR-1 is real but already tracked as an open plan question with a committed fix, so it's
risky rather than a fresh miss. COR-6 and COR-9 correctly identify gaps but their harder fixes
(single-flight, liveness checks) risk over-engineering relative to a proof-of-stack app sitting behind
Hyperdrive; documentation-only responses are adequate for both. COR-8 and COR-10 are the weakest
findings — COR-8 argues against unwritten code with an example that doesn't actually demonstrate
divergence, and COR-10 admits the gap is already covered by existing test design, just not named
explicitly.
