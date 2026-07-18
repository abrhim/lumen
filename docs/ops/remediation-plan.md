# Remediation plan — full accounting (2026-07-18)

Every open problem surfaced by the data stress test
([stress-2026-07-18/report.md](stress-2026-07-18/report.md)) plus the
still-open items recorded during A2. Per Abram's standing rule, **every fix
ships with a test** — each item names its pin. Priorities: P0 = wrong data
reachable by consumers · P1 = blocks or degrades planned work · P2 =
hygiene with a real payoff · P3 = recorded, act opportunistically.

---

## P0 — Graph parity (the stress test's one failure)

### 1. Neo4j is missing 92% of D&C (+1 chapter)
- **Evidence**: 38,000 LM_Verse vs 41,995 PG; D&C 294/3,654; LM_Chapter
  1,581/1,582. Graph queries over D&C silently return near-nothing today.
- **Fix steps**: (a) extend `backfill-neo4j-collections.mjs` with a
  spine-sync mode (idempotent MERGE on id, batched); (b) diagnose why the
  original sync stopped at exactly 19×2,000 — fix the pagination/limit
  bug in the same commit; (c) run for D&C + the missing chapter;
  (d) add per-volume parity to the script's `--verify` mode.
- **Pin**: harness test on the pagination logic (the exact truncation
  class) + `--verify` asserting per-volume counts; stress harness I9
  already re-checks on every run.
- **Vehicle / effort**: graph-membership feature (pull this slice
  forward — it's independent of the art/extraction backfill) · S/M.

## P1 — Blocks or degrades planned work

### 2. JST addition verses have no anchoring convention (427)
- **Evidence**: `jst-gen-1-32` → `gen-1-32` doesn't exist (KJV Gen 1 has
  31 verses); 427/427 verified as beyond-chapter-end additions.
- **Fix steps**: decide the convention — recommended: keep `verse_id` as
  the JST-native id BUT add `metadata.anchor_verse_id` = last canonical
  verse of the chapter + `metadata.is_addition: true`; one migration
  script stamps all 427; reader/JST surfaces sort additions after their
  anchor.
- **Pin**: migration invariant (0 unanchored additions post-run); stress
  I11 flips from baseline-debt(427) to a hard zero; unit test on the
  anchor-derivation function.
- **Vehicle / effort**: small standalone migration BEFORE Phase B renders
  JST · S. **Decision needed from Abram: approve the anchoring
  convention** (or choose: anchor-to-preceding vs. synthetic verse rows).

### 3. schema.ts drift vs prod (stale columns, 8/15 tables absent)
- **Evidence**: live `words.surface` vs schema's `surface_form`; verses
  restructured; transcripts/search_index in schema but word_tags,
  strongs_lexicon, roles, user_roles, collections, volumes, migration_state
  absent or stale.
- **Fix steps**: one sync pass regenerating `packages/scripture/src/
  schema.ts` from `information_schema` (or drizzle-kit introspect);
  review Ring-2 consumers (MCP server) for type breakage; keep the
  drizzle defs as the single typed source again.
- **Pin**: a `schema-drift.test.mjs` that diffs drizzle column names
  against a committed snapshot of `information_schema` (regenerated
  deliberately, so silent drift fails CI).
- **Vehicle / effort**: standalone chore before the next schema-touching
  feature (enrichment-review UI adds a table — so BEFORE Phase B's
  review-UI step) · S.

### 4. Naves topics have no canon linkage (5,319 standalone entities)
- **Evidence**: metadata carries only `section`/`entry_count`; 100%
  edge-isolated; invisible to search-by-topic → verse journeys.
- **Fix steps**: source Naves' verse references (the original dataset has
  scripture refs per topic entry) → ingest as edges (topic —REFERENCES→
  verse, openbible-style) or metadata verse lists; feature-workflow it
  (it's a real ingestion with a source-parsing step).
- **Pin**: ingestion harness (parse fixtures, fail-closed ref resolution
  — reuse A2's `resolveVerseRef`); stress I11 gains a naves-linkage
  check.
- **Vehicle / effort**: new small feature `naves-linkage` (or folded into
  collections cleanup) · M.

## P2 — Hygiene with real payoff

### 5. phase-b duplicate edge tuples (pinned 1,578)
- **Fix steps**: dedupe migration — for each dup (from,to,rel) keep the
  richest metadata row (or merge), delete the rest; then EXTEND the
  partial unique index pattern to phase-b (`WHERE collection_id IN
  ('unshaken','phase-b')` or per-collection indexes) so the class is
  DB-enforced dead.
- **Pin**: migration invariants (0 dups post-run, index exists); stress
  I3 pin drops from 1,578 to 0-with-index-present.
- **Vehicle / effort**: collections-cleanup chore · S/M (dedupe-keep
  logic needs one careful review).

### 6. openbible ∩ phase-b CROSS_REF semantic overlap
- **Evidence**: same (from,to) CROSS_REF pairs in both collections
  (~inventoried in results.json).
- **Fix steps**: decide ownership (openbible is the canonical source →
  delete phase-b's shadowed copies, or keep phase-b as curated subset
  with a `superseded_by` marker); execute as part of the same
  collections-cleanup migration as #5.
- **Pin**: migration invariant (overlap count 0 or explicitly marked);
  stress I13 flips to hard zero.
- **Vehicle / effort**: collections cleanup · S. **Decision needed:
  which collection owns CROSS_REF.**

### 7. Never-synced graph labels + extraction/art absence
- **Evidence**: LM_StrongsWord/LM_JstReading/LM_NaveTopic exist as labels
  but hold 0 nodes; A2 extraction edges + art collection absent by
  design.
- **Fix steps**: this IS the graph-membership feature's core scope —
  episode nodes + extraction edges (lens in graph), art (absorbing the
  parked art-neo4j port incl. the DEPICTS→summary-node question), then
  strongs/jst/naves layers if graph exploration wants them (decide
  per-layer: not everything belongs in the graph).
- **Pin**: backfill `--verify` per layer; stress I9 label expectations
  updated per decision.
- **Vehicle / effort**: graph-membership feature (already queued) · L.

### 8. Edge-isolated relational entities (141 persons, 91 places, 165 eras)
- **Evidence**: relational-collection entities with zero edges — orphans
  or under-enriched.
- **Fix steps**: triage query first (sample 20: are they legit-but-rare
  figures or ingestion strays?); then either enrich (phase-b edge pass)
  or mark `metadata.expected_isolated` so the inventory distinguishes
  intent from neglect.
- **Pin**: stress I14 inventory pinned to the post-triage counts.
- **Vehicle / effort**: fold into graph-membership or collections
  cleanup · S (triage) + M (enrichment if chosen).

### 9. One self-loop edge
- **Fix steps**: inspect it (single row); delete or legitimize with a
  comment-worthy reason; adjust the stress pin to 0 (or keep 1 with the
  reason recorded).
- **Pin**: stress I14 self-loop count.
- **Vehicle / effort**: collections cleanup · trivial.

## P3 — Recorded; act opportunistically

### 10. Extraction recall improvements (from A2's honest-limits list)
Disambiguation judgment phase for collision-excluded names (the two
Naamans/Samuels — the biggest recall hole: 1 Samuel episodes lack
Samuel-the-prophet mentions) · cross-book anchoring for tangent windows
(2 Chr/Isaiah refs currently dropped; graph HAS those chapters) ·
relative-ref expansion ("last verse", bare numerals) · a recall eval
(agents exhaustively enumerate refs in sampled windows).
- **Vehicle**: extraction v1.1 workflow phases — all run at $0; each new
  extractor gains harness fixtures (the rule); eval round N+1 re-gates.
  Effort · M.

### 11. Eval evaluator model diversity
Same-model caveat recorded in A2's plan §Eval; when worth it, run
evaluator agents with an Agent-tool model override and compare trap-catch
against same-model rounds. Effort · S (one comparative round).

### 12. A2 accepted-risk residuals (unchanged posture)
Classification-read-outside-tx (loud in both failure directions; revisit
only when scheduled ingestion can overlap stages) · repair scan→tx window
(one-time script, writers fixed). No action unless conditions change —
conditions are stated in bugs.md.

### 13. Ops guidance (constraints, not bugs)
Scripts/tooling concurrency ≤ 12 (session pooler caps at 15 —
harness-pinned) · adopt the stress harness as a scheduled post-ingest
sweep (read-only, ~8 min — cron or a workflow step after each weekly
episode load) · W1 upload-date backfill (episodes.json `uploadDate: "NA"`)
rides Phase B as already planned · main remains unpushed to origin
(standing, Abram's call).

---

## Sequencing proposal

1. **Now / pre-Phase-B**: #2 JST anchoring (needs your convention call) ·
   #3 schema sync · #1 D&C graph re-sync (pull forward from
   graph-membership).
2. **Collections-cleanup chore** (one branch): #5 dedupe + index · #6
   CROSS_REF ownership (needs your call) · #9 self-loop · #8 triage.
3. **Phase B** (as scoped): enrichment review UI · W1 · de-AI-UX · lens ·
   public flip.
4. **Graph-membership feature**: #7 (+#1's verify hardening, #8's
   enrichment half).
5. **Extraction v1.1**: #10 recall work + #11 diversity round.

Decisions needed from Abram: JST anchoring convention (#2) · CROSS_REF
ownership (#6) · which layers belong in the graph (#7).
