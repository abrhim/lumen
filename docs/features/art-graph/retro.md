# Retro — art-graph

Shipped 2026-07-08 (same night as approval): 11,373 edges live (10,799
DEPICTS / 574 FEATURES), card stack + gallery deployed and verified, both
smokes green.

## 1. Plan accuracy
**Drift: 2/5.** Structure held end-to-end; the one real plan defect was
amendment 6 itself — the person-map rule disambiguated *entities per slug*
but missed that a slug string names different people per ARTWORK (judas =
Maccabeus, jacob = poetic Israel). Panel-2's live probing wrote the correct
Daniel 13–14 skip expectation into the plan before implementation, which the
dry run then matched to the row.

## 2. Panel signal vs noise
- Plan stage: 33 findings → 22 material / 3 risky / 5 noise / 1 misfiled,
  dissent **0.806**. Panel-2 again earned it with data: found the 18
  cross-... (16 Daniel refs), refuted COR-2's drift narrative (measured zero),
  and surfaced systemic person ambiguity.
- Code stage: 17 findings → 5 material / 7 risky / 5 noise, dissent 0.71.
  The headline (B1) came with live wrong-edge examples, not speculation.

## 3. Harness coverage delta
7 confirmed bugs; 2 harness-attributable (B5's group-consistency was tested
one-edge-deep; B6's "exhaustive" test wasn't). The panels' pre-pinned live
canaries (Rembrandt/Dürer/Caravaggio) went straight into smoke and all hit
on the first live run.

## 4. Wasted effort
Minimal. Combined-role reviewers (3 instead of 6, each carrying pre-seeded
traps) matched previous per-role quality at half the agent count — worth
keeping at standard tier. The single combined adversarial tagger was
sufficient given finders self-verified live.

## 5. Recommendations
1. Curated mapping rules must be scoped to the INSTANCE (artwork/verse), not
   the vocabulary item (slug) — check "same tag, different referent" any time
   a tag vocabulary is mapped onto entities.
2. Keep pre-seeding reviewer briefs with specific suspicions; every seeded
   trap in this feature either confirmed a real bug or produced a
   documented-clean verification.
3. Surface-count consistency: the stack says "24" (loader limit) while the
   gallery caps at 100 of possibly more — count affordances should share one
   source of truth (punch-listed, not blocking).

## 6. Quality signals
```json
{
  "feature_slug": "art-graph",
  "tier": "standard",
  "plan_to_code_drift": 2,
  "panel_2_dissent_rate": 0.806,
  "post_merge_bugs_caught": null,
  "panel_agent_invocations": 14,
  "bug_yield_per_panel_agent": 0.5,
  "skill_version": "61c8a5e"
}
```

## 7. Provenance histogram
| Origin | Count |
|---|---|
| Should have been caught by plan | 1 (B1) |
| Should have been caught by harness | 2 (B5, B6) |
| Should have been caught by panel-1 | 1 (B2) |
| Should have been caught by panel-2 | 0 |
| Genuinely emergent / refactor artifact | 3 (B3, B4, B7) |
