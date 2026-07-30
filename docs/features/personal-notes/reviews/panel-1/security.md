# Security review — personal-notes (plan stage, panel-1)

Reviewer lens: authn/authz, RLS design, injection, XSS, session handling,
existence leaks, PostgREST exposure surface, data lifecycle. Calibrated to
single-digit DAU, personal religious-study notes (sensitive-ish), Workers +
Supabase. Findings ranked most severe first.

### SEC-1: Exposing schema `lumen` to PostgREST exposes the whole schema — including `lumen.app_users`, a postgres-owned view over `auth.users`

**Severity: high**

**Claim.** The write path (D1) and the smoke script both use
`.schema("lumen")` via supabase-js, which requires adding `lumen` to
Supabase's *Exposed schemas* and granting `USAGE`/table privileges to the
`authenticated` (and implicitly `anon`) API roles. That flips a schema that
was designed for a SELECT-only direct-DSN consumer (`lumen_read`) into an
API-addressable surface for every JWT holder. What else is in that schema is
not neutral:

- `lumen.app_users` (scripts/migrate-user-roles.mjs:88–106) is a view
  **owned by postgres with `security_invoker = false`** over `auth.users` —
  email, display name, full name, last_sign_in_at, banned state for every
  user. Any `SELECT` grant that reaches it (e.g. the Supabase-docs
  copy-paste `GRANT SELECT ON ALL TABLES IN SCHEMA lumen TO authenticated`)
  hands any signed-in user the full user directory, executed with owner
  (BYPASSRLS) privileges. RLS cannot save you here — it's a definer-style view.
- `lumen.roles`, `lumen.user_roles` (migrate-user-roles.mjs:58–71),
  `lumen.transcripts`, `lumen.search_index` (migrate-media-collections.mjs),
  `lumen.kjv_variants`, `lumen.migration_state`, `lumen.entity_degree`,
  `lumen.word_tags`, `lumen.strongs_lexicon` have **RLS disabled** — no
  `ENABLE ROW LEVEL SECURITY` anywhere for them. A broad grant makes them
  readable; a `GRANT ALL` copy-paste makes them **writable** (a self-service
  `INSERT INTO lumen.user_roles` is admin-entitlement escalation via
  entitlements.server.ts).
- `lumen.collections` has RLS enabled but policy `USING (true)`
  (scripts/setup-triggers-and-rls.sql:41–43) while the actual visibility
  model (`public = false` = the Unshaken kill switch) is enforced only at
  the app layer (`getCollectionAccessStrict`). A grant to `authenticated`
  re-opens killed collections to any signed-in user, PostgREST-direct.
- Functions in an exposed schema become `/rpc/` candidates, and Postgres
  grants `EXECUTE` to `PUBLIC` **by default** on new functions. Today's two
  are trigger-returning (uncallable), but the first future helper function
  in `lumen` ships pre-granted.

**Evidence.** scripts/smoke-notes-rls.mjs:67 (`.schema("lumen")`);
migrate-user-roles.mjs:88 (`security_invoker = false`), :106
(`ALTER VIEW lumen.app_users OWNER TO postgres`); setup-triggers-and-rls.sql
(RLS on exactly five tables, all `USING (true)`); no
`ENABLE ROW LEVEL SECURITY` for roles/user_roles/transcripts/search_index in
any migration (grep across scripts/).

**Proposed fix.** The migration must treat exposure as the dangerous half of
the feature, not a config footnote:

1. `GRANT USAGE ON SCHEMA lumen TO authenticated;` — **nothing to `anon`**.
2. `GRANT SELECT, INSERT, UPDATE, DELETE ON lumen.notes, lumen.note_anchors
   TO authenticated;` — and no other relation, ever, in this migration.
3. Explicitly `REVOKE ALL ON lumen.app_users, lumen.user_roles, lumen.roles,
   lumen.migration_state FROM authenticated, anon;` (idempotent belt even if
   nothing granted them — protects against a later broad grant).
4. `ALTER DEFAULT PRIVILEGES IN SCHEMA lumen REVOKE EXECUTE ON FUNCTIONS
   FROM PUBLIC;`
5. Extend the smoke D3 probe into a **negative-space sweep**: assert
   `authenticated` and `anon` have zero grants on every `lumen` relation
   except the two notes tables (query `information_schema.role_table_grants`
   for the whole schema, not just the notes tables).

### SEC-2: D3's "no grant to lumen_read" is defeated by an existing DEFAULT PRIVILEGES rule — the notes tables auto-grant at CREATE

**Severity: high**

**Claim.** scripts/setup-readonly-role.sql:16 runs
`ALTER DEFAULT PRIVILEGES IN SCHEMA lumen GRANT SELECT ON TABLES TO
lumen_read;`. Default privileges attach to objects created by the role that
ran that statement (the admin/postgres role — the same role
`migrate-notes.mjs` will connect as via `ADMIN_DATABASE_URL`). So
`CREATE TABLE lumen.notes` **automatically grants SELECT to lumen_read** the
moment it runs. The plan's D3 headline ("lumen_read gets no grant — leakage
structurally impossible") is false by default; "don't write a GRANT" is not
the same as "no grant exists". The smoke probe
(scripts/smoke-notes-rls.mjs:132–140) would catch it post-migration — good —
but as written the migration ships red on its own D3 assertion, and the
likely "fix" under time pressure is weakening the probe rather than the
grant.

Secondary: even with the grant revoked, make the RLS policies themselves the
second wall — policies declared `TO authenticated` exclude `lumen_read` (and
any future role) structurally, and `auth.uid()` is NULL on the direct DSN
anyway. Two independent walls, both probed.

**Evidence.** setup-readonly-role.sql:14–16; PostgreSQL default-privileges
semantics (per-grantor, fires at object creation); smoke-notes-rls.mjs D3
probe checks `role_table_grants` only for the two tables and only for
`lumen_read`.

**Proposed fix.** migrate-notes.mjs must, after CREATE:
`REVOKE ALL ON lumen.notes, lumen.note_anchors FROM lumen_read;` with a
comment naming setup-readonly-role.sql:16 as the reason. Declare every notes
policy `TO authenticated`. Extend the D3 smoke probe to also check
`pg_default_acl` has not been widened for the notes tables' schema since.

### SEC-3: RLS policy shape is unspecified — UPDATE without WITH CHECK lets an owner reassign `owner_id`, planting a note in another user's notebook

**Severity: med**

**Claim.** The plan says only "RLS `owner_id = auth.uid()` on both tables,
all operations" (D1). That sentence is compatible with a single
`FOR ALL USING (owner_id = auth.uid())` policy — which is exactly the wrong
shape: `USING` alone on UPDATE filters *which rows you may touch* but not
*what they may become*. A can `UPDATE lumen.notes SET owner_id = '<B's
uuid>' WHERE id = <A's note>` — passes USING (A owns it now), and without
`WITH CHECK` the row transfers into B's notebook. For personal religious
notes that is a harassment vector (unwanted content appearing among B's own
notes, indistinguishable from B's) and a data-integrity break (note_anchors
`owner_id` now disagrees with the note's). The smoke script tests INSERT
forging (F1b, smoke-notes-rls.mjs:103–107) but never UPDATE reassignment.

Also unstated: `owner_id` needs `DEFAULT auth.uid()` — the smoke script's
own insert (line 69) omits `owner_id` and expects success.

**Evidence.** plan.md:101–102 (D1 wording); smoke-notes-rls.mjs:69 (insert
without owner_id), :103–107 (INSERT-only forge test); PostgreSQL RLS
semantics (UPDATE checks USING on old row, WITH CHECK on new row; absent
WITH CHECK defaults to the USING expression only for `FOR ALL`/`FOR UPDATE`
policies *if written as one policy* — but the plan doesn't pin the shape, so
pin it).

**Proposed fix.** Specify in the plan (and DDL) four explicit policies per
table, all `TO authenticated`:
`SELECT USING (owner_id = auth.uid())`;
`INSERT WITH CHECK (owner_id = auth.uid())`;
`UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())`;
`DELETE USING (owner_id = auth.uid())`. `owner_id uuid NOT NULL DEFAULT
auth.uid()`. Add the UPDATE-reassignment probe to the smoke script (A
attempts `SET owner_id = B` on A's own note → 0 rows / error).

### SEC-4: `note_anchors` can be forged onto another user's note — FK checks bypass RLS

**Severity: med**

**Claim.** D2's anchor table carries `owner_id` denormalized for RLS plus
`note_id fk cascade`. RLS on note_anchors (`owner_id = auth.uid()`) does not
constrain `note_id`: A can insert `{note_id: <B's note uuid>, owner_id: A,
kind, ref_id}` — the FK existence check runs with table-owner privileges
(FKs bypass RLS by design), so the row lands. Consequences: (a) junk rows
attached to B's note that B can never see or delete but that cascade-delete
with B's note; (b) a **note-existence oracle** — FK violation vs success
tells A whether a guessed note uuid exists (uuid4 makes guessing
impractical, hence med-low, but the oracle is real if ids ever leak into
URLs/logs); (c) if any future query joins anchors→notes by note_id trusting
anchor.owner_id, it crosses tenants.

**Evidence.** plan.md:104–107 (D2); PostgreSQL FK/RLS interaction
(constraint checks are exempt from RLS).

**Proposed fix.** Make ownership agreement structural: add
`UNIQUE (id, owner_id)` on notes and declare the anchor FK as the composite
`FOREIGN KEY (note_id, owner_id) REFERENCES lumen.notes (id, owner_id) ON
DELETE CASCADE`. Now a forged cross-owner anchor fails the FK itself, and no
denormalization drift is possible. Add a smoke probe: B inserts an anchor
with `note_id` = A's note → rejected.

### SEC-5: Data lifecycle holes — no `owner_id → auth.users` FK is specified, and the smoke script *assumes* a cascade it never asserts

**Severity: med**

**Claim.** D2 lists `owner_id` with no REFERENCES clause. The smoke script's
header (smoke-notes-rls.mjs:9–10) says "deletes both users at the end (their
notes cascade)" — but no schema line creates that cascade, and the script
hard-deletes the note (line 122) *before* deleting the users, so the
user-deletion cascade is never observed. If the FK is absent: (a) the smoke
script leaks rows into the live DB on every run where an assertion path
skips the manual delete; (b) real account deletion (Supabase admin or future
self-serve) **orphans the user's entire body of personal religious notes
forever**, owned by a uuid that no longer resolves. For this data class that
is the single worst lifecycle outcome. Soft-delete compounds it: `deleted_at`
rows persist indefinitely ("purge job later", Q3) and remain in the
generated tsvector.

**Evidence.** plan.md:103–107 (D2, no FK to auth.users);
smoke-notes-rls.mjs:9–10 vs :122 (cascade claimed, never asserted).

**Proposed fix.** `owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES
auth.users (id) ON DELETE CASCADE` on notes (anchors cascade via the note
FK). Add a smoke assertion after `a.cleanup()`: service-role SELECT for
A's remaining notes/anchors → zero rows. Record a retention decision in the
plan for soft-deleted rows (even "purged after 30 days, job deferred, risk
accepted" is a decision; silence is not).

### SEC-6: Session-rotation Set-Cookie propagation across the new surfaces — B4's exact failure mode, now on a write path, unharnessed

**Severity: med**

**Claim.** Every new server touchpoint reads the session and therefore can
mint rotation cookies that MUST ride the response (auth.server.ts:24–27,
D5 doctrine: a dropped rotation commit permanently kills the session):
`/notes` loader, `/notes/:id` loader, the notes **actions** (which
additionally run PostgREST calls under the same client — an expired access
token refreshes inline mid-action), the chapter loader's per-user anchor
fetch (D5), and the api.search notes leg. search-ui B4
(docs/features/search-ui/bugs.md:41–46) was precisely "loader read
getSessionUser, returned a plain object + static headers(), rotation
dropped, session silently killed" — and it shipped despite review. The new
risk is worse on actions: the create action's likely shape is
`redirect(\`/notes/${id}\`)`, and a bare `redirect()` carries no
commitHeaders. The routes harness
(apps/web/app/routes/__tests__/notes.routes.test.ts) mocks getSessionUser
with a bare `headers: new Headers()` and asserts nothing about response
headers on any path — the B4 mode is invisible to it.

**Evidence.** auth.server.ts:22–27, :100–121 (memo + commitHeaders
contract); bugs.md B4; notes.routes.test.ts:26–30 (headers never asserted).

**Proposed fix.** Plan-level rule: every notes loader/action returns via
`data(..., { headers: session.headers })` or
`redirect(..., { headers: session.headers })`, including 400/404/500 paths.
Harness: seed the mocked session with a sentinel `Set-Cookie` and assert it
appears on (a) the signed-in index loader response, (b) the create action's
redirect, (c) the 400 anchor-validation response.

### SEC-7: Adding `notes` to the shared GROUP_KEYS changes the signed-out contract and feeds an unhandled key into the canon engine

**Severity: med**

**Claim.** The harness pins `GROUP_KEYS[0] === "notes"`
(packages/scripture/src/__tests__/notes-harness.test.ts:7–19), but
GROUP_KEYS is the *canon engine's* dispatch table, not just a display order:
`searchAll` defaults `scope = [...GROUP_KEYS]` (search.ts:679) and emits one
group per scope key (search.ts:690), and `parseScope` validates against
GROUP_KEYS (search-request.server.ts:36). Consequences the harness does not
cover: (a) every **signed-out** `/api/search` response now contains
`{key:"notes", results:[]}` from searchAll itself — directly violating F2's
"byte-compatible with today"; (b) `buildLegs` receives a `notes` key it has
no leg for (throw → the combined-statement path 500s, or silent skip —
either way unpinned); (c) `scope=notes` and `after`-cursors minted for scope
`notes` become *valid anonymous inputs* on the lumen_read path. D3's
isolation is grants-based; this is the contract/DoS/noise half it doesn't
cover.

**Evidence.** search.ts:679, :690; search-request.server.ts:36–46;
notes-harness.test.ts:7–24; plan.md F2/F9.

**Proposed fix.** Split the constants: `GROUP_KEYS` (full, display/merge
order, includes `notes`) vs `CANON_GROUP_KEYS` (what searchAll defaults to
and buildLegs accepts — excludes `notes`). Route layer: strip `notes` from
the scope handed to searchAll; run the notes leg separately (user JWT);
define and pin signed-out `scope=notes` (recommend: valid parse, empty
result — indistinguishable from "no notes", no feature-existence leak) and
signed-out byte-compat as a fixture test against the *current* response
shape.

### SEC-8: No size bound on `body_md` — the generated tsvector column turns oversized notes into 500s, and Workers rendering has no budget

**Severity: low**

**Claim.** PostgREST writes bypass every editor constraint — the stored body
is whatever a JWT holder POSTs. Nothing in D2 or F-list bounds `body_md`.
Failure modes: a multi-MB body makes the generated `search` tsvector column
error at write time (tsvector hard limits: ~1MB total, 16383 positions) —
surfacing as opaque PostgREST 500s rather than a 400; `renderNoteHtml` and
the round-trip parse run unbounded input on Workers CPU-time limits; storage
is unmetered per user. At single-digit DAU this is not an attack magnet, but
it costs one CHECK constraint now versus a data migration later.

**Evidence.** plan.md D2 (no length constraint); F7 covers ref validity,
nothing covers body size.

**Proposed fix.** `CHECK (octet_length(body_md) <= 65536)` (64 KiB is ~30
pages of notes) on the table; mirror as a 400 in the action with a friendly
message; one harness fixture for the 400 and one smoke probe that an
over-limit PostgREST-direct insert is rejected by the DB, not just the app.

### SEC-9: Notes search leg must pin `websearch` tsquery semantics — the supabase-js default lets hostile `q` reach `to_tsquery`

**Severity: low**

**Claim.** The canon path already uses `websearch_to_tsquery`
(search.ts:322), which never throws on user input. supabase-js
`.textSearch()` without `type` uses the plain `fts` operator →
`to_tsquery`, where `q = "a & (b"` or `!!!` is a syntax error → PostgREST
error → the notes leg 500s on inputs the canon legs handle fine. Not an
injection (it stays inside tsquery parsing), but an unpinned
error-surface divergence between the two engines on the same `q`.

**Evidence.** search.ts:322 vs plan.md D3 ("textSearch on the generated
tsvector" — type unspecified); no hostile-q fixture in
notes-search-merge.test.ts.

**Proposed fix.** Pin `{ type: "websearch" }` in notes.server.ts's search
call; add fixtures for `"a & (b"`, `"!"`, `"' OR 1=1 --"` asserting the leg
returns empty/normal, never throws.

### SEC-10: `/notes/:id` id-shape and the two unharnessed render surfaces (derived title, search snippet)

**Severity: low**

**Claim.** Two small fail-closed gaps: (a) a non-uuid `:id`
(`/notes/../foo`, `/notes/x'`) flows into PostgREST `.eq("id", ...)` →
Postgres `22P02 invalid input syntax for type uuid` → 500 where the contract
(F8) says 404; the routes harness only tests a well-formed-but-absent id.
(b) F6 names three render surfaces (note page, rail, search snippet) but the
harness only exercises `renderNoteHtml`. The rail and search rows will
render the **derived title** (first line of user markdown — Q4) and a body
snippet. If those render as JSX text nodes they're safe by construction, but
nothing pins that: one `dangerouslySetInnerHTML` for a highlight-mark or a
`<title>`/meta interpolation and F6 is violated with zero red tests. The
derived title also needs markdown *stripping* (a title of
`[[alma-32-21|x]]` or `# <script>` should display as clean text, length-capped).

**Evidence.** notes.routes.test.ts:82–89 (absent-id only);
notes-render.test.ts (renderNoteHtml only); plan.md F6 names all three
surfaces; Q4 derived title.

**Proposed fix.** Validate uuid shape in loader/action before any query →
404 (same status as absent — no shape-vs-existence oracle, keeps logs
clean). Add a `deriveNoteTitle` unit with hostile fixtures (HTML, wikilink,
300-char line) pinning plain-text output; add one assertion that search
snippet / rail row content is plain text (no `<` survives un-escaped in
whatever snippet helper ships).

## Open-question input

- **Q1 (Playwright): yes** — and make one of the ~6 flows a security flow:
  signed-out visits `/notes` and a known note URL (redirects, no content
  flash), plus signed-in user B navigating to user A's note URL → 404. RLS
  smoke covers PostgREST; only e2e covers the loader/HTML path.
- **Q3 (soft vs hard delete): soft is fine, conditional** on SEC-5: the
  `auth.users` FK cascade is specified, every read surface filters
  `deleted_at IS NULL` (F8), and the plan records a retention decision for
  deleted rows instead of an open-ended "purge later".
- **Q4 (derived title): derived is fine, conditional** on SEC-10: title is
  derived by a dedicated stripped-plain-text helper with hostile fixtures,
  never by rendering markdown.
- **Q5 (markdown-it): yes** — with the config pinned in a test, not just
  set: `html: false`, `linkify` absent/off, `validateLink` default (or
  stricter allowlist `/^\/(scripture|people|places|topics|media)\//` for
  wikilink hrefs since all resolved targets are internal), and the rule
  whitelist enumerated so a markdown-it upgrade enabling a new default rule
  turns a test red.
- **Q6 (mobile compose): no security delta** beyond the same action/session
  rules (SEC-6).
- **Q7 (LWW): acceptable at this scale** — single-user-per-account data;
  no cross-tenant integrity depends on optimistic locking. Return of fresh
  `updated_at` leaks nothing.

## Harness gaps

Security assertions the current harness does not make:

1. **UPDATE owner_id reassignment** (SEC-3): smoke probe — A sets
   `owner_id = B` on A's own note → 0 rows/error (WITH CHECK).
2. **Cross-note anchor forge** (SEC-4): smoke probe — B inserts an anchor
   with `note_id` = A's note → rejected (composite FK).
3. **Anon PostgREST probe** (SEC-1): a publishable-key client with *no
   session* selects/inserts on `lumen.notes` → permission denied. Also
   remove smoke-notes-rls.mjs:53's `?? SUPABASE_SERVICE_ROLE_KEY` fallback —
   the user clients must never be constructible with the service key.
4. **Negative grants sweep** (SEC-1/SEC-2): assert `authenticated`/`anon`
   hold zero grants on every `lumen` relation except the two notes tables —
   `lumen.app_users`, `lumen.user_roles`, `lumen.collections` by name — and
   `lumen_read` holds none on the notes tables *including via
   `pg_default_acl`*.
5. **auth-user deletion cascade** (SEC-5): after `cleanup()`, service-role
   SELECT finds zero rows owned by the deleted users.
6. **Set-Cookie propagation** (SEC-6): sentinel rotation cookie asserted on
   the signed-in index loader, the create action's redirect, and the 400
   path.
7. **Signed-out byte-compat with GROUP_KEYS grown** (SEC-7): fixture pinning
   that the anonymous `/api/search` body contains no `notes` group and that
   `scope=notes` signed-out behaves as decided.
8. **Soft-deleted notes filtered from the search leg** (F8 claims it; no
   test queries the leg with a deleted note in place — add to smoke).
9. **Body size cap** (SEC-8): app 400 + DB CHECK rejection probes.
10. **Hostile tsquery inputs** on the notes leg (SEC-9).
11. **Derived-title / snippet plain-text pinning** (SEC-10) and non-uuid
    `:id` → 404 (not 500) in the routes test.
