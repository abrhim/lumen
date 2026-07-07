# Panel 2 / api-contract ADVERSARIAL review — canon-spine plan

Verified against `packages/scripture/src/queries.ts` (13 exports, counted directly),
`packages/scripture/src/resolve-reference.ts`, `apps/web/app/routes/book.tsx`,
`apps/web/app/routes/scripture.tsx`, `packages/scripture/src/__tests__/spine-queries.test.ts`,
and `docs/design/canon-spine.md`.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| API-1 | material | Confirmed: harness only exercises volume/book (`spine-queries.test.ts` L63). Verse case (`resolve-reference.ts` L77) spreads `VERSE_COLUMNS`, incl. columns P4 drops, straight to JSON, untested. |
| API-2 | material | Confirmed: Scope §3 names exactly 7 of 13 exports (counted). `getVersesByChapter` — every chapter load (`scripture.tsx` L298) and every MCP chapter resolve (`resolve-reference.ts` L58) — is absent from both list and harness. |
| API-3 | risky | Confirmed `getEntity(bookId)` supplies the name (`book.tsx` L30); design doc deprecates book/volume entities at P4. No `getBook`/`getVolume` proposed — a forward drift risk, not an immediate break (query still succeeds post-migration). |
| API-4 | material | Confirmed `getVerseById`/`getVerseByReference` share the same dropped-column `VERSE_COLUMNS` fragment, back the verse/unknown MCP paths, and are absent from both Scope §3 and the harness — same unmitigated class as API-1. |
| API-5 | risky | Confirmed no shape test for `getPassage`/`searchScriptures` despite correct enumeration. Partially mitigated by P3's row-for-row smoke diff (Failure Mode 6), unlike API-1/API-4 which have no compensating control. |
| API-6 | noise | Confirmed 3 exports (`getEntity`, `getChapterArt`, `getPublicCollectionIds`) unlisted, but none touch spine tables/dropped columns — no functional risk, pure documentation completeness. |
| API-7 | noise | `tokenize.ts` doesn't exist yet (harness-first, pre-implementation); `ingest-words.mjs` is a plain `.mjs` script, so a TS-only named type has no actual runtime consumer to protect. |
| API-8 | noise | Self-limiting: the finding itself calls the current approach "acceptable," and its proposed fix duplicates API-1's ask (exact-field-set assertions) rather than adding new action. |

## Stance

The specialist's central claim survives literal verification: Scope §3 names exactly 7 of
`queries.ts`'s 13 exports (`getAllBooks`, `getBooksByVolume`, `getChapterNumbers`,
`getVolumeList`, `getChapterSummary`, `searchScriptures`, `getPassage`), and the omitted
`getVersesByChapter` is demonstrably the hottest query in the system — it fires on every
`/scripture/:book/:chapter` load (`scripture.tsx` L298) and every MCP `chapter`-level
`resolveReference` call (`resolve-reference.ts` L58), while filtering directly on
`book_id`/`chapter_number`, both slated for the P4 drop. That is API-2, and it is material.

API-1 and API-4 are the same root defect from two angles (verse-shape MCP leakage; the two
verse-lookup functions sharing the doomed `VERSE_COLUMNS` fragment) and share the same
unmitigated exposure: nothing in the current harness or Failure-modes table catches a
`VERSE_COLUMNS` break before P4 ships, since `spine-queries.test.ts` never exercises
`chapter`/`verse`-level `resolveReference` or the two verse-getters directly. Both are
material and, per instructions, survive as correctness-class findings regardless of any
downgrade instinct.

API-3 and API-5 are real, verified gaps but softer than the above: API-3 doesn't break
anything today (entities table isn't deleted, just deprecated-in-place) so it's a drift
risk rather than a guaranteed regression; API-5's functions are correctly enumerated and
have a compensating control (P3's live row-diff smoke) that the API-1/API-4 class lacks.
Both downgraded to risky.

API-6/7/8 are accurate but non-actionable: API-6's three orphaned exports don't touch any
column the migration changes; API-7 speculates about a TS type for a file that doesn't
exist yet, consumed only by a non-TS script; API-8 explicitly self-certifies the status
quo as acceptable while duplicating API-1's fix. All three tagged noise — true statements,
zero blast radius.

Net: keep API-1, API-2, API-4 as blocking; fold API-3/API-5 in as follow-up-gated (getBook/
getVolume export, plus the two missing shape tests); drop API-6/7/8 from the action list.
