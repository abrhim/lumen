# PANEL-2 ADVERSARIAL — api-contract (search-ui plan)

Reviewed panel-1 `api-contract.md` against `plan.md`, the shipped `search.ts` /
`api.search.tsx`, the ratified `search-endpoint` plan (A1–A9), and all four
red-first harness files. Verified `collection-access.server.ts` for ACU-4.

Stance: **mostly signal at the top, noise in the tail.** The three high-severity
findings (ACU-1/2/3) plus the med ACU-4 are genuine, verified defects that would
materially change the shipped harness or design. The four low/med tail findings
(ACU-5/6/7/8) are over-stated or cosmetic — one has a mis-described failure
mechanism, one is a doc nit that leaves the (correctly-large) tier unchanged, one
is contradicted by the loader harness, and one flags an implementation detail the
contract already pins.

| ID | Tag | Rationale |
|----|-----|-----------|
| ACU-1 | material | Verified: `ORDER BY tier, sub, score DESC, id` in `scriptureLeg` (search.ts:271) and `episodesLeg` (:369); verse sub=0/jst sub=1, episode sub=0/moment sub=1. Cursor `encodeSearchCursor({q,scope,tier,score,id})` (harness:71) omits `sub`, so a keyset predicate over (tier,score,id) skips every sub=1 row with score ≥ the boundary → real gap. F1 harness can't catch it: `big` fetch reuses limit 25 (clampLimit caps at 25, search.ts:146-149) and only re-asserts page-1 ids; for q=faith both pages stay inside the 810 sub=0 verses. |
| ACU-2 | material | Verified search.ts:522 `opts.scope?.length ? opts.scope : [...GROUP_KEYS]` — `[]` collapses to all-7. Q4 has the loader call `searchAll` directly (bypassing api.search.tsx's `scope=` 400), the exclude-all-facets gesture is reachable (Q5 struck-in-place, no last-group guard), and the collapse renders the opposite of intent. No F-case and no `adaptiveLimit(0)` (pinned only 1–7, search.loader.test.ts:83-90). Default is not merely unspecified — it is actively wrong. |
| ACU-3 | material | Verified search.loader.test.ts:33 and api-search-cursor.test.ts:36 use `as unknown as SearchResponse` (:102 `as any`), directly violating the plan's BINDING "Prior-learnings" line 12 (satisfies-typed mocks; top provenance class). `satisfies SearchResponse` compiles here (checked: never[]→SearchResult[], Object.fromEntries→any perGroup, mode literal in union), so the double-cast is gratuitous and silently forfeits the drift-breaks-typecheck guarantee the plan mandates. Harness is the deliverable in a harness-first feature. |
| ACU-4 | material | Verified: `getCollectionAccessStrict` (collection-access.server.ts:28-29) calls the MOCKED `getPublicCollectionIds` and, for userId=null, skips `getEntitlements`; searchAll is mocked. So the anonymous test path makes 0 `context.db.execute` calls and `<=1` (search.loader.test.ts:64-68) is trivially true — it cannot bound the visibility queries CPERF-6 (binding learning, plan:13) exists to bound. Fix (admin-path test / spy on access helpers) is sound. Panel-1's "cannot fail" is slightly overstated (a direct-db.execute N+1 would trip it), but the substantive gap is real. |
| ACU-5 | noise | Plan line 25 calls "More in X →" "isolate to that group" — the natural SSR implementation is a scope-narrowing link (`?scope=X`, no `after`), which restarts fresh at adaptiveLimit(1)=25 and is correct by construction (cursor is (q,scope)-bound, F4). The described mechanism ("silently skip rows 9-25") is incorrect — a cursor after row 8 fetches rows 9+, it does not skip them. Speculative risk; would not change shipped quality. |
| ACU-6 | noise | Self-admittedly does not change the tier (correctly `large` on public-surface + behavior-change + ≥300-line grounds). searchAll gains an OPTIONAL param and has zero Ring-2 callers (search-endpoint plan:20 "Web app: none"; consumer is searchScriptures), so it cannot break Ring-2 regardless. Pure doc-wording correction with no effect on harness, design, or ship. |
| ACU-7 | noise | Premise (loader reimplements `after`-cursor validation → 3 codes drift) is contradicted by the loader harness: search.loader.test.ts has NO cursor/`after` case (only scope), i.e. cursors are API-route-only; "no-JS-observer" reads as no-IntersectionObserver, not no-JS SSR pagination. The codec (encode/decode/predicate) already lives in shared search.ts (plan:31), and both surfaces are independently harness-pinned, bounding the thin q/scope/limit + logging duplication. Shared-module ask is an implementation-structure preference. |
| ACU-8 | noise | The (q,scope) binding hash is an implementation detail; the CONTRACT (mint-for-other-q/scope → 400 cursor_mismatch) is already pinned by F4 (api-search-cursor.test.ts:83-98) independent of algorithm. Collisions are negligible at solo-dev beta traffic (<1k req/day, search-endpoint plan:22) and would at worst cause a pagination glitch, never a security issue. The v1-version-byte analogy is inapposite (format compat vs opaque binding token). Doc nit. |

## Notes
- No `risky` tags: every finding's proposed fix (add `sub`; pin zero-group; use
  `satisfies`; add admin-path query-count test; doc corrections) is strictly safe.
- No `out-of-scope` tags: none of the eight touch the plan's "Out (deliberate)"
  list; all concern this feature's own cursor contract, loader, and harness.
- ACU-1 is the load-bearing catch — it is a genuine keyset-correctness bug baked
  into both the plan's cursor format AND the red-first harness, invisible to F1.
