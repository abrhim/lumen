# Panel-2 — Adversarial Reviewer A (authorization + data-layer skeptic)

Reviewer: ADVERSARIAL-A. Scope: attack plan.md + Panel-1 (db-authz, platform-data) with executable proof.
Method: read-only probes over the **admin DSN the migration actually uses** (`DATABASE_URL` in repo-root `.env`,
read the same way `scripts/ingest-strongs.mjs:207` reads it) via the vendored `postgres@3.4.9` driver,
`prepare:false`, `max:1`. No DDL/DML/EMAIL issued. Web-verified Supabase/PG17 claims. Tags:
[CONFIRMED-HARDER] / [REFUTED] / [NEW] / [ESCALATE] / [CUT].

> Note (worklist P3/P7): the ad-hoc item numbering skips 7–9 — a self-numbering artifact
> of drafting, not missing findings. Items 1–6b and 10 are the complete set.

---

## Item 1 (THE CRUX) — [CONFIRMED-HARDER] the admin DSN's role IS bypassrls; the view recipe does NOT ship empty

Panel-1 (db-authz CRITICAL) asserted the RLS-zero-policies trap is neutralized because `postgres` owns
`lumen.*` and has `rolbypassrls`. I re-ran this **on the exact connection the DDL migration will use**, not
against an abstract catalog assumption — harder proof.

Live probe (repo-root `DATABASE_URL`, host `…pooler.supabase.com:5432`, user `postgres.<ref>` = Supavisor
**session mode**):

| Probe | Result |
|---|---|
| `SELECT current_user, session_user` | **`postgres` / `postgres`** |
| `rolbypassrls` for `current_user` | **`true`** (`rolsuper=false`) |
| `has_table_privilege(current_user,'auth.users','SELECT')` | **true** |
| `has_schema_privilege(current_user,'auth','USAGE')` | **true** |
| `auth.users`: `relrowsecurity / relforcerowsecurity / owner` | **`true` / `false` / `supabase_auth_admin`** |
| `pg_policies` on `auth.users` | **0 rows** (RLS on, zero policies — the trap is real) |
| `lumen_read`, `supabase_auth_admin`, `authenticator` `rolbypassrls` | **all false** |
| `supabase_admin` | bypassrls **true**, super true |
| existing `lumen.*` objects owner | **all `postgres`** (incl. the `nodes` view) |

**Verdict:** the migration runs as `postgres`, so `CREATE VIEW lumen.app_users` is owned by `postgres`,
which has `rolbypassrls=true` → the `auth.users` RLS-enabled/no-policies filter is bypassed for the view
owner → `lumen_read` selecting a default-`security_invoker=false` view gets rows. **The recipe does NOT
silently ship an empty admin table.** Panel-1's CRITICAL is CONFIRMED, and confirmed on the real wire path
(pooler session mode, not just `pg_roles` in the abstract).

Adversarial follow-through on "any Supabase detail that breaks this":
- **Owner correctness:** `postgres` (not `supabase_admin`) is right — every existing `lumen.*` object is
  already `postgres`-owned, and `postgres` bypassrls is sufficient; no need to touch `supabase_auth_admin`.
- **Grant/ownership reset risk:** `postgres`'s `rolbypassrls` is a stable Supabase platform attribute; nothing
  in-scope mutates it. Keep Panel-1's post-create `invariant_check` that owner has `rolbypassrls` — it is the
  correct guard against a future migration run under a non-bypass role.
- See Item 10 for the one Supabase-coupling angle Panel-1 under-weighted (the view's dependency on `auth.users`
  column stability).

## Item 2 — [CONFIRMED-HARDER] `app_metadata` is a real JWT claim `getClaims` exposes; staleness is fail-closed

- (a) **Claim exists.** Supabase docs list `app_metadata` as an optional claim in the access-token JWT payload,
  and `getClaims()` returns the decoded claims. Code path confirmed: `auth.server.ts:111` calls
  `getClaims()` and reads `data.claims.*`; `data.claims.app_metadata?.entitlements` is therefore locally
  readable with **zero network** (ES256/JWKS local verify). GoTrue maps the DB column `raw_app_meta_data` →
  the `app_metadata` claim at token-mint, so a `grant-role.mjs` write to `raw_app_meta_data` surfaces there on
  the next mint. (a) holds.
- (b) **Grant staleness:** after a grant, the existing access token carries no entitlement until refresh
  (default Supabase access-token TTL = 3600s / 1h — verify the project's `JWT expiry` setting). Menu link stays
  hidden up to ~1h. **Acceptable** because the loader is authoritative: the admin can still reach `/admin/users`
  by direct URL and the loader's DB roles-query passes → 200. Traced: gate = DB query, not the claim.
- (c) **Revoke staleness:** the stale `true` claim shows the link up to ~1h, but the DB check is authoritative
  and now returns no entitlement → `throw data(null,{status:404})`. Link-shows-but-page-404s = inconsistent
  UI, **safe** (fail-closed at the DB). Security direction is always deny-at-DB, never trust-the-claim.
  Confirmed.

## Item 3 — [CUT] the JWT-claim path is gold-plating for a 1-admin v1; and [NEW] if kept it needs a clobber-safe merge

Two Panel-1 reviewers **conflict** on where roles load, and neither notices it:
- db-authz [INFO O2] (line 97-99): "fold roles into the session load … one query … negligible … should not be
  split into two" — i.e. **query in root**.
- platform-data [HIGH O2] (line 24-64): "Do **NOT** add the roles query to the root loader … 1 Hyperdrive round
  trip per navigation … use a JWT `app_metadata.entitlements` claim hint."

[ESCALATE] this conflict to synthesis. My resolution attacks BOTH:

- The **authoritative** control is the DB roles-query in the admin loader (both agree). The JWT claim exists
  **only** to show/hide one menu link.
- For **v1 there is exactly one admin (Abram)** and the section is read-only. A discoverable menu link is not
  load-bearing — he can bookmark `/admin/users`. **CUT the menu-hint entirely for v1**: no root query, no JWT
  stamp, no staleness window, no `grant-role.mjs` second write. This is strictly less surface than either
  Panel-1 option and removes an authz-adjacent code path. The link becomes a fast-follow once >1 admin exists.
- **If** product insists on the link in v1, prefer platform-data's JWT hint over db-authz's root query (the
  per-navigation Hyperdrive RT on every signed-in reader is a real COR-2 cost on a chapter→chapter reading
  app) — BUT then [NEW] correctness hazard: `grant-role.mjs` must **merge**, not overwrite,
  `raw_app_meta_data`. A naive `SET raw_app_meta_data = '{"entitlements":[…]}'` clobbers Supabase's
  `{"provider":"email","providers":[…]}` and can break sign-in. Required form:
  `raw_app_meta_data = COALESCE(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('entitlements', …)`.
  Panel-1 (platform-data line 51-53) says "have it also set `app_metadata.entitlements`" with **no mention of
  the merge** — a latent clobber bug.

## Item 3b — [CONFIRMED] direct SQL write to auth.users triggers nothing; but it is off Supabase's supported path

Probe: `pg_trigger` on `auth.users` (non-internal) = **0 rows**. So a `grant-role.mjs` UPDATE of
`raw_app_meta_data` via the admin DSN fires **no** DB triggers/auth hooks, and `postgres` has
`has_table_privilege('auth.users','UPDATE')=true`. It works. Caveat: Supabase's *supported* way to mutate
`app_metadata` is the Admin API (`auth.admin.updateUserById`); a direct SQL UPDATE is unsupported-but-
functional (GoTrue reads `raw_app_meta_data` fresh at token-mint, no cache to bust — confirmed no hook layer).
This is another reason Item 3's CUT is attractive: it deletes an unsupported-path write.

## Item 4 — [REFUTED] platform-data's "created_at NOT NULL" is FALSE; the default-sort keyset is unsafe as specified

platform-data (line 197-198, 359) rests the whole null-keyset story on: *"default sort `created_at` (NOT NULL —
avoids null-keyset); only `created_at` is guaranteed non-null in the `app_users` projection."* **Live catalog
refutes this:**

`information_schema.columns` for `auth.users`: `created_at is_nullable = **YES**`, `last_sign_in_at = YES`,
`email = YES`, `id = NO`. **`created_at` is nullable at the schema level.**

Why it bites: the keyset uses PG row-comparison `(u.created_at, u.id) < (:k, :id)`. If any row has
`created_at IS NULL`, the comparison yields `NULL` (not true) → that row is **excluded from every page after
page 1 → silently skipped**; and `ORDER BY created_at DESC` puts NULLs first (NULLS FIRST default on DESC), so
a NULL-boundary cursor is garbage. Panel-1's "guaranteed non-null" premise does not hold, so the "just default
to created_at" mitigation is not actually safe.

**Fix (cheap, total):** project `created_at` as non-null in the view —
`COALESCE(u.created_at, 'epoch'::timestamptz) AS created_at` (or assert-non-null invariant) — making it the one
keyset column that is provably NULL-free. In practice GoTrue always sets `created_at`, but the *column contract*
permits NULL, so the keyset must not rely on runtime luck.

## Item 4b — [CONFIRMED-HARDER] the tie-break IS correct in both directions (given a non-null sort column)

Attacking the cursor at a `created_at` tie (bulk import → shared timestamp), `id` = uuid PK (probe: `id
is_nullable=NO`, unique):
- **dir=desc:** `ORDER BY created_at DESC, id DESC` + `WHERE (created_at,id) < (:k,:id)`. Row-comparison walks
  columns left-to-right in the **same** direction as the ORDER BY, and because `id` is unique,
  `(t,id₁) < (t,id₂) ⇔ id₁ < id₂` → exactly the rows after the boundary, **no dupe, no skip** at the tie.
- **dir=asc:** `ORDER BY created_at ASC, id ASC` + `WHERE (created_at,id) > (:k,:id)`. Symmetric, correct.

The correctness hinges on `id` being used in the **same** direction as the sort key (Panel-1's SQL does this).
Confirmed sound — but *only* while the leading column is non-null (Item 4).

## Item 4c — [ESCALATE] nullable sort keys (`last_sign_in_at`, `email`) break row-comparison keyset — forbid them in v1

`last_sign_in_at` and `email` are nullable (probe). PG row-comparison keyset **cannot** express
`ORDER BY col NULLS LAST` semantics — `(col,id) </> (:k,:id)` mishandles the NULL block (skips or corrupts at
the null boundary). Panel-1 (platform-data line 195-198) flagged this to the DB reviewer but **left it
unresolved** ("prefer a NOT NULL sort"), and db-authz never resolved it. Resolve it now: **v1 keyset sort
allow-list = `created_at` only** (the COALESCE'd non-null column). `email`/`last_sign_in_at` sorting is a
fast-follow requiring a null-aware split predicate (carry `kNull:boolean` in the cursor, branch the WHERE). Do
not ship nullable-column keyset in v1.

## Item 5 — [CONFIRMED-HARDER] the ILIKE escape is correct only if backslash is escaped FIRST; proof included

Panel-1 (H5) says escape `%`,`_`,`\`. The **order is load-bearing** and unstated. Proof for `q = 100%_\x`:
1. escape `\` → `\\` **first**:  `100%_\x` → `100%_\\x`
2. then `%` → `\%`:              `100\%_\\x`
3. then `_` → `\_`:              `100\%\_\\x`

Pattern body `100\%\_\\x`, wrapped `'%' || body || '%'` → `%100\%\_\\x%`. Under PG's LIKE/ILIKE **default
escape char `\`** (no `ESCAPE` clause needed; declaring `ESCAPE '\'` is clearer, not required), this matches the
literal string `100%_\x`. If instead `%`/`_` are escaped **before** `\`, the inserted backslashes get
re-escaped → wrong pattern. **H5 must assert the backslash-first order**, not merely "the three chars are
escaped."

- **Injection:** none regardless — the whole `%…%` string is a **bound param**, never interpolated; escaping
  only prevents *wildcard* injection (a user typing `%` matching everything). Confirmed.
- **ReDoS:** none — ILIKE is not regex.
- **Perf cliff:** leading-wildcard `ILIKE '%q%'` over a **view** (unindexable; probe: pg_trgm/citext/unaccent
  **available, not installed**) = seq scan of `auth.users` + jsonb extraction per keystroke (250ms debounce).
  Negligible at 0 users; realistically fine to ~10k; bites ~100k+ rows. Panel-1's matview/synced-table upgrade
  path (same object name/grant) covers it. Confirmed — pre-optimizing now would be premature.

## Item 6 (Panel-1 MISSED) — [NEW] timing side-channel partially defeats the 404-not-403 concealment

O5's rationale is that a 404 hides the admin route's existence from non-admins. But: a non-admin hitting
`/admin/users` **matches the route**, runs the loader, and the loader must do the **DB roles-query** before
`requireEntitlement` throws 404. A genuinely nonexistent path (`/admin/xyz`) matches **no** route → RR7 returns
404 with **no loader, no DB**. So `/admin/users`'s 404 is measurably **slower** (one Hyperdrive round trip)
than a nonexistent-route 404. An attacker timing responses can distinguish "route exists, you're not admin"
from "route doesn't exist," eroding the concealment O5 sells.

Severity: **low** — concealment is defense-in-depth; the real control is the entitlement gate (which holds).
No cheap mitigation worth taking (constant-time padding on a hidden admin route is over-engineering). **Record
it so O5's claim isn't oversold**: 404-not-403 hides the route from casual users and from the response *body/
status*, not from a timing oracle.

## Item 6b — [CONFIRMED] gate ordering, no PII leak, no IDOR

- **404 before any user query:** requires `requireEntitlement` to be the loader's **first statement** (H3,
  platform-data line 322-326). As specified, the user-list SELECT is never built for a non-admin → no PII in
  the payload on the deny path. Confirmed *contingent on H3's ordering assertion actually running.*
- **IDOR:** the route is list-only; the sole client-supplied identifier is the cursor, passed as **bound
  params** with the sort column chosen from a server allow-list (platform-data line 184-190). No per-user id is
  accepted. No IDOR. Confirmed.
- **Roles/entitlements tables:** `lumen.roles`/`lumen.user_roles` are app-owned, no RLS, `lumen_read`
  SELECT-only (db-authz confirmed `lumen_read` has no CREATE on `lumen`). No self-escalation path. Confirmed.

## Item 10 (Panel-1 under-weighted) — [NEW] the view re-introduces the auth-schema coupling the FK-avoidance dodged

db-authz [OK] praises "no cross-schema FK to `auth.users`" for decoupling from Supabase auth migrations. But
`lumen.app_users` **is itself a cross-schema dependency** on `auth.users` — it references columns `id, email,
raw_user_meta_data, created_at, last_sign_in_at, banned_until, deleted_at`. If a Supabase auth migration
**renames/drops** one of those columns, the view breaks (or a `DROP … CASCADE` on `auth.users` silently drops
the view). Probe confirms all referenced columns currently exist; they are historically stable, so risk is
**low**. But the FK-avoidance did NOT remove auth coupling — it moved it into the view. Mitigation: the
house-style smoke test (`scripts/smoke-*.mjs` pattern) should probe `SELECT … FROM lumen.app_users LIMIT 0`
post-deploy so a broken projection fails CI loudly rather than surfacing as an empty admin list. Cheap, worth
it.

---

## Summary of resolutions requested from synthesis

| # | Item | Tag | Action |
|---|---|---|---|
| 1 | Admin DSN role bypassrls (crux) | CONFIRMED-HARDER | keep view recipe + owner-bypassrls invariant |
| 2 | JWT `app_metadata` claim + staleness | CONFIRMED-HARDER | fail-closed at DB confirmed |
| 3 | JWT-stamp path earns its keep? | **CUT** | drop menu hint in v1 (1 admin); if kept, merge not clobber |
| 3b | direct SQL write to auth.users | CONFIRMED | works (0 triggers); off supported path |
| 4 | created_at "NOT NULL" premise | **REFUTED** | COALESCE created_at non-null in view |
| 4b | keyset tie-break both directions | CONFIRMED-HARDER | correct given non-null sort col |
| 4c | nullable sort keys | **ESCALATE** | v1 sort allow-list = created_at only |
| 5 | ILIKE escape | CONFIRMED-HARDER | H5 must assert backslash-first order |
| 6 | timing side-channel on 404 | **NEW** (low) | don't oversell O5 concealment |
| 6b | gate order / PII / IDOR | CONFIRMED | keep requireEntitlement first-statement |
| 10 | view = auth coupling | **NEW** (low) | smoke-probe the view post-deploy |
| — | O2 root-vs-JWT conflict between Panel-1 reviewers | **ESCALATE** | synthesis must pick one |

Sources: [Supabase JWT / claims](https://supabase.com/docs/guides/auth/jwt-fields) ·
[Supabase getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims) ·
[PostgreSQL 17 row-value comparison](https://www.postgresql.org/docs/17/functions-comparisons.html#ROW-WISE-COMPARISON) ·
[PostgreSQL 17 LIKE / ESCAPE](https://www.postgresql.org/docs/17/functions-matching.html#FUNCTIONS-LIKE) ·
live probes over repo-root `DATABASE_URL` (documented above).
