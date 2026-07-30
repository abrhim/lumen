# Panel-1 review — DATA-INTEGRITY (personal-notes, plan stage)

Reviewer lens: D2 schema + lifecycle (indexes, tsvector, RLS completeness,
soft-delete semantics, migration discipline). Scale honored: single-digit DAU,
Supabase Postgres, session pool cap 15. Not re-litigated: ProseMirror,
markdown storage, GROUP_KEYS.

Findings ranked by severity.

---

### DATA-1: D3's "no grant to lumen_read" is not achievable by omission — the schema has a default-privileges auto-grant

**Severity:** High (security / D3 structural guarantee silently void)

**Claim:** The plan (Files touched: "NO grant to lumen_read — see D3") reads as
if withholding a GRANT is sufficient. It is not: `scripts/setup-readonly-role.sql:16`
runs `ALTER DEFAULT PRIVILEGES IN SCHEMA lumen GRANT SELECT ON TABLES TO
lumen_read;`. Any table the admin role creates in `lumen` — including
`lumen.notes` and `lumen.note_anchors` — is **auto-granted SELECT to
lumen_read at CREATE TABLE time**. D3's "leakage becomes structurally
impossible" ships false unless the migration actively revokes.

**Evidence:** `/Users/abram/code/lumen/scripts/setup-readonly-role.sql:14-16`;
plan.md D3 + Files-touched bullet. The smoke script's D3 probe
(`scripts/smoke-notes-rls.mjs:132-140`) would catch this at run time — good —
but only when `ADMIN_DATABASE_URL` is present; it "skips with a warning"
otherwise, so a green smoke run without that env var proves nothing about D3.

**Proposed fix:**
1. `scripts/migrate-notes.mjs` DDL must contain, after CREATE TABLE:
   `REVOKE ALL ON lumen.notes, lumen.note_anchors FROM lumen_read;` and
   `REVOKE ALL ON lumen.notes, lumen.note_anchors FROM anon;` (anon inherits
   nothing today, but pin it — PostgREST exposure of the schema, DATA-8,
   changes the anon surface).
2. Add a migration invariant (house idiom, migrate-user-roles.mjs
   `lumen_read_select_only` style): `role_table_grants` for
   `lumen_read`/`anon` on both tables = **zero rows**, and for
   `authenticated` = exactly the intended CRUD set.
3. Amend plan D3 wording: "no grant" → "explicit REVOKE (default privileges
   in schema lumen auto-grant SELECT to lumen_read)".
4. Make the smoke D3 probe hard-fail (not skip) when `ADMIN_DATABASE_URL` is
   absent, or at minimum have the feature's verification checklist require a
   run with it set.

---

### DATA-2: note_anchors can be attached to another user's note — FK checks bypass RLS; owner_id denormalization can drift

**Severity:** High (cross-user data integrity)

**Claim:** D2's `note_anchors.owner_id` is "denormalized for RLS" with only a
plain `note_id fk cascade`. Postgres validates FK constraints **as the table
owner, bypassing RLS**. So user B, knowing (or guessing) one of A's note
UUIDs, can insert an anchor row with `owner_id = B` (satisfying B's own
WITH CHECK) but `note_id = <A's note>` — the FK passes even though B cannot
SELECT that note. Result: rows where `anchor.owner_id ≠ note.owner_id`,
i.e. B's anchors decorating A's note lifecycle (and cascade-deleted by A's
actions). Nothing in the schema as written prevents the drift the plan's own
"denormalized" label implies.

**Evidence:** plan.md D2; smoke-notes-rls.mjs has no probe for
B-anchors-A's-note (it only checks B reading/forging A's rows).

**Proposed fix:** enforce agreement declaratively with a composite FK — no
trigger needed:

```sql
ALTER TABLE lumen.notes ADD CONSTRAINT notes_id_owner_uniq UNIQUE (id, owner_id);
-- note_anchors:
FOREIGN KEY (note_id, owner_id)
  REFERENCES lumen.notes (id, owner_id) ON DELETE CASCADE
```

Anchor RLS WITH CHECK (`owner_id = auth.uid()`) + this FK ⇒ an anchor can
only ever reference a note the same user owns; drift is impossible by
construction, and cascade behavior is unchanged. Add the B-anchors-A's-note
probe to the smoke script (expect FK/RLS rejection).

---

### DATA-3: "deleted" is enforced only in app code — every future query is one forgotten filter away from resurrecting deleted personal notes

**Severity:** High (privacy expectation / leak class)

**Claim:** F8 says deleted notes are absent from /notes, rail, search — but
the harness pins this at the mock layer only
(`notes.routes.test.ts:84` — "`getNote` filters deleted_at" is *assumed via
mock*, the exact mock-only-loader failure mode the plan's own Learnings
section warns about). Nothing at the database layer enforces it. There are at
least four independent read paths (notes index, note page, chapter-loader
anchors, search leg), and every new one (backlinks, Desk register, personal
graph — all named in Out) must remember the filter. Worse, **note_anchors has
no deleted-awareness at all**: D5's chapter loader fetches anchors directly,
so a soft-deleted note's dot keeps rendering in the reader margin unless the
anchor query joins notes and filters — violating F8 as specified.

**Evidence:** plan.md D2/D5/F8; notes.routes.test.ts:81-89 (mock);
smoke-notes-rls.mjs has no deleted-invisibility probe at the PostgREST layer.

**Proposed fix:** enforce at RLS, the layer every path shares:
- `notes` SELECT policy: `owner_id = (select auth.uid()) AND deleted_at IS NULL`.
- `note_anchors` SELECT policy: owner check **plus**
  `EXISTS (SELECT 1 FROM lumen.notes n WHERE n.id = note_id AND n.deleted_at IS NULL)`
  — kills the ghost-dot path for free.
- UPDATE policy keeps plain ownership in USING/WITH CHECK so the
  soft-delete write itself is legal; the soft-delete action must not chain
  `.select()` after the update (the now-invisible row returns 0 rows — write
  the action accordingly and pin it in a test).
- Consequence to document: v1 has no trash/restore; restoring later means a
  policy change or service-role path. That is the right trade at this scale.
- Add a smoke probe: A soft-deletes (sets deleted_at) → A's own SELECT of
  that note and its anchors returns 0 rows via PostgREST.

---

### DATA-4: owner_id column contract unstated — the smoke script already depends on an FK to auth.users that D2 never declares

**Severity:** Medium-High (harness/schema contradiction; orphan rows in live DB)

**Claim:** smoke-notes-rls.mjs's cleanup deletes the throwaway users and
comments "their notes cascade" (line 10-11). That only holds if
`notes.owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`.
D2 says only "owner_id". Without the FK, every smoke run leaks two orphan
notes + anchors into the live database, and real account deletion strands
personal data forever (a privacy problem, not just hygiene). Separately, the
smoke insert at line 66-71 supplies **no owner_id**, so the column also needs
`DEFAULT auth.uid()` for the insert to pass NOT NULL.

**Evidence:** scripts/smoke-notes-rls.mjs:10-11,66-71,144-147; plan.md D2.

**Proposed fix:** pin the column in the plan's D2:
`owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE`.
Same shape on `note_anchors.owner_id` (default + not null; its cascade comes
via the DATA-2 composite FK, not a second auth.users FK). Add a migration
invariant asserting both FKs exist with `confdeltype = 'c'`.

---

### DATA-5: the plan names zero indexes — spell out the exact set its own queries need

**Severity:** Medium (correct-by-luck today, seq-scan + bloat later; cheap now)

**Claim:** D2 defines PKs only. The plan's queries are: (a) /notes index —
list my live notes, most-recently-edited first; (b) chapter loader (D5) — my
anchors for one chapter's refs; (c) search leg (D3) — tsvector match over my
live notes. House style is explicit named indexes in the DDL
(schema.ts: every table carries its `idx_*` set; user-roles even documents
*omitting* a redundant one). At single-digit DAU nothing burns, but RLS
tables are shared-tenant by nature and the GIN index otherwise carries
deleted rows forever (generated tsvector is still computed and indexed on
soft-deleted rows — pure bloat).

**Evidence:** plan.md D2/D5/D3; packages/scripture/src/schema.ts (house
idiom); precedent user-roles F2 comment on PK-covered lookups.

**Proposed fix:** exactly four objects, no more:

```sql
-- (a) /notes index listing
CREATE INDEX idx_notes_owner_recent ON lumen.notes (owner_id, updated_at DESC)
  WHERE deleted_at IS NULL;
-- (c) search leg; partial = no deleted bloat, and the query's
--     deleted_at IS NULL predicate is what makes the index eligible
CREATE INDEX idx_notes_search ON lumen.notes USING gin (search)
  WHERE deleted_at IS NULL;
-- (b) chapter loader: owner_id = ? AND kind = ? AND ref_id IN (...)
CREATE INDEX idx_note_anchors_owner_ref ON lumen.note_anchors (owner_id, kind, ref_id);
-- DATA-2 support (also the reverse lookup "anchors of this note" — the PK
-- already leads on note_id, so cascade needs nothing extra)
ALTER TABLE lumen.notes ADD CONSTRAINT notes_id_owner_uniq UNIQUE (id, owner_id);
```

Note the deliberate omission: no standalone index on `notes.owner_id`
(covered by `idx_notes_owner_recent` prefix) and none on
`note_anchors.note_id` (PK prefix) — record both omissions in the DDL
comment, user-roles style.

---

### DATA-6: tsvector config unspecified — a column/query config mismatch fails silently as "notes search barely matches"

**Severity:** Medium (silent-wrong search results)

**Claim:** D2 says "search tsvector GENERATED" with no config. A GENERATED
tsvector **requires** the two-argument immutable form, so a config must be
chosen explicitly. The entire existing search stack queries with
`websearch_to_tsquery('english', …)` (search.ts:322) and every existing
vector is `'english'` (setup-triggers-and-rls.sql:5,17; transcripts likewise).
If the notes column were built with `'simple'` (or left to a default), stems
would not align with the `'english'` query side and matches silently
evaporate — no error, just a search that "doesn't work well." Since the notes
leg runs through PostgREST `textSearch`, the query-side config must be pinned
there too (`textSearch('search', q, { config: 'english', type: 'websearch' })`),
matching the shared-path semantics users get for scripture.

**Evidence:** packages/scripture/src/search.ts:322-334;
scripts/setup-triggers-and-rls.sql:3-8; plan.md D2/D3.

**Proposed fix:** pin in D2:
`search tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(body_md,''))) STORED`
and pin the PostgREST call shape (`type: 'websearch'`, `config: 'english'`)
in D3. Add a migration invariant that reads
`pg_attribute`/`pg_attrdef` (or a functional probe: insert-as-authenticated a
row containing "believeth", assert `websearch_to_tsquery('english','believe')`
matches — stemming proves the config). Known accepted quirk to note in the
plan: 'english' stems archaisms imperfectly and the raw markdown (including
`[[ref-id|label]]` slugs) is what gets indexed — slugs being searchable is
acceptable-to-desirable in v1; do not add a strip step.

---

### DATA-7: body_md is unbounded — the GENERATED tsvector turns a huge paste into a raw 500, and there's no size contract at all

**Severity:** Medium (integrity + UX failure mode; one-line fix)

**Claim:** No limit anywhere on body size. tsvector has hard engine limits
(~1MB vector size, 16383 max positions); a sufficiently large paste into the
editor makes the GENERATED column computation fail at INSERT/UPDATE time —
surfacing as an opaque PostgREST 500 mid-save, i.e. data loss from the user's
seat. Below that cliff, multi-megabyte notes silently degrade the rail/search
paths. Personal notes have a natural size; pin it.

**Evidence:** plan.md D2 (no limit); Postgres tsvector documented limits.

**Proposed fix:** belt and suspenders, both cheap:
`CHECK (octet_length(body_md) <= 262144)` (256 KB — vastly above any real
note, far below the tsvector cliff) in the DDL, plus the same limit in
`notes.server.ts` validation returning a friendly 400 before PostgREST is hit
(F7's 400 path already exists for anchors; reuse it). Add a harness fixture:
oversized body → 400, nothing written.

---

### DATA-8: migrate-notes.mjs contract underspecified — and the PostgREST schema-exposure step lives OUTSIDE the migration, a real environment-drift trap

**Severity:** Medium (migration discipline / env drift)

**Claim:** The plan names the script but not its discipline. House idiom is
established (migrate-search-extensions.mjs, migrate-user-roles.mjs): dry-run
default with in-transaction `DRY_RUN_ROLLBACK`, prechecks gating any write,
JSON-line event logging, secret scrubbing, session-mode (port 5432) DSN
assertion, post-apply invariant checks including **negative** grant checks,
exit codes 0/1/2, and a rollback recipe in the header. Separately and more
dangerously: this feature is the **first PostgREST data path into the `lumen`
schema** (today's app reads go through Hyperdrive/lumen_read; only `auth.*`
flows through Supabase clients). PostgREST refuses schemas not in its
exposed-schemas list — adding `lumen` is a **Supabase dashboard/Management-API
config step, not SQL**, so `migrate-notes.mjs` cannot perform it, it isn't
version-controlled, and it can silently differ between local and prod (the
exact class of drift that produces "works locally, PGRST106 in prod").
`authenticated` also needs `USAGE` on schema lumen + table grants — that part
IS SQL and belongs in the migration.

**Evidence:** apps/web/app/lib/ contains no `.schema("lumen").from(...)`
usage today; smoke-notes-rls.mjs:67 assumes it works;
scripts/migrate-search-extensions.mjs + migrate-user-roles.mjs (idiom);
plan.md Files-touched.

**Proposed fix:** specify migrate-notes.mjs to contain:
1. **Prechecks:** lumen schema exists; `lumen_read` role exists; running
   role is admin/session-mode (`assertSessionMode` pattern).
2. **DDL (one transaction):** both tables (with DATA-2/4/5/6/7 shapes);
   `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`;
   per-command policies TO authenticated (write `auth.uid()` as
   `(select auth.uid())` — Supabase initplan idiom, free);
   `lumen.set_updated_at()` trigger (DATA-9); grants:
   `GRANT USAGE ON SCHEMA lumen TO authenticated;`
   `GRANT SELECT, INSERT, UPDATE, DELETE ON lumen.notes TO authenticated;`
   `GRANT SELECT, INSERT, DELETE ON lumen.note_anchors TO authenticated;`
   (no UPDATE on anchors — DATA-9); the DATA-1 REVOKEs.
3. **Invariants:** RLS enabled+forced on both; policy count/commands per
   table; grants-shape check (authenticated exact, lumen_read/anon zero);
   generated-column stemming probe (DATA-6); composite FK present (DATA-2);
   updated_at trigger fires (functional, in-tx).
4. **Header:** rollback recipe (`DROP TABLE lumen.note_anchors, lumen.notes;`
   safe — cascade-contained, no other object depends on them; note the
   reverse-order rule w.r.t. the web deploy, canon-spine precedent) and the
   deployment-order line (migration before web deploy — the notes routes
   read these tables).
5. **The exposure step:** document explicitly in the plan as a **manual gate
   item per environment**: Dashboard → Settings → API → "Exposed schemas" +=
   `lumen` (or Management API `PATCH /v1/projects/{ref}/postgrest`). Add it
   to the deploy checklist with the note that smoke-notes-rls doubles as the
   drift detector (PGRST106 ⇒ exposure missing in that environment). Also
   record the blast-radius review it forces: exposing `lumen` makes every
   table in the schema *addressable* via PostgREST for `anon`/`authenticated`
   — actual access is still gated by grants+RLS, which is why the DATA-1
   grants-shape invariant must cover the whole schema's grantee surface for
   `anon`, not just the two new tables.

---

### DATA-9: updated_at trigger — no house pattern exists to reuse; write one generic function; and note_anchors should be immutable (no UPDATE policy or grant at all)

**Severity:** Low-Medium (idiom + least-privilege)

**Claim:** setup-triggers-and-rls.sql contains only search-vector triggers;
no `updated_at` trigger exists anywhere (collections carries updated_at with
a bare default — it drifts on update, tolerated because scripts write it).
So "reuse the house pattern" isn't available; the feature must introduce one.
For note_anchors: rows are pure (note_id, kind, ref_id) identity + owner —
there is no mutable field. An "update" to an anchor is semantically
delete+insert. Granting/policying UPDATE on anchors is pure attack/bug
surface.

**Evidence:** scripts/setup-triggers-and-rls.sql (whole file); plan.md D2/F11.

**Proposed fix:** one generic function, notes-only trigger:

```sql
CREATE OR REPLACE FUNCTION lumen.set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_notes_updated_at BEFORE UPDATE ON lumen.notes
  FOR EACH ROW EXECUTE FUNCTION lumen.set_updated_at();
```

No trigger, no updated_at column, no UPDATE grant, no UPDATE policy on
note_anchors — record the omission as deliberate. (D6 LWW reads notes.updated_at
only, so nothing is lost.) F11's smoke probe already covers the notes trigger.

---

### DATA-10: soft-delete with no purge contract = unbounded retention of deleted personal data — pin the eventual contract now so the column semantics don't fossilize

**Severity:** Low (v1) / Medium (as it ages) — privacy posture

**Claim:** Q3's proposed default is soft-delete with "purge job later." If
the semantics of `deleted_at` aren't pinned now, later surfaces will grow
assumptions (trash UI? restore? analytics over deleted rows?) that make a
purge contract impossible to introduce without a breaking conversation.
"Deleted" personal spiritual notes retained indefinitely is a real, if quiet,
trust liability — and account deletion already hard-deletes via the DATA-4
cascade, so the system will have two inconsistent deletion strengths.

**Evidence:** plan.md Q3; no purge/retention language anywhere in the plan.

**Proposed fix:** amend Q3's default to carry the contract, not just the
mechanism: *deleted_at is a purge deadline, not an archive* —
`deleted_at IS NOT NULL` rows are permanently purgeable once
`deleted_at < now() - interval '30 days'`, no v1 job required (a later
`scripts/purge-notes.mjs` or pg_cron one-liner implements it without schema
change). Put that sentence in a `COMMENT ON COLUMN lumen.notes.deleted_at`
in the migration DDL and in any user-facing delete confirmation copy
("deleted notes are permanently removed after 30 days"). This costs nothing
now and prevents the column from fossilizing into de-facto infinite trash.

---

## Open-question input

- **Q3 (soft vs hard delete): keep soft**, with three riders this review
  makes load-bearing: (1) the deleted filter is enforced at **RLS**, not app
  code (DATA-3) — otherwise F8 is one forgotten `.is('deleted_at', null)`
  away from leaking on every new surface; (2) anchors of deleted notes are
  invisible via the anchors SELECT policy's EXISTS clause (DATA-3) — the plan
  as written renders ghost dots; (3) the 30-day purge deadline is pinned in a
  column comment now, job deferred (DATA-10). Explicitly accept the
  documented consequence: no trash/restore in v1, and the soft-delete action
  cannot `.select()` its own result.
- **Q4 (derived title):** no data-integrity objection — but note the search
  leg's snippet/title derivation then happens over `body_md` at query/render
  time; make sure the search-leg SELECT doesn't ship the full body of every
  hit to the route layer just to derive titles (project a
  `left(body_md, 200)` or similar; the plan's F6 escaping surfaces then cover
  a bounded string).
- **Q7 (LWW):** compatible with the DATA-9 trigger — but the action must
  read fresh `updated_at` from a follow-up SELECT (or the UPDATE's
  RETURNING while the row is still visible, i.e. only non-delete updates),
  given DATA-3's SELECT policy.

## Harness gaps

Ordered by the leak they'd catch:

1. **Cross-note anchor forge (DATA-2):** B inserts an anchor with
   `note_id = <A's note>` — smoke must assert rejection. Today's smoke only
   probes B against A's *rows*, never A's *note_id as a foreign target*.
2. **Deleted-invisibility at the PostgREST layer (DATA-3):** A soft-deletes,
   then A's own `select` on notes AND note_anchors returns zero rows. F8 is
   currently pinned only through a vitest mock
   (notes.routes.test.ts:84, "notes.server filters deleted_at" — assumed,
   not proven), which is the exact mock-only-loader gap the plan's Learnings
   section promises to avoid.
3. **D3 probe must not be skippable (DATA-1):** smoke-notes-rls.mjs:141-143
   downgrades the single check that guards the feature's headline isolation
   claim to a warning when ADMIN_DATABASE_URL is unset. Fail, or gate the
   feature's verification checklist on a run with it set. Extend the same
   probe to `anon` and to an exact-shape check for `authenticated`.
4. **Grants-shape probe for the exposure blast radius (DATA-8):** once
   `lumen` is PostgREST-exposed, assert `anon` holds zero table grants across
   the entire schema, not just the two new tables.
5. **Constraint probes:** invalid `kind` → CHECK rejection; duplicate
   (note_id, kind, ref_id) → PK conflict surfaced as a clean 409/400 at the
   action layer; oversized body_md → 400 with nothing written (DATA-7).
6. **User-deletion cascade (DATA-4):** the smoke cleanup silently *depends*
   on notes cascading from auth.users deletion — turn the assumption into an
   assertion (after `deleteUser(a)`, service-role SELECT of A's note ids
   returns zero rows). Otherwise every smoke run may be quietly seeding
   orphan rows and the suite stays green.
7. **Stemming/config probe (DATA-6):** one smoke insert containing an
   inflected form, matched via `websearch` textSearch with the query-side
   config the app will use — proves column and query configs agree in the
   deployed environment, not just in the migration's invariant.
