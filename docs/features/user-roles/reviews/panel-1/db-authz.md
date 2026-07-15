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
