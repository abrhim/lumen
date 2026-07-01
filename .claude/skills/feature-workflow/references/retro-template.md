# Retro template

Run at step 14, immediately after fixes pass. Output: `docs/features/<slug>/retro.md`. Append a 2-line summary to `state/learnings.md`.

## Required sections

### 1. Plan accuracy
**Input.** `plan.md` (post-synthesis) vs the actual implementation.
**Computation.** Subjective drift score 1–5 (1 = built exactly the plan, 5 = barely recognizable).
**Output.** One number + one sentence.

### 2. Panel signal vs noise
**Input.** Aggregated panel-1 + panel-2 outputs.
**Computation.** Count of each tag: material / risky / noise / out-of-scope. Compute dissent rate = (material + risky) / total.
**Output.** Counts + dissent rate.

### 3. Harness coverage delta
**Input.** Harness assertions at step 3 vs the bugs found post-implementation.
**Computation.** For each `confirmed-bug` in `bugs.md`: was it caught by the initial harness? If not, why didn't the harness catch it?
**Output.** A short list. Each gap is a candidate for the next harness.

### 4. Wasted effort
**Input.** The flow's per-step time / agent invocations (rough estimate fine).
**Computation.** Which steps surfaced no signal? Did the adversarial panel just rubber-stamp?
**Output.** 1–3 sentences identifying any phase that didn't earn its time.

### 5. Recommendations (1–3)
**Output.** 1–3 concrete recommendations for the next feature. Format: `<imperative sentence>`. These are the seeds the meta-retro reads.

### 6. Quality signals
**Input.** All of the above.
**Output.** A small JSON block:

```json
{
  "feature_slug": "<slug>",
  "tier": "<trivial|small|standard|large>",
  "plan_to_code_drift": <1-5>,
  "panel_2_dissent_rate": <0.0-1.0>,
  "post_merge_bugs_caught": null,
  "panel_agent_invocations": <int>,
  "bug_yield_per_panel_agent": <float>,
  "skill_version": "<git sha at start of feature>"
}
```

`post_merge_bugs_caught` stays null until a real bug is reported against this feature; updated retroactively in a future retro.

### 7. Provenance histogram
**Input.** `bugs.md`'s provenance section.
**Output.** The same histogram, included verbatim.

## Append to learnings.md

After writing `retro.md`, append a single block to `state/learnings.md`:

```markdown
## <YYYY-MM-DD> · feature: <slug> · tier: <tier>
- <key learning 1, ≤ 20 words>
- <key learning 2, ≤ 20 words>
```

Atomic single-line append per learning (slug-prefixed) avoids races on concurrent feature work. If `learnings.md` exceeds 50 entries after the append, rotate older entries to `state/archive/learnings-<YYYY-QN>.md`.

## Don't do this

- ❌ Vague prose retros ("things went well").
- ❌ Skipping the provenance histogram.
- ❌ Chasing the dissent rate target by manufacturing disagreement (see `quality-signals.md`).
- ❌ More than 3 recommendations — forces prioritization.
- ❌ Recording learnings that just restate the recommendations. Learnings are *patterns observed*, recommendations are *what to do next*.
