# Code-panel — aggregated (unshaken-ingest A1)

2026-07-17 · 3 combined briefs over the shipped, already-run implementation
(incl. the two unreviewed mid-run fixes). Per-role files canonical.

**22 findings — 5 high / 11 med / 6 low.**
security-secrets: 1/3/1 (CSEC-1..5) · pipeline-contract: 2/5/3 (CPIPE-1..10) ·
correctness-data: 2/3/2 (CCOR-1..7).

## Highs at a glance

- CSEC-1 — check-then-download race between concurrent runners (lived it in
  the DNS retry; survived by timing).
- CPIPE-1/2 — Amendment 1's pipelining NOT delivered: probe blocks even the
  rest fetches; fetch→transcribe is a two-phase barrier (mtime forensics; the
  12-min stall idled the whole run because of this).
- CCOR-1 — weekly `--refresh` never prunes window-dropped episodes → orphaned
  entities/transcripts/edges accumulate indefinitely.
- CCOR-2 — whole-book search block-labels render as "Joshua 1" (3 of 10 live
  episodes; the exact CON-5 area synthesis flagged for code-panel attention).

## Cross-cutting notes

- Both orchestrator-seeded suspicions CONFIRMED with evidence (pipelining
  fidelity; tee exit-code masking — runner computes 2 correctly, invocation
  masked it).
- Plan-vs-code drift cluster: CPIPE-8 (loads ≤3-concurrent vs "serial"),
  CPIPE-9 (episodes.json not actually committed-able), CPIPE-10
  (`<id>.load.json` never written), CCOR-4 (stale discover-time spans stored
  vs load-time re-parse).
- Future-operation cluster: CCOR-1 (window pruning), CCOR-3 (public=false
  hardcoded — reverts B's deliberate flip on any re-run), CCOR-5 (cache
  ignores keyterm/model drift), CPIPE-6 (--stage=load dead → silent full run).
- Empirically reproduced by reviewers: CCOR-2, CCOR-6 (cross-book empty
  subtitle), CCOR-7 (--episode no-match TypeError), CSEC-5 (.env quoting),
  CSEC-3 (scrub env-fallback never armed).
- Emergent cross-review dedup again (correctness dropped its pipelining
  finding, cited CPIPE-1/2/6/8) — second occurrence; retro-worthy pattern.
- Verified HOLDING: deepgram.json = verbatim API response (A2's word-level
  contract safe); portability invariants 1/3; per-episode failure isolation.
