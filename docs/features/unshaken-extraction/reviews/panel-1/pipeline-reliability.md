# Panel 1 — pipeline reliability + cost (unshaken-extraction A2)

Lens: operational reliability and cost of the new extract stage only. Sources:
plan.md; harness `scripts/__tests__/ingest-extraction.test.mjs`; A1 shell
`scripts/ingest-podcast/{index,util,transcribe}.mjs`; Anthropic Batch API facts
verified via claude-api skill (2026-07-17); measured against the 10 live
Deepgram artifacts in `data/podcasts/unshaken/`.

## Findings

### F1 — In-flight batch id is not an artifact: a killed poll resubmits and pays twice

**Severity: High**

**Evidence:** Plan line 74–79 persists only the *output* (`<id>.extraction.json`
cached, skip-if-valid) and says "poll until `ended`". Batches typically take up
to ~1h (24h max) and the poller is a local script (`node --import tsx …`) that
can be Ctrl-C'd, crash (A1's `fatal()` path exits the process), or lose the
laptop lid. On re-run, no artifact exists yet for any episode, so skip-if-valid
finds nothing and the stage's only possible move is to submit a **new** batch —
all ~1,000 requests re-enqueued and re-billed while the orphaned batch finishes
unobserved. Batch results stay retrievable for 29 days; the id is the only
thing needed to recover them, and nothing in the plan writes it down. H5 covers
result *assembly*, not submission idempotency; no harness case covers "state
exists → resume, don't resubmit".

**Recommendation:** Make the batch submission itself an artifact. Immediately
after `client.messages.batches.create()` returns, `writeArtifactAtomic` a state
file (e.g. `extract-batch.p2.json`) with `{batch_id, created_at, model,
custom_ids, retry_round}`. Extract-stage startup order: (1) per-episode
extraction artifact valid → skip; (2) state file exists → `batches.retrieve(id)`
— `in_progress` → resume polling; `ended` → download results; canceled /
not-found / >29d → discard state and fall through; (3) only then submit.
`--refresh` clears state. Add a harness case (pure core: given state +
retrieve-status, decide resume|download|submit) — this is the H10 of A2.

### F2 — No retry story for partial results; succeeded chunks aren't persisted raw, so one bad chunk wastes its episode

**Severity: High**

**Evidence:** H5 (plan lines 124–125, harness lines 279–284) decides
`complete:false` and withholds mentions when a chunk is missing — correct for
correctness, silent on recovery. An `ended` batch can contain per-request
`errored` / `expired` / `canceled` results (skill: `errored` +
`invalid_request` → "fix and retry"; server error → "safe to retry" unchanged;
`expired` → "resubmit"). The plan writes only the assembled per-episode
artifact, and only H5-complete episodes could validly produce one — so the
9/10 chunks that *succeeded* for a failed episode live nowhere durable. The
only path back is resubmitting every chunk of that episode (or, combined with
F1, the whole show). Note failed requests are **not billed**, so the cost leak
is entirely in re-running the succeeded ones.

**Recommendation:** Two-layer artifact: (a) stream
`client.messages.batches.results(id)` to `batch-<id>.results.jsonl` (tmp +
rename), keyed by custom_id — the durable raw layer; (b) assemble per-episode
artifacts from it. Retry algorithm on `ended`: partition by result type;
`errored:invalid_request` → do **not** resubmit unchanged (log, fail episode —
it's a code/schema bug); server-`errored` + `expired` → submit ONE follow-up
batch containing only those custom_ids, merge its results into the raw layer,
re-assemble. Cap `retry_round` (state file, F1) at 1–2; exceeding it → exit 2
with the failed custom_ids logged. Harness: pure partition/merge cores.

### F3 — Pass 1 and pass 2 cannot share one batch; timeline must be its own artifact with an explicit validity predicate

**Severity: Medium**

**Evidence:** Pass-2 prompts "carry the chunk's chapter-context (from pass 1)"
(plan lines 55–57), so pass-2 requests cannot be *built* until pass-1 results
are back — yet the single custom_id namespace `<episodeId>:<pass>:<chunkSeq>`
(line 75) and the single artifact mention read as one submission. Undefined
sequencing is where resumability dies: if a pass-2 retry regenerates pass 1,
you re-pay a full-transcript sweep (~0.6M input tokens, F4) to fix one chunk.
Also unspecified: what makes `<id>.extraction.json` VALID for skip-if-valid.
A1's precedent is behavioral validation (`validateUtterances` on cached reads,
index.mjs 168–177), not mere existence.

**Recommendation:** (a) Persist `<id>.timeline.json` per episode as its own
skip-if-valid artifact; pass-2 build reads it from disk. (b) Decide the pass-1
transport explicitly: two sequential batches, or — recommended — pass 1 as
direct Messages calls (10 requests through the existing `runPool`, ~$3.3
unbatched vs ~$1.6 batched: +$1.7 buys removal of an entire batch round-trip,
its polling, and its failure modes). (c) Define VALID for
`<id>.extraction.json`: parses, schema-shaped, `complete === true`, and
`expectedChunks` matches a recompute of `chunkUtterances()` over the transcript
(chunking is pure and deterministic, so the recompute is free); anything else →
stale, re-derive from the raw results layer (F2), not from a new batch.

### F4 — Token estimate contradicts the plan's own probe data (~5×); no hard pre-submit cap; max_tokens is the only real runaway ceiling

**Severity: Medium**

**Evidence:** Measured from the live artifacts: 39,459 utterances / 442k words
/ 2.31M chars ≈ **577k tokens** of raw transcript across 10 episodes, and
**988 pass-2 chunks** at 50/10. Pass 1 sends every transcript once (~0.6M in);
pass 2 re-sends utterances at 1.25× (overlap) plus per-chunk scaffold
(episode block + chapter ctx + candidates + 42-principle pool ≈ 400–800 tok
× 988) ≈ 1.2–1.6M in. Total ≈ **1.8–2.2M input tokens vs the plan's 250–400k**
(line 80) — ~5–7× low. Output: 150k total assumes ~150 tok/chunk, but adaptive
thinking on Opus 4.8 **bills as output tokens**; at medium effort expect
300–800/chunk → 0.3–0.8M. Dollars at batched $2.50/$12.50: ≈ **$8–16**, so the
"$6–10" survives only at the optimistic edge — but any budget assertion sized
from the plan constant would be wrong. And nothing *prevents* a runaway: a
chunking bug (overlap ≥ size → non-advancing windows) or a retry loop has no
ceiling other than the 100k-requests batch limit.

**Recommendation:** Pre-submit, in code, abort on any of: (1) request count >
ceiling (e.g. 1,500 — measured is 988+10); (2) computed input tokens (chars/4
over the actual built payloads) > ceiling (e.g. 3M); (3) worst-case spend
`requests × max_tokens × $12.50/M + input × $2.50/M` > dollar cap (e.g. $40).
Set `max_tokens` deliberately (~4k: 988 × 4096 ≈ 4.0M max output ≈ $50 hard
worst case; thinking + JSON must fit, so treat `stop_reason !== "end_turn"` as
chunk failure — max_tokens truncation yields unparseable JSON). Log per-batch
usage sums (plan already says so) and reconcile against the estimate. Before
submitting 988 requests, fire ONE direct Messages call with a real chunk: a
schema/params bug otherwise surfaces an hour later as 988 × `invalid_request`
(unbilled, but a full batch cycle lost) — this also fail-fasts a bad key.

### F5 — Secrets: childEnv and scrubSecrets don't know ANTHROPIC_API_KEY, and yt-dlp still spawns during an extract run

**Severity: Medium**

**Evidence:** `childEnv` strips only `DEEPGRAM_API_KEY`/`DATABASE_URL`
(util.mjs 21–26); `scrubSecrets`' env fallback pulls only
`process.env.DEEPGRAM_API_KEY` (util.mjs 12); the runner's shared `scrub` is
built from the Deepgram key alone (index.mjs 283) and is what the outer catch
uses (index.mjs 384). Meanwhile `discover()` runs unconditionally before the
stage switch (index.mjs 287) and spawns yt-dlp — so `--stage=extract` still
launches children. If the key is only ever parsed from `.env` file text (A1's
pattern, plan line 143) it never enters `process.env` and children can't
inherit it — but the SDK's zero-arg `new Anthropic()` reads
`process.env.ANTHROPIC_API_KEY`, which tempts a dotenv-style export. H9 tests
the scrubber with an `sk-ant` key (harness 443–447) but nothing pins childEnv
coverage or the runner-level scrubber carrying both keys.

**Recommendation:** (1) Record the A1 pattern as the decision: regex the key
from `.env` text, inject via `new Anthropic({ apiKey })`, never write it into
`process.env`. (2) Belt-and-suspenders: add `ANTHROPIC_API_KEY` to childEnv's
delete list and a generic `sk-ant-[A-Za-z0-9_-]+` → `***` rule to
`scrubSecrets`. (3) Let the run-level scrubber carry both live keys
(`extraSecrets` already accepts an array; widen `makeScrubber` to accept one).
(4) Batch-state and results artifacts must never embed the key (they won't if
only request params/results are written — pin with an H9b grep test like
harness line 449's prompt check).

### F6 — Polling loop semantics unspecified: interval, wall-clock bound, and the exit-code contract

**Severity: Low**

**Evidence:** "poll until `ended`" (plan line 78) is the entire spec. A1 has a
crisp exit contract (0 ok / 1 fatal / 2 partial, index.mjs 11–12) and this
stage's happy path can legitimately take an hour — blocking a terminal for 24h
worst-case with no bound, or exiting 1 on a transient retrieve failure, both
break the A1 discipline.

**Recommendation:** Poll `batches.retrieve` every 30–60s, logging
`processing_status` + `request_counts` each tick (house logging). Bound the
wait (e.g. `--poll-timeout`, default ~2h): on expiry, exit **2** with the
batch id and a "re-run resumes; batch continues server-side; results retained
29 days" log line — which F1's state artifact makes true. Transient retrieve
errors: rely on SDK auto-retry (2×, 429/5xx) plus loop continuation; only N
consecutive failures → exit 2 (never 1 — the batch is still running and money
is committed).

### F7 — SDK/ESM interop: clean as planned; three pitfalls to not introduce

**Severity: Low**

**Evidence:** `@anthropic-ai/sdk@^0.112.3` is already in root devDependencies
(package.json), Node v26.4.0 / engines ≥20 — the SDK is dual ESM/CJS at this
version, so plain `import Anthropic from '@anthropic-ai/sdk'` works natively
in `extract.mjs`. Root-devDep resolution from `scripts/` is already proven by
`postgres`/`tsx`. Batches live on the non-beta namespace
(`client.messages.batches.create/retrieve/results`) — no beta header.

**Recommendation:** (1) Do **not** copy the `createRequire` pattern
(index.mjs 275) for the SDK — that exists because `postgres` is CJS; the SDK
isn't. (2) Do **not** reach for `@anthropic-ai/sdk/helpers/zod` — zod is not
installed, and the hand-rolled `buildExtractionSchema()` +
`output_config: {format: {type: "json_schema", schema}}` in each request's
params is the dependency-free path the harness already pins (lines 402–415;
the [0,1] confidence check stays in code — structured outputs rejects numeric
range constraints, which the harness comment gets right). (3) Client timeout
defaults (10 min, ms units in TS) are fine for batch calls; don't tune them.

### F8 — Checkpoint and --episode scoping have no mechanical enforcement in the runner

**Severity: Low**

**Evidence:** "no edge ships unevaluated" (plan line 97) names no gate;
`assertStagePrereqs` (index.mjs 242–255) is the house mechanism and the plan
wires extract/load-extraction into it (line 107) but doesn't say *what* the
load-extraction prereq checks. Separately, a batch spans all 10 episodes while
the runner supports `--episode=<id>` — an episode-scoped extract re-run
against a whole-show batch state is undefined (worst case: resubmits all 10).

**Recommendation:** `--stage=load-extraction` prereqs: valid
`<id>.extraction.json` for every in-scope episode AND an eval-verdict artifact
(e.g. `eval-verdict.json` `{pass: true, precision: {...}, at}`) — the
checkpoint becomes a file the runner can refuse on, matching B7's
"never cascade into paid stages" spirit in reverse. For `--episode`: the F1
state artifact already records custom_ids; scope submission and assembly to
the requested episode's ids, and never resubmit ids belonging to out-of-scope
episodes.

## Verdict

The extraction *correctness* layer is in strong shape — H1–H9 pin the pure
cores, closed-vocab and fail-closed disciplines are real, and the A1 shell
being reused is the right call. The batch *operational* layer is the gap:
as written, the plan pays twice on a killed poll (F1), wastes succeeded chunks
on any partial batch (F2), and its cost figure is ~5× off its own probe data
with no hard cap between a bug and a large bill (F4). All four top findings
are resolvable inside `extract.mjs` + a state artifact + ~4 new harness cases,
without touching the planned pure cores. **Conditional pass: address F1, F2,
F3, F4 (state artifact, raw-results layer + bounded retry, pass-1/pass-2
sequencing + validity predicate, pre-submit caps) before implementation; F5–F8
are cheap hardening to fold in during the build.**
