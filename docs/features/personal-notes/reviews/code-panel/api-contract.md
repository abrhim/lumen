# API-CONTRACT — code panel (step 9)

Lane: notes.$id action intent contract; deferred-scope ruling in
api.search.tsx/search.tsx vs pre-feature bytes; mergeNotesGroup/searchNotesLeg
vs A4; notes group payload shape; /login?next= (A18).

## API-CONTRACT-1: `/login?next=` is emitted, pinned, and never honored

- **Severity:** high
- **Category:** contract-not-implemented (A18)
- **File:** apps/web/app/routes/login.tsx:10-53; apps/web/app/routes/auth.confirm.tsx:75,81; emitters apps/web/app/routes/notes.tsx:21-24, notes.$id.tsx:46-49
- **Claim:** A18 ratifies "`/login?next=<same-origin-path>` honored." The notes
  routes emit `/login?next=%2Fnotes...` correctly, but nothing consumes it:
  login.tsx never reads `next` (its signed-in loader bounce at line 12 is
  `redirect("/")`), the OTP flow's `emailRedirectTo` is a bare
  `${origin}/auth/confirm` (line 31), and auth.confirm.tsx redirects to `"/"`
  on both verify paths (lines 75, 81). A signed-out user who opens
  /notes/abc123, signs in, lands on `/` — the return leg of the ratified
  contract does not exist. `grep -rn "next" login.tsx auth.confirm.tsx` has
  zero hits. Green-harness gap: notes.routes.test.ts:105-107 pins only the
  Location header of the EMISSION (`/login?next=%2Fnotes`); no test exercises
  consumption, so the harness stays green with the contract half-built.
- **Proposed fix:** In login.tsx, read `next` from the URL, validate it as a
  same-origin path (`next.startsWith("/") && !next.startsWith("//")`, reject
  anything with a scheme — open-redirect guard), thread it through
  `emailRedirectTo: ${origin}/auth/confirm?next=<validated>` and into the
  signed-in loader bounce; in auth.confirm.tsx redirect to the re-validated
  `next` (fallback `/`) on success. Add one routes test: signed-out /notes/:id
  → login → confirm lands back on /notes/:id, plus a hostile-`next` rejection
  case (`https://evil`, `//evil`).

## API-CONTRACT-2: notes loader responses ship without `Cache-Control: private, no-store`

- **Severity:** medium
- **Category:** header-contract (F17/SECURITY-3, the api.search B17/OC-4 class)
- **File:** apps/web/app/routes/notes.tsx (no `headers` export; loader:32-42), apps/web/app/routes/notes.$id.tsx (no `headers` export; loader:73,93-102)
- **Claim:** The house mandate (enforced with a dedicated `headers()` export on
  both search surfaces — see api.search.tsx:238-240's B17 comment: the RR
  single-fetch `.data` variant takes headers from that export, NOT from the
  loader's returned Response) is `private, no-store` on every session-varying
  body. The two most private surfaces in the app — the /notes index (titles +
  snippets of every note) and the /notes/:id body — return `data(..., {headers})`
  with session rotation headers only; neither route exports `headers()`, and the
  `json()` helper's Cache-Control (notes.$id.tsx:54) covers only action JSON,
  which per the B17 doctrine doesn't ride the `.data` protocol anyway. Document
  and client-nav responses carrying full note bodies are heuristically cacheable
  (200, no Cache-Control, no validators) — browser disk cache on a shared
  machine retains devotional content. Privacy > uptime is the stated scale
  context. (Same gap extends to scripture.tsx chapter responses now carrying
  personal `noteAnchors` + `title_line`; its only no-store is the alias 301 at
  line 582.)
- **Proposed fix:** Add the search.tsx-style `headers({ loaderHeaders })`
  export (forward + set `Cache-Control: private, no-store`) to notes.tsx and
  notes.$id.tsx; decide explicitly for scripture.tsx (its body is mostly public
  canon — `private, no-store` only when signed-in, or accept and record).

## API-CONTRACT-3: notes.$id action runs the session read outside the try — a session failure escapes the JSON contract and can eat the autosave buffer

- **Severity:** medium
- **Category:** error-shape / A13 every-outcome contract
- **File:** apps/web/app/routes/notes.$id.tsx:141-153 (vs the try at 155)
- **Claim:** A13 pins "EVERY outcome carries session.headers" and update/delete
  as fetcher JSON. `getSessionUser` (line 144) sits OUTSIDE the try/catch; the
  route's own sibling api.search.tsx deliberately moved the session read INSIDE
  its try because session-pool exhaustion is a documented incident here
  (api.search.tsx:124-128). If getSessionUser throws during an autosave POST,
  the action throws unhandled → RR routes the fetcher error to the nearest
  ErrorBoundary (root — this route exports none), swapping the note page out
  from under the editor. That contradicts A13's "a FAILED autosave … always
  preserves the buffer" on exactly the failure mode this codebase has actually
  had. The response is also a framework 500 (no `{error, code}` shape, no
  headers). The kill-switch `throw new Response(404)` at line 143 has the same
  ErrorBoundary-swap behavior for fetcher POSTs (rare: flag flipped
  mid-session; acceptable if recorded).
- **Proposed fix:** Move `getSessionUser` (and the notesEnabled check's
  response) inside the try, mirroring api.search.tsx; return
  `json({error, code:"internal"}, 500, headers-if-available)` from the catch.
  The client already treats non-`ok` fetcher data as failed-with-retry.

## API-CONTRACT-4: the 64 KiB 400 is checked on the RAW body but the CANONICAL body is stored; append has no size check at all

- **Severity:** medium
- **Category:** status-code contract (A6 CF-32 mirror)
- **File:** apps/web/app/routes/notes.$id.tsx:162,182 (raw check), 170-173/189-212 (canonical store), 256-263 (append — no check)
- **Claim:** notes-derive.ts:12-13 says the client-facing 400 mirrors the DDL
  CHECK. But create/update measure `rawBody` and store
  `canonicalizeNoteMarkdown(rawBody)`, and canonicalization can EXPAND the
  byte count (prosemirror-markdown's text serializer backslash-escapes `*`,
  `_`, `[`, `#` etc. — a ~60 KB body heavy in literal markdown metacharacters
  canonicalizes past 65536). The DB CHECK then rejects (23514 → classified
  `constraint` → NoteWriteError → route catch), returning **500
  `{code:"internal"}`** instead of **400 `note_too_large`** — a wrong status
  class for a deterministic client-input problem. The `append` intent never
  size-checks at all: appending to a note at the cap surfaces the same 500.
  Falsifiable: POST update with body_md = 60,000 × `*` (60 KB raw, ~120 KB
  canonical) → observe 500, expected 400.
- **Proposed fix:** Measure the canonical form
  (`new TextEncoder().encode(canonical).byteLength`) for the 400 in
  create/update (keep the raw check as a cheap pre-filter if desired), and add
  the same check to the append path's re-canonicalized body. Alternatively map
  `NoteWriteError` with pgCode 23514/2200N on this table to 400
  `note_too_large` at the route.

## API-CONTRACT-5: anchor sync failures after a committed body write return a misleading 500 ("could not be saved")

- **Severity:** medium
- **Category:** atomicity / error-shape
- **File:** apps/web/app/routes/notes.$id.tsx:213-221 (update), 259-289 (append), 318-337 (append_undo); apps/web/app/lib/notes.server.ts:275-308
- **Claim:** A7 made CREATE transactional via RPC, but update-with-sync_anchors,
  append, and append_undo are 2–4 sequential statements. In each, `updateNote`
  commits the body first; if the subsequent `getNoteAnchors`/`syncNoteAnchors`
  throws, the catch at line 353-357 returns 500 `"The note could not be
  saved"` — false: the body WAS saved, and the client's retry with its old
  base now draws a 409 stale (its own successful write is the "conflict").
  For append, the gloss/undo window never appears though the append landed;
  for append_undo, the body is restored but the anchor row the capture created
  survives. Partial states are recoverable (next full save re-diffs anchors)
  so severity stays medium, but the 500-after-commit is a wrong error shape on
  a defined outcome.
- **Proposed fix:** Wrap the post-commit anchor sync in its own try: on
  failure return 200 with the fresh `updated_at` plus e.g.
  `anchors_synced: false` (and log `note_write_failed {op:"anchor_sync"}`),
  so the client state machine reflects the truth. Longer-term: fold append
  into an RPC sibling of `create_note_with_anchors`.

## API-CONTRACT-6: append/append_undo stale 409s omit the `current` row A13 pins

- **Severity:** low
- **Category:** contract-asymmetry (A13/CF-37)
- **File:** apps/web/app/routes/notes.$id.tsx:266, 308, 316, 324 (vs update's 223-233)
- **Claim:** A13: LWW staleness → "409 + current row". `update` complies
  (`current: {body_md, updated_at}`); all four append/append_undo stale exits
  return `{error, code:"stale"}` with no `current`. The intents are additive
  (sanctioned), and the rail only prints "That didn't save — try again", so
  nothing breaks today — but a future consumer of the capture intents can't
  recover the way the ratified contract promises, and the same `code:"stale"`
  now has two shapes.
- **Proposed fix:** Either attach `current` (one extra getNote already in hand
  on most of these paths) or record the narrower shape for capture intents in
  the plan's A13 note.

## API-CONTRACT-7: /notes/new silently drops an invalid prefill anchor without the drift event

- **Severity:** low
- **Category:** validation-consistency (CF-49 allowlisted event)
- **File:** apps/web/app/routes/notes.$id.tsx:69-73
- **Claim:** Every other path that meets an unresolvable ref logs
  `note_anchor_invalid_ref` because "an invalid ref from our own insert paths
  means client/slug-map drift — a bug, not user garbage" (readAnchors:133,
  append:247, notes.server.ts:197). The loader's `?anchor=` prefill —
  populated by the reader and media capture doors, i.e. exactly "our own
  insert paths" — nulls an unresolvable ref silently. A slug-map drift on the
  capture doors (e.g. media.tsx:530's `episode@t` shape changing) would
  vanish without a trace.
- **Proposed fix:** Log `note_anchor_invalid_ref` (ref sliced to 160) when
  `anchorParam` is non-null and fails `resolveAnchorRef`, keeping the
  null-out behavior.

## API-CONTRACT-8: deferred-scope requests can 500 where the pre-feature route 400'd; search.tsx's early session read sits outside its 500 contract

- **Severity:** low
- **Category:** deferred-scope edge (A4)
- **File:** apps/web/app/routes/api.search.tsx:132-142; apps/web/app/routes/search.tsx:277-287
- **Claim:** Pre-feature, `scope=notes` was rejected before any session/db
  work. Deferral necessarily moves the judgment past `getSessionUser`, so
  under session-pool failure a request that used to draw a deterministic 400
  now draws 500 `internal` (api.search, correctly through its try) — an
  accepted consequence worth recording, since F2's byte-compat holds only on
  the healthy path. The sharper edge: search.tsx line 279 calls
  `getSessionUser` in the invalid-q + deferred branch OUTSIDE the try that
  owns the loader's 500 contract — a throw there is a framework 500 with no
  `search_failed` log and no headers, violating the loader's own documented
  doctrine (line 309's "mirror api.search.tsx").
- **Proposed fix:** Wrap search.tsx's early-session block in try/catch
  emitting the same `logSearchFailed` + 500-with-headers exit; add one line to
  the plan recording the healthy-path-only scope of the byte freeze.

## API-CONTRACT-9: observability mismatches — extraGroups logged for responses that omit the notes group; notes-only scope logged as unscoped

- **Severity:** low
- **Category:** observability contract (A4)
- **File:** apps/web/app/routes/api.search.tsx:199-221; apps/web/app/routes/search.tsx:348-368
- **Claim:** (a) On a reference short-circuit the merge correctly drops the
  notes group (A4), but `logSearchExecuted` still emits
  `extraGroups.notes {hits, degraded}` from the parallel leg — the log claims
  a group the response never contained. (Running the leg in parallel and
  discarding is a defensible reading of "leg skips on reference
  short-circuit"; the log mismatch is the defect.) (b) On a notes-only scope,
  `scope` is `undefined` at both call sites, so `search_executed` records the
  request as UNscoped — a notes-only search is indistinguishable from an
  unscoped one except by its empty groups/`mode:"none"`, quietly polluting
  the relevance-tuning feed A4 tried to keep clean.
- **Proposed fix:** Gate `extraGroups` on `!shortCircuit` (or add
  `merged:false`); log `scope: ["notes"]`-style route-layer scope (or a
  `notesOnly: true` field) on the notes-only path.

## API-CONTRACT-10: lane harness gaps — F8 route test passes for the wrong reason; A18 pinned only at emission

- **Severity:** low
- **Category:** harness-quality
- **File:** apps/web/app/routes/__tests__/notes.routes.test.ts:105-107, 111-118
- **Claim:** The F8 test ("/notes/:id 404s a soft-deleted note") uses id
  `"dead-note"`, which fails UUID_RE — the loader 404s BEFORE consulting the
  mocked `getNote`, so the assertion passes even if tombstone filtering broke.
  (RLS smoke covers the real behavior live, but this unit pin is inert.) And
  as noted in API-CONTRACT-1, the only `next=` pin asserts the Location header
  bytes, never the round trip.
- **Proposed fix:** Use a syntactically valid UUID in the F8 test; add the
  consumption-side test with the API-CONTRACT-1 fix.

## Verified clean (checked, no finding)

- **Deferred-scope validation ORDER vs pre-feature bytes** (api.search.tsx:50-156
  vs merge-base): pre-feature order q → scope → limit → cursor(len → single-scope
  → decode) is preserved exactly. Held-back limit/cursor 400s re-fire signed-in
  in pre-feature order (limit at 145, cursor×notes at 150); signed-out replay
  returns the frozen `scope_unknown` body with identical `{error, code}` key
  order; `scope=notes,bogus`, `scope=notes,`, `scope=`, case-mismatch `Notes`,
  and duplicate `notes,notes` all fall out correctly (byte-identical 400s
  signed-out). search.tsx keeps scope-outranks-q for the deferred path
  (lines 277-301), matching pre-feature scope-before-q.
- **searchAll canon filter (A1):** packages/scripture/src/search.ts:679-694
  structurally filters non-canon keys and returns the empty shape rather than
  widening `[]` to all groups (the CF-7 trap); GROUP_KEYS frozen;
  SEARCH_RESPONSE_KEYS/`SearchResponseKey`/`GROUP_RESULT_TYPES.notes:['note']`
  all per A1 (search-types.ts:31-63).
- **mergeNotesGroup vs A4:** notes leads then canon in GROUP_KEYS order
  (= SEARCH_RESPONSE_KEYS); null leg returns canon BY REFERENCE; empty healthy
  group dropped (absence = "no matching notes", documented); degraded group
  kept with `degraded:true`; canon can never double a notes key. Matches the
  green notes-search-merge tests.
- **searchNotesLeg vs A4:** never throws; 400 ms `AbortSignal.timeout`;
  `search_group_degraded` on failure; `updated_at desc`; textSearch call shape
  pinned `{config:'english', type:'websearch'}`; **no nextCursor ever minted**;
  cursor×notes → 400 `cursor_scope`; notes-only skips searchAll on both
  surfaces; result rows are `{type:'note', id, title, snippet?, tier:0,
  score:0, payload:{updated_at}}` — no owner_id, no body_md, plain-text
  snippet (A14 stripper).
- **A18 emission + headers:** both notes loaders redirect with
  `encodeURIComponent(pathname + search)` (same-origin by construction) and
  self-carry session headers on the thrown redirect per the root.tsx invariant;
  non-uuid and not-found 404s carry headers; the action `json()` helper stamps
  headers on all 200/400/404/409/500 outcomes.

## Summary

1 high · 4 medium · 5 low. Highest-leverage: API-CONTRACT-1 (A18's return leg
does not exist) and API-CONTRACT-2 (no-store missing on the most private
surfaces). The deferred-scope byte freeze and the A4 leg/merge contracts are
implemented faithfully.
