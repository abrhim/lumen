# Edge ranking — surfacing a hub node's important edges (design input, rev 2)

Rev 1: 2026-07-23. Rev 2: same day, corrected after the adversarial
ranking/data review (live probes against prod) and the consistency review.
Answers: for an especially centric node (Jesus Christ: 10,930 claim edges,
10,557 incoming MENTIONS), which edges surface first — in the rail's capped
rows, the graph overlay's truncated neighborhood, "see all" ordering, and
the future landing-graph first ring?

## Measured facts (verified in prod; rev 2 corrections marked ✱)

- Centrality over 838,078 claim edges (structural rel_types excluded):
  Jesus Christ leads every measure — degree 10,930 (7.5× runner-up),
  sampled betweenness 27×, harmonic closeness 1.4×. Script:
  `scripts/graph-centrality.mjs`.
- ✱ Worst cross-ref hub verse: **649 refs** (1-kgs-15-6), then 465, 451.
  (Rev 1's "~2k" was wrong; struck.)
- ✱ `lumen.entity_degree` counts **all** edges including structural
  (DEGREE_REFRESH has no rel_type filter) and **covers verses** (38,000 of
  52,489 rows). The discount below means *claims degree*; the projection
  script gains a claims-only degree or the discount tolerates the skew —
  decide in the M-script, state in its header.
- Edge weights in prod:
  - `openbible` CROSS_REF (614,209): `metadata.votes` — heavy-tailed
    (p50 3, p90 10, p99 53, max 1281), **5,535 edges ≤ 0, min −86**.
    ✱ Votes do NOT correlate with target popularity (log-log r = 0.17
    global, ≈ 0.04 within source verse) — the feared bias is absent; no
    percentile normalization needed, log-scaling is.
  - ✱ `openbible` targets are **Bible-only** — every cross-dispensational
    reference from a Bible verse is `anthropic-batch` by construction.
  - ✱ TEACHES (30,294/30,538) and all DISCUSSES carry
    `metadata.confidence` (0.95/0.8/0.6/0.35) — a weight rev 1 missed.
  - ✱ DISCUSSES `mentions.length` is nearly constant (p50 = p90 = 1,
    max 5) — a tie-breaker, not a weight.
  - MENTIONS (44,822 anthropic-batch): no numeric weight today.
- ✱ `lumen.edges` has no `id` column and no PK; (from,to,rel_type,source)
  has zero duplicate groups — safe as a projection key.

## The principle: for hubs, importance = strength ÷ expectedness

Raw popularity sorts a hub's neighbors into other hubs, and hub–hub edges
are the least informative. The correction is TF-IDF / PMI logic — but the
composition is ordered so provenance and coverage can't be crushed by it:

**Order of operations (rev 2, resolving rev 1's contradiction):**

1. **Quota cells select first** — guaranteed *minimums with backfill*: one
   row per non-empty (relation class × volume) cell in score order, then
   remaining slots from the global blended order. Never leave a slot empty
   for an empty cell (31% of verses have single-volume refs; measured), and
   never promote a 2-vote edge over a 497-vote edge merely for spread
   beyond the guaranteed minimum.
2. **Within a cell, tier orders**: curated > voted (openbible) >
   AI-extracted — with human-**accepted** AI edges (the enrichment-review
   overlay, media-collections.md) promoted to the curated tier, and
   weight computed from **live** mentions only (rejected mentions carry no
   weight).
3. **Within a tier, the score**:

```
edge_score(u→v) = w(e) / (1 + ln(1 + deg_claims(v)))^α
```

   Tier is NOT in the formula (rev 1's `tier ×` term removed — it was
   inert under the outer sort and contradictory otherwise).
4. **Tie-break**: `(…, score DESC, neighbor_id COLLATE "C")` — and for
   weightless classes this key is the visible order, so it must be
   defensible (see per-class policy).

**Per-class weight policy `w(e)`:**

| Class | w(e) | α |
|---|---|---|
| CROSS_REF openbible | `ln(1 + max(votes, 0))` — negative-vote edges drop to the see-all tail | tuned |
| CROSS_REF anthropic-batch | 1 (until a confidence lands) | tuned |
| TEACHES / DISCUSSES | `confidence` (× mentions.length as tie-break) | tuned |
| MENTIONS (weightless today) | — | **0** (rank by tier, context match, id) until occurrence counts land at ingest |

The α = 0 rule for weightless classes is load-bearing: with w = 1 and
α > 0 the formula ranks Christ's 10,557 mentioning verses obscurity-first —
the degenerate case on exactly the flagship page. Log-scaling votes is also
load-bearing: raw votes (range to 1281) swamp the discount (range ~1.3–4.5×
over real degrees), making α tune noise.

**α protocol** (replaces "vibes"): tune where the discount binds — entity
registers, not openbible CROSS_REF (measured: top-3 there is α-invariant).
(a) external gold set — LDS footnote/Topical Guide membership as relevance
labels, NDCG@3 over a stratified verse sample, sweep α ∈ {0, .25, .5, .75,
1, 1.5}; (b) blind pairwise preference on ~50 nodes stratified by fan-out
plus the named hubs; (c) post-ship rail-row CTR by position. The M-script
gets a report mode so sweeps are re-runs. Per-register α permitted.

Context refinement (rev 2 scoping): the projection is the **candidate
generator**; request-time work is limited to reordering the precomputed
top-K rows by shared context with the arrival verse. Cached graph
responses use the context-free order.

## Where it runs

`top_edges` projection (node_id, rel_type, neighbor_id, rank), built by an
M-style COMMIT-gated script. **Refresh triggers (rev 2):** every ingest
script that writes edges ends with a partial `top_edges` refresh for
touched node_ids (the projection is node-keyed; cheap) plus a KV
version-key bump (the `graph:v2` pattern) — never TTL wait-out. OpenBible
is static; episodes and batch runs are not. `entity_degree` refresh rides
the same runbook.

Ring-vs-rail composition: the rail's 3-row registers use the same ordered
projection truncated at 3 (quota minimums apply only when the register
mixes volumes, i.e. cross-references); the landing ring's ~8-per-class
quota is a separate consumer of the same rows. Landing-ring curation feeds
from **betweenness** (`scripts/graph-centrality.mjs`) with a human filter.

## Prerequisite data debt

- The `NA` place node (confirmed: 4th in entity_degree at 1,399) — an
  ingestion artifact; excise before any automated curation.
- `melchisedec-1` / `melchizedek-1` duplicate (search-endpoint A5).
