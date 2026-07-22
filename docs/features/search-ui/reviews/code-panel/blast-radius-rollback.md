# Code panel — blast-radius-rollback (search-ui, f352bae..46d888d, deployed fd093ed4)

Reviewer lens: SearchChromeBoundary degradation, route ErrorBoundary recovery, routes.ts
ordering, rollback (redeploy f352bae-era worker), kill-switch `public=false` mid-session.
Worktree HEAD moved to 4f86b95 (A10/B-U3) during review; findings target the deployed range.

| ID | Sev | Where | Problem | Fix |
|----|-----|-------|---------|-----|
| BRRC-1 | med | apps/web/app/root.tsx:79-98, 104-106; entry.server.tsx:16-26 | SearchChromeBoundary's "never take the app shell" guarantee is client-render-only. Verified with the repo's react-dom 19.2.1: a child throw under `renderToReadableStream` is NOT caught by the class boundary — the shell promise rejects (`SHELL REJECTED: modal-boom`), so a deterministic SSR throw anywhere in SearchModal (or its imports: Radix Dialog/Sheet, use-mobile) replaces EVERY route's document with the root "Oops!" ErrorBoundary — no degraded orb. The orb SSRs on every page (probed live: homepage HTML carries the dialog-trigger orb). Document-level `keydown` handler errors (SearchModal.tsx:62) also bypass the boundary (uncaught, hotkeys die, no degradation). | SSR a static orb anchor; mount `<SearchModal>` client-only after hydration (or wrap in `<Suspense>` so server errors client-retry into the boundary, which works there). |
| BRRC-2 | low | apps/web/app/components/SearchModal.tsx:35,38 vs routes/search.tsx:686-711 | Stand-down is string equality `location.pathname === "/search"`, but the route matches trailing-slash URLs — probed live: `GET /search/` → 200 page. On `/search/` BOTH document keydown handlers are active: the page's (registers first, child effects run first) focuses the inline input, then the modal's still runs (`preventDefault` doesn't stop other listeners) and opens the Dialog stacked over the page — the exact F9 violation the stand-down exists to prevent. Same mode as B-U2: state derived from a proxy (string) instead of the source (route match). | Normalize (`pathname.replace(/\/+$/, "") === "/search"`) or use `useMatch("/search")` in SearchModal. |
| BRRC-3 | low | apps/web/app/routes/search.tsx:1044-1075 + SearchModal.tsx:37-38 | Recovery-path hotkey deadzone: when the route ErrorBoundary renders on /search (e.g. transient 500 — pool exhaustion is a documented incident class), the page's hotkey effect is unmounted AND SearchModal still stands down by pathname, so `/` and `⌘K` do nothing on the one page whose own hint says "Press / anywhere". The boundary has no input; recovery is the "Start a new search" link only (which does work — RR clears route errors on navigation, verified flow). | Stand the modal down only when the live page is mounted (context flag/route-error check), or render the inline input in the ErrorBoundary. |
| BRRC-4 | low | apps/web/app/components/SearchModal.tsx:80-82, 112-118, 133-139 | B-U1 fix scrutiny (bugs.md asks): fix holds for the reported flow (pointer open → close → focus blurred, Space scrolls). Residual: `openedByPointer` goes stale when a `pointerdown` on the orb never completes a click (drag-off/cancel) — the flag stays `true`, so a LATER Tab+Enter keyboard open gets `preventDefault()+blur()` on close, dropping the AU-3 return-focus that keyboard opens are ratified to keep. Hotkey opens self-heal (they set the flag false); trigger-keyboard opens don't. | Clear the flag on trigger `onKeyDown` (or in `onClick` when `e.detail === 0`), or reset via `onOpenChange(true)` when no pointerdown occurred in the last tick. |
| BRRC-5 | low | apps/web/app/routes/search.tsx:55, 196, 213 | `SearchLoaderData.headers` is a `Headers` instance in loader data. On single-fetch client navigations it serializes as `["SingleFetchClassInstance", {}]` (verified live in `/search.data?q=grace` payload tail) — the field exists server-side (harness pins it) but is an empty husk client-side. Harmless today (no client read), but it's a silent SSR/CSR contract divergence waiting for a consumer. | Drop `headers` from loader data; assert Cache-Control via the `headers` export / thrown-Response headers in the harness. |

## Verified clean (lens sweeps, no finding)

- **Rollback = redeploy f352bae worker: clean.** No migrations in the diff (diffstat); `score_bits`
  is a query-side expression (`encode(float8send(s.score),'hex')`, search.ts legs) — no schema/DDL
  coupling; nothing persisted server-side for cursors; no KV/wrangler changes. Old api.search.tsx
  (read at f352bae) only reads `q/scope/limit` — a new client's `after` fetch against a rolled-back
  worker returns page-1 again with NO `nextCursor`; `dedupeMoments` keys ALL rows (`i:type:id`),
  so the duplicate page dedupes away and pagination ends with "That's everything." Graceful skew.
  Bookmarked /search on an old worker: single segment matches nothing (`:type/:id` is 2-segment)
  → clean 404 via root boundary. Ratified BRRU-4 (full-redeploy rollback, no flag) holds.
- **routes.ts ordering (F14):** `search` above `:type/:id` (routes.ts:16,20); `/search/foo` falls
  to node.tsx which 404s unknown types fail-closed. No shadowing either direction.
- **Kill-switch `public=false` mid-session:** visibility re-derived per request (search.tsx loader
  :232-244, api.search.tsx:105-120); `anyOf([])`/shrunk set → `string_to_array(NULLIF('',''))` →
  NULL → `= ANY(NULL)` filters all collection-gated rows; canon verses stay by documented design.
  Cursor replay under narrower visibility re-gates inside each leg's `inner` (paged() wraps the
  collection-gated WHERE) — fail-closed, no distinct error, matches ratified BRRU-6/F16. Cursors
  only carry ids of rows the holder already saw.
- **Session-rotation Set-Cookie on /search documents:** search.tsx's static `headers()` does NOT
  clobber root's rotation cookies — RR 7.9.6 `getDocumentHeadersImpl` unconditionally
  `prependCookies(loaderHeaders/parentHeaders)` past a route `headers` export (traced in
  react-router dist chunk-FDUMZGKM.mjs). The root-comment invariant (thrown redirects) is untouched.
- **F17 error-branch headers:** live `GET /search?q=grace&scope=bogus` → 400 document with
  `cache-control: private, no-store`.
- **B-U2 fix holds end-to-end:** engine returns `shortCircuit:false` for book/volume
  (search.ts resolveSearchReference, "Bare names are real content words"); live
  `/api/search?q=moses` returns `reference.found` AND populated groups; UI gates short-circuit
  rendering to verse/chapter only (search.tsx:178-180, view :626-637, Enter hint :662, loader
  :253-256). Residual-mode sweep (statusText, live-fetcher path, referencePath book/volume
  levels) found no remaining "any-found-reference = short-circuit" instances.
- **Cursor 400 contract live:** garbage `after` → `cursor_invalid`; `after` without single scope
  → `cursor_scope`; real cursor with different q → `cursor_mismatch` (probed, bodies never echo
  the raw cursor).

## Evidence

```
# SSR boundary trace (repo's react-dom 19.2.1, mirrors entry.server.tsx):
$ node -e "renderToReadableStream(<div><Boundary><Bomb/></Boundary>…)"
onError fired: modal-boom
SHELL REJECTED: modal-boom          # class boundary NOT invoked server-side

# Orb SSRs app-wide (homepage document):
aria-label="Search" … data-slot="dialog-trigger"

# Trailing slash matches live:
GET /search/          -> 200
GET /search/?q=grace  -> 200

# Headers instance in single fetch (tail of /search.data?q=grace):
…"referenceHref","limitPerGroup","qMin","headers",["SingleFetchClassInstance",376],{},"state","q"]

# Cursor 400s (live worker fd093ed4):
after=zzzz|notacursor            -> {"error":"invalid cursor","code":"cursor_invalid"}
after=<real>, no single scope    -> {"…","code":"cursor_scope"}
after=<real>, q=mercy            -> {"…","code":"cursor_mismatch"}

# F17 on thrown 400:
GET /search?q=grace&scope=bogus  -> HTTP/2 400, cache-control: private, no-store

# B-U2 live (book-level ref + groups coexist):
GET /api/search?q=moses&scope=people&limit=3 ->
{"query":"moses","reference":{"level":"book","book_id":"moses",…,"found":true},
 "groups":[{"key":"people","results":[{"type":"person","id":"person:moses-1",…

# Rollback skew source (f352bae api.search.tsx): only q/scope/limit read; `after` ignored.
# score_bits: SELECT-side `encode(float8send(s.score),'hex')` in all 5 legs — no DDL anywhere
# in the diff (diffstat: no migrations/, no wrangler changes).

# RR 7.9.6 cookie preservation past a static headers export (chunk-FDUMZGKM.mjs):
prependCookies(actionHeaders, headers); prependCookies(loaderHeaders, headers);
prependCookies(parentHeaders, headers);
```
