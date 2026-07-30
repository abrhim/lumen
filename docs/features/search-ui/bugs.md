# Bugs — search-ui (running log; code-panel findings merge in at step 11)

| ID | Severity | Provenance | Where | Problem | Status |
|----|----------|------------|-------|---------|--------|
| B-U1 | med | **Abram, live test 2026-07-21** | SearchModal.tsx trigger focus | Pointer-opened modal returned focus to the orb on close; the focused button turned Space-to-scroll into Space-reopens-search. | FIXED 19763c2, deployed f2d9dc6e — pointer-aware `onCloseAutoFocus` (keyboard opens keep return-focus per AU-3). e2e: manual (no browser automation in repo); code-panel to scrutinize. |
| B-U2 | high | **Abram, live test 2026-07-21** | search.tsx state machine (:246, :616) | Book/volume bare-name references (q='moses') suppressed ALL groups — the page treated every found reference as a verse-style short-circuit, hiding the graph behind the Book of Moses. Decision 4: only verse/chapter short-circuit. | FIXED d730fc1 (repro red-first, 23/23), deployed fd093ed4 — reference lead now renders above full results; Enter hint gated to true short-circuits. |
| B-U3 | low | **Abram, live test 2026-07-21** | search.tsx + SearchModal.tsx inputs | Native type="search" cancel X (OS chrome) clashed with the app branding. | FIXED — native control suppressed on both inputs; branded XIcon clear button (house hit-area idiom) added to the page input. Ships with A10. |

## Confirmed bugs (open) — code-panel merge (step 11)

Code-panel (8 reviewers — correctness, api-contract, security, ux, accessibility,
observability, performance, blast-radius-rollback) surfaced **52 findings** ×
adversarial meta-review (**44 material / 8 noise**). The 44 material findings dedupe
to **30 confirmed bugs** (5 high / 14 med / 11 low), listed below as B1–B30. The
user-found B-U1/B-U2/B-U3 above are already FIXED; every bug in this section was OPEN at merge time; all are now FIXED (B18 deferred) — see the RESOLVED note at the bottom.
Sorted high→low severity, then by cluster. Fixes NOT yet landed. Rejected noise (8)
listed at the bottom. Diff `f352bae..46d888d` = deployed worker fd093ed4; probes LIVE
prod (GET) + `lumen_read` DB, read-only.

### B1: keyset cursor minted from JS code-unit order re-serves rows across page boundary (collation split)
- Severity: high · correctness/api-contract/performance · packages/scripture/src/search.ts:363,367 (leg `ORDER BY … id`), :344-347 (`keysetAfter` id compare), :705-713 (`sortResults` JS tiebreak), :719-730 (`mintNextCursor`)
- Provenance: CC-1 (correctness) + ACC-1 (api-contract) + PC-2 (performance) — 3-role convergence
- Problem: SQL legs order/compare `id` under the DB default collation (**en_US.UTF-8**), but `sortResults` re-sorts with JS UTF-16 code-unit `<` and `mintNextCursor` mints from the **JS-last** row. Inside exact score ties whose ids invert between the two collations (mixed-case episode/moment ref_ids embed YouTube ids, e.g. `unshaken-O3SiM9Yi940#144` vs `ki0bTvQsaCo#356`), the minted cursor is not the SQL page boundary → page 2 **re-serves page-1 rows**. **Live-proven on prod**: `q=israel&scope=episodes&limit=8` serves `unshaken-O3SiM9Yi940#144` on BOTH page 1 and page 2; `q=faith&scope=episodes&limit=23` dups `unshaken-RLirbnj-kGk#2408`. Divergent universes: episodes 1885/4010 ref_id positions, topics 996 (`God-with-us`); verses/people/places/art/words 0-divergent (which is why F1/F15 pass — scripture ids are collation-neutral). Dup-only, no gap; UI masks it via `dedupeMoments`, raw API/Ring-2 consumers see it. Violates F1/F15's ratified no-dup contract; the plan cursor bullet never addresses collation.
- Fix: add `COLLATE "C"` to every leg's `ORDER BY … id` **and** to `keysetAfter`'s id comparison so SQL order equals the JS code-unit tiebreak (sorts are top-N heapsort per EXPLAIN — no index impact); or mint the cursor from SQL row order. Extend the harness pin to episodes/topics (see B30).
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B2: single-scope append state (`extra`) survives a live query edit → stale rows + guaranteed `cursor_mismatch`
- Severity: high · correctness/ux/performance · apps/web/app/routes/search.tsx:579-601,615-629 (`onInputChange`/commit-discard effect), :580-585 (`pendingCursorRef`), :749-766 (`mergedSingle`/`currentCursor`), :1029-1031
- Provenance: CC-2 (correctness) + CC-3 (correctness) + UC-1 (ux) + PC-1 (performance)
- Problem: `onInputChange` clears live state but never resets `extra` or `pendingCursorRef`; the commit-discard effect keys only on `[location.key, q]`, neither of which live-typing changes. On a single-scope page with appended pages, live-typing a NEW query makes `mergedSingle` append the OLD query's pages under the NEW results and `currentCursor` prefer the stale `extra.nextCursor`: an exhausted stale cursor renders a false "That's everything." under a truncated new query; a present stale cursor makes More/sentinel fetch `q=NEW&after=OLD_CURSOR` → deterministic 400 `cursor_mismatch` → feeds the B3 crash. CC-3 is the commit-path sub-instance: an in-flight More landing after an Enter-commit passes the `pendingCursorRef !== null` gate and appends old-q rows to the new page.
- Fix: reset `extra` AND `pendingCursorRef.current` whenever the displayed query changes (in `onInputChange` next to `setLive(null)`, and on the commit-discard effect), not only on navigation commit; derive `currentCursor` from the live group's `nextCursor`.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B3: unguarded `d.groups.find` on a returned API error body → whole page swaps to ErrorBoundary
- Severity: high · observability/correctness/ux · apps/web/app/routes/search.tsx:591-607 (`pageFetcher` effect)
- Provenance: OC-1 (observability) + CC-4 (correctness) + UC-2 (ux) + PC-1 (performance, crash aspect)
- Problem: the `pageFetcher` effect dereferences `d.groups.find(...)` with no shape guard. `/api/search` RETURNS (never throws) `{error,code}` for 400/500 — RR 7.9.6 single-fetch wraps them with `X-Remix-Response: yes`, so they land in `fetcher.data`, not the boundary (live-verified: `/api/search.data?q=x` turbo-stream encodes the error under `"data"`). Any transient pagination 500 (Supabase pool-exhaustion is a documented incident class), a future `cursor_invalid` after a CURSOR_VERSION bump, or B2's deterministic `cursor_mismatch` throws `TypeError: undefined.find` inside the effect → the route ErrorBoundary replaces the entire page, discarding every loaded result and the input. OU-3 accepts a server-log signal for pagination failure, NOT a self-inflicted full-page crash.
- Fix: guard `if (!Array.isArray(d?.groups)) { pendingCursorRef.current = null; …return }`; show a quiet retryable inline "couldn't load more" state instead of crashing.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B4: `/search` loader discards `session.headers` → token-rotation Set-Cookie dropped on client nav
- Severity: high · security · apps/web/app/routes/search.tsx:234,236 (reads `session`), :251-272 (returns plain object + static `headers()`), :265 (500-throw reuses static headers)
- Provenance: SC-1 (security)
- Problem: the page loader reads `getSessionUser` but returns a plain object with a static `headers()` export, discarding `session.headers`; its 500-throw path re-uses the static Cache-Control headers, not `session.headers`. On client-nav `.data` requests RR does not revalidate the root loader (the D5 single auth-commit site), so the search loader is the only committer and a mid-flight token-rotation `Set-Cookie` is dropped — silently killing the session per the auth layer's own D5 doctrine. Every sibling loader (node/media/collections/admin.users) and `api.search.tsx` attach `session.headers` via `data(…,{headers})`; `search.tsx` alone does not.
- Fix: return `data({…},{ headers: session.headers })` and forward `loaderHeaders` in `headers()`, and use `session.headers` on the throw path — mirror `api.search.tsx`.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B5: keyboard "More" loses roving focus every page — ratified keyboard-pagination path defeated
- Severity: high · accessibility · apps/web/app/routes/search.tsx:1012-1033 (`disabled={pageFetcher.state !== "idle"}` at :1096), :800/:815 (`onMainKeyDown` bound on `<main>`)
- Provenance: AC-1 (accessibility)
- Problem: clicking "More" sets `disabled` while loading, which browser-blurs the focused button to `<body>`; on the final page the button unmounts ("That's everything"). With focus on `<body>` the roving `onMainKeyDown` (bound on `<main>`) never fires — ↑↓ go dead and the user must re-Tab from document top through orb/menu/input/toggles every page. Defeats the plan's ratified keyboard pagination path (F22/AU-2).
- Fix: don't disable while loading — use `aria-busy` + the existing `loadMoreRef` no-op guard; on last page move focus to "That's everything" (`tabIndex={-1}`+`.focus()`) or the last appended row.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B6: found book/volume reference with zero group hits suppresses the reference lead (residual B-U2 mode)
- Severity: med · correctness/performance · apps/web/app/routes/search.tsx:627-638, :929-937 (reference-lead render gate), :1011
- Provenance: CC-5 (correctness) + PC-7 (performance)
- Problem: the reference-lead render gate is `view==="reference" || (view==="results" && displayReference)` — it omits `view==="zero"`. A FOUND volume/book reference whose included groups yield zero rows (live: `q=pgp`/`bom`/`ot`/`nt`, or any book once matching groups are scope-excluded) forces `view==="zero"`, so the SSR shows "Nothing in the library matches" with **zero** Reference blocks — hiding a valid reader door. B-U2 was "reference suppresses groups"; this is the inverse residual "zero groups suppress reference" at a new site (house fix-the-mode rule).
- Fix: render the reference lead in the zero state too — gate on `displayReference` (add `view==="zero"`), with the zero copy beneath it.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B7: live-fetch failures silently swallowed — no feedback, stuck "pending", no client max-length gate
- Severity: med · observability/correctness · apps/web/app/routes/search.tsx:586-590 (`d.query===liveQRef` guard), :619-638
- Provenance: OC-3 (observability) + CC-6 (correctness)
- Problem: the liveFetcher `d.query === liveQRef.current` guard drops error bodies (error responses carry no `query` key), so a 500 mid-typing keeps showing the PREVIOUS query's results/status while the input holds the new query, and from the empty state it sticks in a blank "pending" forever. `onInputChange` gates only `< qMin`, never `> Q_MAX` (200), so a >200-char input 400s (`q_length`) with the same silent-swallow result — no client signal, and the ratified ErrorBoundary signal can never fire because the API returns rather than throws. Server `search_failed` logs; the user sees nothing.
- Fix: detect error-shaped fetcher data and show the quiet inline zero/error copy (revert stale status); client-gate q ≤ 200 like Q_MIN.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B8: `view==="pending"` has no render branch — blank void; designed skeleton-after-300ms never shipped
- Severity: med · ux · apps/web/app/routes/search.tsx:626-637 (`view` union), :732-743 (`busy`/`busySlow`), :898-1038 (render branches)
- Provenance: UC-3 (ux)
- Problem: the `view` union includes `"pending"` but no render branch covers it (only empty/keepTyping/zero/reference/results exist) — typing past qMin from a bare `/search` blanks the invitation into a void. The plan's Scope-In "skeleton only after 300 ms" never shipped (no skeleton markup exists), and the 300 ms slow-timer starts at fetch (after the 350 ms debounce), so the only pending signal ("Searching…") can't appear for ≥650 ms.
- Fix: add a quiet pending render (dim previous content or a minimal skeleton) and start the slow-timer at the keystroke so it spans the debounce window.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B9: page buttons retain pointer focus → Space re-fires the control (residual B-U1 mode); no focus-visible
- Severity: med · ux/accessibility/performance · apps/web/app/routes/search.tsx:845-869 (scope toggles), :873-882 (Show-all), :1017-1025 (More)
- Provenance: UC-4 (ux) + AC-6 (accessibility) + PC-5 (performance)
- Problem: scope toggles / "Show all" / "More" are plain `<button>`s with no blur-after-pointer handling. `commitScope`→`commitNavigate`→`navigate` re-runs the loader on the SAME route, so React reuses the keyed DOM node and focus survives — Space-to-scroll then re-activates the button, silently re-including a just-excluded group or double-paginating (the exact B-U1 Space-hijack mode Abram found on the orb). Scope toggles also carry hover styles only, no `focus-visible:` ring.
- Fix: apply the B-U1 pattern (blur on pointer-initiated activation / `onPointerDown` flag, or `e.detail>0` guard); add a `focus-visible` ring so intentional keyboard focus stays legible.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B10: page loader returns full `SearchResponse.meta` → raw DB error strings leak into SSR payload
- Severity: med · security · apps/web/app/routes/search.tsx:246, :251-260
- Provenance: SC-2 (security)
- Problem: the loader returns the whole `SearchResponse` including `meta`; the client never reads `results.meta`, so it is pure dead-weight in the SSR hydration payload — and on a combined-statement/poisoned-row failure `searchAll` returns (not throws) with `meta.combinedError` / per-group `error` = raw exception strings, which serialize into the client HTML. The API route deliberately strips to `{query, reference, groups}`; the page does not.
- Fix: return only `{ query, reference, groups }` (or strip `results.meta`) from the page loader.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B11: words original-script rendering — string-split mis-renders 354 multi-word strongs titles; span lacks lang/dir
- Severity: med · ux/accessibility · apps/web/app/routes/search.tsx:474-494 (`title.split(" ")`), :483/:485 (original-script span); packages/scripture/src/search.ts:595,599 (wordsLeg payload)
- Provenance: UC-5 (ux) + AC-5 (accessibility)
- Problem: words rows split `title` on the last space and treat the tail as the original script; live DB probe finds 354/20,734 strongs titles are multi-word ("ou mē οὐ μή", "aleph α, Αλφ") — script fragments render inside the 15px Latin name span and only the tail gets the 19px original-script treatment ("aleph" is an eminently typeable query). The original-script span also has no `lang`/`dir`, so screen readers hit Hebrew (בְּרִית H1285) / Greek (κιβωτός G2787) with the page language (WCAG 3.1.2). The words leg already reads `payload->>'translit'` but ships only `strongs_no`.
- Fix: carry `translit`/`original` as separate payload fields from the words leg (jsonb_build_object allowlist) instead of string-splitting; render the original-script span with `lang={strongs_no.startsWith("H")?"he":"grc"}` (+`dir="rtl"` for Hebrew).
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B12: book/volume reference lead headlines the user's RAW-cased input, not the DB-proper name
- Severity: med · ux · packages/scripture/src/search.ts:291 (`display: parsed.raw`); apps/web/app/routes/search.tsx:936-967 (2xl lead)
- Provenance: UC-6 (ux)
- Problem: book/volume references set `display: parsed.raw` (`parseReference` returns original casing), so the prominent 2xl font-display B-U2 lead renders "moses →" / parrots "MOSES" / "d&c", while chapter uses `books.name` and verse uses `verses.reference` (DB-proper "1 Nephi 3:7"). A casing inconsistency on the flagship B-U2 lead surface.
- Fix: resolve the display name from `lumen.books.name` (as chapter level already does) or title-case via the slug map before rendering the lead.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B13: first text-input-in-Sheet — iOS Safari likely won't raise the keyboard; no keyboard-avoidance
- Severity: med · ux · apps/web/app/components/SearchModal.tsx:106-125; apps/web/app/components/ui/sheet.tsx:63
- Provenance: UC-7 (ux)
- Problem: Radix's deferred open-autofocus runs from React state effects, outside the tap's user-activation window, so under WebKit's synchronous-focus-in-gesture rule the mobile bottom-Sheet modal input likely needs a second tap to raise the soft keyboard; the `fixed bottom-0` sheet also has no visualViewport/keyboard-avoidance handling. AppMenu's Sheet is links-only — no house precedent for an input in a Sheet. Mechanism-level (not device-verified); a degraded primary mobile entry.
- Fix: device-verify on iOS; if confirmed, `onOpenAutoFocus` preventDefault + synchronous focus, and visualViewport padding so the input clears the keyboard.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B14: `motion-reduce:animate-none` is dead against the Radix open/close animations (specificity)
- Severity: med · accessibility · apps/web/app/components/ui/dialog.tsx:42,64 + ui/sheet.tsx:38,63 + SearchModal.tsx:111,132
- Provenance: AC-2 (accessibility)
- Problem: in the deployed CSS `.motion-reduce\:animate-none` (@59012) loses on source order to `.data-open\:animate-in:where([data-state=open])` (@63524) and `.data-closed\:animate-out` (@65778): shadcn defines `data-open`/`data-closed` via `:where()`, zeroing the variant's specificity, so all three selectors are (0,1,0) and the later rule wins. Under `prefers-reduced-motion: reduce` the dialog still zooms and the sheet still slides — ratified AU-5 ("motion-safe variants") is non-functional as shipped.
- Fix: use `motion-safe:data-open:animate-in` (etc.) per AU-5's own wording, or add an `app.css` `@media (prefers-reduced-motion: reduce)` override targeting `[data-slot=dialog-content]`/`[data-slot=sheet-content]`.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B15: roving tabindex has no tab-stop anchor — rows unreachable by Tab; ↑↓ dead on fresh SSR load
- Severity: med · accessibility · apps/web/app/routes/search.tsx:527 (rows permanently `tabIndex={-1}`), :714-730, :817/:832 (`autoFocus` only when empty)
- Provenance: AC-3 (accessibility)
- Problem: every result row is permanently `tabIndex={-1}` with no `tabIndex=0` anchor, so results are unreachable by Tab (Tab goes input → toggles → More pills, skipping all rows) and ↑↓ only work while focus is already inside `<main>`. On a q-bearing SSR load there is no autofocus, so focus sits on `<body>` and the advertised "↑↓ to move" arrows do nothing; tabbing away also discards the roving position.
- Fix: give the active (or first) row `tabIndex={0}` (state-tracked), rest `-1`; optionally listen for ↑↓ at document level when focus is on body.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B16: `search_executed` has no surface discriminator — page vs API events are field-identical (double-count)
- Severity: med · observability · apps/web/app/lib/search-obs.server.ts:35-58 + apps/web/app/routes/search.tsx:145-149
- Provenance: OC-2 (observability)
- Problem: `search_executed` carries no `surface`/`live` field, so page-loader and API-fetcher events are indistinguishable. Enter-after-debounce double-counts one user search; the same logical all-groups search logs `scope: null` from the page but the full 7-key array from the fetcher (`buildPageFetchUrl` always sends `scope=`); debounced partial-word queries pollute the zeroResult denominator OU-1 exists to protect. (Dual logging itself is ratified OU-6; the missing discriminator is not.)
- Fix: add `surface: "page" | "api"` (or `live: boolean`) to `SearchLogContext` and the event.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B17: `/api/search.data` responses carry no Cache-Control — session/admin bodies escape SECURITY-3 on the shipped fetcher path
- Severity: med · observability/security · apps/web/app/routes/api.search.tsx (no `headers()` export; cf. search.tsx:270-272)
- Provenance: OC-4 (observability, cross-lens security)
- Problem: RR single-fetch `.data` responses take headers from the route's `headers()` export, not the loader's returned Response — and `api.search.tsx` has none. Live: raw `/api/search` → `cache-control: private, no-store`; `/api/search.data` (the ONLY variant the page's fetchers hit) → absent. Session-varying (admin-entitled) bodies escape the SECURITY-3 / F17 private-no-store mandate on the shipped UI path.
- Fix: `export function headers() { return { "Cache-Control": "private, no-store" }; }` in `api.search.tsx`.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B18: dead drizzle chunk (~18.5 kB gz) on the `/search` hydration path via the `@lumen/scripture` barrel
- Severity: med · performance · apps/web/app/routes/search.tsx:5 (imports `GROUP_KEYS`/types from the barrel); packages/scripture/src/search.ts (carries `drizzle-orm`)
- Provenance: PC-3 (performance)
- Problem: `search.tsx` imports `GROUP_KEYS`/types from the `@lumen/scripture` barrel whose `search.ts` module carries `drizzle-orm`; the client build emits a 68.6 kB (18.46 kB gzip) chunk of pure drizzle column/SQL machinery on `/search`'s hydration path (26 drizzle refs, zero app symbols). Pre-existing mode (book/node/scripture/GraphOverlay chunks import it too), but the new flagship page inherits ~18.5 kB gz of dead code on cold entry.
- Fix: move `GROUP_KEYS`/`GroupKey`/result types to a db-free leaf module (`search-types.ts`) re-exported by `search.ts`; client code imports the leaf (fixes every route at once).
- Status: DEFERRED — client-import repoint needs a package exports-map (see RESOLVED note below)

### B19: SearchChromeBoundary is client-render-only — an SSR throw in SearchModal replaces every route's document
- Severity: med · blast-radius-rollback · apps/web/app/root.tsx:79-98,104-106; apps/web/app/entry.server.tsx:16-26
- Provenance: BRRC-1 (blast-radius-rollback)
- Problem: the "never take the app shell" guarantee is client-only — under `renderToReadableStream` (react-dom 19.2.1) a child throw is NOT caught by the class boundary (`getDerivedStateFromError` is client-only; the shell promise rejects). The orb+modal SSR on every page, so a deterministic SSR throw anywhere in SearchModal (or its imports: Radix Dialog/Sheet, use-mobile) replaces EVERY route's document with the root "Oops!" boundary — no degraded orb, defeating ratified BRRU-3. Document-level `keydown` handler errors also bypass the boundary.
- Fix: SSR a static orb anchor and mount `<SearchModal>` client-only after hydration (or wrap in `<Suspense>` so server errors client-retry into the boundary).
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B20: `decodeSearchCursor` accepts NaN/±Infinity score → self-loop repeating page 1
- Severity: low · security · packages/scripture/src/search.ts:222-247 (decode), :344-347 (`keysetAfter`)
- Provenance: SC-3 (security)
- Problem: the decode regex checks 16 hex, not finiteness, so a tampered `score` of NaN/±Inf is accepted; PG sorts NaN as greatest, so `score < 'NaN'` returns the partition from the top and mints a fresh `nextCursor` — a client following the chain loops forever (live-verified: HTTP 200, page-1 repeat, next:yes). Contradicts F3 ("tampered → cursor_invalid"). Self-inflicted only; visibility still re-gated, no cross-user leak.
- Fix: in `decodeSearchCursor`, `if (!Number.isFinite(score)) throw new SearchCursorError('cursor_invalid')` (encode only ever writes finite bits — rejects zero legit cursors).
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B21: orb/modal focus residual on `/search` — Space reopens the modal; stale pointer flag drops keyboard return-focus
- Severity: low · security/blast-radius-rollback · apps/web/app/components/SearchModal.tsx:80-82,106-139 (`openedByPointer`/`onCloseAutoFocus`); orb persists in apps/web/app/root.tsx on `/search`
- Provenance: SC-4 (security) + BRRC-4 (blast-radius-rollback)
- Problem: two residual instances of the B-U1 mode on the modal trigger. (SC-4) The orb `DialogTrigger` renders unconditionally on `/search` (only the hotkey effect stands down); a keyboard-opened modal that submits and navigates to `/search` returns focus to the orb (no pointer preventDefault), and Space then re-activates the live trigger, reopening the modal on `/search` — F9 says it never stacks there. (BRRC-4) `openedByPointer` goes stale-true after a cancelled `pointerdown` (drag-off, no click), so a LATER keyboard open gets `preventDefault()+blur()` on close, dropping the AU-3 return-focus keyboard opens are ratified to keep.
- Fix: neutralize/disable the orb `DialogTrigger` on `/search` (blur after hotkey/submit navigation); clear the flag on trigger `onKeyDown` / in `onClick` when `e.detail===0`.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B22: live-typed reference hint "press Enter again to go" under-counts by one Enter
- Severity: low · ux/accessibility · apps/web/app/routes/search.tsx:662-666 (`onSubmit` `trimmed===q` gate), :955-959 (hint)
- Provenance: UC-8 (ux) + AC-4 (accessibility)
- Problem: on the live-typed reference path (`view==="reference"`, `trimmed!==q`) the hint reads "press Enter again to go", but `onSubmit`'s `trimmed===q` guard is false pre-commit, so Enter #1 only re-commits the URL (a visual no-op, the lead already shows) and only Enter #2 opens the reader — the hint under-counts by one.
- Fix: gate the copy on `trimmed===q` (else reword), or let `onSubmit` navigate straight to `displayReferenceHref` when `view==="reference"` regardless of commit state.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B23: last-included scope toggle — contradictory sr-only text, no floor-of-1 feedback
- Severity: low · accessibility · apps/web/app/routes/search.tsx:848,866-868
- Provenance: AC-7 (accessibility)
- Problem: the last-included scope toggle sets `aria-disabled` and no-ops on activation, but the visually-hidden text still instructs ", included — activate to exclude" — a contradictory instruction with no feedback for SR users on the floor-of-1 rule.
- Fix: swap the sr-only text when `lastIncluded` (", included — at least one group must stay included").
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B24: status live-region never announces keepTyping; a pending debounce can unmount the focused row
- Severity: low · accessibility · apps/web/app/routes/search.tsx:787-795 (`statusText`), :922-926, :586-589/:1006-1008 (debounce re-key)
- Provenance: AC-8 (accessibility)
- Problem: (a) `statusText` has no keepTyping branch and falls through to `""`, so an SR user whose query drops below Q_MIN gets silence while sighted users see "Keep typing…" (parity gap). (b) A pending 350 ms debounce firing after ArrowDown-into-rows re-keys the list and can unmount the focused row → focus lost to `<body>` (narrow window).
- Fix: add a keepTyping branch to `statusText`; cancel the pending debounce when roving focus enters the rows.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B25: `search_failed` lacks continuation context (`hasCursor`) — cursor-leg 500s unreproducible
- Severity: low · observability · apps/web/app/lib/search-obs.server.ts:63-74
- Provenance: OC-5 (observability)
- Problem: `logSearchFailed` is `Pick<…q|scope|visibility>` with no `after`/`hasCursor`, so a continuation-only 500 is indistinguishable from a page-1 failure; OBS-3's "operator can reproduce the 500" promise fails for continuation-specific failures (repro of q/scope alone succeeds).
- Fix: log `hasCursor: after !== undefined` (boolean only — raw cursor stays unechoed per F3).
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B26: OU-1 / decision-10 observability invariants unpinned in the harness
- Severity: low · observability · apps/web/app/routes/__tests__/api-search-cursor.test.ts:22 (and no pin anywhere)
- Provenance: OC-6 (observability)
- Problem: no test asserts `hasCursor: true` on continuations, `zeroResult: false` when `after` is present, or zero `logEvent` calls on cursor-400 paths (the cursor test mocks `logEvent` but never inspects it). Under a harness-first plan, a regression could silently break the zero-result denominator or start logging raw cursors.
- Fix: pin all three in `api-search-cursor.test.ts` (logEvent not-called on 400s; hasCursor/zeroResult on a mocked continuation).
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B27: debounce timer has no unmount cleanup → stray `/api/search` round trip after navigation
- Severity: low · performance · apps/web/app/routes/search.tsx:613-617
- Provenance: PC-4 (performance)
- Problem: the debounce timer is cleared only on `onInputChange`/`commitNavigate` paths, with no unmount cleanup. Typing then clicking a result `<Link>` within 350 ms fires a post-unmount `liveFetcher.load` — one wasted `/api/search` round trip (a session-pool connection on the cap-15 backend) per occurrence.
- Fix: `useEffect(() => () => window.clearTimeout(debounceRef.current), [])`.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B28: trailing-slash `/search/` stacks the modal over the page (F9 violation)
- Severity: low · blast-radius-rollback · apps/web/app/components/SearchModal.tsx:35,38 vs apps/web/app/routes/search.tsx:686-711
- Provenance: BRRC-2 (blast-radius-rollback)
- Problem: the modal stand-down is string equality `pathname === "/search"`, but the route matches trailing-slash URLs (live: `GET /search/` → 200). On `/search/` both document keydown handlers are active, so `/` or ⌘K opens the Dialog stacked over the inline page input — the exact F9 violation the stand-down exists to prevent (same proxy-vs-source mode as B-U2).
- Fix: normalize (`pathname.replace(/\/+$/,"")==="/search"`) or use `useMatch("/search")` in SearchModal.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B29: recovery-path hotkey deadzone on the errored `/search` boundary
- Severity: low · blast-radius-rollback · apps/web/app/routes/search.tsx:1044-1075 (ErrorBoundary) + SearchModal.tsx:37-38
- Provenance: BRRC-3 (blast-radius-rollback)
- Problem: when the route ErrorBoundary renders on `/search` (e.g. a transient 500), the page's hotkey effect is unmounted AND SearchModal still stands down by pathname, so `/` and ⌘K do nothing on the one page whose own hint says "Press / anywhere". Recovery is the "Start a new search" link only (which does work).
- Fix: stand the modal down only when the live page is mounted (context flag / route-error check), or render the inline input in the ErrorBoundary.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

### B30: collation-continuity harness pins only the scripture leg — the diverging legs (episodes/art/words) are unpinned
- Severity: low · correctness (test-coverage) · packages/scripture/src/__tests__/search-cursor-harness.test.ts:52-76, :109-143
- Provenance: CC-7 (correctness)
- Problem: F1/F15 keyset pins only exercise the scripture leg, whose verse ids are collation-neutral (0/41,995 divergent) — the episodes/art/words legs with mixed-case ref_ids (16/38 tie sets order-divergent for q=faith) are exactly where B1 lives, so the oracle's "C == default live" comment holds only for its own window. The B1 defect ships green.
- Fix: add an episodes-leg F1 continuity pin at a divergent tie (q=israel, limit=8 fixture) — red today, green with the B1 fix.
- Status: FIXED — wf_cdd44017, 2026-07-22 (see RESOLVED note below)

## Rejected (8 noise-tagged findings — carried no further)

- **ACC-2** → noise: silent-drop-of-continuation-intent. Misnamed `cursor=` ignored is web convention; `searchAll` dropping `after` when `scope.length!==1` is the documented contract and the route 400s `cursor_scope` first; `@lumen/scripture` is BRRU-5 verified-isolated. Documented + guarded, no shipped defect.
- **ACC-3** → noise: double-decode future-drift. Bind inputs are byte-identical today (route's trimmed q vs searchAll's `trim().slice(0,200)` are a no-op on q≤200), so the finding admits "unreachable today" — belt-and-braces only.
- **ACC-4** → noise: score full-precision is the ratified CU-5 mechanism (bit-exact float64 is required for the cursor tiebreak); field stays `number`, no in-repo consumer reads `.score`; doc-note-only ask, no code change.
- **UC-9** → noise: sub-2-char modal Enter is a silent no-op — the modal is deliberately "input only" (plan.md:24) and the page's keepTyping state is a different surface by design; a design-preference nit, not a defect.
- **UC-10** → noise: section `<h2>` at `max-w-4xl` vs rows at `max-w-prose` is a self-consistent editorial pattern (full-width rules, reading-width content); unconfirmed alignment preference, no overflow at 320px.
- **OC-7** → noise: claimed B-U1 residual on "More", but the button disables during load (browser blurs the focused element to `body`) and the More-pill/ref-link unmount on nav — no persistently-focused enabled button, so the Space-hijack mode cannot manifest.
- **PC-6** → noise: unmeasured `ResultRow`/`parseMarks` re-render micro-opt; the cost bites only at the 150+-row deep-append tail that ratified PU-6 already dispositioned "revisit only if telemetry" — re-litigates a settled decision with no new measurement.
- **BRRC-5** → noise: `SearchLoaderData.headers` serializes to a `Headers` husk client-side; verified no client consumer reads it and it serializes without error — a latent contract wart / cleanup, not a shipped-quality defect.

**RESOLVED 2026-07-22** — all B1–B30 fixed via wf_cdd44017 (repro-first where unit-testable; live-probe evidence otherwise), verified: scripture 119/119, web 239/239, tsc clean, e2e collation-dupe GONE (q=israel/episodes 16 unique of 16). Deploy pending. B18 client-import repoint deferred (needs package exports-map). Design restraint pass (italics/dividers) folded in.
