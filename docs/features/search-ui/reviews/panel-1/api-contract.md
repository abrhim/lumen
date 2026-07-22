# PANEL-1 / api-contract — search-ui plan review

Reviewed: `docs/features/search-ui/plan.md` against the red-first harness
(`search.loader.test.ts`, `api-search-cursor.test.ts`,
`search-cursor-harness.test.ts`), the shipped `api.search.tsx` /
`search.ts`, and the ratified `search-endpoint` plan (decisions 1–12,
amendments A1–A9). "Out (deliberate)" items (recent-searches, rate
limiting/abuse hardening, semantic search, MCP changes, ranking/snippet
changes) were treated as off-limits and not relitigated.

## Findings

| ID | Severity | Where | Problem | Fix |
|----|----------|-------|---------|-----|
| ACU-1 | high | `packages/scripture/src/search.ts:271,348,505-514`; plan.md cursor bullet (line 25); `packages/scripture/src/__tests__/search-cursor-harness.test.ts:47-53` | Cursor `v1\|qhash\|tier\|score\|id` omits `sub`, the REL-5-ratified jst/moment tiebreak that's actually part of the live `ORDER BY tier, sub, score DESC, id` for the scripture and episodes groups. Keyset predicates reconstructed without `sub` can skip or duplicate rows at the sub=0→1 boundary. The live F1 harness can't catch this: its "no gap" check re-fetches page 1 with identical params instead of an independent larger page. |  Add `sub` to the cursor tuple and the keyset predicate; add a live harness case that actually straddles the verse→jst (or episode→moment) boundary rather than staying inside one sub-run. |
| ACU-2 | high | `packages/scripture/src/search.ts:522`; plan.md Scope/Faceting bullet (line 25) | `searchAll` treats an empty `scope` array as "no filter → all groups" (`opts.scope?.length ? opts.scope : [...GROUP_KEYS]`). If a user excludes every one of the 7 facets via the click-to-exclude gesture and the `/search` loader (which calls `searchAll` directly per Q4, bypassing `api.search.tsx`'s hard 400 on `scope=`) forwards `scope: []`, the page silently shows everything again — the opposite of the user's last action. No F# case or `adaptiveLimit(0)` mapping covers zero active groups. | Define and pin explicit zero-group behavior (render "no groups selected" with no query, or disallow excluding the last group) in the plan; add a harness case and an `adaptiveLimit(0)` entry. |
| ACU-3 | high | `apps/web/app/routes/__tests__/search.loader.test.ts:24,33`; `apps/web/app/routes/__tests__/api-search-cursor.test.ts:27,36,102` | The harness's own `SearchResponse` mocks use `as unknown as SearchResponse` / `as any`, not `satisfies`. This directly contradicts the plan's own binding "Prior-learnings surfaced" line: "endpoint/route mocks must be `satisfies`-typed against real response types so drift breaks typecheck" — cited specifically because harness-origin bugs are the top provenance class on two prior features. | Rewrite the mock literals as `const EMPTY = {...} satisfies SearchResponse;` (drop the double-cast) so a future field rename in `SearchResponse` fails `tsc -b --force`, not silently. |
| ACU-4 | med | `apps/web/app/routes/__tests__/search.loader.test.ts:64-68` | The CPERF-6 "bounded query count" assertion (`expect(args.context.db.execute.mock.calls.length).toBeLessThanOrEqual(1)`) is vacuous as written: both DB-touching dependencies it's meant to bound — `getPublicCollectionIds` (mocked at the `@lumen/scripture` boundary) and `searchAll` itself (fully stubbed) — never touch `context.db.execute` in this test, so the count is always 0 regardless of how many times the real loader would call either. A regression that calls `getCollectionAccessStrict` twice, or hits the admin `SELECT id FROM lumen.collections` branch unconditionally, would not be caught. | Spy on `getCollectionAccessStrict`/`getPublicCollectionIds` call counts directly (not just the raw `db.execute` counter), or add an authenticated-admin test path that exercises the second query and asserts it fires exactly once. |
| ACU-5 | med | plan.md Scope bullet (line 25), F8; no F# case | The "More in X →" pill's interaction with pagination state is unspecified: isolating from the broad view (limit 8/group) to a single group (`adaptiveLimit(1)` = 25) doesn't say whether the fetch restarts fresh at page 1 (duplicating the 8 rows already shown) or continues from the broad view's stored `nextCursor` (which would silently skip rows 9–25 that were never rendered at limit-8 density). This is exactly the "limit interplay with cursor" question the review brief flags, and it's untested. | State explicitly in the plan that isolating to a group always restarts pagination fresh (no `after`) at the new adaptive limit; add an F-case and a loader/component test pinning it. |
| ACU-6 | low | plan.md Tier justification (line 4) and Public contract (line 44); `packages/scripture/src/queries.ts:76` | The plan frames `searchAll`'s new optional `after` param as a Ring-2 compatibility concern ("cross-system blast radius... Ring-2-consumed package", "Additive for Ring-2"). Verified: Ring-2's only documented consumer is `searchScriptures` (`queries.ts:76`), a separate, untouched function. `searchAll` currently has zero callers outside `apps/web/app/routes/api.search.tsx`. Doesn't change the tier (already large on other grounds) but the stated rationale is factually off. | Correct the rationale to name the real (in-repo, single) consumer of `searchAll`; keep the Ring-2 flag on `search.ts`'s vector/trigger surface where it actually applies. |
| ACU-7 | med | plan.md Files touched (lines 30-39), Q4 | Q4 has the `/search` SSR loader call `searchAll` directly rather than self-calling the HTTP endpoint, which means it must independently reimplement `api.search.tsx`'s scope/limit/`after`-cursor validation (F7's loader test expects the loader itself to throw a 400 on `scope=bogus`) and the `search_executed`/`search_group_degraded`/`search_failed` logging contract. No shared helper module is listed in "Files touched." | Extract the shared validation (`q`/`scope`/`limit`/`after` parsing + error codes) and observability logging into one module both routes import, so the 3 new cursor codes can't drift between the JSON and HTML surfaces. |
| ACU-8 | low | plan.md Q1 (line 66); `packages/scripture/src/__tests__/search-cursor-harness.test.ts:67-74`, `api-search-cursor.test.ts` F4 | The `(q, scope)` binding inside the cursor is specified only as "an 8-char hash" (Q1) — no algorithm or encoding named, unlike the `v1` version byte which the plan explicitly commits to pinning per its own "version-bumped keys need same-commit test pins" learning. F4's tests only exercise two fixed, unrelated strings ("faith" vs "hope"; "scripture" vs "people"), not collision/false-negative behavior. | Name the hash derivation in the plan (function + truncation length) so it's implementation-agnostic and testable; add a harness note on acceptable collision rate at expected cursor volumes. |

## Evidence

**ACU-1 — cursor omits `sub`.**
`packages/scripture/src/search.ts:505-514` (`sortResults`) sorts by
`tier`, then a `sub` computed as `a.type === 'jst' || a.type === 'moment'
? 1 : 0`, then `score DESC`, then `id`. The same `sub` column appears
directly in SQL in `scriptureLeg` (`ORDER BY u.tier, u.sub, u.score DESC,
u.id`, line 271) and `episodesLeg` (line 348, `CASE WHEN si.kind =
'episode' THEN 0 ELSE 1 END AS sub`). This is not incidental — the
ratified `search-endpoint` plan's decision ledger, REL-5, states the sort
key is `(tier, variant='jst', score DESC, id)` specifically "to avoid the
tier-4 gating interaction," i.e., `sub` is a load-bearing, deliberately
separate sort key, not a score/tier artifact.

The search-ui plan's cursor is `v1|qhash|tier|score|id`
(plan.md line 25/43; confirmed against
`search-cursor-harness.test.ts:69`: `encodeSearchCursor({ q, scope, tier,
score, id })` — no `sub` field). A keyset predicate built from
`(tier, score, id)` alone is `tier > ctier OR (tier = ctier AND score <
cscore) OR (tier = ctier AND score = cscore AND id > cid)`. Once a tier
mixes `sub=0` and `sub=1` rows (verse+jst in `scripture`;
episode+moment in `episodes`), this predicate is not equivalent to the
true 4-key total order: any `sub=1` row whose score is `>= cscore` is
permanently excluded (a gap), because the naive predicate has no clause
letting a later-`sub`, higher-`score` row through.

Live-probed (`lumen_read`, read-only) to confirm this is reachable, not
hypothetical:
```
jst faith hits:   348
verse faith hits: 810
```
Both types commonly co-occur in the `scripture` group for ordinary
queries — the sub=0→1 boundary sits around verse-rank #810 for `q=faith`,
well past a single 25-row page but squarely inside normal multi-page
scrolling. For the `episodes` group the risk is worse: episodes are a
tiny corpus (10 total) against a large moments corpus, so the
episode(sub=0)→moment(sub=1) transition is likely to land on page 1 for
most queries that match any episode at all.

The live F1 harness (`search-cursor-harness.test.ts:47-53`) claims to
check "no gap + order" via a `big` fetch, but that fetch uses the exact
same `limitPerGroup: 25` as page 1 (comment says "compare via two
sequential fetches against cursor pages" — it doesn't actually fetch a
combined 25+n page), so `big.groups[0].results` is just a
repeat-determinism check against `ids1`, not an independent verification
that page 2 has no gap relative to page 1. This is a structural
limitation of the test (the server caps `limitPerGroup` at 25 —
`clampLimit`, `search.ts:146-149` — so there's no way to fetch a single
page long enough to span both pages' worth of rows for direct
comparison), not just a naming slip.

**ACU-2 — empty-scope collapse.**
`packages/scripture/src/search.ts:522`:
```ts
const scope: GroupKey[] = opts.scope?.length ? opts.scope : [...GROUP_KEYS];
```
An empty array is falsy-length, so it's treated identically to
`scope: undefined` — "search everything." The current HTTP endpoint
(`api.search.tsx:53-62`) prevents ever reaching this by 400ing on
`scope=` (empty segment) before calling `searchAll`. But the search-ui
plan's Q4 says the `/search` loader calls `searchAll` directly (no HTTP
self-call), and the plan's own F7 loader test
(`search.loader.test.ts:91-94`) shows the loader does its *own* URL
scope-parsing and throws its own 400 for unknown keys — meaning it does
not reuse `api.search.tsx`'s validator wholesale. Nothing in the plan
states what the loader does when every facet is excluded (a `?scope=`
with zero remaining keys), and the natural implementation (split/filter
the CSV, pass the resulting array straight to `searchAll`) hits exactly
the `scope: []` → "show everything" collapse. `adaptiveLimit` is also
only pinned for 1–7 groups (F8, `search.loader.test.ts:83-90`), not 0.

**ACU-3 — mocks bypass `satisfies`.**
Plan.md's "Prior-learnings surfaced" (binding context, line 12): "Harness-origin
bugs are the top provenance class (2 features running) — endpoint/route
mocks must be `satisfies`-typed against real response types so drift
breaks typecheck." The actual harness:
- `search.loader.test.ts:24`: `const EMPTY: SearchResponse = { ... } as unknown as SearchResponse;`
- `api-search-cursor.test.ts:27`: same pattern.
- `api-search-cursor.test.ts:102`: `const withCursor = structuredClone(EMPTY) as any;` then mutated freely.

`as unknown as T` is a double assertion that suppresses structural
checking entirely (stronger than a single `as T`, which TS would already
reject if unsound) — it's the opposite of `satisfies`, which requires the
literal to conform to the type while still inferring the narrower literal
type. Spot-checking the `EMPTY` object, it appears to already satisfy
`SearchResponse` structurally, so the cast isn't masking a real
incompatibility — it's just not enforcing the guarantee the plan
promises the reviewer.

**ACU-4 — vacuous CPERF-6 assertion.**
`search.loader.test.ts:64-68`:
```ts
it("bounded query count: visibility + search only (CPERF guard)", async () => {
  const args = makeArgs("?q=faith");
  await loader(args);
  expect(args.context.db.execute.mock.calls.length).toBeLessThanOrEqual(1);
});
```
`searchAll` is `vi.fn()`-mocked (line 12), so it never touches
`args.context.db.execute`. `getSessionUser` is mocked to return
`user: null` (line 15), so `getCollectionAccessStrict`
(`apps/web/app/lib/collection-access.server.ts:24-29`) short-circuits
`entitled` to `false` without an `await getEntitlements(...)` call, and
its only other call, `getPublicCollectionIds(db)`, is itself mocked at
the `@lumen/scripture` boundary (`search.loader.test.ts:12`) — so it
never touches `db.execute` either. Given the test's own mock wiring,
`args.context.db.execute.mock.calls.length` is unconditionally `0` for
any loader implementation, correct or not; the `<=1` assertion cannot
fail.

**ACU-6 — Ring-2 premise.**
`packages/scripture/src/index.ts` exports both `queries.ts` (has
`searchScriptures`, line 76) and `search.ts` (has `searchAll`) from the
package root. The ratified search-endpoint plan itself states: "Runtime
consumers of search vectors today: exactly one — `searchScriptures`
(Ring-2 MCP). Web app: none." `searchAll` is that same plan's own net-new
addition, so by the endpoint plan's own accounting `searchAll` has never
had a Ring-2 (or any external) caller. Confirmed no other repo reference
to `searchAll` besides `api.search.tsx` and its tests.

## Not flagged (explicitly out of scope)

- Rate limiting / abuse hardening for the new pagination/infinite-scroll
  surface (search-endpoint plan SEC-9 punts this to the UI feature; the
  search-ui plan's own "Out (deliberate)" list re-defers it — respected
  as off-limits per review instructions, not relitigated here).
- The 3 new error codes (`cursor_scope`, `cursor_invalid`,
  `cursor_mismatch`) are exhaustively covered by F2/F3/F4 — no gap found
  there.
- `nextCursor` placement at group level (vs. top level) is correct: only
  one group is ever cursor-paginated at a time by design, and computing
  it per-group unconditionally (not gated to single-scope requests) is
  what lets the "More in X" pill know to render in the broad multi-group
  view.
- `momentHref` (`/media/:id?t=`) matches the real `media.tsx` contract
  (`useSearchParams().get("t")`, `media.tsx:618`) — verified, not a bug.
- Route registration order (`search` above `:type/:id`) matches the
  existing `media/:id` precedent in `routes.ts` — verified, not a bug.
