# user-roles — plan

**Feature**: Role-based entitlements + an admin-only "all users" section. First role: `admin`. Users hold many roles; roles grant feature entitlements.
**Tier**: large (authorization boundary + new DB objects + a privilege-gated admin surface reading PII = escalation surface; auth-adjacent always escalates).
**Gates**: 1b + 7 were originally self-waived citing a "standing directive" that the repo substantiates only as a prior-feature (supabase-auth) waiver — recorded as a process fault (DEC-B). **Resolved 2026-07-10: Abram explicitly approved the 13 decisions as-is.** Pipeline runs in full.

## Probes (pre-plan — live DB)

- **auth.users exists with everything we need**: `id (uuid)`, `email`, `raw_user_meta_data (jsonb — display name lives here)`, `created_at`, `last_sign_in_at`, `confirmed_at`, `banned_until`, `deleted_at`, `is_anonymous`. **0 users today** (nobody has completed sign-in — the auth prereqs are still unset).
- **HARD CONSTRAINT**: the app runtime role `lumen_read` is SELECT-only and has grants **only on schema `lumen`**. `SELECT ... FROM auth.users` → **permission denied for schema auth**. The admin list therefore CANNOT read auth.users with the app credential. This is the central design forcing-function.
- Session read already exists (root loader `getSessionUser` → `{id, email}` from local ES256 getClaims). Roles must join in there.
- House admin-script style (ingest-*.mjs): vendored/one-transaction, session-mode probe, DRY_RUN_ROLLBACK, named invariant_check events, exit 0/1 — the grant/DDL migration follows it.

## Design

### Data model (new, in `lumen` schema)
1. `lumen.roles` — `slug text PK` (e.g. 'admin'), `label text`, `entitlements text[]` (feature keys this role opens), `created_at`. Seed row: `('admin','Administrator', ARRAY['admin.users'])`.
2. `lumen.user_roles` — `user_id uuid`, `role_slug text REFERENCES lumen.roles(slug) ON DELETE CASCADE`, `granted_at`, `granted_by uuid`, PK `(user_id, role_slug)`. `user_id` references auth.users.id by VALUE (no cross-schema FK to a Supabase-managed table — avoids coupling to auth schema migrations; orphan rows are harmless and cleaned by a nightly job later / out of scope now). ~~Index on `user_id`.~~ *(→ dropped per F2: the composite PK `(user_id, role_slug)` leads on `user_id` and covers every lookup; the migration drops the redundant index if an earlier run created it.)*
   - GRANT SELECT to `lumen_read`. NO insert/update/delete for the app role — grants are admin-script-only in v1 (see "granting admin").
3. **Bridging auth.users → the app**: since lumen_read can't read auth, create **`lumen.app_users` — a SECURITY DEFINER view (or matview)** owned by a privileged role that projects a SAFE subset of auth.users into the lumen schema *(→ mechanism settled by D1: plain view owned by `postgres`, `security_invoker=false` pinned)*:
   *(projection corrected 2026-07-10 to match the applied DDL — every sortable column COALESCEd non-null per D2, plus `is_confirmed`/`is_anonymous`:)*
   `SELECT id, COALESCE(email,'') AS email, raw_user_meta_data->>'name' AS display_name, raw_user_meta_data->>'full_name' AS full_name, COALESCE(created_at,'epoch'::timestamptz) AS created_at, COALESCE(last_sign_in_at,'epoch'::timestamptz) AS last_sign_in_at, (email_confirmed_at IS NOT NULL) AS is_confirmed, (banned_until IS NOT NULL AND banned_until > now()) AS is_banned, COALESCE(is_anonymous,false) AS is_anonymous, (deleted_at IS NOT NULL) AS is_deleted FROM auth.users`.
   GRANT SELECT on the view to lumen_read. **Open question O1 for Panel-1**: SECURITY DEFINER *view* vs SECURITY DEFINER *function* vs a synced `app_users` table (trigger on auth.users). View is simplest but Postgres view security semantics (security_invoker default in PG15+) need verification — the view must run as its owner, not the caller, or lumen_read still can't read auth underneath. Panel to settle the exact mechanism.

### Entitlements model
- `getSessionUser` (or a new `getSessionAuth`) additionally loads the session user's roles → flattens `entitlements`. Returns `{ user, roles: string[], entitlements: Set<string> }`. *(→ superseded by D3/D4: no roles load in the session path; `getEntitlements(db, userId)` runs in the admin loader only.)*
- `requireEntitlement(auth, "admin.users")` helper → throws 404 (NOT 403 — don't reveal the route exists to non-admins) if absent. Used in the admin loader.
- Root loader exposes `entitlements` so the chip menu can conditionally show an "Admin" link. **Cost**: one extra indexed query per request for signed-in users only (signed-out short-circuits). O2 for Panel-1: fold roles into the same round trip as the session, or accept a second cheap query? (getClaims is local, so this WOULD be the root loader's only DB hit — weigh against COR-2.) *(→ superseded by D3: no root-loader roles query, no Admin menu link in v1.)*

### Admin route — `route("admin/users", "routes/admin.users.tsx")`
- Loader: `requireEntitlement(auth, "admin.users")`; reads `lumen.app_users` LEFT JOIN aggregated `user_roles`. Server-driven search + filter + sort + **keyset (cursor) pagination** for infinite scroll (NOT offset — offset drifts and slows; keyset on `(created_at, id)` or the active sort key). Returns a page + `nextCursor`.
- Search: case-insensitive across email + display_name + full_name + user_id-prefix. `ILIKE`/`websearch`-style; trigram index (`pg_trgm`) if available (probe at implement) else prefix + ILIKE. O3: exact search columns + index strategy. *(→ superseded by D7: plain ILIKE across the 3 text cols, backslash-first escape, bound param; pg_trgm not installed — matview+GIN is the measured-latency upgrade.)*
- Filters: by role (has role X), by status (confirmed / banned / anonymous). Sort: created_at, last_sign_in_at, email — asc/desc.
- UI (house paper theme): a real data table — sticky header, sortable column headers (aria-sort), a search input (debounced, URL-synced `?q=`), filter chips/selects, IntersectionObserver infinite scroll appending pages via a fetcher, empty/loading/end states, row = avatar-initial + name + email + roles badges + joined/last-seen. Reduced-motion safe. Mobile: table collapses to stacked cards (no horizontal scroll of PII). *(→ refined by D6/D8: the sentinel is an auto-loading "Load more" `<button>`; fetcher hits the same UI route; count on page 1 only.)*
- URL is the state owner: `?q=&role=&status=&sort=&dir=` (shareable, back-button correct); cursor is fetcher-local.

### Granting admin (v1)
Admin-script `scripts/grant-role.mjs <email> <role>` (house style): resolves email→auth.users.id via admin DSN, upserts lumen.user_roles, invariant-checks, dry-run capable. This is how Abram becomes the first admin. NO in-app role management UI in v1 (that's a future feature — the admin section is READ-only over users; assigning roles is out of scope, O4 to confirm).

### Explicitly out of scope
In-app role assignment/revocation UI, per-user detail/edit page, audit log of admin views, RLS policies (app is SELECT-only via lumen_read; the security boundary is the entitlement check + the SECURITY DEFINER projection, not RLS), pagination beyond keyset, bulk actions, CSV export, non-admin roles' actual feature gates (we build the mechanism + admin; wiring 'admin.users' is the only live entitlement).

## Harness (behavior scope → required)
`apps/web/app/lib/__tests__/entitlements.test.ts` + `apps/web/app/routes/__tests__/admin.users.test.ts` + `scripts/__tests__/grant-role.test.mjs`, DI-mocked db (no network):
- H1 role→entitlement flattening: multiple roles union their entitlements; unknown role slug contributes nothing; no roles → empty set.
- H2 requireEntitlement: present → passes; absent → throws 404 (not 403); degraded roles-load → treated as no entitlement (fail CLOSED — a DB blip must never open the admin door) AND happy path grants (tske B2 both directions).
- H3 admin loader: non-admin → 404 before any user query runs; admin → query shaped with search/filter/sort/keyset bound params; SQL contains the SECURITY DEFINER view name, ILIKE across the 3 text cols, keyset WHERE not OFFSET.
- H3b cursor requests skip the count query (count runs on page 1 only, per D8).
- H4 keyset pagination: nextCursor encodes the last row's sort key + id; a follow page's WHERE excludes the seen boundary (no dupes, no skips across ties).
- H4b malformed / sort-mismatched cursor → falls back to page 1, never throws (per D6: bad→page-1-never-throws; cursor's sort col+dir must match the URL's or it is discarded).
- H5 search sanitization: `%`/`_`/`\` in q are escaped with **backslash escaped FIRST** (the order is load-bearing — escaping `%`/`_` before `\` re-escapes the inserted backslashes; the test must assert the order, not merely that the three chars are escaped); no ILIKE wildcard injection; empty q → no search predicate.
- H6 grant-role script: email→id resolve, upsert idempotent, unknown email → exit 1, dry-run rolls back.
- H6b grant-role script: a role whose entitlements contain an unknown key (not in the F13 shared source) → exit 1, nothing written (D5: typos fail loudly at grant time).

*(H3b/H4b/H5-order/H6b added per worklist P6, plan-amendment 2026-07-10.)*

## Learnings surfaced (state/learnings.md + last 3 retros)
- strongs/canon-spine/art-graph: **one live DB probe before planning** — done, and it overturned the naive design (lumen_read can't touch auth.users → the whole SECURITY DEFINER bridge exists because of the probe).
- supabase-auth: **fail CLOSED on degraded authz** (the dropped-rotation lesson's cousin) → H2 asserts a roles-load failure denies, never opens.
- supabase-auth: **a proposed fix needs adversarial review too** → code-adversarial re-runs the search-escaping and keyset-cursor fixes against injection/tie vectors.
- tske: **removed-behavior/contract audit** — n/a (net-new), but the SELECT-only invariant is a contract the admin surface must not break (no writes from the app role).
- canon-spine: **critical-path roles run synchronously** if agents stall.

## Open questions → Panel-1
- O1: SECURITY DEFINER view vs function vs synced table for the auth.users→lumen bridge — which is safe AND correct given PG's `security_invoker` view default? (The whole feature's data access hinges on this.)
- O2: load roles in the root loader for every signed-in request (enables the Admin menu link) vs only in the admin loader — COR-2 weigh-in.
- O3: search columns + index (pg_trgm availability, ILIKE-escape, prefix vs full) for "really good search."
- O4: confirm v1 admin section is READ-only (no in-app role granting); granting is the admin script.
- O5: 404-not-403 for the gated route — right call for a contemplative app with a hidden admin area?

## Decisions (synthesis — panels 1+2; human gate waived; Abram's explicit ask is the tie-breaker)

Precedence: human > panel-2 > panel-1. Abram asked verbatim for "really good search across name/email, a table with filters and sorting, infinite scroll" — that ANCHORS scope against the product skeptic's minimalism, but every non-conflicting cut/hardening is taken.

- **D1 [crux — CONFIRMED-HARDER live]** Bridge = plain view `lumen.app_users` owned by `postgres` (`security_invoker=false` pinned), GRANT SELECT to lumen_read. Live-verified: the migration DSN connects as `postgres`, `rolbypassrls=true`, has auth USAGE — so it escapes the auth.users RLS-enabled-zero-policies trap that would silently return 0 rows to any non-bypass owner. Migration asserts owner bypassrls as an invariant_check.
- **D2 [REFUTED platform-data / must-fix]** `auth.users.created_at` IS NULLABLE (proven). The view projects `COALESCE(created_at,'epoch') AS created_at` and likewise `COALESCE(last_sign_in_at,'epoch')`, `COALESCE(email,'')` — so every sortable column is NON-NULL and the (sortcol,id) keyset is correct in both directions. This KEEPS Abram's multi-column sort (created_at, last_sign_in_at, email) instead of the skeptic's "created_at-only" forbiddance — COALESCE-in-view is the better fix that preserves the feature.
- **D3 [rejected-with-rationale — relabeled per DEC-A 2026-07-10]** *(Record correction: the original label "[CUT: both skeptics converge]" was false — only adversarial-authz cut the menu link; adversarial-product argued to KEEP a JWT-gated Admin link. Abram resolved the dissent: keep the cut; the JWT-link UX is the named fast-follow.)* No JWT `app_metadata.entitlements` stamp in v1. Resolves the O2 panel conflict: NO roles query in the root loader AND no JWT claim. Consequence: no entitlement-driven Admin menu link in v1 — Abram navigates to `/admin/users` directly (operator-only reality). grant-role.mjs therefore writes ONLY `lumen.user_roles` (single source of truth, no auth.users write, no jsonb-merge hazard, no revocation-staleness window). The JWT-link + in-app UX is the named fast-follow when a 2nd admin exists.
- **D4 [incorporated: H2 core]** Entitlements = fail-CLOSED. `getEntitlements(db, userId)` = ONE all-or-nothing query (roles ⨝ entitlements), whole load in a single try → empty Set on any error (the driver is **postgres.js** via drizzle-orm/postgres-js — *not node-pg*, attribution corrected per P9; the awaited buffered query rejects, never yields partial rows. Streaming APIs (`.cursor()`/`.forEach()`) are FORBIDDEN in this loader — they surrender the all-or-nothing guarantee). `requireEntitlement(db, userId, "admin.users")` throws `data(null,{status:404})` as the admin loader's FIRST statement (before any user query). H2 asserts BOTH directions (tske B2): grant on happy path, deny on degrade.
- **D5 [NEW: adversarial-product]** Known-entitlement-key guard: entitlement keys are a typed const union (`ADMIN_USERS = "admin.users"`); grant-role.mjs validates the role's entitlements against the known set and refuses unknown keys (a typo must fail loudly at grant time, not silently-closed at runtime).
- **D6 [incorporated: Abram's ask, Panel-1 UX shape]** Infinite scroll = auto-loading "Load more" `<button>` as the IntersectionObserver sentinel (keyboard-accessible, focus retained on append, back-button-correct). Keyset cursor (opaque base64url `{v,s,d,k,id}`, server-validated, bad→page-1-never-throws, encodes sort col+dir) + epoch race-guard (serialized filter set; append only when `fetcher.data.epoch===currentEpoch`; reset tail on `[epoch]`). Sort allow-list server-side (created_at|last_sign_in_at|email), never from cursor.
- **D7 [incorporated: Abram's ask]** Server-side search across email + display_name + full_name via `ILIKE '%'||escape(q)||'%' ESCAPE '\'`; escape BACKSLASH FIRST then %/_ (H5 asserts order). Bound param (no injection). pg_trgm not installed → seq scan, fine to ~10k users; matview+GIN is the measured-latency upgrade (same view name/grant). Search debounced 250ms, `submit({method:'get',replace:true})`, drops cursor.
- **D8 [incorporated]** Filters compose AND: role (has role X), status (confirmed/banned/anonymous — derived cols in the view). URL owns `?q&role&status&sort&dir`; cursor is fetcher-local. Fetcher hits the SAME UI route; count only on page 1 (no cursor), cursor pages return rows+nextCursor only.
- **D9 [right-sized: skeptic cuts taken where non-conflicting]** SKIP virtualization (0 users; revisit ~2k loaded rows — tripwire comment only). Real semantic `<table>` on desktop; simple responsive stack on mobile (no horizontal PII scroll) — kept because it's cheap, not the "essay." One aria-live count region (drop the second). Build a minimal shared `ui/input.tsx` (recurs — login hand-rolled one); INLINE the table markup in the route (no `ui/table.tsx` primitive until a 2nd consumer). Status badges use existing `outline`/`secondary`/`destructive` variants (NO new --success/--warning tokens — the base-only-token trap from last feature).
- **D10 [incorporated: O5 honest]** 404-not-403 gate, but do NOT oversell concealment: a timing side-channel (roles-query 404 slower than no-route 404) partially reveals the route exists. The real control is the entitlement gate, which holds. Documented, accepted.
- **D11 [grant path]** `scripts/grant-role.mjs <email> <role>` (house admin-script style: session-mode probe, DRY_RUN_ROLLBACK, invariant_checks, exit 0/1): resolve email→auth.users.id via admin DSN, validate role+entitlement keys (D5), upsert lumen.user_roles idempotently. This is how Abram becomes admin #1.
- **D12 [ESCALATE accepted: not live-verifiable e2e today]** 0 users + auth dashboard prereqs unset → no real sign-in → can't self-grant → the gated screen can't be exercised against a real session. Live proof = unit tests (H1-H6) + a post-deploy smoke that (a) probes `lumen.app_users` returns (coupling tripwire) and (b) confirms `/admin/users` 404s for an anonymous request. Full e2e deferred until Abram completes the Supabase dashboard config and self-grants.
- **D13 [deferred-out-of-scope]** in-app role grant/revoke UI (the fast-follow that bites soonest), per-user detail page, admin-view audit log + PII retention policy (real the day a 2nd human is admin — roadmap, not v1), matview+GIN search upgrade, 2nd non-admin role.

- **F2 [incorporated 2026-07-10]** redundant `idx_user_roles_user` removed from the DDL — the composite PK covers it; migration also `DROP INDEX IF EXISTS`es the one prod already has (re-run converges it).

Panel-1 findings previously left unlabeled (added per worklist P4, 2026-07-10):
- **admin-ux filter-chips (HIGH) [incorporated]** → D8 AND-composition + step-8 UI: active constraints render as removable chips (house badge/button idiom, chips wrap below the count bar, removal patches the URL). No new tokens.
- **admin-ux layout-shift/SWR spec (HIGH) [incorporated]** → D9's single fixed-height aria-live count/status bar under the search field; searching keeps stale results rendered (`aria-busy` + opacity on the results region only) so chrome height never changes.
- **platform-data db-discipline (MEDIUM) [incorporated]** → step-8 loader uses the request-scoped `context.db` only (never builds its own client); lifecycle already closed via `waitUntil(end())` in the worker.
- **admin-ux tone (MEDIUM) [incorporated]** → D9 register: same house tokens, denser functional register (`font-ui`, `text-sm`, `tabular-nums`, paper surfaces); no second design system.

## Drift baseline
- plan.md: 3aa94e27b5619693 (derivation: `sha256 of plan.md with this '## Drift baseline' section excluded, first 16 hex`; the pre-amendment hash `b63787e239a76678` was recorded without a documented derivation and is not reproducible — noted per the 2026-07-10 plan-amendment, which supersedes it)
- harness: entitlements.test.ts + admin.users.test.ts + grant-role.test.mjs (H1–H6, H3b/H4b/H6b) — hashed at implement-exit
