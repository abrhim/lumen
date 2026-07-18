# Eval-integrity review — unshaken-extraction

Scope: `scripts/extraction-eval.mjs`, `.claude/workflows/unshaken-eval.mjs`,
`.claude/workflows/unshaken-enrichment.mjs`, `docs/features/unshaken-extraction/eval-prompt.md`.
Contract: plan.md §Design/§Eval. Pinned behavior: `scripts/__tests__/ingest-extraction.test.mjs`.
Coverage-first: everything found is reported, including low-confidence items.

## Findings

### F1 — Answer-key recomputation depends on un-fingerprinted live DB state and episodes.json spans (HIGH)

**File**: `scripts/extraction-eval.mjs:313` (stale check), `:150–158` (trap derivation), `:219–251` (buildContext)

**Claim**: `deriveRound`'s trap planting consumes rng draws conditioned on
`blockChaptersByEpisode`/`verseExistsByEpisode`, which come from live
`lumen.books/chapters/verses` queries plus `episodes.json` spans at BOTH
`--build` and `--score`; the stale-eval check compares only
`meta.episodeHashes` (extraction-artifact content hashes), so any DB or
spans drift between build and score changes the rng stream, permutes the
final shuffle, and reassigns `r{round}-i{NNN}` ids to DIFFERENT items —
verdicts then silently grade the wrong items.

**Evidence**:
```js
if (candidates.length) swapped = `${candidates[Math.floor(rng() * candidates.length)]}-${vnum}`;   // rng draw gated on DB-derived candidates
...
const shuffled = shuffle(items, rng);                       // downstream of every trap-plant rng draw
shuffled.forEach((it, i) => { it.id = `r${round}-i${String(i).padStart(3, '0')}`; });
...
if (JSON.stringify(meta.episodeHashes) !== JSON.stringify(derived.episodeHashes)) {
    throw new Error('extraction artifacts changed since --build — stale eval (PW-A6); rebuild the round');
}
```
`episodeHashes` covers `{episodeId, mentions, edges}` only
(`extract.mjs:575`). If a chapter/verse row is added, a `chapterCount`
changes (`anchorsForBlock` open-ended spans use `span.end ?? chapterCount`),
or an episode's `spans` in `episodes.json` are edited between build and
score, `candidates` arrays change → different number/values of rng calls →
id permutation with NO error. Plan §Eval demands the checkpoint be
"mechanical"; this hole lets the eval silently grade wrong. Fix shape:
fingerprint the derived context (e.g. hash of
`blockChaptersByEpisode` + verse-id sets + episodes.json) into `meta.json`
and refuse on mismatch, and/or persist per-item content keys (episodeId|kind|target|seq)
in the packet so score can verify id→item identity.

### F2 — `--build` never purges stale `shard-*.verdict.json`; a rebuilt round silently scores old verdicts (HIGH)

**File**: `scripts/extraction-eval.mjs:261–301` (build writes shards+meta only), `:318–325` (score reads verdicts)

**Claim**: Rebuilding a round after the extraction artifacts changed leaves
the previous run's verdict files in `eval/round-N/`; the stale check passes
(meta.json was rewritten to the NEW hashes), ids are ordinal
(`r1-i000…`), so score matches the OLD verdicts against the NEW recomputed
key and grades silently wrong.

**Evidence**: `build()` does `mkdirSync(outDir, { recursive: true })` then
writes only `shard-NN.json` and `meta.json`; nothing deletes or invalidates
`shard-NN.verdict.json`. In `score()`:
```js
const p = join(outDir, `shard-${String(i).padStart(2, '0')}.verdict.json`);
if (!existsSync(p)) throw new Error(`missing verdict for shard ${i} ...`);
```
Sequence: build → evaluate → artifacts change (re-extract per iteration
protocol A6) → build again (same round number, meta.shards similar) →
score: every verdict file exists, ids collide with the new id space, no
error. Verdict files need to be bound to the build (e.g. embed
`episodeHashes`/a build nonce in packets and require it echoed in
verdicts), or build must delete `*.verdict.json` in the round dir.

### F3 — Golds are not correct-by-construction: regex-picked chapter mentions, no number↔target check, agent-influenced timeline source (HIGH)

**File**: `scripts/extraction-eval.mjs:120–127`

**Claim**: Plan A3 specifies golds as "title-derived chapter pairs, correct
by construction", but the implementation selects any chapter mention whose
quote matches `/\bchapter\s+\w+/i` — which matches "the chapter we just
read" (`\w+` matches "we"), never verifies the spoken chapter number
matches the target id, and draws from timeline-derived chapter mentions
that can originate from the timeline-review AGENT's corrections
(`extract.mjs:133–148`) — so a gold can be genuinely wrong, and two
correct rejections of bad golds VOID the entire eval as "evaluator
over-strict" (`golds.rejected >= 2` → `evalVoid`), inverting the signal.

**Evidence**:
```js
const goldPool = shuffle(
    (byKind.get('chapter') ?? []).filter((m) => /\bchapter\s+\w+/i.test(m.quote) && !pickedKeys.has(keyOf(m))), rng);
...
const evalVoid = report.golds.rejected >= 2;
if (evalVoid) report.voided.push('ALL(golds-rejected — evaluator over-strict)');
```
`extract.mjs:135–136`: "Agent-reviewed timelines carry no evidence text —
fall back to the utterance at seq" — the gold's target is whatever chapter
the (possibly agent-corrected) segment claims. There is no check that the
`\w+` after "chapter" is a number, nor that the number equals the target's
chapter component. A strict-but-correct evaluator can void a valid eval;
a lenient one is measured against golds that prove nothing.

### F4 — Trap floor implemented per-STRATUM, not per-KIND as plan A4 requires (MED)

**File**: `scripts/extraction-eval.mjs:132, 365–368`

**Claim**: Plan A4: "≥2 missed traps of one kind VOIDS that kind's number";
the code plants a minimum of 3 traps per STRATUM and voids per STRATUM, so
within the `entity` stratum (person+place+event) an individual kind can
receive 0–1 traps, making the per-kind leniency floor structurally
unmeasurable while the code comment claims it is ("per-stratum minimum 3 so
the per-kind trap floor (A4) is measurable").

**Evidence**:
```js
const perStratumMin = { verseChapter: 3, entity: 3, principle: 3 };
...
const voided = trapsMissed >= 2;   // per stratum, over traps of the whole stratum
```
3 traps distributed over 3 kinds by the rng-shuffled pool gives no per-kind
guarantee; verseChapter similarly mixes verse and chapter kinds.

### F5 — Plan A5 per-kind sub-floors (n ≥ 15 for person/place/event) not implemented (MED)

**File**: `scripts/extraction-eval.mjs:23–27, 343–381`

**Claim**: Plan A5 requires "person/place/event ≥60 (per-kind sub-floors
15)"; the gate only checks the pooled stratum `n >= s.nFloor` (30), so a
sample of 55 persons + 5 places + 0 events passes the entity gate with two
kinds unevaluated.

**Evidence**: `entity: { kinds: ['person', 'place', 'event'], gate: 0.85, nFloor: 30, sampleN: 60 }`
and `pass: !voided && point >= s.gate && lb >= s.gate - 0.08 && n >= s.nFloor` —
no per-kind accounting exists anywhere in `score()`.

### F6 — Verdict files are schema-unvalidated at scoring; invalid verdict strings silently become "missing" (MED)

**File**: `scripts/extraction-eval.mjs:318–325, 334–341, 351–361`; `.claude/workflows/unshaken-eval.mjs:20–36, 49–50`

**Claim**: The workflow's `VERDICT_SCHEMA` validates only the agent's
STRUCTURED RETURN, while `score()` reads the FILE the agent wrote with the
Write tool — the two copies are never compared and the file is never
schema-checked, so a malformed file entry (`"Correct"`, `"ok"`, missing
`verdict` field) matches no branch in the sample loop and is silently
counted as `missing`, shrinking n instead of failing loud.

**Evidence**: workflow: "Write your verdicts JSON to …verdict.json using
the Write tool, and return the same JSON as your structured output" —
nothing enforces "the same". Score:
```js
if (v === 'correct') { ... } else if (v === 'wrong') wrong += 1;
else if (v === 'insufficient-evidence') insufficient += 1;
else missing += 1;
```
Ids not in the derived key (typos) are likewise silently ignored, and there
is no check that each shard's verdict ids cover that shard's packet ids.

### F7 — Missing/skipped verdicts shrink n, letting a selectively-lazy evaluator inflate measured precision (MED)

**File**: `scripts/extraction-eval.mjs:362–364`

**Claim**: `n = sample.length - missing` excludes unanswered items from the
denominator, so an evaluator that answers only easy items (or drops the
hard half of its shard) raises the point estimate while n can stay above
the floor (sampleN 60 vs nFloor 30) — plan A5 says anything under-covered
is "NOT EVALUABLE → targeted oversample, never a pass", but a pass with up
to 30 silently-skipped verseChapter items is reachable.

**Evidence**:
```js
const n = sample.length - missing;
const point = n ? correct / n : 0;
...
pass: !voided && point >= s.gate && lb >= s.gate - 0.08 && n >= s.nFloor,
```
`missing` is reported but has no cap and no per-shard coverage requirement.

### F8 — The harness pins `seedTraps`/`stratifiedSample`, but the real eval path (`deriveRound`) never calls them — pinned behavior is dead code (MED)

**File**: `scripts/__tests__/ingest-extraction.test.mjs:603–657`; `scripts/ingest-podcast/extract-lib.mjs:432–475`; `scripts/extraction-eval.mjs:71–175`

**Claim**: H8 ("traps indistinguishable, key never embedded") and the
sampling determinism test exercise `extract-lib.mjs`'s `seedTraps` and
`stratifiedSample`, which no production code imports; the actual trap
seeding/sampling/shuffling lives in `deriveRound` inside
`extraction-eval.mjs` and has zero harness coverage, so the pinned
guarantees do not constrain the machinery that actually runs.

**Evidence**: `grep -rn "seedTraps\|stratifiedSample"` hits only
`extract-lib.mjs` (definitions) and the test file (imports).
`extraction-eval.mjs` reimplements both (`:97–116`, `:131–167`) with
different mechanics (per-episode caps, per-stratum trap plans).

### F9 — `anchor_ok` is collected and dropped; plan requires anchor offsets tracked as a separate count (MED)

**File**: `scripts/extraction-eval.mjs:321–341` (verdict ingestion), `.claude/workflows/unshaken-eval.mjs:30`

**Claim**: Plan A1: "anchor offsets >30s tracked as a separate count, not
precision failures" — the evaluator schema requires `anchor_ok` per item
and eval-prompt.md §4 mandates reporting it, but `score()` reads only
`v.verdict` and the report contains no anchor statistics at all.

**Evidence**: `verdicts.get(v.id).push(v.verdict);` is the only field ever
read from a verdict entry; `report` has keys
`{round, strata, traps, golds, duplicates, voided}` — no anchor count.

### F10 — Report/verdict artifact omits seed and evaluator model, both required by plan A5 (MED)

**File**: `scripts/extraction-eval.mjs:393–402`

**Claim**: Plan A5: "The artifact reports, per kind: … seed, evaluator
model + prompt hash" — `report.json` and `eval-verdict.json` record
`evalPromptHash` but neither the seed (`derived.seedHex` is computed and
discarded) nor the evaluator model.

**Evidence**: `writeArtifactAtomic(join(outDir, 'report.json'), JSON.stringify(report, ...))`
— `report` never receives `seedHex`; `eval-verdict.json` fields are
`{round, passed, strata, episodeHashes, evalPromptHash}`.

### F11 — Entity trap swap pool is cross-episode, so roster evidence makes many entity traps trivially catchable (MED)

**File**: `scripts/extraction-eval.mjs:157–158, 210–216`

**Claim**: Entity traps swap to any same-kind target across ALL episodes
(`byKind.get(m.kind)` is corpus-wide), while the packet's evidence includes
the episode's own roster — a swapped entity absent from the roster is a
giveaway "wrong", so the trap-catch rate over-measures evaluator diligence
and weakens the leniency detector plan A2 designed around near-misses
("wrong-king alias, plausible-but-absent principle").

**Evidence**:
```js
const sameKind = (byKind.get(m.kind) ?? []).map((x) => x.target).filter((t) => t !== m.target);
...
episodeRoster: (ctx.rosterByEpisode.get(item.videoId) ?? []).slice(0, 60),
```
Nothing restricts the swap to entities mentioned in (or plausible for) the
same episode.

### F12 — Trap planting can silently under-fill (below the 10–14 plan count and the per-stratum min 3); `if (!planted) continue` is dead code (MED)

**File**: `scripts/extraction-eval.mjs:138–167`

**Claim**: When no pool candidate yields a swappable target for a planned
trap (e.g. a one-chapter episode block, or all candidates already picked),
the trap is silently dropped — planted counts can fall below the
per-stratum minimum 3 (making the ≥2-missed void floor easier or
impossible to trigger) with no warning; the trailing `if (!planted)
continue;` is a no-op at the end of the loop body.

**Evidence**:
```js
let planted = false;
for (const m of pool) { ... planted = true; break; }
if (!planted) continue;   // last statement of the loop body — does nothing
```
`report.traps[name].planted` records the shortfall but nothing alarms or
voids on `planted < perStratumMin`.

### F13 — evalPromptHash is captured at scoring time, not at evaluator run time, and never compared to the drift baseline (MED)

**File**: `scripts/extraction-eval.mjs:390–392`; `.claude/workflows/unshaken-eval.mjs:40`

**Claim**: The verdict artifact records the hash of `eval-prompt.md` as it
exists when `--score` runs; if the prompt file changed between the
evaluator workflow run and scoring, the recorded hash misrepresents what
the evaluators actually executed, and neither the workflow nor score
compares the hash against plan.md's pinned drift baseline
(`beddaa88…be5`) — "hash-pinned" is asserted in comments but enforced
nowhere.

**Evidence**:
```js
const evalPromptHash = createHash('sha256').update(readFileSync(join(ROOT, 'docs/features/unshaken-extraction/eval-prompt.md'))).digest('hex');
```
The workflow's evaluator prompt just says "Read
docs/features/unshaken-extraction/eval-prompt.md" — no hash check anywhere.

### F14 — Duplicate-verdict "any wrong wins" asymmetrically biases golds toward eval-void (LOW)

**File**: `scripts/extraction-eval.mjs:334–341, 385–387`

**Claim**: For cross-shard duplicated items, a single 'wrong' from either
evaluator becomes the item's verdict; applied to a duplicated GOLD, one
over-strict evaluator out of two counts a full gold rejection toward the
`>= 2` whole-eval void, doubling a gold's exposure to strictness relative
to non-duplicated golds.

**Evidence**: `if (vs.includes('wrong')) return 'wrong';` combined with
`report.golds.rejected = golds.filter((g) => verdictOf(g.id) === 'wrong').length`.

### F15 — `insufficient-evidence` counts against precision identically to `wrong` in the gate math (LOW)

**File**: `scripts/extraction-eval.mjs:362–364`

**Claim**: `point = correct / n` with `n` including
`insufficient-evidence`, so the honest-uncertainty verdict the prompt
encourages ("never guess to be agreeable") is scored exactly like a
confirmed error — plan §Eval never records this choice, and it creates
pressure toward agreeable 'correct' verdicts that the refute-framing tries
to avoid.

**Evidence**: `else if (v === 'insufficient-evidence') insufficient += 1;`
— counted in `n = sample.length - missing`, excluded from `correct`.

### F16 — Floating-point gate comparison `lb >= s.gate - 0.08` (LOW)

**File**: `scripts/extraction-eval.mjs:379`

**Claim**: `0.9 - 0.08 === 0.8200000000000001` in IEEE-754, so a Wilson LB
of exactly 0.82 fails the verseChapter secondary gate by 1e-16 — an
edge-case false fail (loud, not silent).

**Evidence**: `pass: !voided && point >= s.gate && lb >= s.gate - 0.08 && n >= s.nFloor`.

### F17 — Degenerate duplicate mechanics: single-shard round duplicates an item into its own shard; late shards can duplicate an already-augmented neighbor (LOW)

**File**: `scripts/extraction-eval.mjs:270–273`

**Claim**: With `shards.length === 1`, `other` is the same shard, so the
"cross-shard" duplicate is the same id twice in one packet (one evaluator,
zero independence — and a within-packet duplicate id the evaluator may
answer once or twice); for the last shard, `shards[(i+1)%len]` is shard 0
AFTER augmentation, so its appended duplicate is eligible for
re-duplication.

**Evidence**:
```js
for (let i = 0; i < shards.length; i += 1) {
    const other = shards[(i + 1) % shards.length];
    if (other.length) shards[i] = [...shards[i], other[Math.floor(rng() * other.length)]];
}
```

### F18 — eval-prompt.md wording mismatch: "packet directory" / "packet.json" vs the actual shard file parameter (LOW)

**File**: `docs/features/unshaken-extraction/eval-prompt.md:3, 8`

**Claim**: The prompt an agent must execute "EXACTLY" calls its input "the
packet directory" and tells it to iterate "each item in `packet.json`",
but the parameter it actually receives is a file path
`…/shard-NN.json` — a literal-minded evaluator can stall looking for a
directory or a file named packet.json.

**Evidence**: "Your ONLY input is the packet directory given as your single
parameter" and "For EACH item in `packet.json`" vs workflow `packet: data/podcasts/unshaken/eval/round-${round}/shard-${String(i).padStart(2, '0')}.json`.

### F19 — Workflow takes `shards` as a caller-supplied arg instead of reading meta.json (LOW)

**File**: `.claude/workflows/unshaken-eval.mjs:15–18, 38`

**Claim**: The shard count is manually passed; too few → un-evaluated
shards (caught loud at score), too many → evaluators run against leftover
higher-numbered shard files from a previous, larger build of the same
round, wasting agents and writing verdicts score ignores — meta.json
already records the authoritative count and is never consulted.

**Evidence**: `const shards = parsedArgs?.shards` … `Array.from({ length: shards }, (_, i) => i)`.

### F20 — Plan's evaluator model diversity ("different models where available") not implemented (LOW)

**File**: `.claude/workflows/unshaken-eval.mjs:57`

**Claim**: Plan A3 records "judgment and eval phases use different models
where available"; the eval workflow spawns evaluators with only
`effort: 'high'` and no model selection, on the same harness defaults as
the enrichment judges, and the verdict artifact cannot report the model
(F10) so the divergence is also invisible.

**Evidence**: `agent(evaluatorPrompt(i), { label: \`eval:shard-${i}\`, phase: 'Evaluate', schema: VERDICT_SCHEMA, effort: 'high' })`.

## Verdict

The core architecture is sound — a single deterministic derivation shared by
`--build` and `--score`, order-independent seed, no `Math.random`/`Date`
usage, stripped packets with no persisted key, and a hash-bound load gate.
But the determinism story has two genuine silent-misgrading holes: the
answer key is a function of live DB state and episodes.json spans that the
stale-eval check does not fingerprint (F1), and rebuilt rounds inherit
id-compatible stale verdict files (F2). Golds are not the
correct-by-construction instrument the plan specifies (F3), which corrupts
the over-strictness detector that can void the whole eval. Below those,
there is a consistent pattern of the implementation narrowing plan
commitments: per-stratum instead of per-kind trap floors (F4), missing
per-kind sub-floors (F5), dropped anchor tracking (F9), missing
seed/model in the artifact (F10), and unenforced prompt-hash pinning
(F13). F1–F3 should be fixed before the eval is allowed to green-light a
load; the rest are hardening and contract-fidelity work.
