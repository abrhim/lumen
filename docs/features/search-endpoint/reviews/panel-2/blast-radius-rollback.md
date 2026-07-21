# Panel-2 — adversarial tags for blast-radius-rollback

| ID | Tag | Rationale (≤25 words) |
|----|-----|------------------------|
| BLA-1 | material | Verified: triggers fire on verses AND entities inserts (load.mjs entity upsert); dropping normalize_kjv under live triggers bricks weekly ingest; plan claims rollbackability with no recipe. |
| BLA-2 | material | plan.md:42 claims independent rollback + never-500; searchAll's word_similarity/entity_degree are runtime deps that hard-error if dropped under live M5. Reverse-order rule is genuinely missing. |
| BLA-3 | material | Live-verified: search_index PK (kind,ref_id), 10 ingest-owned episode rows; moment ref_id prefix-collides with episode ids; plan leaves rebuild delete scopes unspecified. |
| BLA-4 | material | queries.ts:84-97 orders by ts_rank LIMIT 10; dual vector shifts ranks, so 'behavior unchanged' overclaims a Ring-2 contract; amendment plus evidence capture is cheap. |
| BLA-5 | noise | Plan already sequences safely: plan.md:66 lists 'table, function, trigger replacement, batched backfill'; plan.md:59 gates eval before backfill; plan.md:103 mandates idempotent re-run. |
| BLA-6 | material | Verified: load.mjs:31-33 cascades transcripts (FK, migrate-media-collections.mjs:17) and ignores moments; weekly re-ingest strands stale searchable moments; plan omits recurring rebuild rule and staleness invariant. |
| BLA-7 | noise | deploy.yml:27 runs full workspace tests on every main push before deploy; wiring pin (api-search.test.ts:157-163) fails CI on dropped registration regardless of merge order. |
| BLA-8 | material | Probe: lumen_read rolconfig null (no extensions in search_path); postgres role pins it; all installed extensions live in extensions schema — admin-passes/app-fails divergence is live config. |

## Stance

Mostly signal: 6/8 findings are material, and every evidence claim I re-checked (file lines, trigger definitions, search_index ownership, ts_rank/LIMIT, prod role search_path) reproduced exactly as stated. The two noise tags are not factual errors but redundancy — BLA-5 restates ordering the plan already enumerates (plan.md:59,66,103), and BLA-7's mitigation is already enforced unconditionally by the deploy.yml test gate on main. This specialist's live-probe discipline (especially the lumen_read search_path asymmetry behind BLA-8) is the strongest work on the panel.