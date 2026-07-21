# Panel-1 — observability

| ID | Severity | Where | Problem (≤25 words) | Fix (≤30 words) |
|----|----------|-------|---------------------|-----------------|
| OBS-1 | high | plan Q7, decisions 5/7, M5 | Plan promises hand-tuning priors against real queries (Q7: "measurement only") but specifies no query logging anywhere — zero-result rate and per-group hits are never captured. | Loader emits one `logEvent("search_executed", {q, scope, reference, groups: {kind: hits, topTier}, zeroResult, elapsedMs, perGroupMs, visibleCount})` per request. Raw `q` (already validated ≤200 chars) — hashing defeats tuning at this traffic. |
| OBS-2 | high | plan line 42, decision 7 | Failed group query degrades to empty group (line 42) with no error logging specified — indistinguishable from zero hits; a rolled-back M4 projection stays silently invisible forever. | `searchAll` returns per-group meta `{ms, error?}`; loader logs `search_group_degraded {kind, message, ms}` on error (`graph_degraded` precedent, scripture.tsx:287). Harness-pin: degraded group logs AND response stays 200. |
| OBS-3 | med | api-search.test.ts:110-118 | The 500 path pins that internals never reach the client, but nothing pins a server-side log — a scrubbed, unlogged 500 is undebuggable. | Catch block calls `logEvent("search_failed", {message, qLen})` before returning JSON 500; assert it fired in the endpoint harness by mocking `~/lib/log.server`. |
| OBS-4 | med | plan decision 7 (p95 < 500ms) | Prod p95 budget has no measurement path: H12 is laptop-side and RTT-dominated (identical query 62–134ms across runs), so breaches can't be detected or attributed per-group. | Prod-side measurement via OBS-1's `elapsedMs` + `perGroupMs` (sourced from OBS-2's meta) — Workers observability then yields real p95 and names the offending group; `ts_headline` cost becomes measurable per-group. |
| OBS-5 | med | plan line 97 (H12), search-harness.test.ts:238 | Decision 7 says H12 "reports actuals" but they're `console.log` to test stdout; harness-initial.log:24 records H12 FAIL with no actual. No durable record exists. | Capture the green run as docs/features/search-endpoint/harness-final.log (H12 line included) and write the actual into the plan's drift-baseline section; ongoing prod actuals come from OBS-1. |
| OBS-6 | med | plan M3/M4 files (build-search-moments.mjs, migrate-search-projections.mjs) | Invariant/logging conventions for the non-`migrate-` script are unstated — H15 partition failures and projection row counts wouldn't be traceable to any run output. | State both follow migrate-media-collections.mjs: JSON events (`invariant_check` per invariant; per-episode `{episode_id, windows, captions_covered}`), exit 2 on invariant failure, `scrubSecrets` on error paths. |
| OBS-7 | med | plan decision 3 / Q3 (entity_degree) | `entity_degree` is script-refreshed with no logged row-count/timestamp and no staleness invariant — boosts silently drift as the 881k-edge graph grows. | Refresh logs `{rows, max_degree, generated_at}`; invariant compares entity_degree count against distinct boosted entity ids in edges; plan documents refresh cadence (post-ingest, alongside M3). |
| OBS-8 | low | plan decision 6 (visibility) | Admin-entitled searches return hidden collections (unshaken) with no audit trail that elevated visibility was applied. | OBS-1's event carries `visibility: 'public'|'admin'` plus userId when admin — hidden-content exposure through search becomes auditable in Workers Logs. |
| OBS-9 | low | plan line 20 vs scripts/*.mjs | Plan line 20 claims "`DRY_RUN=1` default" house pattern; no script reads DRY_RUN — repo splits between `--dry-run` CLI (apply-default) and `COMMIT=1` env (dry-run-default). | Standardize all four new scripts on migrate-media-collections.mjs's `COMMIT=1` gate and event vocabulary (`migration_dry_run_ok`/`migration_applied`/`invariant_check`/`migration_done`); correct the plan wording. |

## Evidence

Live prod probes (read-only `lumen_read` pooler DSN from apps/web/.env, 2026-07-21, warm connection):

```
search_index kinds: [{"kind":"episode","n":10}]
extensions: fuzzystrmatch=null, pg_stat_statements=1.11, pg_trgm=null, unaccent=null, vector=null
```

- Only `episode` rows exist in `lumen.search_index` today — until M3/M4 land (or if one is rolled back), the `moment`/`artwork`/`strongs` groups are empty for reasons a response body cannot distinguish from zero hits. Without OBS-2's log, that state is invisible forever (OBS-2).
- `pg_stat_statements` is installed but aggregates per-statement — it cannot attribute zero-result rate, per-request grouping, or visibility context. App-level logging is still required (OBS-1).

Per-group timings, three probe runs, identical queries (LIMIT 8, `websearch_to_tsquery('faith')`):

```
                     run1  run2  run3
verses_fts            64    79    63   ms
verses_fts_headline   63    72    64   ms  (ts_headline'd, same rows)
entities_fts          66   134    66   ms
searchidx_fts         62    68    62   ms
verses_fts_zero       62    67    61   ms  (zero-result)
```

- Laptop→pooler wall time is RTT-dominated and flat (~62ms floor regardless of work; one 134ms outlier on an unchanged query). H12 can therefore neither verify the prod p95 < 500ms budget nor attribute cost to a group — only per-group `ms` measured inside the Worker and logged can (OBS-4). This also means `searchAll` must *return* per-group timing/error meta: `logEvent` lives in apps/web (log.server.ts), and the plan correctly keeps route concerns out of `@lumen/scripture` — so the loader can only log what `searchAll` surfaces (OBS-2/OBS-4).

Repo evidence:

- `apps/web/app/lib/log.server.ts` — house `logEvent` JSON-line helper written explicitly for Workers observability; ~26 call sites across the app. Precedents matching every prescription above: `graph_degraded`/`crossref_degraded`/`wordtags_degraded` with `elapsedMs` (apps/web/app/routes/scripture.tsx:113,171,287), `crossref_empty` (zero-result precedent, scripture.tsx:167). plan.md contains zero logging mentions for M5 (OBS-1/OBS-2/OBS-3).
- `apps/web/wrangler.json:7-9` — `observability.enabled: true`; structured console lines are captured with no infra work.
- `docs/features/search-endpoint/harness-initial.log:24` — `FAIL … H12` (module missing), no latency actual recorded anywhere durable; `search-harness.test.ts:238` logs actuals only to test stdout (OBS-5).
- `scripts/migrate-media-collections.mjs:95,116-145` — `COMMIT=1` gate, `invariant_check` events, exit 2 on invariant failure, `scrubSecrets` (OBS-6/OBS-9 target pattern).
- `scripts/migrate-canon-spine.mjs:162` and `scripts/migrate-user-roles.mjs:120` — `--dry-run` CLI flag, apply-by-default: the repo already has two flag vocabularies, and plan line 20's "`DRY_RUN=1` default" matches neither literally (OBS-9).
- `apps/web/app/routes/__tests__/api-search.test.ts:110-118` — pins `body.error` excludes internals on 500, with no companion server-log pin (OBS-3).
