# Code-panel review — observability (search-ui, implemented)

Reviewer lens: `search_executed` from both surfaces (double-count), OU-1 after-depth,
zeroResult vs continuations, `search_failed` paths, cursor-400s unlogged-by-design,
client-side fetcher error swallowing. Diff: `f352bae..46d888d` (= deployed fd093ed4).

## Findings

| ID | Sev | Where | Problem | Fix |
|----|-----|-------|---------|-----|
| OC-1 | high | `apps/web/app/routes/search.tsx:591-601` | pageFetcher effect dereferences `d.groups.find(...)` unguarded. API errors are RETURNED (not thrown) Responses, so in RR 7.9.6 single-fetch they arrive as `fetcher.data = {error, code}` (verified in RR source + live `.data` probe). A pagination 500 (pool-exhaustion class is a documented incident here) or a `cursor_invalid` after a future CURSOR_VERSION bump throws `TypeError: undefined.find` inside the effect → the route ErrorBoundary replaces the whole page, discarding every loaded result. | Guard: `if (!Array.isArray(d.groups))` → set an inline "couldn't load more" state and stop; never dereference error bodies. |
| OC-2 | med | `apps/web/app/lib/search-obs.server.ts:35-58` (+ `search.tsx:145-149`) | `search_executed` has NO surface discriminator: page-loader events and API-fetcher events are field-identical. Worse, the same logical all-groups search logs `scope: null` from the page but the full 7-key array from the fetcher (`buildPageFetchUrl` always sends `scope=`). Enter-after-debounce double-counts one user search; debounced partial-word queries pollute the zeroResult denominator OU-1 exists to protect. (Dual logging itself is ratified — Δ OU-6; the missing discriminator is not.) | Add `surface: "page" \| "api"` (or `live: boolean`) to `SearchLogContext` and the event. |
| OC-3 | med | `apps/web/app/routes/search.tsx:586-589, 619-637` | Live-fetcher errors silently swallowed: the `d.query === liveQRef.current` guard drops error bodies (`query` undefined), so on a 500 mid-typing the page keeps showing the PREVIOUS query's results/status while the input holds the new query; from the empty state it sticks in a blank "pending" forever. No client signal, and the plan's ratified failure signal (ErrorBoundary) can never fire because the API returns rather than throws. Server `search_failed` does log — operator sees it, user doesn't. | Detect error-shaped fetcher data; show the quiet inline failure state (and revert status text). |
| OC-4 | med (cross-lens: security) | `apps/web/app/routes/api.search.tsx` (no `headers` export; cf. `search.tsx:270-272`) | The `.data` variant of /api/search — the ONLY variant the page's fetchers hit — carries NO `Cache-Control`. Single-fetch data responses take headers from the route's `headers()` export, not the loader's returned Response; api.search.tsx has none. Live probe: raw `/api/search` → `cache-control: private, no-store`; `/api/search.data` → absent. Session-varying (admin-entitled) bodies escape SECURITY-3 on the shipped UI path. | `export function headers() { return { "Cache-Control": "private, no-store" }; }` in api.search.tsx (search.tsx already does this). |
| OC-5 | low | `apps/web/app/lib/search-obs.server.ts:63-74` | `search_failed` lacks continuation context: no `hasCursor`/limit. A cursor-leg 500 is indistinguishable from a page-1 failure; OBS-3's "operator can reproduce the 500" claim fails for continuation-specific failures (repro of q/scope alone succeeds). | Log `hasCursor: after !== undefined` (boolean only — raw cursor stays unechoed per F3). |
| OC-6 | low | `apps/web/app/routes/__tests__/api-search-cursor.test.ts:22`; no pin anywhere | OU-1 wiring and decision-10 doctrine are unpinned: no test asserts `hasCursor: true` on continuations, `zeroResult: false` when `after` is present, or zero `logEvent` calls on cursor-400 paths (the cursor test mocks logEvent and never inspects it). A regression could silently break the zero-result denominator or start logging raw cursors. | Pin all three in api-search-cursor.test.ts (logEvent not-called on 400s; hasCursor/zeroResult on a mocked continuation). |
| OC-7 | low | `apps/web/app/routes/search.tsx:1018-1025` | Residual B-U1 MODE instance: pointer-clicking the "More" button leaves it focused (Chrome), so Space-to-scroll fires another page load instead of scrolling — same pointer-focus-hijacks-Space mode Abram found on the orb, lower stakes. | Apply the B-U1 treatment (blur after pointer activation) or move focus to the first appended row. |

Verified clean (no finding): page loader logs `search_executed` exactly once (search.tsx:248, pinned at search.loader.test.ts:77-81); loader never accepts `after` so `hasCursor` is honestly false there; OU-1 `hasCursor` + continuation-excluded `zeroResult` correctly implemented (search-obs.server.ts:41-49); cursor 400s in api.search.tsx:74-95 return without any logEvent and zero stray console/log calls exist in packages/scripture/src/search.ts (grep clean); validation 400s on the page loader unlogged per decision 10; `getSessionUser` never throws, so no mislogged redirect-as-search_failed. B-U1 fix holds (SearchModal.tsx:31, 112-118, 133-139 — pointer-aware `onCloseAutoFocus` on both Sheet and Dialog branches); B-U2 fix holds (`isShortCircuitReference` search.tsx:178-180 applied consistently in loader :254 and client view :631).

## Evidence

**RR 7.9.6 fetcher semantics (source-verified, `apps/web/node_modules/react-router/dist/development/chunk-4WY6JWTD.mjs`):**
- `fetchAndDecodeViaTurboStream` only throws for `res.status >= 400 && !res.headers.has("X-Remix-Response")`; single-fetch server (`chunk-G3INQAYP.mjs:903`) always sets `X-Remix-Response: yes`, and returned (not thrown) loader Responses encode as `{data}` results.
- `unwrapSingleFetchResult` (`chunk-4WY6JWTD.mjs:7983`): `"error" in routeResult → throw`, `"data" in routeResult → return` — returned 400/500 JSON bodies land in `fetcher.data`.

**Live prod probe (GET, worker fd093ed4):**
```
$ curl -sD- "https://lumen.abramhimmer.workers.dev/api/search.data?q=covenant&scope=episodes&limit=25&after=garbagecursor&_routes=routes%2Fapi.search"
HTTP/2 400
content-type: text/x-script
x-remix-response: yes            ← client treats as DATA, not error
(no cache-control header)
body: [{"_1":2},"routes/api.search",{"_3":4},"data",{"_5":6,"_7":8},"error","invalid cursor","code","cursor_invalid"]
        → fetcher.data = {error:"invalid cursor", code:"cursor_invalid"}; d.groups === undefined → OC-1 crash path
```
```
$ curl -sD- ".../api/search.data?q=covenant&scope=episodes&limit=8&_routes=routes%2Fapi.search" | grep -i cache
(nothing)                        ← OC-4
$ curl -sD- ".../api/search?q=covenant&scope=episodes&limit=8" | grep -i cache
cache-control: private, no-store
```

**Pin sweep:** `grep -rn "hasCursor|zeroResult|search_executed" apps/web/app/routes/__tests__/` → only api-search.test.ts:188-200 (`zeroResult: true`, no-after path) and search.loader.test.ts:77-81 (single-log). No `hasCursor` pin, no continuation-zeroResult pin, no not-logged-on-400 pin → OC-6.

**Stray-log sweep:** `grep -n "console\.|logEvent" packages/scripture/src/search.ts` → empty. api.search.tsx / search.tsx import only the shared helpers; cursor 400 branches (api.search.tsx:76-94) return `badRequest` with no logging.
