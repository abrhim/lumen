# Panel-2 — adversarial tags for api-contract

| ID | Tag | Rationale (≤25 words) |
|----|-----|------------------------|
| API-1 | material | Reproduced live: default StartSel=<b>, source <tag> swallowed, & unescaped. Snippet format ossifies by accident; neutral markers are contract-defining, breaking to change later. |
| API-2 | material | Verified resolve-reference.ts:13-20: chapter level embeds verses: any[], verse level open index signature. Plan never defines the reference wire shape; projection is needed. |
| API-3 | material | Verified scripture.tsx:367/book.tsx:34 house pattern; loader forwards getSessionUser headers (api-search.test.ts:48). Visibility-varied GET + Set-Cookie needs no-store. Not the deferred KV-caching item. |
| API-4 | material | Verified plan.md:50/54/82: same field name, disjoint enums (episodes vs moment, art vs artwork). Rename is free now, breaking after ship; result-kind union unexported. |
| API-5 | material | Reproduced live: prod episode payload key is 'episode', plan.md:58 says 'episode_id'. Per-kind payload typing is the contract core; divergence already exists. |
| API-6 | material | Reproduced live: payload returns as JS string, t_start_s '8990.650'. H13 (search-harness.test.ts:242-252) pins only moments; other kinds would ship stringified silently. |
| API-7 | material | Verified api-search.test.ts:76-83 omits limit=abc, scope=, CSV edge cases. Number('abc')=NaN through a clamp forwards NaN to SQL LIMIT — real 500 class. |
| API-8 | material | Verified contradiction: search-harness.test.ts:224 asserts populated groups with empty results; api-search.test.ts:89 asserts groups=[]. Unpinned shape means the implementation accident becomes the contract. |
| API-9 | noise | UI and MCP consumers deliberately out (plan.md:31,34); tests assert only truthiness (api-search.test.ts:71), so no prose ossifies; adding code later is purely additive. |
| API-10 | material | Verified plan.md:58 ref_id=episode_id#seq_start with Q2 windowing open: any retune silently retires moment ids while other kinds' ids are durable; stability class must be stated. |

## Stance

Mostly signal — unusually strong for panel-1: every live probe I re-ran (ts_headline markers, prod payload key 'episode', string-typed payload/t_start_s) reproduced verbatim, and every file:line citation checked out. Nine of ten findings are material contract gaps, several of which are breaking-to-change-later and therefore must land in v1. The one exception is API-9 (error codes): with UI and MCP both on the plan's deliberate Out list and the fix purely additive later, it would not change shipped quality.