# PANEL-2 / ADVERSARIAL correctness review — graph-view

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| COR-1 | material | Verified: `get-verse-connections.ts` already dedupes CROSS_REF dupes; `get-neighborhood.test.ts` has zero dedup fixtures. d3 will render doubled lines on real data. |
| COR-2 | material | Confirmed `getNeighborhood(client, entityId, opts)` has no db param; "all-public collections" default is under-specified, not literally unimplementable — loader has `context.db` available. |
| COR-3 | material | Confirmed by reading `explore-graph.ts`: depth>1 only returns tree-edges to center via `path_relationships`, never sibling-to-sibling edges. Core to an Obsidian-style graph. |
| COR-4 | risky | Postgres `entities.id` is a single-table global PK (schema.ts:88), so cross-type id collisions are structurally near-impossible upstream; proposed DB-constraint/API fix outweighs the actual risk. |
| COR-5 | material | Confirmed: no cache-purge/version-bump tooling exists anywhere in repo; `graph:v1:` prefix already anticipates versioning, so the fix is proportionate to a real staleness gap. |
| COR-6 | material | Plausible real path: chip click inside mobile verse Sheet adds `?graph=X` while Sheet is open — two Radix dialogs stacking is a real a11y risk, not hypothetical. |
| COR-7 | risky | Recenter-via-`navigate()` is barely a finding; abort-signal wiring is a backend resource-waste issue (React Router's Await already discards stale results), fix touches shared `neo4j-http` client across all consumers. |
| COR-8 | material | Plan's own prior-learnings table commits partial-failure handling in-scope, yet FM list omits it — a genuine internal-consistency gap; fix (one more assertion) is cheap. |
| COR-9 | noise | Derivative of COR-1: the shown/total ambiguity only exists if/once edge dedup lands. Resolving COR-1 properly resolves this; not independently actionable. |

## Overall stance

Panel-1's correctness findings hold up well under code verification — COR-1 and COR-3 are directly confirmed by reading `get-verse-connections.ts` and `explore-graph.ts`, and COR-5's cache-staleness claim is confirmed by the total absence of any purge tooling in the repo. Two findings (COR-4, COR-7) get downgraded to `risky`: COR-4's proposed DB-constraint fix outweighs a risk that's likely already foreclosed by Postgres's single-table global `entities.id` primary key, and COR-7 bundles a trivial spec question with a backend efficiency concern whose fix (threading abort signals through the shared `neo4j-http` client) is disproportionate to its invisible-to-the-user impact. COR-9 is marked `noise` as pure derivative commentary on COR-1 that resolves itself once COR-1 is fixed. No findings are downgraded out of scope — all nine engage directly with plan.md/harness gaps.
