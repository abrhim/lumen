# Code-panel — PERFORMANCE (personal-notes, step 9)

Lane: chapter-loader anchors leg, search-leg latency budget, bundle
discipline (client closure + Worker weight), editor chunk, per-request
client memoization, NoteEditor hot paths, /notes index derivation.

Method note: the PERFORMANCE-1 claim was verified empirically — a probe
static import of `~/components/editor/markdown` was injected into
`search.tsx`, the app rebuilt, and `check-notes-bundle.mjs` run against
the resulting manifest; the probe was then reverted and a clean rebuild
confirmed PASS. Numbers below come from those builds.

## PERFORMANCE-1: check-notes-bundle.mjs passes while a static editor import ships 63KB gz into a guarded route

- **Severity:** high
- **Category:** bundle-discipline / test-gap (A11/CF-15 oracle false negative)
- **File:** scripts/check-notes-bundle.mjs:27,56-72 (FORBIDDEN + closure walk); apps/web/app/components/editor/markdown.ts
- **Claim (verified by experiment):** the walk only tests manifest KEYS and
  each entry's `file` name against `/prosemirror|markdown-it|components\/editor/`.
  Vite's manifest keys code-split *shared* chunks by output filename
  (`_<name>-<hash>.js`), not by source-module path. When a guarded route
  statically imports a *helper* from the editor directory (the most likely
  real regression — e.g. reaching for `sanitizeWikilinkLabel` or
  `canonicalizeNoteMarkdown` from a list surface), Rollup splits
  `markdown.ts` + its deps out of the NoteEditor chunk into a shared chunk
  named `_markdown-<hash>.js` — which matches none of the three patterns.
  Demonstrated: with `import { sanitizeWikilinkLabel } from
  "~/components/editor/markdown"` added to `search.tsx`, the build
  produces `_markdown-CFsUQT-f.js` (161KB raw, **63KB gz** — markdown-it +
  prosemirror-model + prosemirror-markdown) inside search.tsx's *static*
  closure, and `check-notes-bundle.mjs` prints
  `✓ app/routes/search.tsx…— editor-free static closure (8 modules)` and
  exits 0. The positive control cannot catch this class: it only asserts
  an editor chunk exists under `dynamicImports` somewhere; it never
  exercises the walk with a known-bad static graph. Only the blatant case
  (statically importing `NoteEditor.tsx` itself, which hoists the
  facade-keyed chunk into `imports`) is caught. This does not contradict
  the green harness — the guard is green precisely because it cannot see
  this leak.
- **Proposed fix:** make the oracle module-granular. Add a ~10-line Vite
  plugin (`generateBundle`) that writes `chunk→Object.keys(chunk.modules)`
  to e.g. `build/client/.vite/chunk-modules.json`, and have the script
  assert no chunk reached by a guarded closure contains a module id
  matching FORBIDDEN. Cheaper stopgap: after the key/file test, read each
  reached chunk's file contents and scan for
  `/prosemirror|markdown-?it/i` signatures (both survive minification in
  the current build). Either way, add a negative control to CI docs: the
  probe-import procedure above must FAIL the script.

## PERFORMANCE-2: searchNotesLeg ships full note bodies to derive an 80-char title and 200-char snippet

- **Severity:** med
- **Category:** query-projection / latency-budget
- **File:** apps/web/app/lib/notes.server.ts:369-386 (`.select("id, body_md, updated_at")`); notes-derive.ts:48-72
- **Claim:** the leg selects `body_md` (DDL cap 64KB/body) for up to
  `limitPerGroup` rows (8–25 via adaptiveLimit) on every debounced
  keystroke search and every /search SSR, then derives title+snippet in
  the Worker. Worst case ≈ 25 × 64KB = **1.6MB** Supabase→Worker transfer
  inside a 400ms abort budget — large notes can blow the budget on
  transfer alone and degrade the whole group (`search_group_degraded`),
  even though the query itself was fast. The schema already maintains a
  bounded generated `title_line` column (migrate-notes.mjs:57) built for
  exactly this reason on the anchors path (A5 recorded deviation: "rail
  titles never ship bodies").
- **Proposed fix:** extend the projection discipline to the search leg:
  add a second bounded generated column (e.g. `snippet_source` = first
  ~600 chars after the title line, or use `left(body_md, 600)` via a
  computed column/RPC) and select `id, title_line, snippet_source,
  updated_at`. `deriveNoteTitle`/`deriveNoteSnippet` already operate on
  prefixes by construction, so results are byte-identical for any note
  whose title+snippet fit the bound.

## PERFORMANCE-3: autosave is a 3s periodic save while typing, not a ≥3s idle debounce

- **Severity:** med
- **Category:** render-hot-path / write-amplification (deviation from the G5 wording; behavior is safe, cadence is not what the code claims)
- **File:** apps/web/app/components/editor/NoteEditor.tsx:543-547 (the debounce effect), 496-517 (dispatchTransaction)
- **Claim:** the effect's dependency list is `[dirty, latestMdRef.current,
  noteId]`. A ref's `.current` in a dependency array is inert — deps are
  only re-evaluated on re-render, and during continuous typing there is
  no re-render: `setDirty(true)` bails out once `dirty` is already true,
  and `setPopup(null)` bails while the popup is closed (dispatchTransaction
  runs outside React otherwise). So the 3s timer set at the first dirty
  render is never reset by subsequent keystrokes and fires mid-typing;
  after the save round-trip resets `dirty`, the cycle repeats. Net: a
  user typing continuously produces a full save every ~3s + RTT — each
  one serializing the doc, POSTing the whole body, canonicalizing it on
  the Worker (parse+serialize of up to 64KB), running the LWW update,
  and a `syncNoteAnchors` read+diff — instead of one save at the first
  3s pause. Falsifiable: type continuously for >6s in an existing note
  with the network tab open; the design predicts zero POSTs until a
  pause, the code produces one every ~3s. The green e2e autosave spec
  doesn't contradict this — it asserts a save *happens*, and extra saves
  still pass it.
- **Proposed fix:** own the timer imperatively where keystrokes are
  actually seen: in `dispatchTransaction`, on `tr.docChanged` do
  `clearTimeout(idleRef.current); idleRef.current = setTimeout(() =>
  saveRef.current(), 3000)`. Delete the dependency-array effect. (Blur/
  visibility flushes already cover the leave-the-page cases.)

## PERFORMANCE-4: full-document markdown serialization on every keystroke

- **Severity:** med
- **Category:** render-hot-path
- **File:** apps/web/app/components/editor/NoteEditor.tsx:501-504 (`latestMdRef.current = serializeNoteDoc(newState.doc)` inside dispatchTransaction)
- **Claim:** every doc-changing transaction serializes the entire PM doc
  to markdown (O(doc size), prosemirror-markdown walk + string building)
  to keep the crash-preservation buffer (`latestMdRef` / the boundary's
  `latestMarkdown()`) current. At the 64KB body cap this is
  milliseconds-per-keystroke work on low-end mobile — pure overhead on
  the typing path, since the value is only consumed by (a) the error
  boundary after a crash and (b) `save()`, which re-serializes anyway
  via `currentMarkdown()`.
- **Proposed fix:** keep `dirtyRef.current = true` synchronous but move
  the serialization off the keystroke: debounce it (~300ms, or
  `requestIdleCallback`), and have `EditorBoundary.latestMarkdown()` try
  `serializeNoteDoc(viewRef.current.state.doc)` first (a React render
  crash does not corrupt PM state) with `latestMdRef` as the fallback.
  Worst-case staleness of the fallback becomes the debounce window
  instead of zero — an acceptable trade for removing O(doc) work from
  every keystroke. Pairs naturally with the PERFORMANCE-3 fix.

## PERFORMANCE-5: /notes index fetches up to 200 full bodies to render titles and snippets

- **Severity:** low
- **Category:** query-projection
- **File:** apps/web/app/lib/notes.server.ts:111-122 (`listNotes`, `select("id, body_md, …")`, limit 200); apps/web/app/routes/notes.tsx:31-39
- **Claim:** every /notes view transfers every listed note's full body
  (worst case 200 × 64KB = **12.8MB** Supabase→Worker) and runs
  `deriveNoteTitle` + `deriveNoteSnippet` per row — each splitting the
  whole body on `\n` (two full-body passes per note). Realistic bodies
  are small and DAU is single-digit, so this is a slow-burn cost, but it
  is the same projection gap as PERFORMANCE-2 and the fix is shared.
- **Proposed fix:** same bounded projection as PERFORMANCE-2
  (`title_line` + `snippet_source` + `updated_at`); drop `body_md` from
  the list read entirely.

## PERFORMANCE-6: reader capture (`append`) is a 5-round-trip serial chain, with a duplicated anchors read

- **Severity:** low
- **Category:** sequential-io
- **File:** apps/web/app/routes/notes.$id.tsx:252-276 (append), apps/web/app/lib/notes.server.ts:275-308 (`syncNoteAnchors` re-reads via `getNoteAnchors`)
- **Claim:** one capture executes serially: `getNote` → `updateNote` →
  `getNoteAnchors` → (if new) `syncNoteAnchors`, whose first statement is
  a second `getNoteAnchors` — 4–5 sequential Worker↔Supabase round trips
  for a verb whose UX is a sub-second inline gloss. At ~40-100ms per
  edge→Supabase hop the tail lands in the 300-500ms range. The anchors
  list fetched at line 269 is discarded and refetched inside
  `syncNoteAnchors` two statements later.
- **Proposed fix:** cheapest cut, no behavior change: since anchor upsert
  is idempotent (`ignoreDuplicates: true`), replace the read-then-sync
  with a direct single upsert of the one new anchor row (skip both
  `getNoteAnchors` calls; `anchor_was_new` can come from the upsert's
  returned row count). Saves 2 round trips per capture.

## PERFORMANCE-7: syncNoteAnchors deletes removed anchors one round trip at a time

- **Severity:** low
- **Category:** sequential-io
- **File:** apps/web/app/lib/notes.server.ts:287-296 (`for (const a of toDelete)` with an awaited `.delete()` per row)
- **Claim:** a save that removes N wikilinks issues N serial DELETEs
  (each its own PostgREST request). A note pruned of ~30 links pays ~30
  sequential round trips inside the autosave action. Insert already
  batches (single upsert); delete does not.
- **Proposed fix:** one batched call:
  `.delete().eq("note_id", noteId).or(toDelete.map(a => `and(kind.eq.${a.kind},ref_id.eq.${a.ref_id})`).join(","))`
  (refs are grammar-validated slugs, safe in a PostgREST filter), or an
  `IN`-list on a composite; alternatively fold the whole diff into the
  existing RPC surface.

## PERFORMANCE-8: the anchors leg's 750ms abort does not bound the leg — the session read before it is unbounded

- **Severity:** low
- **Category:** latency-tail (residual of a documented accepted regression)
- **File:** apps/web/app/routes/scripture.tsx:339-347 (`await getSessionUser` before `AbortSignal.timeout(750)` is even created); apps/web/app/lib/auth.server.ts:107 ("NO timeout" by design)
- **Claim:** `loadChapterNoteAnchors` sits in the chapter's critical-path
  `Promise.all`, and its total latency = `getSessionUser` +
  anchors-fetch. Only the fetch is bounded; `getSessionUser` is
  deliberately timeout-free (abandoning a mid-flight refresh could
  revoke the session) and its expired-token path does network I/O to
  gotrue. The happy path is local ES256 verify with an isolate-global
  JWKS cache (verified: auth-js 2.110 `GLOBAL_JWKS`), so the tail is
  rare — but on the refresh path a slow gotrue blocks the whole chapter
  SSR with no bound, and the loader comment only records the
  "no longer session-free" regression, not the unbounded tail. The memo
  means this adds ~zero cost when the root loader shares the Request; if
  the runtime ever stops sharing Request identity, the chapter pays a
  second full session read (auth.server.ts:96-99 documents that
  degradation).
- **Proposed fix:** accept and record (one comment line naming the
  unbounded refresh tail), or bound the *leg* without aborting the
  refresh: `Promise.race` the whole anchors leg against a ~1.5s timer
  that resolves `{canCapture: true, anchors: null}` (degraded) while the
  un-raced session promise continues in the background for its
  Set-Cookie side effects via the root loader's own await.

## PERFORMANCE-9: Worker-side markdown/prosemirror weight — quantified, within limits (informational)

- **Severity:** low (informational; the import is a settled A2/CF-56 acceptance — not challenged)
- **Category:** bundle-weight
- **File:** apps/web/app/lib/notes-canonical.server.ts; build output
- **Claim (measurements, 2026-07-30 build):** main server chunk
  `server-build-*.js` = 2.28MB raw / **472KB gz** and contains
  markdown-it + prosemirror-model + prosemirror-markdown (pulled by
  `notes-canonical.server.ts` and `notes-render.server.ts`); the SSR
  NoteEditor module is a separate lazily-imported 364KB asset. Well under
  Workers script limits; parser/serializer/renderer instances are all
  module-scope singletons (markdown.ts:132-134,174; notes-render.server.ts:28),
  so per-request cost is the render/canonicalize call itself, not
  construction. The lazy client editor chunk is 342KB raw / **120KB gz**
  (PM suite + markdown-it + suggest/reference-rule), reached only via
  `lazy(() => import(...))` in notes.$id.tsx:362 — correct.
- **Proposed fix:** none required. Worth one line in state/learnings.md
  so the next server-side markdown consumer knows the weight is already
  paid once and must reuse this module, not add a second parser.

## Verified clean (lane items with no finding)

- **Search legs are genuinely parallel** (api.search.tsx:161-199,
  search.tsx:321-348): `searchNotesLeg(...)` is *invoked* (not deferred)
  before `getCollectionAccessStrict`/`searchAll` are awaited, so its
  PostgREST fetch is dispatched synchronously up to the first await and
  runs concurrently with the canon leg; it is awaited only after
  `searchAll` resolves. No accidental serialization on either surface;
  the 400ms leg budget overlaps the canon work rather than adding to it.
- **Zero signed-out cost in the chapter loader** (scripture.tsx:335-337):
  the gate is `notesEnabled(env)` (sync env read) + `hasAuthCookie`
  (one regex over the Cookie header) — no awaits, no client construction,
  before any session or PostgREST work. The Promise.all placement keeps
  the signed-in leg inside the existing parallel window (11th concurrent
  promise; it is PostgREST/fetch, not a PG-pool consumer, so it does not
  deepen the pool-queueing noted for queries 7-8).
- **Per-request PostgREST client memo** (notes.server.ts:100-107):
  WeakMap on Request identity, correct on Workers; multiple data-layer
  calls in one action (e.g. append's 4 calls) share one client. The
  session path constructs its own separate client, but JWKS is cached
  isolate-globally in auth-js (`GLOBAL_JWKS`), so the duplication costs
  an object construction, not a network fetch.
- **Indexes back both hot queries** (scripts/migrate-notes.mjs:78-83):
  `idx_notes_owner_recent (owner_id, updated_at DESC) WHERE deleted_at
  IS NULL` serves listNotes and the leg's recency order; partial GIN on
  `search` serves the FTS leg; `idx_note_anchors_owner_ref (owner_id,
  kind, ref_id)` narrows the chapter-anchors `.or()` to the user's rows
  even where the `like` arm can't range-scan under a non-C collation —
  per-user cardinality makes that immaterial.
- **NoteEditor popup path**: `suggestDestinations` is local parse over
  static tables (suggest.ts) — no network per keystroke inside `[[`;
  `findCanonReferences` runs only on boundary chars over the current
  text block, not the whole doc.

## Summary

critical 0 · high 1 (PERFORMANCE-1) · med 3 (PERFORMANCE-2, -3, -4) · low 5 (PERFORMANCE-5 … -9, one informational)
