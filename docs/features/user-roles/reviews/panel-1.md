# panel-1 (aggregated 2026-07-10) — db-authz, platform-data, admin-ux

---
<!-- panel-1/db-authz.md -->
# Panel-1 review — DB Authorization + Postgres Security

Reviewer: DATABASE-AUTHORIZATION + POSTGRES-SECURITY specialist
Scope: O1 bridge mechanism, view ownership/privileges, cross-schema FK, fail-closed authz (H2), O3/O5 search indexing, grants surface.
Method: read-only probes against the **live** DB (admin DSN as `postgres`; app DSN as `lumen_read`) + Postgres 17 docs. No DDL/writes were issued against the live DB.

## Live probe results (evidence base)

| Probe | Result |
|---|---|
| `SHOW server_version` | **17.6** (PG17 — `security_invoker` view param exists; default `false`) |
| `pg_extension` (installed) | **none** of pg_trgm / citext / unaccent / fuzzystrmatch installed |
| `pg_available_extensions` | pg_trgm **1.6**, fuzzystrmatch 1.2, unaccent 1.1, citext 1.6 — **available, not installed** |
| `auth.users` owner / RLS | owner = **`supabase_auth_admin`**; `relrowsecurity = true` (**RLS ON**); `relforcerowsecurity = false`; **zero RLS policies** |
| `rolbypassrls` | `postgres` = **true** (but `rolsuper=false`), `supabase_admin` = true (super), `supabase_auth_admin` = **false**, `lumen_read` = **false** |
| `postgres` on `auth.users` | `has_table_privilege SELECT = true`; `count(*)` returns 0 (no users yet) with no error |
| App DSN identity | `current_user = lumen_read` |
| `lumen_read` → `SELECT FROM auth.users` | **ERROR: permission denied for schema auth** |
| `lumen_read` schema privs | `auth` USAGE = **false**, `lumen` USAGE = true, `lumen` **CREATE = false** |
| Existing `lumen.*` objects | all owned by **`postgres`** (tables + the `nodes` view); `lumen_read` holds **SELECT** on them |
| `postgres` TRIGGER priv on `auth.users` | true (candidate-c feasible) |
| `postgres` CREATE EXTENSION | true (`extensions` schema CREATE = true, db CREATE = true) |

---

## [RESOLVED — CRITICAL] O1: use a plain view owned by `postgres`, `security_invoker` left at default (`false`)

Postgres has no `SECURITY DEFINER` clause *for views*. The mechanism the plan calls a "SECURITY DEFINER view" is simply **a normal view whose `security_invoker` storage parameter is NOT set (default `false`)**, so it executes with the **owner's** privileges. PG17 `CREATE VIEW` docs, verbatim:

> "By default, access to the underlying base relations referenced in the view is determined by the permissions of the view owner."
> "If the view has the `security_invoker` property set to `true`, access to the underlying base relations is determined by the permissions of the user executing the query, rather than the view owner. … Thus, the user of a security invoker view must have the relevant permissions on the view and its underlying base relations."

Applied here: a view in schema `lumen`, owned by `postgres` (which HAS `auth` USAGE + `SELECT` on `auth.users`), `SELECT`-granted to `lumen_read`. When `lumen_read` selects the view, the base-relation access is checked against **`postgres`**, not `lumen_read`. `lumen_read` needs only `USAGE` on `lumen` (has it) + `SELECT` on the view — it needs **no** privilege on `auth` (the indirection is the entire point). Proven by probe: `lumen_read` gets *permission denied for schema auth* on a direct read, i.e. it fails at schema-USAGE resolution — a boundary the definer view never exposes it to.

**All three candidates are technically feasible** (see the trigger/extension probes), so this is a simplicity/coupling/freshness decision, not a feasibility one:

- **(a) Plain view (definer-semantics)** — RECOMMENDED for v1. Simplest, always fresh, composes naturally with the admin list's dynamic `WHERE`/`ORDER BY`/keyset `LIMIT`. Only downside: **not indexable** (see O5).
- **(b) SECURITY DEFINER function returning table** — works, but worse: to keep search/filter/sort/keyset composable you either push all params into the function (awkward keyset SQL) or return the full set and filter in-app (defeats keyset). Adds the **`SECURITY DEFINER` `search_path` injection** hazard (must `SET search_path` on the function) — a bug class a view avoids entirely. No advantage here.
- **(c) Synced `lumen.app_users` table via trigger on `auth.users`** — the only candidate that is fully **indexable** (real table → GIN trigram). But it re-introduces exactly the `auth`-schema coupling the plan set out to avoid: a trigger on a Supabase-managed table (`supabase_auth_admin`-owned; Supabase may recreate `auth.users` and silently drop the trigger), plus DELETE/soft-delete sync logic. Justified **only** when indexed search at real scale is needed. Not for v1 (0 users today).

**Verdict:** candidate (a), plain view owned by `postgres`, default `security_invoker`.

## [CRITICAL] The RLS-with-no-policies trap makes owner choice load-bearing — assert `postgres` ownership

`auth.users` has **RLS enabled with zero policies**. Semantics: a role subject to RLS that is neither the table owner nor `BYPASSRLS` sees **all rows filtered out** — a query that **succeeds and returns 0 rows**, i.e. a *silent* empty admin list, which is worse than an error. PG17 docs confirm the owner path for a default (non-invoker) view:

> "if any of the underlying base relations has row-level security enabled, then by default, the row-level security policies of the view owner are applied…"

So the view owner must be a role that is **exempt** from `auth.users` RLS. Probes:
- `postgres` → `rolbypassrls = true` ⇒ RLS bypassed. ✅ (and `relforcerowsecurity=false`, so even non-bypass owners wouldn't be forced — but we rely on the explicit bypass, which is definitive from the catalog).
- `supabase_auth_admin` (the table owner) → also exempt as owner, but creating `lumen.*` objects as the auth admin is awkward and off-house.
- A hypothetical view owned by a plain role **without** bypass and **not** the owner → **0 rows, silently**. This is the failure mode to guard against.

Because the migration runs via the admin DSN as `current_user = postgres`, and `postgres` already owns every existing `lumen.*` object, a `CREATE VIEW lumen.app_users` will be owned by `postgres` automatically — the correct owner. **Add a house-style `invariant_check`** asserting `pg_get_userbyid(relowner) = 'postgres'` (or a role with `rolbypassrls`) on the created view, so a future migration run under a different role can't silently produce an empty projection.

## [HIGH] `security_invoker = true` would BREAK the bridge — pin it explicitly to `false`

If anyone sets `security_invoker = true` on this view, base-relation access flips to the **invoker** (`lumen_read`), which has no `auth` USAGE → every read becomes *permission denied for schema auth*. To make intent self-documenting and immune to a future default change, create it with an **explicit** `WITH (security_invoker = false)` and note WHY in a comment. Do **not** rely on readers knowing the PG default.

## [RESOLVED] O5 (× O1 interaction): search indexing forces the mechanism choice — v1 = escaped ILIKE over the plain view; matview/synced-table is the scale upgrade

This is the key interaction the brief flags. A **view is not indexable**; you cannot put a GIN trigram index on `lumen.app_users` if it's a view. The searchable columns (`email`, name) live in `auth.users`, and indexing `auth.users` directly is off-limits in practice (owned by `supabase_auth_admin`; a Supabase-managed table we must not mutate, and any index there risks being wiped by their migrations). Therefore **"really good indexed search" mechanically requires a materialized relation** — a **materialized view** (`CREATE INDEX` allowed on matviews) or the **candidate-(c) synced table**. That is the real coupling between O5 and O1.

Given the probe reality — **pg_trgm not installed, 0 users today** — the right v1 call:

- **v1: plain view + sequential-scan ILIKE.** Search across `email`, `display_name`, `full_name` with `ILIKE '%' || :q || '%'` where `:q` has `\`, `%`, `_` **escaped** (H5), plus a `user_id`-prefix branch. Over a tiny, admin-only row set a seq scan is negligible. No extension, no refresh job, always fresh. Correct for the current scale.
- **Upgrade path (document, don't build):** when N grows, either (i) swap the view for a **materialized view of the same name**, `CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;` (postgres can — probe confirms), add `GIN (email gin_trgm_ops, display_name gin_trgm_ops, full_name gin_trgm_ops)`, and add a `REFRESH MATERIALIZED VIEW CONCURRENTLY` job (accepts staleness); or (ii) go to candidate (c) for always-fresh indexed search. Both keep the object name `lumen.app_users` and the `lumen_read` grant, so the app query is unchanged. **Decision gate: pick the matview/synced upgrade only when seq-scan latency is actually measured to matter** — do not pre-optimize a 0-row table.

`unaccent` and `citext` are also available if diacritic-insensitive / case-insensitive-equality search is later wanted; not needed for v1 ILIKE.

## [OK] O-cross-schema-FK: reference `auth.users.id` by value — correct, orphans acceptable for v1

No FK from `lumen.user_roles.user_id` to `auth.users.id` is the right call: a cross-schema FK to the Supabase-managed `auth.users` couples our migrations to theirs and can block their auth-schema changes. Consequence: a deleted auth user leaves an **orphan** `user_roles` row. Impact is benign — the admin list `LEFT JOIN`s `app_users`, so an orphan simply never appears (no matching `app_users` row), and it grants nothing to a non-existent session. No `ON DELETE` story is possible without the FK; the planned nightly reconciliation (out of scope now) is fine. **One guard to add:** the entitlements/session query must resolve roles by the **current session user's id**, so a stale orphan for a *reused* uuid is not a realistic concern (Supabase uuids are not reused). Accept for v1.

Note the *intra*-schema FK `user_roles.role_slug → roles.slug ON DELETE CASCADE` is fine and lives entirely in `lumen`.

## [HIGH] H2 fail-closed: make the roles load a single all-or-nothing query; any error/empty ⇒ empty entitlement set

Failure modes to close:
- **node-postgres does not return partial results for a normal `query()`** — it either resolves with the complete row set or rejects. So a single round trip is inherently all-or-nothing. The danger is *assembling entitlements from multiple queries* and catching per-query: a partial success could yield a partial (but non-empty) set. **Mitigation:** load roles+entitlements in **one** query (join `user_roles → roles`, `unnest(entitlements)`), and wrap the *whole* load in one `try` that returns an **empty `Set` on any throw**. Never `Promise.allSettled` the pieces of an authz decision.
- **Statement timeout / cancel / pool-acquire failure / connection drop** all surface as a **rejected promise** → caught → empty set → deny. Good, as long as the catch is at the entitlement-load boundary and returns empty (not a rethrow that some outer handler turns into a default-allow).
- **Empty result vs error are handled identically** (both → empty entitlements → `requireEntitlement` throws 404). Absence-of-grant = deny is the natural default, which is what makes this fail-closed. H2's degraded-load assertion must exercise the *throw* path specifically, not just the no-rows path.
- Do **not** let a generic DB-helper `catch → return []` that also masks bugs be the only guard; that's acceptable for *authz* (deny) but should be an explicit, commented decision at the entitlement loader, and covered by H2.

## [OK] Grants surface — app role SELECT-only, issued by the admin migration

The migration (admin DSN, as `postgres`) issues exactly:

```sql
GRANT SELECT ON lumen.roles      TO lumen_read;
GRANT SELECT ON lumen.user_roles TO lumen_read;
GRANT SELECT ON lumen.app_users  TO lumen_read;   -- the definer view
```

No `INSERT/UPDATE/DELETE` to `lumen_read` on any of them — role granting is admin-script-only in v1. This is enforced defense-in-depth by the probed fact that **`lumen_read` has no CREATE on schema `lumen`** and is SELECT-only, so it cannot self-escalate or create objects. `lumen_read` must **not** be granted `USAGE ON SCHEMA auth` (keep it false — the view is the only path). Add invariant checks after grants: assert `lumen_read` has SELECT and lacks INSERT/UPDATE/DELETE on the three objects (house `invariant_check` events).

## [INFO] O2 (DB-cost angle only): folding roles into the session load is a genuine round-trip saving

`getClaims` is local (ES256), so today the root loader makes **no** DB hit for signed-in users. Adding roles-in-root makes it the loader's *only* query. The roles lookup is a single indexed point-read on `user_roles(user_id)` + tiny join to `roles` — cheap. Recommend **one** query that returns `{roles, entitlements}` and reuse it for both the Admin-menu-link decision and `requireEntitlement`, rather than two queries. Signed-out short-circuits to no query. (Deferring to COR-2 on the loader-architecture tradeoff; from the DB side the extra query is negligible and should not be split into two.)

---

## Verdict

**O1 definitive mechanism:** a **plain Postgres view** `lumen.app_users`, **owned by `postgres`**, created with **explicit `security_invoker = false`** (the default, pinned for clarity/safety), projecting a safe subset of `auth.users`, and `GRANT SELECT`ed to `lumen_read`. Because a default-invoker view runs with the **owner's** privileges (PG17 docs), and `postgres` holds `auth` USAGE + `SELECT` on `auth.users` **and** `rolbypassrls = true` (neutralizing the `auth.users` RLS-enabled/no-policies trap), `lumen_read` can read the projection while — proven live — still getting *permission denied for schema auth* on any direct `auth.users` read. Candidate (b) function adds a `search_path` hazard and hurts keyset composition; candidate (c) synced table re-couples to the `auth` schema. Neither is warranted at v1 scale.

**O5 interaction:** a view is unindexable, so **indexed** trigram search would *force* a materialized relation (matview or candidate-(c) table). With **pg_trgm not installed and 0 users**, v1 uses the plain view + **escaped `ILIKE '%q%'`** seq scan across `email`, `display_name`, `full_name` (+ `user_id` prefix). The matview-with-GIN-trigram (or synced-table) upgrade keeps the same `lumen.app_users` name and grant and is adopted only when measured latency demands it.

**Exact bridge DDL (run via admin DSN as `postgres`):**

```sql
-- Definer-semantics projection of auth.users into the lumen schema.
-- security_invoker=false (pinned): the view executes with OWNER (postgres)
-- privileges, so lumen_read reads it WITHOUT any auth-schema access.
-- Owner MUST be a role exempt from auth.users RLS (postgres has rolbypassrls);
-- otherwise RLS-enabled-with-no-policies would silently yield 0 rows.
CREATE VIEW lumen.app_users
  WITH (security_invoker = false) AS
SELECT
  u.id,
  u.email,
  u.raw_user_meta_data ->> 'name'      AS display_name,
  u.raw_user_meta_data ->> 'full_name' AS full_name,
  u.created_at,
  u.last_sign_in_at,
  (u.banned_until IS NOT NULL AND u.banned_until > now()) AS is_banned,
  (u.deleted_at IS NOT NULL)                              AS is_deleted
FROM auth.users u;
-- No password/token/phone/app_meta columns are projected (PII minimization).

GRANT SELECT ON lumen.app_users TO lumen_read;

-- Post-create invariants (house-style checks; abort migration if violated):
--   assert pg_get_userbyid(relowner)='postgres' for lumen.app_users
--   assert (SELECT rolbypassrls FROM pg_roles WHERE rolname=owner) IS TRUE
--   assert has_table_privilege('lumen_read','lumen.app_users','SELECT')
--   assert NOT has_schema_privilege('lumen_read','auth','USAGE')
```

Sources: [PostgreSQL 17 CREATE VIEW](https://www.postgresql.org/docs/17/sql-createview.html) · [Supabase Postgres Extensions](https://supabase.com/docs/guides/database/extensions)

---
<!-- panel-1/platform-data.md -->
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

---
<!-- panel-1/admin-ux.md -->
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

