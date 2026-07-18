# Panel 2 — eval-validity adversary (unshaken-extraction A2)

Mandate: attack the Revision-1 plan and panel-1 findings — find what lets a
wrong extraction ship, or a right design get blocked. Sources: plan.md
(REVISION 1 in force), all three panel-1 briefs, amended harness
(`scripts/__tests__/ingest-extraction.test.mjs`), A1 shell
(`scripts/ingest-podcast/{index,load}.mjs`), and **fresh corpus probes over
all 10 live Deepgram artifacts** (2026-07-18; every count below is measured,
grep over `data/podcasts/unshaken/*.deepgram.json`). The strongs lesson that
governs this brief is learnings.md:104 verbatim: "verify the counts of your
verifiers."

## Findings

### A1: The eval packet cannot support the verdicts the gate needs — near-miss errors AND near-miss traps are unverifiable from ±2 utterances

**Tag: material**

Evidence: the sample item is `{episode, t, quote, claimed target, transcript
context ±2 utterances}` (plan §eval). ±2 utterances ≈ ±9–25 s. But the plan's
own probe 2 says chapter context "carries forward across many verse mentions"
— panel-1 F2 proved it is established *minutes* earlier (ch-21 entered at
9327s governs bare refs through 9786s). So for a bare "verse nine" item —
the 0.90-gate stratum — the packet contains no information distinguishing
`2-kgs-21-9` from `2-kgs-20-9`. The evaluator can only (a) trust the claimed
target (rubber stamp), (b) re-derive the timeline from the full transcript —
re-running the same inference, same model, that produced the answer
(circularity, see A3), or (c) guess. Symmetrically, F7's flagship near-miss
trap (wrong-but-existing verse under the adjacent chapter) is *by
construction uncatchable from the packet*, so an honest evaluator fails the
≥11/12 bar and a correct pipeline gets declared suspect — both failure
directions of my mandate in one artifact. Panel-1 F6/F7 specified traps and
gates but accepted the packet schema without checking it could carry the
verdicts; their own F2 evidence refutes it.

Recommendation — kind-specific independent-evidence packets, the single
strongest de-correlation available because the canon is ground truth the
extractor never conditioned on (it reads only the transcript):

- **verse/chapter items**: include the claimed verse's canonical TEXT plus
  the same verse number's text in every other episode-block chapter (uniform
  for all verse items, so its presence signals nothing about trap-ness).
  Judging "does the discussion match this verse's content?" is a different
  task on a different information channel than transition-detection —
  correlated failure requires the discussion to match the *wrong* verse's
  canon text, which is exactly what near-misses can't fake. Also include the
  nearest PRECEDING utterance matching /chapter|kings|section/i, picked by
  code (deterministic), not by the extractor.
- **person/place/event items**: entity's canonical name + description + the
  episode's candidate roster; the check is narrative consistency
  (description vs context), not name-similarity re-derivation.
- **principle items**: principle definition + a stated rubric — "the quote
  must contain the teaching, not merely the topic word" (see A4).
- Define the grading rubric in the plan: correctness = target identity;
  anchor errors (t/seq off) tracked as a separate count, not precision
  failures, unless >30 s (pick and record).

### A2: Trap-ness is detectable by artifact — the amended harness PINS the leak

**Tag: material**

Evidence, three independent leak channels:

1. `seedTraps` returns `evalSample` whose trap items carry `__trap: true`
   (harness :475–483 asserts `evalSample.filter((m) => m.__trap).length === 2`).
   Nothing pins a stripped serialization; if the reviewer artifact is
   `JSON.stringify(evalSample)` — the natural implementation — the evaluator
   reads the answer key inline. The harness as amended makes this leak the
   *tested* behavior.
2. Fabricated quote/context: if traps are fabricated mentions (plan:
   "12 fabricated mentions"), their quotes are not verbatim transcript text
   at their `t`. The evaluator is a repo agent with grep; "verify the quote
   exists in the transcript" is step 1 of any diligent check — it unmasks
   every fabricated trap while validating nothing about target-checking.
   12/12 catch, zero diligence measured.
3. Trap count and recipe are published in plan.md (§eval: "12 fabricated…
   ≥11/12"; §traps-are-near-misses lists the three shapes). A repo-reading
   evaluator can rank suspicion and select top-12. Even the honest one is
   contaminated by knowing K.

Recommendation: (a) traps are REAL extracted mentions with only the target
swapped — quote/t/seq/context verbatim from the source mention (mutate
target to the F7 near-miss shapes); pin with a fixture: trap quote ∈
transcript, trap differs from source only in `target`. (b) The reviewer
artifact is stripped (no `__trap`, no ordering signal, shuffled under rng)
and the answer key is NEVER persisted during review — `seedTraps` is
deterministic under rng, so derive the seed from the extraction artifact
hash + round number and *recompute* trapIds at scoring time. (c) Vary trap
count per run (e.g., 10–14 drawn from the seed) so published "12" stops
being usable. (d) Emit sample and extraction as separate files and pin that
`load-extraction.mjs` never opens the sample path — H8's `__trap`-refusal
(harness :485–496) is field-based and cannot catch a stripped trap; the real
containment is that the load path structurally never reads the sample file.

### A3: "Fresh-context agent + me" — the trap-seeder is on the catch jury, and the fresh agent isn't fresh

**Tag: material**

Evidence: plan §eval names the checkpoint reviewer as "fresh-context agent +
me". Under Revision 1 "me" is the orchestrating session that (a) spawned the
judgment agents, (b) runs `seedTraps` and sees `trapIds` in-session, (c)
authored the trap recipe in plan.md. "Me" catching traps measures memory,
not diligence — and the aggregation rule when the two reviewers disagree is
undefined (fresh agent 9/12, me 12/12 → pass?). The "fresh" agent is spawned
by me with a prompt I write ad hoc (contamination channel: one pasted
rationale or trap hint voids the run), inherits full repo tools, and can
read plan.md, `<id>.judgment.json` (the extractor's own alias tables and
timeline reasoning), and the harness fixtures.

Recommendation — concrete de-correlation mechanics, all in-session and
Revision-1-compliant:

1. "Me" is excluded from the catch denominator; scoring is code
   (recomputed trapIds vs recorded verdicts), never an agent.
2. Evaluator agents are spawned from a **version-controlled, hash-pinned
   prompt file** (extend the drift-baseline stanza: eval-prompt-hash next to
   harness-hash) that takes exactly one parameter: the packet path. The
   orchestrator passes no free text.
3. Define the evaluator as a restricted agent (`.claude/agents/…` frontmatter,
   Read-only tools) pointed at a self-contained packet directory (sample +
   per-episode transcript + A1 canon texts); no judgment artifacts, no
   plan.md in the packet.
4. **Refute-framing**: the prompt presumes each item wrong — "find the error
   in this mention; state the evidence that would falsify it; only then
   verdict" — breaking agreement-bias with the extractor.
5. **Shard the eval**: one agent per kind per ~10–15 items (120 items in one
   context degrades late items). Seed ~10% duplicate items across shards —
   inter-shard disagreement on duplicates is a free diligence signal that,
   unlike traps, cannot be gamed by artifact detection.
6. **Model diversity**: judgment phases and eval phases run on different
   Claude models (both are in-session subagents; the Agent tool takes a
   model override). Same family, but different checkpoints break some
   correlated priors at zero cost.
7. Two-sided calibration: alongside traps, plant ~4 **gold known-correct
   items** (e.g., title-derived chapter DISCUSSES pairs, verified by
   construction). Refute-framing without golds invites over-refusal —
   deflated precision → a right design blocked. Golds rejected = evaluator
   over-strict; traps missed = evaluator lenient. Report both.

### A4: Principle precision is unfalsifiable by a same-prior evaluator — the 0.80 gate must be conditioned on per-kind trap catch

**Tag: material**

Evidence: principles are full-pool thematic judgment (Q3), the most
subjective stratum. Extractor and evaluator share the model and the leniency
prior; "does this quote teach Faith?" answered twice by the same prior is an
agreement measurement, not an accuracy measurement — measured principle
precision converges on ~1.0 independent of truth. The only instrument that
detects this is the plausible-but-absent principle trap — and the pooled
≥11/12 bar lets exactly the principle traps be the ones missed (1 of ~3–4
missed still passes the pool) while the 0.80 principle gate stands on an
evaluator demonstrated blind in that kind.

Recommendation: per-kind trap accounting with a per-kind floor (miss ≥2
traps of a kind → that kind's precision number is VOID, gate not evaluable,
re-run eval with mechanics fixed — not "iterate the extractor"). Record in
the artifact: trap catch per kind next to precision per kind. Pair with A1's
principle rubric and A3's refute-framing; those three together are the only
path to a principle number that means anything.

### A5: Gate arithmetic is undefined — allocation, operand, and trap accounting; at the plausible n, 0.90 is undecidable

**Tag: material**

Evidence: "12 mentions/episode (120 total) across kinds" fixes NO per-kind
n. Uniform over 6 kinds → n=20/kind; uniform over the 3 gate strata →
n=40/stratum; proportional to population (verse refs dominate: 148 in one
episode) → n_verse ≈ 55–70. The harness pins only `perEpisode: 12` and
"some verse && some person" (:500–510). Then: at n=20, a PERFECT 20/20
yields Wilson 95% LB = n/(n+z²) = 0.839 < 0.90 — the gate cannot be
demonstrated even by perfection; at n=40, the panel's own math (36/40 = 0.90
→ LB 0.77) means a pass is compatible with true precision ~0.77. The plan
says CIs are "honestly stated" but never says what the gate COMPARES —
point ≥ 0.90 (false confidence) or LB ≥ 0.90 (needs ~59/60; blocks right
designs). Also unstated: whether the 12 traps sit inside the 120 (real
n=108) or on top (132). And thin kinds (events; fixture pool has zero) can
gate-pass on n≈15 — 13/15 = 0.867 ≥ 0.85 with LB 0.62.

Recommendation: (a) allocate by KIND, not episode: verse/chapter ≥60,
person/place/event ≥60 (with per-kind sub-floors so events can't hide),
principle ≥40 — under Revision 1 review labor is agent-priced, so panel-1
F6's "one human sitting" ceiling no longer justifies n=120 (see
disagreement D2); (b) explicit recorded rule, e.g. **pass = point ≥ gate AND
Wilson LB ≥ gate − 0.08 AND n ≥ 30**, else "not evaluable → targeted
oversample"; (c) traps and golds ride ON TOP of the target n; (d) the
checkpoint artifact MUST report, per kind: n, correct count, point, Wilson
95% CI, per-episode n×correct matrix, trap catch (A4), gold acceptance
(A3.7), sample rng seed, evaluator model + prompt hash, and the episode-
weighted-vs-mention-weighted statement. A gate that doesn't print its n is
false confidence by construction.

### A6: The iteration round re-grades against a leaked answer key

**Tag: material**

Evidence: "Below gate: one iteration round, re-eval" is the entire spec. By
round 2 the orchestrator holds round-1 verdicts and trap ids; nothing forbids
(a) patching the 12 graded items instead of the extractor, (b) reusing the
round-1 sample/traps with an evaluator (or "me") that has seen the key, or
(c) feeding eval verdicts to a judgment agent as "corrections" — which can
inject trap-derived mentions into the mention set through the repair loop,
the one trap→load contamination path H8 cannot see (it's not a `__trap`
object crossing the builder; it's information crossing sessions).

Recommendation: pin the iteration protocol in the plan: fixes touch
extractor code/prompts/alias tables ONLY, never individual mentions; re-eval
= full re-extract → fresh stratified sample → fresh trap seed (A2's
seed = artifact-hash + round number gives this for free) → fresh evaluator
agents. Round-1 eval artifacts are inputs to diagnosis, never to grading.

### A7: Fixture vocabulary is one episode deep — corpus census refutes generalization; novel variants must surface at RUN time

**Tag: material**

Evidence (measured over all 10 artifacts, 2026-07-18):

- **"Doctrine and Covenants" 120× · "section N" ~85×** — a foreign-ref
  container the fixtures never name. Every pattern in the harness keys on
  "chapter N"/"<book> N"; "section 8" matches neither, and D&C is foreign to
  every OT episode. A D&C tangent that opens no foreign window resolves its
  bare "verse N" refs against the stamped 2 Kings chapter — F3's exact
  wrong-existing-verse hazard, at 120× corpus incidence.
- **Numeral-only transitions exist in the FIXTURE episode** and in
  6lXWLIOUKC8 ("…thus ends chapter 23. Now 24" — grep-confirmed) yet panel
  F2's rec (a) explicitly named this form and the amended harness has no
  fixture for it. The amendment encoded the panel's examples, not the
  panel's rule.
- **Relative refs**: "next verse" 52×, "last verse" 15×, "second verse" 12×,
  "first verse" 8×, "final verse" 8× — unparseable by digits+number-words;
  silent recall loss, currently uncounted anywhere.
- **"verses 23 through 25"** (4×) — plural-digits "through" range, unpinned
  (fixtures pin "from verse four to verse 24" and elided word-pairs only).
- **Book diversity**: episode heads across the corpus include Exodus (109),
  Leviticus (89), Joshua (43), Samuel (28), Alma (20), Helaman (8) — the
  per-episode book alias map and foreign-book list vary widely; fixtures are
  2-Kings-only, and the fixture `foreignBooks` map has 2 entries.

Recommendation — the plan needs a RUN-time novelty surface, not more
fixtures (the next episode always breaks fixtures): (a) derive `bookAliases`
+ `foreignBooks` from the canonical book list in `packages/scripture`
(+ container nouns: chapter | section | psalm), never per-episode hand maps;
(b) extend the judgment brief with a deterministic **coverage block**:
episode-block chapters with zero timeline segments (F2's silent-chapter
alarm); per-segment existence-failure counts — a CLUSTER of "verse 23 in a
21-verse chapter" drops is a mis-stamped-segment alarm, upgrading H3 from
silent fail-closed to a detector; unmatched capitalized-head+number bigrams
("Helaman 8", "section 8" heads not in any alias map); counts of unparsed
relative refs; % utterances inside foreign windows. Timeline-review agents
consume this block; a threshold breach (e.g., a block chapter with no
segment) fails the episode's extract stage loudly, BEFORE eval ever runs.

### A8: Foreign-window close semantics are undefined — an unclosed window silently swallows the rest of the episode

**Tag: risky**

Evidence: the fixture's window closes on an explicit return cue ("coming
back to our chapter", harness :200–213). Real resumptions are often cue-less
("So Hezekiah then…"). An unclosed window drops every subsequent in-block
verse ref — a recall crater invisible to a precision-only gate, and it
starves the verse stratum of eval items (compounding A5).

Recommendation: decide and record the default: a window closes at the first
in-block explicit chapter/verse-with-book reference, or after N (~15)
utterances without foreign-book tokens, whichever first; report per-window
durations in the A7 coverage block with an alarm at, say, >15% of episode
utterances inside windows.

### A9: The harness pins pre-first-segment fallback to "stamp the first chapter" — a guess graded as truth

**Tag: risky**

Evidence: harness :101–107 pins intro material (before any evidence-backed
segment) to the first block chapter. Episode intros are recaps of the
PREVIOUS episode ("last week… Naaman"); a recap's bare "verse fourteen"
stamps `2-kgs-14-14`, which exists (29 verses) — wrong-but-existing edges
manufactured by the pinned fallback, charged against the 0.90 gate.

Recommendation: flip the pin: refs before the first evidence-backed segment
are dropped + logged (or capped ≤0.5 confidence, below the write floor),
and the intro span is routed to timeline-review as a flagged ambiguity.

### A10: Agent-produced alias tables need deterministic validation — census membership, pool membership, collision handling

**Tag: risky**

Evidence: the alias-map phase replaces panel F1's edit-distance heuristic
with agent judgment, but nothing validates agent output. Hallucinated
aliases (a variant token that never occurs in the transcript) silently
enable false matches; and genuinely ambiguous tokens exist — Joram/Jehoram
are two contemporaneous kings (Israel and Judah), and an alias table that
maps "Joram" to one entity first-wins the other into systematic
misattribution that the same-model evaluator will ratify (A3 correlation).

Recommendation: code-side validation of every alias table: each alias MUST
occur in the transcript token census; each canonical id MUST be in the
episode pool; a token claimed by two entities is a COLLISION routed to the
judgment brief (never first-wins), resolved per-mention by context or
dropped. Keep F1's edit-distance-1/≥4-chars scan as the agents' INPUT
(candidate variants), not as dead code. Add a collision fixture to the
harness.

### A11: A1 repair migration — validate the unwrap, close the double-wrap hole, scope entities, and make repaired-state a load prereq

**Tag: risky**

Evidence + attacks on `(metadata #>> '{}')::jsonb`:

- The `WHERE jsonb_typeof(metadata)='string'` guard makes object rows safe
  and the migration idempotent — that part holds.
- But a string row whose content is not valid JSON aborts the UPDATE
  mid-migration (`::jsonb` cast error), and one whose content is valid JSON
  but NOT an object (e.g. `"3"`, doubly-wrapped `"\"{…}\""`) either survives
  as a string (double-wrap: one unwrap yields another string — single pass
  leaves it) or ships scalar metadata. Probe showed single-wrap on the
  sample, but 184 rows across multiple A1 runs are asserted-uniform, not
  proven-uniform.
- The entities table HAS `collection_id` (load.mjs:69 inserts it) — the
  plan's repair item names entities but not their WHERE clause; scope both
  tables by `collection_id='unshaken' AND jsonb_typeof='string'`.
- Ordering: if load-extraction runs before the repair, the title-edge
  UPDATE's jsonb merge on a string scalar errors and aborts the per-episode
  tx. The plan sequences prose, not mechanism.
- The :232 fix (confirmed live: `s.values.map((v) => (v !== null && typeof
  v === 'object' ? JSON.stringify(v) : v))`) changes serialization for EVERY
  object/array value in every A1 statement kind, not just metadata — a
  top-level array value would flip from JSON-string to PG-array semantics.

Recommendation: DRY_RUN phase fetches all string rows and `JSON.parse`s each
in JS, asserting result-typeof object — abort with row ids otherwise; run
the UPDATE in a loop until zero string rows remain (double-wrap defense) and
assert that as an in-migration invariant, not only in later smoke; add a
`jsonb_typeof` prereq check for `--stage=load-extraction` via
`assertStagePrereqs` (index.mjs:242 — the house mechanism); when fixing
:232, enumerate every A1 statement kind's value types and pin serialization
per kind in the A1 harness (the F1-regression test covers A2's builder only).

### A12: "Journaled resume = per-agent retry native" is asserted, not probed — the workflow substrate doesn't exist yet

**Tag: risky**

Evidence: `.claude/workflows/` is absent from the repo; the Workflow-tool
journaling semantics the plan leans on are unverified — this is the same
class of error as the plan's superseded Batch-API cost figure (constant
asserted, probe pending). If resume is weaker than assumed, a crashed
40–50-agent run restarts from zero, and partial judgment artifacts of
unknown validity get consumed by extract-merge.

Recommendation: decided default that works regardless of substrate: every
judgment agent writes its own artifact (`<id>.aliases.json`,
`<id>.timeline-review.json`, `<id>.principles.<w>.json`) with the reliability
panel's F3 validity predicate re-targeted: parses + schema-shaped + coverage
matches a deterministic recompute (e.g., principles windows cover all
utterances; alias table covers all zero-hit pool names). Skip-if-valid per
artifact = file-based resume, workflow journaling becomes a bonus.

### A13: Plan text still instructs a Batch-API build — direct contradiction of the Revision-1 directive

**Tag: material (clerical)**

Evidence: Files-touched line for `extract.mjs` reads "passes 1+2, chunking,
**batch client**, aggregation"; the harness's H5 custom_id namespace
(`unshaken-x:p2:1`) and `buildExtractionSchema`/prompt-builder tests carry
Batch-era vocabulary. An implementer following Files-touched builds a batch
client — violating Abram's verbatim "you are not to use the anthropic or any
api". Drift hashes are PENDING; fix the text now: "batch client" → "workflow
agent-brief builder + result assembly", and re-document H5 as workflow-agent
result assembly (the keyed, order-independent, missing-window-fails-episode
semantics transfer unchanged and are worth keeping).

### A14: Trap/gold items and the 120-sample interplay with kind strata is unstated in the harness

**Tag: noise**

`stratifiedSample` pins determinism and the per-episode cap only; allocation
and trap top-up are A5's plan-level fixes — no separate harness change
needed beyond what A2/A5 already require. Recorded for completeness.

### A15: Evaluator wall-clock and cost under sharding

**Tag: oos**

~12–16 eval shards + ~40–50 judgment agents is session-token load, not
external spend; scheduling/context budgeting for the orchestrating session
is an implementation concern outside eval validity. Recorded.

## Panel-1 disagreements

- **D1 — pipeline-reliability F1/F2/F4/F6/F7 (and most of F5) are
  superseded** by Revision 1 (no Batch API, no polling, no ANTHROPIC key, no
  per-request billing). Its verdict's blocking conditions ("address F1, F2,
  F3, F4 before implementation") must NOT be carried forward as written or
  they block a design that no longer contains the attacked surface. What
  survives, re-targeted: F3's validity-predicate discipline → judgment
  artifacts (A12); F2's durable-raw-layer spirit → per-agent artifacts
  (A12); F8's eval-verdict-as-mechanical-prereq → keep verbatim, it is the
  checkpoint's only enforcement and pairs with A5's report spec.
- **D2 — llm-quality F6, partially**: the per-kind gates and honest-CI recs
  were right and the plan adopted them — but adopting per-kind gates while
  KEEPING n=120 made the arithmetic worse (smaller n per gate), and F6's
  sizing ceiling ("150–180 items is still one sitting") was a human-review
  constraint that Revision 1 dissolved. The plan inherited F6's apology for
  small n while discarding the only reason for it (A5).
- **D3 — llm-quality F6/F7's implicit packet acceptance**: F6 assumed
  human review and F7 designed near-miss traps, but neither checked that the
  sample schema (±2 utterances) can carry a chapter verdict at all — their
  own F2 evidence (chapter context established minutes earlier) refutes it.
  This predates Revision 1; a human reviewer is equally blind in that packet
  (A1). The traps-vs-packet contradiction (F7's near-misses uncatchable in
  F6's artifact) is a panel-1 internal inconsistency.
- **D4 — llm-quality F4 (dedupe window)**: plan kept ±5s (Q2). Under
  Revision 1 every mention is seq-native (code extractors + seq-citing
  agents), so `|Δseq| ≤ 2` is strictly simpler and drops the t-arithmetic
  entirely. Noise-level; record, don't block.
- **D5 — data-integrity F1's repair SQL**: direction right, mechanics
  incomplete — no parse validation, no double-wrap loop, no entities WHERE,
  no load-order enforcement (A11). Agree-and-tighten, not a refutation.
- **Concur without reservation**: data-integrity F2 (id shapes — fixtures
  now match prod), F4 (source column — the single best de-risking in the
  revision; it makes A2's idempotency independent of the A1 repair), F3
  (A1-rerun wipe); llm-quality F1/F2/F3 field evidence (all reproduced in my
  corpus probes).

## Verdict

**Not approvable as specified — the gate, not the extraction, is the broken
part.** Revision 1's architecture is genuinely stronger than the Batch
design (deterministic cores, $0 marginal re-runs, file-based resume), and
that same property removes every excuse for the eval's remaining weaknesses:
re-runs are free, so n can grow; agents are free, so evaluators can be
sharded, restricted, and re-spawned fresh. As written, though, the
checkpoint measures agreement between correlated instances of the same
model, over packets that cannot carry the hardest verdicts (A1), with traps
the harness itself pins as self-identifying (A2), graded partly by the agent
that seeded them (A3), against gates with undefined n and comparison operand
(A5), and with an iteration loop that reuses the answer key (A6). Each of
those independently voids the precision number the lens green-light rests
on. Land A1–A7 + A13 as plan amendments (all cheap while drift hashes are
PENDING), record decided defaults for A8–A12, and the eval becomes what the
plan calls it — a load-bearing wall — instead of a mirror.
