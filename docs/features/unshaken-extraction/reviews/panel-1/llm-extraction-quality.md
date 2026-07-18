# Panel 1 — LLM extraction quality (unshaken-extraction A2)

Reviewer lens: LLM extraction quality only. Grounded against the real Deepgram
artifact `data/podcasts/unshaken/4pSrikfJ5Yw.deepgram.json` (3,045 utterances,
3.6 h, 2 Kings 14–25 episode) — every transcript quote below is verbatim from
that file. Plan: `docs/features/unshaken-extraction/plan.md`. Harness:
`scripts/__tests__/ingest-extraction.test.mjs`. Design:
`docs/design/media-collections.md` §rules-3/4.

## Findings

### F1: Exact-name prefilter is defeated by ASR spelling variants — the episode's main figure is invisible

**Severity: high**

Evidence: the plan prefilters candidates as "persons/places/events whose names
appear in the chunk text — typically 5–20", and the harness pins
case-insensitive whole-word matching (`prefilter: case-insensitive whole-word
name match`). But Deepgram consistently transcribes Ahaz (canonical KJV
spelling, 2 Kings 16) as **"Ahas" — 47×; "Ahaz" appears 0×** in the artifact:

> [593s] The next king, Jotham's son, is named Ahas.

A whole-word match on the canonical name yields **zero** candidate hits for
Ahaz across his entire ~39-minute chapter — so every one of his 47 named
mentions is either unlinkable (recall loss) or, worse, pushed onto whatever
candidates DID match in the chunk (precision hazard: the model is invited to
misattribute). The plan's probe evidence has a blind spot here — probe 3 says
"Proper-noun quality story-consistent (Sennacherib 8×…). Keyterm boost worked"
— the boost worked for Sennacherib but demonstrably not for Ahaz, in the same
sample episode the probe examined. A1's transcribe stage already feeds
keyterms (`buildDeepgramRequest({ keyterms })`, `keytermMax: 100`), so the
canonical-name list existed and the variant still shipped.

Recommendation: add an alias layer to `prefilterCandidates` — (a) an explicit
`aliases: []` field on pool entries, seeded by diffing the keyterm list
against the actual transcript vocabulary (a one-time code-side scan per
episode: canonical names with 0 hits but a near-miss token ≥4 chars within
edit distance 1, e.g. Ahaz→Ahas, get the variant recorded); (b) keep the
word-boundary discipline (the "Ai"/"again" fixture) and a min-length guard so
fuzziness never matches short names. Add a harness fixture: pool name "Ahaz"
must match transcript "Ahas". Secondary: carry forward "recently active"
candidates (named entities matched in the previous ~100 utterances) into each
chunk's candidate list, so pronoun spans longer than the 10-utterance overlap
retain their antecedent.

### F2: Pass-1 "explicit chapter transitions" misses inline-entered chapters → runs of wrong-but-existing verse ids

**Severity: high**

Evidence: the plan defines pass 1 as a "full-transcript sweep of explicit
chapter transitions". Announced transitions do exist and are findable ("[617s]
…So let's meet him in chapter 16.", "[5015s] Back to second Kings chapter 18",
"[7599s] turn to chapter 20"). But **chapter 21 (Manasseh, 38 name mentions,
~8-minute verse-by-verse study) is never announced**. It is entered only
inline:

> [9327s] In verse three of second Kings 21, he built up again the high places…

followed by bare refs "[9416s] In verse six…", "[9433s] …verse seven",
"[9472s] verse nine", "[9486s] …verse 10", "[9618s] …verse 11", "[9665s] Look
at verse 12.", "[9786s] …according to verse 23". If pass 1 emits no ch-21
segment, those chunks are stamped `2kgs-20`, and since 2 Kings 20 has 21
verses, **verses 3/6/7/9/10/11/12 all exist there — 7 of 8 refs ship as bad
edges; only "verse 23" trips the existence check**. Fail-closed resolution
(H3) is structurally blind to in-block wrong-chapter errors. Chapters 14–15
show the fully-silent variant: Amaziah/Uzziah/Jotham are surveyed with no
chapter-number utterance at all (of the 42 utterances containing "chapter",
the first in-block cue is ch 16 at 617s; "[142s] …second Kings 14 through 25"
is the block announcement, not a transition).

Recommendation: (a) pass-1 prompt must define a transition as "any explicit
chapter reference that establishes governing context", explicitly including
inline forms ("in verse three of second Kings 21") and numeral-only forms
("thus ends chapter 23. Now 24" [11888s]); (b) pass-1 output should carry
per-segment `{evidence_quote, explicit: bool}` so code can log a coverage
report (episode-block chapters with no segment = known-risk spans); (c) bare
verse refs falling in low-evidence spans get capped confidence or are routed
into the eval sample disproportionately. H1's fixtures cover stamping
mechanics but no fixture exercises a timeline that is *missing* a studied
chapter — add one pinning whatever mitigation is chosen.

### F3: Cross-book tangents — bare verse refs under a stamped 2 Kings context resolve to wrong existing verses

**Severity: high**

Evidence: the speaker detours constantly (Chronicles 22×, Isaiah 38×, Nephi
7×, Helaman 2×). During the 2 Kings 16 study:

> [1197s] notice what happens in chapter 28 verse nine and ten.

— that is 2 Chronicles 28 (the Oded/POW episode), read aloud for minutes.
Similarly "[9028s] In the Chronicles version of this, you see it in chapter 32
verse 30", "[11780s] chapter 35 verse twenty one and two" (2 Chr 35:21–22),
"[12389s] Helaman chapter eight verse 21". The *labeled* forms are caught by
the episode-block check (chapters 28/32/35/8 ∉ 14–25 → dropped). Two residual
hazards: (a) a model that obeys its stamped chunk context and emits
`{chapter_ctx: '2kgs-16', verse_num: 9}` for "verse nine and ten" produces a
**wrong existing verse** (2 Kings 16 has 20 verses); (b) in other episodes the
tangent's chapter number can fall *inside* the block (e.g. 2 Nephi 12–24 =
Isaiah quotations collide with a 14–25 block), making even the labeled form
pass all code checks. The plan does not state whether `chapter_ctx` is
constrained to the stamped context, may be any block chapter, or how
foreign-book spans are to be treated.

Recommendation: prompt rules, stated in the plan: (1) verse mentions are
emitted ONLY for the episode's book; when the speaker is reading another book
(Chronicles/Isaiah/Book of Mormon), emit nothing for those verses in v1; (2)
`chapter_ctx` = explicitly-spoken chapter when present, else the stamped
context — never a guess outside both; (3) the chunk prompt should name the
episode's book ("2 Kings") so "the Chronicles version" is recognizable as
out-of-corpus. Add a harness/prompt fixture with a foreign-book tangent, and
seed at least one eval trap of exactly this shape (see F7).

### F4: Model-emitted `t` contradicts the design's seq-anchoring rule; dedupe then operates on the weaker signal

**Severity: medium**

Evidence: design §rules-3: "Extraction MUST emit block anchoring (`seq`), not
bare seconds." Yet the plan's mention schema requires the model to emit both
`seq` and `t` (harness: `for (const k of ['kind','target_hint','seq','t',…]
… item.required.includes(k)`), pass 1 emits **bare seconds only**
(`[{t_start_s, chapter}]`), and dedupe keys on `t` (±5s). Models are
unreliable at timestamp arithmetic, and the prompt's line format is ambiguous
at this episode's 3.6 h length: `formatSeqLine` pins `[7 @ 12:34]` (mm:ss) —
at 12,971s that renders "216:11" unless the format grows an hours segment,
which no test pins. A model-computed `t` that disagrees with `seq` poisons
dedupe and every downstream mention array.

Recommendation: treat `seq` as the only authoritative anchor everywhere:
(a) code recomputes `t = utterances[seq].t_start_s` after parsing, ignoring or
merely sanity-logging the model's `t` (or drop `t` from the schema); (b) pass
1 emits the transition **seq**, with `t_start_s` derived in code; (c) pin
`formatSeqLine` for >1 h inputs (h:mm:ss). On the dedupe window: with ~4.3s
average utterances, adjacent chunks can anchor the same moment to neighboring
utterances; on code-truth `t`, ±5s covers ~1 utterance of disagreement.
Prefer `|Δseq| ≤ 2` (or widen to ±10s within overlap spans only) — with
code-derived `t` this is a two-line change.

### F5: Verse ranges are unhandled — plan and harness are silent where the design doc names them adversarial

**Severity: medium**

Evidence: design risk 2 lists "ranges" among adversarial spoken references.
The transcript delivers them in three shapes: paired — "second Kings chapter
16 verse seven and eight" [1552s]; truncated compound — "chapter 35 verse
twenty one and two" [11780s] (= 21 and 22; a naive parse yields verse 2);
span — "basically from verse four to verse 24" [10884s]. The plan's schema
(`verse_num`, singular), failure-mode list (H1–H9), and the harness contain no
range case at all.

Recommendation: decide and record the v1 policy. Cheapest sound option: the
model emits one mention per explicitly-named endpoint (7 and 8 → two
mentions; "four to verse 24" → two mentions, no expansion of the middle —
expansion inflates DISCUSSES edges with verses never actually read). Add the
"twenty one and two" shape to prompt examples, and a harness fixture pinning
endpoint-only behavior. If ranges are instead deferred entirely, say so in
the plan — silent nondeterminism here will surface as eval noise against the
0.90 gate.

### F6: Eval sample is too small per stratum for the gates it must defend, and principles share a gate with name-matched entities

**Severity: medium**

Evidence: "Stratified sample: 12 mentions/episode (120 total) across kinds"
against gates "≥0.90 verse/chapter anchors, ≥0.85 entity links". At a
plausible split (~40–60 verse/chapter items), a measured 0.90 has a 95%
Wilson interval of roughly [0.77, 0.96] at n=40 and [0.80, 0.95] at n=60 — a
pass is compatible with true precision near 0.80, on the metric the design
calls "the load-bearing wall". Worse, "entity links" apparently pools
persons/places/events (name-prefiltered, should be high precision) with
principles (full-pool thematic, the plan itself expects "lower precision", Q3)
— strong persons can mask weak principles and green-light the lens for a kind
that embarrasses it. The 12/episode uniform draw also makes the estimate
episode-weighted, not mention-weighted (fine for coverage; worth stating).

Recommendation: (a) size by stratum, not per episode: guarantee ≥60
verse/chapter and ≥60 entity items (the checkpoint is human-reviewed; 150–180
total items is still one sitting); (b) report per-kind precision with Wilson
lower bounds in the checkpoint artifact, and record the lower bound — not
just the point estimate — in the lens green-light decision; (c) break
principles out as their own reported line even if the formal gate stays at
0.85; a principle-specific collapse must be visible, because TEACHES edges
feed the lens's most subjective surface.

### F7: Seeded traps must mirror the real failure modes or they validate nothing

**Severity: medium**

Evidence: the trap spec is "12 fabricated mentions (wrong verse / wrong person
/ plausible-but-absent principle)". If traps are gross fabrications, a
reviewer catching 11/12 proves only that the reviewer is awake — it does not
validate sensitivity to the errors this pipeline will actually make, which
this review shows are *near-misses*: right verse number under the wrong
chapter (F2's `2kgs-20-9` vs `2kgs-21-9`), a tangent verse attributed to 2
Kings (F3's 2 Chr 28:9 → `2kgs-16-9`), a sibling king swapped under an
epithet ("the king" appears 79×; Ahab/Ahas are explicitly play-alikes —
"[600s] …go ahead and get them confused because they're both equally
wicked").

Recommendation: compose the 12 traps deliberately: ≥6 near-miss (adjacent or
cross-chapter verse with correct verse number, tangent-book verse, sibling
king/epithet swap, plausible-but-untaught principle over a real quote), the
rest gross (calibration floor). Keep the ≥11/12 catch bar. Record the trap
recipe in the checkpoint artifact so the strongs seeded-trap lesson is
auditable, and keep H8 containment exactly as pinned.

### F8: Recall is unmeasured — correctly, for a precision-gated v1 — but the plan never says so

**Severity: low**

Evidence: the eval section defines only precision gates; no sentence in
plan.md states that recall is out of scope, yet the misses are systematic and
large: pronouns ("he" 444×), epithets ("the king" 79×, "man of God" 2×), plus
F1's spelling gap. The design's own lens guardrail ("Through: Faith · 7
moments of a 52-min episode") makes low recall *user-visible*: a lens showing
7 moments when 20 exist is the quiet twin of the "filtered episode posing as
the whole thing" trust bug. Name-prefiltering's miss profile is acceptable
for v1 — an unlinked epithet is a missed moment, not a wrong edge — but the
tradeoff should be recorded, not implicit.

Recommendation: one honest paragraph in the plan: recall is unmeasured in v1;
name-prefilter misses pronouns/epithets by construction; lens copy should say
"N linked moments", never imply exhaustiveness. Add a nearly-free coverage
proxy to the checkpoint artifact: per top entity, code-side name-hit count vs
extracted mention count (e.g. Hezekiah: 111 name hits → how many mentions?).
That single ratio flags catastrophic recall gaps (like F1's Ahaz: 47 hits, 0
possible mentions) without any labeling effort.

## Verdict

**sound-with-changes**

The architecture is right: two-pass with code-side stamping is the correct
mechanical answer to the anaphora density the probe measured (148 "verse N" vs
33 "chapter N"), closed-vocab + fail-closed resolution is the correct
precision posture, and chunk parameters (50/10 ≈ 3.5 min windows, ~43s
overlap) are adequate given the observed named-entity density (~3–6
names/chunk for governing figures). The harness is genuinely strong on
bookkeeping (H1–H9). But three findings are load-bearing before the batch
runs: F1 (alias matching — a main figure is currently invisible to the
candidate pool), F2 (pass-1 transition definition + coverage report — an
entire studied chapter currently misstamps into 7 wrong-but-existing verse
ids), and F3 (foreign-book tangent rule). F4–F7 are cheap plan/prompt/harness
amendments that materially de-risk the 0.90 gate; F8 is a documentation
honesty fix. With F1–F3 addressed and traps composed per F7, the eval design
is fit to green-light the lens.
