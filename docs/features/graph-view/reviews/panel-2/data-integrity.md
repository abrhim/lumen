# Panel-2 adversarial review — data-integrity (graph-view)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| DATA-1 | material | Verified: no relationship element_id captured anywhere (export-neo4j.mjs edge query, backfill-phase-b.ts). get-verse-connections.ts comment confirms parallel edges exist in prod data. |
| DATA-2 | material | Verified exact at cited lines: `{type}:{id}` namespacing is real, `neo4j_id` only in metadata. Naive join would break silently for every namespaced entity. |
| DATA-3 | risky | Confirmed: Phase A writes zero edges, backfill-phase-b.ts always stamps `collection_id='phase-b'`. Real but fix is doc-only; no toggle UI exposes this yet. |
| DATA-4 | risky | Confirmed no BEGIN/COMMIT around DELETE-then-INSERT in backfill-phase-b.ts. Real gap, but needs concurrent-script timing; self-heals on next idempotent run. |
| DATA-5 | risky | `entities.collection_id` nullable is real (schema.ts), but every current insert path always sets it — no NULL rows exist today; forward-looking gap. |
| DATA-6 | risky | Plan is silent on directionality for the new script, confirmed. But get-verse-connections.ts shows undirected matches are sometimes intentional in this codebase — not absolute. |
| DATA-7 | risky | Plausible but speculative; no concrete code path cited showing the described interrupted-then-rerun divergence. Reads as an audit-tooling nice-to-have, not a proven defect. |
| DATA-8 | risky | Valid, low-severity per specialist's own tag; grounded in the plan's documented Q2 fail-open default. Logging gap, not data loss. |
| DATA-9 | out-of-scope | Concerns reconciliation cadence for a *future* dual-write collections feature, which the plan explicitly defers ("that's the collections feature", Out section). |

## Overall stance

DATA-1 and DATA-2 are confirmed against actual code (export-neo4j.mjs, backfill-phase-b.ts) and one is corroborated by a real comment in shipped code acknowledging parallel edges already exist in production data — these are near-certain-to-occur, silent, high-severity correctness bugs for the planned backfill script and should block or gate implementation. The remaining medium/low findings are all technically accurate against the codebase but describe edge-case, currently-unrealized, or self-correcting scenarios (concurrent runs, still-null-free schema fields, undirected-match ambiguity, observability gaps) — real and worth tracking, but not blocking. DATA-9 is scoped to a feature the plan explicitly defers and doesn't belong to this review.
