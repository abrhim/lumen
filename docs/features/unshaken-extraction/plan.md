# Plan — unshaken-extraction (Phase A2)

Design input: [docs/design/media-collections.md](../../design/media-collections.md)
§rules-3/4 (aggregated edges, mentions, lens). Builds on A1's shipped data.
**Gates 1b + 7 WAIVED by Abram, verbatim: "Do A2 all the way through. THen do
B."** (supabase-auth precedent). Open questions carry PROPOSED DEFAULTS,
chosen and recorded rather than asked.

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
5. **API mechanics verified via claude-api skill**: Batch API = 50% off all
   tokens, 100k requests/batch, ~1h typical completion, all Messages features
   incl. structured outputs; model claude-opus-4-8 ($5/$25 → $2.50/$12.50
   batched); `output_config.format` json_schema (strict) guarantees parseable
   output. Adaptive thinking explicit on Opus 4.8; effort tunable per chunk.

## Design

**Two-pass extraction, code-heavy by construction** (LLM does judgment, code
does bookkeeping — the closed-vocab discipline):

- **Pass 1 — chapter timeline** (1 request/episode, full-transcript sweep of
  explicit chapter transitions): emits `[{t_start_s, chapter}]` segments.
  Cheap, and it mechanically solves the anaphora problem: pass 2 chunks are
  stamped with their governing chapter context.
- **Pass 2 — moment extraction** (chunked): utterance windows ~50 utterances
  w/ 10-utterance overlap, each line `[seq @ mm:ss] text`. Prompt carries:
  the chunk's chapter-context (from pass 1), the episode block, CODE-PREFILTERED
  candidates (persons/places/events whose names appear in the chunk text —
  typically 5–20) + the FULL principle pool (42; thematic linking can't be
  name-matched), and the strict output schema. Output per mention:
  `{kind: verse|chapter|person|place|event|principle, target_hint, seq, t,
  confidence, quote}` — verse targets as `{chapter_ctx, verse_num}` resolved
  to spine ids IN CODE with existence validation (fail-closed drop + log).
- **Aggregation (code)**: dedupe overlap-window duplicates (same target within
  ±5s), merge to one edge per (episode, target, rel_type) with
  `mentions: [{t, seq, confidence}]` sorted by t. rel_types: DISCUSSES
  (verses/chapters), MENTIONS (persons/places/events), TEACHES (principles) —
  all in vocab.
- **Load (reuses A1 patterns)**: per-episode tx; DELETE extraction-sourced
  edges (`metadata->>'source' = 'extraction'`) scoped by episode+collection,
  then INSERT new pairs; existing title-sourced chapter edges get their
  mentions arrays UPDATED in place (the partial unique index FORBIDS duplicate
  pairs — the aggregated-edge design is now DB-enforced). Batched statements,
  SET LOCAL guards, summary counts, house logging.
- **Batch mechanics**: `@anthropic-ai/sdk` (new root devDep) from the .mjs
  stage; requests keyed `custom_id = <episodeId>:<pass>:<chunkSeq>` (results
  arrive in ANY order — key, never position); poll until `ended`; artifacts
  `<id>.extraction.json` cached on disk (skip-if-valid like every stage);
  model claude-opus-4-8, `thinking: {type: "adaptive"}`, effort swept on the
  eval sample (start medium), strict json_schema output.
- **Cost estimate**: prefiltered prompts ≈ 250–400k input + ~150k output
  total → **≈ $6–10 batched**. Logged per-batch from usage fields.

## Eval + checkpoint (the load-bearing wall)

- **Stratified sample**: 12 mentions/episode (120 total) across kinds,
  emitted as a human-checkable artifact: `{episode, t, quote, claimed
  target, transcript context ±2 utterances}`.
- **Seeded traps**: 12 fabricated mentions (wrong verse / wrong person /
  plausible-but-absent principle) injected into the SAMPLE ONLY; the
  checkpoint reviewer (fresh-context agent + me) must catch ≥11/12 or the
  eval itself is suspect (strongs seeded-trap lesson).
- **Precision gate**: ≥0.90 verse/chapter anchors, ≥0.85 entity links on the
  clean sample → lens green-light recorded for Phase B. Below gate: one
  prompt-iteration round permitted, then re-eval; still below → ship edges
  with `confidence` intact but record lens = fast-follow (design's in-scope-if).
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
  verse targets resolve, mentions sorted/valid, title edges retain
  confidence-1 anchor, per-kind counts)
- `package.json` (+`@anthropic-ai/sdk`)

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
9. Secrets: ANTHROPIC_API_KEY via root .env, header-only, scrubbed. (H9.)

## Open questions (defaults RECORDED, gate waived)

- Q1 effort level: **medium**, swept against the eval sample before the full
  batch. Q2 chunk size: **50/10 overlap**. Q3 principle linking: full-pool
  thematic (accept lower precision, gate at 0.85). Q4 confidence floor for
  DB write: **0.5** (below = dropped + logged; lens filters at higher). Q5
  chapter-edge mentions: UPDATE title edges in place (design §rules-3).

## Abram-tasks

- `ANTHROPIC_API_KEY` into root `.env` before the batch run (same pattern as
  DEEPGRAM_API_KEY; needed at stage-extract time, can land mid-flight).

## Drift baseline (stamped end of step 6)

Method: harness-hash = `shasum -a 256 scripts/__tests__/ingest-extraction.test.mjs`;
plan-hash = `sed '/^## Drift baseline/,$d' docs/features/unshaken-extraction/plan.md | shasum -a 256`.

- plan-hash: PENDING
- harness-hash: PENDING
