# Plan — personal-notes

## Tier
**large** — risk axes tripped: public surface (new routes, reader rail register,
search group), auth/authz (RLS policies, per-user data, signed-in gating), data
migration (two new tables + RLS + trigger), behavior change (net-new flagship
feature), cross-system blast radius (packages/scripture GROUP_KEYS + apps/web).
Schema migration + RLS are always-escalate. Justification: new module with
schema + RLS, well over 300 lines net-new behavior.

## Goal
Signed-in users write markdown-stored, WYSIWYG-edited notes anchored to
verses, chapters, entities, or transcript segments, with five low-friction
ways to link canon into a note; notes surface in the reader rail, at /notes
routes, and as a personal group in search — invisible to signed-out users.

## Human-ruled constraints (Abram, 2026-07-30 — not open for panel re-litigation)
- **Editor: raw ProseMirror** + first-party modules (model/state/view/keymap/
  history/inputrules/prosemirror-markdown). NOT TipTap, NOT CodeMirror, NOT
  Atomic Editor. Rationale recorded: foundations-not-wrappers; PM chosen for
  non-technical users ("Google Docs-y", syntax never renders).
- **Markdown is the stored format.** Constrained schema; parse→serialize
  byte-round-trip is a pinned invariant. Editor choice stays reversible.
- **Single engine.** CodeMirror source mode = deliberate deferral; "edit as
  markdown" styled-textarea = v1.5 candidate. Not in v1.
- **Easy linking is v1 scope** (five mechanisms, §Linking below), including
  Cmd+J insert-posture palette (user-added).
- **Theme:** steal structure (Atomic's CSS-variable set, MIT) and iterate to
  house tokens.
- One anchor/mark model designed so a future highlight = body-less mark;
  highlights UI NOT in v1.

## Scope
- In:
  - `lumen.notes` + `lumen.note_anchors` tables, RLS owner-only, updated_at
    trigger, tsvector generated column, soft-delete (`deleted_at`).
  - Write path: SSR Supabase client (PostgREST, user JWT) per navigation.md
    §3a — no new DSN; React Router actions.
  - ProseMirror editor as a lazy chunk: constrained schema (paragraph,
    heading 1–3, bold, italic, bullet/ordered list, blockquote, wikilink
    inline node), input rules, markdown round-trip.
  - Linking mechanisms 1–5 (§Linking).
  - Routes: `/notes` (index), `/notes/:id` (read + edit). Fail-closed
    signed-out (redirect to /login).
  - Reader: "Your notes" rail register (reserved by navigation.md §4),
    add-note affordance on verse selection, personal note dot (`bg-dot-note`,
    5th kind) in margin cluster + mobile stack; per-user anchor fetch in
    chapter loader (signed-in only).
  - Media page: transcript-segment capture (cut-line 1).
  - Search: `notes` group added to GROUP_KEYS; notes leg queried RLS-side
    (user JWT) and merged at the route layer in GROUP_KEYS order; signed-out
    responses unchanged.
  - Server-rendered note reading (markdown→HTML, constrained, escaped).
  - Minimal Playwright e2e layer (~6 flows) — the twice-recommended infra.
- Out:
  - Highlights UI; backlink registers ("notes citing this verse"); Desk
    register (Desk itself unbuilt — lands with the Desk feature); sharing;
    personal graph edges materialized from links; collections integration;
    live preview concepts (moot under PM); CM source mode; note templates;
    full-text search operators inside notes group (plain websearch v1).

## Linking (v1 mechanisms — all emit `[[ref-id|label]]` markdown)
1. **Reference input rule** — typing "Alma 32:21" auto-links via the shipped
   client-side `parseReference`; no syntax. False-positive fixtures required.
2. **`[[` autocomplete** — suggestions from the destination-index source the
   palette uses (books/chapters client-side + entity slugs).
3. **Reader capture** — selected verse rail: "Add to note" (new note anchored
   here / append link to last-touched note).
4. **Paste conversion** — pasted Lumen URL becomes a typed link.
5. **Cmd+J insert posture** — SearchModal reused in insert mode: picks a
   destination, inserts link at cursor; selection becomes label; Esc returns
   to editor per escape registry. Three doors: Cmd+J / selection affordance /
   `[[`. One implementation, three triggers.

## Files touched (approx)
- scripts/migrate-notes.mjs (new) — tables, RLS, trigger, grants (NO grant to
  lumen_read — see D3), tsvector
- scripts/smoke-notes-rls.mjs (new) — live two-user RLS probe
- packages/scripture/src/search-types.ts (edit) — GROUP_KEYS + notes types
- packages/scripture/src/notes-refs.ts (new) — anchor/link ref-grammar
  validation against slug-map
- apps/web/app/lib/notes.server.ts (new) — CRUD via PostgREST, validation
- apps/web/app/lib/notes-render.server.ts (new) — constrained md→HTML
- apps/web/app/components/editor/* (new) — PM schema/setup/input-rules/
  wikilink/insert-palette glue (lazy)
- apps/web/app/routes/notes.tsx, notes.$id.tsx (new); routes.ts (edit)
- apps/web/app/routes/scripture.tsx (edit) — rail register, dot, affordance
- apps/web/app/routes/media.tsx (edit) — transcript capture (cut-line 1)
- apps/web/app/routes/api.search.tsx + search.tsx (edit) — notes group merge
- e2e/* (new) — Playwright config + specs

## Public contract
- Routes `/notes`, `/notes/:id` (signed-in only; signed-out → /login).
- Actions: create / update (LWW) / soft-delete.
- `/api/search`: signed-in responses may include `notes` group in GROUP_KEYS
  order; signed-out byte-compatible with today.
- Reader rail register + personal dot (signed-in only).
- Stored note body: markdown, constrained construct set, `[[ref|label]]`.

## Architecture decisions (proposed; panel input welcome)
- **D1 write path**: PostgREST via existing SSR Supabase client; RLS
  `owner_id = auth.uid()` on both tables, all operations.
- **D2 schema**: notes(id uuid pk, owner_id, body_md, created_at, updated_at,
  deleted_at, search tsvector generated); note_anchors(note_id fk cascade,
  owner_id denormalized for RLS, kind check in verse|chapter|entity|
  transcript, ref_id, pk(note_id,kind,ref_id)). Title derived from first
  line — no column.
- **D3 search isolation**: `lumen_read` gets **no grant** on notes tables —
  leakage through the shared search path becomes structurally impossible.
  Notes leg runs through the user's PostgREST client (textSearch on the
  generated tsvector), merged at api.search route layer in GROUP_KEYS order.
- **D4 renderer**: markdown-it, html:false, rule-whitelisted to the
  constrained set, custom wikilink inline rule; unknown/unresolvable refs
  render as styled plain text (fail-closed).
- **D5 reader anchors**: chapter loader fetches the user's anchors for the
  chapter via PostgREST (one call, signed-in only); merges into existing
  verse-signals shape as 5th kind.
- **D6 concurrency**: last-write-wins v1; action returns fresh updated_at.
- **D7 bundle**: PM + editor code in a route-level lazy chunk; reader/search
  hydration graphs must not include it (asserted).

## Failure modes (each must have a harness assertion)
- F1 cross-user: user B cannot read/update/delete A's note or anchors via
  PostgREST; A's notes never in B's search group. (smoke-notes-rls, red-first)
- F2 signed-out: /notes* redirects; /api/search has no notes group and is
  byte-compatible with pre-feature shape; chapter loader makes zero
  notes calls; no dot renders.
- F3 round-trip: markdown → PM doc → markdown byte-identical over fixture
  corpus (wikilinks, nested lists, edge whitespace, empty doc).
- F4 reference rule: fixtures for true refs ("Alma 32:21", "1 Ne. 3:7") and
  non-refs ("He said unto them", "3 in the morning") — zero false positives.
- F5 unknown `[[ref]]`: renders as plain styled text, never a broken link,
  never an error.
- F6 XSS: raw HTML, `<script>`, event-handler attrs, javascript: URLs in
  body or link labels are escaped/neutralized in every render surface
  (note page, rail, search result snippet).
- F7 anchor validation: nonexistent ref_id or invalid kind → 400; note
  without valid owner → RLS reject.
- F8 soft-delete: deleted note absent from /notes, rail, search; direct
  /notes/:id → 404.
- F9 search contract: GROUP_KEYS order preserved with notes present;
  signed-out pagination/cursor behavior unchanged (pin existing).
- F10 bundle: editor chunk absent from scripture/search route client graphs.
- F11 updated_at trigger fires on update; anchors cascade-delete with note.
- F12 mobile editor smoke (Playwright, iOS profile): type, bold, insert
  link, save.

## Harness scope
**behavior** — harness-first **required**. Unit/round-trip/renderer in
vitest (red via missing modules); RLS via scripts/smoke-notes-rls.mjs
(red: tables absent); e2e specs authored with infra, red until implement.

## Learnings surfaced (from state/learnings.md + last 3 retros)
- Browser e2e = top recurring gap (search-ui, graph-view) → Playwright in
  scope; interaction bugs must not ride the human-tester layer again.
- Pin INTEGRATION points, not helpers (unshaken-ingest) → RLS pinned at real
  PostgREST path; round-trip pinned at the save action, not just the lib fn.
- Mock-only loader tests hide data-shape bugs (web-app-wiring) → smoke
  scripts hit live dev DB.
- Panel brief includes scale (single-digit DAU today, personal data,
  Cloudflare Workers runtime) to avoid enterprise-noise (54% on deploy-mcp).
- `tsc -b --force` in all verification; per-agent artifacts persisted
  incrementally; pre-deploy `git log HEAD..main` divergence check.
- Portals escape CSS-hidden wrappers → mount-gate insert-posture modal with
  matchMedia where relevant.

## Cut-lines (ranked, if implementation runs long — human decides at gate)
1. Transcript-segment capture UI on media page (anchor kind ships either way)
2. Cmd+J insert-posture palette (fallback: `[[` autocomplete only)
3. Paste-URL conversion

## Open questions (for human gate)
- Q1 Playwright e2e layer in this feature — proposed default: **yes**
  (two retros converge on it; scoped to ~6 flows).
- Q2 Transcript anchoring in v1 — proposed default: **yes** (cut-line 1
  if long).
- Q3 Soft-delete vs hard-delete — proposed default: **soft** (`deleted_at`;
  purge job later; aligns with data-loss caution).
- Q4 Note title: derived from first line vs explicit field — proposed
  default: **derived** (no column; Obsidian-consistent).
- Q5 Renderer: markdown-it (constrained) vs micromark — proposed default:
  **markdown-it** (simpler custom inline rule for wikilinks; Workers-safe).
- Q6 Mobile compose in v1 — proposed default: **yes, basic** (existing
  visualViewport patterns; physical-device checklist; no new keyboard
  engineering).
- Q7 Concurrent edits — proposed default: **last-write-wins** v1, fresh
  updated_at returned; optimistic-lock deferred.

## Drift baseline (filled at end of step 6)
- plan-hash: c005047af05c10c4 (sha256 of this file with the two baseline hash lines stripped — recompute the same way at step-8 exit)
- harness-hash: 01234b4a4f09d84c (sha256 of the 5 harness test files + smoke script, concatenated in plan order)

## Plan amendments (post-panel synthesis, 2026-07-30)

Architecture revisions folding in the incorporated findings (CF-N = canonical
finding in panel-1.md):

- **A1 (CF-1) — GROUP_KEYS is frozen.** Notes never enters the engine
  vocabulary. `search-types.ts` gains `NOTES_GROUP_KEY = 'notes'`,
  `SEARCH_RESPONSE_KEYS = [NOTES_GROUP_KEY, ...GROUP_KEYS]`, `'note'` in
  ResultType; `SearchGroup.key` widens to the union. searchAll filters
  non-canon keys structurally. parseScope keeps today's vocabulary and
  error bytes verbatim signed-out; pills render session-aware.
- **A2 (CF-2, CF-42) — canonical-form invariant replaces byte-identity.**
  `C(md) = serialize(parse(md))`, house serializer config (`-` bullets, `*`
  emphasis, ATX, trailing `\n`); pins: C idempotent, every save stores C,
  no-op open→close not dirty. Label grammar: `|` and `]]` forbidden in
  labels (insert paths sanitize; serializer strips).
- **A3 (CF-3) — one shared markdown-it config** (editor parser + renderer),
  every out-of-schema rule disabled; parse never throws; out-of-schema
  constructs survive as literal text.
- **A4 (CF-4, CF-7, CF-8, CF-40) — notes search leg contract.** Parallel
  `Promise.all` with searchAll; 400ms abort; degraded → group present with
  `degraded: true` signed-in, canon untouched; `search_group_degraded`
  event + `extraGroups` in search_executed (zeroResult unpolluted); leg
  skips on reference short-circuit; order `updated_at desc`; **no
  nextCursor in v1** (absence = end; group links /notes); `after` + notes
  in scope → 400; signed-out scope=notes → 400 `scope_unknown`, message
  frozen verbatim; signed-in notes-only scope skips searchAll (never
  `searchAll([])`); F2 restated as structural pin + committed byte
  captures replayed post-deploy.
- **A5 (CF-5, CF-52) — anchors fetch contract.** Self-contained
  degraded-as-value promise (session→PostgREST, 750ms abort, never
  throws, `note_anchors_degraded` event) joining the loader's existing
  parallel window; returns a **separate additive `noteAnchors` field**
  (verseSignals untouched — the media-gate mutates that object in place);
  signed-out zero-cost via hasAuthCookie; projection-only select
  (note_id, kind, ref_id, updated_at), limit 200, rail renders ≤20 +
  "See all"; CPERF-6 amended (fetchChapterAnchors ×1/×0, db.execute
  stays 3); SSR'd with the chapter, never streamed.
- **A6 (CF-6, CF-9, CF-24, CF-11, CF-10, CF-38†, CF-39, CF-32, CF-33,
  CF-53, CF-36) — schema + RLS hardening.**
  - Exposure: `GRANT USAGE` to authenticated only; table-scoped CRUD on
    exactly the two notes tables; explicit idempotent REVOKEs on
    app_users/user_roles/roles/migration_state from authenticated+anon;
    `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`;
    negative-space grant sweep in smoke (hard-fail, never skip).
  - `REVOKE ALL ... FROM lumen_read, anon` immediately after CREATE
    (setup-readonly-role.sql:16 default-privileges auto-grant defeats
    "no grant" otherwise); policies all `TO authenticated`.
  - notes: `owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES
    auth.users(id) ON DELETE CASCADE`; `UNIQUE (id, owner_id)`;
    `CHECK (octet_length(body_md) <= 65536)` (gate: size);
    `search tsvector GENERATED ... to_tsvector('english', ...)  STORED`;
    `deleted_at` with 30-day-purge `COMMENT ON COLUMN` (no user-facing
    promise, no v1 job).
  - note_anchors: composite `FOREIGN KEY (note_id, owner_id) REFERENCES
    notes (id, owner_id) ON DELETE CASCADE` (forgery structurally
    impossible); immutable (no UPDATE grant/policy/trigger).
  - Soft-delete enforced at RLS: notes SELECT policy carries
    `deleted_at IS NULL`; anchors SELECT policy carries EXISTS-live-note;
    every UPDATE guarded `deleted_at IS NULL` (0 rows → 404/409); the
    soft-delete action never chains `.select()`.
  - Four explicit per-command policies per table (style; the SEC-3
    reassignment threat itself was refuted — †dropped).
  - Indexes, exactly four: `idx_notes_owner_recent (owner_id, updated_at
    DESC) WHERE deleted_at IS NULL`; `idx_notes_search gin(search) WHERE
    deleted_at IS NULL`; `idx_note_anchors_owner_ref (owner_id, kind,
    ref_id)`; the UNIQUE above. Deliberate omissions recorded in DDL.
  - textSearch call shape pinned: `{config: 'english', type: 'websearch'}`.
  - Generic `lumen.set_updated_at()` trigger fn (first in repo), notes only.
- **A7 (CF-25) — create is one transaction:** SECURITY INVOKER RPC
  `lumen.create_note_with_anchors(body_md, anchors jsonb)`; anchor
  inserts idempotent; owner_id server-derived, never form-supplied.
- **A8 (CF-17, CF-18) — anchor grammar hardened.** Canonical slugs only
  (BOOK_SLUGS values; aliases stay human-input-side); per-book chapter
  counts bound `<book>-<n>`; precedence scripture → entity → transcript;
  transcript refs are `episode@t_start_s` — the `#seq` shape is
  REJECTED by the grammar (moment ids documented non-durable; M3
  re-window queued). Live collision set verified zero under these rules.
- **A9 (CF-19, CF-20, CF-43) — compose flow ruled.** The rail captures,
  the route composes: rail hosts `Add to note` (append to last-touched,
  no navigation, one-line gloss confirmation = undo window) + `New note`
  (navigates, anchor prefilled, Back restores `?verse=`); no last-touched
  → only `New note` prints. Capture VERBS are affordances exempt from
  print-nothing (they are the scent); empty /notes = one italic
  title-plate line + plain `Begin a note` door. `[[` is the universal
  insert door (all widths); Cmd+J is a desktop accelerator; "selection
  affordance" is cut from the plan's language.
- **A10 (CF-12, CF-13, CF-14) — insert posture is a net-new mini-palette.**
  GATE-RATIFIED Shape C (Abram, 2026-07-30): ⌘K is the single summon chord
  everywhere; context sets the verb. Outside the editor ⌘K = global search
  (as shipped). Inside the editor ⌘K opens the palette in insert posture:
  Enter INSERTS at the cursor; ⌘Enter NAVIGATES (autosave has flushed the
  draft, so leaving is safe); foot line `Enter to insert · ⌘↵ to go`.
  Cmd+J is retired from the spec (optional silent alias only). One
  palette, one ARIA implementation, verb from context. Original spec:**
  (SearchModal's shell only; rows/combobox/§5 ARIA contract built here,
  client-side data source, no /api/search leg). Selection captured on
  open and restored on every close; pointer-blur exception does NOT
  apply; insert transaction built from the stored selection. Escape
  registry: built minimally in this feature (first client) — entries
  enumerated: `[[` popup → editor; insert modal → editor+cursor;
  rail compose → verse control; delete confirm → trigger; registry
  empty → Esc inert; Esc never eats a chapter.
- **A11 (CF-15) — bundle mechanism.** `build.manifest: true`; post-build
  closure test (no prosemirror/markdown-it/editor module reachable from
  root/scripture/search/notes/notes.$id static graphs) with positive
  control + fail-when-absent; editor mounts via React.lazy behind edit
  intent (intra-route boundary — reading a note never loads PM); Cmd+J
  glue lives inside the editor chunk; reader capture is a fetcher action.
- **A12 (CF-28) — reference input-rule contract.** Boundary char required;
  period-normalization wraps parseReference; range policy: no fire on
  trailing `-digit` (link-with-range-label deferred); undo suppression
  (Backspace = undoInputRule; suppressed re-fire while typed through);
  inert inside `[[` spans and wikilink labels; paste-over-selection keeps
  selection as label; chapter-form fires only on capitalized
  scripture-unique book names. One polite status region, terse
  announcements (wording at gate).
- **A13 (CF-29, CF-37, CF-26, CF-49, CF-31) — action contract.** Intents
  `create | update | delete` (unknown → 400); `/notes/new` = create
  surface (GET editor, POST 302 → /notes/:id); update/delete =
  fetcher JSON; **autosave REQUIRED (Abram gate ruling, 2026-07-30** — supersedes the
  explicit-save default)**: ≥3s idle debounce, flush on blur/navigation/
  visibilitychange, anchors diffed not rewritten (PERF-6 shape); ⌘S forces
  an immediate flush; save state saved/saving/failed-with-retry always
  visible while dirty; a FAILED autosave is loud (persistent failed state
  + retry affordance — silent autosave failure is the worst outcome, OBS-8)
  and always preserves the buffer; update/delete stay fetcher-JSON (no
  redirect), which the autosave cadence requires anyway. If implementation
  runs long, autosave may ship as the IMMEDIATE follow-up — but the v1
  action contract must be autosave-shaped from day one (harness gap 38
  activates: debounce wiring + anchors-diffed assertions); LWW with base-echo conditional update (`WHERE ... AND
  updated_at = :base`) → 409 + current row on staleness; events
  `note_created/note_updated/note_softdeleted` (ids+sizes only, no
  owner_id, no bodies, no ref_ids) + `note_write_failed {op, cause,
  pg_code?}` with trimmed causes + `note_anchor_invalid_ref` exception;
  EVERY outcome (200/302/400/404/409/500) carries session.headers
  (B4 class) with sentinel pins.
- **A14 (CF-27, CF-45, CF-46, CF-50) — read path.** One markdown-stripping
  helper (hostile-fixture-tested) derives title (~80 cap, "Untitled
  note" fallback) + plain snippet, shared by index/rail/search leg; full
  render only on /notes/:id; renderer never throws (escaped-plaintext
  fallback + `note_render_failed`); heading demotion h(N+1), page h1 =
  derived title, first-line heading not double-rendered; wikilinks get
  dotted underline + composed aria-label; unresolvable refs render
  `<span>`, no link semantics; non-uuid :id → 404 pre-query.
- **A15 (CF-21, CF-16) — the note dot.** GATE-RATIFIED (Abram, 2026-07-30):
  register first above art; hollow ring, first slot; mobile clamps at 4
  visible. Rider (Abram): dot colors become a USER-CONFIGURED palette in a
  future feature — v1 keeps tokens but every dot color must flow through
  the theme-token layer (no inline hex, no per-component color logic) so
  per-user override later is a token-source swap, not a refactor.
  Original spec: Distinct FORM: hollow ring
  (2px stroke) at dot size — "yours vs canon" without color; noted
  verses append visually-hidden ", your note" to the verse link name;
  register label = real h3. Geometry: gate ruling required (defaults:
  register first, above art; ring takes first slot; mobile stack clamps
  at 4 visible, never scrolls).
- **A16 (CF-23, CF-30, CF-34, CF-54) — ops.** `NOTES_ENABLED` env var,
  one helper, four gates, off = pre-feature shape (pinned); schema
  changes additive-only (wrangler rollback stays safe; drop window
  closes at first real note); migrate-notes.mjs bound to
  migrate-media-collections.mjs conventions verbatim + named invariants
  (exit 2 on violation); deploy checklist: migrate+smoke → exposed-schema
  config + curl probe → worker deploy → signed-out byte-diff; mandatory
  `git log HEAD..main` empty before any deploy touching scripture.tsx.
- **A17 (CF-35, CF-44) — formatting + mobile.** Default (gate): keyboard
  v1 + one-line typographic legend at the note foot (earned-quiet after
  ~3 formats) + iOS callout→PM marks via beforeinput, device-verified;
  if the callout check fails: v1 mobile is text-and-links, F12 reworded
  — decided out loud. UX-9 nine-item device checklist adopted verbatim
  into Q6 acceptance; notes routes declare floor behavior now (floor
  absent on /notes* in v1; no second bar ever).
- **A18 (CF-41) — signed-out gate ratified as redirect** (notes existence
  is public; divergence from admin.users 404-concealment recorded);
  `/login?next=<same-origin-path>` honored; redirect carries headers.
- **A19 (CF-22, CF-48, CF-47, CF-51) — quality floors.** Client round-trip
  canary on load → `roundtrip_ok:false` on next save → hash-only
  violation event (gate-confirm); all new appear/recede via `motion-safe:`
  variants only; delete = house AlertDialog, post-confirm focus → /notes
  h1 + announcement; editor React error boundary with readonly-markdown
  fallback (data-loss containment); client beacon NOT in v1 — editor
  error rate deliberately unobserved (recorded).

## Decisions

Per-finding resolutions (tie-break human > panel-2 > panel-1; safety
carve-out honored). CF-x per panel-1.md; original IDs therein.

- CF-1 incorporated (A1) · CF-2 incorporated (A2) · CF-3 incorporated (A3)
- CF-4 incorporated (A4) · CF-5 incorporated (A5; placement fork closed:
  in-window degraded-as-value, separate additive field) · CF-6
  incorporated (A6) · CF-7 incorporated (A4) · CF-8 incorporated (A4)
- CF-9 incorporated (A6) · CF-10 incorporated (A6) · CF-11 incorporated
  (A6) · CF-12 incorporated (A10) · CF-13 incorporated (A10) · CF-14
  incorporated (A10; registry built here) · CF-15 incorporated (A11)
- CF-16 incorporated (A15; final geometry = gate ruling) · CF-17
  incorporated (A8) · CF-18 incorporated (A8) · CF-19 incorporated (A9)
- CF-20 incorporated (A9) · CF-21 incorporated (A15) · CF-22 incorporated
  (A19; panel-2 downgrade noted — kept: cheap, hash-only, gate-confirm)
- CF-23 incorporated (A16; scope trimmed per panel-2 — env flag +
  additive constraint, no extra ceremony) · CF-24 incorporated (A6)
- CF-25 incorporated (A7) · CF-26 incorporated (A13) · CF-27 incorporated
  (A14) · CF-28 incorporated (A12; announcement restraint per panel-2's
  A11Y-5 risky) · CF-29 incorporated (A13; explicit save) · CF-30
  incorporated (A16) · CF-31 incorporated (A13) · CF-32 incorporated
  (A6; 64 KiB default, gate) · CF-33 incorporated (A6) · CF-34
  incorporated (A16; checklist only per panel-2) · CF-35 incorporated
  (A17; shape = gate fork) · CF-36 incorporated (A6; COMMENT only per
  panel-2 — no user-facing purge promise) · CF-37 incorporated (A13)
- CF-38 dropped-as-noise (SEC-3 refuted: USING governs new rows absent
  WITH CHECK; explicit per-command policies kept as style in A6)
- CF-39 incorporated (A6) · CF-40 incorporated (A4) · CF-41 incorporated
  (A18; panel-2 "polish" downgrade noted — next= is cheap) · CF-42
  incorporated (A2 grammar; rename-runbook note added to Out/debt)
- CF-43 incorporated (A9) · CF-44 incorporated (A17) · CF-45 incorporated
  (A14) · CF-46 incorporated (A14) · CF-47 incorporated (A19) · CF-48
  incorporated (A19) · CF-49 incorporated (A13; taxonomy trimmed per
  panel-2) · CF-50 incorporated (A14) · CF-51 incorporated (A19;
  boundary yes, beacon rejected-with-rationale per panel-2: new
  telemetry infra, partial efficacy, tiny population)
- CF-52 dropped-as-noise (panel-2: premature bound; projection+limit
  ships anyway as one line in A5) · CF-53 incorporated (A6; trigger is
  required by F11; anchors-immutable kept — free least-privilege)
- CF-54 rejected-with-rationale (panel-2: repo process, not
  plan-structural) — adopted as one deploy-checklist line in A16
- CF-55 deferred-out-of-scope (⌘K remap is product design; the in-editor
  ⌘K→insert idea offered at gate as optional) · CF-56 dropped-as-noise
  (accepted on record)

Harness gaps 1–53 (panel-1.md §Harness gaps) are adopted as the binding
harness backlog: contract-level revisions land pre-baseline (this
commit); integration-level pins land with their implementation steps;
e2e flows 41–53 land with the Playwright infra (Q1).

## Pipeline status (for session resumption)
- Steps 0-7 COMPLETE as of 2026-07-30: pre-flight, tier (large), plan,
  red-first harness, panel-1 (9 roles → 88 findings), panel-2 (9 adversarial
  taggers), synthesis (56 canonical → A1-A19 + Decisions), human gate.
- Gate rulings: all defaults ratified; G1 dots ratified + user-configurable
  palette rider; G5 AUTOSAVE REQUIRED; G6 = Shape C (⌘K context verb,
  Cmd+J retired). No open questions remain.
- NEXT: step 8 — implement (3-attempt cap, verify hashes at exit vs
  ## Drift baseline; tsc -b --force; pre-deploy git log HEAD..main check).
- Branch: feature/personal-notes.
