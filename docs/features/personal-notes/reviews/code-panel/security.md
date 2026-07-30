# Code panel — SECURITY (personal-notes, step 9)

Lane: authn/authz on new routes+actions, RLS assumptions in app code, the
SECURITY DEFINER/INVOKER functions in `scripts/migrate-notes.mjs`, input
validation, XSS in the render/derive producers, the signed-out byte-freeze,
cookie/session header propagation, e2e secret hygiene.

Read in full: plan.md, migrate-notes.mjs, smoke-notes-rls.mjs, notes.server.ts,
notes-render.server.ts, notes-derive.ts, notes-markdown-config.ts,
notes-canonical.server.ts, notes-enabled.ts, notes-refs.ts, notes.tsx,
notes.$id.tsx, api.search.tsx, search-request.server.ts, the scripture/media
diffs, NoteEditor.tsx, markdown.ts, escape-registry.ts, e2e/support/session.ts,
auth.server.ts, login.tsx, auth.confirm.tsx, and markdown-it 14.3.0's renderer /
zero preset / text_join source.

---

## SEC-1: /notes and /notes/:id serve private note bodies with no `Cache-Control`

**Severity:** high
**Category:** authz / response hygiene (house SECURITY-3 deviation)
**File:** `apps/web/app/routes/notes.tsx:21-24,32-42`;
`apps/web/app/routes/notes.$id.tsx:46-49,73,93-102`

**Claim.** Every other session-varying surface in this repo sets
`Cache-Control: private, no-store` on *every* exit — `search.tsx:230` ("F17: on
EVERY exit"), `search.tsx:396` (a `headers()` export specifically so the RR
single-fetch `.data` variant inherits it), `book.tsx:34`, `scripture.tsx:582`
("the rotated auth Set-Cookie this 301 may carry must never be cached and
replayed to another visitor (SECURITY-3)"), and `api.search.tsx:31-40,238-240`.
The two new notes routes set it on **none** of their loader exits:

- `notes.tsx:32` returns `data({notes: …}, {headers})` where `headers` is only
  the session-commit Headers — the SSR HTML carrying every note title and
  snippet the user owns ships with no cache directive.
- `notes.$id.tsx:93` returns the full rendered note body the same way.
- `notes.$id.tsx:46-49` / `notes.tsx:21-24` — `loginRedirect` builds a 302 that
  carries `headers` (correctly, per CF-31) but no `Cache-Control`. This is the
  exact hazard `scripture.tsx:582` documents: a redirect that may carry a
  rotated auth `Set-Cookie`, cacheable and replayable.
- Neither route exports a `headers()` function, so the `.data` protocol
  responses the client fetchers consume get nothing either (the B17/OC-4
  problem `api.search.tsx:230-240` was written to fix).

Only the *action* JSON is covered (`notes.$id.tsx:51-56`).

Honest exposure sizing: Cloudflare does not cache HTML without a
Cache-Everything rule, and a 200 with no validator is not heuristically
freshenable by most caches, so this is not a live leak today. The concrete
exposure is browser disk cache / back-forward on a shared device, any future
edge cache rule, and the Set-Cookie-replay class the codebase already names. The
defect is that a documented, uniformly-applied house invariant was skipped on the
one route family whose payload is *personal devotional data* — the asset the
feature's whole threat model is built around.

**Proposed fix.** Add to both route modules:
```ts
export function headers() { return { "Cache-Control": "private, no-store" }; }
```
and set the same header on the `data(...)` headers and inside `loginRedirect`
(mirror `search.tsx`'s `withNoStore(session?: Headers)` helper — import it or
lift it to a shared module). Add a route test asserting the header on 200, 302
and 404 exits, alongside the existing session-header sentinel pins.

---

## SEC-2: `GRANT USAGE ON SCHEMA lumen TO authenticated` exposes pre-existing lumen functions; the negative-space sweep only covers tables

**Severity:** medium
**Category:** privilege exposure
**File:** `scripts/migrate-notes.mjs:199,208,265-270`;
`scripts/smoke-notes-rls.mjs:186-191`

**Claim.** `GRANTS_SQL:199` grants `USAGE ON SCHEMA lumen` to `authenticated`
for the first time. Postgres grants `EXECUTE` to `PUBLIC` by default on every
function at creation, and `authenticated` is a member of `PUBLIC`. Schema USAGE
was the only thing standing between `authenticated` and the lumen functions
already in the database:

- `lumen.kjv_delta(text)` (`scripts/migrate-search-kjv.mjs:26`)
- `lumen.update_verse_search_vector()` (`migrate-search-kjv.mjs:38`,
  `setup-triggers-and-rls.sql:3`)
- `lumen.update_entity_search_vector()` (`migrate-search-kjv.mjs:46`,
  `setup-triggers-and-rls.sql:15`)

Because `lumen` is now in PostgREST's exposed schemas (plan: "FORMER BLOCKERS
CLEARED"), these are reachable as `POST /rest/v1/rpc/kjv_delta` with
`Content-Profile: lumen` by any signed-in user.

The mitigation at `:208` — `ALTER DEFAULT PRIVILEGES IN SCHEMA lumen REVOKE
EXECUTE ON FUNCTIONS FROM PUBLIC` — is **forward-only and grantor-scoped**: it
affects functions created *after* it, by the *same role*. It does nothing to the
three above. The explicit `REVOKE EXECUTE` lines at `:209-213` name only this
migration's own three functions.

The invariant that is supposed to close this (`:265-270`,
`authenticated_anon_zero_grants_elsewhere_in_lumen`) queries
`information_schema.role_table_grants` — **tables and views only**. It has no
visibility into `pg_proc.proacl`, so it reports green while the function surface
is wide open. The smoke's equivalent sweep (`smoke-notes-rls.mjs:186-191`) has
the identical table-only blind spot.

Actual impact today is low (`kjv_delta` is a pure string transform; the two
trigger functions raise "can only be called as a trigger" when invoked
directly). The finding is that the *sweep is structurally incomplete* — the
control the plan relies on to make exposure safe does not observe half the
namespace, and the next lumen function anyone writes inherits PUBLIC EXECUTE
plus a now-open door.

**Proposed fix.** In `GRANTS_SQL`, add an idempotent blanket revoke before the
targeted grants:
```sql
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA lumen FROM PUBLIC, anon, authenticated;
```
(then the existing `GRANT EXECUTE ... TO authenticated` lines re-grant exactly
the two the app needs). Add a matching invariant:
```sql
SELECT count(*) = 2 AS pass FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'lumen'
  AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
       OR has_function_privilege('anon', p.oid, 'EXECUTE'))
```
and the same probe in `smoke-notes-rls.mjs`'s negative-space block.

---

## SEC-3: the `lumen_read` default-privilege auto-grant is never neutralized, and the smoke assertion that claims to cover it is a hardcoded pass

**Severity:** medium
**Category:** privilege exposure / harness integrity
**File:** `scripts/migrate-notes.mjs:203`; `scripts/smoke-notes-rls.mjs:181-185`

**Claim.** `scripts/setup-readonly-role.sql:16` installs
`ALTER DEFAULT PRIVILEGES IN SCHEMA lumen GRANT SELECT ON TABLES TO lumen_read`.
CF-9 correctly identified that this defeats "don't write a GRANT", and
`migrate-notes.mjs:203` fixes it *for the two tables this migration creates*:
`REVOKE ALL ON lumen.notes, lumen.note_anchors FROM lumen_read, anon`.

The default-ACL itself is left in place. D3's guarantee ("leakage through the
shared search path becomes structurally impossible") therefore holds only for
today's two tables — the next `CREATE TABLE lumen.*` (note_versions, a
trash/restore table, note_shares, anything the accepted "future trash/restore
feature needs its own privileged path" consequence implies) is auto-granted
SELECT to `lumen_read`, which is the app's shared search credential. That is
exactly the D3 hole, re-opened silently, with no assertion between it and prod.

The probe that appears to guard this is a no-op:
```js
const defaultAcl = await sql`SELECT 1 FROM pg_default_acl d ... LIKE '%lumen_read%' ...`;
check("CF-9: the notes migration neutralized/handled default-privilege auto-grants ...", true, `default_acl rows: ${defaultAcl.length}`);
```
The second argument is the literal `true` (`smoke-notes-rls.mjs:185`). The query
result is only interpolated into the detail string, which `check()` discards on
pass. This assertion cannot fail for any database state — it inflates the "PASS
19/19" count recorded in plan.md without testing anything.

**Proposed fix.** Two changes. (a) In `GRANTS_SQL`, add
`ALTER DEFAULT PRIVILEGES IN SCHEMA lumen REVOKE SELECT ON TABLES FROM lumen_read;`
— must run as the same grantor role that created the `pg_default_acl` entry, so
assert the entry is gone rather than assuming. (b) Make the smoke assertion real:
`check("CF-9: no lumen_read default-privilege auto-grant on lumen tables", defaultAcl.length === 0)`.
Grep the rest of the smoke for other `check(..., true, ...)` calls before
trusting the 19/19.

---

## SEC-4: no bound on anchor count — one authenticated save can issue thousands of sequential PostgREST subrequests

**Severity:** medium
**Category:** input validation / resource exhaustion
**File:** `apps/web/app/routes/notes.$id.tsx:125-139,165,215-220`;
`apps/web/app/lib/notes.server.ts:190-203,275-308`;
`apps/web/app/components/editor/NoteEditor.tsx:807-814`;
`scripts/migrate-notes.mjs:168-184`

**Claim.** `body_md` is capped four times over (`NOTE_BODY_MAX_BYTES` at
`notes.$id.tsx:162,182`, the DDL `notes_body_size` CHECK). The **anchor set is
capped nowhere**:

- `readAnchors` (`notes.$id.tsx:127`) iterates `form.getAll("anchor")`
  unbounded; `validateAnchorRefs` (`notes.server.ts:193`) likewise.
- `collectBodyRefs` (`NoteEditor.tsx:807`) emits one `anchor` field per unique
  wikilink in the body and `save()` appends all of them on **every autosave**
  (`NoteEditor.tsx:364-365`). A 64 KiB body of `[[gen-1-1]]`-shaped links yields
  on the order of 5,000 unique refs, legitimately.
- `create_note_with_anchors(p_anchors jsonb)` (`migrate-notes.mjs:178-181`) has
  no array-length guard.
- Worst: `syncNoteAnchors` (`notes.server.ts:287-296`) deletes **one anchor per
  PostgREST round trip in a sequential `for` loop**. Deleting N anchors is N
  serialized subrequests inside a single Worker invocation.

On Cloudflare Workers the subrequest ceiling (1,000 on paid) is hit well before
that loop finishes: the request is killed mid-loop, leaving a partially-synced
anchor set — and each round trip holds a Supabase session against a pool capped
at 15 (a documented incident source in this repo). This is reachable by an
ordinary heavy user, not just an attacker, and it is a *write* path so the
partial state persists.

**Proposed fix.** (a) Cap at the action boundary: `const raw =
form.getAll("anchor"); if (raw.length > MAX_ANCHORS) return json({error, code:
"too_many_anchors"}, 400, headers);` with `MAX_ANCHORS = 128`, and mirror it in
`validateAnchorRefs`. (b) Add `CHECK (jsonb_array_length(coalesce(p_anchors,
'[]'::jsonb)) <= 128)` (or a `RAISE`) at the top of
`create_note_with_anchors`. (c) Replace the delete loop with a single batched
call — build the composite key list and issue one `.delete().in("ref_id",
refs).eq("kind", kind)` per kind (≤4 round trips), or add a
`lumen.sync_note_anchors(p_note_id uuid, p_anchors jsonb)` INVOKER RPC that does
the diff set-wise in one statement.

---

## SEC-5: A18's `?next=` is minted but never consumed — and the consumer, when written, is an open-redirect surface

**Severity:** medium
**Category:** authn
**File:** `apps/web/app/routes/notes.tsx:21-24`;
`apps/web/app/routes/notes.$id.tsx:46-49`; `apps/web/app/routes/login.tsx:12,31`;
`apps/web/app/routes/auth.confirm.tsx:75,81`

**Claim.** A18 states "`/login?next=<same-origin-path>` **honored**", and both
notes routes dutifully mint it. Neither `login.tsx` nor `auth.confirm.tsx` reads
a `next` parameter anywhere — `login.tsx:12` redirects an already-signed-in user
to `/`, and `auth.confirm.tsx:75,81` hard-redirect to `/` on success. Grepping
`next|redirectTo` across both files returns nothing. The parameter is dead: a
signed-out user who deep-links a note is bounced to `/` after login, losing the
destination. The A18 contract is unimplemented.

The security half: the OTP flow round-trips through Supabase
(`login.tsx:31`, `emailRedirectTo`), so `next` must survive an external hop. The
naive implementations of this — `redirect(next ?? "/")`, or a
`next.startsWith("/")` guard — are open redirects: `//evil.com` and
`/\evil.com` both pass a leading-slash check and are treated as
protocol-relative absolute URLs by browsers. On an auth-completion redirect that
is a credible phishing pivot.

**Proposed fix.** Implement it once, defensively:
```ts
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  try { return new URL(raw, "http://x").pathname + new URL(raw, "http://x").search; }
  catch { return "/"; }
}
```
Thread it through `login.tsx` (carry `next` on the form / in
`emailRedirectTo`'s own query) and `auth.confirm.tsx`. Pin `//evil.com`,
`/\evil.com`, `https://evil.com` and a bare `evil.com` as rejected fixtures. If
the decision is instead to drop `next`, remove it from both `loginRedirect`
helpers so the contract and the code agree.

---

## SEC-6: `append` accepts an unsanitized-for-newlines `label` and has no body-size guard

**Severity:** low
**Category:** input validation / stored-content integrity
**File:** `apps/web/app/routes/notes.$id.tsx:240-263`;
`apps/web/app/components/editor/markdown.ts:165-167`

**Claim.** `sanitizeWikilinkLabel` strips only `[`, `]`, `|`:
```ts
return label.replace(/[[\]|]/g, "").trim();
```
Newlines survive. The editor paths are safe by construction (labels come from
`doc.textBetween(from, to, " ")`, which cannot contain `\n`), but the `append`
action takes `label` straight off the wire (`notes.$id.tsx:250`) and splices it
into markdown at `:251`:
```ts
const line = label !== "" && label !== ref ? `[[${ref}|${label}]]` : `[[${ref}]]`;
```
A `label` of `"Alma 32:21\n# Injected\n\n> quote"` produces a multi-line `line`.
The wikilink tokenizer rejects it (`notes-markdown-config.ts:45` —
`inner.includes("\n")` returns false, so `[[ref|Alma 32:21` stays literal text)
but the trailing lines parse as a real heading and blockquote, and
`canonicalizeNoteMarkdown` at `:256` bakes them into the stored body. It also
breaks the `append_undo` byte-restore at `:311-314`, which matches on the exact
single-line `line`, so the undo affordance silently 409s.

Separately, `append` is the only write path with **no** `NOTE_BODY_MAX_BYTES`
check (compare `:162` and `:182`). An oversized label or a note already near the
cap fails at the DDL CHECK → PG `23514` → `classifyWriteError` → `constraint` →
the `catch` at `:353` → a generic **500**, where every other path returns a
clean 400.

Scope is self-inflicted (the owner's own note; RLS confines it), which is why
this is low, not medium. It is still an unvalidated field written into stored
content, and the 500 is a mis-shaped contract.

**Proposed fix.** Change `sanitizeWikilinkLabel` to
`label.replace(/[[\]|]/g, "").replace(/\s+/g, " ").trim().slice(0, 200)` — the
whitespace collapse also matches what `stripNoteMarkdownLine` already does on
the read side. Add the byte-length check to `append` before the update, and
return 400 `note_too_large` rather than falling through to the 500.

---

## SEC-7: `NoteEditor.tsx` contains raw NUL bytes — git classifies it binary, so the 830-line editor never appeared in a reviewable diff

**Severity:** low
**Category:** review integrity / code hygiene
**File:** `apps/web/app/components/editor/NoteEditor.tsx:94,215`

**Claim.** `git diff --stat` reports
`apps/web/app/components/editor/NoteEditor.tsx | Bin 0 -> 28816 bytes`, and
`file` reports `data`. Byte inspection finds four `0x00` bytes at offsets 4080,
4085, 8533, 8538 — literal NULs inside string literals, not `\0` escapes:
```ts
const text = $head.parent.textBetween(0, $head.parentOffset, "<NUL>", "<NUL>");
return state.doc.textBetween(ps.from + 2, head, "<NUL>", "<NUL>");
```
The file is valid UTF-8 and works (using a NUL as the leaf/block separator so it
can never collide with typed text is a defensible ProseMirror technique), but
git's binary heuristic means: no diff in any review of this branch, no `git
blame`, no three-way merge, and no textual conflict detection. The single
largest and most security-relevant client file in the feature was invisible to
both prior panels and to this one until it was read directly. That is a control
failure independent of whether the current contents are fine (I read all 830
lines; they are).

**Proposed fix.** Replace the literal NULs with `" "` escapes (identical
runtime value, file becomes text). Add `*.ts text` / `*.tsx text` to
`.gitattributes` so a stray control byte can never silently re-binarize a source
file, and consider a lint/CI check rejecting control bytes outside `\t\r\n` in
`app/**`.

---

## SEC-8: `getChapterNoteAnchors` builds a PostgREST filter by string concatenation

**Severity:** low
**Category:** injection (defense-in-depth)
**File:** `apps/web/app/lib/notes.server.ts:166-176`

**Claim.**
```ts
const chapterRef = `${bookId}-${chapter}`;
.or(`and(kind.eq.chapter,ref_id.eq.${chapterRef}),and(kind.eq.verse,ref_id.like.${chapterRef}-*)`)
```
`.or()` takes a raw PostgREST filter expression with no escaping mechanism; a
`bookId` containing `,`, `)` or `.` would restructure the predicate. It is safe
**today** only because of upstream validation in the sole caller: `bookId` is
`parseReference(...).bookId` (a canonical slug from the closed book table) and
`chapter` is `parseInt` of a string already matched against `^\d+$`
(`scripture.tsx:562-567`). Neither guarantee is expressed or asserted at this
function's boundary, and `notes.server.ts` is documented as "the single mockable
seam" — i.e. explicitly intended to be called from elsewhere later. RLS caps the
blast radius at the caller's own rows in any case, so this is a robustness
finding, not a live vulnerability.

**Proposed fix.** Validate at the seam:
```ts
if (!/^[a-z0-9-]+$/.test(bookId) || !Number.isInteger(chapter) || chapter < 1) {
  throw new NoteWriteError("validation", "invalid chapter ref");
}
```
Better still, reuse `resolveAnchorRef(chapterRef)` — it already encodes exactly
this grammar (`notes-refs.ts:74`), and a non-null result proves the string is
filter-safe. Add a fixture with a comma-bearing `bookId` asserting rejection.

---

## SEC-9: paste conversion accepts any origin's URL

**Severity:** low
**Category:** input validation / content confusion
**File:** `apps/web/app/components/editor/NoteEditor.tsx:220-243,480-495`

**Claim.** `lumenUrlToRef` does `new URL(raw.trim())` and then matches on
`url.pathname` alone. `url.origin` and `url.hostname` are never checked. Pasting
`https://evil.example/scripture/alma/32?verse=21` silently becomes
`[[alma-32-21]]`, and `https://attacker.test/media/some-episode?t=90` becomes
`[[some-episode@90]]`.

The direction of the confusion is fail-safe — the produced ref always routes
*into* Lumen via `anchorRefToPath`, never out, and `resolveAnchorRef` gates it
(`:231,237,241`) — so there is no redirect or XSS. The defect is that the user's
pasted external reference is replaced by an internal link that renders as a
different destination than what they pasted, with only a polite "Pasted as link"
announcement (`:493`) and no visible origin.

**Proposed fix.** Gate on origin before converting:
```ts
if (url.origin !== window.location.origin) return null;
```
(or an explicit allowlist of the prod origin + localhost, since the editor is
client-only and `window` is available). Mechanism 4 is specified as "pasted
**Lumen** URL becomes a typed link" (plan §Linking), so this is the spec's own
intent.

---

## SEC-10: invariant coverage gaps on the two RPCs, and a 14-vs-15 count discrepancy

**Severity:** low
**Category:** harness integrity
**File:** `scripts/migrate-notes.mjs:216-328,209-210`; `docs/features/personal-notes/plan.md:448`

**Claim.** Three small gaps:

1. `soft_delete_rpc_definer_and_anon_locked` (`:319-327`) pins both `prosecdef`
   and the anon/authenticated EXECUTE state for `soft_delete_note`.
   `create_rpc_present_and_invoker` (`:310-315`) pins only `NOT p.prosecdef` — it
   does **not** assert the `REVOKE EXECUTE ... FROM PUBLIC, anon` at `:209`
   actually took. Impact is nil today (the function is INVOKER and `anon` holds
   no table grant, so RLS denies), but the asymmetry means a regression there is
   unobserved while its sibling is pinned.
2. Neither invariant nor the smoke pins `SET search_path = ''` on either
   function. Both DDL bodies have it (`:151`, `:172`) and both are correctly
   schema-qualified throughout (`lumen.notes`, `lumen.note_anchors`,
   `auth.uid()`; `now()` and `jsonb_array_elements` resolve from the implicit
   `pg_catalog`) — this is the single most important hardening property of a
   `SECURITY DEFINER` function owned by a BYPASSRLS role, and it is asserted
   nowhere. A `CREATE OR REPLACE` that drops the clause would pass all 15
   invariants.
3. plan.md:448 records "migrate-notes.mjs (applied, 14/14 invariants)". The
   `INVARIANTS` array has **15** entries. Either an invariant was added after the
   live apply (so one has never run against prod) or the count is stale. Worth
   resolving before the deploy checklist is executed.

**Proposed fix.** Extend `create_rpc_present_and_invoker` with
`AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND
has_function_privilege('authenticated', p.oid, 'EXECUTE')`. Add one invariant
pinning `search_path` on both:
```sql
SELECT count(*) = 2 AS pass FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname='lumen' AND p.proname IN ('soft_delete_note','create_note_with_anchors')
  AND p.proconfig @> ARRAY['search_path=']
```
Re-run `COMMIT=1 node scripts/migrate-notes.mjs` (idempotent) and record the
real count.

---

## Lanes that came back CLEAN

Stated explicitly per the brief — an empty lane is a real result.

**F6 / XSS in `notes-render.server.ts` and `notes-derive.ts` — clean.** I tried
to break it and could not. Verified against markdown-it 14.3.0's actual source:

- The `zero` preset (`presets/zero.mjs`) enables inline rule `text` only;
  `code_inline`, `fence`, `link`, `image`, `autolink`, `html_inline`,
  `html_block` are all absent, and `html:false` (`notes-markdown-config.ts:60`)
  makes the html rules inert regardless. No token type reaching the renderer
  carries a user-controlled attribute.
- The `text` renderer override (`notes-render.server.ts:37`) applies to escape
  sequences too: the `escape` rule (enabled at `NOTES_MARKDOWN_RULES:26`) emits
  `text_special` tokens, and the `text_join` core rule — present in the zero
  preset's core rules — rewrites every `text_special` to `text`
  (`rules_core/text_join.mjs:21-23`) *before* rendering. So `escapeHtml` +
  `neutralize` cover the whole text surface; there is no `text_special`
  bypass.
- Wikilink hrefs (`:89`) can only be `anchorRefToPath` output, and every branch
  of that function (`notes-refs.ts:132-155`) builds from segments already
  matched against `SLUG_SHAPE` / `TRANSCRIPT_SHAPE`. `javascript:` cannot be
  constructed. Entity refs return `null` unless a resolver is passed, and
  `notes.$id.tsx:98` passes none — so entity wikilinks are inert `<span>`s
  today.
- `sanitizeRenderLabel` (`:68`) strips tag-shaped text rather than escaping it,
  and the residue is escaped anyway; the `aria-label` at `:88` goes through
  `escapeHtml`, which escapes `"`.
- `renderNoteHtml` is the only `dangerouslySetInnerHTML` source
  (`notes.$id.tsx:483`). Every other note-derived string — index titles and
  snippets, rail titles (`scripture.tsx`, via `stripNoteMarkdownLine`), search
  snippets, `meta()` titles — is a React text child.
- The editor's `wikilink.toDOM` (`markdown.ts:99-103`) emits a `<span>` with
  `data-*` attributes set through the DOM API. No client-side sink.

**Signed-out byte-freeze (F2) — clean.** I traced `extractNotesScope` +
`parseScope` against the pre-feature behavior for `scope=notes`,
`scope=notes,notes`, `scope=notes,` (trailing comma → falls to the *original*
error, correct), `scope=NOTES`, `scope=scripture,notes`, `scope=notes` with a
bad `limit`, and `scope=notes` with an `after` cursor. Every signed-out path
reproduces the frozen `scope_unknown` bytes in the pre-feature validation order
(`api.search.tsx:71-156`, `search.tsx` loader). `GROUP_KEYS` is genuinely frozen
— `parseScope`'s error message (`search-request.server.ts:65`) enumerates
`GROUP_KEYS`, which does not contain `notes`, so the vocabulary never leaks. The
one behavioral delta is that a deferred ruling now reads the session before
returning the 400; for a cookieless request `commitHeaders()` is empty, so the
response is byte-identical, and `hasAuthCookie` (`auth.server.ts:87`)
short-circuits the cost. `logSearchExecuted`'s `extraGroups`
(`search-obs.server.ts:72`) is absent signed-out and carries counts only.

**RLS assumptions in app code — clean.** No admin/service-role client exists
anywhere in the notes data path; `notesClient` (`notes.server.ts:101-107`) is the
sole constructor and always the per-request user-JWT SSR client. `owner_id` is
never read from a form on any path — `createNote` sends only `body_md` and
anchors (`:215-221`) and the column DEFAULT supplies it; `syncNoteAnchors`
inserts `{note_id, kind, ref_id}` only (`:303`). The "absent vs deleted vs
foreign are one indistinguishable 404" reasoning (`:19-21`,
`notes.$id.tsx:34-36`) holds: the SELECT policy carries `deleted_at IS NULL`, so
all three return `null` from the same `maybeSingle()`.

**SECURITY DEFINER `soft_delete_note` — clean as written.** `SET search_path =
''` present; every reference schema-qualified; the `WHERE` mirrors the
`notes_update` policy verbatim (`owner_id = auth.uid() AND deleted_at IS NULL`);
`auth.uid()` still resolves under DEFINER because PostgREST sets the JWT GUC
per-request, and a NULL `auth.uid()` matches zero rows since `owner_id` is `NOT
NULL`. No `RETURNING`, so the tombstone-hiding SELECT policy is never consulted
— which is the whole point of the sanctioned harness revision. EXECUTE is
granted to `authenticated` only, and that grant state is invariant-pinned
(`:319-327`) and live-verified in the smoke (`smoke-notes-rls.mjs:153-160`).

**Cookie/session header propagation — clean.** Every exit in
`notes.$id.tsx` — 200, 302, 400, 401, 404, 409, 500 — threads `headers` from
`getSessionUser` (`:145,151,159,167,174,179,221,231,234,347,351,356`), including
the catch-all. `notes.tsx` does the same on both exits. The
`loadChapterNoteAnchors` deviation is documented and correct (`scripture.tsx`:
memoized `getSessionUser`, refresh rides the root loader). The `clientMemo`
WeakMap (`notes.server.ts:100`) is keyed on `Request`, matching the existing
`sessionMemo` idiom, so no client is shared across requests. (The one gap is the
*absence of `Cache-Control`* on those same responses — SEC-1.)

**e2e secret hygiene (`apps/web/e2e/support/session.ts`) — clean.** The service
role key is read at runtime from the gitignored root `.env`
(`:20-25`) and hard-fails if absent; it is never written to a fixture, a log, or
a committed file. The two hardcoded values (`:17-18`) are the project URL and
the `sb_publishable_` key, both already public in
`apps/web/wrangler.json:27-28`. Throwaway users get `crypto.randomUUID()`
passwords at `@example.invalid` and are deleted in `cleanup` (`:92-94`). The
committed `apps/web/test-results/.last-run.json` contains only
`{"status":"passed","failedTests":[]}` — no leakage. Minor operational note (not
a finding): `createE2eUser` has no `try/finally`, so a mid-file crash strands a
confirmed auth user; the same is true of `makeUser` in the smoke, which *does*
wrap in `finally` (`smoke-notes-rls.mjs:200-203`).

---

## Summary

**10 findings — 1 high, 4 medium, 5 low.**

- high: 1 (SEC-1, missing `Cache-Control: private, no-store` on both notes routes)
- medium: 4 (SEC-2 schema-USAGE function exposure + table-only sweep; SEC-3
  unneutralized `lumen_read` default privileges + a no-op smoke assertion; SEC-4
  unbounded anchor count with a per-row delete loop; SEC-5 `?next=` unimplemented
  and open-redirect-prone when written)
- low: 5 (SEC-6 `append` label newlines + missing size guard; SEC-7 NUL bytes
  binarize `NoteEditor.tsx`; SEC-8 `.or()` string-built filter; SEC-9
  origin-blind paste conversion; SEC-10 RPC invariant gaps + 14-vs-15 count)

Clean lanes: XSS/F6 across every render surface, the signed-out byte-freeze,
RLS assumptions in app code, the DEFINER soft-delete function body, session
header propagation, and e2e secret hygiene. No `challenges-settled-decision`
findings — the PG-level tombstone invisibility + DEFINER soft-delete design is
implemented soundly.
