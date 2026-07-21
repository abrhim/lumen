# Remediation plan v2 — post-review (2026-07-19, completed 2026-07-20)

v1 (82e11de) was adversarially reviewed by two agents on Abram's direction:
a **fix-correctness adversary** (41 tool calls, live prod + graph probes) and
a **prioritization adversary** (code-evidence sequencing attack). Three of
v1's five decision-shaping premises were REFUTED; v2 is the corrected plan.
This completion (2026-07-20) re-verified every corrected premise against
live prod (integrity re-run: 67 checks, same 1 failure + 9 pinned debts as
2026-07-18, plus targeted read-only probes — see §Verification log), and was
itself panel-reviewed twice before ratification (§Review log). Rule in
force: every fix ships with a BEHAVIOR test (both reviewers flagged
string-regex pins as a house weakness — pins must exercise behavior, not
SQL text).

Doc convention: v2 continues IN-PLACE (v1 preserved at
`git show 82e11de:docs/ops/remediation-plan.md`); the 2026-07-19 truncated
draft is preserved at 86e3a28.

---

## Revised verdict on sequencing (the headline change)

**Phase B starts immediately — nothing gates it.** All three of v1's
"pre-Phase-B" items were refuted by code evidence: no JST surface exists in
the app; nothing at runtime consumes the stale drizzle defs (`drizzle(client)`
is schemaless, all queries raw SQL); the graph re-sync touches only scripts.
The public flip is the product milestone; hygiene runs beside it, not in
front of it.

## Now-items (before any destructive work)

- **N1 — Backup push, BOTH refs.** origin/main..main = 126 commits, but the
  remediation corpus (harness, stress artifacts, this plan) lives in commits
  beyond main on `feature/unshaken-surfaces` (133 ahead of origin/main as of
  2026-07-20 and growing with the ratification commits — **no remote
  counterpart exists**; verify with `git rev-list --count
  origin/main..feature/unshaken-surfaces` at push time). Push
  `feature/unshaken-surfaces` (main is its ancestor — one push covers every
  unpushed commit regardless of count) plus, honoring the standing
  origin/main freeze (v1 item 13, Abram's call):
  `git push origin main:backup/main-2026-07-19`. *(Needs Abram's go —
  outward-facing.)*
- **N2 — Stress harness as a scheduled sweep** (P3→**P1**: it is the
  enforcement layer for every pin below, which only fires if the harness
  runs). Read-only, ~8 min. Wire as a post-ingest step before the weekly
  episode cadence starts. Hosts the schema-drift live diff (item 6) and the
  new probes (items 1, 3, 7, 8 — including item 1's per-volume directional
  parity, which is NEW work: today's I9 checks global label totals only,
  and would flip green on totals alone post-sync while per-volume parity
  went unverified). **Executes FIRST** — pins for not-yet-run fixes land as
  baseline-debt (the `pinned_baseline` house pattern) and flip to hard
  passes as each fix ships.

## Decisions for Abram to ratify (recommendations, not open questions)

- **D1 — JST placement.** The 427 dangling JST verse links are verified
  beyond-canonical-chapter-end (harness I11 split, corrupt=0, re-confirmed
  2026-07-20). The source's `change_type` is uniformly 'substitution'
  across all 31,262 readings — uninformative here: it never labels
  additions, and is stamped even where the KJV target verse doesn't exist.
  The class plausibly MIXES genuinely added material (e.g. the Gen 14:25+
  Melchizedek expansion) with re-versified overflow (e.g. jst-gen-1-32..33
  ≈ KJV Gen 2:1–3) — and that mix is exactly why v1's `is_addition` stamp
  cannot be derived from this data. **Recommend**: stamp
  `metadata.placement = 'beyond_canon_end'` +
  `metadata.anchor_verse_id = <last canonical verse of the chapter>` on the
  427 — a placement hint, not a semantic claim. True JST↔KJV alignment is a
  separate, larger effort — out of scope here.
- **D2 — CROSS_REF coexistence.** openbible (614,209 refs, votes + range,
  verified 100% Bible-only) and phase-b (115,764 refs, reason + taxonomy,
  35,246 touching BoM/D&C/PGP) are COMPLEMENTARY. **Recommend**: keep both;
  query-time dedupe on (from,to) with an `also_in` marker in the read path;
  delete nothing. (42,470 overlapping pairs measured live.)
- **D3 — Graph sync layers + id mapping.** **Recommend**: sync (a) the
  3,995 missing LM_Verse nodes (3,360 D&C + 635 PGP, exact PG ids — graph
  verses verified to use PG ids), (b) the 1 missing LM_Chapter (**moses-1**,
  identified 2026-07-20), (c) structural CONTAINS edges via the **legacy
  chapter-id mapping** — ALL 1,581 graph chapters use `{book}-ch-{n}` ids
  (js-h/js-m use long-form `joseph-smith-history-ch-1` /
  `joseph-smith-matthew-ch-1`); the writer maps PG `{book}-{n}` → legacy
  graph id, NEVER creates chapters under PG ids (would mint 1,579
  duplicates), and creates moses-1 as `moses-ch-1` (conforming to its
  sibling `moses-ch-2..8`, which exist), (d) the phase-b semantic edge
  slice incident to the new verses (CROSS_REF / TEACHES / MENTIONS /
  LOCATED_AT / HAS_SYMBOL — the classes live on the synced 294).
  Strongs/jst/naves layers + extraction edges + art stay in the
  graph-membership backlog (per-layer decisions deferred, v1 #7).
- **D4 — Self-loop disposition.** The 1 self-loop is `dc→dc IN_VOLUME`
  (phase-b), semantically CORRECT (book dc IS in volume dc) — a flattening
  artifact of the shared id, and its metadata already disambiguates
  (`from_label: LM_Book, to_label: LM_Volume`; verified live). **Recommend**
  (lighter than the review's namespacing suggestion, on this evidence): pin
  the row by IDENTITY in the harness (exactly this row, no others) and defer
  `{type}:{id}` namespacing to graph-membership's structural-entity pass.
  The graph itself is correct (Book–IN_VOLUME→Volume, no graph self-loop).
  Alternative if preferred: namespace `from_id` to `book:dc` now (S effort,
  touches 1 row + consumers that resolve bare ids).

## Write protocol (all items)

- **Postgres**: DRY_RUN default, `COMMIT=1` to apply; one transaction per
  unit; invariant checks INSIDE the tx (abort on mismatch); house pattern =
  `migrate-media-collections.mjs` (dry-run via thrown rollback) +
  `repair-metadata-encoding.mjs`.
- **Escrow (destructive PG writes)**: client-side full-row images of EVERY
  row in every affected group — both pair members, all columns — to a
  timestamped local JSON before the tx (server-side COPY unavailable on the
  Supabase pooler role; `edges` has no PK so restore = delete group by
  natural key + reinsert images). In-tx invariant: updated+deleted rowcounts
  == escrowed group sizes. ctid only as an in-tx handle collected under
  `SELECT … FOR UPDATE` (house precedent: target by predicate, ctid for
  logging) — never a restore key. Destructive migrations run in a
  no-ingest/no-backfill window.
- **Neo4j (no cross-batch undo exists — house client is one auto-committed
  statement per POST)**: unit = one idempotent, re-runnable, label-exact
  MERGE batch; dry-run = counts-only Cypher (would-create vs would-match)
  gated behind the same COMMIT=1 convention; every CREATED node/edge stamped
  `sync_run: '<id>'` **via `ON CREATE SET` only** — a MERGE that matches an
  existing element must never gain it, so delete-by-sync_run can never touch
  pre-existing graph elements; escrow-equivalent = pre/post per-volume
  directional count snapshots to file. Endpoint resolution ALWAYS by exact
  label (phase-b edge metadata carries `from_label`/`to_label` — use them),
  NEVER the `LM_UNION` pattern — id `dc` is both LM_Book and LM_Volume
  (both nodes verified live in graph).
- **KV invalidation after graph writes**: verse-connection reads are
  KV-cached 7 days under TWO key families in `scripture.tsx` —
  `vconn:v2:${verseId}` and `graph:v1:${entityId}:${depth}:${collKey}`.
  Mechanism: bump both key versions (`vconn:v2`→`v3`, `graph:v1`→`v2`) and
  deploy after D&C acceptance (house-precedented cache-versioning pattern);
  without it a clean sync is invisible for up to 7 days.
- **Stop conditions — Postgres**: dry-run count diverges from this plan's
  expectation, or any in-tx invariant fails → halt, report, no COMMIT.
- **Stop conditions — Neo4j live-write phase**: any batch error, or
  per-batch created+matched != batch size, or cumulative created diverging
  from the dry-run expectation → **halt immediately** (do NOT continue
  remaining batches — an explicit deviation from
  backfill-neo4j-collections.mjs's continue-on-failure style), write the
  post-halt count snapshot, report with the `sync_run` id.
- **Pin mechanisms, both named**: harness checks for read-observable
  invariants; **rolled-back live transactions** (BEGIN → exercise writer →
  assert → ROLLBACK, single connection) for write-path behavior — required
  for item 3's writer, which gets a tx-wrapper mode for exactly this.

## P0 — parallel track beside Phase B

### 1. Graph re-sync: D&C (92%) + PGP (100%) — nodes AND edges
- **Verified scope (2026-07-20 live)**: missing = 3,360 D&C verses (graph
  holds 294/3,654; PG 3,654 across 138 chapters) + ALL 635 PGP verses
  (0 in graph across all five books) + LM_Chapter `moses-1`. PGP's other 15
  chapters already exist (empty). CONTAINS edges = 38,000 = exactly the
  graph verse count. Original build (`source: 'anthropic-batch'`) truncated
  clean at the 19×2,000 batch boundary.
- **Fix**: build `scripts/backfill-neo4j-spine.mjs` — a one-shot,
  idempotent, converge-to-parity backfill (house style: `--dry-run` /
  `--verify` / write modes, exit codes 0/1/2), NOT permanent pipeline. Reads
  PG (read-only session), MERGEs label-exact batches per D3's id mapping,
  stamps `sync_run` (ON CREATE SET only), then syncs the phase-b edge slice
  incident to created verses. Conform new node property shape to an
  existing synced D&C verse (probe before build).
- **Edge-slice rules**: (i) a read-only pre-probe measures BOTH the PG
  phase-b edge count per rel_type incident to the 3,995 missing verse ids
  (recorded as the edge phase's dry-run expectation) AND the graph-side
  existence of the slice's distinct non-verse (id,label) endpoints;
  (ii) entity endpoints resolve via the house `resolveGraphId()` contract
  (graph id = `entities.metadata->>'neo4j_id'` when present, else PG id —
  the writer joins the edge slice to `lumen.entities` to recover it);
  (iii) non-verse endpoint resolution is **MATCH-only — never MERGE-create
  an entity node**; dry-run expectation states `entity-node creations = 0`,
  and skipped-for-missing-endpoint is counted and asserted equal to the
  pre-probe's missing-endpoint count as an in-run invariant.
- **Canary = PGP first** — it proves mechanics (batching, chapter mapping,
  CONTAINS) but NOT merge-into-existing or the dc collision (PGP book ids
  are all distinct from volume id); D&C then proceeds AUTOMATICALLY only if
  every canary acceptance criterion passes, else halt (one go/no-go from
  Abram covers canary+D&C together under the two-checkpoint delegation).
- **Acceptance (D&C)**: LM_Verse `dc-` count lands at exactly 3,654 with
  the pre-existing 294 NOT duplicated; no duplicate (id,label) pairs; the
  pre-sync inbound edge set to the 294 (900 CROSS_REF + 294 CONTAINS,
  measured 2026-07-20) still resolves; zero new cross-type edges on id
  `dc`; per-volume directional parity BOTH ways, never netted.
- **Pins**: two-hop from `dc-76-22` (verified 2026-07-20: node absent, 0
  paths; synced `dc-4-2` = 399 paths) returns >0 post-sync — lands in the
  sweep as a baseline-debt pin that flips. Harness I9 global label parity
  already re-checks every run; the **per-volume directional parity probe is
  NEW** and ships with item 2's sweep alongside the backfill's `--verify`.
  Plus a unit-tested pagination/batch-boundary test (the exact truncation
  class that caused this).
- **Post-sync**: KV invalidation per the write-protocol mechanism (both key
  families).
- **Effort**: M (writer + canary + D&C run + verify).

## P1 — enforcement + blocks planned work

### 2. Scheduled harness sweep (executes FIRST — see N2) · S
### 3. phase-b duplicate edge tuples (pinned 1,578) — provenance MERGE
- **Verified anatomy (2026-07-20)**: exactly 1,578 groups × exactly 2 rows
  with differing metadata, verified across the FULL population (groups,
  max_group=2, meta_differs=1,578); the `metadata.source='ai-generated'`
  (carries `reason` + `relationship`) + `'bible-bom-curated'` (carries
  neither) pairing verified on every SAMPLED group. "Keep the richest"
  would DELETE curation provenance — REFUTED.
- **Dry-run expectation (halts pre-COMMIT if violated)**: full-population
  aggregate — count of dup groups whose `metadata->>'source'` pair =
  {ai-generated, bible-bom-curated} AND rel_type composition — must equal
  1,578 exactly; any other shape aborts in DRY_RUN before any COMMIT.
- **Fix (one transaction)**: (a) escrow full-row images of all 3,156 rows;
  (b) merge: survivor = curated row UPDATEd with
  `metadata.reason`/`relationship` from the AI row +
  `metadata.sources = ['bible-bom-curated','ai-generated']`; delete the AI
  row (predicate-targeted, FOR UPDATE); in-tx invariants: every group is
  exactly the verified 1+1 shape (abort otherwise), 1,578 updates + 1,578
  deletes == escrow, 0 dup groups post-merge; (c) CREATE the second partial
  unique index `idx_edges_phaseb_unique ON lumen.edges (from_id, to_id,
  rel_type) WHERE collection_id = 'phase-b'` INSIDE the same tx (dups gone
  → index valid → zero corruption window). `idx_edges_unshaken_unique` is
  NEVER touched (ingest-podcast/load.mjs ON CONFLICT arbiter).
- **Writer**: rewrite `backfill-phase-b.ts`'s delete-then-insert to
  merge-aware upsert (ON CONFLICT on the new index, preserving
  merged/curated metadata — the load.mjs mentions-preserving pattern), FOR
  BOTH edges AND entities; startup assert: index exists (fail-closed before
  the index lands); single-connection tx-wrapper mode. TWO additional rules
  the upsert alone does not give: (i) **in-memory tuple dedupe before
  batching** — the export JSON itself contains both members of every dup
  pair, so a straight upsert port self-conflicts in-batch (PG error 21000
  "cannot affect row a second time"); collapse (from,to,rel_type) in memory
  first, merging reason/relationship + `sources` in the same shape as the
  DB merge; (ii) a **renames ledger** applied to entity ids AND edge
  endpoints before upsert (`a-sidney-gilbert-1` → `john-c-bennett-1`, plus
  any future item-7-class renames) — upsert alone only protects the renamed
  row from deletion; without the ledger a re-run re-MINTS the stray id from
  the export.
- **Pin**: rolled-back live-tx test — run the merge-aware writer against
  prod inside BEGIN…ROLLBACK (single connection), with a batch containing a
  known dup pair (proves the in-batch dedupe) and the renamed entity
  (proves the ledger: no stray re-mint); assert merge-not-delete + no-crash
  + curated provenance survives. Runs INSIDE the same no-ingest/no-backfill
  window as the migration — it holds row locks on the full phase-b set for
  the tx duration. Sweep gains the dedupe-uniqueness probe (I3 pin drops
  1,578 → 0-with-index-present).
- **Effort**: M.

### 4. JST placement stamping (per D1) · S
- Migration stamps the 427 (escrowed, invariants: exactly 427 rows touched,
  0 unanchored post-run); sweep I11 pin flips from baseline-debt(427) to
  hard zero-unanchored; unit test on the anchor-derivation function.

## P2 — hygiene with real payoff

### 5. CROSS_REF coexistence (per D2) · S — app-layer
- Query-time dedupe + `also_in` in the read path; normal code review +
  tests (not the migration protocol — no prod data write). **Behavior
  pin**: unit/loader test on the read path — a (from,to) pair present in
  BOTH openbible and phase-b returns exactly one entry carrying `also_in`;
  a pair present in only one collection returns one entry with no
  `also_in`. Sweep keeps the I13 overlap inventory (42,470) as
  informational baseline.

### 6. schema.ts drift · S — pin now, regen opportunistically
- Near-zero runtime risk (nothing imports the Drizzle table objects at
  runtime; query layer is raw SQL — refuted as a Phase-B gate). Pin = LIVE
  `information_schema`-vs-Drizzle diff INSIDE the scheduled sweep (a
  committed snapshot can't catch prod-vs-repo drift from standalone
  migrations). Full schema.ts regen rides the next schema-touching feature
  (enrichment-review UI adds a table).

### 7. Entity id↔name: the a-sidney-gilbert-1 stray · S
- **Verified (2026-07-20)**: named "John C. Bennett"; the ONLY `a-`-prefixed
  phase-b entity (id-convention anomaly); ZERO edges; no john-c-bennett
  entity exists; a correct `sidney-gilbert-1` ("Sidney Gilbert") exists
  separately. **Fix**: rename id → `john-c-bennett-1` (name is the signal;
  the id was the copy-paste error; zero blast radius) AND stamp
  `metadata.neo4j_id = 'a-sidney-gilbert-1'` on the renamed row (the house
  `resolveGraphId` contract — keeps PG↔graph resolution working and lets
  item 3's renames ledger converge the export). Escrowed; invariant: id
  unique post-rename.
- **Probe + triage**: the broad scan found 311/5,904 first-token
  mismatches. Triage evidence is an alphabetical 30-row sample (ids a–h
  only; 281 rows untriaged): mostly benign KJV alternates ("Booz",
  "Beth-el", "Achar", "Gershom") and descriptive names ("Wife of Urias",
  "The City"), but **four pairs are unexplained** — abdon-1→"Hanoch",
  enoch-2→"Enosh" (provably distinct Gen 5 patriarchs), aha-1→"Agee",
  ephron-1→"Ephrath" — the same id/name-conflict class as gilbert/bennett.
  The sweep pins **311 now — moving to 310 when this item's rename lands**
  (the pin moves with the fix, same protocol as every flip) — as an
  UNTRIAGED INVENTORY value (drift detection), not a verified-benign set;
  item 7's execution includes the full 311-row triage, with the four named
  pairs first in the queue; any real strays found become follow-up renames
  under this item's protocol.

### 8. Edge-isolated relational entities (141 persons / 91 places / 165 eras)
- **Triage verdict (2026-07-20 sample)**: legit under-enriched content, not
  strays — timeline eras with rich descriptions that literally cite verse
  refs ("GEN 11:12"). **Recommend**: NO `expected_isolated` stamping (they
  are not expected-isolated — they're enrichment candidates); no prod write
  now; I14 inventory pin stays; the description-cited verse refs make a
  cheap enrichment edge-pass tractable inside graph-membership. · recorded

## P3 — recorded; act opportunistically (unchanged from v1)

- **9. Naves canon linkage** — L, not M (source dataset NOT in the repo;
  step 1 is re-acquisition). Parked.
- **10. Extraction recall** (disambiguation, cross-book anchoring,
  relative refs, recall eval) — extraction v1.1, M. Parked.
- **11. Evaluator model diversity** — S, one comparative round. Parked.
- **12. A2 accepted-risk residuals** — no action; conditions in bugs.md.
- **13. Ops guidance** — concurrency ≤ 12 (pooler cap 15, harness-pinned);
  W1 upload-date backfill rides Phase B; origin/main freeze stands (N1 uses
  a backup ref).

## Execution order

Per-item loop: dry-run → sign-off (except items 4/7, delegated below) →
COMMIT → pins re-run.

1. **N1 backup push** (Abram's go) → 2. **Item 2 sweep + new probes**
(enforcement live first) → 3. **Item 1 graph re-sync** (PGP canary →
auto-proceed to D&C only on full canary acceptance) → 4. **Item 7 entity
rename + 311 triage** (moved ahead of item 3: the rewritten writer's
renames ledger converges old ids, so item 3's rolled-back live-tx pin
requires the rename to be applied first — reviewer-flagged sequencing
dependency) → 5. **Item 3 dedupe merge + index + writer** → 6. **Item 4
JST stamping** → 7. **Item 5 CROSS_REF read-path** (normal code review) →
8. Items 8–13 as recorded.

Under two-checkpoint delegation (Abram 2026-07-20): **zero-blast-radius
escrowed commits** (item 4: jsonb metadata stamps on 427 verses; item 7:
single-row entity id rename, 0 edges) auto-apply when dry-run counts match
this plan exactly; the destructive/no-undo writes each get an explicit
go/no-go — N1 (outward push), item 1 (one gate covering canary+D&C), item 3
(curated-data merge).

## Verification log (2026-07-20, this completion)

Integrity re-run: 67 checks — 57 pass, 1 fail (I9 D&C parity, unchanged),
9 baseline debts all at pinned values (1,578 / 427 / 1 self-loop / …).
Targeted read-only probes (15 probe sections over two rounds; PG read-only
sessions + MATCH-only Cypher):
JST change_type distribution (31,262 substitution / 0 addition — see D1 for
why this is uninformative on additions) · dup-group anatomy (1,578×2 full
population; ai/curated pairing on every sampled group) · CROSS_REF
ownership (phase-b 115,764 / 35,246 non-Bible; openbible 614,209 / 0
non-Bible; overlap 42,470 pairs) · per-volume PG counts (dc 3,654/138 ·
pgp 635/16) · graph state (dc verses 294, pgp 0, both `dc` nodes present as
LM_Book + LM_Volume) · chapter-id census (1,581/1,581 legacy `-ch-` scheme;
js-h/js-m long-form; missing = moses-1) · verse-id scheme + CONTAINS census
(graph verses use PG-style ids; CONTAINS 38,000 = graph verse count) · dc
edge topology (inbound 900 CROSS_REF + 294 CONTAINS) · two-hop before-state
(dc-76-22 absent/0 · dc-4-2 = 399 paths) · self-loop identity (dc→dc
IN_VOLUME, labels in metadata) · gilbert/bennett anatomy (0 edges, no
bennett entity, 1 of 1 `a-` prefix) · id↔name scan (311/5,904 first-token;
30-row sample triaged, 4 unexplained pairs queued — see item 7) ·
isolated-entity triage (legit, verse-citing descriptions).

## Review log

- 2026-07-19: two-agent adversarial review of v1 (fix-correctness +
  prioritization) — three premises refuted; draft v2 begun.
- 2026-07-20: four-lens execution-plan panel (grounding / safety /
  sequencing / compliance), 21 findings, 21 confirmed by independent
  skeptic verification — folded into the execution approach.
- 2026-07-20: four-lens v2-document panel (factual exactness /
  executability / protocol / decision quality), 25 findings raised, 23
  confirmed, 2 refuted — all 23 folded in (notable: sample-vs-population
  scoping on items 3/7, the export's in-batch dup pairs, the renames
  ledger, Neo4j mid-run stop conditions, per-volume I9 parity is new work).
