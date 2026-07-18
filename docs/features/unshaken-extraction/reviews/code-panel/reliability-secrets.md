# Reliability + Secrets review — feature/unshaken-extraction

Reviewer: reliability-secrets panelist. Scope: runner wiring (index.mjs stage
prereqs, exit codes, rollups, eval-verdict gate), artifact validity predicates
+ skip-if-valid + atomic writes, smoke-extraction.mjs + smoke-media.mjs
invariant SQL, DSN scrubbing on new error paths, log hygiene, crash-mid-stage
recovery. Files read in full: index.mjs, cli.mjs, util.mjs, extract.mjs,
load-extraction.mjs, load.mjs, smoke-extraction.mjs, smoke-media.mjs,
extraction-eval.mjs, repair-metadata-encoding.mjs, both workflow files,
plan.md, ingest-extraction.test.mjs, plus the ingest-podcast.test.mjs diff.

## Findings

### F1 — `fatal()` is non-terminating; the eval-verdict gate falls through into the prod load loop (HIGH)
`scripts/ingest-podcast/index.mjs:63-82, 330-339`

`fatal()` does not throw or return-never once `logSink` exists — it schedules
exit asynchronously (`logSink.end(() => process.exit(1))` plus an **unref'd**
500ms timer) and then returns, so the caller's code keeps executing:

```js
if (verdict.passed !== true) {
    fatal(new Error('eval verdict is not a pass — load refused'), 'prereq');
}
// … execution falls straight through into:
for (const ep of episodes) { … buildExtractionLoadPlan … executeExtractionLoadPlan … }
```

For `--stage=load-extraction` with a parseable verdict whose `passed !== true`
but whose `episodeHashes` match the artifacts (exactly the "eval failed, don't
load" state PW-A6 exists for), the loop starts synchronously: `readFileSync` +
`JSON.parse` of a multi-MB extraction artifact, the hash check passes, and the
first `await sql.unsafe(...)` is reached before the log-flush callback can
fire. Whether the prod write executes is decided by a race between a local
file flush and Supabase round-trips — the gate is correct only by event-loop
grace, not by structure. If the sink's `end` callback is delayed/stuck (the
exact scenario the 500ms comment claims to cover — but the timer is unref'd
and cannot fire once only the sql sockets hold the loop), the load **runs to
completion and exits via `finish()` with the rollup code**, i.e. a refused
verdict can end in exit 0 with prod writes.

Same non-terminating class at the `'env'` fatals (index.mjs:300, 302): after
`fatal('DATABASE_URL not found')` execution continues into
`postgres(undefined)` and `discover()` — which can launch a yt-dlp network
call — racing the scheduled exit. (The `'args'` fatals at :285/:288 are safe
only because `logSink` is still null there, taking the synchronous
`process.exit(1)` branch.)

Fix shape: make `fatal` never return (throw a sentinel caught by the outer
handler, or `return` after every `fatal(...)` call site), and drop the
`unref()` on the fallback timer.

### F2 — Crash between extraction-code.json and judgment-brief.json writes wedges resume: skip-if-valid covers only one of three stage outputs (MED)
`scripts/ingest-podcast/extract.mjs:372-374, 401-435`

`runExtractCode` writes three artifacts in order: `transcript.txt` (:401),
`extraction-code.json` (:414), `judgment-brief.json` (:418). The resume
predicate checks only the middle one:

```js
if (!opts.refresh && isValidCodeArtifact(paths.extractionCode, episodeId)) {
    log('extract_code_cached', { episode: ep.id });
    return JSON.parse(readFileSync(paths.extractionCode, 'utf8'));
}
```

A crash (SIGKILL, power, OOM) after :414 completes but before :418 leaves a
valid extraction-code.json and **no judgment brief**; every subsequent run
logs `extract_code_cached` and returns, so the enrichment workflow's agents
are pointed at a nonexistent `judgment-brief.json`. Recovery requires
`--refresh`, which (F3) also forces a yt-dlp manifest refetch in `discover`.
Plan §Design promises "Skip-if-valid per artifact" — the predicate must cover
all three outputs (or the brief must be written first / derived from the code
artifact).

### F3 — `isValidCodeArtifact` never checks the fingerprint against the current deepgram artifact; the mismatch error's advice is non-actionable (MED)
`scripts/ingest-podcast/extract.mjs:359-367, 487-493`

```js
return a.episodeId === epId && Array.isArray(a.mentions) && a.fingerprint?.utteranceCount > 0;
```

After a `--refresh` re-transcription shifts every seq/t, a subsequent
`--stage=extract-code` (without `--refresh`) happily returns the stale cached
artifact. `runExtractMerge` then throws:

```js
`${ep.id}: transcript fingerprint mismatch (...) — re-run extract-code`
```

but re-running extract-code as instructed is a no-op (the cache still
validates), so the operator loops on the same error until they discover the
global `--refresh` flag — which additionally invalidates the discover
manifest path (index.mjs:88 `if (!refresh && existsSync(artifact))`),
triggering an unnecessary yt-dlp network call. The validity predicate should
compare `a.fingerprint.utteranceCount/durationS` against the current
`.deepgram.json`.

### F4 — Stale shard verdict files from a previous build of the same round can silently feed the gate: item ids are reused and verdicts are not hash-bound (MED)
`scripts/extraction-eval.mjs:170-174, 317-325`

Item ids are positional and round-scoped only: `` it.id = `r${round}-i${…}` ``.
Rebuilding round N after artifacts change produces a **new** item set with the
**same id namespace**, and `--score` reads whatever
`shard-XX.verdict.json` files exist:

```js
const p = join(outDir, `shard-${String(i).padStart(2, '0')}.verdict.json`);
if (!existsSync(p)) throw new Error(`missing verdict for shard ${i} …`);
```

The stale-eval guard (:313) compares `meta.json` to the *current* derivation —
both are current after a rebuild — but nothing binds the **verdict files** to
the build that produced their shards. Sequence: build → evaluate → re-merge
extraction → rebuild same round (meta.json refreshed, shard files overwritten)
→ forget/partially run the eval workflow → `--score` matches old verdicts to
new items by reused id and computes a gate from mismatched judgments;
`eval-verdict.json` (which index.mjs trusts) can come out `passed: true`.
Also: a rebuild producing fewer shards leaves extra stale `shard-NN.json` /
`.verdict.json` files in the round directory forever. Fix shape: include a
build nonce (e.g. `seedHex`) in shard ids or verdict filenames and verify at
score time; delete the round dir on rebuild.

### F5 — Enrichment workflow has no skip-if-valid / file-based resume, contradicting plan EV-A12 (MED)
`.claude/workflows/unshaken-enrichment.mjs:154-169`

Plan §Design: "Every judgment agent's output persists as its own artifact
with a validity predicate … skip-if-valid per artifact = FILE-based resume
primary." The workflow unconditionally spawns all 4 agents per episode:

```js
const results = await pipeline(episodes, (ep) => parallel([
    () => agent(aliasPrompt(ep), …), () => agent(timelinePrompt(ep), …),
    () => agent(principlesPrompt(ep, 0), …), () => agent(principlesPrompt(ep, 1), …),
]) …)
```

A crash after 9 of 10 episodes forces a full re-run of ~40 agents and
overwrites already-valid artifacts (fresh non-deterministic judgment replaces
reviewed judgment). No validity predicate is applied before overwrite and no
per-episode skip exists. Resume is the stated primary recovery mechanism for
this stage and it is absent.

### F6 — extract-merge proceeds on missing/unparseable judgment artifacts and nothing downstream gates `judgmentComplete=false` (MED)
`scripts/ingest-podcast/extract.mjs:447-476, 564-565`

`readJudgment` catches missing/corrupt artifacts (e.g. an agent crash leaving
a truncated `aliases.json` — the workflow's Write-tool output is not atomic)
and merely logs `judgment_incomplete`; the merge then emits a full
`extraction.json` with `judgmentComplete: false`. Neither
`extraction-eval.mjs` (loadArtifacts, :55-63) nor the load gate in index.mjs
checks this flag — a silently degraded extraction (no aliases, no principles,
uncorrected timeline) can be evaluated, pass its (now easier) precision gate,
and load to prod with nothing louder than one log line in a per-run log file.
At minimum the eval build or the load gate should refuse `judgmentComplete
=== false` absent an explicit override.

### F7 — A2 stages ignore `--dry-run`: extract-code/extract-merge write artifacts anyway (LOW)
`scripts/ingest-podcast/index.mjs:340-365; scripts/ingest-podcast/extract.mjs (no dryRun reference)`

The runner header documents `--dry-run` as a global flag, and every A1 stage
gates its writes on it (`discover_dry_run`, `fetch_dry_run`,
`transcribe_dry_run`, `load_dry_run`). `runExtractCode`/`runExtractMerge`
never consult `opts.dryRun`: a `--stage=extract-merge --dry-run` run rewrites
`extraction.json` (changing `contentHash`, thereby invalidating an existing
eval verdict binding!), and `--stage=extract-code --refresh --dry-run`
clobbers all three artifacts. Only `load-extraction` honors the flag.

### F8 — smoke-extraction mentions invariant never checks title-sourced edges, and NULL confidences pass silently (LOW)
`scripts/smoke-extraction.mjs:96-109`

```sql
WHERE ed.collection_id = ${SHOW} AND ed.source = 'unshaken-extraction'
```

Chapter mentions written via `update-title-edge` live on
`source='unshaken-youtube'` rows and are excluded from the
sorted/confidence-floor check entirely — the exact rows the PW-A4 replace
semantics rewrite every run are unvalidated. Additionally `bool_and` ignores
NULL inputs, so a mention object **missing** the `confidence` key (or `t`)
contributes NULL and the row passes `conf_ok`/`sorted_ok`.

### F9 — Verse-target orphan detection keyed on `to_id LIKE '%-%-%-%'` id-shape heuristic (LOW)
`scripts/smoke-extraction.mjs:75-80`

Correct for `2-kgs-N-V`, but the "only orphan detector" for a table with no
FKs is shape-fragile: any future book id whose *chapter* ids carry three
hyphens (multi-word book codes) would route chapters into the verse check and
false-positive, and DISCUSSES rows whose verse ids carry fewer hyphens would
be skipped. Deriving the split from `rel_type` + a join against both tables
(count rows resolving in *neither*) would be shape-independent.

### F10 — Presence canary false-positives for an episode whose extraction produced only title-edge updates (LOW)
`scripts/smoke-extraction.mjs:36-45`

`every_transcribed_episode_has_extraction_edges` requires at least one
`source='unshaken-extraction'` row per transcribed episode. An episode whose
extraction yielded only chapter mentions on existing title pairs (all
UPDATEs, zero INSERTs — plausible for a short episode with no verse/entity
mentions surviving validation) loads successfully yet fails the canary,
exit 2. Loud rather than silent, but a wrong invariant erodes trust in the
smoke.

### F11 — `writeArtifactAtomic`: fixed `.tmp` name, no O_EXCL, no fsync (LOW)
`scripts/ingest-podcast/util.mjs:44-48`

```js
const tmp = `${path}.tmp`;
writeFileSync(tmp, data);
renameSync(tmp, path);
```

Two concurrent runner invocations on the same show (nothing prevents this;
each owns only its log file) can interleave writes to the same `.tmp` and
publish a torn artifact via rename. A crash between write and rename leaves
`.tmp` litter that is never cleaned. No fsync before rename means a power
loss can publish an empty/short artifact on some filesystems. Pre-existing
A1 util, but this branch multiplies its call sites (8+ new artifact types).

### F12 — extraction-eval reads episodes.json at module top level, before arg handling and outside error handling (LOW)
`scripts/extraction-eval.mjs:19`

```js
const EPISODES = JSON.parse(readFileSync(join(DIR, 'episodes.json'), 'utf8')).episodes.map(…)
```

Missing/corrupt manifest (fresh clone, crash-mid-discover) crashes the script
with a raw ENOENT/SyntaxError stack before the usage message or the scrubbed
FATAL path can run. No secret exposure (path only), but it violates the
house error-path style every sibling script follows.

### F13 — repair dry-run validates only the outer wrap layer; double-wrapped scalars pass validation but unwrap to non-object garbage (LOW)
`scripts/repair-metadata-encoding.mjs:55-72, 80-99`

The comment claims "scalar/array content would ship garbage" is prevented,
but `typeof parsed === 'string'` rows are merely counted as `doubleWrapped`
and not recursively validated. A row whose raw value is `"\"5\""` passes the
dry run, then the unwrap loop peels it to a jsonb **number** scalar; the
in-tx invariant only asserts zero *string* rows remain, so the non-object
ships. (Known prod data is single-wrapped objects, so this is latent, but
the validation contract as written is not met.)

### F14 — Outer catch writes to a possibly-ended logSink; write-after-end can raise an unhandled stream error that masks the real failure (LOW)
`scripts/ingest-podcast/index.mjs:458-462`

After any in-try `fatal(...)` (which calls `logSink.end(...)`), a subsequent
throw reaches the outer catch, which does `logSink?.write(...)` — write after
end emits `'error'` on a stream with no error listener, throwing from within
the catch handler and replacing the scrubbed fatal line with a raw
`ERR_STREAM_WRITE_AFTER_END` stack. `finish()` then also calls
`logSink.end()` a second time and races `process.exit` codes with `fatal`'s
scheduled exit.

### F15 — `.env` read sits outside the try block: missing .env crashes with a raw stack and an unflushed run log (LOW)
`scripts/ingest-podcast/index.mjs:296-305`

`readFileSync(join(ROOT, '.env'))` (:298) and `postgres(dsn)` (:305) run
after `run_start` is written to the sink but before the try. A missing .env
throws from top-level `await main()` → unhandled rejection, raw stack (no
secret content — path only), no `fatal` record, and the buffered `run_start`
line may be lost on abrupt exit — an empty run log for exactly the runs that
most need forensics.

### F16 — `fatal`'s fallback timer is unref'd, so the "bounded" exit cannot fire if the loop drains; theoretical exit 0 after a fatal (LOW)
`scripts/ingest-podcast/index.mjs:74-79`

The comment promises "a stuck stream can never hang the exit", but
`t.unref?.()` means the timer holds nothing open; if the stream's `end`
callback never fires and no other handle keeps the loop alive, node exits
naturally — with code 0 — instead of 1. With sql sockets open the process
instead keeps running (see F1's completion path). Either drop the unref or
`process.exitCode = 1` eagerly so any natural exit carries the failure code.

### F17 — Duplicate `bookRows` query inside the A2 block shadows the outer fetch (LOW)
`scripts/ingest-podcast/index.mjs:316, 326`

`SELECT id, name FROM lumen.books` runs twice per A2 invocation; the inner
`const bookRows` shadows the outer one used to build `lookup`. Harmless
today (same data), but a drift hazard and a needless round trip.

### F18 — A2 stage exit code is 2 even when ALL episodes failed (LOW)
`scripts/ingest-podcast/index.mjs:372-373`

`return finish(rollup.failed.length ? 2 : 0)` — total failure (0 ok / N
failed) is indistinguishable from one straggler. The runner contract ("1
fatal, 2 partial") makes 2 read as "mostly worked"; an all-failed stage is
arguably fatal-class for automation deciding whether to proceed to the next
stage.

### F19 — Pre-existing: `--stage=load` still routes through `fetchEpisode`; missing audio triggers a network re-download in a load-scoped run (LOW)
`scripts/ingest-podcast/index.mjs:408-411, 435`

`assertStagePrereqs('load')` requires only transcripts, but the chain calls
`await fetchEpisode(probe, …)` unconditionally; if the `.m4a` was deleted
after transcription (transcripts valid, load needs no audio), yt-dlp
re-downloads it. Violates the B7 spirit ("scoped runs never cascade into
earlier stages") for the bandwidth stage. Pre-existing A1 wiring, surfaced
here because the A2 stages correctly bypass the chain and highlight the
asymmetry.

### F20 — `stage_rollup` logs `ok` as a count and `failed` as an array (LOW)
`scripts/ingest-podcast/index.mjs:372`

`{ ok: rollup.ok.length, failed: rollup.failed }` — inconsistent shape for
log consumers; the A1 rollups (`summarizeResults`) emit counts for both.
Cosmetic, but these logs are the crash-forensics surface.

## Verdict

The A2 additions are broadly disciplined: per-episode transactions with
rowCount asserts make load-extraction crash-safe and idempotent; extract-merge
is a single atomic artifact; every new DB-touching script scrubs error
messages through `scrubSecrets`/`makeScrubber` before console or sink; I found
**no secret leakage** on any new error path, log line, or artifact (run logs
carry argv + scrubbed messages only; Deepgram key travels in headers, never
URLs; DSN never leaves `.env` parsing; judgment/eval artifacts contain only
transcript-derived content).

The two structural weaknesses are (1) `fatal()`'s fall-through semantics,
which turn the PW-A6 eval-verdict gate — the feature's load-bearing wall —
into a gate-by-race (F1), and (2) resume/validity gaps around the multi-
artifact extract-code stage and the enrichment workflow (F2, F3, F5), where
the plan's promised file-based recovery is partially unimplemented. F4 and F6
are quieter holes in the checkpoint chain: stale verdict reuse and ungated
`judgmentComplete=false` both let a degraded signal reach the loader while
every individual check still passes. Recommend fixing F1 before any prod
load-extraction run; F2–F6 before the enrichment/eval rounds are re-run in
anger.
