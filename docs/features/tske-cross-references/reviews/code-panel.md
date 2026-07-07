# Code-panel aggregate — tske-cross-references

## api-contract
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

## correctness
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

## data-integrity
# Code Panel — Data Integrity Review — tske-cross-references

Reviewed `tske-impl.diff`, `scripts/ingest-openbible-refs.mjs`, `scripts/smoke-openbible.mjs`,
`packages/scripture/src/crossrefs.ts`, and `packages/scripture/src/schema.ts` against plan
amendments 1–14. Prod ingest has **not** run live (dry-run clean). Cross-checked the dedup-collision
hypothesis against the real vendored dataset (`data/openbible/cross_references.txt`, 344,799 rows):
scanned every `from` verse for (a) a range `to` overlapping a standalone single-verse `to`, (b) two
overlapping ranges, and (c) exact duplicate raw `(from,to)` pairs — all three counts are **0** in the
current file, so CDATA-1 below does not fire on this specific dataset, but the code has no defense
if a future OpenBible update introduces one.

Traced and confirmed *not* bugs, for the record: the entire write set (collection upsert, delete,
batched inserts, `migration_state` marker) runs through `tx` inside one `sql.begin(...)`
(`scripts/ingest-openbible-refs.mjs:187-227`) — no stray `sql.\`...\`` write executes outside it, so
the one-transaction guarantee holds; the `DELETE` is scoped by an exact `collection_id = 'openbible'`
equality (`:196`), never touching the legacy `phase-b` collection; the `DRY_RUN_ROLLBACK` string
sentinel (`:222,225`) is an established house pattern (identical in `align-edge-chapter-ids.mjs` and
`migrate-canon-spine.mjs`), and since the marker insert (`:217-220`) happens *inside* the same
transaction, a dry run rolls it back along with everything else — so `smoke-openbible.mjs`'s marker
comparison (`:15-17`) never sees a stale/inconsistent marker, it just correctly reports "missing"
until the first real ingest runs; `lumen.collections.tier`/`.category` are real `NOT NULL` columns in
`packages/scripture/src/schema.ts:67-81` (confirmed against `scripts/ingest-phase-a.ts`'s live DDL,
no drift), so the collection-row `INSERT` at `:189` will not fail.

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| CDATA-1 | Medium | `scripts/ingest-openbible-refs.mjs:99-112` (`dedupeEdgeRows`), consumed by `packages/scripture/src/crossrefs.ts:50` representative filter | When a from-verse cites both a range and an overlapping single verse, dedup's max-votes winner can discard the range's metadata, dropping or duplicating that card. | Merge metadata across colliding pairs instead of picking a winner: preserve range_start/range_end from any colliding row and keep the highest vote; add a unit test for this overlap. |
| CDATA-2 | High | `scripts/smoke-openbible.mjs:93` (`legacy curated refs intact for 1 Nephi 3:7`) | `legacy.n >= 0` is a tautology — `count(*)` is never negative, so the legacy-path-untouched check can never fail, even if those edges were wiped. | Assert `legacy.n > 0` or compare against a recorded pre-ingest baseline count so a regression in the untouched legacy path is actually detectable. |
| CDATA-3 | Low | `scripts/ingest-openbible-refs.mjs:189-194` (collection upsert `ON CONFLICT`) | `ON CONFLICT (id) DO UPDATE` refreshes name/description/provenance/license/storage but omits `tier`/`category`, so those two columns never self-correct on re-run. | Add `tier = EXCLUDED.tier, category = EXCLUDED.category` to the `ON CONFLICT` `SET` clause for full upsert parity. |

## Notes on severity and scope

**CDATA-1** is a distinct failure mode from `code-panel/correctness.md`'s CCOR-1/CCOR-2 (both
scoped to a *self*-referencing range-start row, or to incoming-card keying) — this one requires two
genuinely *different* source citations (a range and an independent single-verse row, or two
overlapping ranges) landing on the same `(from_id, to_id)` pair. Traced through concretely: if
`X` cites `Ps.148.4-Ps.148.5` (votes 10) and separately cites `Ps.148.5` alone (votes 20), dedup
keeps the higher-voted single-verse row at `to_id=ps-148-5` and discards its sibling range row's
`range_start`/`range_end`. Two outcomes depending on *which* member collides: if the collision lands
on a non-start member, the panel shows a duplicate — `Ps 148:5` appears both standalone and inside
the `Ps 148:4–5` range card; if it lands on the range's *start* verse, the range's representative row
loses `range_start`, so the SQL filter (`e.to_id = e.metadata->>'range_start'`) never matches any
surviving row for that range and the non-start members (e.g. `Ps 148:5`) silently disappear from the
outgoing panel entirely — a true lost card, with no invariant catching it (the in-tx check only
verifies referential integrity of endpoints, not range-group consistency). Rated Medium rather than
High because the exhaustive real-data scan above found zero occurrences in the current 344,799-row
file, so there's no evidence this manifests in the impending live ingest — but there's also zero test
coverage or in-tx invariant guarding it, so a future OpenBible data refresh could reintroduce it
silently.

**CDATA-2** converges with `code-panel/observability.md`'s COBS-1 (same line, same finding) — noted
here too since it's squarely a data-integrity gap: it's the *only* smoke check meant to confirm the
hybrid BoM/D&C legacy path (FM-7) survived the swap untouched, and it currently provides zero signal.

**CDATA-3** is cosmetic at current scale (tier/category are static constants in this script, so they
won't actually drift across re-runs unless someone edits the literal values) but breaks the "full
idempotent upsert" pattern DATA-5 established for the rest of the row.

## observability
# CODE-PANEL / SPECIALIST observability — tske-cross-references

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| COBS-1 | High | `scripts/smoke-openbible.mjs:90-93` (`legacy curated refs intact for 1 Nephi 3:7`) | Assertion `legacy.n >= 0` is a tautology — `count(*)` can never be negative, so this check can never fail even if legacy edges were wiped. | Assert `legacy.n > 0` (or compare against a recorded baseline count) so a regression in the untouched legacy path is actually detectable. |
| COBS-2 | Medium | `scripts/smoke-openbible.mjs:67-71` vs. `scripts/ingest-openbible-refs.mjs:28-31` (`VERSIFICATION_EXCEPTIONS`) | Amendment 5 lists two drift exceptions (3John.1.15, Rev.12.18); smoke only canaries the 3 John rewrite — a broken Rev.12.18→rev-13-1 mapping ships undetected. | Add a smoke check mirroring the 3 John one for `rev-13-1` (present) / `rev-12-18` (absent, nonexistent verse). |
| COBS-3 | Medium | `scripts/ingest-openbible-refs.mjs:222-229` (`openbible_tx_done` vs. `openbible_ingest_done`) | Amendment 9's "run summary logs deleted/inserted totals" lands only on `tx_done`, which the dry-run throw (line 222) skips — dry runs never log a deleted count anywhere, and `ingest_done`'s `edges` field never carries `deleted`. | Add `deleted`/`inserted` (computed before the dry-run throw) to `openbible_ingest_done` so both real and dry runs report projected write volume. |
| COBS-4 | Medium | `scripts/ingest-openbible-refs.mjs:177-181` (unmapped-ratio threshold) vs. `scripts/__tests__/openbible.test.mjs` | Amendment 7 requires a "boundary-value unit test" for the FM-11 cap; the `ratio >= UNMAPPED_CAP` comparison is inlined in `main()`, not exported, so no test in the harness exercises the 0.5% boundary. | Extract the threshold check into an exported pure function (e.g. `checkUnmappedRatio(count, total, cap)`) and add a boundary test at exactly 0.5%. |
| COBS-5 | Low-Med | `apps/web/app/routes/scripture.tsx:129-134` (`crossref_degraded`) vs. `:284-290` (`neo4j_degraded`) / `:249-256` (`graph_degraded`) | Sibling degrade events carry `book`/`chapter`/`verse` (or `entityId`/`depth`/`collections`) plus `elapsedMs`; `crossref_degraded` logs only `{name, message, verse}` — no timing, no split book/chapter fields. | Add `elapsedMs` (time the `getCrossReferences` call) and `book`/`chapter` fields for shape parity with `neo4j_degraded`/`graph_degraded`. |
| COBS-6 | Low | `scripts/ingest-openbible-refs.mjs:140-142`, `scripts/smoke-openbible.mjs:17-19` | `postgres(url, …)` client construction runs before/outside the `try/catch` that calls `scrub()`; a malformed-URL throw here would print the raw DSN (with password) unscrubbed. Mirrors a pre-existing gap in `migrate-canon-spine.mjs`/`smoke-canon-spine.mjs`. | Wrap the `postgres(url, …)` call in the same try/catch (or a dedicated try) that routes its error message through `scrub()`. |
| COBS-7 | Low | `scripts/ingest-openbible-refs.mjs:172-181` (`openbible_unmapped_refs` vs. `openbible_unmapped_threshold`) | Same run's `ratio` is logged rounded to 5 decimals in `openbible_unmapped_refs` but as a raw unrounded float in `openbible_unmapped_threshold` — inconsistent precision for one metric across two events. | Reuse the same `Number(ratio.toFixed(5))` value for both log calls. |
| COBS-8 | Low | `scripts/ingest-openbible-refs.mjs:159` (`openbible_ingest_start`) | `dataFile` is logged as a hardcoded literal string duplicating the `DATA_FILE` constant defined at line 21 — will silently go stale if the constant ever changes. | Log `dataFile: DATA_FILE` (or a path relative to `ROOT`) instead of the literal string. |

## Notes / verified-clean

- `openbible_unmapped_refs {count, ratio, sample}`, `openbible_dedup {built, selfRefs, duplicates, final}`, `openbible_tx_done {deleted, inserted}`, and `openbible_ingest_done {..., elapsedMs}` all exist with the promised field names (`scripts/ingest-openbible-refs.mjs:172-176, 213, 223, 229`).
- `openbible_tx_done` placement is correct, not misleading: the dry-run throw (`if (dryRun) throw new Error('DRY_RUN_ROLLBACK')`, line 222) executes *before* the `log('openbible_tx_done', …)` call on line 223 — a dry run never prints a false "committed" event. The `.catch` on line 224-227 correctly distinguishes the sentinel dry-run rollback from a real failure.
- `openbible_unmapped_threshold` is a genuinely named check with `{ratio, cap, pass}` and correctly causes the ingest to exit 1 (breach throws, propagates to the outer catch, `exitCode = 1`).
- Both scripts' documented exit codes match actual behavior and house style (`ingest-openbible-refs.mjs`: 0/1 as documented; `smoke-openbible.mjs`: 0/1, same pattern as `smoke-canon-spine.mjs`).
- `scrub()` is correctly applied on the primary fatal paths: `openbible_ingest_fatal` (ingest) and the `✗ fatal:` catch (smoke) both route through `scrub(err.message)` — see COBS-6 for the narrower pre-try-block gap.
- Smoke checks otherwise map 1:1 to plan §5 + amendments: count (`n.n > 344799`), marker/re-run stability (amendment 9/OBS-5), zero-orphan endpoints, famous refs (Gen 1:1→Heb 11:3, John 3:16), Psalm-title canary (amendment 5/COR-1), vote ordering, and the EXPLAIN index sanity check (amendment 14) are all present with correct assertions.
- `crossref_empty` (`scripture.tsx:124-126`) fires only for the non-curated (Bible/openbible) path per OBS-7's intent, with a reasonable minimal `{verse}` payload for what is an informational, not a failure, event.

## performance
# CODE-PANEL performance review — tske-cross-references

Reviewed: `crossrefs.ts` UNION ALL query, `ingest-openbible-refs.mjs` bulk load,
`scripture.tsx` loader wiring. Measured against stated bounds: ~614k edges
post-ingest, worker→PG 10–50ms, 0 users, existing indexes per
`scripts/setup-indexes.sql` (`idx_edges_from`, `idx_edges_to`,
`idx_edges_from_rel(from_id, rel_type)`, `idx_edges_collection`).

| ID | Severity | Where | Problem (≤25 words) | Fix (≤30 words) |
|---|---|---|---|---|
| CPERF-1 | Low | `crossrefs.ts:44,51,58,64` — `COUNT(*) OVER ()` + `ORDER BY (metadata->>'votes')::int` | Window/sort has no index support, so Postgres must materialize and sort the entire filtered edge set before `LIMIT` truncates it. Confirmed by window-function semantics, not a plan guess. | Acceptable at current max fan-out (~2,000 rows, sub-ms sort). No fix required now; if any verse's edge count could exceed low thousands, add a pre-LIMIT subquery or cap. |
| CPERF-2 | Low | `crossrefs.ts:59-64` incoming branch | `WHERE e.to_id = $1 AND rel_type=... AND collection_id=...` only has `idx_edges_to(to_id)` to lean on; `rel_type`/`collection_id` filter post-scan, pulling extra rows for verses referenced by both `openbible` and legacy `phase-b` collections. | Add `idx_edges_to_rel(to_id, rel_type, collection_id)` mirroring `idx_edges_from_rel` for symmetric incoming/outgoing index coverage. |
| CPERF-3 | Info | `ingest-openbible-refs.mjs:187-227` single tx, 123×5000-row batches | Delete+123 inserts run in one transaction (~2–4 min per script's own estimate), holding row-level write locks on `lumen.edges` for that span; MVCC means concurrent readers are unaffected either way. | No action needed at 0 users/offline admin run. Confirm the admin role's `idle_in_transaction_session_timeout`/`statement_timeout` exceeds ~4 min before running in prod. |
| CPERF-4 | Low | `ingest-openbible-refs.mjs:170,183` `buildEdgeRows`/`dedupeEdgeRows` | Both the built-rows array and the dedup `Map` hold ~614k row objects simultaneously; each row (2 short ids + metadata object) is ~200–350 bytes, so peak heap is roughly 150–250MB, transiently up to ~2x during dedup. | Fine for a one-time local/CI Node run under default heap limits (no `--max-old-space-size` needed). Revisit only if the corpus grows 5–10x. |
| CPERF-5 | Info | `ingest-openbible-refs.mjs:149-156` chapters 3-way join + count | 3-way join (`chapters`⋈`books`⋈`volumes`) LEFT JOIN `verses` GROUP BY, producing ~1,582 rows, runs exactly once at ingest start on PK-indexed joins. | Confirmed non-issue; no fix needed. |
| CPERF-6 | Info | `scripture.tsx:343-364` `Promise.all([...6 queries])` | `crossRefsRaw` is a 6th concurrent query against the worker's per-request postgres.js pool (`max: 5`, `db.server.ts:32`), so one query can queue briefly behind another — not full serialization behind all 5. | No fix needed; worst case adds one queued query's latency (~10–50ms), still far below sequential-sum time. |

**Summary:** no blocking performance issues at the stated 0-user / ~614k-edge scale. The two Low items (CPERF-1, CPERF-2) are architectural gaps — no index-backed LIMIT pushdown on the vote-ordered cross-ref query, and asymmetric incoming/outgoing index coverage — that are cost-free today because fan-out is capped (~2,000 rows) but should be revisited if a future data merge (e.g., adding another cross-ref collection into the same edges rows) removes that cap.

## security
# Code Panel — Security Review — tske-cross-references

Reviewed `tske-impl.diff`, `scripts/ingest-openbible-refs.mjs`, `scripts/smoke-openbible.mjs`,
`packages/scripture/src/crossrefs.ts`, and `apps/web/app/routes/scripture.tsx`.

Verified clean, for the record: **all SQL is parameterized** — `crossrefs.ts`'s UNION query binds
`verseId`/`collectionId`/`limit` via drizzle's `sql` tagged template (`crossrefs.ts:47-49,61-63`),
never string-concatenated; `verseId` is built from a URL `bookId`/`chapter`/`verse` that the loader
already validates/canonicalizes (`parseReference`, `/^\d+$/` chapter/verse guards,
`scripture.tsx:302-314,154-159`) before it ever reaches SQL, and would be safely bound even if it
weren't. The two `sql.unsafe()` calls in `smoke-openbible.mjs:28,83-85` are fully static string
literals with zero interpolation — no injection surface. `ingest-openbible-refs.mjs` never calls
`fetch`/`http` anywhere; the source TSV is read only via local `readFileSync(DATA_FILE, ...)`
(`:163`), satisfying SEC-1 (no network fetch while holding the admin DSN). `lumen_read` does have
`SELECT` on `lumen.edges`/`lumen.collections` (blanket schema grant,
`scripts/setup-readonly-role.sql:14-16`) and the app's runtime path (`apps/web/app/lib/db.server.ts`
via the Hyperdrive binding) is confirmed on that scoped read-only role, distinct from the admin
session-mode `DATABASE_URL` the ingest/smoke scripts use. The new `openbible` collection reads
correctly because `public` defaults to `true` in the schema. External license links render with
`target="_blank" rel="noreferrer"` (`scripture.tsx:976-991`), and the rendered attribution — source
name + link, CC BY 4.0 + link, and an explicit "adapted — ranges expanded" note
(`scripture.tsx:973-995`) — meets CC BY 4.0's identify-source/link-license/indicate-changes bar.

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| CSEC-1 | Medium | `scripts/ingest-openbible-refs.mjs:134-142`, `scripts/smoke-openbible.mjs:14-19` | `.env`/URL/port checks and `postgres()` client construction run before the `try`, so a thrown connection error escapes the `scrub()`-guarded catch entirely. | Move env read, URL validation, and client construction inside the try/catch that calls `scrub()` before logging or exiting. |
| CSEC-2 | Low | `data/openbible/cross_references.txt` (gitignored via `data/`), read at `scripts/ingest-openbible-refs.mjs:163-167` | Vendored TSV has no checksum recorded or verified; a substituted/corrupted local file is ingested with only structural checks, no authenticity check. | Record a SHA-256 in `data/openbible/README.md` and assert it at ingest startup before reading the file. |
| CSEC-3 | Low | `packages/scripture/src/crossrefs.ts:33-43` (`getCrossReferences`) | `collectionId` is queried directly against `lumen.edges` with no check against the public-collections allowlist other flows enforce (`getPublicCollectionIds`) — safe only because callers hardcode it today. | Validate `collectionId` against the public-collections allowlist inside `getCrossReferences` itself, not just at call sites. |
| CSEC-4 | Low | `scripts/setup-triggers-and-rls.sql:37-43` (pre-existing, unmodified by this branch) | `lumen.edges`/`lumen.collections` RLS policies are `USING (true)` — the `public` column that gates app visibility is enforced only at the app layer, not by RLS, for the read-only role. | File a follow-up: filter RLS on `public = true` (and future `owner_id`) instead of relying solely on app-layer `WHERE public = true`. |
| CSEC-5 | Low | `scripts/ingest-openbible-refs.mjs:189-194` (collection upsert) | The `openbible` collection INSERT never sets `public` explicitly; visibility depends implicitly on the schema's default value rather than a stated intent. | Add `public = true` (and keep it in the `ON CONFLICT` `SET` list) so visibility is explicit and audit-visible. |

## ux-a11y
# CODE-PANEL review — ux+accessibility (combined) — tske-cross-references

Reviewed against: `docs/features/tske-cross-references/plan.md` amendment 10, `.claude/skills/emil-design-engineering/SKILL.md`, the implementation diff, and `apps/web/app/routes/scripture.tsx` in full (functions `PanelBody`, `CrossRefsSkeleton`, `EntityChipsSkeleton`, `CrossRefsSection`, `Connections`, `EntityChips`, `CrossRefCards`).

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
| --- | --- | --- | --- | --- |
| CUX-1 | High | `scripture.tsx` `CrossRefsSection` (`aria-live="polite"`, line ~956) vs `Connections`/`EntityChips` (no live region) | `aria-live` sits on the synchronous cross-ref block, which never updates in place; the truly late-arriving entity chips (streamed via `Await`) have no live region at all — inverts A11Y-2's resolution. | Move `aria-live="polite"` to the streamed chips container (or its `Await` result wrapper) in `Connections`; drop it from `CrossRefsSection`. |
| CUX-2 | Medium | `scripture.tsx` `CrossRefsSkeleton` vs `CrossRefsSection` real output | Skeleton always renders one generic block (title + two fixed `h-20` cards); real content is up to two titled groups with 0–40 cards, a one-line empty/curated message, or a degraded line — causes visible layout shift every same-chapter verse navigation (`isPending`). | Shape the skeleton to bracket typical output (two group placeholders sized near median card count) or wrap both states in a shared min-height container. |
| CUX-3 | Low | `scripture.tsx` `CrossRefsSection`, CC-BY credit paragraph (after both `CrossRefCards` blocks) | Amendment 10 specifies the CC-BY credit sits "under the References header"; it instead renders after both "References" and "Referenced by" groups, reading as attached only to "Referenced by." | Move the credit line directly under the References header/cards, or record the single shared-credit placement as an approved deviation. |

## Verified compliant (no issue found)

- **No layout shift from streaming chips (UX-1):** cross-refs render synchronously above the streamed `Connections` block; entity chips append below via `Suspense`/`Await` and cannot shift the already-painted cross-ref cards. `isPending` gates both `CrossRefsSkeleton` and `EntityChipsSkeleton` off the same boolean in one render, so the skeleton→content swap happens in a single commit for both blocks (no relative desync) — see CUX-2 for the shift that swap still causes on its own.
- **"20 of N" disclosure:** `CrossRefCards`' `count` is computed per invocation from its own `total`/`cards.length`, correctly wired to `totals.outgoing` for "References" and `totals.incoming` for "Referenced by" independently; renders `"N"` when not truncated and `"N of M"` when truncated. Sits inside the `h3` as real text, screen-reader reachable.
- **Curated chip:** `text-xs` (12px) real text, `normal-case tracking-normal` correctly overrides the parent `h3`'s `uppercase tracking-[0.14em]` (both are non-inherited-by-default CSS properties explicitly reset on the child), so it renders "Curated" in mixed case as required (UX-4). Uses `border-rule2`/`text-muted-foreground` theme vars, not raw colors; all four theme blocks in `app.css` define distinct `--t-rule2` values.
- **Contrast tokens:** `text-cites`, `text-citedby`, `text-faint`, `text-muted-foreground`, `border-rule2` all resolve to theme CSS vars (`app.css`) with per-theme values across all four palettes — no raw hex/rgb in the new code.
- **Differentiated empty states:** all three states are coded and reachable — degraded (`panel.degraded`, "couldn't be loaded"), curated-empty (`panel.curated && no cards`, "not yet curated for this volume"), and Bible-empty (`!panel.curated && no cards`, "No cross-references found").
- **Range card label ("Psalm 148:4–5"):** `rangeLabel()` in `packages/scripture/src/crossrefs.ts` uses the en dash (`–`, U+2013) for same-chapter and same-book ranges, matching amendment 10's example exactly.
- **Votes not rendered:** `CrossRefCard.votes` exists only for sort order; `CrossRefCards`' card body renders only `x.label` and `x.text`, never a bare vote number.
- **Link cards keyboard/focus:** the `Link`/fallback `div` markup, hover/motion classes (`transition-[border-color,transform]`, `motion-reduce:transition-none motion-reduce:hover:translate-y-0`) are carried over unchanged from the prior `CrossRefGroup` implementation — no regression.
- **Motion-reduce on new elements:** `CrossRefsSection` itself adds no animation (nothing to reduce); the one new interactive hover effect (card hover-lift in `CrossRefCards`) already had `motion-reduce:` overrides before this diff and they're preserved.

