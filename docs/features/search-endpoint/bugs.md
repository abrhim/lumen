# Bugs — search-endpoint

Code-panel (8 reviewers, 52 findings — 43 from the continued run + 9 salvaged
observability) × adversarial (42 material / 7 noise / 2 risky / 1 out-of-scope).
The 42 material findings dedupe to **28 confirmed bugs** (4 high / 15 med /
9 low). Sorted high→low severity, then file:line. Fixes NOT yet landed.

## Confirmed bugs (open)

### B1: scope CSV order forwarded verbatim — groups violate GROUP_KEYS order
- Severity: high · api-contract · apps/web/app/routes/api.search.tsx:55-59 (+ packages/scripture/src/search.ts:441-444)
- Source: APIC-1 (api-contract) + CORC-4 (correctness)
- Problem: loader builds scope as `[...new Set(csv)]` preserving user order and
  searchAll maps it verbatim, so `?scope=words,scripture` returns groups
  `[words,scripture]` — decision 5's "scoped keys in GROUP_KEYS order" MUST is
  violated, unratified by A1–A5; tests only feed canonical-order scopes.
- Fix: canonicalize `scope = GROUP_KEYS.filter(k => requested.has(k))` in the
  loader (or searchAll); pin a reversed-scope test in H14 (see B5).
- Verify: Probe B — live `searchAll({scope:['words','scripture']})` returned
  groups `["words","scripture"]`, mode=combined.

### B2: session/visibility phase sits outside the loader try — contract-less 500s
- Severity: high · correctness · apps/web/app/routes/api.search.tsx:74-87
- Source: CORC-1 (correctness) + OBSC-1 (observability) + SECC-1 (security) + APIC-2 (api-contract) + BLAC-1 (blast-radius-rollback) — 5-role convergence
- Problem: four awaits (getSessionUser :74, getPublicCollectionIds :75 — no
  catch in queries.ts:172, getEntitlements :79, admin collections query
  :81-83) precede the try at :89. A rejection there escapes the loader as a
  framework non-JSON 500: no `{error,code:'internal'}` body, no
  `Cache-Control: private,no-store`, no `search_failed` log, session-rotation
  Set-Cookie headers dropped — breaking decision 5's error contract on a
  realistic path (Supabase session-pool exhaustion is a documented incident in
  this repo).
- Fix: move the visibility derivation inside the existing try (or its own
  try) so every failure exits via `json({error,code:'internal'},500,headers)`
  and logs `search_failed`; align with main's fail-closed
  `getPublicCollectionIds(...).catch(() => [])` pattern (see B7).
- Verify: mock a getPublicCollectionIds rejection in api-search.test.ts;
  assert JSON 500 + no-store + search_failed (H18 today only covers searchAll
  rejection).

### B3: redundant equality WHERE arms defeat the GIN indexes — A1 mechanism inoperative
- Severity: high · performance · packages/scripture/src/search.ts:276 (entity legs), :338 (art leg)
- Source: PERC-1 (performance) + PERC-2 (performance)
- Problem: the non-indexable `lower(name)=lower(q)` / `lower(si.title)=lower(q)`
  OR-arms are subsumed by the escaped prefix-ILIKE arm yet block BitmapOr,
  forcing heap-filter of the whole entity_type subset (people 20.7ms→1.0ms,
  topics 70ms→14.5ms with the arm removed) and a pkey scan of all 4,461
  artwork rows (16.5ms→3.8ms) — amendment A1's ratified GIN-prefilter
  mechanism never engages.
- Fix: delete the equality arm from WHERE only (keep the tier CASE); EXPLAIN
  counterfactuals show BitmapOr engages with identical tier:id sequences.
- Verify: EXPLAIN (ANALYZE, BUFFERS) as lumen_read on the entity/art leg SQL;
  rows verified identical across 7 probe queries.

### B4: nothing pins meta.mode='combined' — a broken primary path passes green
- Severity: high · test-coverage · packages/scripture/src/__tests__/search-harness.test.ts:291 (H10/H12/H13)
- Source: TESC-1 (test-harness-quality)
- Problem: searchAll's bare catch (search.ts:481) silently falls back, so a
  permanently broken combined statement — the PER-3 primary path — passes all
  40 tests while every request runs 1+7 serialized round trips.
- Fix: assert `res.meta.mode === 'combined'` in H10/H12/H13; once B15 lands
  `meta.combinedError`, pin its absence too.
- Verify: live `searchAll(q='faith')` → mode='combined'; grep confirms no test
  asserts meta.mode anywhere.

### B5: endpoint suite mock drift + observability contract unpinned
- Severity: med · test-coverage · apps/web/app/routes/__tests__/api-search.test.ts:38-43, 139-143
- Source: TESC-3 (test-harness-quality) + TESC-7 (test-harness-quality) + OBSC-9 (observability)
- Problem: untyped EMPTY_RESPONSE omits required `meta.mode`, so the loader
  logs `mode: undefined` in every endpoint test unnoticed; `search_executed`
  is asserted by event name only (no payload fields); `search_group_degraded`
  is never exercised in either suite (grep: 0 hits); the zero-hit group-order
  test only round-trips the mock — the real exact-GROUP_KEYS-order contract is
  unpinned everywhere. OBS-1/OBS-2 field regressions pass green.
- Fix: type the mock `satisfies SearchResponse`; assert search_executed
  payload keys/values (mode, zeroResult, perGroupMs, visibility); feed
  degraded meta (mode:'fallback', perGroup error) through the mock and pin
  search_group_degraded; add a live pin that groups map exactly equals
  GROUP_KEYS order and per-scope subset (closes B1's test gap).

### B6: `?limit=` silently clamps to 1; limit edge cases unpinned
- Severity: med · api-contract · apps/web/app/routes/api.search.tsx:66-70 (suite gap: api-search.test.ts:87)
- Source: TESC-5 (test-harness-quality) + APIC-5 (api-contract)
- Problem: `Number('')===0` and `Number(' ')===0` pass Number.isInteger, so
  `?limit=` / `?limit=%20` silently clamp to 1 — not 400 `limit_invalid`, not
  default 8; `limit=3.5` 400s even though decision 5 clamps numeric
  out-of-range input (clampLimit's Math.floor is unused). H14 pins none of
  these edges, nor whitespace-only q.
- Fix: treat empty/whitespace rawLimit as absent (default 8) or
  `limit_invalid`; validate `/^\d+$/` (or floor finite numerics) before
  Number(); pin `limit=`, `limit=%20`, `limit=2.5`, whitespace q in H14.
- Verify: `GET ?q=faith&limit=` returns one result per group.

### B7: visibility logic duplicated against main's canonical collection-access module
- Severity: med · blast-radius-rollback · apps/web/app/routes/api.search.tsx:74-87 vs main's apps/web/app/lib/collection-access.server.ts
- Source: BLAC-2 (blast-radius-rollback)
- Problem: worktree is 23 commits behind main; the merged unshaken-surfaces
  work added canonical `getCollectionAccess`/`canViewCollection` (fail-closed
  catch, DEV carve-out) — unratified by A1–A5. Search hand-rolls a second
  visibility implementation on a security gate; future kill-switch or
  entitlement changes will silently miss search.
- Fix: rebase onto main; derive visibleCollections via getCollectionAccess
  plus the admin all-collections expansion so one module owns visibility.
- Verify: `git merge-tree` against main (992c409) shows the drift; merge-base 61dee0f.

### B8: admin entitlement branch has zero test coverage
- Severity: med · test-coverage/security · apps/web/app/routes/api.search.tsx:78-87 (suite gap: api-search.test.ts:165-178)
- Source: TESC-6 (test-harness-quality) + SECC-4 (security)
- Problem: the loader's only privilege-widening path (ADMIN_COLLECTIONS
  entitlement → all collections, visibility:'admin', userId logged) is
  unasserted — only anonymous and non-entitled paths are pinned. This branch
  is the sole access path once the `public=false` kill switch fires.
- Fix: endpoint test mocking entitlement rows + the collections query; assert
  visibleCollections = all ids and search_executed logs visibility:'admin' +
  userId.

### B9: search_failed logs only {message, qLen} — 500s unreproducible
- Severity: med · observability · apps/web/app/routes/api.search.tsx:128-131
- Source: OBSC-3 (observability)
- Problem: the failing q/scope/visibility are dropped from search_failed,
  making 500s unreproducible — with no privacy gain, since search_executed
  logs raw q on every success.
- Fix: include q, scope, and visibility in the search_failed payload.

### B10: H13 payload typing exercises a fraction of the kinds it claims
- Severity: med · test-coverage · packages/scripture/src/__tests__/search-harness.test.ts:298-316
- Source: TESC-2 (test-harness-quality)
- Problem: H13 claims payload typing "across ALL kinds" but its one query
  ('millennial reign') live-returns only moment/person/principle/summary/
  symbol/topic; verse, jst, episode, artwork, strongs coercion (decision 5
  contract) is never asserted, and sawMoment rests on 2 live rows.
- Fix: add per-kind queries (faith→verse/episode, JST Genesis→jst,
  pentecost→artwork, agape→strongs) asserting typeof payload and numeric
  fields per kind.

### B11: H17 fallback assertions too weak to catch contamination
- Severity: med · test-coverage · packages/scripture/src/__tests__/search-harness.test.ts:318-340
- Source: TESC-4 (test-harness-quality)
- Problem: H17 asserts only poisoned>0, scripture>0, and SOME meta error — it
  never pins mode==='fallback', that all three poisoned groups
  (people/places/topics) are empty WITH error, or that episodes/art/words
  survive (live: 8/8/4 hits) — positional fallback contamination would pass
  undetected.
- Fix: assert mode==='fallback'; assert perGroup people/places/topics each
  {hits:0, error}; assert episodes/art/words hits>0.

### B12: kjv_delta-only matches ship snippets with zero highlight markers
- Severity: med · api-contract · packages/scripture/src/search.ts:210
- Source: APIC-3 (api-contract)
- Problem: verses matched only via kjv_delta (believe→believeth — the
  feature's flagship Gap-1 case) return snippets with no ⟪⟫ markers, because
  ts_headline runs the modern query against the archaic text. Live-verified
  in prod by two independent probes.
- Fix: expand the headline tsquery with reverse kjv-variant forms
  (modern→variants) for scripture snippets, or amend the decision-5 contract
  to state markers are best-effort.
- Verify: ts_headline over a 'believeth' verse with q='believe' → no markers;
  control q='faith' → ⟪faith⟫.

### B13: legal worst-case query runs 2.5x the p95 budget
- Severity: med · performance · packages/scripture/src/search.ts:219 (verse arm; combined :464) + apps/web/app/routes/api.search.tsx:22 (Q_MAX=200)
- Source: PERC-3 (performance)
- Problem: a legal 183-char OR-of-common-words request (limit=25, all groups)
  runs 1,266ms server-side vs the 500ms p95 budget — verses seq-scan ranks
  49,872 rows, topics leg 488ms; uncapped websearch_to_tsquery term count, no
  rate limiting (the latter plan-ratified).
- Fix: land B3 first (cuts entity legs ~5x); cap tsquery term count (numnode
  guard) or lower Q_MAX; watch decision-10 logs for the tail.
- Verify: EXPLAIN ANALYZE of the 7-leg combined statement with the 183-char
  probe query → 1266ms (wallclock 1311-1318ms x3).

### B14: episodes/art legs never issue the trgm predicate their tiers score
- Severity: med · correctness · packages/scripture/src/search.ts:296-313 (episodes), :338 (art)
- Source: CORC-3 (correctness)
- Problem: episodesLeg WHERE omits the trgm predicate its tier/score CASEs
  (:298-305) reference (dead branches), and the `%` full-string prefilter can
  never pass on long titles — fuzzy episode-title recall is entirely
  nonfunctional (artLeg omits trgm too). M1's idx_search_title_trgm serves a
  predicate that is never issued (idx_scan=3). Unratified decision-2
  deviation.
- Fix: add a word_similarity-based predicate on si.title to WHERE (served by
  idx_search_title_trgm), or delete the dead CASE branches and ratify the
  deviation.
- Verify: Probe C — word_similarity('leviticas', title)=0.6999 ≥ 0.45 yet the
  episode is unreachable by ANY channel; searchAll(q='halvorsen',
  scope:['episodes']) → 0 hits.

### B15: bare catch{} discards the combined-statement error — silent permanent double execution
- Severity: med · observability · packages/scripture/src/search.ts:481-483
- Source: OBSC-2 (observability) + BLAC-4 (blast-radius-rollback)
- Problem: the bare `catch {}` swallows the combined-statement failure reason.
  For combined-only failure classes (live-proven 22P02 UNION type collision;
  also param-count/size limits) every fallback leg succeeds, so no meta.error
  exists and no event ever fires — every request silently pays 1+7 statements
  forever with only mode:'fallback' logged, cause never captured anywhere.
- Fix: capture the error into meta (e.g. meta.combinedError); loader logs a
  degraded event with the message when mode==='fallback' (enables B4's pin).
- Verify: legA `SELECT 1 AS x` OK, legB `SELECT 'moment' AS x` OK, combined
  UNION ALL of both → 22P02 — both legs green standalone, combined rejects.

### B16: unguarded coerceRow — one non-JSON payload row 500s the whole search
- Severity: med · correctness · packages/scripture/src/search.ts:497
- Source: CORC-2 (correctness)
- Problem: coerceRow runs outside Promise.allSettled/try in the fallback path
  (and the combined path funnels into the same line after silent fallback); a
  non-JSON string payload row throws JSON.parse from searchAll in both modes,
  500ing the endpoint — violating decision 7's never-500-from-a-group-failure
  guarantee. Latent today (0 bad rows in prod; the historical double-encoded
  class is handled by coerceRow's string branch — see rejected APIC-4), but
  wordsLeg forwards si.payload raw (see B23), so any future projection defect
  becomes an outage.
- Fix: move per-group coercion (coerceRow + sortResults) inside the per-leg
  async / a try-catch so a poisoned group degrades to results:[] + meta.error
  like any other group failure.

### B17: -edst variant class is entirely dead
- Severity: med · data-integrity · scripts/build-kjv-variants.mjs:137, 149, 160-172
- Source: DATC-2 (data-integrity)
- Problem: 6 -edst forms pass G3 live (deliveredst 5x, calledst 4x, …) but the
  cands order tries slice(0,-2) first, so the past form ('delivered') wins
  first-match and its G2 siblings ('deliveredeth', …) can never attest — 0 of
  429 shipped variants end in 'dst'; the plan-declared class ships nothing and
  no per-class gate catches it.
- Fix: for -edst prefer the base candidate (slice(0,-4)) first, or accept
  past-form targets in G2; assert per-class minimum counts in the eval gate.
- Verify: `lumen.kjv_delta('he doeth what thou lovedst and commandedst')` →
  '' (empty); `SELECT count(*) FROM lumen.kjv_variants WHERE variant LIKE
  '%dst'` → 0.

### B18: deleted episodes leave publicly searchable orphan moments forever
- Severity: med · data-integrity · scripts/build-search-moments.mjs:92-96, 139, 189-196
- Source: DATC-3 (data-integrity)
- Problem: both the delete pass and the coverage invariant key off episodes
  still present in lumen.transcripts; when an episode is deleted (cascade),
  its kind='moment' rows persist, invisible to every check, and remain
  anonymously searchable (collection stays 'unshaken', public=true). The plan
  ledger's DAT-6 ruling mandated M3 orphan invariants — missing.
- Fix: add a kind-scoped delete of moments whose payload episode_id has no
  transcripts, plus a moment_orphan_free invariant mirroring M4's
  artwork_orphan_free.
- Verify: NOT EXISTS transcripts probe (0 orphans today — latent, guaranteed
  on first episode deletion).

### B19: M4 invariant hardcodes today's row counts — guaranteed spurious exit 2
- Severity: med · data-integrity · scripts/migrate-search-projections.mjs:128-131
- Source: CORC-6 (correctness) + DATC-1 (data-integrity)
- Problem: moments_and_episodes_untouched hardcodes moment=3940/episode=10,
  but the script's own header (:5-6) and DAT-9 mandate re-runs on the
  post-ingest runbook that changes those counts by design; invariants run
  post-commit (:181-197), so after the next episode it false-fails (exit 2)
  after already committing — training operators to ignore failures.
- Fix: snapshot non-owned kind counts at run start and compare before/after,
  mirroring M3's dynamic baseline pattern.

### B20: routes.ts append-last discipline now collides with main's catch-all
- Severity: low · blast-radius-rollback · apps/web/app/routes.ts:13
- Source: BLAC-3 (blast-radius-rollback)
- Problem: guaranteed merge conflict — this branch appends api/search last
  (BLA-7 discipline) but main's tail is now the `:type/:id` catch-all
  commented 'LAST on purpose'; merge-tree confirms conflict markers. The
  plan's BLA-7 append-last rule is stale.
- Fix: on rebase, place api/search above the `:type/:id` catch-all (RR
  static-beats-dynamic ranking + node.tsx fail-closed loader make
  mis-resolution non-fatal, but keep the invariant).
- Verify: `git merge-tree` vs main exits 1 with CONFLICT in routes.ts.

### B21: zeroResult counts degraded groups as zero hits
- Severity: low · observability · apps/web/app/routes/api.search.tsx:113
- Source: OBSC-4 (observability)
- Problem: a fully-degraded fallback request logs zeroResult:true,
  contradicting the OBS-2 comment at line 104 and polluting the relevance
  metric decision 10 feeds.
- Fix: exclude requests with any perGroup.error from zeroResult, or add a
  degradedGroups count field to search_executed.

### B22: moment-id stability note never documented (decision-5 MUST)
- Severity: low · api-contract · packages/scripture/src/search.ts:69 (SearchResult.id) + route header
- Source: APIC-6 (api-contract)
- Problem: decision 5 requires documenting id stability (all ids durable
  EXCEPT response-scoped moment ids); grep finds no such note in search.ts,
  the route, or feature docs — moment ids silently change on every M3
  re-window.
- Fix: doc comment on SearchResult.id and the route header: moment ids are
  response-scoped; deep-link via payload episode_id/t_start_s.

### B23: words/art legs pass payloads through instead of allowlisting
- Severity: low · security · packages/scripture/src/search.ts:359 (words), :333 (art)
- Source: SECC-2 (security)
- Problem: wordsLeg forwards full si.payload (lang, original, translit, gloss;
  contract says {strongs_no}); artLeg keeps artist_name/year beyond
  {refs, thumbnail_url}. Fail-open passthrough on a public endpoint: any
  future projection-script field ships to clients automatically (benign
  public data today).
- Fix: build payloads with jsonb_build_object allowlists, as the
  scripture/topics legs already do (verse-leg pattern at :217).

### B24: combined mode stamps whole-statement ms into every group
- Severity: low · observability · packages/scripture/src/search.ts:470-479 (t0 at :438)
- Source: PERC-5 (performance) + OBSC-6 (observability)
- Problem: on the primary path every group's meta.perGroup.ms is the identical
  whole-searchAll elapsed (t0 even includes reference-resolution RTT), and the
  loader logs it as perGroupMs — decision 10's per-group p95 instrument
  (PER-5/OBS-4) logs 7 identical junk numbers; semantics undocumented, so
  dashboards misattribute.
- Fix: omit or null per-group ms in combined mode (mode is already logged;
  elapsedMs stays authoritative); keep real per-group ms only on the fallback
  path; document semantics on SearchGroupMeta.ms.

### B25: degraded groups always report ms:0
- Severity: low · observability · packages/scripture/src/search.ts:500-503
- Source: OBSC-5 (observability)
- Problem: rejection loses the leg timer (started :487), so
  search_group_degraded always carries ms:0 — timeouts are indistinguishable
  from instant failures (missing relation), defeating the one field decision
  10 specified for the event.
- Fix: time each leg inside a caught wrapper so the rejection carries elapsed
  ms into meta and the degraded event.

### B26: moment windows exceed the documented 800-char hard cap
- Severity: low · data-integrity · scripts/build-search-moments.mjs:42-53 (shouldFlush), :60-66 (tail-merge)
- Source: CORC-7 (correctness) + DATC-4 (data-integrity)
- Problem: HARD_MAX is checked after appending a whole caption, and tail-merge
  can also overshoot — live: 178/3940 moments exceed the plan's 200-800 bound
  (max 1063; synthetic probe 3018); no length-bound invariant exists, so the
  decision-8 deviation shipped unnoticed and is unratified.
- Fix: flush before appending when overflow is predictable (or ratify the
  chain-over-cap trade-off in plan.md) and add a bounds invariant. Re-window
  is safe: moment ids are documented non-durable (B22).
- Verify: `SELECT max(length(text)), count(*) FILTER (WHERE length(text)>800)`
  over kind='moment' → 1063, 178.

### B27: M1's as-app-role probe tests the pre-A1 predicate, not the deployed one
- Severity: low · data-integrity/security · scripts/migrate-search-extensions.mjs:169-172
- Source: DATC-6 (data-integrity)
- Problem: the functional probe exercises the A1-rejected form (set_config
  threshold + OPERATOR(extensions.<%)) instead of the ratified production
  form (`%` operator + word_similarity() >= 0.45); neither the probe nor the
  static invariants (:74-93) prove the deployed privilege path — a false-pass
  risk that defeats the SEC-2/BLA-8 purpose of the invariant.
- Fix: update the probe to the A1 production predicate:
  OPERATOR(extensions.%) plus extensions.word_similarity(q, name) >= 0.45.

### B28: dry-run fabricates invariant_failures:0 without running invariants
- Severity: low · observability · scripts/migrate-search-kjv.mjs:186-190 (same in scripts/migrate-search-projections.mjs:173)
- Source: OBSC-8 (observability)
- Problem: dry-run emits migration_done {invariant_failures:0} with zero
  invariant_check events; on real failure both scripts exit 2 with no
  terminal event — an unearned '0' in the durable log. The house reference
  (migrate-media-collections.mjs:127-145) runs invariants in dry-run and
  reports the true count.
- Fix: run invariants in dry-run too and report the true failures count in
  migration_done.

## Rejected findings

- SECC-3 → noise — prod probe: the only role matching `lumen_read%` is
  lumen_read itself; the realistic failure (admin-DSN fallback, role
  postgres) is already caught by the prefix assertion.
- SECC-5 → out-of-scope — episode-kind stamping is ingest-owned (decision 8);
  ingest INSERT stamps collection_id structurally; NULL fails closed by
  decision-6 design.
- CORC-5 → risky — fix would emit reference:null (decision 4's
  "unresolvable" signal) for resolvable references on transient errors; H18
  pins rejection→500 JSON.
- CORC-8 → noise — both id orders are deterministic; decision 3 requires only
  determinism; no pagination exists.
- CORC-9 → noise — correctness adversarial ruled Number('')=0 flows into the
  documented [1,25] clamp and the contract never defines empty/hex handling.
  (The same surface was independently tagged material by the api-contract and
  test-harness adversaries — shipped as B6.)
- PERC-4 → risky — the omit-predicate flag would conditionally bypass
  decision-6 fail-closed gating (the public=false kill-switch path) to save
  ~10-13ms/request at <1k req/day.
- APIC-4 → noise — refuted: coerceRow's string branch parses the
  double-encoded class (byte-tested, no throw); all 29,145 prod payloads are
  jsonb 'object'. (The genuinely-non-JSON-string class remains real — B16.)
- DATC-5 → noise — repair rebuilds payload from durable ref_id/ep.id; nothing
  unrecoverable is lost; the rowcount log is a nicety.
- DATC-7 → noise — header comment is wrong but G5 gates curated entries and
  pins cover spake/sware/shew; behavior desired; comment-fix only.
- OBSC-7 → noise — decision-10's enumerated script conventions are all
  present; terminal-event names aren't enumerated; M3 isn't a migration.
