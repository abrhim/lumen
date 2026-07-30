# Blast-radius / rollback review — personal-notes (plan-stage)

Lens: what breaks for EXISTING users and surfaces if this ships broken, and can
it be turned off. Scale honored: single-digit DAU, but PUBLIC prod with
frequent previewless deploys — the signed-out surface is the brand, and there
is no staging buffer between a bad merge and a live reader.

Findings ranked. All line numbers verified against working tree at review time.

---

### BLAST-1: `notes` in GROUP_KEYS changes every signed-out search response — the plan's own F2 is unsatisfiable at this layer
**Severity: Critical (contract break on the public surface)**

**Claim.** Putting `notes` into `GROUP_KEYS` (search-types.ts:13) — at index 0
or anywhere — leaks the feature into every signed-out `/api/search` and
`/search` response, violating F2 ("signed-out byte-compatible with pre-feature
shape") and the search-endpoint plan's ratified MUST. This is not an
implementation risk; it is structurally guaranteed by the traced code paths:

**Evidence.**
1. **Default scope inherits the new key.**
   `packages/scripture/src/search.ts:679` —
   `const scope: GroupKey[] = opts.scope?.length ? opts.scope : [...GROUP_KEYS];`
   Every unscoped request (the default for both surfaces) now carries `notes`.
2. **Every scoped key emits a group, leg or no leg.**
   search.ts ~690: `const groups: SearchGroup[] = scope.map((key) => ({ key, results: [] }))`.
   `buildLegs` (search.ts:556–585) has no `notes` branch, so no SQL runs — no
   crash — but **every signed-out response body gains
   `{"key":"notes","results":[]}` at position 0**. Byte-compat dead on arrival.
3. **`?scope=notes` becomes publicly valid and degraded.**
   `apps/web/app/lib/search-request.server.ts:36` validates scope against
   `GROUP_KEYS`, so any signed-out caller can send `scope=notes`. Then
   searchAll builds `legs = []`, `legs[0].query` throws TypeError inside the
   combined try (search.ts ~708) → caught → `meta.combinedError` set → empty
   fallback pass → a 200 with a bare empty notes group and a spurious
   `search_failed`-adjacent `combinedError` in obs. Garbage-but-200, publicly
   reachable, permanently.
4. **Signed-out page density changes.**
   `apps/web/app/routes/search.tsx:237` —
   `adaptiveLimit(scope?.length ?? GROUP_KEYS.length)` — 7→8 shifts the
   per-group limit for every unscoped page search (Δ CU-3 density mapping),
   so even result *depth* changes for signed-out users.
5. **Signed-out UI grows a Notes section.**
   search.tsx:648 `included = scopeParam ?? [...GROUP_KEYS]`; :1284
   `included.map(...)` renders a section per included key; :330
   `GROUP_LABELS: Record<GroupKey, string>` forces a "Notes" label at compile
   time. Signed-out /search renders a Notes group header/pill it can never
   fill.
6. Error-message contract churn: search-request.server.ts:40
   `scope must be a CSV of: ${GROUP_KEYS.join(", ")}` changes for everyone.

**Proposed fix — notes is a ROUTE-LAYER group key, not an engine key.**
`GROUP_KEYS` is the *SQL-leg* enumeration for `searchAll`; notes never gets a
SQL leg (D3 forbids it — no `lumen_read` grant, PostgREST-only). So the right
layer is exactly where D3 already puts the query: the route.
- `search-types.ts`: **GROUP_KEYS unchanged.** Add
  `export const NOTES_GROUP_KEY = 'notes' as const;`, add `'note'` to
  `ResultType`, and a widened response-order constant
  `export const SEARCH_RESPONSE_KEYS = [NOTES_GROUP_KEY, ...GROUP_KEYS] as const`
  with `SearchGroup.key` typed over that union. searchAll's `scope`,
  `parseScope`, `adaptiveLimit`, and every signed-out path stay byte-identical
  by construction — nothing to remember, nothing to gate.
- Route layer (api.search.tsx + search.tsx loader): signed-in only, run the
  PostgREST notes leg and `mergeNotesGroup` (already harnessed in
  `apps/web/app/lib/__tests__/notes-search-merge.test.ts` — that test's shape
  is correct and needs no change) — notes first, canon groups untouched, null
  leg returns the same reference.
- Contract wording: amend the ratified MUST to "signed-out: groups in
  GROUP_KEYS order, byte-compatible; signed-in: optional notes group first,
  then GROUP_KEYS order" — matching plan §Public contract, which already says
  exactly this.
- Signed-in `scope=notes` (notes-only search), if wanted, is a route-layer
  special case parsed *before* `parseScope`; do not widen `parseScope`.

---

### BLAST-2: the red harness PINS the wrong design — it will go green on an F2 violation
**Severity: Critical (harness integrity; blocks everything downstream)**

**Claim.** The already-committed red harness codifies the collision:
`packages/scripture/src/__tests__/notes-harness.test.ts:7-19` asserts
`GROUP_KEYS[0] === 'notes'`. If implementation satisfies that test, BLAST-1
fires in prod, and F2's own pin ("signed-out byte-compatible") can never pass.
Meanwhile the merge harness (`notes-search-merge.test.ts:22-25`) asserts the
signed-out path returns canon groups *by reference, zero mutation* — the two
notes tests contradict each other at the design level. The implementer will
resolve the contradiction ad hoc mid-build unless the panel resolves it now.

**Evidence.** notes-harness.test.ts:8 `expect(GROUP_KEYS[0]).toBe("notes")`;
notes-search-merge.test.ts:23-24 `mergeNotesGroup(canonGroups, null)` →
`toBe(canonGroups)`; plan F2 + F9; search-endpoint MUST pinned live at
`packages/scripture/src/__tests__/search-harness.test.ts:202-205` ("groups
arrive in GROUP_KEYS order on a LIVE unscoped search").

**Proposed fix.** Rewrite notes-harness.test.ts's first describe to pin the
*inverse* invariant: `GROUP_KEYS` still equals the seven canon keys (the
signed-out engine surface is frozen), `NOTES_GROUP_KEY === 'notes'`, and
`GROUP_RESULT_TYPES`-equivalent mapping for notes lives beside it. Keep the
hardcoded seven-key literal in
`apps/web/app/routes/__tests__/api-search.test.ts:38` exactly as is — it is
the accidental tripwire that would have caught this; do not "fix" it by
importing GROUP_KEYS.

---

### BLAST-3: the reader — session + PostgREST on the hottest route's loader, and a 5th dot the recent geometry didn't budget for
**Severity: High (regression surface on the most-trafficked page)**

**Claim.** D5 ("chapter loader fetches the user's anchors… merges into
existing verse-signals shape as 5th kind") touches three load-bearing things
at once on `/`-adjacent traffic:

**Evidence.**
1. **The chapter loader is session-free by documented design.**
   `apps/web/app/routes/scripture.tsx:597-600` — "The reader stays
   session-free on its hot path" — the only `getSessionUser` is on the
   canonical-redirect path (:504-514, hasAuthCookie short-circuit). D5 adds a
   session read + a PostgREST round trip to every signed-in chapter load. A
   PostgREST misconfig (schema not exposed → PGRST106), notes-table absence
   (half-deploy, BLAST-6), or Supabase blip must degrade to *no dot*, never a
   500 on the reader. The loader already has the exact pattern to copy: the
   art fetch's `.catch` + `logEvent("art_gallery_degraded")` (:546-557).
2. **Signal-shape mutation is shared-state surgery.** The loader mutates
   `verseSignals` in place today (`delete s.media` when !showUnshaken,
   :602-604). Merging a 5th kind into that same record means the F2 pin
   ("chapter loader makes zero notes calls" signed-out) and the media-gate
   mutation now interleave in one object — easy to regress either.
3. **The dot cluster was JUST re-geometried for four kinds.** Commits
   18ccb6d ("gutter widened to 56px so full spreads clear the rail") and
   ed752d1/1d0cb0c (§6a.2: mobile 4-kind vertical stack "~23px, inside a
   one-line row"). Desktop: 5 dots at 5px + 4×5px gaps = 45px + 10px offset =
   55px against a 56px gutter — 1px of clearance. Mobile: a 5-dot stack runs
   ~30px against a budget stated as ~23px — a one-line verse row likely
   overflows. scripture.tsx:970-996 renders both clusters from hardcoded
   four-signal conditionals.

**Proposed fix (minimal-touch).**
- **No verse-signals shape change.** Return a separate additive loader field
  (`noteAnchors: Record<number, true> | null`, null signed-out) fetched with
  its own `.catch(() => null)` + `logEvent("notes_anchors_degraded")`. The
  existing dots, media-gate mutation, and signed-out path are untouched by
  construction; F2's "zero notes calls" pin gates on `hasAuthCookie` before
  any client is built.
- Keep the fetch OUT of the critical `Promise.all` (it's PostgREST, not the
  PG pool — different failure domain; do not let it extend the canon
  round-trip window).
- The 5th dot is a design decision, not a code detail: re-open §6a.2's
  budget (5-dot desktop spread vs 56px gutter; mobile stack height) with
  Abram before implementation, or ship v1 with the note dot desktop-only /
  replacing-not-appending on mobile.

---

### BLAST-4: no kill switch in the plan — define it now
**Severity: High (previewless deploys + public prod = you need an off switch before you need it)**

**Claim.** The plan has no mechanism to turn notes off short of a revert
deploy. House precedent is DB-flag kill switches (unshaken: `public=false`),
but notes has no collection row to flip, and the entitlements system
(`apps/web/app/lib/entitlements.server.ts` — fail-closed, 404-on-absent,
per-request) has no "granted to every signed-in user by default" machinery
(roles are hand-granted via scripts/grant-role.mjs), so gating v1 notes on an
entitlement means either building auto-grant-on-signup or silently 404ing
every user.

**Proposed fix — two-layer switch, both cheap:**
1. **Feature flag: `NOTES_ENABLED` Workers env var, default `"1"`.** One
   `notesEnabled(env)` helper checked at exactly four gates: `/notes` +
   `/notes/:id` loaders *and* actions (404, matching requireEntitlement's
   don't-confirm-the-route doctrine), the scripture-loader anchor fetch, the
   search-route notes leg, and the media capture affordance's loader flag.
   Kill = flip the var (dashboard var change or one-line wrangler deploy,
   minutes). Because every gate fails toward the pre-feature behavior, "off"
   is provably the shipped signed-out shape.
2. **Code rollback: `wrangler rollback`** (seconds) is safe *because the
   schema is additive* (BLAST-7): the previous worker never references
   `lumen.notes`, so tables can sit in the DB unused. This property is worth
   a sentence in the plan as a constraint: no v1 change may alter existing
   tables, or instant rollback dies.

Note the safety floor even with no switch: D1's owner-only RLS + D3's
no-grant-to-`lumen_read` mean a *broken* notes feature can corrupt or leak
only the author's own notes — the canon read path and signed-out surface
share no table, no role, and (post BLAST-1 fix) no code path with it.

---

### BLAST-5: PostgREST exposure is schema-wide — the existing `USING (true)` policies were NOT written for it
**Severity: Medium-High (one careless GRANT away from bypassing app-layer visibility)**

**Claim.** D1 requires the `lumen` schema in Supabase's exposed-schemas list
(plus `db: { schema: 'lumen' }` client config). Exposure is per-schema, so it
covers ~18 tables, not 2. Today that is *latently* safe: grep of scripts/
shows **zero grants to `anon`/`authenticated`** — only `lumen_read`
(scripts/setup-readonly-role.sql:14, migrate-user-roles.mjs:108) — and
PostgREST can't touch a table without a privilege. But the RLS layer was
written for a different threat model: `setup-triggers-and-rls.sql:29-47`
gives verses/entities/edges/**collections**/words `FOR SELECT USING (true)`.
Collection *visibility* (including the unshaken kill switch, `public=false`)
is enforced in loaders via `visibleCollections`, not RLS. The moment someone
"fixes" a PostgREST permission error during notes work with
`GRANT SELECT ON ALL TABLES IN SCHEMA lumen TO authenticated`, any signed-in
user can read non-public collections, transcripts, user_roles, and
migration_state directly — and the unshaken kill switch becomes decorative.
Tables like `lumen.user_roles`/`lumen.transcripts` have no RLS at all (RLS
disabled = grant is total access via PostgREST).

**Proposed fix.**
- migrate-notes.mjs grants exactly: `GRANT USAGE ON SCHEMA lumen TO
  authenticated;` + table-scoped `SELECT, INSERT, UPDATE, DELETE ON
  lumen.notes, lumen.note_anchors TO authenticated`. Never `ALL TABLES`,
  never `anon`, never `ALTER DEFAULT PRIVILEGES`.
- Extend `scripts/smoke-notes-rls.mjs` (D3 probe already exists there) with a
  negative sweep: as a throwaway *authenticated* user via PostgREST, assert
  `lumen.collections`, `lumen.user_roles`, `lumen.transcripts` return
  permission-denied — pinning "exposure ≠ access" as an integration
  invariant, per the pin-integration-points learning.

---

### BLAST-6: deploy sequencing — DB → Supabase config → worker; the config step lives outside the repo
**Severity: Medium**

**Claim.** Three artifacts ship: the migration, a Supabase dashboard/API
config change (exposed schemas), and the worker. Only one safe order exists,
and the middle step is invisible to git.

**Evidence + states.**
- **DB first (migrate-notes.mjs):** invisible to the running worker — no
  existing query touches the new tables. Zero-risk window of any length.
- **Config second (expose `lumen`):** additive; existing surfaces don't use
  the PostgREST data API at all (the Supabase client today does auth only —
  auth.server.ts uses `getClaims`, never `.from()`), so nothing existing can
  notice.
- **Worker last.** If the worker ships *first* instead: `/notes` 500s (new
  surface — ugly, tolerable), and the reader + search notes legs fail on
  every signed-in request — which is why BLAST-3's `.catch`-degrade and
  BLAST-1's route-layer merge (null leg → canon groups by reference) must be
  non-negotiable: with them, the worst half-deployed state is "notes quietly
  absent"; without them it's "the reader 500s for signed-in users."
- Missing-config state (steps 1+3 without 2): every PostgREST call returns
  PGRST106 — same degrade path must absorb it.

**Proposed fix.** Deploy checklist in the plan: (1) migrate + smoke-notes-rls
green, (2) exposed-schemas change + a curl probe of PostgREST `lumen.notes`
as a test user, (3) worker deploy, (4) post-deploy: signed-out /api/search
byte-diff against a pre-deploy capture (see Harness gaps).

---

### BLAST-7: migration rollback stance — additive-only, drop window closes at the first real note
**Severity: Medium**

**Claim.** The plan defines the forward migration but no rollback stance.
House history (canon-spine: transition columns dropped only after prod
verification) supports an explicit staged posture.

**Proposed stance (write into the plan):**
- migrate-notes.mjs is **idempotent** (`CREATE TABLE IF NOT EXISTS`,
  `DROP POLICY IF EXISTS` + re-create, per setup-triggers-and-rls.sql house
  style) and **purely additive** — it must not touch any existing table,
  which is what keeps `wrangler rollback` (BLAST-4) always-safe.
- **Pre-launch window:** `DROP TABLE lumen.note_anchors, lumen.notes` is a
  legitimate rollback while the only rows are smoke-test rows (the smoke
  script already deletes its throwaway users; anchors cascade).
- **The window closes at the first real user note.** After that: roll
  forward only. A broken feature gets switched off (BLAST-4), never
  un-migrated — dropping the tables is user-data destruction. Q3's
  soft-delete default reinforces this posture; adopt both together.

---

### BLAST-8: concurrent-session / stale-ref deploys can silently revert the reader work this feature sits on
**Severity: Low-Medium (process, but this feature maximizes the exposure)**

**Claim.** This feature edits scripture.tsx, which took four geometry-
sensitive commits in the last week (0d0d176…1d0cb0c), while origin/main is
frozen (pushes to workflows rejected; local main canonical) and deploys are
previewless. A deploy cut from a worktree/branch that predates those commits
re-ships the selection-box overlap and rail bugs to prod with no preview to
catch it — and a long-running notes branch is exactly such a ref. The
`.claude/worktrees/search-endpoint` copy visible in grep results shows stale
parallel trees are a live phenomenon in this repo, not a hypothetical.

**Proposed fix.** The memorialized pre-deploy `git log HEAD..main` divergence
check graduates from memory-note to a mandatory line in this feature's
deploy checklist (BLAST-6), asserted empty before `wrangler deploy`; rebase
the notes branch onto local main before any deploy touching scripture.tsx.

---

### BLAST-9: observability and test-pin churn — keep the tripwires, budget for the log-shape diff
**Severity: Low**

**Claim.** Even with the BLAST-1 fix, the route-layer merge changes what
`logSearchExecuted` sees for signed-in requests (a group key outside
GROUP_KEYS in `meta.perGroup`/result groups — api.search.tsx:130 logs the
searchAll result today, pre-merge; decide whether the notes leg gets its own
obs event or joins the merged shape). And three existing pins will interact:
api-search.test.ts:38 (hardcoded seven keys — keep, see BLAST-2),
search-harness.test.ts:202-205 (live unscoped order — must keep passing
untouched), search.loader.test.ts:80 (loader group order). None should need
edits under the route-layer design — treat any red among them during
implementation as a design violation, not a test to update.

**Proposed fix.** One decision in the plan: notes-leg observability = a
separate `notes_search_executed`-style event at the route layer (leg ms,
hits, error), leaving the existing searchAll obs stream byte-stable.

---

## Open-question input

- **Contract amendment (new, for the human gate):** ratify the layer split —
  "GROUP_KEYS is the signed-out/SQL engine contract and is frozen; the
  signed-in response order is [notes, …GROUP_KEYS]" — and rewrite
  notes-harness.test.ts to pin it (BLAST-1/2). This supersedes the plan
  line "notes group added to GROUP_KEYS" (§Scope) while keeping §Public
  contract's wording, which is already correct.
- **Kill switch (new):** adopt `NOTES_ENABLED` env gate + additive-schema
  constraint as v1 rollback doctrine (BLAST-4/7). Default: enabled.
- **Q1 (Playwright): yes** — but the highest-value spec from this lens is
  the cheapest: a signed-out sweep (reader chapter, /search, /api/search)
  asserting zero notes surface, run against the built worker.
- **Q3 (soft-delete): yes** — it is also the rollback posture (BLAST-7);
  adopt as one decision.
- **5th dot (input to D5):** the mobile stack budget (§6a.2, ~23px) does not
  fit five kinds; needs an Abram ruling before scripture.tsx is opened
  (BLAST-3.3).

## Harness gaps

1. **F2 has no byte-level fixture.** "Byte-compatible" is asserted nowhere
   executable. Add: capture today's signed-out `/api/search` JSON for 3–4
   fixed queries (incl. one short-circuit reference, one unscoped, one
   single-scope+cursor) as committed fixtures; a test replays them post-
   implementation and asserts exact string equality. This converts BLAST-1
   from review opinion into a red test.
2. **notes-harness.test.ts pins the design this review rejects**
   (GROUP_KEYS[0]==='notes') — must be rewritten before implementation, or
   the harness rewards the F2 violation (BLAST-2).
3. **No exposure-negative probe:** smoke-notes-rls.mjs should assert an
   authenticated PostgREST client is permission-denied on
   collections/user_roles/transcripts (BLAST-5).
4. **No half-deploy assertion:** with notes tables absent (or PGRST106),
   reader chapter load and signed-in search must return 200 with notes
   quietly absent — testable by pointing the degrade paths at a failing mock
   (BLAST-3/6).
5. **No kill-switch test:** `NOTES_ENABLED=0` must reproduce the F2
   signed-out shape for signed-in users across all four gates (BLAST-4).
6. **Mobile 5-dot geometry** has no check anywhere (the recent dot bugs all
   shipped past unit tests); at minimum a Playwright iOS-profile screenshot
   assertion on a max-signal verse row (BLAST-3.3, F12 adjacency).
