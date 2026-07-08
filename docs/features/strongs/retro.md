# Retro — strongs

Shipped 2026-07-08: 738,569 word tags (93.5% of all Bible words) + 20,734
lexicon entries live; opt-in Word study layer in the verse panel (tap a word →
translit/Strong's/morph/definition + "also in" verses); smoke 12/12.

## 1. Plan accuracy
**Drift: 2/5.** The architecture held exactly; what moved was the SOURCE
(pre-plan: STEPBible tags → CrossWire KJV2006 after one probe overturned the
"cross-translation fuzzy alignment" premise entirely — 93.5% deterministic
beats the projected 83% fuzzy) and the UX (panel-driven toggle redesign).
Both changes happened BEFORE implementation because probing came first.

## 2. Panel signal vs noise
- Plan stage: 28 findings → dissent **0.93** (highest recorded). Tagger-A
  corrected a verifier's own count by 10× in the understating direction
  (divineName: 5,816 verses, not 633) — "verify the counts of your verifiers."
- Code stage: 12 findings → 9 material / 3 risky / 0 noise. CE-1 (Critical)
  was found only by EXECUTING the dedup against the vendored lexicons —
  reading the code could never catch it.

## 3. Harness coverage delta
The layered gates each caught a class nothing else could:
- unit harness: parser/aligner/normalizer semantics (12 tests);
- dry-run cap: three real text-difference classes, rejected pre-prod ×3;
- smoke: the bare-number lexicon gap (542 numbers) AFTER a clean dry run.
Gap: nothing asserted lexicon CONTENT (gloss values) — that's how CE-1
survived to code review. Content canaries now exist.

## 4. Wasted effort
None material. Two combined code reviewers replaced seven; the adversarial
tagger found the working tree already fixed everything and treated that as
corroboration. The mismatch histogram (one diagnostic script) converted three
would-be debugging sessions into three mechanical table entries.

## 5. Recommendations
1. When ingesting reference CONTENT (glosses, definitions), assert sample
   VALUES in the harness and smoke — existence checks pass while content is
   wrong (CE-1 class).
2. Keep the mismatch-histogram pattern: when an alignment/cap gate rejects,
   histogram ALL first-divergences before fixing anything — classes, not
   instances.
3. Dry-run caps should be tuned to reject: three rejections here were three
   real bug classes; a looser cap would have shipped all of them silently.

## 6. Quality signals
```json
{
  "feature_slug": "strongs",
  "tier": "large",
  "plan_to_code_drift": 2,
  "panel_2_dissent_rate": 0.93,
  "post_merge_bugs_caught": null,
  "panel_agent_invocations": 9,
  "bug_yield_per_panel_agent": 1.3,
  "skill_version": "0999e31"
}
```

## 7. Provenance histogram
| Origin | Count |
|---|---|
| Should have been caught by plan | 0 |
| Should have been caught by harness | 3 |
| Should have been caught by panel-1 | 1 |
| Should have been caught by panel-2 | 0 |
| Genuinely emergent (caught by the gates as designed) | 8 |
