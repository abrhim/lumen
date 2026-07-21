# Data stress test — report (2026-07-18)

Design: [../data-stress-test-design.md](../data-stress-test-design.md)
(adversarially reviewed twice — methodology + coverage — before running).
Raw results: [results.json](results.json). Harness:
`scripts/stress-test-data.mjs` + `stress-test-load.mjs`, pinned by
`scripts/__tests__/stress-harness.test.mjs` (12 tests — every
run-discovered harness bug carries a regression test).
Posture held: strictly read-only (startup-GUC + write-verb assertion);
zero writes to prod.

## Executive verdict

**The relational data is in excellent shape; the graph is not in sync.**
67 checks across ~3M rows in 15 tables: **57 pass, 1 real failure, 9
documented baseline debts, 0 corruption findings.** Every referential
chain, uniqueness constraint, value domain, extraction invariant,
transcript invariant, encoding sweep, and numeric-hygiene check on the
PostgreSQL side passed outright. Under load, the database scales linearly
to the pooler's ceiling with **zero errors at every rung** and flat
latency. The one failure is real and actionable: **Neo4j is missing
~3,995 verses — 92% of the Doctrine & Covenants.**

## The failure

**F1 — Neo4j graph is missing most of D&C** (`neo4j_label_counts`).
Graph holds 38,000 LM_Verse nodes vs 41,995 PG verses; localized to D&C
(294 of 3,654 synced) plus one missing LM_Chapter (1,581/1,582). The
round 38,000 (= 19 × the backfill's 2,000 batch size) suggests the verse
sync truncated or predates the D&C load. Graph relationships are
otherwise clean (0 orphan LM_ relationship endpoints; books 87/87).
**Action: re-run the spine backfill for D&C inside the graph-membership
feature; add a per-volume parity check to its verify step.**

## Load results (closed-loop DB-capacity test, direct-to-pooler path)

Declared scope per the methodology review: this measures the DATABASE's
capacity from this machine — not user-path latency (users ride
Workers→Hyperdrive). Percentiles are p50/p95 ms per query class.

| rung | qps | chapter_page | verse_lookup | entity_page | transcript_slice | lens | verse_fts | entity_fts | strongs | two_hop |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline-1 | 6.2 | 163/233 | 133/210 | 135/237 | 139/230 | 137/246 | 137/259 | 143/237 | 140/216 | 178/251 |
| 2 clients | 14.8 | 144/236 | 131/138 | 131/139 | 137/142 | 137/145 | 132/141 | 135/142 | 132/138 | 135/157 |
| 4 clients | 28.1 | 149/229 | 135/151 | 136/145 | 140/157 | 140/149 | 137/150 | 139/152 | 137/158 | 139/152 |
| 8 clients | 56.1 | 151/268 | 135/148 | 136/153 | 142/153 | 141/156 | 137/151 | 140/156 | 137/150 | 139/153 |
| 12 clients | 83.7 | 153/192 | 136/156 | 137/157 | 141/163 | 141/158 | 138/155 | 140/159 | 139/164 | 141/161 |
| 2 (repeat) | 14.3 | 146/221 | 133/144 | 134/154 | 139/152 | 138/291 | 135/147 | 136/153 | 134/143 | 136/150 |

Readings:
- **Perfectly linear scaling** through the entire ladder (6.2 → 83.7 qps,
  ~7 qps/client constant) with **zero errors, zero timeouts** at every
  rung — the DB never approached saturation; latency is dominated by the
  ~130ms network round-trip from this machine, and p95s stay flat as
  concurrency grows. Headroom above 12 clients exists but is untestable
  on this path (below).
- **The hard ceiling on this path is the pooler, not the database**:
  probed live, Supabase's session-mode pooler admits exactly
  `pool_size: 15` clients (EMAXCONNSESSION at 16+). This bounds
  scripts/admin tooling — the app's Hyperdrive path has its own pooling.
  An earlier exploratory rung at 16 clients hit this wall (20% admission
  errors) and the circuit breaker correctly aborted.
- **Repeat-rung variance ±3%** on throughput (14.8 vs 14.3 qps) — the
  numbers are stable, with one 291ms lens-query p95 blip in the repeat.
- **REPEATABLE READ holders** rode the 8-client rung with no wedging or
  snapshot errors.
- **Pathological inputs (all graceful, none slow):** 10k-char search
  155ms · tsquery specials 130ms · unicode dashes 165ms · empty search
  236ms · 1,000-id IN list 136ms · offset-100k 86ms · absent jsonb path
  391ms. No hangs, no crashes.

## What passed (the 57)

- **Spine (I1)**: every parent chain volumes→books→chapters→verses→words
  resolves; verse numbering contiguous + unique in all 1,582 chapters;
  word positions unique; word char-offsets within verse bounds; sampled
  word-surface = verse-substring agreement 2,000/2,000; word_tags →
  words + lexicon fully resolved (735k rows).
- **Referential (I2)**: zero orphans on every no-FK surface — all 879k
  edge endpoints resolve, transcripts→entities, all collection_id refs,
  user_roles→roles.
- **Uniqueness (I3)**: PKs everywhere expected; zero duplicate edge
  tuples outside the pinned phase-b baseline.
- **Domains (I4)**: entity_type/rel_type 100% within vocab;
  `jsonb_typeof(metadata)='object'` on every row of every metadata
  column (the A2 repair holding); edges.source values all known.
- **Extraction layer (I5)**: all 7,900+ mention objects schema-valid,
  sorted, within episode duration, seq-resolvable into transcripts;
  zero trap-field leakage (exact-match probe); title anchors at
  confidence 1.
- **Transcripts (I6)**: seq contiguous 0..N−1 in all 10 episodes; t
  monotonic; coverage within tolerance; no empty rows.
- **Encoding/numeric (I7/I8)**: zero replacement chars, double-encoded
  entities, pathological lengths, NaN/negative numerics across all
  swept columns.
- **Metadata-linkage collections (I11)**: JST's 31,262 verse links — 0
  corrupt (the 427 danglers are all Joseph Smith ADDITIONS beyond
  canonical chapter ends, verified 427/427 — see debts); Strong's
  entities 100% resolve to lexicon rows.
- **Search (I10/I18)**: FTS canaries hit on verses, entities, and
  episode index; sampled tsvector freshness 1,000/1,000 exact.
- **Strong's lexicon (I16)**: all 20,734 strongs_no well-formed (with
  suffixes to depth F); no empty gloss+definition; tag coverage above
  floor.
- **Neo4j hygiene (I9, partial)**: 0 orphan LM_ relationship endpoints.

## Baseline-debt inventory (documented, pinned, not failures)

1. **phase-b duplicate edge tuples: exactly 1,578** (pinned — any change
   fails). Collections-cleanup backlog.
2. **JST addition verses: exactly 427 unanchored** — Joseph Smith's
   added verses (beyond canonical chapter ends) have no anchoring
   convention. Roadmap: anchor to preceding canonical verse or flag as
   addition. (Verified: zero non-addition danglers.)
3. **Naves has no canon linkage at all** — 5,319 topics stand alone.
   Product gap, not corruption.
4. **Drizzle schema drift** — schema.ts is stale vs prod (column renames,
   8/15 tables absent). Worth a dedicated sync pass.
5. **One self-loop edge** (pinned at 1).
6. **Edge-isolated relational entities** (persons/places/eras with zero
   edges) — inventoried for graph-membership.
7. **openbible∩phase-b CROSS_REF overlap** — semantic duplicates across
   collections, inventoried.
8. **Never-synced graph labels**: LM_StrongsWord, LM_JstReading,
   LM_NaveTopic defined but empty — joins extraction edges + art in the
   graph-membership backlog.
9. **A2 extraction edges + art absent from graph** — known-missing by
   design, same backlog.

## The harness stress-tested itself (fixes, each with a test)

Five harness bugs surfaced across runs, all fixed + pinned in
`stress-harness.test.mjs`: hardcoded metadata-column assumption
(collections has none); `LIKE '%__trap%'` wildcard false-positives (233
"trap"-quoting transcripts — exact strpos count was 0); illegal chr(0)
probe (PG forbids NUL by construction); pooler-cap misclassification
(EMAXCONNSESSION ≠ DB failure); phase-scoped reruns clobbering the other
phase's results. Two check-assumption fixes: Strong's suffix depth
(A–F), JST addition/corruption split.

## Recommendations, ranked

1. **Re-sync D&C into Neo4j** (the failure) — graph-membership feature;
   add per-volume parity to its verify step.
2. Adopt this harness as a scheduled invariant sweep (it's read-only,
   ~8 min, and every check is classified) — run after each ingest/load.
3. Decide the JST-addition anchoring convention before Phase-B surfaces
   render JST content.
4. Drizzle schema sync pass (debt 4) before the next schema-touching
   feature.
5. Keep scripts/tooling concurrency ≤ 12 (pooler session cap 15); the
   app path is unaffected.
