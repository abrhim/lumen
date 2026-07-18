# Retro — unshaken-extraction (A2)

Shipped 2026-07-18. Tier standard. Gates 1b+7 waived by Abram verbatim
("Do A2 all the way through. THen do B."); mid-flight Revision 1 replaced
the Batch-API design with Claude Code workflows + subagents on Abram's
directive ("you are not to use the anthropic or any api" / "exclusively use
the claude code workflows nad sub agents to run ai enrichment").

## Outcome

10 episodes enriched end-to-end at $0 external cost: final prod state
~2,240 extraction edges (~7,900 timestamped mentions: DISCUSSES verses/
chapters, MENTIONS persons/places, TEACHES principles) behind
`public=false`, gated by eval round 4 (verse/chapter 0.967 · entity 0.883 ·
principle 0.900; 13/14 per-kind traps caught, 4/4 number-verified golds),
with the 13 round-4 adjudicated-wrong mentions pruned and saved as the
Phase-B review-table seed. LENS GREEN-LIT. Bonus: found and repaired a
LATENT A1 PROD BUG (194 double-encoded jsonb metadata rows) that A1's own
smoke had been masking with its parse-if-string accommodation.

## Drift record

Baseline stamped at synthesis; 2 pre-baseline amendments (Revision 1;
panel-1 criticals), 2 post-baseline plan-amendment commits (review-round
F1–F29; residual round R1–R17), each restamping. Eval-prompt hash held
constant through all 4 eval rounds — and the F24 fix now makes the scorer
REFUSE if it drifts. No un-amended drift.

## Panels + dissent

Panel-1 (3 specialists): 24 findings — 3 probe-verified criticals BEFORE
code (double-encoding, id shape, source column) + the alias blind spot
("Ahas" 47×/"Ahaz" 0×). Panel-2 (2 adversaries): 24 findings; killed
panel-1's fetch recommendation (would have caused run-2 data loss), proved
my own harness PINNED the trap leak, and dissolved panel-1's small-n
apology. Dissent resolved by precedence + live probes; 5 panel-1 findings
mooted by Revision 1 rather than argued.

## Eval arc (the feature's spine)

r1 FAIL entity 0.667 → diagnosis: ALL 24 misses mechanical (pool persons
named "So"/"On", same-name collisions, book-title/formula matches) → 4
deterministic guards → r2 PASS → code review reshaped the scorer → r3 PASS
0.983/0.900/0.925 → residual fixes (window-aware suppression, per-kind
trap quotas) → r4 PASS on fresh seed. Trap catch across rounds: 10/11,
11/11, 12/12, 13/14. The gate refused a bad load once and a stale verdict
never bound to shipped data — the checkpoint did its only job, four times.

## Code review + fix-verification

Review workflow: 160 agents (4 coverage-first finders → 2 adversarial
verifiers/finding): 78 found, 71 confirmed (9% kill rate — the adversarial
layer, not the finder, does the filtering). 30 fixed, rest recorded/
deferred with reasons. Fix-verification (5 clusters): 25/25 fixes verified,
18 residuals found → closed. THE PASS IS NOW 3-FOR-3 across features at
finding real residuals over green suites.

## What worked

- Workflows as substrate: enrichment (40 agents), eval (4×16 evaluators),
  review (160), fix-verification (5) — re-runs cost $0 external, which
  turned the eval from a ceremony into a loop we ran 4 times.
- Measured-precision gating caught what code review could not (r1 entity
  failure was invisible in the code, obvious in the numbers) — and code
  review caught what measurement could not (gate races, key divergence).
  Neither substitutes for the other.
- Panel probes against LIVE prod: 3 criticals killed pre-code, including
  our own masked write bug.

## What to fix in the process

- **fatal()-without-return is a CLASS**: found at the verdict gate, fixed,
  then found again at env gates by fix-verification. New rule: any fatal()
  fix sweeps ALL call sites in the same commit.
- **Fix scope must match finding scope**: F12 fixed the cited utterance but
  not the following one; F14 fixed equality but not containment. Verifiers
  caught both — but the finder's failure MODE (not just its example)
  should drive the fix.
- **My own harness pinned a leak** (H8 asserted `__trap` on the sample):
  a test can encode the bug. Panel-2 review of the harness itself paid off.
- Session limits are a real operational constraint for big agent fleets —
  file-based resume + journaled workflows made the interruption free, but
  plan fleet bursts away from limit edges when possible.

## Quality signals

```json
{
  "feature": "unshaken-extraction",
  "tier": "standard",
  "gates_waived": ["1b", "7"],
  "revisions_mid_flight": 1,
  "panel_findings": 48,
  "probe_verified_criticals_pre_code": 3,
  "eval_rounds": 4,
  "eval_final": { "verseChapter": 0.9667, "entity": 0.8833, "principle": 0.9 },
  "trap_catch": [ "10/11", "11/11", "12/12", "13/14" ],
  "review_findings": { "found": 78, "confirmed": 71, "kill_rate": 0.09 },
  "fixes": 30,
  "fix_verification_residuals": 18,
  "fix_verification_streak": "3-for-3",
  "external_cost_usd": 0,
  "agents_spawned_total": "~460",
  "prod_incidents": 0,
  "latent_prod_bug_repaired": "194 double-encoded jsonb rows (A1)"
}
```
