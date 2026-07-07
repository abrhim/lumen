| ID | Tag | Rationale (≤ 25 words) |
| --- | --- | --- |
| CAPI-1 | material | Confirmed: `b.volume_id` join replaces `v.volume_id`; no parity pair or smoke check compares old vs new value anywhere. P4 drop is irreversible. |
| CAPI-2 | material | Confirmed: `getVerseByReference` and the `'unknown'`-level resolver branch that calls it are imported nowhere in spine-queries.test.ts. Cheap to add. |
| CAPI-3 | material | Confirmed: no direct unit test for `getBook`/`getVolume` SQL. `getBook` is only exercised indirectly via a mocked loader test; `getVolume` has zero coverage. |
| CAPI-4 | noise | Restates the file's declared SQL-text-capture strategy (applies to nearly every test here), singled out on one function with no unique defect shown. |
| CAPI-5 | material | Confirmed: migrate-canon-spine.mjs `parityPairs` covers only 3 queries; getPassage/searchScriptures/getBooksByVolume/getVerseById/ByReference have none. Prod not migrated — still fixable. |
| CAPI-6 | noise | Confirmed `sort_order INT NOT NULL` in DDL vs `number \| null` type, but `?? 0` fallback already neutralizes it. Pure type-hygiene nit, no functional impact. |
| CAPI-7 | noise | Documentation-comment nitpick restating CAPI-2 as "the header doesn't cross-reference it." No functional consequence. |

Overall: the one High finding (CAPI-1) is real and load-bearing — the migration script and smoke checks genuinely never validate that the new joined `volume_id` matches the old denormalized column before P4 makes that unrecoverable, and it deserves to survive as-is. CAPI-2/3/5 are legitimate, cheaply-fixable coverage gaps in exactly the areas the harness claims to guard (MCP byte-stability, migration parity) and should be treated as real work items, not nitpicks. CAPI-4/6/7 are technically accurate but low-value: they either restate the file's already-declared testing strategy or flag defensive typing/doc-comment gaps with no runtime consequence, so they're downgraded to noise.
