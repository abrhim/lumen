# Panel-1 — relevance-linguistics

| ID | Severity | Where | Problem (≤25 words) | Fix (≤30 words) |
|----|----------|-------|---------------------|-----------------|
| REL-1 | high | plan.md decision 10 (M2 eval gate) + search-harness.test.ts H16 pins | Eval gate only checks target lexeme ≠ variant lexeme; goeth→goes stems to 'goe'≠'go', and do/does/has/have/will targets stem to nothing (stopwords). | Gate must assert to_tsvector(target) is non-empty AND equals the modern base-form lexeme; map -eth to base form (goeth→go, saith→say); add goeth-class and stopword-target pins to H16. |
| REL-2 | high | plan.md decision 10 rule classes / Gap 1 — live corpus counts | No spelling-modernization class: shew (358 verses), honour (173), neighbour (144), saviour (39) never match show/honor/neighbor/savior; corpus itself splits KJV-British vs BoM-American. | Add curated KJV/British spelling class (shew→show, -our→-or set, sepulchre→sepulcher) to kjv-variants.json; pin 'savior' matching a Saviour-verse in the harness. |
| REL-3 | high | plan.md decision 3 scoring + Ring-2 invariant — live ts_rank probe | Dual concat doubles TF of unmapped lexemes: modern-form verse outranks archaic 0.0234 vs 0.0134 for query 'believe' (flag 1 doesn't mitigate); MCP searchScriptures ordering shifts too. | Match on combined vector (Ring-2 superset kept); rank searchAll on a stored normalized-only tsvector with normalize_kjv'd query; scope Ring-2 claim to match-sets; pin archaic/modern rank parity. |
| REL-4 | med | plan.md M4 / H7 strongs projection — live strongs_lexicon probe | G26 translit is 'agapē'; its lexeme stays 'agapē' while query 'agape' stems to 'agap'; plan never says where unaccent applies, and unaccent() isn't IMMUTABLE for index expressions. | Apply unaccent() in the build-script SQL when writing search_index text/tsv (projection-time), and unaccent the query string in the strongs group query for pasted accented input. |
| REL-5 | med | plan.md Q8 + decision 2 tier semantics | JST '+1 tier penalty' lands JST FTS hits in tier 4, which is suppressed whenever tiers 1–3 return ≥3 rows — JST readings mostly invisible; no harness pin covers JST at all. | Rank JST below canon via within-tier sort key (variant flag) or score multiplier, not tier reuse; exempt penalized rows from tier-4 gating; add a JST-presence harness pin. |
| REL-6 | med | plan.md decision 1 / Q1 taxonomy — live entities probe | 1,582 chapter_summary entities carry rich narrative synopses; excluding them removes the best surface for narrative queries ('nephi breaks his bow'), which verse FTS cannot serve. | Include chapter_summary in v1 (own 'chapters' group or inside scripture, ranked below verses), or document an explicit revisit trigger in Q1. |
| REL-7 | med | plan.md decision 2 tier-2 threshold (word_similarity ≥ 0.5) | 0.5 rejects common short-name typos: abinidi→Abinadi ≈0.45 by trigram arithmetic; pg_trgm is not installed yet (probed), so the threshold has never been live-validated. | After M1, live-probe a misspelling set; likely lower to 0.4 for tier-4 fallback while keeping 0.5 for tier-2; pin one sub-0.5 typo fixture in H5. |
| REL-8 | low | plan.md decision 10 mapping scope — pronoun/auxiliary classes | thee/thou/ye/thy, hath/doth/wilt/art, unto have stopword modern targets — mappings are silent no-ops; plan states no policy for these highest-frequency archaic words. | Document policy: leave them unmapped (archaic queries still work via original half; modern equivalents are stopwords); exclude from kjv-variants.json; add H16 no-op pins for hath/thee. |
| REL-9 | low | plan.md M2/M3 dual-vector construction — live phrase probe | Phrase queries falsely match across the original\|normalized seam: probed 'him whoso' matches concatenated halves of two different sentences. | Accept as rare/benign with a code comment, or interpose one dummy token between halves (single to_tsvector over 'text qqseamqq normalized') to break false adjacency. |
| REL-10 | low | search-harness.test.ts H4 comment + H15 payload join vs decision 9 | Fixture comment pins episode '4pSrikfJ5Yw' but prod ids are 'unshaken-4pSrikfJ5Yw' (probed); build script copying the short form zeroes H15's payload->>episode_id join. | Correct the comment to the prefixed id; add an H15 assertion that moment payload episode_ids are a subset of transcripts episode_ids for a crisper failure. |

## Evidence

Live prod probes 2026-07-21 (SELECT-only via DATABASE_URL):

[stemmer, backs REL-1]
goes -> 'goe':1 | go -> 'go':1 | does -> (empty) | do -> (empty) | has -> (empty) | have -> (empty) | will -> (empty) | doeth -> 'doeth':1 | hath -> 'hath':1 | saith -> 'saith':1 | says -> 'say':1 | cries -> 'cri':1 | cry -> 'cri':1

[spelling split, backs REL-2] verse match counts (plainto_tsquery):
shew 358 vs show 175 · honour 173 vs honor 42 · neighbour 144 vs neighbor 22 · saviour 39 vs savior 34 — disjoint lexeme pairs confirmed: 'shew'/'show', 'saviour'/'savior', 'neighbour'/'neighbor', 'honour'/'honor', 'sepulchr'/'sepulch'

[rank skew, backs REL-3] query 'believe', real verse texts, simulated M2 vectors:
archaic_dual (john-3-16, believeth→believes) = 0.0134391 vs modern_dual (identity-duplicated 'believed' verse) = 0.0233878 with normalization flag 1 → flag 1 does NOT mitigate the 74% inflation. Flag 0 (MCP searchScriptures path): modern_dual_n0 = 0.0865452 vs modern_single_n0 = 0.0759909 → existing MCP rank order perturbed by re-vector.

[phrase semantics] phrase_normalized_half = true (offset positions preserve adjacency — modern phrases DO match the normalized half); seam_false_positive = true ('him whoso' matches across the two halves, backs REL-9)

[strongs, backs REL-4] G26 translit = 'agapē'; to_tsvector('english','agapē') -> 'agapē':1 while query 'agape' -> 'agap':1 — no match without unaccent at build time. pg_extension: neither pg_trgm nor unaccent installed (backs REL-7 'never live-validated').

[trgm arithmetic, backs REL-7] pg_trgm-padded trigram similarity: melchisedek/melchizedek 0.60 ✓, betlehem/bethlehem 0.58 ✓, nebucadnezar/nebuchadnezzar 0.56 ✓, abinidi/abinadi 0.45 ✗ below the 0.5 threshold.

[taxonomy, backs REL-6] entity_type='chapter_summary' count = 1582; sample description: "Following Nephi's sharp rebukes, his brothers humble themselves temporarily, and the families of Lehi and Ishmael are united through marriag…"

[fixtures] H2 floors verified exact: believeth 59, spake 782, faith 810. H3 verified: 1-chr-15-16 contains 'spake'. H10/H6 ids exist (melchizedek-1, naves-melchizedek). H4 phrase exists but at episode_id 'unshaken-4pSrikfJ5Yw' seq 100/101 — transcripts episode_ids are all 'unshaken-' prefixed (backs REL-10). Rule-class candidate volume: 712 -eth, 327 -est, 59 -edst distinct words.

_Source: workflow run wf_7edb2724-d13 (structured return); file written by orchestrator._