# Meta-review — panel-2 adversarial tagging (personal-notes, step 10)

- **Date:** 2026-07-30
- **Model:** opus
- **Scope:** tag QUALITY across the nine panel-2 lane files in
  `reviews/code-adversarial/`, judged against
  `.claude/skills/feature-workflow/references/adversarial.md` and the
  canonical `code-panel.md` (CP-1..73). Panel-1 lane files spot-checked
  where a tag looked suspicious (DATA-10, BR-3, PERFORMANCE-5).
- **Not in scope:** re-reviewing the code or re-deriving panel-1's claims.

## Tag census

| Lane | Findings | material | risky | out-of-scope | noise |
|---|---|---|---|---|---|
| security | 10 | 9 | 0 | 1 | 0 |
| correctness | 16 | 15 | 0 | 0 | 1 |
| api-contract | 10 | 9 | 0 | 1 | 0 |
| data-integrity | 11 | 7 | 0 | 0 | 4 |
| ux | 18 | 18 | 0 | 0 | 0 |
| accessibility | 13 (12 + 1 out-of-lane) | 12 | 0 | 0 | 1 |
| performance | 9 | 5 | 3 | 0 | 1 |
| observability | 10 | 9 | 0 | 0 | 1 |
| blast-radius | 8 (5 + 3 verified-clean) | 3 | 0 | 0 | 5 |
| **total** | **105 rows / 102 findings** | **87** | **3** | **2** | **13** |

Excluding blast-radius's three verified-clean entries (not findings):
**87 material of 102 findings = 85%; dissent rate 15% (15/102).** Rolling-window
comparison belongs to `references/quality-signals.md`; not asserted here.

## Per-lane verdicts

**security — calibrated.** 9 material / 1 out-of-scope. Every tag carries a
re-verified mechanism, and the lane is the only one that sized its own
findings downward in writing (SEC-1 "not a live leak today", SEC-8 "not a live
vulnerability", SEC-9 "fail-safe direction"). Its one non-material tag,
SEC-8 → CP-48 (`.or()` string concatenation), is the lane's only contestable
call: the fix is a regex plus one fixture at a seam the codebase itself
documents as "the single mockable seam" for future callers, so **material** is
at least as defensible as out-of-scope. I would not overturn it — the tagger
correctly reasoned that no present caller can reach it — but flag it as
should-carry-a-real-home if deferred. This is also the only lane that filed a
carve-out downgrade suggestion, and it filed it correctly (logged, not acted
on, with a counterweight against its own suggestion).

**correctness — calibrated.** 15 material / 1 noise, owning five of the
panel's carve-out findings and suggesting zero downgrades on any of them. The
tagger did real adversarial work in both directions: it caught a factual
misstatement inside CORRECTNESS-6 ("straight from the form" — the label does
route through the sanitizer) and correctly ruled the misstatement immaterial
to the verdict, and it STRENGTHENED CORRECTNESS-15 by finding the
`slice(0, 6)` suggestion cap that makes the stale-highlight commit routine
rather than edge-case. The single noise tag (CORRECTNESS-13 → CP-51) is
sound: append canonicalizes with the same `C` the canary uses, so the
residual deliverable really is a comment correction. No mistags found.

**api-contract — calibrated, with one soft tie-break question.** 9 material /
1 out-of-scope. API-CONTRACT-6 → CP-50 (append/append_undo stale 409s omit
`current`) is the panel's most contestable non-material tag. The tagger's
defense is textual and reasonable — A13's pin reads as scoped to the LWW
base-echo update, and the route's own contract comment scopes it that way —
but the finding also describes a shipped shape asymmetry in a ratified
contract with a one-line fix, which fits **material**. When a finding fits
both, the tie-break says material wins. I would not call this a violation
(the tagger argued the finding does *not* fit material today, rather than
picking the lower of two fits), but the synthesizer should resolve CP-50 as a
plan note rather than a silent defer. Everything else in this lane verified,
including the mechanism claims the tagger set out to refute.

**data-integrity — calibrated at the head, one hard tie-break violation at the
tail.** 7 material / 4 noise. The noise tags are *not* reflexive: each cites a
specific pre-existing defense the panel-1 finding failed to credit (DATA-9's
base-CAS ordering, DATA-10's `authenticated_exact_grant_shape` invariant,
DATA-8's `updated_at` trigger closing the window). That is engaged refutation
and it is the right posture. Two mistags:

- **DATA-10 → CP-57 should be `risky`, not `noise`.** The tagger's own
  rationale is a fix-quality objection: "the primary fix (drop notes_delete)
  relitigates A6's ratified four-explicit-per-command-policies style and would
  break the pinned `notes_policy_set_is_four_per_command` invariant."
  Confirmed against panel-1 (`code-panel/data-integrity.md:239-243` — the
  finding's preferred option is "drop the policy … and set the invariant to
  3-no-DELETE"). A fix that breaks a pinned invariant is the definition of
  risky, and **risky > noise**. Tagging it noise loses the rejection rationale
  from the record.
- **DATA-11 → CP-58 should be `out-of-scope`, not `noise`.** The tagger's
  words are "worth two lines whenever the file is next touched" — that is
  deferred future work, and **out-of-scope > noise**.
- **DATA-8 → CP-55** is borderline for the same reason ("fine hygiene");
  out-of-scope edges noise, but the tagger did substantively refute the live
  path, so I would leave it.

**ux — over-lenient by distribution, calibrated by rationale.** 18 material /
0 anything else — the only lane with zero pushback anywhere. That alone is a
calibration red flag and the synthesizer should treat this lane's material
rate as an upper bound, not as convergence. In mitigation: every rationale
cites re-verified source, the tagger corrected the finding *against the
lane's own interest* on UX-1 (body text IS styled by Tailwind utilities; only
headings/lists/blockquotes/wikilinks are flat), and three findings show the
tagger explicitly considering and rejecting a lower tag (UX-18 out-of-scope
rejected with reasoning, UX-11 noise rejected, UX-13 conceded as rarer than
claimed). Weakest tag: **UX-13 → CP-66**, where the storage-denied legend
fallback is an internal comment/code contradiction with negligible user
reach; material survives only on the hardcoded-⌘ half. UX-15 (CP-67
"Saved" on an empty note) and UX-16 (CP-68 false Backspace promise) are
copy-level and earn material only by composition with CP-1 and by being
one-line fixes — defensible, but they are where a stricter lane would have
spent its dissent.

**accessibility — calibrated.** 12 material / 1 noise. The noise tag
(A11Y-10 → CP-63) is correct — the deliverable is comment prose the finding
itself half-concedes. Weakest material: A11Y-8 → CP-62, a conformance nit
that earns material mainly because it folds into CP-11's fix at zero cost;
acceptable. The lane's most valuable output is not a tag at all: it flags
that A11Y-11's proposed "restore selection on keyboard closes only" carve-out
is in tension with A10's ratified "restored on every close; pointer-blur
exception does NOT apply" wording. That must reach the synthesizer.

**performance — the sharpest lane, and the site of the panel's clearest
tie-break violation.** 5 material / 3 risky / 1 noise. PERFORMANCE-4 → CP-30
`risky` is well-founded and should stand: the tagger disputes materiality
itself (sub-millisecond at realistic sizes) *and* shows the fix plumbs
`viewRef` into the A19 crash-preservation boundary, i.e. adds coupling inside
a data-loss containment path. Coherent. But:

- **PERFORMANCE-2 and PERFORMANCE-5 → CP-23 should be `material`, not
  `risky` (×2).** The tagger concedes the defect in its own first clause —
  "The projection gap is real (verified `.select(\"id, body_md, updated_at\")`
  at notes.server.ts:372)" — and objects only to the generated-column fix. A
  finding that catches a real risk fits material; when it also fits risky,
  **material > risky**. Confirmed against panel-1: PERFORMANCE-5's fix has a
  no-new-column half — "drop `body_md` from the list read entirely"
  (`code-panel/performance.md:134-136`) — which carries none of the
  schema-coupling or title-derivation-divergence risk the tagger objects to.
  Correct resolution is material with a scoped fix: incorporate the
  projection narrowing, reject the second generated column with the tagger's
  divergence rationale recorded verbatim.

PERFORMANCE-9 → CP-72 noise is right (informational, proposes no code change).

**observability — calibrated.** 9 material / 1 noise. OBS-7 → CP-59 noise is a
defensible operational judgment, not a dismissal: the `op` field already
carries the disambiguation the rename would add, and the one high-frequency
read op is removed by OBS-2's fix anyway. The lane also did the panel's best
piece of adversarial value-add: it found a *cleaner reachable leak vector*
for CP-14 than the finding itself cited (client-supplied `base_updated_at`
→ PG 22P02 echoing the raw string into `note_write_failed.message`). That
vector should be folded into CP-14's fix note and its fixture.

**blast-radius — calibrated; its noise-heavy shape is an artifact, not
dismissiveness.** Three of the five noise tags (BR-5, BR-6, BR-8) are
verified-clean audit entries that propose nothing — noise is the honest tag
for them under this taxonomy, but see Red flags: they must not be routed into
the retro noise aggregate as if they were bad findings. Of the five real
findings, three are material and two noise. BR-4 → CP-73 noise is correct
(dead path, fix is a comment). **BR-3 → CP-47 noise is correct at the finding
level** — panel-1 BR-3 literally proposes "None required"
(`code-panel/blast-radius.md`) — **but CP-47 as a canonical finding is
material**, because it also carries API-CONTRACT-8's `search.tsx:279`
session-read-outside-the-try defect. This is the panel's only cross-lane
conflict and it is a merge artifact rather than a tagger error; the tagger
even names it ("the sharper content in CP-47 … came from API-CONTRACT-8, not
this finding"). BR-8's "worth one line in the deploy checklist" rider is
future work → out-of-scope edges noise (minor).

## Cross-lane conflicts on shared CPs

Twenty CPs merge findings from two or more lanes. Nineteen are unanimous —
including every high/critical shared CP (CP-1 across correctness/ux/performance;
CP-3 across four lanes; CP-5, CP-6, CP-7, CP-15, CP-16, CP-43 all material from
every contributing lane). Exactly one conflict:

| CP | Lane A tag | Lane B tag | Resolution under tie-break |
|---|---|---|---|
| CP-47 (deferred-scope 400s / early session read) | api-contract: **material** (API-CONTRACT-8 — `search.tsx:279` `getSessionUser` outside the try that owns the 500 contract) | blast-radius: **noise** (BR-3 — bodies verified byte-frozen; finding proposes no change) | **material.** `material > noise`. Both tags are correct about their own finding; the CP merges them, so the CP inherits the higher tag. Resolve CP-47 as `incorporated` scoped to the API-CONTRACT-8 half (wrap the early-session block, emit `logSearchFailed` + 500-with-headers); BR-3's header-delta rider rides along as the plan/deploy-checklist note. |

Non-conflicts worth recording, because they *look* like disagreements: CP-5,
CP-6, CP-7, CP-18, CP-19, CP-20, CP-21, CP-22 and CP-4 all carry panel-1
severity disagreements noted inline in `code-panel.md`. Panel-2 tagged every
one of them material from every contributing lane. No tie-break needed.

## Safety carve-out downgrade log

> **For retro log — not acted on.** Per `adversarial.md`, findings tagged
> severity high (and a fortiori critical) in panel-1 with category security,
> data-loss, or correctness survive panel-2 regardless of tag or suggestion.

**Complete list — one entry.**

| CP | Finding | Suggesting lane | Suggestion | Rationale (tight paraphrase) |
|---|---|---|---|---|
| CP-5 | SEC-1 (high / security — carve-out protected) | security | high → medium | Exposure is browser disk cache and back-forward on shared devices plus a future-edge-rule hazard; the finding itself concedes "not a live leak today" (no Cache-Everything rule, no heuristic freshening without validators), and API-CONTRACT-2 independently sized the identical issue medium. The tagger supplies its own counterweight: the repo's doctrine (scripture.tsx:582, SECURITY-3) treats the Set-Cookie-replay class as security-mandatory, so high is defensible under house conventions. Explicitly framed as "a sizing note, not a dispute of the defect." |

**Carve-out hygiene — clean.** All nine lanes wrote an explicit
"Carve-out downgrade suggestions" section; eight wrote "None" with reasoning.
Five lanes (api-contract, accessibility, performance, observability,
blast-radius) went further and reasoned explicitly about whether their
high-severity finding's *category* fell inside the security/data-loss/
correctness trio before concluding the question was moot — that is above-bar
protocol literacy. **No lane appeared unaware of the carve-out.**

Separately verified: **no carve-out-protected finding received a
downgrade-by-tag.** Every noise, risky, and out-of-scope tag in the entire
panel landed on a low- or medium-severity finding. The carve-out was never
structurally breached, only once formally exercised.

## Red flags

1. **The ux lane rubber-stamped its distribution (18/18 material, zero
   dissent).** Its rationales are evidence-backed and it corrected the panel-1
   finding against its own interest twice, so this is leniency rather than
   negligence — but do not read UX unanimity as convergence, and expect CP-66,
   CP-67 and CP-68 to be the first candidates if scope has to be cut.

2. **Do not let CP-47 resolve to `dropped-as-noise`.** The synthesis step maps
   tags to resolutions per panel-1 *finding*, while `plan.md` and the aggregate
   are organized per *CP*. CP-47 is the only CP whose constituent findings got
   different tags. Apply the tie-break at the CP level: material.

3. **CP-23's double `risky` suppresses a conceded-real defect.** The
   performance tagger's own first clause concedes the projection gap is real
   and verified. Under `material > risky` the CP is material. Split the fix:
   incorporate "drop `body_md` from the list read" (no schema change, no
   divergence risk), reject the second generated column with the tagger's
   title-derivation-divergence rationale recorded verbatim. Resolving this as
   pure `rejected-with-rationale` would ship a verified 12.8 MB-worst-case
   projection with no record of a cheap available fix.

4. **CP-57 (DATA-10) is a risky finding mistagged noise.** If it resolves as
   `dropped-as-noise`, the reason it was rejected — the proposed fix breaks the
   pinned `notes_policy_set_is_four_per_command` invariant and relitigates A6 —
   disappears into the retro aggregate instead of the decision record. Resolve
   as `rejected-with-rationale`. CP-58 (DATA-11) should likewise resolve as
   `deferred-out-of-scope`, not noise.

5. **Three verified-clean entries (BR-5, BR-6, BR-8) are tagged noise because
   the taxonomy has no tag for "audited, found clean".** Routing them through
   `dropped-as-noise` would file three correct audit records into retro
   learnings as if they were bad findings, and would lose BR-6's off-switch
   verification (all four `notesEnabled` gates + the wrangler var) which is
   deploy-relevant. Route them to the audit record; note the taxonomy gap as a
   protocol improvement for retro.

6. **Both `out-of-scope` tags need a concrete home or they evaporate.**
   `deferred-out-of-scope` requires an issue or a retro recommendation:
   CP-48 (`.or()` seam validation) and CP-50 (append 409 shape asymmetry).
   CP-50 in particular is a one-line fix on a ratified contract — a plan note
   is the minimum.

7. **A11Y-11 / CP-64's proposed fix conflicts with a ratified pin.** The
   "restore selection on keyboard closes only" carve-out contradicts A10's
   "restored on every close; pointer-blur exception does NOT apply". The
   dismissal gap should be incorporated; the restore-semantics detail needs
   human reconciliation against the pin, not silent adoption.

8. **Systematic bias: panel-2 functioned more as verification than as
   rebuttal.** All nine lanes closed with "mostly signal" (five with
   "unusually so"), the material rate is 85%, and 15 of the 102 findings drew
   any dissent at all — with 10 of those 15 concentrated in three lanes
   (data-integrity, performance, blast-radius). The six other lanes produced
   five dissents between them. That pattern is consistent with a genuinely
   strong panel-1 (every lane independently re-verified line numbers and
   several strengthened findings), but the synthesizer should know that panel-2
   applied real pressure in only a third of the lanes.

9. **Two panel-2 findings are net-new information, not tags, and must not be
   lost in conversion:** the observability lane's cleaner reachable leak vector
   for CP-14 (client-supplied `base_updated_at` → 22P02 message echo), and the
   correctness lane's `slice(0, 6)` cap that makes CP-53 reproducible rather
   than edge-case. Both belong in their CP's fix note and fixtures.
