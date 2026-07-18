# Bugs — unshaken-extraction (A2)

Source: code-review workflow (160 agents: 4 coverage-first finders → 2
adversarial verifiers per finding). 78 found · 71 confirmed (7 high / 26
med / 38 low) · 7 killed. Full adjudicated list:
[reviews/code-adversarial/confirmed.json](reviews/code-adversarial/confirmed.json).
Prod spot-check before triage: ZERO out-of-block chapter edges shipped
(the F3 vulnerability never materialized in data).

## Bucket: FIX (this round)

High:
- **F1** eval-verdict gate races the load — `fatal()` is non-terminating,
  execution falls through into the episode loop (index.mjs:336/337, two
  findings, one root).
- **F2** `seedTraps` infinite-loops when trap count ≥ mention count
  (extract-lib.mjs:444).
- **F3** agent timeline-review artifact trusted verbatim — out-of-block /
  malformed segments become 0.95 chapter edges (extract.mjs:120).
- **F4** eval answer-key recomputation depends on un-fingerprinted live DB
  + episodes.json — silent key divergence between build and score
  (extraction-eval.mjs:313).
- **F5** `--build` never purges stale shard verdicts — rebuilt round
  silently scores old verdicts (extraction-eval.mjs:261).
- **F6** golds not correct-by-construction — no number-to-target check
  (extraction-eval.mjs:121).

Med (material+material unless noted):
- **F7** stale STAGES whitelist pin — A1 harness fails 1/53 on branch.
- **F8** hash-binding passes vacuously when contentHash + verdict entry
  both absent (undefined !== undefined).
- **F9** A1 upsert never repairs `source` — chimera row self-perpetuates,
  later A2 delete destroys a title anchor (load.mjs:137).
- **F10** repair dry-run admits arrays as "objects" + never validates
  inner layers of double-wrapped rows (repair-metadata-encoding.mjs:61/63).
- **F11** `verifyQuoteAtSeq` passes empty/punctuation-only quotes —
  PW-A7 gate bypass.
- **F12** foreign-book "chapter N" citations create false in-block
  timeline segments (extract-lib.mjs:125); Q6 close-condition gap folded
  in (extract-lib.mjs:226).
- **F13** `validateAliasTable` throws TypeError on malformed rows.
- **F14** cross-set alias collision unrouted (agent alias == another
  entity's base name double-matches).
- **F15** elided-pair heuristic fabricates wide ranges — constrain to
  end === start+1 ("twenty one and two" stays; "thirty and five" splits).
- **F16** null/malformed judgment principle entries crash the merge.
- **F17** trap floor per-STRATUM, plan requires per-KIND + entity
  sub-floors (n≥15) (extraction-eval.mjs:367/25).
- **F18** shard verdicts schema-unvalidated; missing verdicts shrink n
  (selective laziness inflates precision) — score now REFUSES on missing/
  invalid sample verdicts.
- **F19** harness pins seedTraps/stratifiedSample but the real eval path
  is deriveRound — pin deriveRound (determinism, no key leak, trap
  indistinguishability).
- **F20** anchor_ok collected and dropped — aggregate into report.
- **F21** report omits seed + evaluator model.
- **F22** entity trap swap pool is cross-episode — roster evidence makes
  traps trivially catchable; restrict to same-episode roster.
- **F23** trap planting can silently under-fill — report planted-vs-plan.
- **F24** evalPromptHash captured at score-time, never compared to the
  drift baseline — assert against plan.md's stamped hash.
- **F25** crash between artifact writes wedges resume — validity requires
  extraction-code + brief + transcript; fingerprint spot-checked.
- **F26** enrichment workflow lacks EV-A12 resume — agents instructed to
  adopt an existing valid artifact instead of re-analyzing.
- **F27** load never gates on judgmentComplete — partial-judgment
  episodes shippable silently.

Low (cheap + material):
- **F28** A2 executor per-row INSERTs vs plan's "batched" (the A1 12-min
  lesson; live cost ~7 min) — 500-row chunks.
- **F29** builder never asserts (toId, relType) uniqueness — duplicate
  UPDATE pairs silently last-win.
- **F30** prune adjudicated-wrong mentions using the FINAL round's
  verdicts (post re-run; they seed Phase B's review table as rejected).

## Bucket: RECORDED (accepted risk, no code change)

- Classification read outside the write tx (index.mjs:353) — concurrent
  A1+A2 is loud in both failure directions (rowCount assert / unique
  index); single-operator ops today. Revisit if scheduled ingestion ever
  overlaps stages.
- Repair scan→tx window (repair:80) — one-time migration, post-fix
  writers emit objects; validated-set ≠ unwrapped-set is theoretical.
- Remaining low findings tagged noise/risky in confirmed.json (mostly
  logging-shape and doc-wording notes) — recorded there; no action.

## Bucket: PHASE-B / LATER

- Eval evaluator model diversity (same-model caveat) — standing note in
  plan §Eval; revisit when Agent model overrides are exercised.
- Disambiguation judgment phase for collision-excluded names (the two
  Naamans, Samuels) — recall improvement, design-doc improvement list.
- Enrichment review UI consumes the prune/verdict data (design doc §B).

## Resolution (fix-verification, 2026-07-18)

All 30 FIX-bucket items closed. Fix-verification (workflow, 5 clusters;
streak now 3-for-3 on catching residuals over green suites): 25/25 fixes
verified — 21 in the first pass, F9/F10/F28/F29 in the deferred load-paths
re-run (first attempt died on session limit) — plus **18 residuals found
and closed** (R-runner-gates-1..2, R-extract-lib-1..4, R-extract-merge-1..5,
R-eval-machinery-1..6, R-load-paths-1). Standouts: the fatal-without-return
class survived at the env gates; foreign suppression was single-utterance
scoped; "Sinai"-in-"Mount Sinai" token containment; dry-run/commit unwrap
off-by-one. Final state: eval round 4 passed (0.967/0.883/0.900, 13/14
per-kind traps, 4/4 golds), reloaded, 13 round-4 adjudicated-wrong mentions
pruned (prune-round4.json = Phase-B review-table seed), all smokes clean,
harnesses 72/72 + 53/53.

## Provenance histogram

find-phase dimensions: data-integrity 12 · extraction-correctness 22 ·
eval-integrity 18 · reliability-secrets 19. Verifier kill rate 7/78 (9%);
coverage-first reporting worked as intended — the adversarial layer, not
the finder, did the filtering.
