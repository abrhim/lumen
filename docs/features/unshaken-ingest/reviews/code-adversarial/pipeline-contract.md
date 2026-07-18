# Code-adversarial — pipeline-contract (unshaken-ingest A1)

Timeline forensics independently re-verified (`stat` mtimes + `git show`), all
panel anchors confirmed to the second: b7cd3a9 16:09:30 (43/43 green) · episodes.json
16:10:50 · probe m4a 16:11:56 · probe deepgram 16:13:17 · 14-min gap → fix 0e485b6
16:27:18 · rest fetches 16:27:44–16:29:54 · rest transcribes (deepgram mtimes)
16:30:37–16:34:02 · retry ivzxaLpbZws m4a 16:31:42/deepgram 16:32:18 · run-1.log 16:34:05.

| ID | Tag | Rationale (≤25 words, evidence) |
|---|---|---|
| CPIPE-1 | risky | Confirmed over-serialized vs plan "fetches underneath"; but cited 14-min idle was the load-stall bug (0e485b6), not pipelining. 1-ep gain=0; fix plan text. |
| CPIPE-2 | risky | Two-phase confirmed (log order + mtimes: last fetch 16:29:54, first transcribe done 16:30:37). Backfill saves ~2min once; steady-state 1-ep=0. Rewrite disproportionate; fix plan text. |
| CPIPE-3 | material | Confirmed exit-0 masked failed:1 (tee, no pipefail); unattended weekly/re-runs → silent missing episode. Runner-owned per-invocation log fixes this AND CPIPE-7. Cheap. |
| CPIPE-4 | risky | Confirmed: index.mjs log() stamps nothing; openbible house convention DOES (startedAt/elapsedMs/at, lines 143/257). Dating the stall needed mtimes+git. Trivial `at:Date.now()`; observability-only. |
| CPIPE-5 | risky | Confirmed: only discover_done rolls up; fetch/transcribe/load emit per-episode + one conflated run_done. CON-7 was "incorporated" — partly unimplemented. No run-level billed$ sum. Cheap; observability. |
| CPIPE-6 | risky | Confirmed --stage=load ≡ default (no load branch/whitelist; typo runs all). --stage=transcribe shares the cascade (silently fetches). Real $ footgun, yet also resumability-by-design. |
| CPIPE-7 | risky | Confirmed fixed shared log path; broke Monitor once (bugs.md #3); no data impact. MERGES with CPIPE-3 — one per-invocation-NAMED log solves both (fixed name wouldn't). |
| CPIPE-8 | risky | Confirmed load runs in transcribe pool (≤3; DB max:2 caps at 2) vs plan "serial." But safe: shared upsert row-locks, 60s guards, idempotent. Plan-text fix. |
| CPIPE-9 | risky | Confirmed episodes.json untracked (.gitignore:14 `data/`, no negation) vs plan:72. Also undermines REL-4's REJECTION rationale (plan:270 "committed/reviewable"). Trivial negation+commit (2965B). |
| CPIPE-10 | noise | Confirmed zero .load.json writes; no A1/A2 consumer (A2 uses deepgram.json; dry-run already logs plan.summary). Redundant planned nice-to-have. Honest fix: drop plan:72 line. |

**Stance.** The panel's forensics are accurate to the second and every factual claim
re-verified; its miss is severity, not fact. It tags CPIPE-1/2 "high" behind a
true-pipelining rewrite whose steady-state (1 ep/week) payoff is exactly zero and
whose one-time, already-completed backfill payoff is ~2min — and it credits the
14-min idle to pipelining when that idle was the load-stall bug (fixed in 0e485b6,
fatal to run-1 regardless), so the honest remedy is a one-line plan-text correction
and both drop to risky. The one finding worth raising is the monitored-runner
log/exit cluster: CPIPE-3 is material (silent exit-0-on-partial-failure risks a
missing episode under the unattended weekly/re-run path it's built for), and a single
per-invocation-NAMED runner-owned log closes CPIPE-3 and its subsumed pair CPIPE-7 —
the two log/monitor failures that both fired in run-1. Everything else is genuine but
modest plan↔code drift (fix the text) with one pure drop (CPIPE-10).
