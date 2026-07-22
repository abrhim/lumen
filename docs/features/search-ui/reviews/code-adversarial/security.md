# Code-adversarial review — security (search-ui)

Adversarial pass over `code-panel/security.md`. Every finding independently
verified at file:line (and against the ratified plan ledger / D5 auth doctrine).
No refutation could be verified for any of the four, so under the house rule each
stays material. The specialist's severities are honestly scoped (they concede
SC-3 is self-inflicted and SC-4 is not browser-verified); my job confirmed rather
than downgraded.

| ID | Tag | Rationale |
|----|-----|-----------|
| SC-1 | material | Every sibling page loader (node.tsx:211, media.tsx:234, collections.tsx:95, admin.users.tsx:54) attaches `getSessionUser` `headers` via `data(...,{headers})`; `api.search.tsx:108,135,139` documents *why* ("session-rotation Set-Cookie survives on both paths"). `search.tsx` alone reads `session` (:236) and discards `session.headers`, and its 500 throw (:265) re-uses the static Cache-Control `headers` (:198), not `session.headers` — a concrete rotation-drop on the throw path (root's commit short-circuits on a thrown Response per the root.tsx D5 doctrine). Violates a documented silent-sign-out invariant; fix mirrors the app-wide convention. |
| SC-2 | material | Loader returns the whole `SearchResponse` incl. `meta`; the client (search.tsx) never reads `results.meta` (only `e.metaKey`), so it is pure dead-weight in the SSR hydration payload — and on combined-statement failure `searchAll` returns (does not throw) with `meta.combinedError`/per-group `error` = raw exception strings (search.ts:780,798), which then serialize to the client HTML. `api.search.tsx:133` deliberately strips to `{query,reference,groups}`; the page does not. Real info-disclosure delta; strip is safe (client unaffected). |
| SC-3 | material | `decodeSearchCursor` regex checks 16 hex, not finiteness (search.ts:240); `scoreFromHex('7ff8…')`→NaN, and PG sorts NaN as greatest so `keysetAfter`'s `score < NaN` (search.ts:346) re-admits the page-1 partition and mints a fresh `nextCursor` — specialist live-verified (200, page-1 repeat, next:yes). Contradicts F3 ("tampered → cursor_invalid"). Self-inflicted, no leak (within the SU-1 no-cross-user model), but a genuine verified behavioral gap the ratified model never anticipated; `Number.isFinite` guard rejects zero legit cursors (encode only ever writes finite ts_rank bits). Low severity, real defect, safe fix. |
| SC-4 | material | Residual instance of the B-U1 mode via the keyboard path (task: residual = material, not the fixed pointer instance). Verified in code: the orb `DialogTrigger` renders unconditionally on /search (only the *hotkey* effect stands down, SearchModal.tsx:38); a keyboard-opened modal closes with `openedByPointer=false` → `onCloseAutoFocus` does not preventDefault (:133-139) → Radix returns focus to the orb → Space activates the live trigger → modal opens on /search, contradicting F9 ("never stacks there"). Fix (neutralize orb on /search) aligns with F9, low risk. |

## Stance

The code-panel security review is strong and accurate. All four findings are
real, in-scope (search-ui files only), non-blessed (none match "Out (deliberate)"
nor a ratified A1–A11/decision), and carry safe fixes I verified. SC-1 is the
highest-value: the page loader is the *single* `getSessionUser` caller in the app
that drops the D5 rotation `Set-Cookie`, and its 500-throw path provably re-emits
the static headers instead — a documented silent-sign-out class. SC-2 leaks raw
DB error strings the sibling API route strips. SC-3 and SC-4 are honestly-scoped
low-severity defects (self-inflicted loop; keyboard-path residual) but both are
verified real behavioral gaps against F3/F9 with trivially safe fixes, so neither
is noise. I could not verify a refutation for any finding; all four stay material.
