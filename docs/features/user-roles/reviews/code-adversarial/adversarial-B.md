# code-adversarial — ADVERSARIAL-B

Axis: client-side data-flow of `apps/web/app/routes/admin.users.tsx` as a hostile-conditions machine (slow network, rapid filter flips, back/forward, fetcher failure, focus/SR, mobile-vs-desktop sort state). Defensive verification only — traced code paths and ran the existing harnesses; no exploit PoCs.

Verified before writing: `pnpm vitest run` on all four user-roles/auth test files — 63/63 green. react-router 7.9.6; root `ErrorBoundary` at `apps/web/app/root.tsx:182`; `useNavigation` is not imported anywhere in the route.

## Job 1 — tag table (ux-a11y panel findings)

The findings list handed to this reviewer was empty (`[]`). Nothing to tag.

| id | tag | rationale |
|----|-----|-----------|
| — | — | no panel findings were supplied |

## Job 2 — extra findings (ADVB-1..9)

### ADVB-1 (high) — D6 epoch race guard is defeated by retained `fetcher.data`: flip a filter away and back and a stale deep page appends after the reset, silently skipping rows

`apps/web/app/routes/admin.users.tsx:160-169` (append effect), `:154-156` (reset effect); epoch minted at `apps/web/app/lib/admin-users.server.ts:132`.

The epoch is the serialized *filter set* `[q, role, status, sort, dir]` — it is filter identity, not pagination-session identity — and `fetcher.data` persists across same-route navigations (the component never unmounts). Trace: under epoch A, auto-load pages 2 and 3 (`fetcher.data` = page-3 result, `epoch: A`). Navigate to epoch B (append effect correctly skips: `fetched.epoch !== epoch`). Navigate back to A — the two epoch strings are byte-identical. On that render the reset effect fires first (`extra` = page-1 tail, `rows: []`, `cursor` = c2), then the append effect re-runs because its `epoch` dep changed, sees the *retained* page-3 data with a matching epoch, and appends it. Rendered list = page 1 + page 3; page 2's 25 users are silently absent; `extra.cursor` jumps to page-4's cursor so subsequent auto-loads continue past the gap. No slow network needed — two clicks on the "Joined" header reproduce it (`toggleSort` desc→asc→desc restores the identical epoch, `:233-239`), as does removing and re-adding a filter chip. A slow-network variant exists too: a same-epoch revalidation (e.g. a debounced re-submit of identical params) resets the tail while a deep cursor-N fetch is in flight; when it lands, epoch matches and page 1 + page N render with pages 2..N-1 gone.

This defeats the stated purpose of D6's guard ("a stale in-flight page for an abandoned filter set is dropped", `:158-159`; plan.md D6) and violates the end-to-end no-skips property H4 protects at the SQL layer. An admin can conclude a user doesn't exist while scanning a list with a silent 25-row hole.

Fix: gate appends on a per-generation request marker, not epoch alone. `const requestedRef = useRef<string | null>(null)`; `loadMore` sets `requestedRef.current = extra.cursor` before `fetcher.load`; the reset effect nulls it; the append effect early-returns when `requestedRef.current === null` and nulls it after consuming. Retained or cross-generation `fetcher.data` is then never re-consumed.

### ADVB-2 (high) — a single failed `fetcher.load` during background auto-scroll replaces the entire admin view with the root "Oops!" page

`apps/web/app/routes/admin.users.tsx:141` (fetcher), `:29-33` (deliberately no route ErrorBoundary), `:192-197` (IO auto-clicks the sentinel); root boundary `apps/web/app/root.tsx:182-208`.

Answering the axis question "can auto-load stall permanently after a failed fetcher load?": it does not stall — it detonates. In react-router 7, an error thrown from a fetcher's loader (transient network failure, a 500, or the gate's 404 after mid-session role revocation/session expiry — `entitlements.server.ts:75-77`) bubbles to the nearest route ErrorBoundary; this route deliberately has none, so it lands at root. Because the IntersectionObserver auto-fires `loadMore` as the sentinel nears the viewport, a Wi-Fi blip while the admin is merely scrolling replaces their search text, active filters, accumulated pages, and scroll position with "Oops! / An unexpected error occurred." — zero user action, no retry affordance, no way back except a full reload. The no-boundary choice was made for D10 (gate 404 must render identically to no-route), but it silently extended a concealment decision about *navigations* to *background pagination failures*.

Fix: add a route ErrorBoundary that renders the root 404 markup byte-identically for `isRouteErrorResponse && status === 404` (preserving D10's concealment) and an inline "Couldn't load — reload" state otherwise. Document in the D10 comment that the boundary must stay visually identical to root's 404.

### ADVB-3 (high) — search/filter/sort loading feedback never engages: `loading` only watches the fetcher, but every URL change is a navigation — the plan's SWR spec (aria-busy + dim) and D9's "Searching…" announcement are dead for the primary path

`apps/web/app/routes/admin.users.tsx:173` (`loading = fetcher.state !== "idle"`), `:211` (all param changes go through `useSubmit` → navigation), `:318` ("Searching…" branch), `:395` (aria-busy + opacity), `:489` (skeleton rows).

`useNavigation` is never consulted, and the fetcher only ever runs for load-more. So during a slow search/filter/sort navigation: no dimming, no `aria-busy`, no skeletons, and the single live region keeps announcing the *old* query's count. The `"Searching…"` branch at `:318` is unreachable code: it requires `loading && rows.length === 0`, but a fetcher load requires `extra.cursor`, which implies a full page-1 already rendered (`rows.length >= 25`). This is the plan's incorporated HIGH admin-ux finding — "searching keeps stale results rendered (aria-busy + opacity on the results region only)" (plan.md:93) — shipped in name only: the stale rows stay (default router behavior) but every signal that a search is in flight is absent. On slow networks the page reads as frozen/broken after typing; SR users get no busy state and no searching announcement (D9's live region exists precisely for this).

Fix: `const navigation = useNavigation()`; `const navigating = navigation.state === "loading" && navigation.location != null` (optionally scoped to this pathname); fold it into `loading` for aria-busy/dim, and drive "Searching…" from `navigating` rather than the unreachable fetcher condition.

### ADVB-4 (med) — rapid interactions on a slow network lose updates: `submitParams`/`loadMore` build URLs from the committed location, so a second change made while the first navigation is pending silently drops the first

`apps/web/app/routes/admin.users.tsx:177` and `:208` (`new URLSearchParams(searchParams)`).

`useSearchParams` reflects the *committed* location; during a pending GET navigation it still returns the old URL. Trace: pick Role=editor (navigation pending, slow), then pick Status=banned before it settles — the second `setParam` starts from the old params (no `role`) and its navigation supersedes the first: final URL is `?status=banned`, and the Role select (controlled from loaderData) visibly snaps back to "All roles" after the user watched themselves set it. Same root cause drops a pending `q` from the URL when a filter is clicked mid-debounce (the debounce timer is cleared at `:212`, so the typed text stays in the input but never reaches the URL — input and results disagree until the next keystroke).

Fix: base param edits on the pending location when one exists: `const location = useLocation(); const navigation = useNavigation(); const base = navigation.location?.search ?? location.search`.

### ADVB-5 (med) — `disabled={loading}` on the Load-more button steals keyboard/SR focus to `<body>` the moment it is activated; the code comment claims the opposite

`apps/web/app/routes/admin.users.tsx:525` (`disabled={loading}`), `:183-185` (comment: "focus survives appends … its DOM identity persists"), `:176` (idle guard).

Disabling the currently-focused element drops focus to the document in every engine. A keyboard user who tabs to "Load more" and presses Enter loses their place; next Tab restarts from the top of the page — above 25+ rows of table. DOM identity persisting is irrelevant while `disabled` toggles. The `disabled` attribute is also redundant as a re-entrancy guard: `loadMore` already early-returns when the fetcher is busy (`:176`), and rapid double-activation is safe anyway (a second `fetcher.load` on the same key aborts the first; same cursor → one page, no dupes — verified against the append path). Related: when the final page arrives, the button unmounts entirely in favor of the end-state `<p>` (`:520-536`) — focus drops to body again with no management.

Fix: replace `disabled` with `aria-disabled={loading || undefined}` (the guard already enforces it) and, on cursor exhaustion, move focus to the end-of-results message (`tabIndex={-1}` + ref focus).

### ADVB-6 (med) — the `qInput` sync effect reverts in-progress typing when an earlier query's navigation completes inside the 250ms debounce window

`apps/web/app/routes/admin.users.tsx:205` (`useEffect(() => setQInput(q), [q])`).

Timeline on a slow-ish network: type "jo" → debounce submits; keep typing to "john" (next timer pending); the "jo" navigation completes → `q` changes `""`→`"jo"` → the effect stomps the visible input back to "jo" mid-composition. The pending timer then re-submits the captured "john" and the text snaps forward again — but any keystrokes landed during the revert window edit the wrong string (user typing " smith" produces "jo smith" → submitted). Caret jumps + corrupted composition under exactly the latency this route will see (the trailing-space case is safe only because server-side trim makes `q` strictly equal and the effect skips).

Fix: sync from `q` only when the field is not focused (`document.activeElement !== inputRef.current`) or when no debounce is pending; the URL-driven cases that need the sync (back/forward, chip-driven clears) leave the field unfocused.

### ADVB-7 (med) — every param change navigates with `replace: true`, so the back button never traverses search/filter/sort states — the plan's "back-button correct" claim (D6, plan.md:35) does not hold

`apps/web/app/routes/admin.users.tsx:211` (single `go` closure used by both the debounced and the `immediate` path).

Replace is right for per-keystroke search (the stated rationale, `:202-203`), but sort toggles, filter selects, and chip removals are discrete user actions and also replace. Result: apply a role filter, a status filter, and a sort, then press Back — you leave `/admin/users` entirely instead of unwinding one step. Plan.md line 35 ("URL is the state owner … back-button correct") and D6 ("back-button-correct") state the opposite of the shipped behavior.

Fix: pass `replace: !immediate` (debounced search replaces; discrete actions push).

### ADVB-8 (low) — a pending debounce timer survives back/forward navigation and hijacks it: press Back within 250ms of a keystroke and the abandoned query re-submits over the entry you navigated to

`apps/web/app/routes/admin.users.tsx:218-223` (cleanup is unmount-only, correctly so for keystrokes — but nothing clears the timer on a POP navigation), `:211` (`replace: true` makes the hijack overwrite the restored entry).

Back/forward within the same route keeps the component mounted, so the timer fires post-POP with params captured from the pre-POP location and yanks the user forward again. Narrow (250ms) but reachable with the browser back gesture right after typing.

Fix: clear the pending timer when `location.key` changes (small effect keyed on it), keeping the unmount-only cleanup for the keystroke case.

### ADVB-9 (low) — the mobile sort Select can neither display nor change direction, and its labels can misrepresent the URL state set on desktop

`apps/web/app/routes/admin.users.tsx:356-369` (value={sort}, no dir), `:546-555` (`toggleSortTo` always resets to the natural default; `_dir` param is dead).

Radix Select fires no `onValueChange` when re-selecting the current value, so a mobile user has no path to email Z→A or dates oldest-first — and given `?sort=email&dir=desc` from a shared desktop link or back-nav, the trigger reads "Sort: Email" (implying the A→Z default) while the URL says the opposite. Not a state-divergence writer (the two controls' defaults for a *new* column agree), but the two surfaces disagree about what the current URL state *is*.

Fix: encode direction into the options (`value={`${sort}-${dir}`}`, six entries: "Joined · newest", "Joined · oldest", …) and drop the dead `_dir` parameter.

## Verified-clean on this axis (checked, no finding)

- Stale-epoch in-flight appends for a *different* filter set are correctly dropped (`:163`), including the IO-fires-during-pending-navigation case (loadMore builds from the old committed params → old epoch → dropped on arrival).
- Double-activation of Load more (pointer or IO + click in one tick): both calls see `idle`, but the second `fetcher.load` aborts the first on the same fetcher key — one page, no duplicate rows.
- SR announcement of appended rows: the D9 single live region does announce appends ("N users · M shown" text change is a polite update); page-1 counts always present because the cursor never enters the URL.
- IO + early-return interplay self-heals: a callback swallowed while the fetcher is busy is re-armed when `extra.cursor` changes (`:189-200` re-observes) — no silent stall in the success path (the failure path is ADVB-2).
- Hand-crafted `?cursor=` URLs degrade safely (H4b server-side; client renders `count = rows.length`, empty roles catalog handled at `:332`).

## Stance

The server side of this feature is in good shape — the gate, keyset, cursor, and escaping harnesses all pass and the SQL shapes match the decisions. The client of admin.users.tsx is where the adversarial weather lands: the D6 epoch guard is necessary but not sufficient (ADVB-1 puts a deterministic 25-row hole in the list with two header clicks), background pagination failure escalates to a full-page wipe (ADVB-2), and the plan's own loading-feedback spec is dead code because `loading` watches the wrong state machine (ADVB-3). None of these require an attacker — just latency, a filter flip, or a dropped packet. All are small, local fixes; none touch the authz boundary. Ship after ADVB-1..3; 4-7 are worth taking in the same pass; 8-9 at leisure.
