# Security review — graph-view (PANEL-2 adversarial, evaluating PANEL-1)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| SEC-1 | material | Confirmed: Cypher `[*1..N]` only constrains path endpoints, not intermediate hops. FM-8 regex genuinely passes on any `labels(` occurrence, not per-hop proof. |
| SEC-2 | material | Confirmed: `explore-graph.ts:48-66` depth=1 branch is truly unlabeled `MATCH (n {id})`; plan cites it as reference without forbidding copy-paste reuse. |
| SEC-3 | material | Real gap: FM-2 harness mocks `total` directly, never exercising a real count-subquery WHERE clause, so a leaky unconstrained COUNT would go undetected. |
| SEC-4 | noise | Misreads the guard's purpose — `validateLayerQuery` polices raw node labels only; relTypes are never string-interpolated (bound params, allowlist-checked pre-Cypher per FM-5). No exploitable gap. |
| SEC-5 | material | Valid: naive undelimited join (e.g. concat without separator) can collide across collection sets; cheap fix (sorted, delimited/hashed key) closes it. |
| SEC-6 | out-of-scope | Plan explicitly defers auth-scoped/ownership-checked collections to "the collections feature"; finding itself concedes this is a future blocking dependency, not this feature's scope. |
| SEC-7 | material | Confirmed: existing `explore-graph.ts` depth=1 has no Cypher `LIMIT`; plan's own FM-2 hub example (`obedience`) would hit unbounded `collect()` before app-side truncation. |
| SEC-8 | material | Plan states hard Zod bound for `depth` only; `perDepthCap`/`totalCap` unbounded is a real DoS surface if MCP callers pass opts directly. |
| SEC-9 | material | In-scope (backfill is plan deliverable #1); ids sourced from AI-generated phase-b/anthropic-batch content, unwritten script has no stated param-binding contract yet — cheap fix. |
| SEC-10 | material | In-scope, and codebase precedent (`ingest-phase-a.ts:913` raw `console.error('...', err)`) shows the leak pattern already exists — plausible, trivial-cost fix. |

**Overall stance:** Panel-1's security specialist is mostly signal — SEC-1/SEC-2 correctly identify a real, well-known Cypher gotcha (variable-length path patterns constrain only endpoints, not intermediate hops) and a genuinely weak harness assertion (FM-8's disjunctive regex), both verified directly against `explore-graph.ts` and the test file. Only SEC-4 is noise (conflates the raw-label guard's actual purpose with a relType-injection vector that doesn't exist, since relTypes are bound params, never interpolated) and SEC-6 is correctly out-of-scope per the plan's own deferred-collections boundary. The low-severity backfill-script findings (SEC-9/10) are grounded in real codebase precedent rather than generic boilerplate, so they earned material rather than a knee-jerk downgrade.
