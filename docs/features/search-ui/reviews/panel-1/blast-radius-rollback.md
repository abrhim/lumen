# Panel-1 / blast-radius-rollback — search-ui plan review

Reviewer lens: what breaks if this breaks — routes.ts merge surface, root.tsx global
modal mount (hydration + error-boundary blast radius), `searchAll` signature change
vs Ring-2 MCP compilation, `/api/search` dark-ship/rollback independence, kill-switch
(`public=false`) interaction with mid-pagination sessions.

## Findings

| ID | Severity | Where | Problem | Fix |
|---|---|---|---|---|
| BRRU-1 | high | `packages/scripture/src/__tests__/search-cursor-harness.test.ts:47-54`; live probe q='faith' | The F1 "no gap" assertion re-queries page 1's exact params (`limitPerGroup:25`, no `after`) as `big` and compares it to `ids1` — that's a tautology (same query, same deterministic result), not a check against `ids1+ids2`. `searchAll`'s own `clampLimit` caps `limitPerGroup` at 25, so a true single-page oracle bigger than the union can't even be fetched through the public API. Live probe on the exact harness query (`q='faith'`, verse leg) shows 30/39 adjacent score ties in the top 40 rows, with 5 tied rows straddling positions 23-27 — precisely the page-25 boundary. A gap/duplicate bug at a tie boundary (e.g. `>` vs `>=`, or lossy score round-trip through the `v1\|qhash\|tier\|score\|id` cursor encoding) is exactly what F1 claims to catch and currently cannot. | Rewrite the no-gap check against an independent oracle (raw SQL at a higher limit, or rank/count query outside `searchAll`'s cap) comparing `ids1.concat(ids2)` to it; pin the cursor's score encoding as lossless (no `toFixed`/precision truncation) with an explicit round-trip test using a real tied-score pair. |
| BRRU-2 | high | `apps/web/app/routes/__tests__/search.loader.test.ts:91-93` (pinned: bad `scope` → loader **throws** a 400 Response) vs `apps/web/app/root.tsx:74-119` | Verified against `react-router@7.9.6` source (`findNearestBoundary` / `_renderMatches` in `chunk-4WY6JWTD.mjs`): a thrown loader error bubbles to the nearest ancestor route that exports `ErrorBoundary`. `routes/search.tsx` isn't in the plan's files-touched list with its own `ErrorBoundary`, so the error bubbles to **root**, which slices `renderedMatches` down to just the root match and renders root's `ErrorBoundary` **instead of** root's `App` component — the same component that renders `<AppMenu/>` and `<Outlet/>` (root.tsx:74-83). A single mistyped or stale `?scope=` value (very reachable: hand-edited URL, an old bookmark from before a `GROUP_KEYS` rename, a bot request) wipes the entire persistent chrome for that page load, contradicting the product directive to stay reader-first and not bounce light users into a dead end. | Add `export function ErrorBoundary` to `routes/search.tsx` that renders inline (e.g. drop the bad scope and redirect, or show a friendly inline notice) inside the route's own Outlet slot so `AppMenu`/orb survive. Does not conflict with the pinned unit test — that test only asserts on the `loader` function's throw. |
| BRRU-3 | high | `apps/web/app/root.tsx:39` (files-touched: "root.tsx (edit — orb next to AppMenu, modal mount)"); `apps/web/app/components/AppMenu.tsx` (whole file — no error isolation today) | The plan mounts the new orb + `SearchModal` as a sibling of `<AppMenu/>` inside root's `App` component — the same global, no-boundary slot `AppMenu` already occupies. Confirmed via the same RR7 source trace as BRRU-2: `App` has no route beneath it with its own `ErrorBoundary`, so **any** render-time exception in the new modal/orb (hotkey-listener setup, an SSR/CSR hydration mismatch, `parseMarks` choking on unexpected data during a future edit) takes down every route in the app, not just `/search`. Grepped the repo for an error-boundary pattern (`react-error-boundary`, `componentDidCatch`) — none exists anywhere to reuse. The plan doubles today's one global single-point-of-failure without naming a mitigation. | Wrap the new orb+modal group in a small local error boundary (class component or a vendored `react-error-boundary`) that fails silently to "just the orb button, no modal" rather than propagating. Add an e2e/unit check that an induced throw inside the modal leaves `AppMenu` and `Outlet` content intact. |
| BRRU-4 | med | `apps/web/wrangler.json` (no feature-flag vars/bindings); `apps/web/app/lib/collection-access.server.ts:8-11` (the only kill switch in the codebase, `collections.public=false`, is DB-level content visibility, not a code toggle) | `/api/search`'s cursor contract addition, the new `/search` route, and the global root.tsx modal mount all ship in one Cloudflare Worker deploy (`wrangler.json` has no env-var/KV feature flag, confirmed by grep). There is no way to disable just the UI (or just the cursor endpoint) without a full worker rollback to a prior commit — which also reverts the otherwise-safe additive `/api/search` change. If BRRU-2/BRRU-3 land in prod, remediation is "redeploy the previous build," not a flag flip, unlike the established Phase B precedent. | Either accept this explicitly in the plan (state that rollback = worker redeploy, and verify that path is fast/rehearsed) or gate the root.tsx orb mount behind a cheap KV/env check so a bad chrome-crashing bug can be pulled independently of the already-safe API change. |
| BRRU-5 | med | `docs/features/search-ui/plan.md:4,44` ("cross-system blast radius (`searchAll` signature addition ... Ring-2-consumed package)" / "Additive for Ring-2") vs `docs/features/search-endpoint/reviews/code-panel/blast-radius-rollback.md:16-17` | Grepped this repo: `searchAll` has exactly two consumers, both in `apps/web` (`api.search.tsx`, and now `search.tsx`); there is no MCP/Ring-2 code in this repository, and `@lumen/scripture`'s `package.json` is `"private": true` (unpublished). The prior feature's own code-panel review already established the actual mechanism: Ring-2 vendors a **pinned, separately-redeployed copy** of `@lumen/scripture` — it is not workspace-linked, so nothing in this repo's CI can verify "additive" against what Ring-2 actually compiles against, and changes only reach it at Ring-2's own out-of-scope redeploy. The search-ui plan restates the risk axis but doesn't carry forward this already-verified isolation fact from its own "Prior-learnings surfaced" section, so a reader can't tell whether "Additive for Ring-2" is a verified claim or an assumption. | Add one line to Prior-learnings citing the vendored-copy fact (with its source), so the claim reads as "additive and isolated — Ring-2 won't see this until its own redeploy" rather than an open cross-system risk requiring coordination. |
| BRRU-6 | low | `apps/web/app/routes/api.search.tsx:92-107` (visibility recomputed fresh every request) vs plan.md F1-F14 (no failure mode covers cross-request visibility drift) | The keyset cursor is bound to `(q, scope)` only, not to visibility state. Because `visibleCollections` is recomputed fresh on every request (correct per decision 6), a `nextCursor` minted while a collection was public remains syntactically valid after an admin flips `collections.public=false` (the documented kill switch) mid-pagination-session; the next page then silently returns fewer/zero further results with no error code, indistinguishable from ordinary exhaustion. Mechanically safe (no crash, no dup/gap — keyset degrades gracefully), but it's the one live kill switch in the codebase and the harness has no F-number exercising it. | Note the behavior explicitly as accepted (kill-switch flips are rare, deliberate acts) or add one test pinning "cursor stays valid, page shrinks silently" so a future reader doesn't mistake it for a bug. |

## Evidence

**BRRU-1 — live tie probe** (read-only, `lumen_read`, against prod via Hyperdrive-equivalent DSN in `apps/web/.env`):
```sql
SELECT v.id, ts_rank('{0.1,0.2,0.4,1.0}'::float4[], v.search_vector,
       websearch_to_tsquery('english','faith'), 1)::float8 AS score
FROM lumen.verses v
WHERE v.search_vector @@ websearch_to_tsquery('english','faith')
ORDER BY score DESC, v.id LIMIT 40;
```
Result: `current_user = lumen_read` (confirmed read-only role); 40 rows, all unique ids;
**30 of 39 adjacent pairs tied on score**; rows 23-27 (straddling the 25-row page
boundary the harness and adaptive-limit both use) are five-way tied at
`0.0235178302973509`. Total `faith` verse hits = 810 (matches the plan's documented
floor). This directly stress-tests the exact scenario `search-cursor-harness.test.ts`
claims to cover.

**BRRU-1 — harness self-reference**, `packages/scripture/src/__tests__/search-cursor-harness.test.ts:47-54`:
```js
const big = await searchAll(db, {
    q: 'faith', visibleCollections: ['phase-b'], scope: ['scripture'],
    limitPerGroup: 25, // server cap — compare via two sequential fetches against cursor pages
} as any);
expect(big.groups[0].results.map((r: any) => r.id)).toEqual(ids1);
```
`big` uses identical params to `p1` (no `after`) — it is `p1` re-run, so this assertion
is true by construction regardless of page-2 correctness. It never compares against
`ids1.concat(ids2)`.

**BRRU-2/BRRU-3 — RR7 error-bubbling trace**, confirmed against the installed
`react-router@7.9.6` (`apps/web/package.json:35`) source at
`node_modules/.pnpm/react-router@7.9.6_.../react-router/dist/development/chunk-4WY6JWTD.mjs`:
- `processRouteLoaderData` (≈L4884-4888): a loader error is assigned to
  `errors[boundaryMatch.route.id]` where `boundaryMatch = findNearestBoundary(matches, id)`
  — the nearest ancestor route that exports an `ErrorBoundary`.
- `_renderMatches` (≈L5680-5692): `renderedMatches` is sliced down to (and including)
  the match holding that error; every route below/at that point renders its
  `ErrorBoundary` instead of its normal `Component`.
- `routes/search.tsx` is not listed with its own `ErrorBoundary` in the plan's files
  touched; `root.tsx`'s own `ErrorBoundary` (root.tsx:85-119) does not render
  `<AppMenu/>`. Root's normal `App` component (root.tsx:74-83, containing
  `<AppMenu/>` + `<Outlet/>`) is what gets swapped out.
- `AppMenu.tsx` (full file read) has no error-boundary/try-catch around its render
  path today, and a repo-wide grep for `react-error-boundary`/`componentDidCatch`
  returns nothing — there is no existing isolation pattern to inherit.

**BRRU-4 — no feature-flag mechanism**: `apps/web/wrangler.json` has `vars` for
Neo4j/Supabase config only, no flag; grep for `FEATURE_`/`featureFlag`/`ENABLE_`
across `apps/web/app` returns nothing. The only kill switch in the codebase is
`collections.public` (`apps/web/app/lib/collection-access.server.ts:8-11`), which is
collection-visibility data, not a code-path toggle.

**BRRU-5 — Ring-2 vendoring**: `docs/features/search-endpoint/reviews/code-panel/blast-radius-rollback.md:16-17`
("@lumen/scripture is 'private': true, unpublished; only consumer in any repo on this
machine is apps/web ... the MCP pins its own vendored copy ... reach it only at its
next redeploy"). Cross-checked: `packages/scripture/package.json` confirms
`"private": true`; repo-wide grep for `searchScriptures`/`searchAll` finds no MCP code
in this repository; `searchAll`'s only two importers are
`packages/scripture/src/search.ts` (definition) and `apps/web/app/routes/api.search.tsx`.

**BRRU-6 — visibility recompute**: `apps/web/app/routes/api.search.tsx:85-107` calls
`getSessionUser` and `getCollectionAccessStrict` fresh inside the `try` on every
request, then passes the resulting `visibleCollections` straight to `searchAll`; the
cursor (per plan.md:26) encodes only `q`/`scope`/`tier`/`score`/`id`, not a visibility
snapshot.
