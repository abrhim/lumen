# Panel-2 (adversarial) / performance review — tske-cross-references

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| PERF-1 | material | Plan's own COR-2 line forces cross-refs into the awaited critical path; real first-paint delta, cheap fix (state parallelism or split Promise.all). |
| PERF-2 | risky | Harness scope (plan.md L124) already mandates a `getCrossReferences` SQL-shape test, pinning this at implementation time; mandating UNION ALL now adds join/labeling complexity for a ~10-50ms delta that's likely parallelized away regardless. |
| PERF-3 | material | Real gap vs established project precedent (`ingest-words.mjs` batch size + elapsedMs logging); cheap to document, doesn't mandate the riskier index-drop suggestion. |
| PERF-4 | noise | ~600k edges / ~31k verses ≈ 19-40 avg incoming rows/verse; single-column index-scan-then-filter is sub-ms at that cardinality, even for outlier verses. |
| PERF-5 | risky | Splitting the existing single `cachedJson` wrapper into two cache flows/keys is real plumbing work for near-zero payoff — a direct indexed PG query (~10-50ms) is comparable to a KV round trip anyway. |
| PERF-6 | noise | Panel-1 already scored this low and its own fix asks only for a fan-out confirmation; in-memory sort of tens-to-low-hundreds of rows is free regardless. |

## Overall stance

Panel-1's read of the plan text is accurate throughout, but three of six findings (PERF-2, PERF-4, PERF-6) size the actual data wrong: at ~600k edges over ~31k Bible verses, average per-verse fan-out is in the tens, not the thousands, so index-recheck and in-memory-sort costs the findings worry about are sub-millisecond regardless of which SQL shape or index strategy ships — PERF-2 additionally has its stated fix already covered by the plan's own SQL-shape harness requirement. PERF-1 and PERF-3 survive scrutiny: both point at genuine, plan-text-grounded gaps (the COR-2-forced critical-path move, and the missing batch/wall-clock spec that this repo's own `ingest-words.mjs` sets precedent for) with fixes that cost a sentence of documentation, not new engineering. PERF-5 is downgraded to risky rather than material because the concern is real (the single-cache-wrapper assumption does break once cross-refs move to the critical path) but its prescribed fix — a second cache flow and key — is more plumbing than a ~10-50ms-vs-KV-round-trip tradeoff justifies at zero users.
