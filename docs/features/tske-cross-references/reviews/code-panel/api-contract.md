# CODE-PANEL — api-contract review: tske-cross-references

Scope: diff vs. plan.md amendment 11's pinned shapes, index.ts export wiring,
repo-wide consumer breakage, loader serialization, and harness coverage of
the new `packages/scripture/src/crossrefs.ts` exports.

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|----|----------|-------|------------------------|-------------------|
| CAPI-1 | Critical | `apps/web/app/routes/__tests__/scripture.loader.test.ts:12` | `getCrossReferences` mock returns `[]`, not `{refs,totals}`; every crossRefs path throws internally and silently degrades — verified live, 19/19 still pass green. | Mock `getCrossReferences` to resolve `{refs: [...], totals: {...}}`; assert `data.crossRefs.cards`/`totals` in the non-degraded case. |
| CAPI-2 | High | `packages/scripture/src/crossrefs.ts:89-105` (`groupCrossRefs`) | Incoming dedup key uses `range_start ?? verse_id`, not citer identity; two distinct citing verses sharing a target range's start collapse into one card — reproduced (2 rows → 1 card, wrong label). | Key incoming rows by `verse_id` (citer), only use `range_start` for outgoing's range collapse. |
| CAPI-3 | Medium | `packages/scripture/src/crossrefs.ts:17-26` (`CrossRefRow`) | Amendment 11 pins `CrossRefRow` to exactly 7 fields with non-nullable `votes: number`; implementation adds an untyped `total` field and `votes: number \| null`. | Strip `total` before returning `refs` (keep it internal to totals extraction), or amend the plan; align `votes` nullability with the contract. |
| CAPI-4 | Medium | `packages/scripture/src/__tests__/crossref.test.ts` | No test asserts `totals: {outgoing, incoming}` at all — every SQL-shape test feeds `capturingDb([])`, so the amendment-11-pinned totals extraction is completely unexercised. | Add a test with non-empty rows carrying `total`, asserting `getCrossReferences(...).totals` matches per direction. |
| CAPI-5 | Medium | `packages/scripture/src/__tests__/crossref.test.ts:17-27` | Amendment 14 claims the single-round-trip `UNION ALL` design is "pinned by the SQL-shape test," but no test asserts `UNION ALL` appears or that `db.execute` is called exactly once. | Add `expect(q).toContain('UNION ALL')` and `expect(db.execute).toHaveBeenCalledTimes(1)`. |
| CAPI-6 | Low | `packages/scripture/src/crossrefs.ts:38` | `limitPerDirection = 20` default from amendment 11's exact contract is untested — no assertion on the emitted `LIMIT` when the option is omitted vs. overridden. | Add a test asserting the query contains `LIMIT` 20 by default and a caller-supplied value otherwise. |
| CAPI-7 | Low | `packages/scripture/src/__tests__/crossref.test.ts:17-27` | SQL-shape tests never assert `collection_id`/`opts.collectionId` filtering, though it's the mechanism wiring the openbible/curated hybrid routing amendment 11 specifies. | Add `expect(q).toContain('collection_id')` (or assert the bound param) in the SQL-shape describe block. |

Clean, verified during this review (no findings):
- `index.ts` re-exports `crossrefs.ts` and `osis-map.ts` via `export *`, so `getCrossReferences`, `groupCrossRefs`, `BIBLE_BOOK_IDS`, `CrossRefRow`, `CrossRefCard` all resolve through the `@lumen/scripture` barrel as `scripture.tsx` imports them.
- Repo-wide grep for `getVerseConnections`/`CrossReference` turned up no broken consumers; `find-cross-references.ts` (MCP's `findCrossReferences`) is untouched, and `mode-instructions.ts` prose about `find_cross_references` still describes that unmodified path correctly.
- `loader`'s `crossRefs` field is a plain resolved object (part of the existing `Promise.all`), not a nested promise/defer — serializes as plain JSON through RR7 single fetch alongside the still-streamed `connections`.
