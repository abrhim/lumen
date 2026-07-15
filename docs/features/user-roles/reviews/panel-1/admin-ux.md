# Panel-1 review — Admin UX / Data Table / Accessibility

Reviewer: ADMIN-UX + DATA-TABLE + A11Y specialist
Scope: `/admin/users` — search-forward PII data table (plan §"Admin route").
House facts verified: `ui/` has **badge, button, card, select, sheet, skeleton, dialog, dropdown-menu, tooltip, scroll-area, separator, tabs, popover, accordion**. There is **no `ui/table.tsx` and no `ui/input.tsx`** — both must be hand-rolled. Fixed chrome is `fixed right-4 top-4 z-40` (AccountChip + ThemeSelect). Fonts: `font-ui`=Archivo, `font-reading`=Newsreader, `font-display`=Fraunces. Tokens are `--t-*` per `[data-theme]`; `--destructive` has an `ink` override, most semantic tokens do not.

---

### [BLOCKER] No `ui/input.tsx` exists — the "really good search" input must be specced from scratch, and it is the feature's front door

The plan "leads with search" but there is no text-input primitive in the repo (only `SelectTrigger`, which borrows `border-input`). Do not ship a bare `<input>`. Spec a search field that matches the `SelectTrigger` visual language and satisfies Emil forms-controls:

```tsx
// role="search" landmark so SR users jump straight to it
<form role="search" onSubmit={(e) => e.preventDefault()} className="relative">
  <SearchIcon aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
  <input
    ref={inputRef}
    type="search"
    name="q"
    // NB: `type=search` renders a native WebKit clear "x"; we draw our own,
    // so also set appearance-none to suppress the native one on the right.
    autoComplete="off" spellCheck={false} data-1p-ignore
    autoFocus={!isTouchDevice}            // Emil: never autofocus on touch (opens keyboard)
    enterKeyHint="search"
    placeholder="Search users by name or email…"
    aria-label="Search users"
    aria-describedby="user-search-count"
    className="h-10 w-full rounded-lg border border-input bg-panel pl-9 pr-9
               text-base md:text-sm text-ink placeholder:text-faint
               shadow-sm outline-none transition-colors
               focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
               [&::-webkit-search-cancel-button]:appearance-none"
  />
  {q && (
    <button type="button" onClick={clearAndFocus} aria-label="Clear search"
      className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center
                 rounded-md text-faint transition-colors hover:text-ink
                 after:absolute after:-inset-1.5 after:content-['']">  {/* 44px hit box */}
      <XIcon aria-hidden className="size-4" />
    </button>
  )}
</form>
```

Load-bearing details: **`text-base md:text-sm`** — 14px (`text-sm`) triggers iOS Safari zoom-on-focus; render 16px on mobile, drop to 14px at `md`. `h-10` (40px) tall so the field reads as the page's primary action, taller than the `h-7`/`h-8` selects around it. The clear button gets a `after:-inset-1.5` overlay for a 44px hit target (same trick as `ThemeSelect` and `AccountChip`). `pl-9` reserves space for the absolutely-positioned icon (Emil: decorations overlay the field, never sit as siblings).

**Debounce + URL sync (state owner is the URL, per plan §"URL is the state owner"):**

```tsx
const submit = useSubmit();
const onChange = useDebouncedCallback((value: string) => {
  const next = new URLSearchParams(searchParams);
  value ? next.set("q", value) : next.delete("q");
  submit(next, { replace: true, preventScrollReset: true });   // replace → no back-button spam per keystroke
}, 250);
```

`replace: true` is mandatory — without it every debounced keystroke pushes a history entry and the back button walks through partial queries. `preventScrollReset` keeps the user's scroll position as results refine.

---

### [HIGH] Search/empty/searching/no-results states must occupy a reserved region — zero layout shift (Emil core principle #1)

The four states (idle-results, searching, no-results, error) must never change the height of the chrome above the table. Put the **result count + status** in one fixed-height bar directly under the search field, and make it the single `aria-live` region:

```tsx
<div id="user-search-count" role="status" aria-live="polite"
     className="flex h-6 items-center font-ui text-xs text-faint tabular-nums">
  {isSearching ? "Searching…"
   : q ? `${count} ${count === 1 ? "result" : "results"} for “${q}”`
   : `${count} users`}
</div>
```

`h-6` is fixed so the text swapping between "Searching…" and "1,204 users" never nudges the table. `tabular-nums` so the count digits don't reflow as they change (Emil). This element doubles as the **SR announcement** — `aria-live="polite"` reads "Searching…" then the new count, so a keyboard/SR user hears the outcome without touching the table. Do **not** put a spinner that mounts/unmounts inline with the count (causes shift); if you want a spinner, absolutely-position it inside the search field's right padding and cross-fade with the clear button.

**Searching affordance without shift:** while `navigation.state !== "idle"` for the `?q` submit, apply `aria-busy` + a subtle `opacity-60 transition-opacity` to the *results region only* (not the whole page), and keep the previous results rendered underneath (stale-while-revalidating) so the table doesn't collapse to empty and jump back.

**No-results state** occupies the same vertical space a few rows would, so the page doesn't jump when results return:

```tsx
<div className="flex min-h-40 flex-col items-center justify-center gap-1 text-center">
  <p className="font-display text-lg text-ink">No users match “{q}”.</p>
  <p className="font-ui text-sm text-muted-foreground">Try a different name, email, or clear your filters.</p>
  {hasActiveFilters && <button onClick={clearFilters} className="mt-2 …">Clear filters</button>}
</div>
```

---

### [HIGH] Filters compose with search as AND, with visible removable chips

Filters (role, status) are `<Select>` primitives (the house `select.tsx` — reuse it, `size="sm"`), URL-synced to `?role=` / `?status=`. Semantics are **AND**: `q` AND role AND status all narrow. Surface the active constraint set as removable chips so the user always knows *why* the result set is small (findability — the thing infinite scroll otherwise erodes):

```tsx
{activeFilters.length > 0 && (
  <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
    {activeFilters.map((f) => (
      <li key={f.key}>
        <Badge variant="outline" className="gap-1 pr-1">
          <span className="text-faint">{f.label}:</span> {f.value}
          <button onClick={() => removeFilter(f.key)} aria-label={`Remove ${f.label} filter`}
            className="ml-0.5 flex size-4 items-center justify-center rounded-full hover:bg-muted
                       after:absolute after:-inset-2 after:content-['']">
            <XIcon className="size-3" aria-hidden />
          </button>
        </Badge>
      </li>
    ))}
    {activeFilters.length > 1 && (
      <li><button onClick={clearAll} className="px-1.5 font-ui text-xs text-muted-foreground hover:text-ink">Clear all</button></li>
    )}
  </ul>
)}
```

Chip removal patches the URL (removes that param), which re-runs the loader. Chips live in the same fixed row area; when there are none, the row is absent — that's fine because it sits *below* the count bar and *above* the table, and the table has no fixed offset that a growing chip row would break (chips wrap, they don't overlay).

---

### [BLOCKER] Table semantics: use a **real `<table>`**, not a div-grid — and it coexists with infinite scroll fine

The plan and Emil both push toward "just use divs for flexibility," but for a **sortable, PII, SR-critical admin surface** a real `<table>` with `<caption>`, `<thead>`, `<th scope="col" aria-sort>`, `<tbody>` gives native row/column semantics, `aria-sort` support, and correct SR table-navigation (read cell headers per cell) for free. Infinite scroll does **not** require a div-grid — you append `<tr>`s to the same `<tbody>`; `aria-rowcount` is not needed because rows are progressively loaded, not virtually windowed. Reserve the div-grid pattern for the mobile card layout (below), not the desktop table.

Column spec (desktop, `md:` and up):

| Column | Content | Header | Notes |
|---|---|---|---|
| User | avatar-initial circle + `display_name`/`full_name` (bold) over `email` (muted) | "User" (sortable → email) | Two-line cell; the whole cell is the primary column |
| Roles | `<Badge>` per role | "Roles" (not sortable) | `admin` → `variant="default"`; others → `variant="secondary"` |
| Status | confirmed / banned / anonymous badge | "Status" (filter, not sort) | banned → `variant="destructive"`; see token note |
| Joined | `created_at` as `7 Jul 2026` | "Joined" (sortable) | **`tabular-nums`**, `<time dateTime>` |
| Last seen | `last_sign_in_at` relative (`3d ago`) + title=absolute | "Last seen" (sortable, default DESC) | `tabular-nums`; "—" when null |

Sticky header + sortable button markup:

```tsx
<table className="w-full border-collapse font-ui text-sm">
  <caption className="sr-only">All users. Use column headers to sort.</caption>
  <thead className="sticky top-0 z-30 bg-panel/95 backdrop-blur">   {/* z-30 < z-40 chrome */}
    <tr className="border-b border-rule2 text-left align-middle">
      <th scope="col" aria-sort={sortKey === "email" ? (dir === "asc" ? "ascending" : "descending") : "none"}
          className="h-9 px-3 font-semibold text-faint">
        <button type="button" onClick={() => toggleSort("email")}
          className="group inline-flex items-center gap-1 rounded outline-none
                     focus-visible:ring-2 focus-visible:ring-ring/50
                     after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-['']">  {/* 44px header hit */}
          User
          <SortGlyph active={sortKey === "email"} dir={dir} />  {/* ↑ / ↓ / faint ↕ */}
        </button>
      </th>
      {/* Roles / Status headers are plain <th> (no button) */}
    </tr>
  </thead>
  <tbody>{rows.map(renderRow)}</tbody>
</table>
```

**Sticky-header placement is the sharp edge:** the fixed chrome is `top-4 right-4 z-40`. A `sticky top-0 z-30` `<thead>` slides *under* that chrome (good — z-30 < z-40), but the chrome floats over the table's top-right corner. So the **page container needs top padding** (`pt-16` or more) so the search field and the "Joined/Last seen" header labels are never physically under the AccountChip/ThemeSelect cluster. Sticky offset stays `top-0` because the chrome is `position: fixed` (out of flow) — the thead sticks to the viewport top and the chrome overlays a harmless empty corner above it. Use `bg-panel/95 backdrop-blur` + `border-b border-rule2` for the sticky separation rather than a drop shadow (see ink note).

**Row density vs 44px touch:** dense rows (`h-9`/36px) fail touch. Use **`h-14` (56px) rows** — comfortably ≥44px, and the two-line User cell needs the height anyway. The row's primary action (open user — but v1 is read-only, so the row is *not* a link; see below) — since v1 has no per-user page (out of scope), rows are **not** interactive; only the email could be a `mailto:`/copy affordance. Keep rows non-interactive to avoid a 56px phantom target that goes nowhere. `tabular-nums` on the Joined/Last-seen cells so date columns don't reflow between rows.

---

### [HIGH] Infinite scroll: sentinel + skeleton + explicit end + error/retry — and a "Load more" button IS the sentinel

Emil warns infinite scroll harms findability and back-button behavior; the plan keeps it (Abram's call). Mitigate rather than remove:

1. **Sentinel is a real `<button>`, observed.** Render a "Load more" button at the list tail and attach the `IntersectionObserver` to *it*. When it scrolls into view, auto-click/fetch; when JS/observer is unavailable or a keyboard user tabs to it, it still works. This single element solves three problems: auto-load, keyboard access, and focus-not-lost (see A11y).

```tsx
<tr><td colSpan={5} className="p-0">
  <button ref={sentinelRef} onClick={loadMore} disabled={fetcher.state !== "idle"}
    className="flex h-12 w-full items-center justify-center font-ui text-xs font-semibold text-muted-foreground hover:text-ink disabled:opacity-60">
    {fetcher.state !== "idle" ? "Loading…" : "Load more"}
  </button>
</td></tr>
```

2. **Skeleton rows match real row height exactly (zero CLS).** While a page fetches, render N skeleton `<tr>` at `h-14` using the house `<Skeleton>`:

```tsx
<tr className="h-14 border-b border-rule"><td className="px-3"><div className="flex items-center gap-3">
  <Skeleton className="size-8 rounded-full" />
  <div className="space-y-1.5"><Skeleton className="h-3 w-32" /><Skeleton className="h-2.5 w-40" /></div>
</div></td>…</tr>
```

3. **Explicit end-of-results state** — not silence: `<tr><td colSpan={5} className="py-6 text-center font-ui text-xs text-faint">End of results · {total} users</td></tr>`.

4. **Error/retry** when a page fetch fails (Emil: feedback must be visible, not hidden): replace the sentinel with `Couldn't load more. [Retry]` using `variant="ghost"` button; do not silently stall.

5. **Back-button mitigation:** the plan makes the cursor "fetcher-local," which means returning to the page via back-button loses all appended pages and scroll position. Mitigate by keeping page state recoverable — either (a) reset to page-1 on return (acceptable for an admin tool; the URL `?q/&sort` restores the *query*, just not the scroll depth), or (b) persist the loaded-page count in `sessionStorage` keyed by the URL. Recommend (a) for v1 simplicity and call it out explicitly. The always-visible result **count** (from the count bar) is the primary findability anchor Emil asks for.

---

### [MEDIUM] Virtualization is premature — do not add `@tanstack/react-virtual` in v1

Emil's performance.md pushes windowing for "hundreds of DOM nodes," but the realistic user count here is **0 today, single-user app** (plan probe: "0 users today"). A `<table>` with even a few thousand simple `<tr>` renders fine; infinite scroll already bounds how many are in the DOM at once (user has to scroll to grow it). Windowing a `<table>` also fights sticky headers and native table semantics (you'd need absolute-positioned rows, breaking the `<tbody>` model and the a11y win above). **Position: skip virtualization.** Add a single tripwire comment at the `<tbody>`: revisit windowing only if a single loaded session realistically exceeds ~2,000 rows in the DOM — until then it's complexity with no user. This is the correct application of Emil's rule (which is about *hundreds visible*, not *hundreds total loaded progressively*).

---

### [HIGH] Mobile: collapse the PII table to stacked cards — no horizontal scroll of names/emails

A 5-column PII table on a phone must **not** horizontally scroll (dragging a partly-visible email is miserable and leaks PII off-screen). Render the semantic `<table>` at `md:` and up; below `md`, render the same rows as stacked cards using the house `<Card>` idiom (`rounded-lg border border-rule2 bg-surface p-3`, matching `word.tsx` occurrence rows):

```tsx
<ul className="space-y-2 md:hidden">
  {rows.map((u) => (
    <li key={u.id} className="rounded-lg border border-rule2 bg-surface p-3">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-rule2 bg-panel2 font-ui text-xs font-semibold uppercase text-ink">{initial(u)}</span>
        <div className="min-w-0"><p className="truncate font-ui text-sm font-semibold text-ink">{name(u)}</p>
          <p className="truncate font-ui text-xs text-muted-foreground">{u.email}</p></div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">{u.roles.map((r) => <Badge …/>)}</div>
      <dl className="mt-2 flex gap-4 font-ui text-xs text-faint tabular-nums">
        <div><dt className="inline">Joined </dt><dd className="inline text-muted-foreground">{joined}</dd></div>
        <div><dt className="inline">Seen </dt><dd className="inline text-muted-foreground">{seen}</dd></div>
      </dl>
    </li>
  ))}
</ul>
<table className="hidden w-full md:table …">…</table>
```

**Sort/filter controls adapt:** on mobile, replace the sortable column headers (which don't exist in card mode) with a **sort `<Select>`** ("Sort: Last seen ↓") — the house `select.tsx`, `size="sm"`. Put filters behind the existing bottom **`<Sheet side="bottom">`** ("Filters" button opens it) — the same primitive `scripture.tsx` already uses; it portals to `<body>` and stacks correctly. Search stays inline and full-width at top. This keeps a single source of truth: both the `<Select>` and the desktop header buttons write the same `?sort=&dir=` URL params.

---

### [MEDIUM] Tone: stay in the paper voice but shift *register* to functional — don't invent a second design system

An admin table is utilitarian inside a contemplative app. The right move is not a visually foreign "dashboard" skin; it's the **same tokens, denser register**: use `font-ui` (Archivo) throughout (not `font-reading`/`font-display` except the page `<h1>`), tighter spacing, `tabular-nums`, `text-sm`. Keep the paper surfaces (`bg-panel`, `border-rule2`), the one restrained accent, and the `uppercase tracking` section-label idiom from `home.tsx`/`word.tsx` for the page header. The result reads as "the same app, doing work" — editorial restraint, functional density. A contemplative reader will essentially never see this route (it's hidden + gated), so err toward efficiency, but do it *with* the house tokens, not against them.

Page header, matching house idiom:
```tsx
<p className="font-ui text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">
  <Link to="/" className="hover:text-ink">Lumen</Link> · Admin</p>
<h1 className="mt-2 font-display text-3xl font-medium tracking-tight">Users</h1>
```

---

### [HIGH] Per-theme correctness + token gaps (the `--destructive`-only-in-base lesson repeats)

Checked against the four themes in `app.css`:

- **Badges — roles:** `admin` → `variant="default"` (`bg-primary`) reads correctly in all four (primary is defined per-theme, incl. the lighter `#a9bcf0` in `ink`). Other roles → `variant="secondary"` (`bg-secondary`/`--muted` per theme) — fine.
- **Badge — banned:** `variant="destructive"` works because `--destructive` has an `ink` override (`#f0908a`, the fix from last feature). Good — reuse it, don't hand-roll red.
- **TOKEN GAP — status "confirmed"/"active" has no semantic green.** There is no `--success`/`--positive` token; the only green is `--t-people` (`#2f6f5e` light / `#7fc0aa` ink), which is *semantically "person"*, not "success." **Do not** repurpose `--t-people` for status — that couples two meanings and will break if either moves. Recommendation: render "confirmed" as a **neutral `variant="outline"`** badge (no color needed — confirmed is the default/expected state; only *exceptional* states like banned/anonymous need color). This sidesteps the gap entirely. If a positive color is later wanted, add `--t-ok` to **all four** `:root` blocks (the base-only `--destructive` mistake was exactly this — a token defined once, wrong on `ink`).
- **TOKEN GAP — "anonymous"/pending has no amber.** Same treatment: `variant="secondary"` or `outline` with `text-muted-foreground`. Don't reach for `--t-selbar` (that's the selection accent).
- **Sticky-header shadow on `ink`:** drop shadows are near-invisible on the `#17181c` dark canvas — a `shadow-md` under the thead does nothing in `ink`. **Use `border-b border-rule2` + `bg-panel/95 backdrop-blur`** for the sticky separation (reads in all four themes), not a shadow. `--t-rule2` is defined per-theme (`#43464e` in ink) so the border is visible dark and light.
- **Avatar-initial circle:** `border-rule2 bg-panel2` — both per-theme, reads in ink. Good.

Net: no new tokens are strictly required if "confirmed/anonymous" use `outline`/`secondary`. If Abram wants colored positive status, that's a **4-theme token addition**, flagged here so it isn't done base-only again.

---

### [HIGH] A11y wrap-up — semantics, live regions, focus retention, tab order

- **Real `<table>`** (per BLOCKER above) — native row/col semantics; `<th scope="col">`, `aria-sort` on the sorted column only (`"none"` on the rest), sortable header is a `<button>` (not a click-`<th>` — Emil forms-controls: click handlers only on `<button>`).
- **Two live regions, both `polite`:** (1) the result-count bar announces "N users" / "Searching…" on query change; (2) an `aria-live="polite" className="sr-only"` region announces "Loaded 25 more, 75 shown" after each infinite-scroll page so SR users know rows arrived. Don't make the whole `<tbody>` a live region (it would re-read every row).
- **Focus is not lost on append** because new `<tr>`s are inserted *before* the persistent "Load more" `<button>`, which keeps DOM identity and thus keeps focus. A keyboard user who activated "Load more" stays focused on it as rows appear above — then Tab continues into the new rows. This is the concrete reason the sentinel must be a real button, not a bare `<div>` observer.
- **Tab order:** search input → clear button (only when present) → filter selects → (mobile: sort select) → sortable column header buttons (left→right) → row content (email copy/mailto if any) → "Load more". No positive `tabIndex`; rely on DOM order (matches the visual order above).
- **Reduced motion:** skeleton `animate-pulse` and any results fade must respect `motion-reduce:` — the house already gates motion (`motion-safe:` in `scripture.tsx`). Gate the searching-opacity transition and skeleton pulse with `motion-safe:`.
- **`touch-action: manipulation`** on the header sort buttons and Load-more (prevents double-tap zoom on repeated sorting).

---

### [MEDIUM] Admin entry point lives in the AccountChip dropdown, gated on entitlements — needs a root-loader change

The entry belongs in the existing `AccountChip` dropdown in `root.tsx` (the only signed-in surface), shown **only** to admins. This depends on plan **O2**: the root loader currently returns just `{ user }` — it must also expose `entitlements` so the chip can conditionally render the link. (This is the O2 tradeoff: one extra indexed query per signed-in request. Given `getClaims` is local, this becomes the root loader's only DB hit — acceptable for a single-user app, but flag it as the COR-2 cost.) Markup, inserted above the sign-out separator:

```tsx
{root?.entitlements?.includes("admin.users") && (
  <>
    <DropdownMenuItem asChild>
      <Link to="/admin/users" className="w-full cursor-pointer">Users</Link>
    </DropdownMenuItem>
    <DropdownMenuSeparator />
  </>
)}
```

Copy: label it **"Users"** under an implicit admin grouping, or **"All users"** if standalone — plain and unadorned. Do **not** label it "Admin Panel" or add a shield icon; the contemplative app shouldn't announce a privileged area loudly. Optionally precede it with a muted `DropdownMenuLabel` "Admin" for grouping. Keep the entitlement gate client-*and*-server: the chip hiding is cosmetic; the route's `requireEntitlement` 404 (plan O5) is the real boundary — the hidden link must never be the only thing standing between a non-admin and the data.

---

## Verdict

**Infinite scroll vs alternatives:** Keep infinite scroll (Abram's call) but implement it as an **auto-loading "Load more" button** — the sentinel *is* a real `<button>` that an `IntersectionObserver` auto-triggers. This is the single design decision that resolves Emil's three objections at once: keyboard users and SR users get a real control (a11y), focus is retained on append (the button keeps DOM identity), and the always-visible **result count** restores the findability that pure infinite scroll destroys. Back-button scroll-depth is the one unrecoverable loss with a fetcher-local cursor; accept resetting to page-1 on return for v1 (the URL restores the *query*, which is what matters for an admin re-visiting a search) and note it explicitly rather than pretending scroll is preserved. Do **not** switch to numbered pagination — with keyset cursors (plan §"keyset") there are no stable page numbers, and offset pagination was correctly rejected. Do **not** add virtualization — premature at 0 users; windowing would fight the sticky-header/`<table>` a11y model for no benefit until ~2k+ loaded rows.

**Table semantics:** Use a **real semantic `<table>`** (`<caption>`/`<thead>`/`<th scope aria-sort>`/`<tbody>`) for desktop, collapsing to **stacked `<Card>`-style list items below `md`**. Reject the div-grid: on a sortable PII surface the native table role/`aria-sort`/cell-header semantics are worth more than div flexibility, and infinite scroll appends `<tr>`s cleanly without needing windowing. The div/card pattern is reserved for the mobile layout, where there are no columns to preserve.

**Two structural prerequisites this feature can't ship without:** (1) a hand-rolled **search `input`** (no `ui/input.tsx` exists) and a hand-rolled **`<table>`** (no `ui/table.tsx` exists) — both specced above; (2) **`entitlements` surfaced from the root loader** (O2) so the AccountChip can gate the admin link. Status colors need **no new tokens** if confirmed/anonymous use `outline`/`secondary` badges; a colored positive status would require a **4-theme** `--t-ok` addition — flagged here to avoid repeating the base-only `--destructive` mistake.
