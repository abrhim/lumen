# Panel-2 — adversarial tags for performance

| ID | Tag | Rationale (≤25 words) |
|----|-----|------------------------|
| PER-1 | material | pg_trgm indexes serve only <%/% operators; word_similarity_threshold defaults 0.6 not 0.5. M1's planned GIN is dead weight under the specced predicate; changes decision 2 and M1. |
| PER-2 | noise | Refuted by probe: with per-group entity_type filter (decision 1; harness H5:113), idx_entities_type serves tier-1 in 3.4-6.9ms, not 57ms; summed cost immaterial. |
| PER-3 | material | Verified probe (415ms = 7x50ms + one RTT) shows exec times sum; corrects decision 7's wrong 'concurrent' model and pins statement shape before ~28 statements stack. |
| PER-4 | material | 100% rewrite of verses+entities leaves stale stats and GIN pending lists; terminal VACUUM ANALYZE plus explicit batch size is a cheap, house-pattern-consistent migration-script change. |
| PER-5 | material | Plan declares a prod p95<500ms invariant with no emission mechanism; H12 is one laptop run. Route timing output is a real deliverable change, not deferred scope. |
| PER-8 | material | Verified: H5 (search-harness.test.ts:110-116) pins the non-indexable word_similarity form; the executable contract must exercise the production <% predicate or PER-1 regressions pass silently. |
| PER-6 | noise | plan.md:54 default limit 8 gives ~5KB typical / 20KB worst, gzipped, at <1k req/day (plan.md:20); deferred UI may need window text, so stripping buys nothing. |
| PER-7 | risky | Fix inverts plan.md:59 fail-safe (ambiguous dropped, omission=zero-regression): probed candidate set contains nazareth/seth/japheth, best/west/priest — auto-accept ships garbage mappings; the 1,098 count changes effort only. |

## Stance

Mostly signal: PER-1, PER-3, PER-5, and PER-8 are evidence-backed, mechanically correct findings that genuinely change decision 2, decision 7, M1, the route deliverable, and the harness contract. However, the specialist's other high-severity claim (PER-2) collapses when probed with the realistic per-group entity_type filter its own harness uses (3.4-6.9ms via idx_entities_type, not 57ms), and both low-severity findings fail scrutiny — one is byte-counting at negligible traffic, the other proposes a fix that inverts the plan's fail-safe curation policy.