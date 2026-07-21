# Panel-2 — adversarial tags for relevance-linguistics

| ID | Tag | Rationale (≤25 words) |
|----|-----|------------------------|
| REL-1 | material | Verified live: goes→'goe' vs go→'go', does→empty; plan.md:59 gate passes both failure classes, so mappings ship as silent no-ops. |
| REL-2 | material | Live-confirmed disjoint counts (shew 358/show 175, saviour 39/savior 34); decision-10 rule classes generate no spelling mappings at all. |
| REL-3 | material | Identity-duplication doubles modern-text TF; probed 74% rank skew plus MCP order shift refutes plan.md:46 'behavior unchanged'; fix preserves match-set superset. |
| REL-4 | material | Verified live: agapē→'agapē' vs agape→'agap'; H7 fails as planned — unaccent installed in M1 but applied nowhere. |
| REL-5 | material | plan.md:51 gates tier 4 behind <3 rows in tiers 1–3, so Q8's +1 penalty suppresses JST whenever canon has ≥3 hits. |
| REL-6 | material | Q1 is open at the gate; 1,582 rich summaries verified live; plan.md:50's exclusion rationale (navigation) doesn't cover narrative-query content. |
| REL-7 | material | Threshold never live-validated (pg_trgm uninstalled, plan.md:14); abinidi/abinadi = 5/11 trigrams = 0.45 < 0.5, rejecting a plausible common typo. |
| REL-8 | noise | plan.md:59 already sets omission = status quo, zero regression; REL-1's corrected gate auto-excludes empty targets (does/have probed empty). Documentation only. |
| REL-9 | noise | Probe confirms seam match, but false hit returns the same verse containing all queried words; quoted-phrase-only; specialist's own option A accepts it. |
| REL-10 | noise | Verified: short id only in H4 title (harness:120), query is phrase-only; H15 windows>0 (harness:143) already hard-fails short-form ids. |

## Stance

Mostly signal — an unusually strong panel: 7/10 findings are material, and every probe I re-verified (stemmer quirks, spelling split, unaccent gap, seam adjacency) reproduced exactly. REL-1 through REL-5 each catch a real defect in the plan's core mechanism (eval gate insufficiency, missing spelling class, rank skew that punctures the 'behavior unchanged' Ring-2 claim, dead H7 pin, JST self-contradiction). The three noise items are the low-severity tail — factually accurate but non-behavior-changing (documentation, a benign same-row phrase false-positive the specialist itself offers to accept, and a comment fix for a failure mode H15 already hard-catches).