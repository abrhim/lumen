# Code-panel — pipeline-contract (unshaken-ingest A1)

Lens: pipeline operability + cross-phase contracts (A2/B consume these). Evidence:
`scripts/ingest-podcast/*.mjs`, `data/podcasts/unshaken/run-1.log` (event order),
artifact mtimes (`stat`) as a timestamp proxy since the log carries none, git commit
times for the two mid-run fixes, `scripts/ingest-openbible-refs.mjs` (house
convention comparison), `scripts/__tests__/ingest-podcast.test.mjs` (coverage check).

Reconstructed run-1 timeline (mtimes + `git log`): commit `b7cd3a9` 16:09:30 (43/43
green) → `episodes.json` 16:10:50 (discover_done) → probe `25hrVBU3Vz8` fetch
16:11:56, transcribe 16:13:17 → **gap to 16:27:18** (commit `0e485b6`, the batched-
insert fix for the 12-min load stall) → probe reload + `rest` fetches 16:27:44–
16:29:54 → `rest` transcribes 16:30:37–16:34:02 → retry (`ivzxaLpbZws`, DNS-failure
recovery) interleaved 16:31:42–16:32:18 → `run-1.log` last write 16:34:05.

| ID | Severity | Where (file:line or log evidence) | Problem (≤25 words) | Fix (≤30 words) |
|---|---|---|---|---|
| CPIPE-1 | high | `index.mjs:252-269` (`await runChain(probe)` fully resolves before the `rest` fetch pool is even defined); log lines 1-13 (zero `rest` `fetch_done` before probe's `load_done`); plan.md:137-139 | Probe's fetch+transcribe+load fully blocks the rest pool from starting, contradicting Amendment 1's "fetches proceed underneath"; caused a 14-min run-wide idle during the load stall. | Start rest's fetch pool concurrently with the probe chain (e.g. `Promise.all`), not after `runChain(probe)` resolves. |
| CPIPE-2 | high | `index.mjs:268-292` (`transcribeQueue.map()` only evaluated after `runPool(fetch tasks)` resolves); plan.md:131-136 | Rest's fetch pool and transcribe pool run as two sequential phases, not pipelined — zero mtime overlap (last fetch 16:29:54, first transcribe 16:30:37). | Feed episodes into the transcribe pool as each fetch completes (streaming queue/async iterator) instead of two sequential `runPool` calls. |
| CPIPE-3 | medium | `index.mjs:303-313` (exit code itself is correct: `finish(failed>0?2:0)`) + the background-task invocation that produced `run-1.log` (piped through `tee`, no `set -o pipefail`) | Runner computes exit 2 correctly on partial failure, but the tee-logging invocation masked it — the background task reported exit 0 despite `failed:1`. | Runner writes its own timestamped log file directly (`fs.createWriteStream`), removing the tee dependency; document `set -o pipefail` as interim mitigation. |
| CPIPE-4 | medium | `index.mjs` — all `log()` call sites (grep, none carry a timestamp) vs `ingest-openbible-refs.mjs:143,257` (`startedAt`/`elapsedMs`) | No log event carries a timestamp; dating the 12-min load stall required cross-referencing artifact mtimes and `git log`, not the log itself. | Add `at: Date.now()` to `log()` uniformly — house convention already does this in `ingest-openbible-refs.mjs`. |
| CPIPE-5 | medium | `index.mjs` (grep of all `log()` sites — no `fetch_stage_done`/`transcribe_stage_done`/`load_stage_done` exists); plan.md:95-97, plan.md:281 (CON-7) | CON-7's "`*_done` roll-up per stage" only holds for discover; fetch/transcribe/load emit only per-episode events plus one final `run_done` that conflates all three. | Emit `fetch_stage_done`/`transcribe_stage_done`/`load_stage_done` with per-stage ok/fail counts and summed `billed_seconds`. |
| CPIPE-6 | medium | `index.mjs:216,241,244` — grep confirms no `opts.stage === 'load'` branch exists anywhere | `--stage=load` is dead: byte-for-byte identical to omitting `--stage`, silently cascading into full fetch+transcribe (real $ + time) if artifacts are missing. | Add explicit stage-entry guards that error clearly ("run transcribe first") instead of silently re-executing earlier stages. |
| CPIPE-7 | medium | `data/podcasts/unshaken/run-1.log` (fixed shared path, no per-invocation identity); `bugs.md` fix-log #3 ("Monitor self-terminated on the RETRY process's `run_done`...") | `run-1.log` has no per-invocation identity — two concurrent runner processes (main batch + single-episode retry) interleave into it; already broke monitoring once. | Per-invocation log filename (timestamp or PID suffix, e.g. `run-<ISO>.log`) or a `--log=` flag owned by the runner. |
| CPIPE-8 | low | `index.mjs:283-292` (`loadEpisode` called inside each transcribe-pool worker, pool size 3) vs plan.md:136 ("load **serial**") | Load isn't serial — runs inside the transcribe pool (≤3 concurrent `loadEpisode` txns), contradicting Amendment 1's "load serial" text; safe only by Postgres row-locking the shared collection upsert. | Either update the plan text to "≤3 concurrent" or extract load into its own serial pool as documented. |
| CPIPE-9 | low | `.gitignore:14` (`data/`, no negation); `git check-ignore`/`git ls-files` confirm `episodes.json` untracked; plan.md:71-73 | `episodes.json` is gitignored and untracked despite the plan's explicit "Gitignored except episodes.json (small, reviewable)" — breaks the PR reviewability the design relies on. | Add `!data/podcasts/*/episodes.json` to `.gitignore` and commit the file. |
| CPIPE-10 | low | plan.md:72 (`<id>.load.json` "projection preview") vs grep across `scripts/ingest-podcast/*.mjs` — zero references | The plan's `<id>.load.json` artifact is never written; `loadEpisode` only executes SQL and logs a summary line, no persisted per-episode load preview. | Write `plan.summary` (+ statement count) to `<id>.load.json` before executing, or drop it from the plan. |

Not flagged (verified holding): artifact contract for A2 — `<id>.deepgram.json` is
the verbatim Deepgram response (`writeFileSync(artifact, JSON.stringify(dg))`
before any stripping), so per-word confidences/timestamps survive for A2 even
though `utterancesToRows` (the DB projection) intentionally keeps only
start/end/speaker/text. Portability invariant 1 (pure stage fns, I/O at the
edges) holds across discover/fetch/transcribe/load.mjs. Per-episode data
independence (invariant 3) holds — the DNS failure on `ivzxaLpbZws` did not
block or corrupt the other 9 episodes.
