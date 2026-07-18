# Plan — unshaken-extraction (Phase A2)

Design input: [docs/design/media-collections.md](../../design/media-collections.md)
§rules-3/4 (aggregated edges, mentions, lens). Builds on A1's shipped data.
**Gates 1b + 7 WAIVED by Abram, verbatim: "Do A2 all the way through. THen do
B."** (supabase-auth precedent). Open questions carry PROPOSED DEFAULTS,
chosen and recorded rather than asked.

**REVISION 1 (2026-07-18), Abram, verbatim: "you are not to use the anthropic
or any api" + "you are to exclusively use the claude code workflows nad sub
agents to run ai enrichment."** Batch-API design replaced by §Design below;
original API probe (item 5) retained for the record, superseded.

## Tier

**standard** — axes: behavior change (prod edges + mentions), external
dependency (Anthropic Batch API), data writes to shared knowledge layer.
No schema migration (A1's tables suffice). Panels: 3 combined briefs + 2
adversarial (art-graph economy).

## Goal

Timestamped semantic moments for all 10 episodes: verse/chapter anchors and
person/place/event/principle links with `{t, seq, confidence}` mentions, at
measured precision that green-lights the lens — via a resumable extract stage
that reuses A1's pipeline shell.

## Probe results (2026-07-17, live artifacts + prod)

1. **Transcripts**: 10 verbatim Deepgram artifacts (100MB). Utterances carry
   WORD-level `{word, start, end, confidence, punctuated_word}` — mentions can
   anchor to the word. Sample episode: 3,045 utterances / 36k words / avg 12
   words per utterance.
2. **Spoken refs are dense and anaphoric**: 148 "verse N" + 33 "chapter N" in
   ONE episode ("Let's start with verse three… Now verse four") — chapter
   context carries forward across many verse mentions. Extraction MUST resolve
   refs against a chapter-context timeline, not per-utterance.
3. **Proper-noun quality story-consistent** (Sennacherib 8× in the Assyria
   episode; Naaman 0× — he's the previous episode). Keyterm boost worked.
4. **Candidate pools per episode are rich but bounded**: sample episode at
   verse granularity: 154 persons, 85 events, 79 places, 42 principles,
   5 symbols (~365 entries). Name-prefiltering per chunk (code-side) keeps
   prompts lean.
5. ~~API mechanics verified via claude-api skill (Batch API 50%, opus-4-8,
   strict json_schema)~~ — **SUPERSEDED by Revision 1**; retained for the
   record. One durable takeaway: json-schema numeric ranges are unenforceable
   → confidence bounds validated in code (harness H4 already pins this).
6. **Real corpus measurement** (pipeline-reliability panelist, live artifacts):
   577k transcript tokens total; naive 50/10 chunking = 988 windows. Agent
   window sizing must be far coarser than API-chunk sizing.

## Design

**Deterministic code extracts; Claude Code workflow judges** (Revision 1 —
the closed-vocab discipline taken to its conclusion: code does everything
mechanical; in-session subagents do only what needs judgment; zero external
API calls).

- **Stage extract-code (node, deterministic)**:
  1. *Timeline candidates*: transition markers incl. the inline-entry form
     panel F2 verified ("In verse three of second Kings 21" enters ch 21
     without an announcement) — patterns: "chapter N", "<book> N", "of
     <book> N"; digits AND number-words. Segments `{t, chapter, evidence}`.
  2. *Foreign-ref windows* (panel F3): explicit cross-book citations
     (2 Chr 28, Helaman 8, Isaiah) open tangent segments; bare verse refs
     inside them are logged + dropped in v1 (episode-block constraint holds;
     cross-book anchoring = recorded fast-follow).
  3. *Verse refs*: digits + number-words + ranges ("from verse four to verse
     24", elided "verse twenty one and two" = 21–22; panel F5), resolved
     against the governing segment; **t always recomputed from the cited
     utterance's start — never trusted from a model** (panel F4). Timestamps
     h:mm:ss beyond 60m (3.6h episodes).
  4. *Entity mentions*: ALIAS-AWARE matcher (panel F1: Deepgram writes
     "Ahas" 47×, "Ahaz" 0× — exact match misses the episode's main figure).
     Alias tables are judgment-produced (below), then matching is code with
     word boundaries.
  5. Emits `<id>.extraction-code.json` + `<id>.judgment-brief.json`
     (timeline + tangent windows + unknown-capitalized-token census +
     principle brief + flagged ambiguities). Skip-if-valid per artifact.
- **Enrichment workflow** (`.claude/workflows/unshaken-enrichment.mjs`, run
  via the Workflow tool per Abram's directive — subagents only, no API):
  phase *alias-map* (10 small agents: pool names × transcript token census →
  variant map), phase *timeline-review* (10 agents verify/correct segments
  against the transcript, esp. inline entries + tangents), phase *principles*
  (~2 agents/episode over half-episode windows, structured output, each link
  cites `seq` + verbatim quote). Every judgment agent's output persists as
  its own artifact (`<id>.aliases.json` · `<id>.timeline-review.json` ·
  `<id>.principles.<w>.json`) with a validity predicate — parses,
  schema-shaped, coverage matches a deterministic recompute (EV-A12);
  skip-if-valid per artifact = FILE-based resume primary, workflow
  journaling a bonus. Agents receive briefs + transcript slices only —
  never plan.md, never each other's rationales. Session pays tokens,
  dollars = $0 external.
- **Stage extract-merge (node, deterministic)**: judgment artifacts + code
  extraction → closed-vocab validation, existence checks, confidence floor
  0.5, ±5s dedupe, PLUS the two deterministic gates that cage in-vocab
  hallucination (PW-A7): **verbatim-quote-at-seq verification** for judged
  kinds (normalized quote must appear in utterance(seq±1) — fabricated
  evidence dies in code, not in a 10% sample) and **alias-census
  verification** (every alias row cites a real census token; any alias
  contributing >N mentions is force-included in the eval sample).
  Aggregation to one edge per (episode, target, rel_type) with
  `mentions: [{t, seq, confidence}]` sorted by t + edge-level max-confidence
  rollup. DISCUSSES (verses/chapters) · MENTIONS (persons/places/events) ·
  TEACHES (principles). Emits `<id>.extraction.json` (+ separate eval-sample
  file the load path never reads).
- **Load (source-column scoping — panel F4 refuted the jsonb-path premise;
  hardened per prod-write A1–A5)**: ONE tx per episode (verified at review):
  1. *Preflight opens the plan* (A3): `assert-metadata-repaired` — zero
     string-typed metadata rows (edges AND entities) for the collection, or
     abort loud "run repair-metadata-encoding first". Live-probed: a merge
     UPDATE on an unrepaired row silently makes jsonb ARRAYS.
  2. *Classification fetch is exported + pinned* (A2): `EXISTING_EDGES_SQL`
     filters `source='unshaken-youtube'` — ONLY title edges are update
     candidates; extraction-sourced pairs always classify INSERT. Executor
     asserts rowCount===1 on every title UPDATE (residual misclassification
     aborts loud, never silent 0-row).
  3. DELETE `WHERE from_id AND collection_id AND source='unshaken-extraction'`
     → INSERT new pairs (`source='unshaken-extraction'`).
  4. *Title UPDATE builds the WHOLE metadata object* (never `||`/jsonb_set)
     and REPLACES mentions with exactly the fresh set (A4 — append would
     double per re-run and make stale wrong-alias mentions immortal).
     Title edges keep top-level confidence 1; lens filters chapter moments
     per-mention (rollup carve-out recorded for the Phase-B brief).
  5. Batched statements, SET LOCAL guards, house logging.
- **A1 co-fix corrected (prod-write A1 — the Revision-1 wording
  self-cancelled: source-aware delete removed the row before ON CONFLICT
  could preserve it)**: A1's title-edge write becomes UPSERT-ONLY arbitrated
  on the partial unique index, `DO UPDATE` preserving existing mentions via
  object-guarded COALESCE; A1's edge delete shrinks to STALE ANCHORS only
  (`source='unshaken-youtube' AND to_id != ALL(chapterIds)`).
  `ingest-podcast.test.mjs` is amended in this feature — its current pins
  encode the old wiping behavior.
- **A1 double-encoding repair (panel F1, mechanics per EV-A11/PW-A3)**: all
  184 edges + 10 entities carry jsonb STRING scalars (`index.mjs:232`
  pre-stringify before `unsafe()`). Repair migration: DRY_RUN phase
  `JSON.parse`s every string row in JS asserting object-typeof (abort with
  row ids otherwise); unwrap `(metadata #>> '{}')::jsonb` in a LOOP until
  zero string rows (double-wrap defense), scoped
  `collection_id='unshaken' AND jsonb_typeof='string'` on BOTH tables;
  idempotent (probed: unwrap is a no-op on objects). Executor fix audits
  every A1 statement kind's value types (the :232 change touches ALL object
  serialization, not just metadata) — pinned in the A1 harness. Repaired
  state is a load prereq via the plan preflight; typeof invariant lands in
  BOTH smokes (parse-if-string stays as defense, can no longer mask).
- **Cost**: $0 external. Corpus ground truth 577k transcript tokens (panel
  measurement); agent windows sized half-episode so the workflow stays
  ~40–50 agent calls total.

## Eval + checkpoint (the load-bearing wall)

Hardened per panel-2 eval-validity (A1–A7) — under Revision 1 re-runs are
free, which removes every excuse for a weak gate:

- **Allocation by KIND, not episode** (A5): verse/chapter ≥60 ·
  person/place/event ≥60 (per-kind sub-floors 15) · principle ≥40. Traps +
  golds ride ON TOP of target n. Deterministic under recorded rng; seed =
  extraction-artifact hash + round number.
- **Independent-evidence packets per kind** (A1 — canon is ground truth the
  extractor never conditioned on): verse/chapter items carry the claimed
  verse's CANON TEXT + the same verse number's text in every other block
  chapter + the nearest preceding /chapter|kings|section/i utterance picked
  by code; entity items carry canonical name + description + episode roster
  (narrative-consistency check, not name re-derivation); principle items
  carry the definition + rubric: "the quote must contain the teaching, not
  merely the topic word." Correctness = target identity; anchor offsets
  >30s tracked as a separate count, not precision failures.
- **Traps are target-swapped REAL mentions** (A2): quote/t/seq verbatim from
  a real extracted mention, only the target swapped to the near-miss shapes
  (wrong-but-existing verse under an adjacent chapter, wrong-king alias,
  plausible-but-absent principle). Count varies 10–14 drawn from the seed;
  the answer key is NEVER persisted — recomputed from the seed at scoring
  time; the sample artifact is stripped and shuffled; `load-extraction`
  structurally never reads the sample file.
- **Golds** (A3): ~4 known-correct items (title-derived chapter pairs,
  correct by construction). Golds rejected = evaluator over-strict; traps
  missed = evaluator lenient. Both reported.
- **Evaluator mechanics** (A3): Read-only evaluator agents spawned from a
  version-controlled, hash-pinned prompt file (`eval-prompt.md`; hash joins
  the drift baseline) taking exactly one parameter (packet path); packets
  are self-contained (no plan.md, no judgment artifacts); REFUTE-framing
  ("find the error; state falsifying evidence; only then verdict"); sharded
  ~10–15 items/agent with ~10% cross-shard duplicate items (inter-shard
  disagreement = ungameable diligence signal); judgment and eval phases use
  different models where available. "Me" is excluded from the catch jury;
  scoring is CODE against the recomputed key.
- **Gate rule, recorded** (A5): per kind, pass = point ≥ gate AND Wilson 95%
  LB ≥ gate − 0.08 AND n ≥ 30 (principle: n ≥ 25). Anything else = NOT
  EVALUABLE → targeted oversample, never a pass. Per-kind trap floor (A4):
  ≥2 missed traps of one kind VOIDS that kind's number (fix eval mechanics,
  re-run — not "iterate the extractor"). The artifact reports, per kind:
  n, correct, point, Wilson CI, per-episode n×correct matrix, trap catch,
  gold acceptance, seed, evaluator model + prompt hash.
- **Iteration protocol** (A6): fixes touch extractor code / prompts / alias
  tables ONLY — never individual mentions. Re-eval = full re-extract →
  fresh sample, seed, traps, evaluator agents. Round-1 verdicts are
  diagnosis inputs, never grading inputs.
- **Run-time coverage block** (A7 — novel variants surface at extract time,
  not eval time): every judgment brief carries block chapters with ZERO
  timeline segments (loud per-episode fail), existence-failure CLUSTERS
  (mis-stamped-segment alarm upgrading H3 to a detector), unmatched
  capitalized-head+number bigrams ("Helaman 8", "section 8"), unparsed
  relative-ref counts ("next verse" 52× corpus-wide), % utterances inside
  foreign windows (>15% alarms — A8). `bookAliases`/`foreignBooks` are
  DERIVED from the canonical book list in packages/scripture + container
  nouns (chapter|section|psalm) — never per-episode hand maps.
- **Checkpoint is mechanical, not procedural** (prod-write A6): every
  derived artifact embeds an upstream fingerprint (transcript = utterance
  count + duration; others = content hash); extract-merge refuses on
  mismatch; the eval verdict records the extraction-artifact hash it
  judged; load-extraction refuses any episode whose extraction hash lacks
  a matching eval verdict. Recall stays honestly unmeasured, stated in the
  artifact, with the alias-hit vs emitted-mentions coverage ratio as canary.

## Files touched

- `scripts/ingest-podcast/extract.mjs` (new — deterministic extract-code +
  extract-merge stages, judgment-brief builder + judgment-artifact assembly;
  pure cores + shell per portability invariants; NO API client of any kind)
- `scripts/ingest-podcast/extract-lib.mjs` (new — pure: chunking, candidate
  prefilter, ref resolution, dedupe/merge, trap seeding, sample selection)
- `scripts/ingest-podcast/load-extraction.mjs` (new — edge upsert/update plan
  builder + executor; buildExtractionLoadPlan pure)
- `scripts/ingest-podcast/index.mjs` (edit — `--stage=extract|load-extraction`
  wired into STAGES whitelist + prereqs)
- `scripts/__tests__/ingest-extraction.test.mjs` (new harness)
- `scripts/smoke-extraction.mjs` (new — live invariants: every episode with
  transcripts HAS extraction-sourced edges (wipe canary — PW-A5); chapter
  edges of extracted episodes carry non-empty mentions (reset canary —
  PW-A1); KIND-AWARE target resolution — verses→lumen.verses,
  chapters→chapters, entities→entities (F7 full form; edges have no FKs);
  no dup pairs; mentions sorted/valid (`2-kgs-14-3` shape — F2); title
  edges retain confidence-1 anchor; `jsonb_typeof(metadata)='object'` on
  edges AND entities; per-kind counts)
- `scripts/smoke-media.mjs` (edit — typeof invariant added so A1's own
  smoke stops masking A1's bug class — PW-A3)
- `scripts/__tests__/ingest-podcast.test.mjs` (edit — A1 co-fix pins:
  upsert-preservation clause, stale-anchor-only delete, per-kind statement
  serialization audit — PW-A1/EV-A11)
- `docs/features/unshaken-extraction/eval-prompt.md` (new — hash-pinned
  evaluator prompt, EV-A3)
- `scripts/repair-metadata-encoding.mjs` (new — one-time unwrap migration,
  DRY_RUN default + invariants, house migration style)
- `scripts/ingest-podcast/index.mjs` (edit — also FIX the double-encoding
  executor at :232) · `scripts/ingest-podcast/load.mjs` (edit — source-aware
  delete + mentions-preserving title upsert)
- `.claude/workflows/unshaken-enrichment.mjs` (new — the AI-enrichment
  workflow definition; repo-canonical for per-show reuse)

## Failure modes (each → harness assertion)

1. Chapter-context misassignment at chunk boundaries → wrong verse ids.
   (H1: timeline→chunk stamping fixtures incl. mid-chunk transitions.)
2. Overlap-window duplicate mentions inflate edges. (H2: dedupe ±5s fixtures.)
3. Verse target outside episode block or nonexistent (chapter 13 verse 99) →
   fail-closed drop with log, never a bad edge. (H3.)
4. Extraction invents a candidate not in the pool → rejected in code. (H4:
   closed-vocab enforcement on target ids.)
5. Batch results misordered/partial → keyed by custom_id; missing chunk =
   episode incomplete → episode fails, siblings continue. (H5.)
6. Load collides with title edges on (episode, chapter) pairs → UPDATE path,
   not INSERT; unique-index conflict = test-pinned. (H6.)
7. Re-run duplicates extraction edges → delete-by-source idempotency. (H7.)
8. Trap leakage: seeded traps must NEVER reach the load path. (H8: seeding is
   sample-artifact-only by construction; test pins it.)
9. Secrets: no new secrets under Revision 1; DSN scrubbing discipline stands.
   (H9 retained as generic scrubber coverage.)
10. A1 weekly re-run wipes A2 edges / resets mentions (panel F3) → A1 load
    co-fix; smoke asserts extraction edges survive a title-load replay.
11. Double-encoded jsonb recurs via a second stringify path (panel F1) →
    F1-regression harness pin (builder emits objects) + smoke typeof
    invariant.

## Open questions (defaults RECORDED, gate waived)

- Q1 ~~effort level~~ (moot under Revision 1) → agent window: **half-episode
  per principles agent** (~2/episode). Q2 merge-window: **±5s dedupe** (50/10
  chunking survives only as the merge granularity for code extraction). Q3
  principle linking: full-pool thematic, own gate **0.80**. Q4 confidence
  floor for DB write: **0.5** (below = dropped + logged; lens filters
  higher; edge stores max-confidence rollup for cheap lens filtering —
  panel F6-adjacent; title edges' confidence-1 gets a per-mention lens
  carve-out, recorded for the Phase-B brief). Q5 chapter-edge mentions:
  UPDATE title edges in place, REPLACE semantics (PW-A4). Q6 foreign-window
  close (EV-A8): first in-block explicit chapter/verse-with-book ref OR 15
  consecutive utterances without foreign-book tokens, whichever first;
  per-window durations reported in the coverage block.

## Abram-tasks

- None. (ANTHROPIC_API_KEY task removed by Revision 1 — no external APIs.)

## Decisions (synthesis, 2026-07-18)

Precedence human > panel-2 > panel-1 applied throughout; Abram's Revision-1
directives govern everything. Labels: INC = incorporated · INC-MOD =
incorporated as modified · REJ = rejected with rationale · MOOT = rejected
as mooted by Revision 1 · NOISE · OOS.

**llm-extraction-quality**: F1 alias layer INC (+EV-A10 validation) · F2
inline entries INC · F3 tangent windows INC (+Q6 close default, section
support) · F4 t-from-seq INC (code recomputes; h:mm:ss) · F5 ranges INC
(+through/elision fixtures) · F6 per-kind gates INC-MOD (allocation ≥60/60/40
+ explicit pass rule; EV-D2 dissolved the n=120 human-sitting ceiling) · F7
near-miss traps INC-MOD (target-swaps of REAL mentions; EV-A2 proved
fabricated traps self-identify) · F8 honest-recall INC.

**data-integrity**: F1 double-encoding INC (repair + executor fix + dual
typeof invariants; mechanics EV-A11) · F2 id shape INC (fixtures corrected)
· F3 re-run wipe INC-MOD (upsert-only + stale-anchor delete; PW-A1 proved
the literal wording self-cancels) · F4 source column INC · F5 INC-MOD
(fetch is source-FILTERED + pinned + rowCount-asserted; PW-D1: the
no-predicate wording causes run-2 data loss; jsonb-merge preference REJ
pre-repair — live probe: `||` on string rows makes arrays) · F6 rollup INC
(Q4 + lens carve-out) · F7 kind-aware resolution INC (full form) · F8 INC.

**pipeline-reliability**: F1/F2 batch persistence/retry MOOT (durable-raw
spirit survives as per-agent judgment artifacts, EV-A12) · F3 artifact
split + validity INC (re-targeted) · F4 corpus ground truth INC (577k
tokens; sizing) · F5 key scrubbing MOOT (no key exists) · F6 poll contract
MOOT · F7 SDK interop MOOT (SDK removed) · F8 checkpoint enforcement INC
(mechanical hash-bound gate, PW-A6 + --episode scoping).

**eval-validity (panel-2)**: A1 evidence packets INC · A2 trap rework INC
(harness re-pinned) · A3 evaluator mechanics INC (all seven; model
diversity where available) · A4 per-kind trap floors INC · A5 gate rule
INC verbatim · A6 iteration protocol INC · A7 coverage block + derived
book maps INC · A8 Q6 DEFAULT RECORDED · A9 pre-segment flip INC (harness
re-pinned) · A10 alias validation INC · A11 repair mechanics INC · A12
file-based resume INC · A13 clerical purge INC · A14 NOISE · A15 OOS.

**prod-write-safety (panel-2)**: A1 upsert-only co-fix INC (+ingest-podcast
pin amendments) · A2 fetch filter + pin + rowCount INC · A3 preflight +
whole-object + smoke-media invariant INC · A4 replace semantics INC
(pinned) · A5 presence canary + tx verify INC · A6 fingerprints +
hash-bound checkpoint INC · A7 quote-at-seq + alias-census +
frequency-forced sampling INC · A8 NOISE (traces verified clean; advisory
lock optional polish; Neo4j parity OOS → graph-membership feature) · A9
smoke restoration INC.

Cross-panel: EV-D4 dedupe stays ±5s (Q2 — seq-native equivalence noted,
not worth churn) · EV-D2/D3 resolved for panel-2 per precedence, evidence-
backed · PW-D1/D2/D3 resolved for panel-2 (live probes beat wording).

## Drift baseline (stamped end of step 6, 2026-07-18)

Method: harness-hash = `shasum -a 256 scripts/__tests__/ingest-extraction.test.mjs`;
plan-hash = `sed '/^## Drift baseline/,$d' docs/features/unshaken-extraction/plan.md | shasum -a 256`;
eval-prompt-hash = `shasum -a 256 docs/features/unshaken-extraction/eval-prompt.md`.

- plan-hash: 1bde04199976a6d1e847fbfbca12f4736d2ac9dd3000bb707bcde04eea7a286f
- harness-hash: 956dda31052f638e8050d564d8f6e7138ed86cbe80ba9fce09c4073fa194f6eb
- eval-prompt-hash: beddaa88feddea01bedfdaeaeb519e9fb536ce440bae686e7c223131822be0f5
