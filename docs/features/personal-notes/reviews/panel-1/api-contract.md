# panel-1 · api-contract — personal-notes (plan-stage)

Reviewer lens: the notes feature's contract surface — /api/search notes group,
the `note` result payload, /notes route/action contracts, the `[[ref|label]]`
persisted grammar, naming consistency. Scale honored: single-digit DAU,
Workers runtime. Not re-litigated: ProseMirror, markdown storage, GROUP_KEYS
additive design, B18.

Findings ranked by severity.

---

### APIC-1: Adding `notes` to GROUP_KEYS leaks the group into every signed-out surface — F2 is broken by the plan's own harness pin
- **Severity: high**
- **Claim.** The harness pins `GROUP_KEYS[0] === 'notes'`
  (packages/scripture/src/__tests__/notes-harness.test.ts:8), but GROUP_KEYS is
  not an inert label list — it is the live default-scope, scope-validation, and
  UI vocabulary for signed-out traffic. With `notes` in it and **no other
  change**, F2's "signed-out byte-compatible" fails three concrete ways:
  1. **Default response gains an empty notes group.** `searchAll` defaults
     `scope = [...GROUP_KEYS]` and materializes a group per scope key
     (packages/scripture/src/search.ts:679,690) while `buildLegs` silently
     skips unknown keys (search.ts:556-585 has no else-branch). Every
     signed-out `/api/search?q=faith` response would carry
     `{"key":"notes","results":[]}` — a bytes change AND a feature-existence
     leak to signed-out users.
  2. **`parseScope` starts accepting `scope=notes` signed-out**
     (apps/web/app/lib/search-request.server.ts:36), and its `scope_unknown`
     400 message enumerates GROUP_KEYS (line 40), advertising `notes` in the
     signed-out error body.
  3. **The /search scope pills render every GROUP_KEYS entry**
     (apps/web/app/routes/search.tsx:1104) — signed-out users see a "Notes"
     toggle, and excluding any other group commits a `?scope=` CSV containing
     `notes`.
  The merge-harness fixture (`canonGroups` with no notes entry,
  apps/web/app/lib/__tests__/notes-search-merge.test.ts:5-8) silently assumes
  searchAll never emits a notes group; if it does, `mergeNotesGroup` inserting
  at index 0 produces a **duplicate-key** response.
- **Evidence.** search.ts:679 `const scope: GroupKey[] = opts.scope?.length ?
  opts.scope : [...GROUP_KEYS];`; search.ts:690 `const groups: SearchGroup[] =
  scope.map((key) => ({ key, results: [] }));`; buildLegs if/else chain ends at
  `words` with no default arm.
- **Proposed fix.** Introduce `CANON_GROUP_KEYS = GROUP_KEYS minus 'notes'`
  (or equivalently `SEARCHALL_GROUP_KEYS`) in search-types.ts. `searchAll`
  defaults scope from it and **throws (or filters) on non-canon keys** —
  `notes` must be structurally unreachable in the lumen_read leg builder,
  matching D3's "structurally impossible" claim at the code layer, not just the
  grants layer. `parseScope` takes an `allowNotes` flag (or a second export)
  so signed-out requests keep today's vocabulary and today's `scope_unknown`
  message verbatim. The /search pill list renders from the session-aware group
  list the loader provides, not raw GROUP_KEYS. Add a harness pin: signed-out
  `searchAll` result contains no `notes` key (see Harness gaps).

### APIC-2: `?scope=notes` semantics are unspecified — and the naive route implementation returns ALL canon groups for it
- **Severity: high**
- **Claim.** The plan says nothing about `scope=notes`. There are three
  candidate behaviors (400 / empty group / route-side handling) and one trap
  that makes the obvious implementation wrong: if the route strips `notes`
  from the parsed scope before calling `searchAll`, a request for
  `scope=notes` alone yields `canonScope = []`, and `searchAll` treats an
  empty array as "no scope" → **searches all seven canon groups**
  (search.ts:679, `opts.scope?.length` is falsy for `[]`). A signed-in user
  asking for only their notes would get scripture/people/places/… back.
- **Evidence.** search.ts:679; the route currently passes `scope` straight
  through (apps/web/app/routes/api.search.tsx:122-128).
- **Proposed fix — the rule (proposed for ratification).**
  - Signed-out: `scope` containing `notes` → **400 `scope_unknown`**, message
    identical to today's (canon-only vocabulary). Signed-out never learns the
    group exists.
  - Signed-in: `notes` is a valid scope member. Route splits
    `scope → (canonScope, wantsNotes)`. If `canonScope` is empty, **skip
    searchAll entirely** and synthesize `{query: q, reference: null, groups:
    []}` before merging the notes leg — never call searchAll with `[]`.
    Reference resolution (decision 4 short-circuit) is explicitly forfeited on
    a notes-only scope; document that.
  - `/search` page loader follows the identical rule (it shares parseScope and
    calls searchAll directly, search.tsx:237+).
  Pin all three in the route harness.

### APIC-3: notes × cursor interaction is unspecified — propose: the notes group never mints `nextCursor` in v1, and `after`+notes-in-scope is a 400
- **Severity: med-high**
- **Claim.** The shipped cursor contract is keyset over `(tier, sub, score,
  id)` minted by `searchAll` (search.ts:53-58, mintNextCursor), honored only
  when scope is exactly one group (api.search.tsx:83). The notes leg is
  PostgREST `textSearch` at the route layer — it has no tier/score ORDER BY,
  no keyset codec, and never passes through mintNextCursor. The plan is
  silent, which invites an implementer to either (a) mint a fake cursor that
  `decodeSearchCursor` can't validate, or (b) let `after&scope=notes` fall
  through: it passes the `scope.length === 1` gate (api.search.tsx:83), then
  `decodeSearchCursor(raw, {q, scope:'notes'})` — a cursor whose FNV hash was
  computed over scope `notes` decodes fine and reaches a leg that cannot
  consume it. B1/B2 (docs/features/search-ui/bugs.md) are the record of what
  under-specified cursor edges cost last time.
- **Evidence.** search-types.ts:80-83 (`nextCursor` present only when page is
  full); api.search.tsx:80-95; bugs.md B1/B2.
- **Proposed fix.** Ratify: **v1 notes group never mints `nextCursor`**
  (SearchGroup contract already allows absence = end of set, F5 semantics; at
  single-digit DAU a 25-cap notes page is the whole corpus). Route rule:
  `after` present AND scope includes `notes` → **400 `cursor_scope`** with the
  existing message generalized ("after requires scope to be exactly one
  paginable group") — checked in the same before-session block. Client
  consequence to note in the plan: the "More in notes →" pill and single-scope
  append loop (search.tsx) simply never engage for notes because no cursor is
  ever present — zero client changes needed. Harness pin: a full notes page
  (results.length === limitPerGroup) still has no `nextCursor`.

### APIC-4: F2's "byte-compatible" claim is not testable as written — restate it as a structural pin plus a live smoke diff
- **Severity: med**
- **Claim.** "Byte-compatible with pre-feature shape" cannot be asserted by a
  vitest test after the feature lands: there is no pre-feature byte oracle in
  the repo, live snippet/score content churns with ingest re-runs (moment ids
  re-key by design, A6), and per APIC-1 item 2 the `scope_unknown` 400 body
  *will* change bytes unless the message is explicitly frozen. A claim the
  harness can't fail is not a contract.
- **Evidence.** plan.md F2/F9; api.search.tsx:132-136 (the 200 body is
  `{query, reference, groups}` — note `meta` is already stripped, so
  meta.mode/meta.perGroup need **no** public acknowledgment of notes; meta is
  route-internal and OBS-only).
- **Proposed fix.** Replace the byte claim with two testable pins:
  (1) **structural**: signed-out route response (mocked session) contains no
  `notes` group key, no new top-level fields, and `scope_unknown`'s exact
  message string is value-pinned (canon-only list, frozen verbatim);
  (2) **live smoke**: `scripts/smoke-*` curl diff of `/api/search?q=<fixed>`
  signed-out captured immediately pre-merge vs post-deploy (same DB moment),
  byte-compared — the honest home for "byte-compatible". Amend F2's wording
  in the plan accordingly.

### APIC-5: the `note` SearchResult payload is unspecified — pin fields, snippet plaintext law, title derivation, and the ResultType union edit
- **Severity: med**
- **Claim.** GROUP_RESULT_TYPES gains `notes: ['note']` (harness pins it) but
  `'note'` is not in the ResultType union (search-types.ts:24-38) — the
  harness as written fails typecheck, not just assertion; the plan never lists
  the edit. More importantly nothing specifies what a note result carries:
  - `snippet`: SearchResult.snippet is contractually "plain text with ⟪⟫
    markers — never HTML (API-1)" (search-types.ts:70-71). The notes leg is
    PostgREST, which cannot run `ts_headline` on a plain select — the snippet
    will be route-computed from `body_md`, i.e. **raw markdown** with
    `[[ref|label]]`, `**`, `#` tokens leaking into display, and it is the F6
    XSS surface named by the plan. React escaping via parseMarks
    (search.tsx:90-113) covers the /search page, but API-1 is a producer-side
    contract — raw HTML must never be IN the snippet.
  - `title`: D2 derives it from the first line — which is also markdown
    (`# heading`, or a leading wikilink).
  - `id`: fine (uuid, durable under the APIC-6/decision-5 id-stability
    doctrine) — say so.
- **Evidence.** search-types.ts:24-38, 61-75; plan.md D2/D3/F6.
- **Proposed fix.** Spec in the plan: `type:'note'`, `id` = note uuid
  (durable), `title` = first-line **rendered to plain text** (markdown
  constructs stripped, wikilinks → label), `snippet` = plain text derived from
  body_md with markdown stripped and wikilinks → label, ⟪⟫ markers optional
  (parseMarks degrades gracefully without them), never HTML; `tier`/`score`
  fixed (e.g. tier 0 / score by ts_rank or updated_at recency — pick one);
  `payload: { updated_at: ISO-8601 string, anchors: [{kind, ref_id}] }`
  (anchors capped, e.g. first 4 — the reader deep-link needs them). Add
  `'note'` to ResultType next to the GROUP_RESULT_TYPES edit. Also pin: the
  tsvector generated column / notes leg filters `deleted_at IS NULL` (F8's
  search limb currently has no named enforcement point).

### APIC-6: the /notes action contract is half-decided — intent enum, the `/notes/new` magic segment, autosave-vs-explicit-save, and return shapes need ruling
- **Severity: med**
- **Claim.** The plan says "Actions: create / update (LWW) / soft-delete" and
  D6 says "action returns fresh updated_at" — that is the entire actions
  contract. The harness quietly adds contract it never states: it POSTs
  `intent=create` to **`/notes/new`** through `notes.$id`'s action
  (notes.routes.test.ts:73-75, makeArgs derives `params.id = "new"`), minting
  a magic id segment inside the uuid namespace: `GET /notes/new` must render
  the editor (not 404 via `getNote("new")`), and the id parser must exclude
  it. Autosave vs explicit save is undecided, and it IS a contract decision:
  autosave means the action is fetcher-called returning JSON
  (`{ updated_at }`) with no redirect; explicit save on create wants
  redirect-after-POST to `/notes/:id`. F12's mobile smoke says "save",
  implying explicit — but nothing rules it.
- **Evidence.** plan.md Public contract + D6; notes.routes.test.ts:66-79.
- **Proposed fix.** Ratify in the plan:
  - Intent enum: `create | update | delete` (delete = soft, per Q3) —
    value-pin in the harness; unknown intent → 400.
  - `/notes/new` is the ratified create surface (GET renders empty editor,
    POST intent=create → **redirect 302 to `/notes/:id`** with session
    headers); document the magic segment and exclude it from id lookup.
  - `update`/`delete` on `/notes/:id` are fetcher-posted, return **JSON
    `{ updated_at: string }`** (D6's LWW receipt) / `{ ok: true }` with
    session headers — no redirect (the editor stays mounted).
  - Status codes: 400 anchor/intent/body validation (before any write — the
    harness already pins createNote-not-called); **404** for absent, soft-
    deleted, or other-owner notes (RLS makes foreign rows invisible → they are
    indistinguishable from absent; 404-not-403 matches the admin.users D10
    house rule, admin.users.tsx:648); no 409 (LWW, Q7).
  - v1 save model: **explicit save** (autosave deferred; one decision line).

### APIC-7: signed-out gate — redirect-to-/login is a NEW house pattern and /login can't return the user; decide and wire `next`
- **Severity: med**
- **Claim.** The harness pins 302 → `/login` for signed-out /notes*
  (notes.routes.test.ts:45-55). The only shipped gated surface, admin.users,
  uses **404 existence-concealment** (admin.users.tsx:46-55, D10), so this is
  the repo's first redirect-gated route — acceptable for a first-class user
  feature (nothing about `/notes` existing is secret; the plan's own Public
  contract says "signed-out → /login"), but it should be a stated decision,
  not an accident. Two concrete gaps: (a) `/login` has no `next`/`returnTo`
  support (login.tsx:12 hard-redirects `/` on success), so a signed-out user
  following a `/notes/:id` link loses the destination; (b) the redirect must
  carry `session.headers` (an anonymous-session rotation can occur on the
  gate read).
- **Evidence.** login.tsx:12; logout.tsx:21 (returnTo precedent exists on
  logout); harness regex `^\/login` deliberately tolerates a query string.
- **Proposed fix.** One plan line ratifying the divergence ("notes = redirect
  gate, admin = 404 gate; notes' existence is public marketing surface").
  Redirect to `/login?next=<path>` (same-origin path only, validated — the
  auth.confirm.tsx:55 same-origin doctrine applies), teach login.tsx to honor
  it, and throw the redirect with `session.headers`. The harness's `^\/login`
  match already permits this — extend it to assert `next`.

### APIC-8: session-rotation Set-Cookie propagation through notes loaders/actions is unpinned — the exact B4 failure class
- **Severity: med**
- **Claim.** B4 (docs/features/search-ui/bugs.md) is the record: /search
  returned a plain object, dropped `session.headers`, and silently killed
  rotated sessions on client-nav. The notes feature adds **five** new
  header-bearing outcomes (index loader, note loader, create redirect, update
  JSON, delete JSON) plus the chapter-loader anchor fetch, all behind
  `getSessionUser`. The plan never mentions headers; the harness constructs
  `headers: new Headers()` (notes.routes.test.ts:26-30) and then never asserts
  they land on any response.
- **Evidence.** bugs.md B4; api.search.tsx:98-103 ("headers stays reachable in
  the catch") is the house-correct shape to copy.
- **Proposed fix.** Plan line: every /notes loader/action outcome — 200 JSON,
  302, 400, 404, and the 500 path — attaches `session.headers` (via
  `data(..., { headers })` / `redirect(..., { headers })`), mirroring
  api.search.tsx. Harness: mock getSessionUser to return a sentinel
  `Set-Cookie` and assert it on at least the redirect path and one JSON action
  path (see Harness gaps).

### APIC-9: `[[ref|label]]` is a persisted public grammar with two unspecified edges: label escaping, and slug renames orphaning stored refs
- **Severity: med**
- **Claim.** The stored body is the contract (plan Public contract: "markdown,
  constrained construct set, `[[ref|label]]`"), and F3 pins byte-round-trip.
  Two holes:
  1. **Label escaping.** Nothing defines serialization when a label contains
     `|` or `]]` (a pasted verse text easily contains `|`; Cmd+J uses the
     selection as the label, plan §Linking 5). Without a rule the parse→
     serialize round-trip is ambiguous and F3's byte-invariant is unprovable
     on exactly the inputs users will produce. Note the ref side already uses
     `#` (transcript `episode#seq`, notes-harness.test.ts:43) — fine, but it
     means the grammar is `ref = [a-z0-9-]+ (#\d+)?`, which should be written
     down once, in notes-refs.ts, as THE grammar.
  2. **Slug renames.** Entity ids do migrate — scripts/migrate-entity-rename.mjs
     is the ledger-driven precedent, and it rewrites `lumen.entities.id` +
     edge endpoints but treats `search_index.ref_id` as informational-only
     (SEARCH_INDEX_COUNT_SQL comment: "never an abort condition"). Stored
     `note_anchors.ref_id` and in-body `[[old-slug|...]]` would dangle after a
     rename. D4's fail-closed rendering (styled plain text) makes this safe
     but silently rots user links.
- **Evidence.** migrate-entity-rename.mjs header + SEARCH_INDEX_COUNT_SQL;
  plan D4, F3, F5.
- **Proposed fix.** No version token needed (the grammar IS the slug address
  space; D4 fail-closed is the compatibility valve) — instead: (a) define the
  label rule in notes-refs.ts: `|` and `]]` are forbidden in labels; the
  serializer strips/escapes them and the wikilink input paths sanitize the
  selection before insert; add both as F3 round-trip fixtures. (b) Amend the
  rename runbook: migrate-entity-rename.mjs (or a sibling pass) gains
  `note_anchors.ref_id` UPDATE + body_md wikilink rewrite steps, run under the
  admin DSN (RLS owner-only means only the admin path can do this); until
  implemented, a note in the script header that notes refs are a known
  rename consumer.

### APIC-10: response-shape asymmetries and route-layer observability — write the small rules down
- **Severity: low**
- **Claim.** Four minor contract points the plan leaves to the implementer:
  1. **Empty-group asymmetry.** Canon groups are always present, empty or not
     (searchAll materializes them); the merge harness pins that an empty notes
     group is **dropped** (notes-search-merge.test.ts:17-20). Deliberate
     (register rule) but undocumented — and it means an API consumer cannot
     distinguish "no note hits" from "signed-out". That is arguably the
     point; say so.
  2. **Reference short-circuit.** When searchAll short-circuits on a
     resolvable reference (search.ts:698-703) every canon group is empty by
     fiat — does the notes leg still run? Propose: no; the route skips the
     notes query when the canon result short-circuited (navigation posture,
     decision 4), keeping the surfaces coherent.
  3. **OBS.** `meta` never leaves the route (B10 strip) so no public change —
     but `logSearchExecuted` consumes `result.meta`, and the route-layer notes
     leg is invisible to it. Propose: route passes a `notes: {ms, hits}`
     extension into the OBS context, and a notes-leg failure logs a
     `search_group_degraded`-style line.
  4. **Notes-leg failure semantics.** Decision-7 isolation should extend: a
     failed notes leg degrades to *no notes group* (indistinguishable from
     empty, consistent with point 1), never a 500 of the whole search.
- **Evidence.** search.ts:690,698-703; search.tsx:52-59 (B10);
  api.search.tsx:130.
- **Proposed fix.** Four one-line rules in the plan's D3 section; harness pin
  for 4 (mock notes leg throws → 200 with canon groups intact).

---

## Open-question input

- **Q-new (propose adding): `scope=notes` rule** — signed-out 400
  `scope_unknown` (canon-only vocabulary, frozen message); signed-in valid,
  notes-only scope skips searchAll entirely (APIC-2). This is the biggest
  silent hole; it should be a ratified decision, not an implementation detail.
- **Q-new (propose adding): save model** — explicit save v1 (autosave
  deferred); intents `create|update|delete`; create = 302 to `/notes/:id`,
  update/delete = JSON with `updated_at` receipt (APIC-6). D6 already implies
  the JSON receipt; make the rest explicit.
- **Q3 (soft-delete)**: default **soft** is right for the API contract too —
  it is what makes 404-for-deleted (F8) and no-409 LWW (Q7) coherent. Support.
- **Q4 (derived title)**: support, with the APIC-5 amendment — derivation is
  markdown-stripping, contract-pinned, because the title travels in the
  search payload.
- **Q7 (LWW)**: support; consequence to record — the update action's fresh
  `updated_at` return is the entire concurrency API; no ETag/If-Match in v1.

## Harness gaps

1. **No searchAll signed-out pin (the APIC-1 hole).** Add to
   notes-harness.test.ts (or a search.ts test): canon-scoped/default
   `searchAll` output contains no `notes` group key; `buildLegs`-reachable
   scope rejects/filters `notes`. Without this, the GROUP_KEYS pin at index 0
   *causes* the F2 break the merge test assumes away.
2. **No `scope=notes` route tests.** Signed-out → 400 `scope_unknown`
   (message value-pinned); signed-in notes-only → notes group only, no canon
   groups (guards the empty-canonScope → all-groups trap, APIC-2).
3. **No cursor×notes test.** `after` + scope containing notes → 400; a full
   notes page mints no `nextCursor` (APIC-3).
4. **No Set-Cookie assertion.** notes.routes.test.ts builds Headers and drops
   them; assert a sentinel rotation header survives the /notes redirect and
   one action JSON response (APIC-8, B4 class).
5. **No snippet/title XSS-at-the-producer fixture.** F6 names the search
   snippet, but no test feeds a note body of `<script>`/`](javascript:...)` /
   `**bold** [[alma-32-21|<img onerror>]]` through the notes leg and asserts
   the emitted `snippet`/`title` are plain text (API-1) — the route/merge
   layer is the right seam (APIC-5).
6. **mergeNotesGroup duplicate-key guard.** Feed it canonGroups that already
   contain a `notes` key and pin the behavior (throw or replace) — today that
   input produces a duplicate-group response (APIC-1 tail).
7. **`/notes/new` GET is untested.** The action harness mints the magic
   segment; nothing pins that the loader renders the editor for id="new"
   rather than 404ing through getNote (APIC-6).
8. **Label-escaping round-trip fixtures.** F3's corpus should include labels
   containing `|` and `]]` once the APIC-9 rule is ratified.
