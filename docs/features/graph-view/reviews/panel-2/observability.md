# Panel 2 — Adversarial review of panel-1 observability findings (graph-view)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| OBS-1 | material | Harness already reuses `neo4j_degraded` for the graph fetch; adding entityId/depth/collections fields is a one-line fix, matches existing `logEvent` convention. |
| OBS-2 | risky | Idempotent rerun already covers crash recovery (rerun-from-scratch is safe); "audit trail" framing and persisted-file requirement are disproportionate for one manual prod run. |
| OBS-3 | material | Real ambiguity: per-request logging on every fail-open edge would be noisy before backfill completes; cheap one-sentence clarification prevents a log-flood landmine. |
| OBS-4 | risky | Cache-key hash debuggability is premature — no collections UI exists yet, and `kv_cache_error` already logs the full key on actual failures. |
| OBS-5 | material | Named failure mode (FM-2); one cheap `logEvent` per graph resolution gives real production truncation visibility at negligible volume/cost for this traffic scale. |
| OBS-6 | risky | Legit crash-visibility gap, but building a `sendBeacon`-to-endpoint pipeline is new client-error infra beyond scope; an error boundary alone (or explicit deferral) suffices. |
| OBS-7 | material | Direct analog to the existing `scripture_404` pattern; cheap, catches a real stale/broken-link maintenance issue in a personal knowledge graph. |
| OBS-8 | noise | "Probing traffic" framing is enterprise threat-modeling for a personal app; Zod bound + allowlist already prevent harm regardless of whether it's logged. |
| OBS-9 | risky | `invokedBy`/audit-trail framing is disproportionate for a script only the sole developer ever runs; timestamp + dryRun flag alone would be sufficient. |
| OBS-10 | material | Cheap, scope-*reducing* confirmation that `cachedJson`/`kv_cache_error` is reused unchanged — prevents a redundant bespoke cache-error path from being built. |

## Overall stance

Panel-1 is well-calibrated where it maps cleanly onto the codebase's existing single-line `logEvent`/console-JSON convention (OBS-1, OBS-3, OBS-5, OBS-7, OBS-10 are cheap, real, and material). But several findings smuggle in enterprise-shaped asks that don't fit a low-traffic, single-developer Cloudflare Worker: audit trails and `invokedBy` actor-tracking for a script only the author runs (OBS-2, OBS-9), premature cache-hash debugging infra for a collections filter with no UI yet (OBS-4), and — most notably — a client-side error-reporting endpoint (OBS-6) when no such infrastructure exists anywhere in the app and building one is a real scope expansion, not a logging tweak. OBS-8's "probing traffic" framing is pure noise here: the Zod/allowlist validation already neutralizes the risk independent of whether rejections are logged.
