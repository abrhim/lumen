# Panel 2 — Adversarial Observability Review — Panel 1 observability.md (canon-spine)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| OBS-1 | material | No script exists yet to check field-by-field, but plan/MIG-9 never name the per-check tuple; adding name/expected/actual/pass-fail is cheap, matches backfill's `verify_nodes` shape. |
| OBS-2 | material | Confirmed backfill keeps identical event names/fields dry-run vs live (only the `SET` clause is conditional) — genuine, cheap-to-copy precedent; without parity dry-run can't sanity-check a live run. |
| OBS-3 | material | Confirmed backfill already caps samples (`mismatchSample: ...slice(0,5)`, `missingSample: ...slice(0,10)`) on prod-scale diffs; same guard on a 1.2M-row parity diff is a one-line reuse of an existing pattern. |
| OBS-4 | material | Row/batch math checks out (~1.2M rows, batches ≫100); 66-book granularity matches backfill's ~14-group `node_type_done` scale — well-calibrated, not speculative. |
| OBS-5 | material | "Match-rate logging" in design.md L90 is genuinely unshaped; a zero-token verse is a real silent index gap (search fails, text intact) and stats are cheap alongside OBS-4's per-book loop. |
| OBS-6 | noise | `smoke-canon-spine.mjs` isn't CI-wired (deploy.yml runs no smoke script) and has no partial-vs-full-failure distinction as a one-shot gate — the 0/1 vs 0/1/2 choice has no consumer to affect. |
| OBS-7 | material | Verified: `ingest-phase-a.ts` `main()` (L812) is a plain top-level `async function` — a one-line `throw` before arg parsing is trivial, and it closes a real desync-on-invocation bug, not just a logging gap. |
| OBS-8 | material | Confirmed via loader audit: all `logEvent` sites in scripture/book/home routes instrument caller-visible failure shapes unchanged by the spine rewrite — zero new calls needed; stating so is a free, scope-creep-blocking sentence. |
| OBS-9 | material | Confirmed backfill's own `backfill_start`/`backfill_done` already carry `startedAt`/`finishedAt`; identical fields on a single multi-1.2M-row transaction are a direct copy, and a stuck/slow commit is otherwise invisible. |

## Stance

Eight of nine findings hold up as **material** under adversarial re-verification, and this panel's central habit — grounding every fix in an exact, already-shipped house pattern rather than inventing new conventions — is exactly right for a low-traffic personal app: none of these are enterprise-grade telemetry asks (no metrics pipeline, no alerting, no dashboards), they are all one-JSON-line-per-event additions that mirror `backfill-neo4j-collections.mjs` almost verbatim. OBS-7 was singled out for extra scrutiny (is the runtime tombstone actually cheap?) and survives cleanly: `ingest-phase-a.ts`'s `main()` is a flat top-level function starting at L812, so a guard throw before arg-parsing is a true one-liner, and unlike the rest of the table this finding also closes an actual correctness gap (a comment-only tombstone doesn't stop a future `--write` invocation from writing pre-spine-shape rows), making it the highest-value item despite being filed under "observability." OBS-8 was checked against the actual route files (`scripture.tsx`, `book.tsx`, `home.tsx`) via direct code audit: every existing `logEvent` call instruments a failure shape the spine rewrite leaves untouched, confirming zero new calls are needed and that the ask really is free.

One finding is downgraded to **noise**: OBS-6's exit-code contract for `smoke-canon-spine.mjs`. The underlying observation (two house exit-code conventions coexist) is accurate, but the target script is never invoked by CI (`.github/workflows/deploy.yml` runs only `backfill-collections.test.mjs`, no smoke script) and, as OBS-6's own rationale states, has no partial-vs-full-failure distinction to make as a one-shot gate — so neither convention has a consumer that would behave differently. Cheap, but not consequential enough to earn material here.

No findings were tagged risky or out-of-scope: nothing asks for observability infrastructure disproportionate to a 0-user/low-traffic app, and every item traces to a file this plan explicitly touches.
