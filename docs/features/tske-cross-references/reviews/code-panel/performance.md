# CODE-PANEL performance review — tske-cross-references

Reviewed: `crossrefs.ts` UNION ALL query, `ingest-openbible-refs.mjs` bulk load,
`scripture.tsx` loader wiring. Measured against stated bounds: ~614k edges
post-ingest, worker→PG 10–50ms, 0 users, existing indexes per
`scripts/setup-indexes.sql` (`idx_edges_from`, `idx_edges_to`,
`idx_edges_from_rel(from_id, rel_type)`, `idx_edges_collection`).

| ID | Severity | Where | Problem (≤25 words) | Fix (≤30 words) |
|---|---|---|---|---|
| CPERF-1 | Low | `crossrefs.ts:44,51,58,64` — `COUNT(*) OVER ()` + `ORDER BY (metadata->>'votes')::int` | Window/sort has no index support, so Postgres must materialize and sort the entire filtered edge set before `LIMIT` truncates it. Confirmed by window-function semantics, not a plan guess. | Acceptable at current max fan-out (~2,000 rows, sub-ms sort). No fix required now; if any verse's edge count could exceed low thousands, add a pre-LIMIT subquery or cap. |
| CPERF-2 | Low | `crossrefs.ts:59-64` incoming branch | `WHERE e.to_id = $1 AND rel_type=... AND collection_id=...` only has `idx_edges_to(to_id)` to lean on; `rel_type`/`collection_id` filter post-scan, pulling extra rows for verses referenced by both `openbible` and legacy `phase-b` collections. | Add `idx_edges_to_rel(to_id, rel_type, collection_id)` mirroring `idx_edges_from_rel` for symmetric incoming/outgoing index coverage. |
| CPERF-3 | Info | `ingest-openbible-refs.mjs:187-227` single tx, 123×5000-row batches | Delete+123 inserts run in one transaction (~2–4 min per script's own estimate), holding row-level write locks on `lumen.edges` for that span; MVCC means concurrent readers are unaffected either way. | No action needed at 0 users/offline admin run. Confirm the admin role's `idle_in_transaction_session_timeout`/`statement_timeout` exceeds ~4 min before running in prod. |
| CPERF-4 | Low | `ingest-openbible-refs.mjs:170,183` `buildEdgeRows`/`dedupeEdgeRows` | Both the built-rows array and the dedup `Map` hold ~614k row objects simultaneously; each row (2 short ids + metadata object) is ~200–350 bytes, so peak heap is roughly 150–250MB, transiently up to ~2x during dedup. | Fine for a one-time local/CI Node run under default heap limits (no `--max-old-space-size` needed). Revisit only if the corpus grows 5–10x. |
| CPERF-5 | Info | `ingest-openbible-refs.mjs:149-156` chapters 3-way join + count | 3-way join (`chapters`⋈`books`⋈`volumes`) LEFT JOIN `verses` GROUP BY, producing ~1,582 rows, runs exactly once at ingest start on PK-indexed joins. | Confirmed non-issue; no fix needed. |
| CPERF-6 | Info | `scripture.tsx:343-364` `Promise.all([...6 queries])` | `crossRefsRaw` is a 6th concurrent query against the worker's per-request postgres.js pool (`max: 5`, `db.server.ts:32`), so one query can queue briefly behind another — not full serialization behind all 5. | No fix needed; worst case adds one queued query's latency (~10–50ms), still far below sequential-sum time. |

**Summary:** no blocking performance issues at the stated 0-user / ~614k-edge scale. The two Low items (CPERF-1, CPERF-2) are architectural gaps — no index-backed LIMIT pushdown on the vote-ordered cross-ref query, and asymmetric incoming/outgoing index coverage — that are cost-free today because fan-out is capped (~2,000 rows) but should be revisited if a future data merge (e.g., adding another cross-ref collection into the same edges rows) removes that cap.
