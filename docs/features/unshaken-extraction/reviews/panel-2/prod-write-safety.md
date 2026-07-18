# Panel 2 — prod-write-safety adversary (unshaken-extraction A2)

Lens: attack the revised plan's write paths — find run/crash/re-run sequences
that corrupt shipped A1 data or the spine. Sources: plan.md (Revision 1),
panel-1/data-integrity.md, `scripts/ingest-podcast/load.mjs` + `index.mjs`,
`scripts/__tests__/ingest-extraction.test.mjs` (amended harness),
`scripts/__tests__/ingest-podcast.test.mjs` (A1 pins), `scripts/
migrate-media-collections.mjs`, plus **live read-only prod probes**
(2026-07-18, PG 17.6, DSN per smoke-media.mjs:17-28, SELECT-only with
`SET default_transaction_read_only = on`). Implementation files
(`extract-lib.mjs`, `load-extraction.mjs`, `repair-metadata-encoding.mjs`,
`smoke-extraction.mjs`, `.claude/workflows/`) do not exist yet — attacks
target the plan contract and what the pinned harness would let an
implementer ship.

Probe baseline reconfirmed: 184 unshaken edges, ALL `source =
'unshaken-youtube'`, ALL `jsonb_typeof(metadata) = 'string'`; 10 episode
entities likewise string-typed; string-typed metadata exists in NO other
collection; `idx_edges_unshaken_unique (from_id,to_id,rel_type) WHERE
collection_id='unshaken'` is live; `lumen.edges` has no PK and only a
collection FK; verse id `2-kgs-14-3` exists, `2kgs-14-3` does not
(panel-1 F1/F2/F4 all re-verified).

## Findings

### A1: The A1-rerun co-fix cancels itself — source-aware delete removes the very rows whose mentions the upsert is supposed to preserve

**Tag: material** (the plan's own stated invariant is violated on the normal
path; this is the exact hole panel-1 F3 opened, half-closed)

Plan (plan.md:108-112): "A1's load delete becomes source-aware
(`source='unshaken-youtube'` only) and its title-edge insert preserves
existing mentions on conflict — a weekly A1 re-run must never wipe A2
extraction edges or reset mention arrays."

Trace the sequence **A2 load → A1 re-run (co-fixed as written) → observe**:

1. A2 has UPDATEd title edges with real mentions arrays.
2. A1 re-run, same tx: DELETE `WHERE from_id AND collection_id AND
   source='unshaken-youtube'` — this matches **exactly the title edges**
   (probe: all 184 rows carry that source). They are gone inside the tx.
3. Title-edge INSERT with `ON CONFLICT … DO UPDATE` preserving mentions:
   the conflict **never fires** — the conflicting rows were deleted one
   statement earlier. Fresh rows insert with `mentions: []`
   (load.mjs:119 shape).

Net: extraction-sourced edges survive (good — that half works), but every
chapter-level mentions array A2 wrote is **silently reset on every weekly
A1 re-run**. The reset persists until the next A2 load — which nothing
mandates, so the stale window is unbounded. The plan's mechanism does not
deliver the plan's invariant.

Compounding evidence — the co-fix has zero planned test coverage:

- plan.md "Files touched" lists `load.mjs (edit — source-aware delete +
  mentions-preserving title upsert)` but does NOT list
  `scripts/__tests__/ingest-podcast.test.mjs`, the file that pins
  `buildLoadPlan`.
- The existing pins actively encode the OLD behavior:
  `ingest-podcast.test.mjs:309-314` pins the edges delete scoped by
  episode + collection only (no source), and `:348-355` pins the DISCUSSES
  insert carrying `"mentions":[]`. An implementer can satisfy the current
  suite verbatim while shipping the self-cancelling co-fix — or while
  shipping no co-fix at all.

**Recommendation** (amend plan §A1-repair item 2 + harness):
1. The title-edge write becomes upsert-only, arbitrated on the partial
   index: `INSERT … ON CONFLICT (from_id, to_id, rel_type) WHERE
   collection_id = 'unshaken' DO UPDATE SET metadata =
   jsonb_build_object('source','title','confidence',1,'mentions',
   COALESCE(CASE WHEN jsonb_typeof(lumen.edges.metadata)='object' THEN
   lumen.edges.metadata->'mentions' END, '[]'::jsonb))` — preserves
   mentions, is safe against the pre-repair string-typed rows (A3), and
   never resurrects `mentions:[]` over enriched data.
2. The A1 edges delete shrinks to **stale anchors only**:
   `… AND source = 'unshaken-youtube' AND to_id != ALL($chapterIds)` —
   removes chapters that left the block on a title re-parse, touches
   nothing else.
3. Amend ingest-podcast.test.mjs in this feature: pin the ON CONFLICT
   preservation clause text, pin `source='unshaken-youtube'` +
   `to_id != ALL` in the delete, and update the `:348` pin (insert still
   carries `[]`; preservation lives in the conflict clause).
4. Smoke: chapter edges of extracted episodes have non-empty mentions
   (catches a reset after the fact; see A9).

### A2: A2's second run silently destroys its own extraction edges — the classification fetch is unpinned and panel-1's literal recommendation causes the loss

**Tag: material** (idempotent re-run is a designed-in operation; H7's
promise dies on the first re-run)

Trace **A2 load → A2 load again** with the fetch implemented per panel-1
F5's literal wording ("Fetch ALL existing `(to_id, rel_type)` for
`(from_id, collection_id)` with no metadata predicate"):

1. Run 1: extraction edges inserted (`source='unshaken-extraction'`),
   title edges updated. Fine.
2. Run 2, plan-build: the fetch returns title pairs **plus run 1's
   extraction pairs**. `buildExtractionLoadPlan` classifies
   existing-pair → `update-title-edge` (that is all the harness fixture
   ever shows it: `EXISTING_TITLE_EDGES` at ingest-extraction.test.mjs:
   397-400 contains only title pairs).
3. Run 2, tx executes in H4 order (deletes first): DELETE
   `source='unshaken-extraction'` removes run 1's edges. Then each
   misclassified UPDATE targets a row that no longer exists — **UPDATE
   0 rows, no error**. No INSERT compensates.
4. Net: after run 2, nearly every extraction edge is gone; the run exits 0.

Every ordering of this mistake loses data: if the deletes did NOT precede
(violating the H4 order contract), the UPDATEs would instead relabel run
1's extraction edges to `source='unshaken-youtube'`/confidence 1 — after
which A2's delete misses them forever (zombies) and A1's co-fixed
stale-anchor delete eventually kills them (verse ids are never in
`$chapterIds`). Silent loss either way.

The harness cannot catch any of this: the fetch SQL lives in the untested
shell and is not string-pinned (panel-1 F5 explicitly asked for the pin;
the amended harness does not have it), and no fixture ever hands the
builder an extraction-sourced existing pair.

**Recommendation**:
1. The fetch filters on the first-class column — `WHERE from_id = $1 AND
   collection_id = 'unshaken' AND source = 'unshaken-youtube'` — exactly
   panel-1's own F4 primitive, valid pre- and post-repair.
2. Export the fetch SQL as a constant from load-extraction.mjs (house
   precedent: exported DDL in migrate-media-collections.mjs:15) and
   string-pin `source = 'unshaken-youtube'` in the harness.
3. Add the harness fixture: an existing pair whose source is
   `unshaken-extraction` must classify INSERT, never update-title-edge.
4. Executor asserts rowCount === 1 for every `update-title-edge`
   statement — converts any residual misclassification into a loud
   per-episode abort instead of silent loss.

### A3: Repair ordering is unenforced, and two of three plausible title-UPDATE implementations corrupt or abort on unrepaired rows

**Tag: material** (ordering-dependent correctness with no gate; one branch
is silent corruption)

The plan sequences the repair only implicitly ("one-time … unwrap
migration", plan.md:104-106); nothing states or enforces
repair-before-first-A2-load, and nothing stops an A1 re-run from an
unfixed checkout after the repair. Live-probed semantics (PG 17.6,
SELECT-only expressions):

- string-scalar `|| '{"mentions":[1]}'::jsonb` →
  `["{\"source\":\"title\"}", {"mentions":[1]}]`, `jsonb_typeof = 'array'`
  — a merge-style UPDATE on an unrepaired row **silently converts title
  metadata into a jsonb array**; every consumer breaks, smoke typeof
  invariant is the only thing that would ever notice.
- `jsonb_set(string-scalar, '{mentions}', …)` → ERROR "cannot set path in
  scalar" — loud abort. Annoying but safe.
- Whole-object replace → succeeds and incidentally repairs the row.
- Row targeting itself is immune: classification and UPDATE match on
  `(from_id, to_id, rel_type)`, so the row IS found regardless of metadata
  typeof (answering "which row does it target pre-repair": the right one;
  loud-vs-silent depends entirely on the SET expression).
- Repair mechanics: `(metadata #>> '{}')::jsonb` is **idempotent on
  objects** (probed — double-run safe even without the WHERE guard),
  errors loud on non-JSON strings, and string-typed metadata is confined
  to unshaken (184 edges + 10 entities; zero rows elsewhere) — the
  collection-scoped, `WHERE jsonb_typeof='string'`-guarded repair is safe
  to run twice, and safe to run again after an unfixed-executor re-run
  re-corrupts (self-healing loop).
- Repair mid-flight against an in-flight A1/A2 tx (READ COMMITTED):
  blocked rows re-checked after commit (deleted → skipped), concurrently
  inserted rows invisible to the repair statement → left as whatever the
  executor wrote. No corruption path; worst case is "some rows still
  string-typed", healed by an idempotent re-run. Which orderings corrupt:
  **only** load-before-repair with a merge-style UPDATE; everything else
  is loud or self-healing.
- The masking hole stays open on the A1 side: smoke-media.mjs:99-100
  still carries the parse-if-string accommodation, and the plan adds the
  typeof invariant only to the NEW smoke-extraction. An unfixed-checkout
  A1 re-run after repair re-ships 184 string rows and **smoke-media
  passes clean**.

**Recommendation**:
1. load-extraction preflight (cheap, decisive): `SELECT count(*) FROM
   lumen.edges WHERE collection_id='unshaken' AND
   jsonb_typeof(metadata)='string'` (+ same for entities) → abort with
   "run repair-metadata-encoding first" if nonzero. Every bad ordering
   becomes loud, and the merge-vs-replace question stops being
   load-bearing.
2. Title UPDATE builds the whole metadata object (never `||`, never
   jsonb_set on possibly-scalar rows); already consistent with the H6 pin
   shape.
3. Add the `jsonb_typeof='object'` invariant to smoke-media.mjs too (or
   remove its accommodation) — the A1 pipeline's own smoke must stop
   masking A1's own bug class.

### A4: Title-edge mentions replace-vs-append is unpinned — an append implementation passes the harness and breaks idempotency + alias-staleness

**Tag: risky**

Plan says "existing title-sourced … edges get mentions UPDATED in place"
(plan.md:99-100) — silent on replace vs merge. The H6 fixture's
`EXISTING_TITLE_EDGES` carry no metadata at all, so an implementation that
appends (`old.mentions || new`) satisfies every current pin. Consequences:
each A2 re-run doubles the mentions array; and after an alias-table
correction, wrong-target-era mentions on title edges are **immortal** —
the changed-alias re-extraction cleanly replaces extraction edges
(delete+insert) but can never remove an appended stale mention from a
title edge. Correct idempotent semantics: the title edge's mentions array
is **exactly the freshly-extracted set** (replace), mirroring the
delete+insert semantics everywhere else.

**Recommendation**: harness fixture where an existing title edge carries
pre-existing mentions including a stale one; assert the UPDATE statement's
metadata.mentions equals the fresh set exactly. Coherence note for the
lens: title edges keep top-level `confidence: 1`, so any edge-level
confidence threshold treats chapter mentions as confidence-1 — the lens
must filter chapter moments per-mention, or the rollup convention (Q4)
needs a carve-out. (Noise-level, but record it before the lens brief
inherits it.)

### A5: Per-episode tx is mandated by one plan sentence, enforced by nothing — and the promised wipe-canary smoke invariant fell out of the plan

**Tag: risky**

The sentence exists: plan.md:96 "per-episode tx; DELETE … then INSERT" —
so crash-between-DELETE-and-INSERT is specified-safe (atomic rollback,
A1 precedent `sql.begin` at index.mjs:228-235). But the executor is
untested shell by design; no pin, no verify step, no smoke catches an
implementation that runs statements autocommit — under which a crash
between delete and insert leaves an episode with zero extraction edges,
silently, exit-code irrelevant.

The backstop that would catch this (and A1's wipe, and any silent loss)
was panel-1 F3's "every episode with transcripts has extraction-sourced
edges" — it did **not** survive into the plan's smoke-extraction list
(plan.md:150-153). Failure mode 10's "smoke asserts extraction edges
survive a title-load replay" names no implementable invariant: a smoke
can only assert present state, and the presence canary IS the
implementable form. Probe: all 10 episodes have transcripts (2,068–6,030
rows each), so the invariant is well-defined today.

**Recommendation**: (1) restore the per-episode presence invariant to
smoke-extraction verbatim; (2) the feature's verify step must confirm the
executor wraps delete + inserts + title-updates of one episode in a
single `sql.begin` (title updates inside the same tx, or a crash after
insert-commit leaves stale title mentions until re-run — self-healing but
worth one sentence in the runbook); (3) keep SET LOCAL timeouts per A1.

### A6: Nothing binds the eval verdict to the artifacts that load — and no artifact carries an upstream freshness fingerprint

**Tag: risky**

"Checkpoint sits BETWEEN extract and load … no edge ships unevaluated"
(plan.md:136-137) is procedural, not mechanical. Sequences that ship
unevaluated or stale edges with zero errors: re-run extract after the
checkpoint (alias tweak, code fix) then load — the green light covers
artifacts that no longer exist; or `--refresh` re-transcription shifts
every `seq`/`t`, extraction artifacts remain "valid" under skip-if-valid
(validity has no upstream fingerprint), and a later load ships mentions
pointing at the wrong utterances — the lens shows wrong moments with
healthy-looking data.

**Recommendation**: each derived artifact embeds a fingerprint of its
input (transcript: utterance count + duration suffices; artifacts:
content hash); extract-merge refuses on mismatch; the eval artifact
records the `<id>.extraction.json` hash it judged; load-extraction
refuses to load an episode whose extraction hash lacks a matching eval
verdict. Three cheap checks, closes the whole class.

### A7: "Confidence floor + lens threshold" is not a blast-radius argument for in-vocab errors — and the one cheap deterministic gate is missing

**Tag: material** (the missing gate is harness-able and converts
fabricated evidence from sample-detected to fail-closed)

An agent that emits a target that IS in the pool but wrong (Hezekiah for
Sennacherib; alias "Ahas" mapped to the wrong king) passes closed-vocab,
existence, floor, and dedupe. Confidence is the judge's self-report — a
confidently wrong agent sails through floor 0.5 AND any lens threshold,
so those two bound nothing. What actually bounds shipped wrongness:

- **Per-kind precision gates, at sample statistics**: 120 samples split
  across kinds ≈ 30–40 per kind → 95% CI ±~0.10–0.15; true person
  precision ~0.70 can pass the 0.85 gate. The plan already promises
  honest CIs (F6) — honesty acknowledged, but the number is the number.
- **Repetition**: alias-map poisoning is systematic-correlated (one wrong
  variant row × its 47 occurrences — probe 2's density). High-frequency
  systematics very likely hit the stratified sample; a 2–3-occurrence
  wrong mapping evades it with high probability and ships.
- **Structural constraints**: episode-block + verse-existence genuinely
  cage verse/chapter errors (strongest gate, rightly). Persons/places/
  events/principles have no analogous cage.

Missing deterministic gates, both cheap:
1. **Verbatim-quote verification**: principles are the only directly
   agent-judged mention path, carry the weakest gate (0.80), and the plan
   requires each link to cite `seq` + verbatim quote (plan.md:86-87) —
   but extract-merge's validation list (closed-vocab, existence, floor,
   dedupe; plan.md:89-91) never CHECKS the quote. Add to validateMention
   for judged kinds: normalized quote must be a substring of
   utterance(seq ± 1). Fabricated-evidence links then die in code, not in
   a 10% sample. Harness fixture: mention with in-pool target + wrong
   quote → rejected with distinct reason.
2. **Alias-row evidence**: every alias-map row must cite a census token
   (code-checkable: the variant string must actually occur in the
   transcript census that prompted it), and any single alias contributing
   more than N mentions in an episode is force-included in that episode's
   eval sample (frequency-forced sampling turns the correlated failure
   mode into a near-certainly-sampled one).

With those two, the honest blast-radius argument becomes: closed vocab
bounds WHO can be wrong; structure cages verses; quote/census checks cage
fabricated evidence; gates + forced sampling bound the rate. That is
defensible. Floor + lens alone is not.

### A8: Concurrency residuals — no corruption path found

**Tag: noise** (verified, recording the traces)

- Concurrent duplicate A2 invocations, same episode: second tx's DELETE
  blocks/re-evaluates, its INSERT aborts loud on
  `idx_edges_unshaken_unique`, state converges to one winner (agrees with
  panel-1 F5). Advisory lock remains optional polish.
- Repair concurrent with in-flight A1/A2 tx: traced under A3 — skip/miss,
  never corrupt; idempotent re-run heals.
- A1's entity DELETE does not cascade edges (no FK — probed), so
  extraction edges dangle only inside the A1 tx, invisibly. Transcript
  seqs are stable across re-loads while the Deepgram artifact is reused
  (skip-if-valid); only `--refresh` shifts them → handled as A6.
- Neo4j: extraction edges join the documented KNOWN-MISSING class
  (backfill-neo4j-collections.mjs header) — graph-parity gap for a later
  phase, not a write-safety issue. **oos** pointer for the planner.

### A9: Smoke-plan coverage verdict (task-mandated verification)

**Tag: risky** (two of the three asked-about covers have holes)

- **Extraction edges survive title-load replay**: NOT covered as written —
  failure mode 10 promises it, the smoke file spec (plan.md:150-153)
  contains no invariant that could detect a wipe. The implementable form
  is A5's per-episode presence canary + A1's non-empty-chapter-mentions
  check. Both must be added; neither is currently in the plan.
- **typeof invariant**: covered for "everywhere" — make it explicitly
  edges AND entities (the 10 entity rows are half the repair), and add it
  to smoke-media too (A3), or the A1-side recurrence stays masked.
- **Dup-pair check**: covered, and near-tautological while
  `idx_edges_unshaken_unique` stands (probed live) — its real value is
  detecting index absence/drop. Keep; costs nothing.
- Adjacent gap: panel-1 F7's kind-aware target resolution (entity targets
  → lumen.entities, chapter → lumen.chapters) was only partially adopted —
  plan.md:151-152 names verse resolution alone. With no FKs on edges,
  per-kind resolution is the only orphan detector; restore F7's full form.

## Panel-1 disagreements

1. **F5's fetch recommendation causes A2's worst data-loss** ("Fetch ALL
   existing (to_id, rel_type) … with no metadata predicate"). Literal
   adoption misclassifies run-1 extraction edges as title edges on every
   re-run → silent wipe (my A2). The correct form is their own F4
   primitive: no METADATA predicate, yes COLUMN predicate
   (`source = 'unshaken-youtube'`). Amend F5 before an implementer follows
   it.
2. **F5's "jsonb merge, not whole-object replace"** is unsafe pre-repair:
   `||` on the live string-typed rows silently produces jsonb ARRAYS
   (probed, A3). Unknown-key preservation is theoretical today (only
   source/confidence/mentions exist); whole-object build behind A3's
   typeof preflight is the safer default. If merge semantics are ever
   needed, they must sit behind the preflight.
3. **F3's option (a) self-cancels as worded** — "scope A1's delete by its
   own source AND make its title-edge insert ON CONFLICT preserve
   mentions": the source-scoped delete removes the conflict row, so the
   preservation never fires (my A1). The intent is right; the mechanism
   must be upsert-only + stale-anchor-only delete. The plan copied the
   flawed literal form into Revision 1.
4. Reconfirmed and relied upon: F1 (184+10 string rows, unshaken-only),
   F2 (`2-kgs-14-3` shape), F4 (source column intact and queryable), F5's
   crash-mid-tx atomicity (with A5's enforcement caveat), F8 (id-set
   existence checks).

## Verdict

**NOT approved as written.** Panel-1's F1–F4 amendments were necessary and
the plan absorbed them — but Revision 1 introduced three new loss/corruption
paths of its own, all invisible to the amended harness: the A1 co-fix
self-cancels and weekly re-runs still reset title mentions (A1); an
unpinned classification fetch makes A2's own re-run silently destroy its
extraction edges, with panel-1's F5 wording actively steering implementers
into it (A2); and repair ordering is unenforced while one plausible
title-UPDATE implementation silently corrupts unrepaired rows into jsonb
arrays (A3). A7's missing quote/census verification is the cheap gate that
makes the eval's blast-radius story honest. All fixes are plan-text +
harness-fixture changes, cheap while both drift hashes are PENDING.
Approvable after: A1 (upsert-only + stale-anchor delete + ingest-podcast
test amendments), A2 (source-filtered fetch, exported+pinned SQL, rowCount
assert), A3 (typeof preflight in load-extraction + smoke-media invariant),
A7 (quote-at-seq + alias census checks), A5/A9 (presence canary +
non-empty-chapter-mentions + kind-aware resolution restored to the smoke
list). A4/A6 are strongly recommended riders in the same edit.
