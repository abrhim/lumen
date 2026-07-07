# CODE-ADVERSARIAL / api-contract — tske-cross-references

Adversarial pass against `docs/features/tske-cross-references/reviews/code-panel/api-contract.md`
(CAPI-1..7). Re-ran the actual test suite, re-read `packages/scripture/src/crossrefs.ts`,
`packages/scripture/src/__tests__/crossref.test.ts`,
`apps/web/app/routes/__tests__/scripture.loader.test.ts`, and `apps/web/app/routes/scripture.tsx`
directly, and checked every claim against plan.md amendment 11 (exact `CrossRefRow`/`CrossRefCard`
shapes, `getCrossReferences` signature) and amendment 14 (UNION ALL / no-new-index posture) rather
than trusting the panel's prose.

**CAPI-1 verification.** Ran `pnpm --filter web exec vitest run
app/routes/__tests__/scripture.loader.test.ts`. Confirmed exactly: the mock at line 12
(`getCrossReferences: vi.fn(async () => [])`) resolves an array, but `loadCrossRefs`
(`scripture.tsx:136`) destructures `const { refs, totals } = await getCrossReferences(...)`.
Destructuring an array as `{refs, totals}` doesn't throw — both come back `undefined` — but
`groupCrossRefs(undefined)`'s `for (const r of rows)` (`crossrefs.ts:92`) does:
`TypeError: rows is not iterable`, caught by `loadCrossRefs`'s own try/catch, logged as
`crossref_degraded`, degraded silently. Live stderr confirms the exact error on every test that
touches `?verse=`, and the suite still reports `19 tests passed`. Net effect: no test in this file
exercises the crossRefs non-degraded path at all — `data.crossRefs.cards`/`.totals` are never
asserted, so the loader's `{refs,totals}` → `groupCrossRefs` → `CrossRefsPanel` wiring has zero
integration coverage despite 19 green checkmarks implying otherwise. This is worse than a missing
assertion; it's a false-positive test file.

**CAPI-2 verification.** Reproduced standalone: `groupCrossRefs` fed two `incoming` rows for
distinct citing verses (`ps-148-4`, `ps-22-1`) that both cite the same target range
(`range_start: 'heb-1-1'`, `range_end: 'heb-1-3'`) collapses to **one card**, `verse_id: "heb-1-1"`
(the target's own book — not either citer), label `"Psalm 148:4–3"` (Psalm reference spliced with
the target's chapter:verse — internally incoherent). This is the identical mechanism
`code-adversarial/correctness.md` already confirmed under CCOR-1 independently (dedup key
`` `${direction}:${range_start ?? verse_id}` `` uses the target-side `range_start` for incoming rows,
which isn't citer-identifying). Two independent adversarial passes reproducing the same defect by
different routes is strong corroboration, not redundant noise.

**CAPI-3 verification.** Amendment 11's pinned shape is unambiguous: `CrossRefRow = { verse_id,
reference, text, direction, votes: number, range_start: string|null, range_end: string|null }` — 7
fields, non-nullable `votes`. The actual interface (`crossrefs.ts:17-26`) has 8 fields (adds
`total: number`) and `votes: number | null`. Both are real, checked against the amendment text
directly, not inferred. Note the nullable-`votes` deviation is arguably the *amendment* being
incomplete, not the code: `crossrefs.ts`'s own docstring (line 14) says "Legacy curated edges carry
no votes → NULLS LAST," and the SQL casts `(e.metadata->>'votes')::int` which is `NULL` when the key
is absent — so `votes: number` as pinned cannot hold for the curated/`phase-b` collection this same
function serves. The `total` field is contained (never reaches `CrossRefCard`, which correctly omits
it — `groupCrossRefs`'s param type is `Omit<CrossRefRow,'total'> & {total?: number}`), so there's no
client-facing leak, but it's still an unpinned field on an "exact shape" contract whose entire reason
for existing (per amendment 11) is to be exact.

**CAPI-4 verification.** Grepped `crossref.test.ts` for `totals` — zero matches. Confirmed: both
SQL-shape tests call `capturingDb([])`, so `getCrossReferences`'s totals-extraction loop
(`for (const r of rows) totals[r.direction] = r.total`) never runs over a non-empty array in any
test. This isn't cosmetic — amendment 10 pins `totals` as the mechanism for the "20 of N" truncation
disclosure in the References section header, a named UX requirement, and it's exercised by zero
tests.

**CAPI-5 verification.** Grepped `crossref.test.ts` for `UNION ALL` and `toHaveBeenCalledTimes` —
zero matches for either. Amendment 14 states the UNION ALL single-round-trip design is "pinned by
the SQL-shape test"; that's false as written — the two existing tests assert substring presence of
`lumen.edges`/`from_id`/`to_id`/`votes`/`lumen.verses`, none of which pins single-statement,
single-round-trip execution. The implementation itself does use `UNION ALL` (`crossrefs.ts:53`,
confirmed by direct read) and a single `db.execute` call, so the code matches amendment 14's intent
— only the amendment's claim that this is test-locked is wrong, and a regression to two round trips
would pass every existing test.

**CAPI-6 verification.** Grepped `crossref.test.ts` for `LIMIT`/`limitPerDirection` — zero matches.
Confirmed: no test passes a custom `limitPerDirection` or asserts the emitted `LIMIT` value with the
option omitted. Real gap, but narrow: it's a single scalar default (`?? 20`, `crossrefs.ts:38`)
gating a `LIMIT` clause, with no cross-cutting behavior riding on it the way totals (CAPI-4) or
routing (CAPI-7) do — a regression here changes how many rows come back, not which collection or
whether the query is well-formed.

**CAPI-7 verification.** Grepped the same test file for `collection_id` — zero matches. Confirmed:
neither SQL-shape test asserts the WHERE-clause filter, even though `opts.collectionId` is what
routes the entire openbible/curated (`phase-b`) hybrid amendment 11 specifies. Note this is narrower
than it first sounds — `scripture.loader.test.ts`'s FM-7/FM-8 test *does* assert the loader calls
`getCrossReferences` with the correct `collectionId` argument for Bible vs. BoM verses — but that
only pins the caller side. Nothing pins that `crossrefs.ts` actually threads `collectionId` into the
SQL `WHERE e.collection_id = ${opts.collectionId}` filter (it does, confirmed by direct read of
lines 49/63) rather than, say, silently dropping it. A regression there would leak one collection's
rows into the other volume's panel with no test catching it.

## Table

| ID | Tag | Rationale (≤25 words) |
|---|---|---|
| CAPI-1 | material | Reproduced live: 19/19 green while every crossRefs path throws-and-degrades internally; happy path has zero real integration coverage. |
| CAPI-2 | material | Reproduced standalone (2 rows → 1 card, wrong verse_id/label); independently corroborates CCOR-1 via a different route. |
| CAPI-3 | material | Confirmed 8-field/nullable-votes vs amendment 11's pinned 7-field/non-null shape; `total` is contained, but the pin is genuinely violated. |
| CAPI-4 | material | Confirmed zero non-empty-row tests; totals gate the amendment-10 "20 of N" truncation UX with no coverage. |
| CAPI-5 | material | Confirmed: amendment 14's "pinned by the SQL-shape test" claim is false — no test asserts UNION ALL or call count; doc inaccuracy plus real gap. |
| CAPI-6 | risky | Confirmed untested default, but narrow blast radius — one scalar gating row count, not routing or shape. |
| CAPI-7 | material | Confirmed unasserted `collection_id` WHERE filter — the actual routing mechanism for the openbible/curated hybrid, only caller-side pinned elsewhere. |

## Stance

Six of seven hold as material, and two (CAPI-1, CAPI-2) are independently reproduced, not just
re-read — CAPI-1 by re-running the suite and capturing the live `crossref_degraded` stderr, CAPI-2
by isolating `groupCrossRefs` and observing the 2-into-1 collapse plus the wrong `verse_id`/label
directly. CAPI-1 is the standout: it means the loader test file's 19 passing tests assert nothing
real about crossRefs success, which should block merge on its own — a broken `getCrossReferences`
return shape in production would pass this suite unchanged. CAPI-2 should be fixed once, tracked
under CCOR-1 (correctness.md), not duplicated as two open items. CAPI-3 stays material because the
api-contract role's entire mandate is pinning exact shapes per amendment 11, but the fix is not
obviously "change the code" — `votes: number` in the amendment is arguably wrong given the code's own
documented null-votes case for legacy edges, so resolving CAPI-3 requires either stripping `total`
and updating the amendment's nullability, or both; flagging it material rather than risky keeps that
decision from being silently dropped. CAPI-4, CAPI-5, and CAPI-7 are downgraded from "generic missing
test" to material on their merits: totals feed a named UX contract (amendment 10), the UNION ALL
claim is a documented-but-false pin (amendment 14), and collection_id is the sole mechanism
separating two data collections that must never cross-contaminate. CAPI-6 is the one genuine
downgrade — real and worth a follow-up test, but it gates row count, not data shape or routing, so it
doesn't carry the same blocking weight as the others.
