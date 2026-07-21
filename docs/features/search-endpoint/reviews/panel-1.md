# Panel-1 aggregate — search-endpoint

8/8 specialists returned (workflow run wf_7edb2724-d13 + 4 direct-agent runs; where both
ran the same role, the richer file won and convergent duplicates are noted below).
Per-role files in `reviews/panel-1/` are the source of truth. ~71 findings; 22 high.

| Role | Findings | High |
|---|---|---|
| security | 9 | 3 |
| correctness | 10 | 3 |
| performance | 8 | 2 |
| api-contract | 10 | 3 |
| data-integrity | 10 | 3 |
| observability | 9 | 2 |
| relevance-linguistics | 10 | 3 |
| blast-radius-rollback | 8 | 3 |

## Cross-role convergence clusters (independent convergence ≈ certainty — tske lesson)

1. **Unshaken is `public=true` in prod TODAY** — the plan's and harness's `public=false`
   premise is false; anonymous search would surface transcripts the day M3 lands.
   `raised_by: [security SEC-1, correctness COR-9, data-integrity DAT-10]`
2. **JST visibility-gate bypass** — scripture group folds 31,262 `jst` entities but is
   exempted from the collection WHERE clause and from H8's fail-closed loop.
   `raised_by: [security SEC-3, correctness COR-2]`
3. **No per-group error isolation** — one failed group query 500s the whole request,
   contradicting "empty group, never 500"; no harness pin forces the path.
   `raised_by: [correctness COR-1/COR-2(wf), observability OBS-2]`
4. **Degree-0 boost collapse** — `ln(1+degree)` zeroes the score for 5,319/5,319 naves
   topics, all eras, many persons; plus no deterministic tiebreak (23 identical
   "Zechariah" ranks probed). `raised_by: [data-integrity DAT-2, correctness COR-4]`
5. **Ring-2 "behavior unchanged" overclaims** — dual-index shifts length-normalized
   ts_rank (probed 0.0608→0.0384), so MCP LIMIT-10 composition can change; superset
   holds for match-sets only. `raised_by: [correctness COR-5, blast-radius BLA-4]`
6. **search_index ownership + delete-scope discipline** — kind-scoped deletes only;
   `ref_id LIKE ep||'#%'` is unsafe (`_` wildcard); per-episode transactions; stale
   moments after weekly re-ingest need an invariant + runbook step.
   `raised_by: [data-integrity DAT-3/DAT-4, blast-radius BLA-3/BLA-6]`
7. **Extension-schema grants gap** — probed: `extensions` schema ACL has no lumen_read
   USAGE and public-schema default ACL omits it; `word_similarity` would
   permission-deny at runtime, masked by silent degrade. M1 must place + grant +
   invariant-check as the app role. `raised_by: [security SEC-2(wf), data-integrity DAT-8, blast-radius BLA-8]`
8. **Cache-Control missing on a session-varying response** — house `private, no-store`
   pattern applies. `raised_by: [api-contract API-3, security SEC-4(wf)]`
9. **ts_headline raw `<b>` snippets** — live-verified markup mangling; neutral markers
   + plain-text contract needed. `raised_by: [api-contract API-1]`
10. **KJV/linguistics corrections** — accented translit (`agapē`) unmatched by FTS
    (6,153 rows) needs unaccent at projection time; per-class stemmer traps (doeth/
    goeth/saith classes) need mapped-to-lexeme targets; dual-index rank skew fix:
    match on combined vector, rank on original. `raised_by: [relevance-linguistics REL-*, correctness COR-3]`
11. **Trigger rollback IS possible** — current definitions exist in repo
    (`setup-triggers-and-rls.sql`, live-verified identical); M2 still logs
    `pg_get_functiondef()` before replace; M2 internal order pinned (table→function→
    eval→trigger→backfill). `raised_by: [blast-radius BLA-1/BLA-5, data-integrity DAT-1]`
12. **Double-encoded episode payloads in prod** — the 10 existing kind='episode'
    payload values are jsonb *strings* (the A2 latent-bug class again); repair during
    M3 and insert as objects. `raised_by: [security SEC-8(wf), api-contract API-5/API-6]`
13. **NULL-strict tsvector concat** — 1,630 entities have NULL description; every
    concat leg needs `coalesce(...,'')` + post-backfill NULL-count invariant.
    `raised_by: [correctness COR-1(wf)]`
14. **Query capture missing entirely** — the promised tuning loop has no data source;
    minimal `logEvent` line prescribed (house pattern, ~26 call sites).
    `raised_by: [observability OBS-1/OBS-2]`
15. **routes.ts double-edit hazard** with unshaken-surfaces branch — own-line append,
    post-merge wiring-pin test runs. `raised_by: [blast-radius BLA-7]`
