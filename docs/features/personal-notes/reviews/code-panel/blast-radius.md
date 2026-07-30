# Blast-radius review — personal-notes (code panel, step 9)

Lane: what this feature can break OUTSIDE itself. Method: full read of the
search-core diff (search.ts / search-types.ts), both search routes, the
scripture route, notes-enabled gates, migrate-notes.mjs grants block,
wrangler.json, plus consumer hunts for every widened type and revoked
grant, and one live-DB probe (PUBLIC-grantee grants in schema lumen).

## BR-1: Scripture loader mints session rotations it cannot commit — silent sign-out vector on chapter navigation

- **Severity:** high
- **Category:** session-integrity / regression outside feature
- **File:** apps/web/app/routes/scripture.tsx:339 (`loadChapterNoteAnchors` →
  `getSessionUser`), loader return ~:700-715 (plain object, no headers);
  contrast apps/web/app/routes/scripture.tsx:568-583 (alias-301 path that
  self-carries headers for exactly this reason); apps/web/app/lib/auth.server.ts:103-110
  ("the rotated cookies land in `headers` — which the caller MUST attach").
- **Claim (falsifiable):** The A5 anchors fetch makes every signed-in
  canonical chapter load call `getSessionUser`. Pre-feature, the canonical
  path was session-free (session read only on the alias-301 path). The
  in-code comment (scripture.tsx:326-328) says an expired-token inline
  refresh "rides the root loader's headers" — but the root loader
  (root.tsx:31-32, no `shouldRevalidate` export) only revalidates on
  document loads, actions, or search-param changes. On a plain
  chapter→chapter client navigation (next-chapter link, no query string),
  ONLY the scripture loader runs; its refresh-rotation `Set-Cookie` is
  minted inside `loadChapterNoteAnchors` and then dropped, because the
  loader returns a bare object. Sequence to falsify/reproduce: signed-in
  user, access token expired (>1h idle on a document), performs two
  chapter-to-chapter client navs spaced >10s → first nav rotates the
  refresh token server-side (cookie never reaches the browser), second nav
  replays the OLD refresh token outside gotrue's ~10s reuse interval →
  token-family revocation → silent sign-out. This regresses ALL signed-in
  reading (any `sb-*-auth-token` cookie holder), not just notes users, and
  is the exact bug class the alias-301 comment ("intermittent silent
  sign-out") guards against. Navigations that change search params
  (`?verse=` clicks) revalidate root and self-heal, which will make this
  intermittent and hard to attribute. Harness gap: green e2e uses freshly
  minted tokens; no test ages a token past expiry.
- **Proposed fix:** Have `loadChapterNoteAnchors` return the session
  headers it accumulated (`{ canCapture, anchors, headers }`) and return
  the loader payload via `data(payload, { headers })` — mirroring the
  301 path. Alternative: skip `getSessionUser` here entirely; call the
  PostgREST client with the raw cookie token and treat 401 as
  signed-out/degraded (no refresh ever initiated on a path that cannot
  commit it).

## BR-2: notes-only scope logs `zeroResult: true` with `scope: null` — pollutes the pre-existing relevance stream

- **Severity:** med
- **Category:** observability / contract (A4 "zeroResult unpolluted")
- **File:** apps/web/app/routes/api.search.tsx:168-177 (synthetic empty
  `SearchResponse`), apps/web/app/routes/search.tsx:328-336 (same),
  apps/web/app/lib/search-obs.server.ts:50,58-62.
- **Claim (falsifiable):** On the signed-in `scope=notes` path, `scope`
  ends up `undefined` (extractNotesScope → `canonRaw: null` →
  `parseScope(null).value === undefined`) and the synthetic result has
  `groups: []`. `logSearchExecuted` then emits `scope: null` (looks
  unscoped), `groups: {}` and — because `[].every(...)` is `true`,
  `after` undefined, `reference` null — `zeroResult: true`, even when the
  notes leg returned hits. Every signed-in notes-only search lands in the
  pre-feature zero-result denominator as an unscoped relevance failure,
  distinguishable only via the new `extraGroups` field that no existing
  consumer of this stream knows about. A4 explicitly required the
  zeroResult signal stay unpolluted.
- **Proposed fix:** On the notesOnly path pass an explicit marker: either
  log `scope: ['notes']`-equivalent (a route-layer label field, keeping
  the `GroupKey[]` type clean) or set `mode: 'skipped'` on the synthetic
  meta and make `logSearchExecuted` suppress `zeroResult` (or compute it
  from `extraGroups` too) when the canon engine did not run.

## BR-3: Deferred scope-400s now read the session (headers + latency delta); body bytes verified frozen

- **Severity:** low (observation; accept or pin)
- **Category:** api-contract / byte-freeze
- **File:** apps/web/app/routes/api.search.tsx:42-44 vs :140-142;
  apps/web/app/routes/search.tsx:277-291.
- **Claim:** Pre-feature, `scope=notes` 400s were emitted before any
  session work. Now the deferred replay runs `getSessionUser` first and
  attaches its headers. Verified no new failure interleaving:
  `getSessionUser` never throws (auth.server.ts doc + code) and
  short-circuits via `hasAuthCookie`, so cookieless signed-out requests
  pay ~zero and get responses byte-identical INCLUDING headers; the body
  is byte-identical in all cases (`badRequest` builds
  `{ error, code }` in that key order; the deferred call reproduces it
  exactly, same `Content-Type`/`Cache-Control` via the shared `json`
  helper). The only observable deltas: (a) a signed-out request carrying a
  stale `sb-*` cookie may now receive rotation `Set-Cookie` on the 400
  (arguably correct — B4 doctrine — and unlike BR-1 these headers ARE
  attached), and (b) one session read of added latency on that error
  path. The committed byte-capture replay (A4) pins bodies, so this
  passes it.
- **Proposed fix:** None required; record the header delta next to the
  byte captures so a future header-level diff doesn't read as drift.

## BR-4: searchAll canon-filter early return — pre-feature behavior preserved; unreachable from all real callers

- **Severity:** low (checked-clean with one dead-path note)
- **Category:** engine contract
- **File:** packages/scripture/src/search.ts:681-695, :660 (mintNextCursor).
- **Claim:** `searchAll` has exactly two consumers (api.search.tsx:190,
  search.tsx:345), both of which canon-validate scope via `parseScope`
  before calling, and both skip `searchAll` entirely on notesOnly. For
  every input reachable pre-feature the new filter is an identity map
  (`GROUP_KEYS.includes` true for all elements) and `opts.scope = []`
  still widens to all groups exactly as before (`?.length` falsy → null →
  `[...GROUP_KEYS]`). The empty-after-filter early return (`groups: [],
  mode: 'none'`, `reference: null`) is reachable only by a caller casting
  non-canon keys into `GroupKey[]` — none exists; note it forfeits
  reference resolution, so it must stay unreachable (it is, today). The
  `mintNextCursor` change (`SearchGroup & { key: GroupKey }`) is
  type-narrowing only — zero runtime delta; groups are constructed from
  canon `scope` so the intersection type is honest.
- **Proposed fix:** None. Optionally add a one-line comment on the early
  return that it is a structural backstop, not a supported path (the
  CF-7 comment already implies this).

## BR-5: SearchGroup.key / GROUP_RESULT_TYPES widening — every GroupKey indexer enumerated, none breaks

- **Severity:** none (checked-clean)
- **Category:** type-widening consumer audit
- **File:** packages/scripture/src/search-types.ts:32,54,91;
  apps/web/app/routes/search.tsx:407,417,729-730,1033,1185,1360,1425-1450;
  apps/web/app/lib/search-obs.server.ts:37-45.
- **Claim:** `GROUP_LABELS`/`GROUP_ICONS` (`Record<GroupKey, …>`) are only
  ever indexed from `included` (derived from `GROUP_KEYS`/`scopeParam`,
  both canon-only) — never from a merged group's `.key` — so the notes
  group can never produce an `undefined` label/icon lookup at runtime;
  the notes group renders through its own dedicated section
  (search.tsx:1360-1414) with a hardcoded header. `GROUP_RESULT_TYPES`
  (now `Record<SearchResponseKey, …>`) has no consumer that iterates or
  indexes it in app or package code outside tests. `logSearchExecuted`
  iterates `result.meta.perGroup` — canon engine output only; the notes
  leg arrives via the new `extraGroups` field. `parseScope`'s vocabulary
  and error string (search-request.server.ts:56-71) still derive from
  frozen `GROUP_KEYS` — signed-out validation bytes untouched.
  `TYPE_ICONS` was widened WITH the `note` entry (search.tsx:439-442), so
  the `Record<ResultType, …>` totality still typechecks. No consumer
  breaks.

## BR-6: NOTES_ENABLED=0 shape at all four gates — verified pre-feature

- **Severity:** none (checked-clean)
- **Category:** kill switch
- **File:** apps/web/app/lib/notes-enabled.ts:12-14;
  apps/web/app/routes/notes.tsx:28; apps/web/app/routes/notes.$id.tsx:65,143;
  apps/web/app/routes/scripture.tsx:335; apps/web/app/routes/api.search.tsx:140,158;
  apps/web/app/routes/search.tsx:315-321; apps/web/app/routes/media.tsx:224.
- **Claim:** With the flag off: /notes and /notes/:id (loader AND action)
  404 before any auth or DB work — the literal pre-feature shape for
  nonexistent routes, and no signed-in/out oracle; the scripture anchors
  fetch is skipped before `hasAuthCookie` (anchors `null`, `canCapture`
  false → `notedVerses` empty → `hasDepth` and both dot clusters render
  byte-identically to pre-feature markup); both search surfaces replay the
  frozen `scope_unknown` 400 for scopes naming notes and skip the leg
  otherwise (`mergeNotesGroup(canon, null)` returns the canon array by
  reference — response construction identical); media `canCapture` false
  → the `+ note` affordance never renders. Off provably equals
  pre-feature at every gate. Note the flag is a deploy-time var
  (wrangler.json:29) — flipping it is a redeploy, acceptable at this
  scale; `wrangler rollback` to a pre-feature version drops the var
  harmlessly (helper defaults ON but pre-feature code never reads it).

## BR-7: migrate-notes.mjs revokes — no existing consumer runs as a revoked role; two residual notes

- **Severity:** low
- **Category:** migration / grants blast radius
- **File:** scripts/migrate-notes.mjs:198-213 (GRANTS_SQL);
  apps/web/app/lib/admin-users.server.ts:199-258;
  apps/web/app/lib/entitlements.server.ts:31; scripts/smoke-notes-rls.mjs:187-191.
- **Claim:** `REVOKE ALL ON lumen.app_users, lumen.user_roles, lumen.roles,
  lumen.migration_state FROM authenticated, anon` breaks nothing that
  exists: the only readers of those relations are admin-users.server.ts
  and entitlements.server.ts, both through `context.db` (the `lumen_read`
  DSN — untouched by this revoke), plus migration scripts on the admin
  DSN. Pre-feature, `authenticated`/`anon` could not reach schema lumen
  through PostgREST at all (schema unexposed), so no external dependency
  on those grants could exist. `REVOKE EXECUTE ON lumen.set_updated_at()
  FROM … authenticated` cannot break the trigger (EXECUTE on trigger
  functions is checked at trigger creation, not fire time — and the
  harness pins updated_at firing, green). Two residuals: (1) `ALTER
  DEFAULT PRIVILEGES IN SCHEMA lumen REVOKE EXECUTE ON FUNCTIONS FROM
  PUBLIC` changes the default for every FUTURE lumen function created by
  the admin role — a later migration that expects `lumen_read`/PUBLIC to
  call a new function will silently 42501; this is A6's intent but
  deserves a line in the migration-conventions doc so the next feature
  doesn't debug it cold. (2) The negative-space sweep filters `grantee IN
  ('authenticated','anon')` and the revokes name only those roles — a
  PUBLIC-grantee table grant would be invisible to both while `GRANT
  USAGE ON SCHEMA lumen TO authenticated` would activate it through
  PostgREST. Probed live (admin DSN, 2026-07-30): **zero PUBLIC-grantee
  grants exist in schema lumen**, so this is a sweep-hardening note, not
  an exposure.
- **Proposed fix:** Add `'PUBLIC'` to the sweep's grantee filter in
  smoke-notes-rls.mjs (one-line; keeps the invariant true against future
  drift) and one conventions line about the default-privileges change.

## BR-8: Byte-freeze interleaving hunt — signed-out combinations verified; A16 checklist coherent with recorded reality

- **Severity:** none (checked-clean, enumerated)
- **Category:** api-contract / ops
- **File:** apps/web/app/routes/api.search.tsx:60-130;
  apps/web/app/lib/search-request.server.ts:38-53; plan.md A16.
- **Claim:** Signed-out interleavings hunted against the pre-feature
  statement order (q → scope → limit → cursor-length → cursor-decode):
  q-invalid × anything → q error first, both eras (q parses before scope
  in api.search in both). `scope=notes` × {limit garbage, oversized
  after, both} → deferred path skips limit/cursor and replays
  `scope_unknown` — exactly the pre-feature outcome (scope 400 fired
  before limit/cursor were ever read). `scope=notes,bogus`,
  `scope=bogus`, `scope=` (empty), `scope=notes,notes`, and
  whitespace variants all fall through `extractNotesScope` →
  re-`parseScope` → the identical `scope_unknown` bytes (the canon
  remainder is re-parsed by the same untouched function that generates
  the message). Any fully-canon scope leaves `deferredScopeError` null
  and executes the byte-for-byte pre-feature statement sequence,
  including the cursor single-group rule. /search mirrors: scope=notes
  with missing/short/invalid q throws the scope 400 before any q-state
  branch, matching the pre-feature scope-first order. Signed-out
  responses on valid requests are constructed from `mergeNotesGroup(g,
  null)` ≡ the same array reference — no re-serialization delta. A16
  checklist order (migrate+smoke → exposed-schema + anon probe → worker
  deploy → signed-out byte-diff) matches recorded reality (migration
  applied 14/14, smoke 19/19, dashboard exposure done, anon probe 42501;
  worker deploy + byte-diff replay remain). One coherence footnote:
  because dev and prod share the Supabase project, grants + exposure are
  already live under the pre-feature prod worker — signed-in users could
  technically write notes via direct PostgREST today; RLS + the
  lumen_read no-grant wall make this invisible to every shipped surface,
  so pre-deploy prod behavior is unchanged. Second footnote: the
  mandatory `git log HEAD..main` divergence check must run against the
  ref that tracks deployed prod (origin/main, currently frozen per repo
  process) — against a stale local `main` it is vacuous.

## Summary

1 high (BR-1), 1 med (BR-2), 3 low (BR-3, BR-4, BR-7), 3 checked-clean
lanes explicitly enumerated (BR-5 type-widening consumers, BR-6 kill-switch
gates, BR-8 signed-out byte-freeze interleavings + wrangler var + A16
coherence).
