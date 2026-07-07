# Code Panel — Correctness Review — tske-cross-references

Reviewed the implementation diff (`tske-impl.diff`) against `packages/scripture/src/osis-map.ts`,
`packages/scripture/src/crossrefs.ts`, `scripts/ingest-openbible-refs.mjs`, and
`apps/web/app/routes/scripture.tsx`. Prod ingest has **not** run live (dry-run: 344,799 rows →
614,209 edges, 0 unmapped, 67 self-refs) — CCOR-3 is architecturally demonstrable from the code but
its live frequency is unverified.

Traced and confirmed *not* bugs, for the record: `expandOsisRange`'s `last > count` / `last < verse`
guard correctly rejects inverted and out-of-chapter-end ranges without over-rejecting legitimate
multi-chapter ranges (`last` only equals `count` on non-terminal hops, so the `last > count` branch
only ever fires on the end chapter); the `nextChapter`-omitted fallback (`${book}-${chapter+1}`)
cannot infinite-loop because `verseCount` returns `null` for any id outside the real spine, and the
200-hop cap is a second backstop; `Gen.1.1-Gen.1.1` degenerate ranges correctly collapse to a plain
edge (`range_start`/`range_end` nulled) and are then correctly picked up by the SQL representative
filter's `IS NULL` branch; the OSIS→slug table is a clean 39+27=66-book bijection matching
`packages/scripture/src/slug-map.ts`'s `BOOK_SLUGS` exactly (`Phil`→`philip`, `Phlm`→`philem`
confirmed distinct); the `Rev.12.18`→`Rev.13.1` exception is plausible (KJV Rev 12 has 17 verses,
Rev 13 has 18 — this is the documented NA/UBS-vs-KJV split at the "stood upon the sand" clause) and
is applied uniformly to `from`, single `to`, and both range endpoints; the `UNION ALL` of two
parenthesized `ORDER BY ... LIMIT` subqueries is valid Postgres and deliberately non-deduping (each
branch is already representative-filtered or naturally 1-row-per-source).

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| CCOR-1 | Critical | `packages/scripture/src/crossrefs.ts:93,97-98` (`groupCrossRefs`) | Incoming cards key/label/`verse_id` by the target range's `range_start`, not the source `verse_id` — collapses distinct citing verses sharing a range and mis-navigates "Referenced by" links to the wrong verse. | For `direction === 'incoming'`, dedupe key, `verse_id`, and label must use `r.verse_id` (the source); reserve `range_start`/`range_end` labeling for outgoing rows only. |
| CCOR-2 | Medium | `scripts/ingest-openbible-refs.mjs:73-77` (`rangeStart = targets[0]`) + `:100-112` (`dedupeEdgeRows` self-ref drop); consumed by `packages/scripture/src/crossrefs.ts:50` representative filter | If a range's first target equals its own `from_id` (self-cite starting a range), dedup drops that edge, orphaning `range_start` — no surviving row has `to_id = range_start`, so the whole range vanishes from the outgoing panel though later members remain in the table. | Pick `range_start` from the first *non-self* target, or re-derive the representative as `MIN(to_id)` over surviving rows per `(from_id, range)` group post-dedup. |
| CCOR-3 | Low | `apps/web/app/routes/scripture.tsx:361-364` (`loadCrossRefs` call) vs `:372-377` (`selectedVerse`/`crossRefs` gating); log at `:138-140` | `loadCrossRefs` runs a Postgres query (and can log `crossref_empty`) for any numeric `?verse=`, even one outside the chapter's verse count, before the result is discarded via the `selectedVerse` check. | Gate the `loadCrossRefs` call on `requestedVerse` being a valid verse number for this chapter (same check used for `selectedVerse`), not just non-null. |

## Notes on severity

**CCOR-1** is the headline finding: the trap description in the task ("for incoming cards the
dedup key should be the source verse, not the target range") is correct. Concretely, if
`rom-3-10` and `rom-3-12` both cite `ps-14-1–ps-14-3` and the reader is viewing `ps-14-2`, both
incoming rows carry `range_start = ps-14-1`; `groupCrossRefs` treats them as the same card, silently
drops one citing source, and the surviving card's `verse_id` is set to `ps-14-1` (a verse in the
*reader's own chapter*) instead of `rom-3-10` — clicking "Referenced by" navigates into Psalm 14
instead of Romans 3. The bug is silent (no throw, no visibly-broken UI), so it will not surface via
smoke checks or the `zero_orphan_endpoints` invariant, which only validates that edge endpoints
resolve to *some* live verse, not that panel-level identity is correct. This should block merge —
it directly corrupts the "Referenced by" feature for any verse that is the middle/end of a
multi-verse range with more than one citing source, which is a normal pattern at 614k edges.

**CCOR-2** has no test coverage (`crossref.test.ts` never feeds `groupCrossRefs` an incoming row
with `range_start` set), which is why it shipped unnoticed. Recommend adding a case with two
distinct `verse_id` incoming rows sharing one `range_start` alongside the fix.

**CCOR-3** is not observable in the dry-run stats alone (67 self-refs is the total across both
plain and range-expanded edges; the dry run doesn't report how many are range-starting). Worth a
one-off query before/after the real ingest: count edges where `metadata->>'range_start' = to_id`
that are then removed by dedup, vs. `range_start` values that have zero surviving representative row.
