# CODE-PANEL / api-contract review — canon-spine implementation

Reviewed: `spine-impl.diff`, `packages/scripture/src/queries.ts` (full),
`resolve-reference.ts`, `index.ts`, `scripts/migrate-canon-spine.mjs`,
`scripts/smoke-canon-spine.mjs`, `scripts/__tests__/canon-spine.test.mjs`,
`packages/scripture/src/__tests__/spine-queries.test.ts`, `apps/web/app/routes/{home,book,scripture}.tsx`.

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| CAPI-1 | High | `queries.ts` L21 `VERSE_COLUMNS` (`b.volume_id`); `migrate-canon-spine.mjs` L274-291 parity checks + L209-211 invariant | No check anywhere compares old `verses.volume_id` to new `books.volume_id` (via chapters join); unlike `book_id`, which is FK-verified, a drifted row silently changes MCP verse JSON post-P4. | Add an in-tx invariant: `SELECT count(*) FROM verses v JOIN chapters c ON c.id=v.chapter_id JOIN books b ON b.id=c.book_id WHERE b.volume_id IS DISTINCT FROM v.volume_id` must be 0. |
| CAPI-2 | Medium | `resolve-reference.ts` L80-92 ('unknown' case); `spine-queries.test.ts` | `getVerseByReference` and the 'unknown'-level byId/byRef fallback path are never imported or exercised in `spine-queries.test.ts` — zero shape/SQL assertion despite backing MCP's free-text lookup. | Add a `spine-queries.test.ts` case for `getVerseByReference`'s SQL shape and a `resolveReference('unknown')` case covering the byRef fallback. |
| CAPI-3 | Medium | `queries.ts` L123-137 `getBook`/`getVolume`; repo-wide grep | New public exports `getBook`/`getVolume` (added per API-3 resolution) have no test coverage anywhere — not in `spine-queries.test.ts`, not in `book.loader.test.ts` beyond a mock. | Add SQL-shape assertions for `getBook`/`getVolume` in `spine-queries.test.ts`, matching the pattern used for `getBooksByVolume`. |
| CAPI-4 | Low | `spine-queries.test.ts` L46-52 `getBooksByVolume` test | Only asserts SQL text contains `lumen.books`/excludes `lumen.verses`; never asserts the returned row's key set, so a regression re-adding `description`/`metadata` columns would pass. | Add `expect(Object.keys(row)).toEqual(['id','name','abbrev','sort_order'])`-style assertion alongside the SQL-text checks. |
| CAPI-5 | Medium | `migrate-canon-spine.mjs` L275-291 `parityPairs` | Only 3 of 10 rewritten queries get an old-vs-new parity diff (`getVolumeList`, `getChapterNumbers`, `getVersesByChapter`, and that last one only diffs `id`/`text`); `getPassage`, `searchScriptures`, `getBooksByVolume`, `getVerseById/ByReference` have none. | Add parity pairs (or at least column-superset diffs) for `getPassage`, `searchScriptures`, and `getBooksByVolume` before P1 runs live. |
| CAPI-6 | Low | `apps/web/app/routes/home.tsx` L10-15 `BookRow.sort_order: number \| null` | `getAllBooks` now selects `sort_order` from `lumen.books` (NOT NULL per schema), so the `\| null` branch is dead; harmless today but signals the type wasn't re-derived from the new column, not just the old `chapter_count` drop. | Narrow `BookRow.sort_order` to `number` to match the new NOT NULL column; drop the `?? 0` fallback in the sort comparator. |
| CAPI-7 | Low | `queries.ts` header comment L4-19 vs actual exports | Comment enumerates exactly 13 named exports (10 rewritten + 2 new + `getEntity`/`getChapterArt`/`getPublicCollectionIds` unchanged) but omits `getVerseByReference` from any coverage note beyond the list itself — no cross-reference to the missing harness case (CAPI-2), so the gap is invisible from the file that claims completeness. | Add a one-line comment next to `getVerseByReference` noting it shares `VERSE_COLUMNS`/aliasing and needs the same shape test as `getVerseById`. |

Cross-cutting note: CAPI-1 and CAPI-5 compound — the one field (`volume_id`)
that changed its source table (verse row → joined book row) is also the one
field no automated check, parity pair, or smoke assertion ever compares
old-vs-new. Everything else that moved tables (`book_id`, `chapter_number`)
has either a backfill-by-construction guarantee or an explicit invariant;
`volume_id` has neither.
