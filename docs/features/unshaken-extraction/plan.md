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
  cites `seq` + verbatim quote). Journaled resume = per-agent retry native;
  session pays tokens, dollars = $0 external.
- **Stage extract-merge (node, deterministic)**: judgment artifacts
  (`<id>.judgment.json`) + code extraction → closed-vocab validation,
  existence checks, confidence floor 0.5, ±5s dedupe, aggregation to one
  edge per (episode, target, rel_type) with `mentions: [{t, seq,
  confidence}]` sorted by t. DISCUSSES (verses/chapters) · MENTIONS
  (persons/places/events) · TEACHES (principles). Emits
  `<id>.extraction.json` + eval sample (+ traps, sample-only).
- **Load (source-column scoping — panel F4 refuted the jsonb-path premise)**:
  per-episode tx; DELETE `WHERE from_id AND collection_id AND
  source='unshaken-extraction'` (first-class column, never jsonb paths), then
  INSERT new pairs with `source='unshaken-extraction'`; existing
  title-sourced (`source='unshaken-youtube'`) chapter edges get mentions
  UPDATED in place (partial unique index makes the aggregated-edge rule
  DB-enforced). Batched statements, SET LOCAL guards, house logging.
- **A1 repair + co-fixes (panel F1/F3, verified against prod)**:
  1. *Double-encoding repair*: all 184 edges + 10 entities carry jsonb STRING
     scalars (`index.mjs:232` pre-stringify before `unsafe()`); fix the
     executor to serialize exactly once, ship a one-time
     `(metadata #>> '{}')::jsonb` unwrap migration, and pin
     `jsonb_typeof='object'` in smoke (A1's parse-if-string was masking this
     — keep it as defense, add the invariant so masking can't recur).
  2. *Re-run safety*: A1's load delete becomes source-aware
     (`source='unshaken-youtube'` only) and its title-edge insert preserves
     existing mentions on conflict — a weekly A1 re-run must never wipe A2
     extraction edges or reset mention arrays.
- **Cost**: $0 external. Corpus ground truth 577k transcript tokens (panel
  measurement); agent windows sized half-episode so the workflow stays
  ~40–50 agent calls total.

## Eval + checkpoint (the load-bearing wall)

- **Stratified sample**: 12 mentions/episode (120 total) across kinds,
  emitted as a human-checkable artifact: `{episode, t, quote, claimed
  target, transcript context ±2 utterances}`.
- **Seeded traps**: 12 fabricated mentions (wrong verse / wrong person /
  plausible-but-absent principle) injected into the SAMPLE ONLY; the
  checkpoint reviewer (fresh-context agent + me) must catch ≥11/12 or the
  eval itself is suspect (strongs seeded-trap lesson).
- **Precision gate, per kind** (panel F6 — pooled gates mask weak strata):
  verse/chapter ≥0.90 · person/place/event ≥0.85 · principle ≥0.80, each
  reported with its 95% CI honestly stated (small-n limits acknowledged, not
  laundered). Below gate: one iteration round, re-eval; still below → ship
  edges with `confidence` intact, lens = fast-follow (design's in-scope-if).
- **Traps are near-misses** (panel F7): wrong-but-EXISTING verse, ASR-variant
  name mapped to the wrong person, plausible-but-absent principle — mirrors
  of the real failure modes, not strawmen.
- **Recall is unmeasured and the artifact says so** (panel F8), plus a free
  coverage ratio (alias-hit count vs emitted mentions) as a drift canary.
- Checkpoint sits BETWEEN extract and load (design §workflow) — no edge
  ships unevaluated.

## Files touched

- `scripts/ingest-podcast/extract.mjs` (new — passes 1+2, chunking, batch
  client, aggregation; pure cores + shell per portability invariants)
- `scripts/ingest-podcast/extract-lib.mjs` (new — pure: chunking, candidate
  prefilter, ref resolution, dedupe/merge, trap seeding, sample selection)
- `scripts/ingest-podcast/load-extraction.mjs` (new — edge upsert/update plan
  builder + executor; buildExtractionLoadPlan pure)
- `scripts/ingest-podcast/index.mjs` (edit — `--stage=extract|load-extraction`
  wired into STAGES whitelist + prereqs)
- `scripts/__tests__/ingest-extraction.test.mjs` (new harness)
- `scripts/smoke-extraction.mjs` (new — live invariants: no dup pairs, all
  verse targets resolve (`2-kgs-14-3` shape — panel F2), mentions
  sorted/valid, title edges retain confidence-1 anchor,
  `jsonb_typeof(metadata)='object'` everywhere, per-kind counts)
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
  panel F6-adjacent). Q5 chapter-edge mentions: UPDATE title edges in place
  (design §rules-3).

## Abram-tasks

- None. (ANTHROPIC_API_KEY task removed by Revision 1 — no external APIs.)

## Drift baseline (stamped end of step 6)

Method: harness-hash = `shasum -a 256 scripts/__tests__/ingest-extraction.test.mjs`;
plan-hash = `sed '/^## Drift baseline/,$d' docs/features/unshaken-extraction/plan.md | shasum -a 256`.

- plan-hash: PENDING
- harness-hash: PENDING
