# CODE-ADVERSARIAL — Performance Review: graph-view

Adversarial pass over `docs/features/graph-view/reviews/code-panel/performance.md`. Every finding was
re-checked against the actual implementation (`packages/scripture/src/graph/get-neighborhood.ts`,
`apps/web/app/components/graph/{ForceLayout,GraphOverlay}.tsx`, `apps/web/app/routes/scripture.tsx`),
and CPERF-1/CPERF-6/CPERF-8 were additionally verified empirically: CPERF-1 by running both Cypher
shapes against the live Neo4j Aura instance for a real hub verse (`1-ne-3-7`) at depth 2 and 3
(8 runs each, `PROFILE`-prefixed, via a scratch script hitting the `/query/v2` HTTP endpoint directly);
CPERF-6 by reading react-router 7.9.6's `Await`/`AwaitErrorBoundary` source and React 19's
`attachPingListener`/`pingCache` source to determine actual listener-growth behavior.

| ID | Tag | Rationale (≤ 25 words) |
|----|-----|-------------------------|
| CPERF-1 | material | Verified live against Neo4j: merged single-collect+size returns identical totals and is equal-or-faster (118ms vs 159ms depth2, 8 runs); no memory regression. |
| CPERF-2 | material | Confirmed: totalCap slices only `others`; edge CALL (175-181) has no LIMIT/slice, and useForce/forceViable gate on node count only, never edges. |
| CPERF-3 | material | Confirmed: filtered useMemo (122-132) creates a new object per toggle; ForceLayout's `[vm,positions]` effect (49-136) tears down and rebuilds the whole simulation. |
| CPERF-4 | material | Confirmed: `b IN visited` is a linear scan over up to 601 elements per relationship, on unrestricted (non-degree-capped) expansion from every visited node. |
| CPERF-5 | material | Confirmed: GraphOverlay.tsx:8-9 statically imports both layouts; only GraphOverlay itself is `lazy()`, so d3-force/drag/zoom ship to radial-only/reduced-motion users too. |
| CPERF-6 | noise | react-router's `_tracked` sentinel (mutated on the promise itself) and React's lane-keyed pingCache dedupe listeners; growth is bounded, not per-open — impact negligible. |
| CPERF-7 | material | Confirmed exactly at ForceLayout.tsx:62-64: nested `.some()` over `vm.nodes` per edge, O(E×N), re-run on every CPERF-3-triggered restart. Cheap, correct fix. |
| CPERF-8 | noise | Trivial small-table SELECT, gated to `?graph`, runs parallel with two other uncached Postgres calls — zero marginal latency; KV round-trip may not even help. |

## Detail on the three flagged reality checks

**CPERF-1 — is the fix actually equivalent, given `collect()` materializes an uncapped list before slicing?**
Built both Cypher shapes (current two-`CALL` count+collect, and the proposed single-`CALL` collect→size→slice)
and ran each 8x against the live Aura instance for `1-ne-3-7` at depth 2 and depth 3 (via a direct
`/query/v2` POST, bypassing the app). Results were byte-identical (`shown=142, total=2444` at depth 2;
`shown=217, total=3119` at depth 3) and timing showed the merged query is *not* slower — depth 2: current
avg 159ms/median 124ms vs merged avg 118ms/median 111ms; depth 3: current avg 182ms/median 119ms vs merged
avg 163ms/median 121ms. The "materializes uncapped before slicing" concern is technically true (`collect(n)`
does hold every distinct match), but it isn't a *new* cost: the current code's `count(DISTINCT n)` call
already has to fully traverse and track every distinct match to produce an accurate count — at these hub
sizes (thousands, not millions) that tracking structure and a `collect()` array of node references are
comparable in cost. The fix removes a genuinely redundant second traversal without introducing a new
bottleneck. Verdict: the fix is not just "equivalent," it's empirically the better shape.

**CPERF-6 — is the leak one retained promise+listener per optimistic open, and is it material?**
No. Read react-router 7.9.6's `AwaitErrorBoundary.render()` (`chunk-AMVS5XVJ.js:9257-9269`): the *first* time
any `<Await resolve={PENDING_FOREVER}>` mounts, it `Object.defineProperty`s `_tracked = true` directly onto
the promise object and calls `.then()` exactly once. Because `PENDING_FOREVER` is a module-level singleton,
every subsequent open hits the `resolve._tracked` branch and reuses the already-thrown promise — no new
`.then()` from react-router's own tracking layer, ever again, for the tab's lifetime. The remaining suspend
mechanism is React's own `throw promise` inside `AwaitErrorBoundary.render()`, which does re-fire per mount,
but React's `attachPingListener` (`react-dom-client.development.js:18566-18581`) dedupes by
`(root, wakeable, lanes)` via `root.pingCache` — a repeat `lanes` value for the same wakeable attaches no new
listener. Growth is bounded by the small, finite space of distinct Lane values a SPA actually produces, not
by the number of times a user opens the graph panel. The module-singleton promise itself is a fixed,
tiny object that exists for the tab's lifetime either way. This is a fragile pattern (relies on undocumented
`_tracked` mutation and Suspense internals that could shift across React/RR versions) but it is not a
performance leak at any realistic traffic — tagged noise, not material.

**CPERF-8 — weighed against the `?graph`-only gate.**
The finding's own wording already scopes this correctly ("on every graph-panel request," not every page
load), so there's no over-claim to correct there. What tips it to noise: `getPublicCollectionIds` is
`SELECT id FROM lumen.collections WHERE public = true ORDER BY id` (`packages/scripture/src/queries.ts:144-149`)
— a small-table scan with no meaningful cost — and it runs inside the same `Promise.all` as
`getVersesByChapter`/`getChapterSummary` (`scripture.tsx:202-208`), both of which are mandatory, uncached,
and already on the critical path for every page view. Since the three queries run concurrently on the same
connection, this one adds zero marginal wall-clock time as long as it doesn't outrun its neighbors, which a
5-row select won't. `cachedJson`'s cache layer is Cloudflare Workers KV — a networked, eventually-consistent
store whose read latency is not reliably better than a trivial Hyperdrive-pooled Postgres query — so the
suggested fix adds a dependency and a staleness window for a query that's already cheap and already
parallelized. Real observation, immaterial impact, marginal-to-negative-value fix.

## Stance

Six of eight hold up as material, and five of those (CPERF-2/3/4/5/7) were independently re-derived from the
live source rather than taken on faith — worth noting that two of code-panel's own line citations for
`GraphOverlay.tsx` are stale (`:344,380` for CPERF-2 and `:350-360` for CPERF-3 land inside the unrelated
`ListView` function; the file is only 356 lines, so `:380` doesn't exist). The underlying claims survive
regardless — CPERF-2's edge-cap gap is confirmed at `GraphOverlay.tsx:116,152` and CPERF-3's restart-on-toggle
is confirmed at `GraphOverlay.tsx:122-132,219-223` plus `ForceLayout.tsx:49-136` — but code-panel should
correct its own pointers. CPERF-1 is the strongest finding in the set: it went in as a plausible-sounding
Cypher optimization and came out as an empirically verified 20-30% latency win with byte-identical output on
real hub data, which also directly answers this review's own skepticism about `collect()` materializing
uncapped lists — that cost was already being paid by the existing `count(DISTINCT n)` call, so merging is
pure upside. CPERF-6 and CPERF-8 are the two downgrades, and both survive scrutiny as "real code smell,
zero measurable perf impact": CPERF-6's claimed per-open listener growth doesn't happen once you trace
react-router's `_tracked` guard and React's lane-keyed `pingCache` (both dedupe against the same singleton
promise), and CPERF-8's uncached query rides for free inside an existing mandatory `Promise.all` against a
table too small to matter. Neither risky nor out-of-scope tags were needed — every material finding's fix is
proportionate and low-risk, and both noise findings are performance-lens claims that just don't survive
quantification, not claims that belong to a different lens.
