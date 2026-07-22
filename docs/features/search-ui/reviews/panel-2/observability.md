# Panel-2 / Adversarial review — observability (search-ui plan)

Reviewing Panel-1 observability's six findings (OU-1..OU-6) against the plan,
the shipped `/api/search` (`api.search.tsx`), `search.ts`, the red-first
harness, and the ratified search-endpoint decisions. Every row tagged.

Note on the M3 re-window stale-doc trap: search-endpoint A9 says the re-window
is "owed," but it was APPLIED to prod ~18:30 on 2026-07-21. No finding here
turns on the one-time event, so this does not move any tag.

| ID | Tag | Rationale |
|----|-----|-----------|
| OU-1 | material | Verified real metric corruption. Pagination continuations re-enter `api.search.tsx:123` `search_executed`; with single-scope `after` the response has one group (`search.ts:525` `scope.map`), so an exhausted page computes `zeroResult:true` (`api.search.tsx:129-130`) for a query with many hits — poisoning the exact OBS-1 feed decision 10 exists for. Aggregates also inflate once/scroll. Fix (add `after`/`source`, split event) is additive and safe. |
| OU-2 | material | Plan genuinely does not pin the on-page input model (lines 21/24 are SSR/URL-driven but silent on submit-only vs live-filter), while the "approved interactive proposal" mockup live-filters per settled keystroke. Debounced `setSearchParams`-on-input is idiomatic React Router and would re-run the loader + log `search_executed` per prefix ("f","fa"), a real OBS-1 log-storm. Pinning it + a no-per-keystroke-log assertion changes what ships; fix is safe. |
| OU-3 | out-of-scope | Valid gap but the asked-for fix (a client→server failure beacon) is cross-cutting telemetry infrastructure the app wholly lacks (`log.server.ts` is server-only `console.error`; grep-confirmed no client analog) — that belongs to a platform-observability feature, not reader-first search-ui. The finding's own fallback ("accept the gap in writing") signals it is not a ship blocker. |
| OU-4 | out-of-scope | Premised on an inferred goal the plan never states: line 17 frames scope-exclude as "the only cull affordance we ship now" (a UX scoping statement) and explicitly says the researcher loop is "the future personal-notes journey, NOT this feature." A `facetAction` provenance field serves that future feature's demand-measurement; "search analytics UI" is on the Out list (line 28). Belongs to a different feature. |
| OU-5 | noise | Server 400s are deliberately unlogged by ratified design — search-endpoint decision 10 mandates only `search_executed`/`search_group_degraded`/`search_failed`, and `api.search.tsx:34-36` `badRequest` logs nothing; the 3 cursor codes consistently inherit that. Its two justifications are guarded/deferred: the version-bump spike is caught pre-ship by the plan's own same-commit decode test (line 14), and abuse-probing is explicitly deferred (SEC-9). F1-F5 cover cursor correctness pre-ship. A minor nicety at <1k req/day; would not change shipped quality. |
| OU-6 | material | Verified harness gap + real risk. Q4 makes `search.tsx` (new, SSR = majority path) call `searchAll` directly, so it needs its own copy of the OBS-1/2/3 block. F6 (plan line 52) and `search.loader.test.ts:59-63` pin only `search_executed` count — nothing pins `search_group_degraded`/`search_failed` parity, so an omitted copy silently halves degraded-group visibility (violating OBS-2) on most real searches while the harness stays green. Shared-helper + parity assertions is sound, low-risk, DRY. |

## Stance

Mostly signal. Three of six findings are material and catch real,
feature-introduced observability defects: OU-1 (pagination corrupts the
`zeroResult` relevance-tuning metric — verified against `api.search.tsx:129`
+ `search.ts:525`), OU-6 (the new SSR page loader can silently diverge from
the endpoint's degraded/failed logging, and the harness only pins
`search_executed`), and OU-2 (unpinned input model invites a per-keystroke
log-storm that the approved mockup actively models). OU-3 and OU-4 are valid
observations but reach into client-telemetry infrastructure and
future-feature analytics that this reader-first feature deliberately
excludes. OU-5 is a reasonable but minor server-side nicety that deviates
from the ratified no-log-on-400 pattern and is guarded pre-ship. No finding
is risky (no proposed fix introduces a worse bug).
