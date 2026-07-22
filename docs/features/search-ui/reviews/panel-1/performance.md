# Panel-1 / Performance review — search-ui plan

Reviewer lens: keyset predicate plans (index usage vs re-scan/offset-equivalent
work per page), tie-tier CASE vs cursor composition, SSR double-windowing,
modal bundle cost, infinite-scroll append cost at 200+ rows.

## Findings

| ID | Severity | Where | Problem | Fix |
|----|----------|-------|---------|-----|
| PU-1 | high | `packages/scripture/src/search.ts:271,369,505-514` (ORDER BY / `sortResults` include a computed `sub` tiebreak) vs `docs/features/search-ui/plan.md:26` (cursor = `v1\|qhash\|tier\|score\|id`, no `sub`) | Cursor omits the `sub` (jst/moment-demotion) column that the ratified sort key `(tier, sub, score DESC, id)` (search-endpoint REL-5) actually uses for the `scripture` and `episodes` groups. A 3-column `(tier,score,id)` keyset predicate cannot reconstruct that order — once the first page is filled entirely by `sub=0` rows (verses/episodes), every `sub=1` row (JST/moments) with a score at or above the paging cursor's threshold is permanently excluded from all subsequent pages. Live-verified (see Evidence): for q=`faith`, scope=`scripture`, a page-2 fetch using the plan's 3-field cursor removed **348 of 348** JST rows (`Rows Removed by Filter: 348`, 0 passed); the 4-field `(tier,sub,score,id)` version correctly returned all 348. Because the excluding verse-score threshold only shrinks on later pages, the JST rows never recover — the loss is permanent, not a reorder. Same defect applies to `episodes` (`episode` sub=0 vs `moment` sub=1). | Add `sub` to the cursor payload (`v1\|qhash\|tier\|sub\|score\|id`) and compose the WHERE as a true 4-column keyset comparison on the scripture/episodes legs; extend F1's live harness to a query with enough matches in *both* subs to cross a page boundary (q=`faith` already has 810 verses / 348 JST — just needs the right assertion, see PU-3). |
| PU-2 | high | `apps/web/app/routes/__tests__/search.loader.test.ts:10-17` (mocks `getSessionUser` → `user: null` unconditionally; `searchAll` and `getPublicCollectionIds` fully mocked) + `:64-68` (the CPERF-6 "bounded query count" assertion) vs `apps/web/app/routes/api.search.tsx:92-100` / `apps/web/app/lib/collection-access.server.ts:24-31` (admin branch calls `getEntitlements` + `SELECT id FROM lumen.collections`) | The `search.loader.test.ts` F6 test asserting `db.execute.mock.calls.length <= 1` is vacuous as written: with `searchAll` and `getPublicCollectionIds` both mocked at the module level and the session always anonymous, **zero** real `db.execute` calls occur in *any* implementation that reaches this code path — the bound passes trivially regardless of whether the loader is correctly bounded. It never exercises the one case that actually risks extra queries: an authenticated/admin session, where `getCollectionAccessStrict` calls `getEntitlements` and then, if entitled, an extra `SELECT id FROM lumen.collections` (mirroring `api.search.tsx`). This is precisely the CPERF-6 regression class named as binding prior-learning in the plan itself (plan.md: "the `/search` loader gets a bounded-query harness assertion from day one"), and the harness as given does not deliver it. | Add an authenticated/admin-session test case (mock `getSessionUser` to return a user, `getEntitlements`/`getCollectionAccessStrict` realistically) and assert the true query ceiling for that path, not just the anonymous 0-query path. |
| PU-3 | med | `packages/scripture/src/__tests__/search-cursor-harness.test.ts:48-53` | F1's "no gap" assertion (comment: "union of both pages equals the first 25+n of a single big page") actually refetches `limitPerGroup: 25` again and compares it to `ids1` from the *first* fetch — this only proves page-1 is deterministic/repeatable, not that page-2 continues without a skipped row. A real no-gap check needs a single `limit: 50` fetch compared against `ids1.concat(ids2)`. This gap is exactly why PU-1's cursor defect can ship green: the harness never actually fetches a combined window spanning the page-1/page-2 boundary to compare against. | Change the `big` fetch to `limitPerGroup: 50` (or the ids1.length+ids2.length total) and assert it equals `[...ids1, ...ids2]`, matching the comment's stated intent. |
| PU-4 | med | `packages/scripture/src/search.ts` — `scriptureLeg`/`entityLeg`/`episodesLeg`/`artLeg` inner `ORDER BY tier, sub, score DESC, id`; live index probe on `lumen.verses`/`lumen.entities`/`lumen.search_index` | `tier`/`score`/`sub` are computed per-row expressions (CASE / `ts_rank(...)`), never materialized or indexed — only GIN indexes exist on `search_vector`/`tsv`/`name`/`title` (trgm). So the "keyset" predicate gives no index-seek benefit: every page re-executes the full GIN bitmap scan, re-fetches every matching heap row, and recomputes `ts_rank` for the **entire** candidate set before filtering/sorting — cost is bound by total match count, not by page depth or page size. Live-measured (see Evidence): walking 8 sequential cursor pages of q=`lord` (8,840 verse matches) cost a flat **105–118 ms per page**, not decreasing with depth and not meaningfully cheaper than an equivalent `OFFSET`/`LIMIT` top-N heapsort would be. This isn't a correctness bug, but the plan's "keyset pagination" framing implies an index-seek cost model that doesn't hold here, and the cost is paid on every infinite-scroll append — the single-scope isolate view is exactly the case the plan optimizes toward. | Document the expected per-page cost explicitly (it will not shrink with an index later without a materialized rank column), or cap total appended pages server-side for very common single-word queries, so "More" on a popular word isn't an unbounded string of ~100ms+ round trips. |
| PU-5 | med | `apps/web/app/root.tsx:74-83` (new `SearchModal` mount site, plan.md:39) vs established precedent `apps/web/app/components/graph/GraphOverlay.tsx:20-21` and `apps/web/app/routes/scripture.tsx:61` (`lazy(() => import(...))` for occasional-use UI) | The plan's "Files touched" list (`root.tsx` — orb + modal mount) doesn't specify code-splitting `SearchModal`. `root.tsx` wraps every route in the app; anything imported there eagerly (not `lazy()`) ships in the baseline JS for every page load, including pages that never open search. This codebase already has an established pattern for exactly this situation (`GraphOverlay`/`ForceLayout`/`RadialLayout` are all `lazy()`-split because they're occasional-use, route-scoped UI) — the plan should follow the same discipline for a *global, root-mounted* modal, which is an even stronger case for splitting since it affects literally every route, not just one. | Import `SearchModal` via `lazy(() => import("~/components/SearchModal"))` in `root.tsx`, wrapped in `Suspense` (mirroring the `GraphOverlay` call site), so its JS is fetched only when the modal/hotkey path is first triggered. |
| PU-6 | low | `docs/features/search-ui/plan.md` Scope/F11 (infinite scroll + keyboard selection) — no virtualization dependency present (`apps/web/package.json` has no `react-window`/`react-virtual`/equivalent) | Plan states infinite scroll (sentinel + "More" button) and requires selection to survive appends (F11), but has no stated strategy for render cost as the appended list grows into the hundreds of rows. This is a realistic scenario, not a hypothetical: live-probed verse-only match counts for common single words are large (`god`=6,129, `lord`=8,840, `jesus`=1,209 — see Evidence), so a light user who isolates to Scripture on a common topic (the plan's own "More in X →" gesture) and scrolls a few times crosses 200+ rendered rows quickly, each row carrying per-type icon + mark-parsed snippet + (for episodes) timestamp formatting. | State an explicit row cap for non-virtualized rendering (e.g., stop offering "More" past N total, matching the reader-first/non-workspace positioning already in the plan), or scope in lightweight windowing for the single-scope isolated view before shipping. |

## Evidence

**Environment**: live prod, read-only, `lumen_read` role via the Hyperdrive DSN in
`apps/web/.env` (`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`).
Confirmed `current_user = lumen_read` before probing. SELECT/EXPLAIN only, no
writes. Probe scripts run from repo root with `NODE_PATH=$(pwd)/node_modules`
(the local `pg` package), scratch files under
`/private/tmp/claude-501/-Users-abram-code-lumen/e08e0036-b9be-449d-a5f0-35fab2f84789/scratchpad/probe{1..5}.js`.

**Index inventory** (`pg_indexes`, schema `lumen`):
- `verses`: `verses_pkey(id)`, `idx_verses_reference(reference)`, `idx_verses_search GIN(search_vector)`, `idx_verses_chapter_id(chapter_id, verse_number)` — no index touches `tier`/`score`.
- `entities`: pkey, `idx_entities_type`, `idx_entities_type_id`, `idx_entities_collection`, `idx_entities_search GIN`, `idx_entities_name_trgm GIN` — same gap.
- `search_index`: `search_index_pkey(kind, ref_id)`, `idx_search_tsv GIN`, `idx_search_coll`, `idx_search_title_trgm GIN` — same gap.

**PU-1 proof** (`probe2.js`): built the real `scriptureLeg` inner query (verse ∪
jst_reading) for q=`faith` (810 verse matches, 348 jst matches, confirmed by
direct count query). Page-1 (`ORDER BY tier,sub,score DESC,id LIMIT 25`) returns
25 verse rows, last = `(tier=3, sub=0, score=0.0235178302973509, id=dc-61-10)`.
Page-2 built two ways from that cursor:
- **3-field (plan's design)**: `WHERE (tier>3) OR (tier=3 AND score<0.0235…) OR (tier=3 AND score=0.0235… AND id>'dc-61-10')`. EXPLAIN ANALYZE shows the entities/jst branch: `Bitmap Heap Scan on entities e ... actual rows=0 ... Rows Removed by Filter: 348` — **all 348 jst rows excluded**.
- **4-field (tier,sub,score,id)**: same predicate plus a `sub` comparison. Entities branch: `actual rows=348`, all included, no filter drops them.

Because page cursors only advance to *smaller* scores as paging continues, and
the exclusion condition requires `jst.score < cursor.score`, a jst row is
excluded at every subsequent page too (the threshold only shrinks) —
confirmed by the direction of the inequality, not just this one boundary.

**PU-1 also applies to `episodes`**: `probe5.js` — for q=`faith`,
`search_index` has 1 `episode` match and 220 `moment` matches (same
`sub=0`/`sub=1` split as scripture's verse/jst, `packages/scripture/src/search.ts:369`).

**PU-4 proof** (`probe4.js`): walked 8 sequential real cursor pages (4-field,
correct version) for q=`lord` (8,840 verse matches, `probe3.js`), timing each
round trip: `105ms, 105ms(6)/107-118ms range` — page 1 = 118ms, pages 2–8 each
105–118ms, no downward trend with depth. `probe2.js`'s EXPLAIN ANALYZE on
page 1/2 for `faith` shows the mechanism: `Bitmap Index Scan on
idx_verses_search` (GIN, cheap) feeds a `Bitmap Heap Scan` that recomputes
`ts_rank(...)` for every matching row (`Rows Removed by Filter` growing each
page) before the top-N heapsort — i.e., no index seek into the sorted order
exists or can exist, since `tier`/`sub`/`score` are expressions, not columns.

**PU-6 counts** (`probe3.js`, `SELECT count(*) FROM lumen.verses WHERE
search_vector @@ websearch_to_tsquery('english', $1)`): god=6129, lord=8840,
jesus=1209, love=531, faith=810.

**PU-2/PU-3**: read directly, no live probe needed —
`apps/web/app/routes/__tests__/search.loader.test.ts:10-17` mocks
`getSessionUser` to always return `{ user: null, headers: new Headers() }`
and fully mocks `searchAll`/`getPublicCollectionIds`; `apps/web/app/lib/collection-access.server.ts:24-31`
shows `getCollectionAccessStrict` only calls `getEntitlements` when `userId`
is truthy, so the anonymous test path makes zero real `db.execute` calls
regardless of implementation, making the `<=1` assertion at
`search.loader.test.ts:64-68` unable to fail for the admin-path regression
CPERF-6 exists to catch. `search-cursor-harness.test.ts:48-53` re-fetches
`limitPerGroup: 25` for the `big` comparison instead of a 50-row combined
fetch, so it checks page-1 determinism, not cross-page continuity.

**PU-5**: `apps/web/app/root.tsx` has no `lazy()` usage today; established
precedent for occasional-use UI exists at
`apps/web/app/components/graph/GraphOverlay.tsx:20-21` (`lazy(() =>
import("./ForceLayout"))` etc.) and its call site
`apps/web/app/routes/scripture.tsx:61`. `apps/web/app/components/AppMenu.tsx`
(current sole root-adjacent component) is eagerly imported but is small and
always-visible chrome, not an analogous case — a modal that's closed on every
page load by default is.

**Not flagged (checked, no defect found)**:
- SSR double-windowing on typeahead/navigation: the modal is explicitly
  "input only" (plan.md:24, no live preview fetch) and F6
  (`search.loader.test.ts:50-54`) pins `searchAll` to exactly one call with no
  self-HTTP — the plan's own design and harness already guard this.
- Font/icon inlining: mockup (`build-mockup.py`) uses inline SVG paths (no
  icon font) and Newsreader italic 400 / Fraunces 400–600, both already
  covered by `root.tsx:37-48`'s existing Google Fonts `links()` — no new font
  request introduced.
