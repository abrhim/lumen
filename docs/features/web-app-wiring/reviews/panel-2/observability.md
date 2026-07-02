# Panel-2 Adversarial Review — Observability (web-app-wiring)

Reviewed against: `docs/features/web-app-wiring/plan.md`, panel-1 `observability.md`, and the existing test harnesses (`apps/web/app/lib/__tests__/*.test.ts`, `apps/web/app/routes/__tests__/*.test.ts`). Note: this feature is pre-implementation — only test scaffolding exists (`neo4j.server.test.ts`, `cache.server.test.ts`, `db.server.test.ts`, `scripture.loader.test.ts`, `home.loader.test.ts`, `headers.server.test.ts`); `neo4j.server.ts`, `cache.server.ts`, `db.server.ts`, `scripture.tsx`, `workers/app.ts` do not exist yet. Findings are evaluated as specs for code about to be written, against the tests' locked-in contracts.

Ground rule applied: Phase 5 owns the full observability stack (Sentry, Logpush, alerts, dashboards). Phase 1 owes only minimal in-code hooks — mainly: don't let a caught, discarded error vanish with zero trace. Anything that adds new response fields, new branching logic, or speculative "Phase 5 will need this" plumbing is over the line unless the cost is genuinely trivial and reuses what already exists.

## Findings

| ID | Tag | Rationale |
|---|---|---|
| OBS-1 | material | One `console.error` line in an already-planned catch block (plan L18/42). Without it a 200-degraded response is untraceable. Trivial fix, real bug. |
| OBS-2 | material | Same shape as OBS-1: one log line in an existing KV catch. Dead KV namespace silently degrading to live-query-forever is a genuine invisible failure mode. |
| OBS-3 | noise | Restates OBS-1 as a "required deliverable" framing — same fix, same catch site, no new information. Duplicate finding. |
| OBS-4 | risky | Adds a new `source: cache\|live\|error` field threaded through loader return data — a contract change, not a log line. KV already exposes read/write metrics natively; Phase 5 doesn't need app code changed to get hit-rate. |
| OBS-5 | risky | Wraps every DB/Neo4j call with `Date.now()` timers "so Phase 5 can backfill" — you cannot backfill history not yet collected, and Workers trace view already has subrequest timing. Fix scope exceeds the justification. |
| OBS-6 | material | Small shared `logError(event, fields)` helper — keeps OBS-1/2/7/10's log lines shape-consistent for cheap. Proportionate, in-code, non-speculative. |
| OBS-7 | material | One log line at an already-planned catch-store-rethrow site (plan L65). Wedged singleton with zero logged cause is a real debugging dead end. |
| OBS-8 | risky | Wants env-conditional (dev/staging vs prod) header/HTML-comment injection to disambiguate bug reports. `graphDegraded` already renders as "graph features unavailable" copy per plan L42 — that's already the user-visible diagnostic signal. New branching logic for marginal gain. |
| OBS-9 | out-of-scope | Specialist self-scoped this to Phase 5 (synthetic-check candidate) and explicitly said "not a code hook now." Correctly excluded already — no action needed, tag reflects that it's not part of this phase's deliverable set. |
| OBS-10 | material | `Neo4jAuthError`/`Neo4jQueryError` already exist and are already thrown by `@lumen/neo4j-http` (confirmed in `packages/neo4j-http/src/client.ts`) — `error.name`/`error.code` are free fields at the same catch site as OBS-1, not new plumbing. |

## Overall stance

Five of ten findings (OBS-1, OBS-2, OBS-6, OBS-7, OBS-10) collapse into essentially one deliverable: add a shared structured-log helper and call it from the three catch blocks the plan already specifies (Neo4j degradation, KV fallthrough, PG singleton init), including `error.name`/`code` since those types already exist upstream. That's proportionate and worth requiring. OBS-3 is a duplicate of OBS-1 and should be dropped. OBS-4, OBS-5, and OBS-8 all reach past "log the error that's currently silent" into building metric/diagnostic infrastructure (new response fields, timing instrumentation, env-conditional header logic) that Phase 5 owns or that existing platform features (KV metrics, Workers trace view) already cover — reject these as scope creep dressed up as minimal hooks. OBS-9 is correctly self-scoped by the specialist and needs no code change now.
