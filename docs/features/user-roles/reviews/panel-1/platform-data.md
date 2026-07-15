# Panel-1 review — Platform + Data-Loading (RR7.9.6 / Cloudflare Workers / Hyperdrive)

Reviewer: platform + data-loading specialist. Scope: O2 (role load site), keyset infinite
scroll wiring, cursor encoding, per-request db discipline, resource-vs-UI route, search
debounce/URL-sync, route-module shape + 404 mechanism.

House facts established by reading the code (cited inline):
- `context.db` is created **once per request** in `workers/app.ts:fetch` and shared by every
  loader/action in that request; closed via `ctx.waitUntil(end())`. postgres.js connects
  **lazily**, so constructing the client is free — the cost is the first actual query round
  trip. (`workers/app.ts`, `db.server.ts`)
- Root loader today does **zero DB round trips**: `getSessionUser` is local ES256 `getClaims`
  against cached JWKS. (`auth.server.ts:95`, `root.tsx:46`)
- Single Fetch is the RR7 default (no future flag needed). **All loaders revalidate on every
  client navigation** unless a route exports `shouldRevalidate`. No route in this app currently
  exports one, and **nothing** in the app uses `useFetcher`/`useSearchParams`/`useSubmit` yet —
  this route establishes the pattern. (grep: zero hits.)
- House query style: `db.execute(sql\`…\`)` tagged templates with bound params, `lumen.`-schema
  qualified, keyset already used in `getPassage` via row-comparison `(c.number, v.verse_number) >= (...)`.
  (`packages/scripture/src/queries.ts:69`)

---

### [HIGH] O2 — Do NOT add the roles query to the root loader unconditionally. Gate the Admin link on a claim/cookie; load roles only in the admin loader.

**Evidence / cost.** Because Single Fetch revalidates the root loader on **every** client
navigation (confirmed: RR7 default; a signed-in user browsing chapter→chapter→word re-runs
`root.loader` each time), folding a roles query into `getSessionUser` converts the root loader
from **0 round trips → 1 Hyperdrive round trip per navigation for every signed-in user**, on the
critical path, blocking the whole single-fetch response (root is a parent of everything).
That is exactly what COR-2 ("keep the root loader cheap") forbids. And it buys almost nothing:
the roles are needed on-screen only to decide whether to render one "Admin" menu item.

The naive mitigation — `export function shouldRevalidate(){return false}` on root — is **wrong
here**: root must keep revalidating so token rotation cookies (`getSessionUser` D5 invariant) and
sign-in/out state stay live. You cannot cheaply opt the root loader out of revalidation without
breaking auth. So the roles query, if placed in root, genuinely runs every navigation.

**Recommendation (concrete).** Two-tier, fail-closed:

1. **Authority (server, per-route):** `requireEntitlement(auth, "admin.users")` runs **only in
   `admin.users.loader`**, doing the real roles→entitlements query there. This is the security
   boundary; the menu link is just a hint. A forged hint costs nothing because the loader
   re-checks. Cost: the roles round trip happens **only when an admin actually visits
   `/admin/users`**, not on every navigation.

2. **Hint (for the menu link):** stamp an `is_admin` (or `ent` list) claim into the JWT
   `app_metadata` at grant time so `getClaims` — still **zero network** — exposes it. The
   `grant-role.mjs` script already touches `auth.users`; have it also set
   `app_metadata.entitlements`. Then `getSessionUser` reads `data.claims.app_metadata?.entitlements`
   locally and root exposes a boolean with **no new round trip**. If you do not want to couple to
   the JWT, the fallback is a tiny signed cookie set on the admin loader's first success; but the
   JWT claim is cleaner and survives across devices.

   Caveat to note for the panel: a JWT claim is only as fresh as the token (staleness until next
   refresh). That is acceptable because the claim only shows/hides a link — the **loader** is
   authoritative and fail-closed, so a stale "true" claim just shows a link that then 404s, and a
   stale "false" claim hides a link the user can still reach by URL.

**Reject** the KV short-TTL user→roles cache for v1: it adds an eventual-consistency window on an
authorization signal, a cache-invalidation burden on grant/revoke, and Workers KV read latency —
all to save a round trip that, with option (1), already only happens on the admin route. Revisit
only if non-admin entitlements later need to be read on the hot path.

---

### [HIGH] Keyset infinite scroll — exact wiring, and the filter/fetcher race guard.

The dangerous bug (called out in the brief): a filter change + an in-flight cursor fetcher race,
appending mixed-filter rows. The guard is an **epoch key derived from the URL filter state**;
every fetcher load carries the epoch it was launched under, and results whose epoch ≠ the current
URL epoch are dropped.

**State ownership.**
- **URL owns** `?q=&role=&status=&sort=&dir=` (shareable, back-button correct — plan §Admin route).
- **Loader owns** page 1: `admin.users.loader` reads the URL params, returns `{ rows, nextCursor }`.
- **Fetcher owns** the cursor and the accumulated tail (pages 2..N), in component state.
- The **filter epoch** = a stable serialization of the URL filter params (NOT including cursor).

**Wiring (component sketch).**

```tsx
export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  // epoch = everything that defines the result SET (order matters → build deterministically)
  const epoch = useMemo(() => {
    const p = new URLSearchParams(searchParams);
    p.delete("cursor");
    p.sort();
    return p.toString();
  }, [searchParams]);

  const fetcher = useFetcher<typeof loader>();

  // Accumulated pages 2..N, plus the epoch they belong to.
  const [extra, setExtra] = useState<{ epoch: string; rows: Row[]; cursor: string | null }>(
    { epoch, rows: [], cursor: loaderData.nextCursor },
  );

  // RESET when the URL filter set changes: loaderData is the new page 1 for the new epoch.
  // Keyed on epoch, and on loaderData identity so a revalidation of the SAME epoch also resets.
  useEffect(() => {
    setExtra({ epoch, rows: [], cursor: loaderData.nextCursor });
  }, [epoch, loaderData]);

  // Append fetcher results — but ONLY if they belong to the current epoch (race guard).
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const fetched = fetcher.data;                 // { rows, nextCursor, epoch }
    if (fetched.epoch !== epoch) return;          // ← stale, mixed-filter result: DROP
    setExtra((prev) =>
      prev.epoch !== epoch ? prev
      : { epoch, rows: [...prev.rows, ...fetched.rows], cursor: fetched.nextCursor });
  }, [fetcher.data, fetcher.state, epoch]);

  const rows = [loaderData.rows, extra.rows].flat();

  const loadMore = () => {
    if (fetcher.state !== "idle" || !extra.cursor) return;
    const p = new URLSearchParams(searchParams);
    p.set("cursor", extra.cursor);
    // hit THIS route's loader; keep filters in the query so the loader re-derives them
    fetcher.load(`/admin/users?${p.toString()}`);
  };

  // sentinel: IntersectionObserver → loadMore when the cursor exists and we're idle
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !extra.cursor) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) loadMore(); },
      { rootMargin: "600px" },  // prefetch before it's on screen
    );
    io.observe(el);
    return () => io.disconnect();
  }, [extra.cursor, searchParams]);  // rebind when cursor advances or filters change
}
```

**Why this is race-safe.** The loader must echo the request's epoch back in its payload
(`return data({ rows, nextCursor, epoch })`). If the user flips a filter mid-flight: (a) the
navigation changes the URL → `epoch` recomputes → the reset `useEffect` clears `extra` and adopts
the new page 1; (b) when the stale fetcher settles, its `fetched.epoch !== epoch` so it is dropped.
No mixed rows, no dupes.

**Scroll position** is preserved automatically — the fetcher does NOT navigate, so
`ScrollRestoration` (already mounted in `root.tsx:119`) never fires; we only append below the fold.
`rootMargin` prefetches the next page ~600px early so there's no visible stall. Guard `loadMore`
with `fetcher.state !== "idle"` so a fast scroll can't fire duplicate loads for the same cursor.

---

### [HIGH] Cursor encoding — opaque base64url of `{v, k, id, s}`, validated + tied to the sort column.

**It MUST encode the active sort column.** Keyset is `WHERE (sort_key, id) </> (cursor.k, cursor.id)`.
If the cursor doesn't record which column `sort_key` was, changing `?sort=` mid-scroll compares the
new column against the old column's boundary value → corrupt/garbage page. Bind the cursor to its
sort+dir and **reject it server-side if they don't match the current request** (treat as page 1).

**Encoding.** No need for a signed/encrypted cursor — but it must be **validated, not trusted**,
because it feeds a SQL comparison. Opaque base64url(JSON):

```ts
type Cursor = { v: 1; s: SortCol; d: "asc" | "desc"; k: string; id: string };
const SORTS = { created: "created_at", seen: "last_sign_in_at", email: "email" } as const;

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}
export function decodeCursor(raw: string | null, sort: SortCol, dir: "asc" | "desc"): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (c?.v !== 1 || !(c.s in SORTS) || (c.d !== "asc" && c.d !== "desc")) return null;
    if (typeof c.k !== "string" || typeof c.id !== "string") return null;
    // sort changed since this cursor was minted → ignore it, restart from page 1
    if (c.s !== sort || c.d !== dir) return null;
    return c as Cursor;
  } catch { return null; }
}
```

**Why unsigned is safe here.** A tampered cursor cannot inject SQL — `k`/`id` are passed as
**bound parameters** (`sql\`… > (${c.k}, ${c.id})\``), never interpolated. The sort **column** is
chosen from the server-side `SORTS` allow-list keyed by the validated `s`, never taken from the
cursor as a raw identifier. Worst case of a forged-but-well-typed cursor: the attacker paginates
their own already-authorized result set from an arbitrary boundary — no leak, no escalation
(the loader already passed `requireEntitlement`). So opaqueness is cosmetic; **validation is the
real control**, and the code above fails closed (returns null → page 1) on anything malformed.
Do NOT `throw` on a bad cursor — a stale bookmarked URL is not an error; degrade to page 1.

**Type mind the boundary value.** `k` is the stringified sort value. For `last_sign_in_at` it can
be **null** (never-signed-in users) — keyset over a nullable column needs an explicit tiebreak
(`ORDER BY last_sign_in_at DESC NULLS LAST, id`) and the WHERE must handle the null-boundary
(carry a `kNull: boolean` or split the predicate). Flag to the DB reviewer (O3): prefer a
**NOT NULL** sort key (`created_at`) as the default sort to sidestep null-keyset entirely; only
`created_at` is guaranteed non-null in the `app_users` projection.

Keyset SQL (house style, matches `getPassage` row-comparison):

```sql
-- sort=created dir=desc, page size N+1 to know if there's a next page
WHERE (${hasCursor} IS FALSE OR (u.created_at, u.id) < (${c.k}::timestamptz, ${c.id}))
  AND <search predicate> AND <filter predicates>
ORDER BY u.created_at DESC, u.id DESC
LIMIT ${N + 1}
```
Fetch `N+1`; if you got `N+1` rows, `nextCursor = encodeCursor({...last visible row})` and drop the
extra; else `nextCursor = null` (end state).

---

### [MEDIUM] Per-request db discipline — SELECT-only role over a SECURITY DEFINER view through Hyperdrive: fine, with three checks.

The admin loader must use the **request-scoped `context.db`** (never build its own client) —
same rule as every other route (`word.tsx:24`, `scripture.tsx`). It's already closed via
`waitUntil(end())` in the worker. No change needed to `db.server.ts`.

Three Hyperdrive/PG interactions to verify (hand to the DB reviewer where noted):
1. **`prepare: false`** (db.server.ts:31) is mandatory for Hyperdrive and is already set — the
   keyset query uses only bound params, so unprepared execution is fine (no plan-cache benefit
   lost that matters at this scale).
2. **SECURITY DEFINER view + `search_path`.** A SECURITY DEFINER *function* is the classic
   search_path-hijack surface; a plain **view** executes with the view **owner's** privileges but
   does NOT switch `search_path` per-caller in a dangerous way as long as every object inside the
   view is **schema-qualified** (`auth.users`, not `users`). Ensure the view body is fully
   qualified (the plan's draft SELECT already writes `FROM auth.users` — good). This is O1's turf;
   from the data-loading side the only requirement is: the view is schema-qualified and
   `lumen_read` has `SELECT` on `lumen.app_users` and on `lumen.user_roles`.
3. **Hyperdrive connection pooling + `SET`/session state.** Because Hyperdrive multiplexes, do
   **not** rely on any per-session `SET search_path`/`SET role` — every query must be
   self-contained (schema-qualified, no session GUCs). The house queries already never `SET`
   anything, so this is satisfied; just don't introduce a `SET LOCAL` in the admin query.

No issue with the SELECT-only role reading a SECURITY DEFINER view: that is precisely the point of
DEFINER — `lumen_read` reads the view, the view's owner reads `auth`. `lumen_read` needs no `auth`
grant.

---

### [MEDIUM] Fetcher pages should come from the SAME UI route loader, not a separate resource route — but make the loader lean per-request.

`fetcher.load("/admin/users?cursor=…")` re-invokes **`admin.users.loader`** (the leaf match's
loader — confirmed RR7 semantics). That means each page re-runs whatever the loader does. So:

- **Do NOT compute an expensive total `COUNT(*)` on every page.** Compute the count (if you show
  one) **only on page 1** — detect page 1 by absence of `?cursor`. On cursor requests, skip the
  count entirely and return only `{ rows, nextCursor, epoch }`. This keeps each fetcher page to a
  single keyset SELECT.
- **Do NOT stream/return the heavy sibling data** (filter option lists, role catalog) on cursor
  pages either — gate them behind `if (!cursor)`.

With those two guards, a single UI route is the right call: it keeps one loader as the source of
truth for the row shape, one `requireEntitlement` gate covering **every** page (a resource route
would need to re-implement the same auth check), and Single-Fetch-native typing via
`useFetcher<typeof loader>()`. A separate `routes/admin.users.data.tsx` resource route buys
nothing here and duplicates the entitlement gate — **reject it**. (If the loader ever grows
genuinely heavy non-list work that can't be cursor-gated, revisit; not now.)

One RR7 gotcha to encode as a test: the fetcher URL must point at the route whose loader you want.
Since `/admin/users` is a normal path (not an index), `fetcher.load("/admin/users?…")` targets it
directly — no `?index` needed (that dance is only for index routes).

---

### [MEDIUM] Search debounce + URL sync — `useSubmit` with `replace:true`, debounced; it does not fight the fetcher.

Debounce keystrokes and push `?q=` via **`replace`** so you don't stack a history entry per
character (back button would otherwise walk letter-by-letter):

```tsx
const submit = useSubmit();
const [sp] = useSearchParams();
const onChange = useDebouncedCallback((value: string) => {
  const next = new URLSearchParams(sp);
  value ? next.set("q", value) : next.delete("q");
  next.delete("cursor");                 // new query ⇒ new result set ⇒ drop cursor
  submit(next, { method: "get", replace: true, preventScrollReset: true });
}, 250);
```

Key points:
- `method: "get"` → this is a **navigation**, so it re-runs `admin.users.loader` and yields a fresh
  page 1. That navigation changes `epoch`, which triggers the reset `useEffect` above → the
  accumulated tail clears and any in-flight cursor fetcher is dropped by the epoch guard. So the
  two mechanisms cooperate rather than fight: the search submit is the authoritative "reset."
- `replace: true` collapses the debounced typing into one history entry.
- `preventScrollReset: true` keeps the user's scroll when only `q` changes (optional; on a fresh
  result set you may actually *want* to scroll to top — decide in UI review).
- Keep the `<input defaultValue={q}>` (uncontrolled) or sync from `sp.get("q")` so back/forward
  restores the field. Do NOT make it a controlled input bound to the URL round-trip — that adds
  input latency.

No conflict with infinite scroll: the fetcher only ever fires on the IntersectionObserver sentinel
with an explicit cursor; the search submit only ever fires a GET navigation without a cursor. They
touch disjoint state (fetcher-tail vs loader-page-1) and the epoch guard reconciles the race.

---

### [LOW] Route-module shape + the 404 mechanism.

**Route registration** (`routes.ts` uses the config array, flat-file style already):
```ts
route("admin/users", "routes/admin.users.tsx"),
```
Nested path `admin/users` → file `routes/admin.users.tsx` → typegen emits
`./+types/admin.users` with `Route.LoaderArgs`/`Route.ComponentProps` exactly like `word.tsx`
(`import type { Route } from "./+types/word"`). Run `react-router typegen` (already wired into the
`typecheck` script) after adding the route so `+types/admin.users` exists. There is no separate
`admin.tsx` layout unless you want shared admin chrome — for one route, skip it.

**Entitlement 404 — throw a bare `Response`/`data` with status 404, do NOT use a custom
ErrorBoundary to fake it.** Match the house pattern in `word.tsx:16`
(`throw new Response(msg, { status: 404 })`), which the **root** `ErrorBoundary`
(`root.tsx:180`) already renders as the "404 / The requested page could not be found." page via
`isRouteErrorResponse`. So `requireEntitlement` should:
```ts
if (!auth.entitlements.has(need)) throw data(null, { status: 404 });   // or new Response(null,{status:404})
```
This satisfies plan O5 (404-not-403: a non-admin sees the ordinary not-found page and cannot infer
the admin area exists) and reuses the existing boundary — **do not** add a route-local
`ErrorBoundary` (it would only diverge the 404 look from the rest of the app). `throw` (not
`return`) so it short-circuits before any user query runs — H3 asserts exactly this ordering, so
put the `requireEntitlement` call as the **first statement** in the loader, before `createDb`
usage or any query.

One D5 interaction to note: root's loader comment (`root.tsx:38`) warns that a **thrown
`redirect()`** from a child skips root's Set-Cookie merge. A thrown **404 `data`/Response** is a
different case — it renders the root ErrorBoundary and the root loader still ran, so session
cookie handling is unaffected. Good — the 404 path does not risk dropping a token rotation.

---

## Verdict

**O2 — roles in the root loader: NO.** Under RR7 Single Fetch the root loader revalidates on
**every** client navigation, and it currently costs **zero** DB round trips (local ES256
`getClaims`). Adding a roles query makes it **one blocking Hyperdrive round trip per navigation
for every signed-in user**, on the critical path, to decide whether to show a single menu item —
a direct COR-2 violation, and you can't `shouldRevalidate=false` your way out because root must
keep revalidating for token rotation. **Do this instead:** (1) authoritative
`requireEntitlement(auth,"admin.users")` **only in the admin loader** — the roles round trip then
happens **only when an admin opens `/admin/users`**, never on normal navigation; (2) show/hide the
"Admin" link from a **JWT `app_metadata.entitlements` claim** read locally by `getSessionUser`
(zero network), stamped by `grant-role.mjs` at grant time. Fail-closed: a stale claim only mis-hints
a link; the loader is the real gate. Reject the KV roles cache for v1.

**Keyset + fetcher wiring (the exact prescription):**
- URL owns `?q&role&status&sort&dir`; loader returns page 1 `{rows, nextCursor, epoch}`; fetcher
  owns cursor + accumulated tail in component state.
- **Cursor** = opaque `base64url(JSON {v:1, s:sortCol, d:dir, k:boundaryValue, id})`, **validated**
  server-side (version, allow-listed sort, dir, string k/id) and **rejected → page 1** if
  `s/d` ≠ the current request's sort/dir (this is what stops sort-change-mid-scroll corruption).
  Unsigned is fine because `k`/`id` are **bound params** and the sort **column** comes from a
  server allow-list, never from the cursor. Bad cursor degrades to page 1, never throws.
- **Query**: keyset `WHERE (sort_key, id) </>` boundary, `ORDER BY sort_key <dir>, id <dir>`,
  `LIMIT N+1`; default sort `created_at` (NOT NULL — avoids null-keyset). Count only on page 1
  (no `?cursor`); cursor pages return only rows+nextCursor.
- **Fetcher** hits the **same UI route** (`fetcher.load("/admin/users?…&cursor=…")`), not a
  resource route — one loader, one entitlement gate. IntersectionObserver sentinel with
  `rootMargin:"600px"`, guarded by `fetcher.state==="idle" && cursor`.
- **Race guard (the load-bearing part):** an `epoch` = serialized URL filter set (cursor excluded).
  The loader **echoes epoch** in its payload; append only when `fetcher.data.epoch === currentEpoch`;
  reset the accumulated tail in a `useEffect` keyed on `[epoch, loaderData]`. Filter/search changes
  go through `useSubmit({method:"get", replace:true})` (debounced 250ms, `cursor` deleted), which
  is a navigation → new epoch → tail reset + stale-fetcher drop. Search-submit and cursor-fetcher
  touch disjoint state and are reconciled by the epoch guard — they do not race into mixed rows.
- **404 gate**: `requireEntitlement` as the loader's first statement, `throw data(null,{status:404})`,
  rendered by the existing root `ErrorBoundary` — no route-local boundary, no 403.
