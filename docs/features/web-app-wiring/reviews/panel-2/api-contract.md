# Panel-2 Adversarial Review — api-contract (web-app-wiring)

Verified against: `/Users/abram/code/lumen/packages/scripture/src/slug-map.ts`,
`/Users/abram/code/kai-platform/docs/lumen/PRD.md`, plan.md, and
`apps/web/app/routes/__tests__/scripture.loader.test.ts`.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| API-1 | material | Verified in slug-map.ts: 4+ aliases resolve to same bookId. Real duplicate-content risk; redirect fix is proportionate, cheap. |
| API-2 | material | Confirmed divergence (`/scripture` vs PRD's `/study`), plan never flags it as deliberate. Cheap fix (rename or doc note) before consumers exist. |
| API-3 | noise | Already resolved: plan's Q3 explicitly proposes `?verse=N` with rationale ("simplest proof; verse-detail deferred"). Finding asks for what's already done. |
| API-4 | material | Verified: `VERSE_COLUMNS` in queries.ts already selects `reference`; test mocks include it. Omitting it from the typed shape is a free fix, real future breakage. |
| API-5 | material | Cheap, isolated fix (differentiate log/body per branch) with real debuggability payoff; doesn't change the 404 contract. |
| API-6 | noise | Plan's existing "invalid → no panel, no error" contract already reads as covering out-of-range by simplest interpretation; finding itself hedges as maybe-fine. |
| API-7 | noise | No CDN/cache layer configured anywhere (wrangler.json has no cacheEverything/cache rules) — premise of edge-caching a degraded response is unsubstantiated for this architecture. |
| API-8 | material | Distinct risk from API-1 (KV consistency/poisoning, not just SEO); genuine even though fix rides on API-1 landing first. |
| API-9 | noise | Speculative — no evidence book-id source diverges from BOOK_SLUGS; home loader isn't even wired to real data yet. Fix is "state explicitly," not a caught bug. |
| API-10 | noise | Same unsubstantiated CDN-cache premise as API-7; no caching layer exists in this stack to exhibit the failure. |

## Overall stance

Panel-1 correctly caught the two structural issues that matter: silent alias duplication (API-1) with a downstream KV-consistency corollary (API-8), and an unflagged PRD path/mechanism divergence (API-2) — verse-selection-as-query-param (API-3) turns out to already be a documented, deliberate call in the plan's own Q3 and shouldn't have been raised as open. The 404-differentiation (API-5) and missing `reference` field (API-4) are both legitimate, cheap fixes worth doing now rather than later. The two Cache-Control findings (API-7, API-10) and the home-link-format note (API-9) are speculative — this Worker has no CDN/edge caching configured, so the caching-a-stale-response scenario they warn about doesn't exist in the current architecture; flag as defensive nice-to-haves, not blocking bugs. Net: 5 material, 5 noise, 0 risky, 0 out-of-scope.
