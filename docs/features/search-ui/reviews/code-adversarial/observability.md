# Code-adversarial review — observability (search-ui)

Adversary for the observability lens. Every row tagged; refutations verified at
code/live/byte level per house rule. Two live GET probes (worker current) +
full code + test reads run before tagging.

## Tags

| ID | Tag | Rationale |
|----|-----|-----------|
| OC-1 | material | Live probe: `/api/search.data?after=garbage` → 400 with turbo-stream key `"data"` → `fetcher.data={error,code}`; `d.groups.find` (search.tsx:607) throws → route ErrorBoundary eats the whole loaded page. Real crash on any pagination 500. |
| OC-2 | material | No surface field on `search_executed`; both call sites (search.tsx:250, api.search.tsx:130) pass identical ctx. Live-typing fetch + Enter double-count one query; `buildPageFetchUrl` always sends `scope=`, so page logs `null` vs api's 7-array. |
| OC-3 | material | liveFetcher guard `d.query===liveQRef.current` (search.tsx:600) drops error bodies (no `query` key — probe-confirmed); a 500 mid-typing leaves stale results or blank "pending" with no signal; ErrorBoundary can't fire (API returns, not throws). |
| OC-4 | material | Live probe confirmed: `/api/search.data` 200 carries NO `cache-control` while raw `/api/search` has `private, no-store`. Fetchers hit only `.data`; api.search.tsx lacks the `headers()` export search.tsx:272 has. Session/admin bodies escape SECURITY-3. |
| OC-5 | material | logSearchFailed (search-obs.server.ts:63) is `Pick<...q\|scope\|visibility>` — no `after`/hasCursor; cursor is never logged elsewhere (F3). A continuation-only 500 is indistinguishable from page-1; OBS-3 repro promise breaks. Real, low. |
| OC-6 | material | grep-verified: no `hasCursor` pin anywhere, no continuation `zeroResult:false` pin, and api-search-cursor.test.ts:22 mocks logEvent but never asserts not-called on 400s. OU-1 denominator logic + F3 raw-cursor-unlogged are regression-unprotected under a harness-required plan. |
| OC-7 | noise | Refuted: More button (search.tsx:1096) is `disabled` during load → browser blurs the focused disabled element → activeElement=body → Space scrolls, not re-fires. More-pill (1072) and ref-link (1018) unmount on navigation. The B-U1 mode needs a persistently-focused button (the orb had no disable/unmount cycle); none here does. |

## Stance

The specialist's observability findings are strong and largely evidence-backed;
I sustain 6 of 7 as material. Two claims I re-probed live and confirmed
byte-for-byte: OC-1 (error responses arrive as `fetcher.data`, envelope key
`"data"`, so `d.groups.find` throws and the route ErrorBoundary discards the
loaded page) and OC-4 (`/api/search.data` 200 ships with no `cache-control`
while the raw route ships `private, no-store`). OC-2 and OC-3 are verified in
source — dual-logging has no surface discriminator (double-count + zeroResult
pollution) and live-fetcher failures are silently swallowed into stale/blank UI
with the ratified ErrorBoundary signal structurally unable to fire. OC-5 and
OC-6 are genuine low-value gaps (failure-log continuation context; unpinned
OU-1/decision-10 invariants under a harness-first plan) with clean, F3-safe
fixes; neither is style, restatement, nor already-fixed, so material stands.

The single miss is OC-7. It asserts a residual B-U1 (pointer-focus-hijacks-Space)
instance on the "More" affordance, but every candidate self-heals: the More
button disables during its load (blurring the focused element to `body`), and
the More-in-X pill and reference link both navigate/unmount the focused node.
B-U1 was real because the orb, as a modal trigger, had Radix return focus to it
on close with no disable or unmount — a persistently focused, enabled button.
No search-page control reproduces that, so the mode cannot manifest; noise, not
a residual.

No finding is downgraded for being cross-lens: OC-4's caching gap is on this
feature's own shipped fetcher path (the plan mandates private/no-store, F17),
not a deferred item or a different feature.
