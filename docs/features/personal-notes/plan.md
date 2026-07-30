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
- plan-hash: <pending>
- harness-hash: <pending>
