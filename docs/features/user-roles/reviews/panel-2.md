# panel-2 (aggregated 2026-07-10) — adversarial-authz, adversarial-product

---
<!-- panel-2/adversarial-authz.md -->
# Panel-2 — Adversarial Reviewer A (authorization + data-layer skeptic)

Reviewer: ADVERSARIAL-A. Scope: attack plan.md + Panel-1 (db-authz, platform-data) with executable proof.
Method: read-only probes over the **admin DSN the migration actually uses** (`DATABASE_URL` in repo-root `.env`,
read the same way `scripts/ingest-strongs.mjs:207` reads it) via the vendored `postgres@3.4.9` driver,
`prepare:false`, `max:1`. No DDL/DML/EMAIL issued. Web-verified Supabase/PG17 claims. Tags:
[CONFIRMED-HARDER] / [REFUTED] / [NEW] / [ESCALATE] / [CUT].

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

---
<!-- panel-2/adversarial-product.md -->
# Panel-2 adversarial review — Product, Scope & UX-failure

Reviewer: ADVERSARIAL REVIEWER B (product / scope / UX-failure skeptic).
Lens: attack over-engineering, under-engineering, and product reality in the plan + Panel-1.
Standing facts: **0 users in auth today**, single-operator app (abram@soar.com), Cloudflare Workers,
`lumen_read` is SELECT-only and cannot read `auth.users` (hence the SECURITY DEFINER bridge).

---

## Thesis (highest-impact position)

**[CUT] The durable asset is the roles/entitlements SUBSTRATE + the auth→lumen SECURITY DEFINER
bridge. The admin TABLE is a disposable consumer, and Panel-1 has gold-plated it for a table that
holds exactly one row (Abram) and will for months.** Ship the substrate at full fidelity; ship the
table as the *minimum honest read-only list*. Everything Panel-1 built to make infinite-scroll +
keyset + filter-races correct is machinery for a problem this app does not have and will not have
this year. Build the mechanism like it matters (it gates every future feature); build the screen
like what it is (a debug view only the operator sees).

**Minimum shippable admin-users view (this week, still honest):**
1. `route("admin/users")` with `requireEntitlement(auth,"admin.users")` as the **first statement** →
   `throw data(null,{status:404})`. *This is the whole security boundary and it stays.*
2. Loader: `SELECT … FROM lumen.app_users LEFT JOIN user_roles(agg) ORDER BY created_at DESC LIMIT 200`.
   No cursor. No count query. One SELECT.
3. Render an **inline** semantic `<table>` (email · name · role badges · joined · last-seen),
   non-interactive rows. Optional: a client-side filter box that narrows the ≤200 already-loaded
   rows in JS — no server round trip, no debounce, no URL sync, no live region.
4. Admin link in the existing `AccountChip`, gated on a JWT entitlement claim (Panel-1 platform-data's
   O2 answer — keep it, it's the cheap one).

That is honest up to a few hundred users. When the table actually crosses ~200 rows, the fast-follow
adds pagination (keyset, exactly as platform-data spec'd — the design is good, just premature).

---

## 1. The full data-table apparatus — [CUT]

Panel-1 spec'd, for a 1-row table: two hand-rolled primitives (`ui/input` + `ui/table`), keyset
cursor encode/decode/validate, an `IntersectionObserver` sentinel, an **epoch race-guard** for
filter-vs-in-flight-cursor collisions, debounced URL-synced server search, two `aria-live` regions,
a mobile PII card-collapse, and a virtualization deferral analysis. **Every one of these exists to
make progressive loading of thousands of rows correct.** There are zero rows but Abram's.

Drop from v1, list to fast-follow:
- **keyset cursor + `IntersectionObserver` + infinite scroll** — no data to scroll.
- **the epoch race-guard** — it exists *only* because infinite-scroll can race a filter change.
  Cut the infinite scroll and this entire class of bug (and its test H4/H5-adjacent wiring) evaporates.
- **the second `aria-live` region** ("Loaded 25 more, 75 shown") — nothing appends.
- **server-side debounced URL-synced `?q=` search + removable filter chips** — client-side filter over
  ≤200 rows is a `.filter()`. URL-synced shareable search on a single-operator hidden route is state
  ceremony for an audience of one.
- **`ui/input.tsx` + `ui/table.tsx` as reusable PRIMITIVES** — see §7. One consumer ⇒ inline it.

Keep: the 404 gate, the loader SELECT, a plain table, role badges. That's the honest core.

## 2. Substrate vs screen — is the mechanism under-designed? — [CONFIRMED-HARDER] + [NEW]

The DB shape generalizes fine: `roles.entitlements text[]`, `user_roles` M2M, `requireEntitlement`
string check. A second role slots in with one seed row. Good.

**But the substrate is proven at N=1 in every dimension** — one role (`admin`), one entitlement
(`admin.users`), one consumer (the admin route). We are shipping a *generic* mechanism whose
generality is exercised exactly once. The single thing that actually validates extensibility is
harness **H1** (multi-role entitlement union / unknown-slug contributes nothing) — that test is the
real deliverable of this feature and must not be cut. Keep it; it's worth more than the table.

**[NEW] Dual source of truth for entitlements.** Panel-1 platform-data's (correct) O2 fix stamps
`app_metadata.entitlements` into the JWT so the menu link needs no round trip. That means grants now
live in **two** places: `lumen.user_roles` (authoritative, read by the loader) **and** the JWT claim
(the hint). `grant-role.mjs` must dual-write both, and **revocation is stale until token refresh** —
a revoked admin keeps a link that then 404s (acceptable, fail-closed), but a plan that says "granting
is a single upsert" is now understating the write. Fold into the script's contract: grant/revoke
touches user_roles **and** the auth `app_metadata`; document the staleness window. This is a real
substrate wrinkle the plan hasn't absorbed.

**[NEW] No validation that an entitlement key is real.** `entitlements text[]` is free text; a typo
(`admin.user`) silently grants nothing and fails closed with no signal. Minor at N=1, but a
CHECK/enum or a known-keys constant is a cheap guardrail worth a line.

## 3. End-to-end testability — [ESCALATE]

**The feature is NOT live-verifiable today.** The chain is blocked at the root:
`0 users → nobody can complete sign-in (the Supabase auth-dashboard prereqs from the last feature are
still unset, per plan probe line 9) → Abram cannot obtain a real session → cannot grant himself admin
against a real auth.users id → cannot open the gated screen as an admin in a browser.`

So `/verify` will be hollow: the only things provable now are (a) the DI-mocked harness
(entitlements flattening, 404-before-query, cursor/search unit logic) and (b) manually seeding a fake
`auth.users` row via the admin DSN to exercise the view + query shape. **The actual gated admin
surface cannot be driven end-to-end until the auth prereqs land.** This dependency must be stated in
the plan explicitly, and the feature's "done" bar must acknowledge it ships **unverified in-browser**.
Escalating because a large-tier auth-adjacent feature whose live path is blocked behind an unfinished
prerequisite is exactly the kind of thing that gets marked SHIPPED and then breaks on first real login.
Cutting the table apparatus (§1) also *shrinks the unverifiable surface* — fewer moving parts we can't
actually watch work.

## 4. Infinite scroll on an admin tool — [CUT]

Respecting that Abram asked for it: this reads as a **default preference, not a need**. Emil is right
for the wrong-sounding reason — infinite scroll harms findability and back-button behavior, but the
real point is there is **nothing to scroll**. The honest minimum is "show all (LIMIT 200), type to
filter." Plain, greppable, back-button-correct, zero cursor machinery. Panel-1's auto-loading
"Load-more-button" is a genuinely good design — for the problem we'll have at ~1k users, not the one
we have at 1. Position: **cut it from v1**, keep platform-data's keyset spec on the shelf verbatim for
the fast-follow that adds pagination when the row count earns it. Do not build numbered/offset
pagination either — nothing to paginate.

## 5. PII / privacy — [NEW], real but not a v1 gap

The obligation (privacy policy / data-handling for real people's emails) is triggered by **collecting**
PII, not by building an internal single-operator viewer — so building the admin list does not by itself
create a new duty. An **audit trail of admin views** (who looked at the user list) is premature at
single-operator: it would log Abram looking at Abram. Correctly deferred. **But flag for the roadmap:**
the day a *second human* can be granted admin, an admin viewing everyone's PII wants a view-log, and a
public app collecting emails wants a stated retention/deletion story. Not a v1 hole; a dated future
obligation the plan should name so it isn't forgotten.

## 6. Scope cuts that will bite — mostly [ACCEPT], one [CONFIRMED-HARDER]

- **No per-user detail page (row → nothing):** [ACCEPT]. Panel-1 already made rows non-interactive —
  correct; a 56px target that goes nowhere is worse than an inert row. Deferred rightly.
- **No in-app grant/revoke (SSH+script forever):** [CONFIRMED-HARDER]. This is the cut that bites
  *soonest* — the first time Abram wants to make a real user (a helper) admin, he's on his laptop
  running a script. Fine for a solo operator today; a genuine future hole, not a v1 one. Name it.
- **No way to see who's admin except the roles column:** [ACCEPT]. The roles column *is* the answer;
  at 1 user it's trivial. (Note: if §1 also cuts the role filter, "who's admin" becomes a scan — still
  fine at this scale.) Non-issue for v1.

None of the three is a v1 hole. All correctly deferred; in-app grant is the one to schedule next.

## 7. Panel-1 over-build to cut this week — [CUT]

- **Two new UI primitives.** [CUT the primitive framing.] `ui/input.tsx` and `ui/table.tsx` as
  reusable, exported components is YAGNI at one consumer. Inline the `<input>` and `<table>` in
  `admin.users.tsx`. Extract to `ui/` later *when a second route needs them* — that's when you'll know
  the right API. Building the primitive first is designing an abstraction from a sample size of one.
- **Mobile PII card-collapse.** [CUT for v1.] The operator is on a desktop; `overflow-x-auto` is
  acceptable for an audience of one. Defer the card layout to whenever a non-operator uses the screen
  on a phone (which is also when in-app grant and audit-log arrive — bundle them).
- **Virtualization deferral analysis.** [ACCEPT the conclusion, note the ceremony.] Panel-1's answer
  (skip windowing) is correct; the multi-paragraph justification is more analysis than a 0-user
  decision needed. Keep the one-line tripwire comment, drop the essay.
- **Two `aria-live` regions.** [CUT one.] With no infinite scroll there is nothing to announce on
  append; keep at most the single result-count `role="status"` (and even that is optional over a
  static ≤200-row list). Accessibility of a hidden operator-only route should be right-sized, not
  maximal.

---

## What survives at full fidelity (do NOT cut)

- `lumen.roles` / `lumen.user_roles` / `lumen.app_users` SECURITY DEFINER bridge (the substrate).
- `requireEntitlement` + 404-not-403 gate as the loader's first statement (the real boundary).
- `grant-role.mjs` — **expanded** to dual-write user_roles + JWT `app_metadata`, dry-run capable.
- Harness **H1/H2** (entitlement union; fail-CLOSED on degraded roles-load) — the feature's actual proof.
- The JWT-claim O2 answer from platform-data (cheap Admin-link gating, no per-nav round trip).

Everything else in Panel-1 is a well-designed solution to a load problem that arrives, at the earliest,
next year — and should be lifted verbatim from these reviews when it does.

