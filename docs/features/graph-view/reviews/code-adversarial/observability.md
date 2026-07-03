# CODE-ADVERSARIAL / OBSERVABILITY — graph-view implementation review

Adjudicates `docs/features/graph-view/reviews/code-panel/observability.md` against the actual
code (`scripture.tsx`'s `loadGraph`/`loadConnections`, `GraphOverlay.tsx`, `cache.server.ts`,
`scripts/backfill-neo4j-collections.mjs`) and, for COBS-4, against `react-router@7.9.6`'s
`Await`/`AwaitErrorBoundary` implementation — the same source CUX-1's adversarial pass already
traced for the sibling UX review.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| COBS-1 | material | Plan's OBS-1 Decision explicitly names `elapsedMs`; `loadGraph`'s catch (`scripture.tsx:114-120`) never captures a start time. Confirmed absent — literal conformance gap. |
| COBS-2 | risky | Confirmed: `cachedJson` reports no hit/miss, so `graph_truncated` re-fires every cache-hit replay. Real signal skew, but trivial absolute volume at this traffic. |
| COBS-3 | risky | Same mechanism as COBS-2, confirmed at `scripture.tsx:102-103`. `graph_not_found` re-logs per stale-link cache hit — real but low-stakes at solo-app volume. |
| COBS-4 | noise | False premise: `AwaitErrorBoundary` is a real `componentDidCatch` class boundary, already isolating `GraphBody`/`ForceLayout` render crashes. Fix re-requests OBS-6's rejected client-reporting infra. |
| COBS-5 | material | SEC-10 "incorporated" claims scrubbing shipped; only implicit safety-by-convention exists, no `scrub()`/test. Real conformance gap, though Notes concede no actual leak found. |
| COBS-6 | material | Confirmed: `graph_not_found` logs only `entityId` (`scripture.tsx:102-103`) while sibling events carry `depth`/`collections`. Cheap, correct shape-parity fix. |
| COBS-7 | material | Confirmed: `scripture.graph.loader.test.ts` only exercises `kvNoop()` (cache-miss) paths; no test seeds a KV hit to catch COBS-2/3 double-logging. |

## Stance

**COBS-4 is factually wrong and should be dropped, not implemented as a "local class boundary."**
I read `react-router`'s actual implementation
(`node_modules/.../react-router/dist/development/chunk-AMVS5XVJ.js:9193-9283`) rather than
inferring from the pattern name:

1. `Await` renders `AwaitErrorBoundary` — a genuine class component with
   `static getDerivedStateFromError` and `componentDidCatch` — wrapping `ResolveAwait`, which is
   where `children(data)` (the `data.degraded ? <GraphDegraded/> : <GraphBody .../>` render
   function) is actually invoked. A synchronous render throw inside `GraphBody` or `ForceLayout`
   is a descendant render-phase error of `AwaitErrorBoundary`, so React's standard error-boundary
   contract catches it there — exactly like any other class error boundary catches errors from
   its subtree, not just its direct children. `getDerivedStateFromError` flips `state.error`,
   the boundary re-renders with `status === "error"`, and it shows `errorElement`
   (`<GraphDegraded onClose={onClose} />`) in place of the crashed subtree. It does **not**
   propagate past `AwaitErrorBoundary` to the route-level `ErrorBoundary` in `scripture.tsx:771`.
   The panel-isolation promise in `GraphDegraded`'s own copy ("chapter behind this panel is
   unaffected") already holds today, contradicting COBS-4's central claim.

2. The one real gap COBS-4 stumbles onto and mischaracterizes: `componentDidCatch` calls
   `this.props.onError`, which `Await` always supplies as a `useCallback` — so the
   `else { console.error(...) }` fallback branch in `AwaitErrorBoundary` never runs. That
   `onError` callback only forwards to `dataRouterContext.unstable_onError`, which this app never
   configures (`grep -rn "unstable_onError"` in `apps/web/app` returns nothing). Net effect: a
   render crash in `GraphBody`/`ForceLayout` today is caught, isolated, and rendered as
   `GraphDegraded` **silently** — not even a default `console.error`, contrary to COBS-4's "only
   backstop is... console" framing (there is no console output at all).

3. That silence is real but not fixable the way COBS-4 recommends. `GraphOverlay.tsx`,
   `GraphBody`, and `ForceLayout` are client-rendered (`window.matchMedia`, `d3-force`,
   `d3-drag`, `d3-zoom`, refs/`useEffect` — no `.server` suffix). `logEvent` lives in
   `apps/web/app/lib/log.server.ts`, a server-only module (`console.error` → Workers stdout)
   that React Router strips from the client bundle. A class boundary wrapping `GraphBody` cannot
   call `logEvent` directly; the only way to get a client-side render crash to the server log is
   a network round trip (`fetch`/`sendBeacon`) — which **is** the "new client-error infra" OBS-6
   already rejected as beyond scope, with "error boundary ships, reporting deferred" as the
   explicit resolution. The existing `Await errorElement` already ships that boundary. COBS-4's
   fix doesn't add a boundary that's missing; it re-opens the reporting half of a decision the
   synthesis already closed. Recommend closing COBS-4 as invalid, not scheduling the wrapper —
   if crash *visibility* is wanted later, it should be scoped as a reopening of OBS-6, not folded
   into this pass as a "local class boundary" that reads as free.

**COBS-1 stands as scored.** The plan's Decisions table is unambiguous: OBS-1 resolved
"incorporated" with the field list spelled out — "entityId, depth, collections, error,
elapsedMs — extends the `neo4j_degraded` convention." `loadGraph`'s catch block logs `name`,
`message`, `entityId`, `depth`, `collections` and nothing that times the call; there's no
`Date.now()` anywhere in the function. Unlike COBS-4, there's no ambiguity to resolve by reading
framework internals — the field is named in the plan and absent in the diff. Small fix, but a
literal, checkable promise violation, so it stays material regardless of size.

**COBS-2/COBS-3 downgrade to risky, not noise or material.** The mechanism is real and I
confirmed it directly: `cachedJson` (`cache.server.ts:14-54`) returns identically whether the
value came from `kv.get` or the live `fetcher()` — it gives the caller no hit/miss signal — and
`loadGraph`'s `logEvent("graph_truncated", ...)`/`logEvent("graph_not_found", ...)` calls sit in
the success branch after `cachedJson` resolves, at `scripture.tsx:102-111`, so they re-fire on
every request that resolves to a truncated or not-found result, including replays of a 7-day-TTL
cache hit (`CONNECTIONS_TTL_SECONDS = 7 * 24 * 60 * 60`, confirmed line 37). That is a genuine
signal-accuracy defect against OBS-5's "truncation stats per resolution" framing — a hub verse
or a stale bookmarked `?graph=` id will look like it's truncating/missing on every visit, not
once. But "genuinely misleading" has to be weighed against who's reading the signal and why: this
is a solo, low-traffic personal app with console-JSON logging and no dashboard, alerting, or
aggregation layer built on top of these events — nobody is currently making a capacity or
correctness decision off a duplicate-count of `graph_truncated` lines, and the original doc's
own severity ("Medium") already reflects that this isn't urgent. That combination — real defect,
cheap fix (gate the log to the fetcher lambda, as COBS-7's proposed test would verify), but no
current consumer for whom the duplication is actually misleading anything — is exactly what
"risky" is for: accept the diagnosis, don't treat it as urgent-material at this traffic profile.

Everything else checks out as scored. COBS-5's Notes-section caveat ("no leak found") doesn't
erase the conformance gap — SEC-10 was marked "incorporated," and no `scrub()` helper or test
exists, only incidental safety from bound params and non-credential-bearing error surfaces.
COBS-6 and COBS-7 are both plainly correct on inspection (verified against the exact line
numbers cited) and cheap enough that "material" is the right call independent of their
originally-scored Low severity.
