# Panel-1 — performance

| ID | Severity | Where | Problem (≤25 words) | Fix (≤30 words) |
|----|----------|-------|---------------------|-----------------|
| PER-1 | high | plan.md decision 2 (trgm tier) + search-harness.test.ts H5 (line 111-114); M1 scope | word_similarity(q,name)>=0.5 in WHERE cannot use the planned trgm GIN; index support is only via <%/% operators. Default word_similarity_threshold is 0.6, not 0.5. | Spec tier-2 as `q <% name ORDER BY word_similarity(q,name) DESC`; set threshold via `ALTER DATABASE ... SET pg_trgm.word_similarity_threshold=0.5` in M1 (session SET is unreliable through Hyperdrive pooling). |
| PER-2 | high | plan.md decision 2 tier-1 (`lower(name)=lower(q)`) + M1 index list; live probe lumen.entities | Tier-1 exact-name seq-scans 66k entities — 57.5ms measured, no index on name/lower(name) exists or is planned; runs per name-bearing group, exec times sum on one connection. | Add btree expression index on lower(name) to M1, or write tier-1 as escaped no-wildcard ILIKE so the planned trgm GIN serves it (PG17 supports =/ILIKE via gin_trgm_ops). |
| PER-3 | med | plan.md decision 7 ('7 concurrent statements... it pipelines') + decision 2 tier-4 fallback | Pipelining verified real but saves only RTT: execution is serialized, total = SUM of exec times. If 4 tiers are separate statements, ~21+ statements plus a dependent tier-4 round. | Pin 'one statement per group' (tiers combined via UNION ALL with tier column + LIMIT); tier-4 is the only conditional second round. State the sum-of-exec-times budget model in decision 7. |
| PER-4 | med | plan.md M2 scope ('batched backfill') + decision 10; live GIN reloptions probe | Both GIN indexes run default fastupdate=on; re-vectoring 42k+66k rows leaves large pending lists that degrade every search until autovacuum. Batch size/UPDATE shape never specified. | Specify batch size (2-5k ids/UPDATE) in migrate-search-kjv.mjs and end with VACUUM ANALYZE lumen.verses, lumen.entities (admin DSN) to flush pending lists. Function cost itself is fine (~23us/row measured). |
| PER-5 | med | plan.md decision 7 (p95 < 500ms prod budget) + harness H12 | The prod p95 budget has no measurement mechanism: H12 is one warmed laptop run asserting 1500ms; the route emits no timing, so the stated invariant is unobservable. | Have api.search.tsx emit per-request duration (Server-Timing header or structured log with per-group timings) so p95 is readable from Workers logs; H12 reports per-group breakdown. |
| PER-8 | med | search-harness.test.ts H5 (line 111-114) — the executable contract | Harness pins the non-indexable function form and passes via seq scan; nothing in the contract can catch PER-1/PER-2 index regressions. | Rewrite H5 to the `q <% name` production predicate; add an EXPLAIN-text assertion (plan must contain the trgm/lower(name) index name) for tier-1/tier-2 shapes post-M1. |
| PER-6 | low | plan.md decision 9 (moment payload includes text) + decision 5 (payload returned verbatim) | API responses carry full 200-800-char window text per moment alongside the snippet — up to ~20KB redundant bytes in one group at limit=25. | Keep text in the DB payload as the ts_headline source but strip it from API result payloads; deep-links need only episode_id/t_start_s. |
| PER-7 | low | plan.md decision 10 (~300-600 entries estimate) | Live corpus has 1,098 distinct -eth/-est/-edst forms (712 -eth alone); curation/eval-gate triage set is ~2x the plan's estimate. | Update the estimate; auto-accept regular -eth verb rule class with a curated exception list so hand-review stays bounded. |

## Evidence

All probes read-only against live prod (PostgreSQL 17.6, Supabase pooler, DSN from .env), 2026-07-21.

[PER-1/PER-2 context] Extensions: SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm','unaccent',...) -> [] (confirmed not installed; M1 red-harness expected). Live lumen.entities indexes: entities_pkey(id), idx_entities_type, idx_entities_type_id, idx_entities_collection, idx_entities_search USING gin(search_vector) — nothing on name or lower(name).

[PER-2] EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM lumen.entities WHERE lower(name)=lower('Melchizedek'):
"Seq Scan on entities (cost=0.00..7605.15 rows=329) (actual time=15.927..57.524 rows=2 loops=1); Filter: (lower(name) = 'melchizedek'::text); Rows Removed by Filter: 65885; Buffers: shared hit=6617; Execution Time: 57.551 ms"
vs FTS group queries at ~3-5ms exec (verses FTS+spine-joins+rank+limit 66ms wall = 63ms RTT + ~3ms exec; entities FTS+collection filter 68ms wall).

[PER-3] postgres.js pipelining probe (prepare:false, ssl require, max:1 — the Workers/Hyperdrive config), 7x SELECT pg_sleep(0.05):
{"rtt_ms":62,"concurrent_7x50ms":415,"sequential_7x50ms":790}
415ms = 7*50ms + 1 RTT: statements pipeline (RTT paid once) but execute strictly serially — request latency is the SUM of the 7+ statements' server exec times. A 57ms tier-1 seq scan repeated across name-bearing groups lands fully in the total.

[PER-4] GIN reloptions: idx_verses_search=null, idx_entities_search=null (fastupdate defaults on). Backfill cost floors measured server-side: to_tsvector x2 over all 41,995 verses = 69ms; regexp_split_to_table+string_agg (normalize_kjv shape floor) over 42k verses = 961ms total (~23us/row); 66k entities setweight re-vector = 72ms — the function is cheap; pending-list bloat is the real backfill risk.

[PER-7] SELECT count(DISTINCT normalized) FROM lumen.words WHERE normalized ~ '(eth|est|edst)$' -> 1098 (eth$ alone -> 712) vs plan's "~300-600 entries".

[checked, no finding — ts_headline] Decision 8's bounded-cost claim verified on PG17: naive headline-in-SELECT with ORDER BY rank LIMIT 8 vs subquery-limited form: 'faith' (810 matches) 69ms vs 68ms; 'lord' (8,840 matches) 74ms vs 74ms — planner postpones the headline projection past Sort/Limit, so headline runs only on returned rows either way.

[checked, no finding — M3 scale] transcripts: 39,459 captions / 2,309,930 chars -> ~4.6k windows at 500-char target, matching the plan's ~5k moment estimate. search_index pkey (kind, ref_id) gives kind-leading btree; 5k-row group queries are trivial.

_Source: workflow run wf_7edb2724-d13 (structured return); file written by orchestrator._