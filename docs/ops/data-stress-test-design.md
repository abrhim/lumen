# Data stress test — design (2026-07-18)

Requested by Abram: "do a stress test on all of the data. design it, review
the design, then perform the stress test, then report."

## Scope & posture

Everything in the `lumen` schema (15 tables, ~3M rows, 1GB, 38 indexes,
8 collections) plus Neo4j parity. **STRICTLY READ-ONLY**: every session
opens with `SET default_transaction_report = read only` semantics
(`SET default_transaction_read_only = on`), the harness asserts no write
verbs in any SQL string, and the app credential is SELECT-only anyway.
Two halves: **INTEGRITY** (is what's stored correct?) and **LOAD** (does it
behave under concurrent access?).

## Integrity dimensions

- **I1 Spine structure**: volumes→books→chapters→verses→words parent
  chains resolve; verse ids match `{book}-{chapter}-{verse}` and their
  chapter component exists; per-chapter verse numbering has no gaps or
  duplicates; words→verses linkage; word_tags→words and →strongs_lexicon.
- **I2 Referential (no-FK surfaces)**: edges from_id/to_id resolve to a
  legal target table (entities|chapters|verses|books — kind-aware by id
  shape and rel_type); search_index ref_id resolves per kind; transcripts
  episode_id→entities; entities/edges collection_id→collections;
  user_roles→roles.
- **I3 Uniqueness**: PKs present on every table; duplicate
  (from,to,rel_type,collection) edge tuples measured ACROSS ALL collections
  — phase-b's 1,578 known dup tuples are BASELINE-DEBT (reported, not
  failed); any NEW dupes elsewhere fail.
- **I4 Value domains**: entity_type and rel_type ⊆ live vocab
  (packages/scripture/src/vocab.ts); `jsonb_typeof(metadata)='object'` on
  every metadata column in EVERY collection; confidence values ∈ [0,1]
  wherever present; edges.source values ⊆ known set; tsvector columns
  non-null where generated.
- **I5 Extraction layer**: per-mention schema (t number, seq int,
  confidence [0.5,1]); mentions sorted by t; every mention's seq exists in
  that episode's transcripts; every mention's t ≤ episode duration + 5s;
  title edges keep confidence 1; no `__trap`/`originalTarget` fields
  anywhere in stored metadata.
- **I6 Transcripts**: per episode, seq contiguous 0..N−1; t_start_s
  monotonic non-decreasing; t_end_s ≥ t_start_s; no empty text; coverage —
  max(t_end_s) within 300s of the episode's recorded duration.
- **I7 Text/encoding sweep**: NUL bytes, U+FFFD replacement chars,
  double-encoded entities (`&amp;`), literal `\u` escape leaks, zero-length
  strings in semantically-required text columns, pathological lengths
  (>100k chars) — counted per table, sampled for the report.
- **I8 Numeric hygiene**: `'NaN'::numeric` and infinities in every numeric
  column (PG numerics can store NaN — the driver-coercion trap from A1).
- **I9 Neo4j parity**: read-only MATCH counts per LM_ label vs PG-derived
  expectations for the SYNCED layers; orphan relationship endpoints;
  KNOWN-MISSING classes (A2 extraction edges, art collection) reported as
  expected-absent, not failures. Degrades to SKIPPED (with reason) if
  graph creds are unavailable to the script context.
- **I10 Search**: every search_index row's tsv non-null + ref resolves;
  content canary — a websearch query for a known term per collection
  returns its expected row.

## Load dimensions

- **L1 Read-path storm**: 7 query classes modeled on real app surfaces —
  (a) chapter page (verses+words for one chapter), (b) verse lookup,
  (c) entity page (entity + its edges + target resolution), (d) transcript
  slice (500 rows by seq range), (e) lens query (episode mentions unpacked
  via jsonb_array_elements), (f) search (websearch_to_tsquery over
  search_index AND transcripts.search_vector), (g) 2-hop edge expansion.
  Concurrency ladder 2→4→8→16 clients, 45s per rung, uniformly-random
  parameters drawn from real id pools. Metrics per class per rung: p50 /
  p95 / p99 / max latency, throughput, error count.
- **L2 Pathological inputs** (parameterized, read-only): 10k-char search
  strings, regex/tsquery specials, unicode dash classes, empty strings,
  1k-id IN lists, offset-100k pagination, jsonb paths on absent keys.
  Expectation: graceful (error or fast empty), never a hang or crash.
- **L3 Concurrency semantics**: 4 long-lived REPEATABLE READ read
  transactions held open across a full storm rung (snapshot stability +
  no pooler wedge), plus a connect-storm at pool-max+4 to observe queueing
  behavior (expect: waits, not errors).
- **L4 Cold/warm split**: every class's first-execution latency recorded
  separately from steady-state (cache visibility).

## Safety rails

- Read-only session flag + write-verb assertion on every SQL string.
- statement_timeout 30s (storm) / 120s (integrity); global wall-clock cap
  ~12 min; concurrency ceiling 16 (below pooler limits).
- Circuit breaker: abort the storm if error rate >5% or p95 >5s for two
  consecutive windows — the goal is to measure, not to wound prod.
- No writes of any kind to prod; results land in
  docs/ops/stress-2026-07-18/ (repo files only).

## Verdict policy

Every check emits pass | fail | baseline-debt | skipped(reason). Report:
executive verdict, failures ranked, baseline-debt inventory, latency
tables, and recommendations. Raw results as JSON artifact beside the
report.

## Process

Design (this doc) → adversarial design review (2 reviewers: methodology,
coverage) → incorporate material findings → implement
`scripts/stress-test-data.mjs` → run → report.

## Design-review amendments (2026-07-18, incorporated before the run)

**Methodology adversary (sound-with-changes, 10 findings)**: read-only is now
a connection-STARTUP GUC (`default_transaction_read_only=on`), not a
per-session SET — the .env DSN is the admin credential, the design's
"SELECT-only anyway" claim was false. The connect-storm is DROPPED
(prod-starvation vector). The load half is declared a CLOSED-LOOP DB-CAPACITY
test — not user-path latency (users ride Workers→Hyperdrive); throughput is
the primary rung metric, per-query timing excludes pool checkout. LOAD runs
BEFORE integrity (the sweep warms the entire ~1GB cache); cold/warm claims
dropped. Ladder gains a 1-client baseline rung (breaker calibration), 5s
warm-up discard per rung, and a rung-2 repeat for a variance bound. p99
reported only at n≥300. Breaker: 5s windows, per-class thresholds at
10× baseline (floor 3s), timeouts count as errors, two consecutive breaches
abort. phase-b dup-tuple debt PINNED at exactly 1,578 (≠ fails).

**Coverage adversary (NOT READY → fixed, 12 findings)**: added I11
metadata-linkage checks — jst `verse_id`→verses, strongs entity↔lexicon,
naves well-formedness + its LACK of canon linkage surfaced as recorded debt
(77% of entities were invisible to the original sweep). I12 records
drizzle-schema drift as debt (schema.ts stale vs prod); live checks driven
from information_schema. Load storm gains the two heaviest real surfaces:
strongs GIN containment (738k word_tags) and verses/entities FTS (the
search_index class was testing a 10-row table). I1 gains word char-offset
bounds + sampled surface-vs-substring agreement. I13 openbible payload
(votes numeric; phase-b∩openbible overlap inventoried). I14 rel×collection
matrix + self-loop pin + per-type isolation inventory. I16 strongs lexicon
domains + tag-coverage floor. I17 small-table domains. I18 sampled
tsvector freshness (non-null ≠ fresh). I9 pins the 14 LM_ labels from the
backfill script; extraction edges + art are declared KNOWN-MISSING.
