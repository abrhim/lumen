# Panel-2 Adversarial Review — Observability (tske-cross-references)

Verified against `scripts/ingest-words.mjs`, `scripts/smoke-canon-spine.mjs`,
`scripts/migrate-canon-spine.mjs`, and the live `apps/web/app/routes/scripture.tsx`
loader (`neo4j_degraded` / `graph_degraded` patterns, `isEmpty` panel state,
`migration_state` usage).

| ID | Tag | Rationale (≤25 words) |
|---|---|---|
| OBS-1 | material | Confirmed: loader already has `neo4j_degraded`/`graph_degraded` "never rejects" pattern for critical-path enhancements; plan is silent on reusing it for PG cross-refs. |
| OBS-2 | material | House pattern (`words_ingest_done`) always names its event + shape; plan leaves the unmapped report unnamed. Trim the "per-book counts" ask — no house precedent for that granularity. |
| OBS-3 | material | Plan states a numeric abort threshold with no FM entry, exit code, or boundary test — real silent-early-return risk; ingest-words.mjs's exit-code convention (0/1/2) is the precedent to match. |
| OBS-4 | noise | House pattern logs per-batch only on *failure* (`words_batch_failed`), success is aggregate-only; per-batch deleted/inserted logging is noisier than precedent and redundant with OBS-5's count-stability check. |
| OBS-5 | material | Plan is internally inconsistent: FM-10 requires re-run count stability but §5's smoke bullet list omits it — a direct contradiction, one-line fix. |
| OBS-6 | noise | Negative-vote ordering and range-collapse already have dedicated unit/property tests (FM-5, FM-6); duplicating them as *live* spot checks is redundant verification, not a gap. |
| OBS-7 | material | Loader already has a house-precedented distinct empty state (`isEmpty` → "No connections recorded"); plan should extend it to cross-refs so degrade and empty aren't visually identical. |
| OBS-8 | noise | `migration_state` is self-referential bookkeeping read only by `migrate-canon-spine.mjs` to gate its own destructive P4 step — never read by the app. This plan has no analogous gated follow-on, so persisting an audit record has no consumer. |

## Overall stance

Panel-1 correctly found the two sharpest gaps: the plan moves a PG query into
the loader's critical path without stating its failure behavior (OBS-1) even
though the codebase already has a proven, cheap-to-reuse degrade pattern for
exactly this situation, and the 0.5% abort threshold is unimplementable as
written (OBS-3). OBS-5's FM-10/smoke-bullet contradiction is a genuine plan
defect, and OBS-7 has real teeth once you notice the panel already
distinguishes empty from degraded elsewhere — the plan just needs to say so.
Three findings (OBS-4, OBS-6, OBS-8) don't hold up against the actual house
patterns they cite: OBS-4 and OBS-8 ask for log/persistence granularity the
codebase doesn't use anywhere else (and OBS-8's cited precedent, `migration_state`,
is a self-gate with no analog here), and OBS-6 duplicates coverage already
committed to in the harness plan. For a personal project whose logs the owner
reads directly, these three add implementation cost without a corresponding
debugging or correctness payoff.
