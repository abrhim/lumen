# Code-panel aggregate — personal-notes (step 9, implementation review)

Aggregated from nine role reviews in
`docs/features/personal-notes/reviews/code-panel/` (security, correctness,
api-contract, data-integrity, ux, accessibility, performance, observability,
blast-radius). Deduplicated by underlying issue; severities preserved as
assigned (max of merged, disagreements noted inline). Order: severity desc,
then convergence desc. Original IDs use each lane's own prefixes
(SEC, CORRECTNESS, API-CONTRACT, DATA, UX, A11Y, PERFORMANCE,
OBSERVABILITY, BR).

## Canonical findings

### CP-1: The autosave state machine loses edits — dirty cleared on in-flight responses, the debounce is not idle-based, failed saves never retry, flushes are silent no-ops, and /notes/new has no autosave at all
- **Severity:** Critical (CORRECTNESS-1 critical; CORRECTNESS-2/UX-3 high; CORRECTNESS-12/PERFORMANCE-3 med; UX-14 low — disagreement noted; the cluster composes)
- **Category:** data-loss / autosave
- **raised_by:** [correctness, ux, performance]
- **Original IDs:** CORRECTNESS-1, CORRECTNESS-2, CORRECTNESS-12, UX-3, UX-14, PERFORMANCE-3

**Claim.** Five defects in `NoteEditor.tsx` compose into one system failure against G5's "buffer never lost". (1) `save()` snapshots the body once and the result effect clears `dirtyRef`/`setDirty(false)` unconditionally on any success — keystrokes landed during the flight are marked clean; the blur/`visibilitychange`/unmount flush is gated on `dirtyRef`, so backgrounding the tab discards them with "Saved" on screen (CORRECTNESS-1, :347-352, :567-578). (2) The debounce effect keys on `[dirty, latestMdRef.current, noteId]` — a ref `.current` in a deps array is inert, and `setDirty(true)` bails once already true, so the timer is never reset by typing: saves fire every ~3s mid-composition instead of after 3s idle (G5 says idle), burning full-body POSTs + Worker canonicalization + anchor diffs and churning the LWW base while typing (CORRECTNESS-2, PERFORMANCE-3, UX-14, :543-547). (3) After a failed save, `dirty` stays true and no timer is pending; the next keystroke is a bail-out `setDirty(true)`, so the status line's "retrying on next change" never retries — the OBS-8/A13 silent-failure class (CORRECTNESS-2). (4) `save()` opens with `if (savingRef.current) return;`, so ⌘S and the blur/visibility flush are silent no-ops during any in-flight save — the concrete mobile data-loss path when combined with (1) (CORRECTNESS-12). (5) The idle debounce is explicitly disabled when `noteId === null`: the /notes/new first draft — the buffer with the most to lose — persists only on blur/⌘S/manual Save; a crash loses the whole note, even though the create-redirect continuation makes an idle-fired create safe (UX-3, G5 gate-ruling gap). No green test exercises a keystroke concurrent with an in-flight fetcher; the e2e autosave spec passes because extra saves still satisfy it.

**Proposed fix.** One coherent rework of the save loop: (a) `pendingRef` snapshot per request — clear dirty only when `currentMarkdown() === pendingRef.current`, else immediately re-fire to coalesce; (b) replace the deps-array debounce with an imperative timer owned by `dispatchTransaction` (`clearTimeout` + `setTimeout(save, 3000)` on every `tr.docChanged`); (c) `queuedRef` flag instead of the early return, re-fired from the result effect (fixes ⌘S and flushes); (d) schedule an explicit retry keyed on failure state; (e) let the idle debounce fire the create on /notes/new once the doc is non-empty, relying on the existing create-redirect continuation. Add a vitest that types during an in-flight save and asserts the buffer is not marked clean, and a forced-500-then-type retry assertion.

### CP-2: Rendered note content and the editor have no CSS — the whole markdown surface is typographically flat under Tailwind preflight
- **Severity:** Critical
- **Category:** ux
- **raised_by:** [ux]
- **Original IDs:** UX-1

**Claim.** No stylesheet defines `.note-body`, `.note-editor`, `.note-wikilink`, or `.note-wikilink-dead` (repo-wide grep: only the emit sites and e2e selectors), and ProseMirror's base css is never imported. Under Tailwind v4 preflight: headings render at body size, lists lose bullets/numbers/indent, blockquotes lose form, paragraph margins are zero, and `a {color: inherit}` makes wikilinks identical to plain text — A14's dotted-underline wikilinks and F5's dead-ref styling are unimplemented, and in the editor pressing `#`/`-`/`>` (the constructs the A17 legend advertises) changes the document but nothing visible, gutting the human-ruled "Google Docs-y" rationale. Missing `white-space: pre-wrap` also collapses consecutive typed spaces. Green harness gap: vitest asserts HTML strings, e2e asserts DOM structure/classes, axe passes because flat text is not a contrast violation — nothing asserts computed style.

**Proposed fix.** Add a shared `.note-body`/`.note-editor` typography block in app.css (house Fraunces/Newsreader heading ramp, list/blockquote/paragraph rhythm, dotted-underline `.note-wikilink`, muted `.note-wikilink-dead`), import the ProseMirror base css inside the editor chunk, and add one e2e computed-style probe (e.g. wikilink `text-decoration-style: dotted`) so the class-emit/class-define seam cannot silently reopen.

### CP-3: Body update commits, anchor sync fails or is skipped → misleading 500/ok:true, self-inflicted 409 loop, and silent body/anchor divergence
- **Severity:** High (CORRECTNESS-5 high; API-CONTRACT-5, DATA-2, OBSERVABILITY-4 med — max taken)
- **Category:** correctness / atomicity
- **raised_by:** [correctness, api-contract, data-integrity, observability]
- **Original IDs:** CORRECTNESS-5, API-CONTRACT-5, DATA-2, OBSERVABILITY-4

**Claim.** In `update` (sync_anchors=1), `append`, and `append_undo`, `updateNote` commits the body (new `updated_at`) first; the subsequent `getNoteAnchors`/`syncNoteAnchors` statements can then throw into the route's blanket catch → **500 "The note could not be saved"** — false, the body WAS saved. The client never receives the new `updated_at`, `baseRef` stays stale, and every subsequent save 409s ("changed elsewhere" for the user's own write); for `append`, a retry lands a duplicate line (notes.$id.tsx:213-221, 259-289; notes.server.ts:275-308). The inverse hole (OBSERVABILITY-4): when `readAnchors` fails validation on an update, the code logs a context-free `note_anchor_invalid_ref` and returns `{ok: true}` — body saved, the ENTIRE anchor diff (valid refs included) silently dropped, diverging anchors from wikilinks save after save with no operator-visible note_id. Divergent capture-only notes that are never reopened stay divergent indefinitely — no reader dot, no rail entry.

**Proposed fix.** Wrap the post-commit anchor sync in its own try: on failure return **200 with the fresh `updated_at`** plus `anchors_synced: false` and log `note_write_failed {op: "anchor_sync"}` (anchors are derived state and self-heal on the next save). For the validation skip, add `{op: "update", note_id}` to the event and surface `anchors_synced: false` (or sync the valid subset). Longer term, fold append and the sync diff into an INVOKER RPC sibling of `create_note_with_anchors`.

### CP-4: A 409 permanently wedges the editor — base never re-adopted, Retry guaranteed to fail, and the only offered exit destroys the buffer
- **Severity:** High (CORRECTNESS-3 high; UX-7 med — disagreement noted)
- **Category:** data-loss / conflict recovery
- **raised_by:** [correctness, ux]
- **Original IDs:** CORRECTNESS-3, UX-7

**Claim.** The action returns the full current row on conflict (`current: {body_md, updated_at}`) but the client ignores it — the result effect acts only on top-level `d.updated_at`, which a 409 body lacks. `baseRef` stays stale, so every subsequent save 409s forever. The UI compounds it: `failed` does not exclude `code === "stale"`, so a Retry button prints that resubmits the identical stale base (guaranteed 409 loop), and the copy's only instruction — "reload to merge" — discards the unsaved buffer, and no merge happens on reload (NoteEditor.tsx:567-578, 669-672, 774-792; notes.$id.tsx:223-233). Reachable by a single user without a second device: a reader-rail `append` capture from another tab bumps `updated_at` on the open note. No `beforeunload` guard exists while dirty-and-failed.

**Proposed fix.** On 409: if the buffer is unchanged from `initialBody`, silently adopt `current.body_md` + `current.updated_at`; if it diverges, adopt `current.updated_at` as the new base so the next save wins (what A13's LWW actually asks for) and offer "Keep mine" / "Take theirs" affordances. Suppress Retry on stale; drop "merge" from the copy; add a `beforeunload` guard while dirty with a failed last save.

### CP-5: /notes and /notes/:id serve private note bodies with no `Cache-Control: private, no-store`
- **Severity:** High (SEC-1 high; API-CONTRACT-2 med — disagreement noted)
- **Category:** security / response hygiene
- **raised_by:** [security, api-contract]
- **Original IDs:** SEC-1, API-CONTRACT-2

**Claim.** Every other session-varying surface sets `private, no-store` on every exit (search.tsx:230/396, book.tsx:34, scripture.tsx:582, api.search.tsx:238-240 — the B17/OC-4 `headers()` export exists precisely because RR single-fetch `.data` responses take headers from it, not the loader Response). The two most private surfaces in the app set it on none of their loader exits: notes.tsx returns the SSR HTML carrying every title/snippet with session-commit headers only; notes.$id.tsx returns the full rendered body the same way; both `loginRedirect` 302s can carry a rotated auth Set-Cookie with no cache directive (the exact SECURITY-3 hazard scripture.tsx:582 documents); neither route exports `headers()`. Only the action JSON is covered. Not a live edge leak today (no Cache-Everything rule), but browser disk cache / back-forward on a shared device and the Set-Cookie-replay class are real, and this is a documented house invariant skipped on the route family whose payload is personal devotional data. Same gap extends to scripture.tsx chapter responses now carrying personal `noteAnchors` + `title_line` (decide or record).

**Proposed fix.** Add `export function headers()` returning `Cache-Control: private, no-store` to both notes route modules; set the same header on the `data(...)` headers and inside `loginRedirect` (lift search.tsx's `withNoStore` helper to a shared module). Route test asserting the header on 200, 302, and 404 exits alongside the session-header sentinel pins. Decide scripture.tsx explicitly (private-when-signed-in, or record acceptance).

### CP-6: A18's `/login?next=` is minted and pinned but never consumed — and the consumer, when written, is an open-redirect surface
- **Severity:** High (API-CONTRACT-1 high; SEC-5 med — disagreement noted)
- **Category:** api-contract / authn
- **raised_by:** [api-contract, security]
- **Original IDs:** API-CONTRACT-1, SEC-5, API-CONTRACT-10 (A18 half)

**Claim.** A18 ratifies "`/login?next=<same-origin-path>` honored". Both notes routes mint it correctly; nothing reads it — login.tsx's signed-in bounce is `redirect("/")`, the OTP `emailRedirectTo` is a bare `${origin}/auth/confirm`, and auth.confirm.tsx hard-redirects to `/` on both verify paths (`grep next` across both files: zero hits). A signed-out user who deep-links a note lands on `/` after login; the ratified contract is half-built. The harness stays green because notes.routes.test.ts:105-107 pins only the emission's Location bytes, never consumption (API-CONTRACT-10). Security half: `next` must survive an external hop through Supabase, and the naive fixes (`redirect(next ?? "/")`, a bare `startsWith("/")` check) are open redirects — `//evil.com` and `/\evil.com` pass a leading-slash check and are protocol-relative absolute URLs; on an auth-completion redirect that is a credible phishing pivot.

**Proposed fix.** Implement once, defensively: a `safeNext()` that rejects non-`/`-prefixed, `//`, and `/\` inputs and re-derives pathname+search via `new URL(raw, base)`; thread through login.tsx (carry `next` in the form and in `emailRedirectTo`'s query) and auth.confirm.tsx. Pin `//evil.com`, `/\evil.com`, `https://evil.com`, bare `evil.com` as rejected fixtures plus one full round-trip test (signed-out /notes/:id → login → confirm → back on /notes/:id). If the ruling is instead to drop `next`, delete it from both emitters so contract and code agree.

### CP-7: The 64 KiB guard measures the RAW body but the CANONICAL body is stored — canonicalization can double the bytes and trip the DDL CHECK as a 500; `append` has no size guard at all
- **Severity:** High (CORRECTNESS-4 high; API-CONTRACT-4 med — disagreement noted)
- **Category:** correctness / validation ordering
- **raised_by:** [correctness, api-contract]
- **Original IDs:** CORRECTNESS-4, API-CONTRACT-4

**Claim.** `create`/`update` validate `rawBody` against `NOTE_BODY_MAX_BYTES` but store `canonicalizeNoteMarkdown(rawBody)`, and the serializer backslash-escapes `` ` * \ ~ [ ] `` — measured 2× expansion on bracket/star-heavy input (1001 bytes → 2001), +12% on realistic prose. A ~40-60 KB body passes the 400 guard, fails the `octet_length <= 65536` CHECK → 23514 → `classifyWriteError` → route catch → **opaque 500 "could not be saved"** on a deterministic client-input problem the user cannot see or shrink. `append` never size-checks at all: appending to a note at the cap is always a 500 rather than a clean refusal (notes.$id.tsx:162-164, 182-189, 240-289; migrate-notes.mjs:46).

**Proposed fix.** Canonicalize first, measure the canonical bytes, and 400 `note_too_large` in `create`, `update`, and `append` (post-append canonical body); keep a raw pre-check as a cheap early-out. Alternatively map pgCode 23514/22001 on this table to 400 at the route. Fixture: 60,000 × `*` update → 400, not 500.

### CP-8: The scripture loader mints session rotations it cannot commit — silent sign-out vector on chapter-to-chapter navigation, regressing ALL signed-in reading
- **Severity:** High
- **Category:** blast-radius / session-integrity
- **raised_by:** [blast-radius]
- **Original IDs:** BR-1

**Claim.** The A5 anchors fetch makes every signed-in canonical chapter load call `getSessionUser` inside `loadChapterNoteAnchors` (scripture.tsx:339), but the loader returns a bare object — the refresh-rotation `Set-Cookie` is minted and dropped (auth.server.ts:103-110: "the caller MUST attach"). The in-code comment claims the refresh "rides the root loader's headers", but root.tsx has no `shouldRevalidate` and only revalidates on document loads/actions/search-param changes — on a plain chapter→chapter client nav ONLY the scripture loader runs. Reproduction: expired access token, two chapter navs >10s apart → first nav rotates the refresh token server-side (cookie never reaches the browser), second replays the OLD refresh token outside gotrue's reuse interval → token-family revocation → silent sign-out. This is the exact bug class the alias-301 path (scripture.tsx:568-583) self-carries headers to prevent; `?verse=` navs self-heal via root revalidation, making it intermittent and hard to attribute. Harness gap: e2e uses freshly minted tokens; nothing ages a token past expiry.

**Proposed fix.** Have `loadChapterNoteAnchors` return the session headers it accumulated and return the loader payload via `data(payload, {headers})`, mirroring the 301 path. Alternative: skip `getSessionUser` here entirely — call PostgREST with the raw cookie token and treat 401 as degraded, so no refresh is ever initiated on a path that cannot commit it.

### CP-9: The smoke never adversarially probes the DEFINER `soft_delete_note` — the one function whose hand-written WHERE is the entire security wall
- **Severity:** High
- **Category:** data-integrity / test-gap
- **raised_by:** [data-integrity]
- **Original IDs:** DATA-1

**Claim.** Harness-revision 1 moved the soft-delete boundary out of RLS into the `WHERE id = p_id AND owner_id = auth.uid() AND deleted_at IS NULL` of a BYPASSRLS SECURITY DEFINER function. smoke-notes-rls.mjs:153-160 asserts only the happy path (owner RPC → count 1). No probe has B call the RPC on A's note expecting 0, and no anon RPC probe. The pipeline-status "verified live" was a one-off in-session check, not a repeatable assertion: if a future edit drops `owner_id = auth.uid()`, every smoke check stays green while any authenticated user can delete any note by uuid.

**Proposed fix.** Before A's soft-delete: (1) B calls `rpc("soft_delete_note", {p_id: note.id})` → expect 0 and A still reads the note; (2) anon client calls the RPC → expect error (EXECUTE revoked). Two checks, ~10 lines, same probe style as F1.

### CP-10: check-notes-bundle.mjs passes while a static editor import ships 63 KB gz into a guarded route — the F10 oracle has a demonstrated false negative
- **Severity:** High
- **Category:** perf / test-gap
- **raised_by:** [performance]
- **Original IDs:** PERFORMANCE-1

**Claim.** Verified by experiment: the closure walk tests only manifest KEYS and `file` names against `/prosemirror|markdown-it|components\/editor/`, but Vite names shared split chunks `_<name>-<hash>.js`. Adding `import { sanitizeWikilinkLabel } from "~/components/editor/markdown"` to search.tsx (the most likely real regression — reaching for a helper) produced `_markdown-CFsUQT-f.js` (161 KB raw / 63 KB gz: markdown-it + prosemirror-model + prosemirror-markdown) inside search.tsx's STATIC closure while the script printed "editor-free static closure" and exited 0. The positive control cannot catch this class — it only asserts an editor chunk exists under `dynamicImports` somewhere. Only statically importing `NoteEditor.tsx` itself is caught.

**Proposed fix.** Make the oracle module-granular: a ~10-line Vite `generateBundle` plugin writing `chunk → module ids` to `chunk-modules.json`, and assert no chunk reached by a guarded closure contains a FORBIDDEN module id. Cheaper stopgap: content-scan each reached chunk for `/prosemirror|markdown-?it/i` (both survive minification). Either way, document the probe-import procedure as the negative control that must FAIL the script.

### CP-11: The `[[` popup's combobox ARIA is wired to a non-focused wrapper div — screen-reader users get nothing in the primary insert door
- **Severity:** High
- **Category:** a11y
- **raised_by:** [accessibility]
- **Original IDs:** A11Y-1

**Claim.** `aria-expanded`/`aria-haspopup`/`aria-controls`/`aria-activedescendant` are rendered on the React wrapper `<div ref={mountRef}>` (NoteEditor.tsx:681-689), but the focused element in the `[[` posture is the ProseMirror contenteditable — a CHILD carrying `role="textbox"`. `aria-activedescendant` is only honored on the focused element; on a role-less non-focusable ancestor it is inert, and `aria-expanded` on a generic div is invalid ARIA. The entire A10 combobox contract is visually present but programmatically absent in the `[[` posture (the ⌘K posture's `<input role="combobox">` is correctly wired). The axe suite never opens the popup, so no test contradicts this.

**Proposed fix.** Emit the popup attributes on view.dom itself via ProseMirror's state-dependent `attributes` function in the EditorView config, computed from the autocomplete plugin state; delete the wrapper-div copies.

### CP-12: The `[[`/⌘K popup is anchored to the editor's foot, not the caret — off-screen in any note taller than the viewport
- **Severity:** High
- **Category:** ux
- **raised_by:** [ux]
- **Original IDs:** UX-2

**Claim.** The suggestion popup renders `absolute mt-1` in a container below the PM mount (NoteEditor.tsx:691-753). Typing `[[` near the top of a tall note opens the listbox below the last line — off-screen; the user sees nothing happen, which reads as "the `[[` door is broken", and A9 makes `[[` the universal insert door on all widths. No viewport-collision handling either. Green e2e gap: editor.spec types into one-line notes where foot ≈ caret.

**Proposed fix.** Position from `view.coordsAtPos(view.state.selection.head)` with a flip above the caret when the bottom edge would clip; keep the current foot placement only as the ⌘K insert-posture default if a stable anchor is wanted there.

### CP-13: Search notes rows sit outside the roving tab-stop system — with notes-only matches, no result row is keyboard-reachable and the SR status says "0 results"
- **Severity:** High
- **Category:** ux / keyboard-access
- **raised_by:** [ux]
- **Original IDs:** UX-4

**Claim.** `renderedKeys`/`firstRowKey` iterate only the canon `included` groups (search.tsx:1049-1064), so a notes-row key can never equal `activeRowKey`: Tab lands past the notes section that renders FIRST; focusing a notes row resets the roving memory; and when only notes match (common for personal vocabulary), `firstRowKey` is null and every row on the page has tabIndex −1 — the results list is unreachable by Tab entirely. `totalShown`/`statusText` also exclude notes hits, so the SR status announces "0 results" while note rows are on screen.

**Proposed fix.** Include the rendered notes group when building renderedKeys/firstRowKey (prepend, matching visual order) and add the notes count to totalShown/statusText (or announce separately: "3 of your notes · 12 results").

### CP-14: `note_write_failed` logs a free-text `message` field beyond the pinned `{op, cause, pg_code?}` shape — PG/PostgREST messages can embed ref_ids and user values
- **Severity:** High
- **Category:** obs / privacy
- **raised_by:** [observability]
- **Original IDs:** OBSERVABILITY-1

**Claim.** A13 pins the shape and the module's own header says "ids and sizes only … never anchor ref_ids (allowlisted exception: note_anchor_invalid_ref)", but `failWrite` (notes.server.ts:88-96) logs `message: error.message.slice(0, 200)`. PG messages embed user-supplied values (22P02 renders the offending value; enum violations echo the literal; PostgREST filter-parse failures echo the filter string, which in `getChapterNoteAnchors` contains ref_ids) — so a non-allowlisted event can carry ref-bearing content. Secondary, same class: `note_updated` logs `prev_updated_at`/`new_updated_at`, outside the pinned field set.

**Proposed fix.** Drop `message` from `note_write_failed` (cause + pg_code reproduces the error class), or reduce it to pg_code-keyed static text; if free text is truly wanted, allowlist per-cause and strip anything matching the ref grammar.

### CP-15: Notes-only searches pollute the pre-existing relevance stream — `zeroResult: true` with `scope: null` on every signed-in `scope=notes` search
- **Severity:** Medium
- **Category:** obs / metric purity
- **raised_by:** [observability, blast-radius, api-contract]
- **Original IDs:** OBSERVABILITY-3, BR-2, API-CONTRACT-9 (item b)

**Claim.** On the notes-only path both surfaces synthesize `{groups: [], meta: {perGroup: {}, mode: "none"}}` and pass it to `logSearchExecuted`, where `scope` is `undefined` and `[].every(...)` is true → `scope: null` (looks unscoped) + `zeroResult: true` on EVERY signed-in notes-only search, even one whose `extraGroups` shows `notes: {hits: 8}`. A search the canon engine never ran lands in the pre-feature zero-result denominator as an unscoped relevance failure, distinguishable only via the new `extraGroups` field no existing consumer knows about — the exact pollution A4's "zeroResult unpolluted" pin forbids, inverted in the one direction the pin didn't cover.

**Proposed fix.** Gate zeroResult on the engine having run — `result.meta.mode !== "none"` (or non-empty perGroup) in `logSearchExecuted` — and log an explicit route-layer scope marker (`notesOnly: true` or a label field) so notes-only searches are identifiable. One line each.

### CP-16: The anchor write mechanism is unbounded and serialized — no cap on anchor count, one DELETE round-trip per removed anchor, append's replace-set deletes concurrent anchors, and capture is a 5-round-trip chain
- **Severity:** Medium (SEC-4/DATA-3 med; PERFORMANCE-6/-7 low — max taken)
- **Category:** data-integrity / perf / resource exhaustion
- **raised_by:** [security, data-integrity, performance]
- **Original IDs:** SEC-4, DATA-3, PERFORMANCE-6, PERFORMANCE-7

**Claim.** `body_md` is capped four times over; the anchor set is capped nowhere — `readAnchors`, `validateAnchorRefs`, and `create_note_with_anchors(p_anchors)` are all unbounded, and a 64 KiB body of wikilinks legitimately yields ~5,000 refs sent on every autosave (SEC-4). `syncNoteAnchors` deletes one anchor per sequential PostgREST round trip (notes.server.ts:287-296): N serialized subrequests inside one Worker invocation — the Workers subrequest ceiling (1,000) kills the request mid-loop leaving a partially-synced set, and each RT holds a session against the pool cap of 15, a documented incident source. Delete-first ordering means mid-loop failure is anchor LOSS (DATA-3). `append` uses replace-set semantics for a single-row add: any anchor added by another tab between the route's snapshot and the sync's fresh read is deleted — body writes are CAS-serialized but anchor writes are not (DATA-3). And one capture runs `getNote → updateNote → getNoteAnchors → syncNoteAnchors` (which re-reads anchors) — 4-5 serial round trips, ~300-500ms tail, for a sub-second inline gloss (PERFORMANCE-6).

**Proposed fix.** (a) Cap at the action boundary (`MAX_ANCHORS = 128`, 400 `too_many_anchors`) and mirror in `validateAnchorRefs` + a length guard in the RPC. (b) `append` → one idempotent single-row upsert (`anchor_was_new` from the returned count), `append_undo` → one targeted delete — removes the concurrent-deletion window and 2 round trips per capture. (c) Batch `toDelete` into one statement (`.in()`/`.or()` over validated slugs, or a `sync_note_anchors` INVOKER RPC in the A7 mold so the diff is one transaction).

### CP-17: The global Escape handler dynamically imports the registry — `preventDefault()` runs after dispatch and is a structural no-op
- **Severity:** Medium
- **Category:** a11y / correctness
- **raised_by:** [correctness, accessibility]
- **Original IDs:** CORRECTNESS-9, A11Y-2

**Claim.** The document-capture keydown handler does `import("~/lib/escape-registry").then(({popEscape}) => { if (popEscape()) e.preventDefault(); })` (NoteEditor.tsx:610-619). The dynamic import resolves in a microtask after the event has finished dispatching: `preventDefault` cannot affect the event, and every other Escape listener (Radix AlertDialog, PM handlers, future layers) runs BEFORE the pop — Doctrine 6's "innermost layer only, never falls through" holds today only because no competing listener exists, not by construction. The close itself lands one tick late (racy against same-tick re-renders). The import buys nothing: line 35 already statically imports `pushEscape` from the same module.

**Proposed fix.** Statically import `popEscape` and call it synchronously: `if (e.key === "Escape" && popEscape()) { e.preventDefault(); e.stopPropagation(); }` — keep the capture phase.

### CP-18: `lumenUrlToRef` never checks the origin — pasting any host's URL silently converts to an internal wikilink and destroys the pasted text
- **Severity:** Medium (CORRECTNESS-8 med; SEC-9 low — disagreement noted)
- **Category:** correctness / input validation
- **raised_by:** [correctness, security]
- **Original IDs:** CORRECTNESS-8, SEC-9

**Claim.** The function parses `new URL(raw.trim())` and matches on `pathname` alone — `origin` is never checked (NoteEditor.tsx:220-243). `https://evil.example/scripture/alma/32?verse=21` becomes `[[alma-32-21]]`; worse, the bare two-segment entity branch converts `https://github.com/anthropics/claude` → `[[claude]]` and `https://en.wikipedia.org/wiki/faith` → `[[faith]]`. `handlePaste` returns true, so the original URL text is destroyed (only ⌘Z recovers). Fail-safe direction (produced refs always route into Lumen via gated `anchorRefToPath` — no redirect/XSS), but the user's external reference is silently replaced with an unrelated internal link, against the spec's own "pasted **Lumen** URL" wording.

**Proposed fix.** Gate on `url.origin !== location.origin → return null` (or an allowlist of prod origin + localhost) before any path inspection, and tighten the bare two-segment entity branch to known entity route prefixes.

### CP-19: `sanitizeWikilinkLabel` does not strip newlines — a labelled append destroys the link, bakes escaped garbage into the stored body, and makes the undo impossible
- **Severity:** Medium (CORRECTNESS-6 med; SEC-6 low — disagreement noted)
- **Category:** correctness / markdown boundary
- **raised_by:** [correctness, security]
- **Original IDs:** CORRECTNESS-6, SEC-6

**Claim.** The sanitizer's doc comment pins "the serialized form must re-tokenize to the same node", but `label.replace(/[[\]|]/g, "").trim()` leaves `\n`/`\r`, and the tokenizer rejects inner newlines. The `append` action takes `label` straight off the wire and splices `[[ref|label]]` (notes.$id.tsx:250-258): a newline-bearing label canonicalizes to escaped literal `\[\[…\]\]` junk (measured), trailing lines parse as real headings/blockquotes into the stored body, and `append_undo`'s `endsWith("\n" + line + "\n")` no longer matches → 409, permanent garbage undo cannot remove. `append` is also the only write path with no byte-size guard, so an oversized label 500s instead of 400ing (folded into CP-7's fix). Not reachable from today's rail (label = verseRef) but it is an authenticated endpoint and the sanitizer is the documented guarantee.

**Proposed fix.** `label.replace(/[[\]|]/g, "").replace(/\s+/g, " ").trim().slice(0, 200)` — the whitespace collapse matches `stripNoteMarkdownLine`'s read side. Fixtures: `C("x [[gen-1|" + dirty + "]] y\n")` still contains a wikilink for `dirty ∈ {a\nb, a\r\nb, a\tb, a|b, a]]b}`.

### CP-20: The `lumen_read` default-privilege auto-grant is never neutralized, and the smoke assertion that claims to cover it is a hardcoded pass
- **Severity:** Medium (SEC-3 med; DATA-6 low — disagreement noted)
- **Category:** security / harness integrity
- **raised_by:** [security, data-integrity]
- **Original IDs:** SEC-3, DATA-6

**Claim.** migrate-notes.mjs:203 revokes lumen_read from the two tables this migration creates, but `setup-readonly-role.sql:16`'s `ALTER DEFAULT PRIVILEGES … GRANT SELECT … TO lumen_read` is left in place — the next `CREATE TABLE lumen.*` (note_versions, trash/restore, shares) is auto-granted SELECT to the app's shared search credential, silently re-opening the D3 hole with no assertion between it and prod. The probe that appears to guard this is a no-op: `check("CF-9: …", true, …)` at smoke-notes-rls.mjs:181-185 passes the literal `true` — the queried `pg_default_acl` rows go only into a detail string discarded on pass. An assertion that cannot fail inflates the "PASS 19/19" count and visually launders exactly this mechanism.

**Proposed fix.** (a) Add `ALTER DEFAULT PRIVILEGES IN SCHEMA lumen REVOKE SELECT ON TABLES FROM lumen_read` to GRANTS_SQL (as the grantor role that created the entry; assert the entry is gone rather than assuming). (b) Make the check real: `check("…", defaultAcl.length === 0)` — or demote it honestly to a log line that doesn't count as an assertion. Grep the smoke for other `check(..., true, ...)` calls before trusting the count.

### CP-21: The negative-space sweep has structural blind spots — functions (schema USAGE exposes pre-existing lumen RPCs with PUBLIC EXECUTE) and PUBLIC-grantee grants are both invisible to it
- **Severity:** Medium (SEC-2 med; BR-7 low — disagreement noted)
- **Category:** security / privilege exposure
- **raised_by:** [security, blast-radius]
- **Original IDs:** SEC-2, BR-7

**Claim.** `GRANT USAGE ON SCHEMA lumen TO authenticated` (migrate-notes.mjs:199) makes the three pre-existing lumen functions (`kjv_delta`, two trigger functions) reachable as `/rpc/` by any signed-in user — Postgres grants EXECUTE to PUBLIC by default, and the `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE` at :208 is forward-only and grantor-scoped; the explicit revokes name only this migration's own functions. Impact today is low (pure string fn + trigger-only fns), but the invariant meant to close it (`authenticated_anon_zero_grants_elsewhere_in_lumen`) queries `role_table_grants` — tables/views only, no `pg_proc.proacl` visibility — and the smoke's sweep has the identical blind spot: green while the function surface is open, and the next lumen function inherits PUBLIC EXECUTE plus an open door. Second blind spot (BR-7): the sweep filters `grantee IN ('authenticated','anon')`, so a PUBLIC-grantee table grant would be invisible while schema USAGE activates it (probed live 2026-07-30: zero PUBLIC grants exist today — hardening, not exposure). Also record: the default-privileges change means a future migration expecting PUBLIC/lumen_read to call a new function will silently 42501.

**Proposed fix.** Add `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA lumen FROM PUBLIC, anon, authenticated` before the targeted grants; add a `has_function_privilege`-based invariant (count = 2) and the same probe to the smoke; add `'PUBLIC'` to the sweep's grantee filter; one conventions line about the default-privileges change.

### CP-22: The "Note deleted" announcement mounts with its text already present — most screen readers will never speak it
- **Severity:** Medium (A11Y-4 med; UX-11 low — disagreement noted)
- **Category:** a11y / live-region
- **raised_by:** [accessibility, ux]
- **Original IDs:** A11Y-4, UX-11

**Claim.** Post-delete navigation renders /notes fresh with `<div aria-live="polite">Note deleted</div>` populated on the region's FIRST render (notes.tsx:71-73). Live regions announce mutations to an existing region; content present at insertion is unreliable (frequently silent in VoiceOver/NVDA) — the announcement half of the CF-47 delete ladder is best-effort at most (the h1-focus half works and is what the e2e asserts; delete-confirm.spec asserts only DOM presence, which is why it is green). Secondary: `location.state` persists in history, so Back to /notes re-focuses the h1 and re-renders the message.

**Proposed fix.** Mount the region empty, set the text in a post-mount effect, and clear the consumed history state (`navigate(".", {replace: true, state: null})`).

### CP-23: The full-body projection gap — searchNotesLeg ships up to 1.6 MB and /notes up to 12.8 MB of bodies to derive bounded titles and snippets
- **Severity:** Medium (PERFORMANCE-2 med; PERFORMANCE-5 low — one role, merged)
- **Category:** perf / query projection
- **raised_by:** [performance]
- **Original IDs:** PERFORMANCE-2, PERFORMANCE-5

**Claim.** The search leg selects `body_md` (cap 64 KB/row) for 8-25 rows on every debounced keystroke and /search SSR — worst case ≈ 1.6 MB Supabase→Worker inside the 400 ms abort budget, so large notes can degrade the whole group on transfer alone (notes.server.ts:369-386). `listNotes` transfers up to 200 full bodies (12.8 MB) per /notes view and runs two full-body passes per row. The schema already maintains a bounded generated `title_line` for exactly this reason on the anchors path (the recorded A5 deviation).

**Proposed fix.** Extend the projection discipline: a second bounded generated column (`snippet_source` ≈ first 600 chars after the title line) and select `id, title_line, snippet_source, updated_at` in both reads; drop `body_md` from the list read entirely. `deriveNoteTitle`/`deriveNoteSnippet` already operate on prefixes, so results are byte-identical whenever title+snippet fit the bound.

### CP-24: The notes.$id action runs `getSessionUser` and the kill-switch outside its try — a session failure escapes the A13 JSON contract and can eat the autosave buffer
- **Severity:** Medium
- **Category:** api-contract / error shape
- **raised_by:** [api-contract]
- **Original IDs:** API-CONTRACT-3

**Claim.** A13 pins "EVERY outcome carries session.headers" and update/delete as fetcher JSON, but `getSessionUser` (notes.$id.tsx:144) sits outside the try — api.search.tsx deliberately moved its session read INSIDE the try because pool exhaustion is a documented incident here. A throw during an autosave POST becomes an unhandled action error routed to the root ErrorBoundary (this route exports none), swapping the note page out from under the editor — contradicting "a FAILED autosave always preserves the buffer" on exactly the failure mode this codebase has had. The kill-switch `throw new Response(404)` at :143 has the same fetcher-POST swap behavior (rare; acceptable if recorded).

**Proposed fix.** Move the session read and the notesEnabled check inside the try, mirroring api.search.tsx; return `json({error, code: "internal"}, 500, headers-if-available)` from the catch. The client already treats non-ok fetcher data as failed-with-retry.

### CP-25: Chapter-anchor failures double-emit — `note_write_failed` + `note_anchors_degraded` for one failure, on every 750 ms timeout
- **Severity:** Medium
- **Category:** obs / emission count
- **raised_by:** [observability]
- **Original IDs:** OBSERVABILITY-2

**Claim.** `getChapterNoteAnchors` routes errors through `failWrite` (logs `note_write_failed {op: "chapter_anchors"}` and throws); the loader's catch then logs `note_anchors_degraded` (notes.server.ts:179; scripture.tsx:359-369). Every failure — including every ordinary 750 ms abort, which postgrest-js converts to cause "network" — produces TWO events. A5 pins one event for this degraded path, and a slow chapter load inflating the write-failure count corrupts the exact signal the classifier exists to keep clean.

**Proposed fix.** `getChapterNoteAnchors` throws raw (no `failWrite`); the loader's catch owns the single `note_anchors_degraded` emission — it is the only caller and is already never-throw.

### CP-26: A non-NoteWriteError throw in the action is an unlogged 500 — the catch-all assumes every throw was classified at the data layer
- **Severity:** Medium
- **Category:** obs / silent failure
- **raised_by:** [observability]
- **Original IDs:** OBSERVABILITY-5

**Claim.** The catch comment says "classified + logged at the data layer", but the try also runs `canonicalizeNoteMarkdown` (the A3 "parse never throws" pin covers markdown-it, not the prosemirror-side serializer config), `crypto.subtle.digest`, and `deriveNoteTitle` (notes.$id.tsx:171, 189, 194, 256, 281). Any throw from these returns the generic 500 with zero log lines — a silent-500 class in a personal-data write path on a runtime where stdout is the only signal.

**Proposed fix.** In the catch: `if (!(err instanceof NoteWriteError)) logEvent("note_write_failed", {op: intent, cause: "unknown"})` (name only, no message per CP-14) before returning the 500.

### CP-27: Classifier drift vs real PostgREST errors — "validation" is dead vocabulary, auth failures misfile as "network", and 2200N is a stray code
- **Severity:** Medium
- **Category:** obs / taxonomy
- **raised_by:** [observability]
- **Original IDs:** OBSERVABILITY-6

**Claim.** (a) `NoteWriteCause` includes `"validation"` but nothing can ever produce it, and the route's actual validation 400s (`note_too_large`, `anchor_invalid`, `base_required`) emit no event at all — a client bug producing permanently failing oversized autosaves (A13's worst-outcome class) is invisible to the operator. (b) PostgREST auth-layer errors (PGRST301/302 — session expiry mid-autosave, the module's own documented token-expiry window) fall to the catch-all → `"network"`, the least actionable cause. (c) `"2200N"` is unreachable for this schema — evidence the constraint list wasn't derived from the DDL (22001/22P02/23xxx are the real ones).

**Proposed fix.** Emit `note_write_failed {op, cause: "validation"}` from the three validation 400s (or delete the dead cause); map `PGRST3\d\d` → `rls_denied` or a new `auth` cause; drop 2200N.

### CP-28: Column-unscoped INSERT/UPDATE grants on notes allow timestamp and tombstone tampering on own rows
- **Severity:** Medium
- **Category:** data-integrity / grants
- **raised_by:** [data-integrity]
- **Original IDs:** DATA-4

**Claim.** `GRANT SELECT, INSERT, UPDATE ON lumen.notes TO authenticated` is table-wide; the policies check only ownership + liveness. Via direct PostgREST an authenticated user can, on their own rows: set arbitrary `created_at`; INSERT a born-dead row (`deleted_at` pre-set — with `Prefer: return=minimal` nothing reads the table, so only the owner-only WITH CHECK gates it), producing rows invisible to everyone that count against storage and dodge the app entirely; and attempt `updated_at` writes (currently repaired by the trigger, which is ordering-load-bearing for LWW). App code never writes any of these columns.

**Proposed fix.** `GRANT SELECT ON lumen.notes TO authenticated; GRANT INSERT (body_md), UPDATE (body_md) ON lumen.notes TO authenticated;` and extend the `authenticated_exact_grant_shape` invariant to assert the column-level shape via `information_schema.column_privileges`. Leave note_anchors table-wide (composite FK + WITH CHECK already pin it).

### CP-29: The four-object index pin and the `title_line` contract have no migration invariant — the pin lives only in a comment
- **Severity:** Medium
- **Category:** data-integrity / drift
- **raised_by:** [data-integrity]
- **Original IDs:** DATA-5

**Claim.** The DDL declares "exactly these four" indexes with deliberate omissions and partial predicates that are only correct because they match the RLS-injected `deleted_at IS NULL` qual — but none of the invariants checks pg_indexes; a hand-applied index, a dropped partial predicate, or a failed CREATE INDEX on re-run is invisible to `COMMIT=1` exit-code 2. Likewise the `title_line` generated column (the recorded A5 deviation) has no invariant pinning existence/generatedness/the ≤120 bound, though `getChapterNoteAnchors` hard-codes `notes(title_line)` and fails at runtime if it drifts.

**Proposed fix.** Two invariants: `index_set_is_exactly_pinned` (array_agg over pg_indexes for both tables incl. pkeys, plus `indpred IS NOT NULL` for the two partials) and `title_line_generated_bounded` (pg_attribute `attgenerated = 's'` + pg_attrdef expression contains `120`, or accept existence+generated).

### CP-30: Full-document markdown serialization runs on every keystroke
- **Severity:** Medium
- **Category:** perf / hot path
- **raised_by:** [performance]
- **Original IDs:** PERFORMANCE-4

**Claim.** Every doc-changing transaction serializes the entire PM doc to markdown inside `dispatchTransaction` to keep `latestMdRef` current (NoteEditor.tsx:501-504) — milliseconds-per-keystroke at the 64 KB cap on low-end mobile, pure overhead since the value is only consumed by the error boundary after a crash and by `save()`, which re-serializes anyway.

**Proposed fix.** Keep `dirtyRef` synchronous; debounce the serialization (~300 ms or `requestIdleCallback`); have `EditorBoundary.latestMarkdown()` try `serializeNoteDoc(viewRef.current.state.doc)` first (a React render crash does not corrupt PM state) with `latestMdRef` as fallback. Pairs with CP-1's timer rework.

### CP-31: The `[[` autocomplete span never deactivates on `]]` or forward caret movement — which silently kills the reference auto-link for the rest of the session
- **Severity:** Medium
- **Category:** correctness / plugin state
- **raised_by:** [correctness]
- **Original IDs:** CORRECTNESS-7

**Claim.** The comment says "deactivate when the caret leaves the span or `]]` closes it", but only the backwards case (`head < from + 2`) is handled (NoteEditor.tsx:180-185). Typing a complete `[[alma-32-21]]` by hand, or typing `[[` then clicking into a later paragraph, leaves `from !== null` indefinitely — and the auto-link plugin is gated on exactly that (:93), so typing "Alma 32:21 " links nothing for the rest of the editing session, with the stray popup still mounted. Escape clears it only if pressed (and see CP-17).

**Proposed fix.** In `apply`, close the span when the caret leaves it in either direction, when text between `from` and `head` contains `]]`, or when `head` leaves the block.

### CP-32: Wikilinks typed into a brand-new note produce no anchor rows
- **Severity:** Medium
- **Category:** correctness / anchor derivation
- **raised_by:** [correctness]
- **Original IDs:** CORRECTNESS-10

**Claim.** The `update` branch of `save()` sends every body wikilink as an anchor; the `create` branch sends only `prefillAnchor` (NoteEditor.tsx:351-366). A note composed from scratch with `[[alma-32-21]]` is created with zero anchor rows, violating A13's "body wikilinks become anchor rows"; it self-heals only if a post-redirect autosave lands (which CP-1 makes unreliable) — leaving immediately after Save leaves the note permanently unanchored: no reader dot (A15), no rail entry (A5).

**Proposed fix.** Union `collectBodyRefs(body)` with `prefillAnchor` in the create branch; `create_note_with_anchors` already inserts anchors transactionally, so it costs nothing.

### CP-33: The reference detector swallows leading punctuation into the matched span and link label
- **Severity:** Medium
- **Category:** correctness / detector
- **raised_by:** [correctness]
- **Original IDs:** CORRECTNESS-11

**Claim.** The book-span guard admits `.` (for `1 Ne.`) but the tokenizer is `\S+`, so leading periods join the match: measured `findCanonReferences("...Alma 32:21")` → text `"...Alma 32:21"` at index 0, which `makeAutoLinkPlugin` uses verbatim as the replacement span and the link label — an ellipsis-led quotation gets its ellipsis swallowed into the link, contradicting the file's own F4 posture. Only `.` and `&` leak; bracketed/quoted forms are correctly rejected.

**Proposed fix.** Trim leading non-alphanumerics off the first book token before computing `start` and re-derive the span. Fixtures: `"...Alma 32:21"`, `"..Alma 32:21"`, `"&Alma 32:21"`.

### CP-34: A degraded notes leg is invisible exactly when canon is empty — the zero view prints "Nothing in the library matches" with no notes-unavailable line
- **Severity:** Medium
- **Category:** ux / degraded state
- **raised_by:** [ux]
- **Original IDs:** UX-5

**Claim.** A4: "degraded → group present … absence would read as 'no matching notes'". The degraded branch renders only under `view === "results"`, but `view` computes from canon `results.length` alone — when canon is empty AND the notes leg degrades, the page shows the plain zero state (search.tsx:862-866, 1355-1373). The user's notes may well match; the leg just failed — the exact misread the settled decision exists to prevent, in the one view where the user has nothing else to look at.

**Proposed fix.** Render the degraded one-liner in the zero view too (same copy), or fold `degraded` into the view computation so a degraded-notes zero state gets its own sentence.

### CP-35: The delete dialog makes the 30-day purge promise the plan explicitly withheld
- **Severity:** Medium
- **Category:** ux / doctrine
- **raised_by:** [ux]
- **Original IDs:** UX-6

**Claim.** A6/CF-36: `deleted_at` with COMMENT only — "no user-facing promise, no v1 job". The dialog says "Deleted notes may be purged after 30 days." (notes.$id.tsx:443-446) — a user-facing purge promise implying pre-purge recoverability that does not exist (restore needs a future privileged path per the DEFINER ratification), and no job exists, so the statement is currently false in both directions.

**Proposed fix.** Cut the sentence. "It disappears from your notes, the reader, and search." is complete, true, and house-quiet.

### CP-36: Capture-created notes are titled and rendered as raw slugs ("alma-32-21") — the polish is inverted between sighted users and screen readers
- **Severity:** Medium
- **Category:** ux / copy
- **raised_by:** [ux]
- **Original IDs:** UX-8

**Claim.** The reader-rail "New note" door and the media `+ note` door prefill a label-less wikilink, so the note's first line — and its derived title on /notes, in the rail register, and in search rows — is the raw slug ("alma-32-21", "e217@1042.5"); sighted users see slugs while SRs hear "Alma 32:21" via aria-label. notes-derive.ts's own doc comment ("link-only bodies fall back to 'Untitled note'") is false — the stripped ref is non-empty, so the slug wins. The rail's append path already does it right (label=verseRef).

**Proposed fix.** Prefill with a display label (`[[alma-32-21|Alma 32:21]]` — the loader already resolves the anchor), and make renderer/editor fall back to the display form, not the slug, as visible text for label-less scripture/chapter refs.

### CP-37: "Add to note" dead-ends forever once the last-touched note is deleted
- **Severity:** Medium
- **Category:** ux / dead state
- **raised_by:** [ux]
- **Original IDs:** UX-9

**Claim.** `lumen:last-note` is never invalidated. Delete that note (or soft-delete it in another tab) and every subsequent capture posts to a 404; the rail prints "That didn't save — try again." — and trying again 404s identically, forever, until the user happens to open another note (scripture.tsx:1467-1487; notes.$id.tsx:252-253). The copy diagnoses a transient failure for a permanent one, and the one-click capture loop — the feature's core loop per the competitor analysis — silently degrades on every verse.

**Proposed fix.** On append failure with `code === "not_found"`: clear `lumen:last-note`, drop `last` to null (the New-note door remains), and word it honestly: "That note is gone — start a new one."

### CP-38: A failed editor-chunk load blows away a healthy read view
- **Severity:** Medium
- **Category:** ux / failure affordance
- **raised_by:** [ux]
- **Original IDs:** UX-10

**Claim.** The A19 EditorBoundary lives INSIDE the lazy chunk, so it cannot catch the chunk's own load failure. Clicking Edit on flaky/offline network makes `React.lazy` reject past the `<Suspense>` to the route ErrorBoundary — the perfectly-readable note page is replaced by the error surface (notes.$id.tsx:362, 389-413). "Opening the editor…" covers loading; nothing covers failed, and A11's read-mode-never-loads-PM design makes the fetch happen exactly at the Edit click.

**Proposed fix.** A small error boundary around the `<Suspense>` in notes.$id.tsx whose fallback keeps the user on the page — one line + a retry that re-triggers the import — with the read view still reachable.

### CP-39: The listbox empty state is an invalid child of `role=listbox`
- **Severity:** Medium
- **Category:** a11y / aria
- **raised_by:** [accessibility]
- **Original IDs:** A11Y-3

**Claim.** With zero suggestions the popup renders a role-less `<li>` hint inside `<ul role="listbox">` — `listbox` requires `option`/`group` children (axe `aria-required-children`, WCAG 1.3.1); an implicit `listitem` fails it, and `aria-controls` points at a listbox with invalid content (NoteEditor.tsx:722-727). The axe e2e is green only because no scan runs with the popup open.

**Proposed fix.** Render the hint outside the `<ul>` and the listbox only when there are suggestions (adjusting `aria-expanded`), or give the hint row `role="option" aria-disabled="true"`.

### CP-40: Capture verbs drop focus to body on append/undo — the documented B5 class this same file defends against elsewhere
- **Severity:** Medium
- **Category:** a11y / focus
- **raised_by:** [accessibility]
- **Original IDs:** A11Y-5

**Claim.** Activating "Add to note" unmounts the `<p>` containing the focused button when the fetcher settles (`{!appended && …}`), dropping focus to `<body>`; same on "undo" (scripture.tsx:1473-1493) — exactly the B5 class this file documents and defends for "See all"/"Show fewer" (:1854-1884). Worse in the mobile sheet, where dead focus can strand the SR virtual cursor outside the layer.

**Proposed fix.** On append success focus the gloss's "undo" (or "open") link via ref+effect; on undo, focus the re-printed "Add to note" button — symmetric with the file's existing expand/collapse discipline.

### CP-41: The editor "Done" exit drops focus to body — every keyboard edit session ends in dead focus
- **Severity:** Medium
- **Category:** a11y / focus
- **raised_by:** [accessibility]
- **Original IDs:** A11Y-6

**Claim.** `onClose` flips `editing` false; the Done button unmounts with the editor and nothing receives focus. The read-view h1 already carries `tabIndex={-1}` — clearly the intended landing — but no code ever focuses it (notes.$id.tsx:404-424).

**Proposed fix.** In `onClose` (or an effect keyed on `editing` → false), `h1Ref.current?.focus()`.

### CP-42: The NEW `+ note` media door shelters under the pre-existing `.text-faint` axe exclusion — and /media is not scanned at all
- **Severity:** Medium
- **Category:** a11y / contrast + test gap
- **raised_by:** [accessibility]
- **Original IDs:** A11Y-9

**Claim.** The axe suite excludes `.text-faint` as "PRE-EXISTING reader-chrome contrast debt, not personal-notes surface" — but the brand-new `+ note` link is styled `text-faint text-xs` (media.tsx:530-534), a NEW personal-notes element inheriting the exclusion's shelter; and /media is absent from the axe suite entirely, so the door is doubly unscanned. `--t-faint` on these backgrounds is the documented AA failure class, and the capture affordance — "the scent" per CF-20 — is the last place a sub-contrast token belongs once revealed. (Pre-existing debt itself not relitigated.)

**Proposed fix.** Style the door `text-muted-foreground` (matching the reader capture verbs), and/or add a /media transcript scan to axe.spec.ts without the reader exclusions applied to new nodes.

### CP-43: `NoteEditor.tsx` contains raw NUL bytes — git classifies the feature's largest, most security-relevant file as binary, so it never appeared in any reviewable diff
- **Severity:** Low
- **Category:** review integrity / hygiene
- **raised_by:** [security, ux, accessibility (out-of-lane note)]
- **Original IDs:** SEC-7, UX-12, A11Y out-of-lane note

**Claim.** Four literal 0x00 bytes sit inside the `textBetween(…, "<NUL>", "<NUL>")` separator string literals at NoteEditor.tsx:94 and :215 (verified by byte scan). `git diff --stat` reports `Bin 0 -> 28816 bytes`: no diff in any review of this branch, no blame, no three-way merge, no textual conflict detection, and grep without `-a` silently skips the file — the 830-line editor was invisible to both prior panels and to this one until read directly. The NUL-as-separator technique is defensible (cannot collide with typed text); the raw-byte encoding is the defect. Security read all 830 lines directly; contents are fine — this is a control failure, not a content one.

**Proposed fix.** Replace the literal NULs with `" "` escapes (identical runtime value, file becomes text); add `*.ts text` / `*.tsx text` to `.gitattributes`; consider a lint rejecting control bytes outside `\t\r\n` in `app/**`.

### CP-44: The /notes/new `?anchor=` prefill silently drops an invalid ref without the drift event — the one insert path with no drift detection
- **Severity:** Low
- **Category:** obs / validation consistency
- **raised_by:** [api-contract, observability]
- **Original IDs:** API-CONTRACT-7, OBSERVABILITY-8

**Claim.** Every POST path logs `note_anchor_invalid_ref` on an unresolvable ref because "an invalid ref from our own insert paths means client/slug-map drift — a bug"; the loader's `?anchor=` prefill — populated by exactly those capture doors (media `episode@t`, scripture verse refs) — nulls it silently (notes.$id.tsx:69-73). A slug-map drift on a capture door degrades every capture from that surface to an unanchored blank editor with zero signal.

**Proposed fix.** Log `note_anchor_invalid_ref {ref_id: anchorParam.slice(0, 160)}` in the loader's null branch — one line, already-allowlisted event; keep the null-out behavior.

### CP-45: `extraGroups` logs notes hits on the reference short-circuit path where the group was dropped from the response
- **Severity:** Low
- **Category:** obs / log truthfulness
- **raised_by:** [observability, api-contract]
- **Original IDs:** OBSERVABILITY-10, API-CONTRACT-9 (item a)

**Claim.** The leg runs unconditionally (it cannot know the reference in advance) and the merge correctly drops the group on short-circuit per A4, but `logSearchExecuted` still emits `extraGroups.notes.hits` from the discarded group — the event claims results the user never received; any funnel joining hits to click-through undercounts systematically on reference-shaped queries (api.search.tsx:199-221; search.tsx:348-368).

**Proposed fix.** On the short-circuit branch log `extraGroups.notes = {hits: 0, degraded, skipped: true}` — or omit extraGroups there, matching the response.

### CP-46: The F8 "soft-deleted note 404s" unit test passes for the wrong reason — the id fails UUID_RE before `getNote` is consulted
- **Severity:** Low
- **Category:** harness quality
- **raised_by:** [correctness, api-contract]
- **Original IDs:** CORRECTNESS-16, API-CONTRACT-10 (F8 half)

**Claim.** The test uses id `"dead-note"`, which 404s at the UUID_RE guard before the mocked `getNote → null` is ever exercised (notes.routes.test.ts:111-119) — the assertion is satisfied by path validation, not tombstone filtering, and would still pass if `getNote` returned a live tombstoned row. (The RLS smoke covers the real behavior live; the unit pin is inert.)

**Proposed fix.** Use a syntactically valid UUID and assert `getNote` was actually called with it.

### CP-47: Deferred-scope 400s now read the session first — 500-instead-of-400 under pool failure, search.tsx's early read sits outside its own 500 contract, and a header delta rides the frozen bytes
- **Severity:** Low
- **Category:** api-contract / byte-freeze edges
- **raised_by:** [api-contract, blast-radius]
- **Original IDs:** API-CONTRACT-8, BR-3

**Claim.** Pre-feature, `scope=notes` was rejected before any session work; deferral necessarily moves the judgment past `getSessionUser`, so under session-pool failure a formerly deterministic 400 becomes a 500 (api.search, correctly through its try) — F2's byte-compat holds only on the healthy path, worth recording. Sharper edge: search.tsx:279 calls `getSessionUser` in the invalid-q + deferred branch OUTSIDE the try that owns the loader's 500 contract — a throw there is a framework 500 with no `search_failed` log and no headers, violating the loader's own "mirror api.search.tsx" doctrine. BR-3 verified the body bytes frozen in all cases and the only observable deltas are headers (a stale-cookie signed-out 400 may now carry rotation Set-Cookie — B4-consistent) and one session read of latency.

**Proposed fix.** Wrap search.tsx's early-session block in try/catch emitting `logSearchFailed` + 500-with-headers; add a plan line recording the healthy-path-only scope of the byte freeze and the header delta next to the byte captures so a future header-level diff doesn't read as drift.

### CP-48: `getChapterNoteAnchors` builds a PostgREST `.or()` filter by string concatenation
- **Severity:** Low
- **Category:** security / defense-in-depth
- **raised_by:** [security]
- **Original IDs:** SEC-8

**Claim.** `.or()` takes a raw filter expression with no escaping; a `bookId` containing `,`/`)` would restructure the predicate (notes.server.ts:166-176). Safe today only because the sole caller passes `parseReference` output and a `^\d+$`-matched chapter — guarantees not expressed at this function's boundary, and notes.server.ts is documented as "the single mockable seam" intended for future callers. RLS caps blast radius at the caller's own rows.

**Proposed fix.** Validate at the seam (`/^[a-z0-9-]+$/` + integer check, or reuse `resolveAnchorRef(chapterRef)` which already encodes the grammar); fixture with a comma-bearing bookId asserting rejection.

### CP-49: RPC invariant coverage gaps and a 14-vs-15 invariant-count discrepancy in the applied-migration record
- **Severity:** Low
- **Category:** harness integrity
- **raised_by:** [security]
- **Original IDs:** SEC-10

**Claim.** (1) `create_rpc_present_and_invoker` pins only `NOT prosecdef` — not the anon/PUBLIC EXECUTE revoke, unlike its soft-delete sibling. (2) Neither invariant nor smoke pins `SET search_path = ''` on either function — the single most important hardening property of a DEFINER function owned by a BYPASSRLS role; a `CREATE OR REPLACE` dropping the clause passes all invariants. (3) plan.md:448 records "14/14 invariants" but the INVARIANTS array has 15 entries — either one has never run against prod or the count is stale; resolve before the deploy checklist executes.

**Proposed fix.** Extend the create-RPC invariant with `has_function_privilege` checks; add a `proconfig @> ARRAY['search_path=']` invariant over both functions; re-run `COMMIT=1` (idempotent) and record the real count.

### CP-50: append/append_undo stale 409s omit the `current` row A13 pins
- **Severity:** Low
- **Category:** api-contract / asymmetry
- **raised_by:** [api-contract]
- **Original IDs:** API-CONTRACT-6

**Claim.** A13: staleness → "409 + current row". `update` complies; all four append/append_undo stale exits return `{error, code: "stale"}` with no `current` — the same code now has two shapes, and a future consumer of the capture intents cannot recover the way the ratified contract promises (notes.$id.tsx:266, 308, 316, 324).

**Proposed fix.** Attach `current` (a getNote is already in hand on most paths) or record the narrower capture-intent shape in the plan's A13 note.

### CP-51: `append` silently canonicalizes the whole stored body — the "byte-identical restore" isn't, and the roundtrip canary loses its signal
- **Severity:** Low
- **Category:** correctness / append semantics
- **raised_by:** [correctness]
- **Original IDs:** CORRECTNESS-13

**Claim.** `append` canonicalizes the entire concatenated body; on a non-canonical stored body (migrated rows, older writers — the A19 canary's reason to exist) a capture silently rewrites it (measured: `* star bullet` → `- star bullet`), and `append_undo` restores the normalized prefix, not the original — contrary to the "byte-identical restore" comment, and the canary can no longer detect the drift because a non-editor writer normalized it.

**Proposed fix.** Either log `note_body_canonicalized_on_append` when `C(body) !== body` (cheap, preserves the canary's signal) or append without re-canonicalizing the prefix; correct the comment either way.

### CP-52: Insert-path labels are not sanitized — the label the user sees is not the label that is stored
- **Severity:** Low
- **Category:** correctness / markdown boundary
- **raised_by:** [correctness]
- **Original IDs:** CORRECTNESS-14

**Claim.** markdown.ts asserts "Insert paths sanitize with this too" — they don't: `handlePaste` and `commitSuggestion` use the raw selection text as label; sanitization happens only at serialize time. Select `a|b`, insert via ⌘K → editor shows `a|b`, storage gets `[[ref|ab]]`, reload shows `ab` — silent unexplained mutation of the user's own text (NoteEditor.tsx:486-491, 645-651).

**Proposed fix.** Call `sanitizeWikilinkLabel` at both insert sites before `wikilink.create`, dropping to null when empty, so doc and stored form agree.

### CP-53: `highlight` is not reset when the suggestion list changes but its length does not — Enter can insert a destination the user never highlighted
- **Severity:** Low
- **Category:** correctness / popup commit
- **raised_by:** [correctness]
- **Original IDs:** CORRECTNESS-15

**Claim.** `useEffect(() => setHighlight(0), [suggestions.length])` — editing `alma-3` to `mosiah-3` can yield equal-length lists with different destinations while `highlight` stays at a stale index; the PM keymap commits the new list at the old index (NoteEditor.tsx:625).

**Proposed fix.** Key the reset on list identity (`suggestions.map(s => s.ref).join(" ")`), not length.

### CP-54: The smoke never exercises the app's create statement shape — `create_note_with_anchors` is probed via raw inserts the app never uses
- **Severity:** Low
- **Category:** data-integrity / test gap
- **raised_by:** [data-integrity]
- **Original IDs:** DATA-7

**Claim.** Harness-revision 1's rationale was app-real statement shapes — honored for soft-delete, not creation: the smoke uses raw `.insert()` + separate anchor insert (smoke-notes-rls.mjs:74-87), leaving untested live the RPC's one-transaction guarantee (invalid kind must roll back the note row), owner-default inside the function, `ON CONFLICT DO NOTHING`, and double soft-delete returning 0 (the app maps 0 → 404).

**Proposed fix.** Create A's note via the RPC; add one atomicity probe (`kind: 'bogus'` → error AND note count unchanged) and one second-soft-delete → 0 check.

### CP-55: Anchors can be inserted onto the owner's own tombstoned note — unreachable garbage no code path can remove before purge
- **Severity:** Low
- **Category:** data-integrity / constraint gap
- **raised_by:** [data-integrity]
- **Original IDs:** DATA-8

**Claim.** `note_anchors_insert` WITH CHECK requires only `owner_id = auth.uid()`, and the composite FK bypasses RLS, so a soft-deleted note still satisfies it — a racing capture (or the CP-16 direct-upsert fix) writes anchors onto a tombstone: invisible (EXISTS clause), cascaded at purge, hygiene not leakage (migrate-notes.mjs:129-131).

**Proposed fix.** Extend the WITH CHECK with `AND EXISTS (SELECT 1 FROM lumen.notes n WHERE n.id = note_id AND n.deleted_at IS NULL)` — the exact mirror of the SELECT policy's clause; one policy edit.

### CP-56: `append_undo` trusts the client's `anchor_was_new` flag over server ground truth
- **Severity:** Low
- **Category:** data-integrity / trust boundary
- **raised_by:** [data-integrity]
- **Original IDs:** DATA-9

**Claim.** Whether the undo removes the anchor row is decided by a client-supplied echo (notes.$id.tsx:326-336). A stale/forged flag desynchronizes body and anchors in either direction on the user's own note (deleting a live-reference anchor, or leaving a phantom one). Self-inflicted only, but the server had ground truth at append time and re-derivation is cheap.

**Proposed fix.** Ignore the flag; after the body restore, delete the (kind, ref_id) row iff the restored body no longer contains a wikilink resolving to that ref — resolveAnchorRef and the restored `prev` are already in hand.

### CP-57: The dormant `notes_delete` policy arms future hard-delete, including tombstones inside the purge window
- **Severity:** Low
- **Category:** data-integrity / defense-in-depth
- **raised_by:** [data-integrity]
- **Original IDs:** DATA-10

**Claim.** authenticated holds no DELETE grant (correct), yet `notes_delete FOR DELETE USING (owner_id = auth.uid())` exists and is invariant-pinned — a single future copy-pasted `GRANT DELETE` instantly enables user hard-deletion, and the USING has no `deleted_at IS NULL`, so it reaches tombstones inside the 30-day window with no other tripwire (migrate-notes.mjs:116-118).

**Proposed fix.** Drop the policy (absent-policy-as-design, matching the anchors idiom; the grant absence is already pinned) or add `AND deleted_at IS NULL`.

### CP-58: Smoke user cleanup can strand throwaway auth users with real write ability
- **Severity:** Low
- **Category:** test hygiene
- **raised_by:** [data-integrity]
- **Original IDs:** DATA-11

**Claim.** `makeUser("a")` runs outside any try — if `makeUser("b")` throws, A is never deleted; in the finally, `a.cleanup()` rejecting skips `b.cleanup()` (smoke-notes-rls.mjs:69-70, 200-203). Leaked confirmed `@example.invalid` users accumulate in auth.users with notes-table write ability. (Security's clean-lane note flags the same missing try/finally in e2e `createE2eUser`.)

**Proposed fix.** Create both users inside the try with handles registered as acquired; run cleanups via `Promise.allSettled`.

### CP-59: `note_write_failed` fires for pure reads — a read outage inflates the write-failure signal
- **Severity:** Low
- **Category:** obs / event naming
- **raised_by:** [observability]
- **Original IDs:** OBSERVABILITY-7

**Claim.** `listNotes`, `getNote`, `getNoteAnchors`, `getChapterNoteAnchors` all route errors through `failWrite`, so a failed SELECT logs the A13 write event — a pool-exhaustion read outage (a documented incident class) reads as write failures (notes.server.ts:120, 135, 149, 179).

**Proposed fix.** Split `note_read_failed` (same classifier) or key the event name per op class; overlaps CP-25's fix for chapter_anchors.

### CP-60: The round-trip canary re-fires on every failed/409 save, and the server hashes the wrong body
- **Severity:** Low
- **Category:** obs / event quality
- **raised_by:** [observability]
- **Original IDs:** OBSERVABILITY-9

**Claim.** The canary clears only on success, so each retry re-sends `roundtrip_ok=false` — A19's "reports once" holds only on the happy path. And the server hashes `canonical` (the current buffer) while `len_stored`/`len_reserialized`/`first_diff_offset` describe the LOADED body — the hash cannot be correlated with the mismatch the other fields report (NoteEditor.tsx:367-373, 572-577; notes.$id.tsx:192-207).

**Proposed fix.** Client sends a precomputed hash of `initialBody` (or drop the hash and trust lengths+offset); clear the canary after the FIRST submit that carried it, regardless of outcome.

### CP-61: Identical auto-link announcements do not re-announce
- **Severity:** Low
- **Category:** a11y / live region
- **raised_by:** [accessibility]
- **Original IDs:** A11Y-7

**Claim.** `announce` is React state never cleared; setting the same string twice (paste the same URL twice, retype the same ref) produces no DOM mutation and no announcement (NoteEditor.tsx:300, 507, 677-679).

**Proposed fix.** Clear the region on a short timeout after each announcement, or alternate a zero-width space.

### CP-62: The combobox lacks `aria-autocomplete="list"` and the shared listbox has no accessible name
- **Severity:** Low
- **Category:** a11y / aria
- **raised_by:** [accessibility]
- **Original IDs:** A11Y-8

**Claim.** Both postures filter a suggestion list but neither the ⌘K input nor the textbox declares `aria-autocomplete="list"`, and `#note-insert-listbox` is unnamed — operable but short of the APG contract A10 pins (NoteEditor.tsx:713-722).

**Proposed fix.** Add `aria-autocomplete="list"` to both (textbox once CP-11 lands) and `aria-label="Link destinations"` to the listbox.

### CP-63: Escape-registry doc drift — a phantom client and a stale contract comment
- **Severity:** Low
- **Category:** doc drift
- **raised_by:** [accessibility]
- **Original IDs:** A11Y-10

**Claim.** The header enumerates "rail note-compose" as a client, but no compose layer exists (A9 shipped direct verbs; exactly one `pushEscape` client exists), and the only document-level Escape listener rides the editor chunk — a future non-editor client would push entries nobody pops. `onEscape`'s docstring says "return true if consumed" but the signature returns void. LIFO semantics themselves are sound (escape-registry.ts:9-18).

**Proposed fix.** Trim the client list to reality, fix the comment, and either move the keydown listener to a root-level mount or document that it currently rides the editor chunk.

### CP-64: The ⌘K insert popup has no outside-click dismissal — `aria-expanded` sticks and a later Esc causes a surprise selection jump
- **Severity:** Low
- **Category:** a11y / interaction
- **raised_by:** [accessibility]
- **Original IDs:** A11Y-11

**Claim.** The popup closes only via Esc or commit; clicking back into the document blurs the input but leaves the popup mounted with `aria-expanded="true"` and a stale stored selection — a pointer user who then presses Esc jumps back to the pre-⌘K range (NoteEditor.tsx:691-754).

**Proposed fix.** A pointerdown-outside listener running the same close path as the registry entry, keeping the CF-13 restore semantics for keyboard closes only.

### CP-65: The save-state span is a second polite live region that announces every autosave cycle
- **Severity:** Low
- **Category:** a11y / live region
- **raised_by:** [accessibility]
- **Original IDs:** A11Y-12

**Claim.** A12's "one polite status region" holds for reference announcements, but the save-state span re-announces "Saving…"/"Saved" every autosave cycle — a steady SR drumbeat during normal writing that can queue-collide with "Inserted link…" (NoteEditor.tsx:774-784). Loud FAILURE is mandated; routine success is not.

**Proposed fix.** Carry `aria-live` only for the failed/stale strings (wrapper or conditional `aria-live="off"` while Saving/Saved/Unsaved).

### CP-66: The formatting legend is hidden forever exactly when it can't be earned-quiet, and hardcodes ⌘ for all platforms
- **Severity:** Low
- **Category:** ux / copy
- **raised_by:** [ux]
- **Original IDs:** UX-13

**Claim.** When localStorage throws (private browsing), the init fallback of 3 suppresses the A17 legend permanently for users whose count can never accrue — while `bumpFmt`'s catch comment documents the opposite intent ("legend just stays"). The legend and popup foot line hardcode ⌘ (⌘B/⌘I/⌘↵) for Windows/Linux users (NoteEditor.tsx:308-314, 330-340, 750, 795-800).

**Proposed fix.** Init fallback 0 (show when unknowable); derive the modifier glyph from platform for both surfaces.

### CP-67: A brand-new empty note reports "Saved"
- **Severity:** Low
- **Category:** ux / copy
- **raised_by:** [ux]
- **Original IDs:** UX-15

**Claim.** On /notes/new before any keystroke, `dirty` is false and the status line renders "Saved" — nothing exists server-side (NoteEditor.tsx:774-784). G5 requires the state visible while dirty; while clean on the create surface, "Saved" is simply false.

**Proposed fix.** On `noteId === null && !dirty`, render nothing (house rule: registers print nothing when empty).

### CP-68: Paste conversion announces "Backspace to undo" but Backspace doesn't undo it
- **Severity:** Low
- **Category:** ux / copy
- **raised_by:** [ux]
- **Original IDs:** UX-16

**Claim.** The auto-link Backspace handler restores typed text via plugin state the paste path never sets — after a paste conversion, Backspace is a plain atom-delete: the link vanishes and the URL text is NOT restored (NoteEditor.tsx:127-152, 480-495).

**Proposed fix.** Register the paste in the same plugin state with the raw URL as restore text (one-line reuse), or reword to "Pasted as link" and rely on ⌘Z.

### CP-69: The media `+ note` door is undiscoverable on touch
- **Severity:** Low
- **Category:** ux / mobile
- **raised_by:** [ux]
- **Original IDs:** UX-17

**Claim.** The door is `opacity-0 … group-hover:opacity-100 focus-visible:opacity-100` (media.tsx:528-536) — coarse pointers have no hover, so the new transcript-capture affordance is invisible on phones. Q6 mobile is in scope and mobile is the recorded competitor gap. (The adjacent timestamp button is pre-existing; `+ note` is new surface adopting the pattern.)

**Proposed fix.** Reveal on coarse pointers (`pointer-coarse:opacity-100`, or show when the paragraph is active), keeping hover-reveal on fine pointers.

### CP-70: `/search?scope=notes` renders a ghost state — all canon pills lit, "0 results", only the notes leg ran
- **Severity:** Low
- **Category:** ux / dead state
- **raised_by:** [ux]
- **Original IDs:** UX-18

**Claim.** The loader correctly runs notes-only, but the client receives `scope: null` and renders every canon pill included, an all-groups scope line, and "0 results" — claiming a full-library search that never happened (search.tsx:243-262, 729, 1042, 1069). URL-only reachable today, but the API contract is public per A4 and the state actively lies.

**Proposed fix.** Echo notes-only in loaderData (`scope: []` + flag) and print the existing scope-line treatment ("searching your notes only — restore all"), or normalize the URL to drop the scope.

### CP-71: The anchors leg's 750 ms abort does not bound the leg — the session read before it is deliberately unbounded
- **Severity:** Low
- **Category:** perf / latency tail
- **raised_by:** [performance]
- **Original IDs:** PERFORMANCE-8

**Claim.** `loadChapterNoteAnchors` sits in the chapter's critical-path Promise.all; only the PostgREST fetch is bounded — `getSessionUser` is timeout-free by design and its expired-token path does network I/O to gotrue, so a slow refresh blocks the whole chapter SSR with no bound. The loader comment records the "no longer session-free" regression but not the unbounded tail (scripture.tsx:339-347; auth.server.ts:107). Happy path is local ES256 verify with isolate-global JWKS cache — the tail is rare.

**Proposed fix.** Accept-and-record (one comment line), or `Promise.race` the whole leg against ~1.5 s resolving degraded `{canCapture: true, anchors: null}` while the un-raced session promise continues for its Set-Cookie side effects. (Interacts with CP-8's fix — resolve together.)

### CP-72: Worker-side markdown/prosemirror weight — quantified, within limits (informational)
- **Severity:** Low (informational; A2/CF-56 acceptance not challenged)
- **Category:** perf / bundle weight
- **raised_by:** [performance]
- **Original IDs:** PERFORMANCE-9

**Claim.** Measured 2026-07-30: main server chunk 2.28 MB raw / 472 KB gz including markdown-it + prosemirror-model + prosemirror-markdown; lazy client editor chunk 342 KB raw / 120 KB gz, correctly reached only via `lazy(() => import(...))`. Parser/serializer/renderer are module-scope singletons.

**Proposed fix.** None required. One line in state/learnings.md so the next server-side markdown consumer reuses this module instead of adding a second parser.

### CP-73: searchAll's canon-filter early return is a dead path from all real callers — keep it that way
- **Severity:** Low (checked-clean with one note)
- **Category:** engine contract
- **raised_by:** [blast-radius]
- **Original IDs:** BR-4

**Claim.** Both consumers canon-validate scope before calling and skip searchAll on notes-only; for every pre-feature-reachable input the new filter is an identity map, and `scope = []` still widens to all groups exactly as before. The empty-after-filter early return (`mode: 'none'`, `reference: null`) is reachable only by a caller casting non-canon keys — none exists; note it forfeits reference resolution, so it must stay unreachable. The `mintNextCursor` type narrowing is zero runtime delta.

**Proposed fix.** Optional one-line comment on the early return that it is a structural backstop, not a supported path.

---

## Verified clean

Load-bearing for the bug filter — each lane's explicit clean statements, attributed.

**security:**
- F6 / XSS in `notes-render.server.ts` + `notes-derive.ts` — clean; verified against markdown-it 14.3.0 source: zero preset enables inline `text` only, `html:false`, the `text` renderer override covers `text_special` via `text_join`, wikilink hrefs can only be `anchorRefToPath` output over `SLUG_SHAPE`/`TRANSCRIPT_SHAPE` segments (no `javascript:` constructible), entity wikilinks are inert spans, `renderNoteHtml` is the only `dangerouslySetInnerHTML` source, every other note-derived string is a React text child, and the editor's `wikilink.toDOM` uses the DOM API.
- Signed-out byte-freeze (F2) — clean: `extractNotesScope` + `parseScope` traced against pre-feature behavior for `scope=notes`, `notes,notes`, trailing comma, case-mismatch, mixed, bad-limit, and cursor combinations; every signed-out path reproduces the frozen `scope_unknown` bytes in the pre-feature validation order; GROUP_KEYS genuinely frozen; cookieless requests byte-identical.
- RLS assumptions in app code — clean: no admin/service-role client anywhere in the notes data path; `owner_id` never read from a form; absent/deleted/foreign are one indistinguishable 404.
- SECURITY DEFINER `soft_delete_note` — clean as written: `SET search_path = ''`, fully schema-qualified, WHERE mirrors `notes_update` verbatim, NULL `auth.uid()` matches zero rows, no RETURNING, EXECUTE granted to authenticated only and invariant-pinned.
- Cookie/session header propagation — clean: every exit in both notes routes threads session headers, including the catch-all; the `loadChapterNoteAnchors` deviation is documented (but see CP-8 for the header-commit gap); `clientMemo` WeakMap matches the `sessionMemo` idiom.
- e2e secret hygiene — clean: service-role key from gitignored .env, hard-fails if absent, never written anywhere; hardcoded values are already-public; throwaway users randomized and deleted. (Operational note: `createE2eUser` lacks try/finally — see CP-58.)

**correctness:**
- C idempotency: `C(C(x)) === C(x)` held for ~55 adversarial inputs (tables, fences, indented code, hard breaks, `\r`, bidi controls, empty wikilinks, deep headings, escaped emphasis, stray `[[`/`]]`/`|`). The escape-rule/serializer pairing is sound.
- Auto-link span arithmetic: one-character-per-atom `textBetween` substitution keeps offsets honest; the `plain` guard refuses to fire across atoms; Backspace-undo cannot range past the doc.
- `updateNote` conditional-update shape: `.eq("updated_at", base).is("deleted_at", null)` + getNote fallback correctly distinguishes 409 from 404; timestamp round-trip is exact; the trigger guarantees the base advances.
- `syncNoteAnchors` diff key: `${kind} ${ref}` cannot collide; delete-missing + `ignoreDuplicates` upsert is correct against the immutable-anchor model (the defect is the failure mode, CP-3/CP-16, not the diff).
- `append_undo` byte-restore: verified against 11 body/line shapes; exact prefix restored in every case except the newline-label case (CP-19).
- Detector false positives: 52 probe strings; the chapter-form allowlist + capitalization gate + per-book chapter bounds all behaved as specified — only the leading-punctuation span leak (CP-33) surfaced. Out-of-range verse numbers still link, matching the documented notes-refs posture.
- Base-echo adoption after the create-redirect is correct: same route module, `baseRef` adopted exactly once.

**api-contract:**
- Deferred-scope validation ORDER vs pre-feature bytes: q → scope → limit → cursor order preserved exactly; held-back 400s re-fire signed-in in pre-feature order; signed-out replays byte-identical including `{error, code}` key order; search.tsx keeps scope-outranks-q.
- searchAll canon filter (A1): structurally filters non-canon keys and returns the empty shape rather than widening `[]` — the CF-7 trap is closed; GROUP_KEYS frozen; SEARCH_RESPONSE_KEYS/`GROUP_RESULT_TYPES.notes` per A1.
- mergeNotesGroup vs A4: notes leads then canon in order; null leg returns canon BY REFERENCE; empty healthy group dropped (documented); degraded group kept with `degraded: true`; no duplicate notes key possible.
- searchNotesLeg vs A4: never throws; 400 ms `AbortSignal.timeout`; one `search_group_degraded` on failure; `updated_at desc`; textSearch shape pinned; **no nextCursor ever minted**; cursor×notes → 400 `cursor_scope`; notes-only skips searchAll on both surfaces; result rows carry no owner_id/body_md, plain-text snippet.
- A18 emission + headers: both loaders redirect with same-origin-by-construction encoding and self-carry session headers; the action `json()` helper stamps headers on all outcomes.

**data-integrity:**
- `soft_delete_note` predicate completeness: owner + live + id, schema-qualified under empty search_path; NULL uid matches nothing; count return leaks nothing.
- `create_note_with_anchors`: genuinely one transaction; bad kind/NULL aborts everything; INVOKER + column default make owner forgery impossible.
- Idempotent re-run: every DDL statement IF-NOT-EXISTS/OR-REPLACE; one-tx apply with dry-run rollback sound (noted: dry-run exits 0 even on invariant failure by documented design — only COMMIT=1 is a drift check).
- Composite-FK forgery wall, FORCE RLS both tables, initplan idiom, partial-index/RLS-qual eligibility, generated tsvector config pin, and append_undo restore arithmetic all check out.

**ux:**
- The ratified A9/A15 anatomy is implemented: capture verbs print at zero notes while rows don't; the ring takes the first slot in both clusters; the mobile stack clamps at 4; SR parity `, your note` prints; the empty /notes state is one italic line + a plain door; PanelBody is keyed by verse.id so gloss state cannot leak across verses; registers print nothing when empty throughout.

**accessibility:**
- The contenteditable carries `role="textbox" aria-multiline aria-label`; the sr-only suffix sits INSIDE the verse link with dots aria-hidden; the register label is a real h3; AlertDialog is motion-safe-gated with Radix owning Esc-cancel + focus-return, e2e-verified; the `+ note` door is keyboard-reachable via focus-visible; capture verbs are real buttons/links; escape-registry LIFO semantics are sound (push/pop, idempotent dispose, empty-registry Esc inert — never eats a chapter); reduced-motion gating verified.

**performance:**
- Search legs are genuinely parallel on both surfaces — the notes fetch is dispatched before searchAll is awaited; the 400 ms budget overlaps canon work.
- Zero signed-out cost in the chapter loader: sync env read + one cookie-header regex before any session or PostgREST work; the signed-in leg is fetch-based and does not deepen PG-pool queueing.
- Per-request PostgREST client memo (WeakMap on Request) correct on Workers; JWKS cached isolate-globally.
- Indexes back both hot queries (partial owner/recency index, partial GIN FTS, anchors owner/kind/ref index).
- The `[[` popup path is local parse over static tables — no network per keystroke; `findCanonReferences` runs only on boundary chars over the current block.

**observability:**
- The editor error boundary with no beacon matches the recorded CF-51 ruling exactly (buffer-preserving fallback, no telemetry — deliberately unobserved, recorded).
- searchNotesLeg degradation emits exactly ONE `search_group_degraded`; notes never enters `meta.perGroup`, so no double-emit path exists there; field shape matches the canon emission.
- Privacy sweep of `note_created`/`note_softdeleted`/`note_render_failed`/`note_anchors_degraded`/`note_roundtrip_violation`: no bodies, titles, snippets, or owner_id anywhere; ref_ids only in the allowlisted event — the one exception is the `message` field (CP-14).
- `note_render_failed` emits once and returns escaped plaintext; `renderNoteHtml` is genuinely never-throw at its boundary.
- Autosave failure loudness (A13): server-side failures log + client shows persistent failed state + Retry; transport-level gaps are inside the recorded beacon rejection.

**blast-radius:**
- BR-5 type-widening consumer audit: every `Record<GroupKey, …>` indexer enumerated — `GROUP_LABELS`/`GROUP_ICONS` only ever indexed from canon-derived `included`; the notes group renders through its own dedicated section; `TYPE_ICONS` widened WITH the `note` entry; no consumer breaks.
- BR-6 kill switch: NOTES_ENABLED=0 provably equals pre-feature at all four gates (routes 404 before auth/DB work; anchors skipped before `hasAuthCookie`; both search surfaces replay frozen 400s and skip the leg; media door never renders); `wrangler rollback` drops the var harmlessly.
- BR-8 signed-out byte-freeze interleaving hunt: all scope×limit×cursor combinations reproduce pre-feature outcomes; valid-request responses constructed from the same array reference; A16 checklist coherent with recorded reality (worker deploy + byte-diff replay remain). Footnotes: grants + exposure are already live under the pre-feature prod worker (invisible to every shipped surface — pre-deploy behavior unchanged); the mandatory divergence check must run against origin/main, not a stale local main.

---

## Counts

**Findings per role (raw):**

| Role | Findings |
|---|---|
| security | 10 (SEC-1..10) |
| correctness | 16 (CORRECTNESS-1..16) |
| api-contract | 10 (API-CONTRACT-1..10) |
| data-integrity | 11 (DATA-1..11) |
| ux | 18 (UX-1..18) |
| accessibility | 12 (A11Y-1..12) |
| performance | 9 (PERFORMANCE-1..9) |
| observability | 10 (OBSERVABILITY-1..10) |
| blast-radius | 5 (BR-1..4, BR-7; BR-5/6/8 filed as checked-clean lanes) |
| **Total raw** | **101** |

**Canonical total: 73** (20 canonical findings merged 2+ original findings; 53 stand alone).

**Convergence stats:**
- 19 canonical findings were raised by 2+ distinct roles (20 merged 2+ findings; CP-23 merged two findings from one role, PERFORMANCE-2 + PERFORMANCE-5).
- 5 canonical findings were raised by 3+ distinct roles: CP-3 (4 roles: correctness, api-contract, data-integrity, observability), CP-1 (3: correctness, ux, performance), CP-15 (3: observability, blast-radius, api-contract), CP-16 (3: security, data-integrity, performance), CP-43 (3: security, ux, + accessibility out-of-lane).
- Highest convergence: **CP-3 body-then-anchors non-atomic writes** (4 roles) and **CP-1 the autosave state machine** (3 roles, 6 findings, the only composed-critical cluster).
- **Severity histogram: Critical 2 · High 12 · Medium 28 · Low 31.**
- Severity disagreements preserved inline: CP-1 (critical/high/med/low across its members), CP-3 (high/med×3), CP-4 (high/med), CP-5 (high/med), CP-6 (high/med), CP-7 (high/med), CP-16 (med×2/low×2), CP-18 (med/low), CP-19 (med/low), CP-20 (med/low), CP-21 (med/low), CP-22 (med/low).
- Cross-cluster interactions worth the bug filter's attention: CP-8 and CP-71 share `loadChapterNoteAnchors` (fix together); CP-16's append-upsert fix makes CP-55's tombstone WITH CHECK more relevant; CP-7's append size guard also closes CP-19's oversized-label 500; CP-25 and CP-59 share the `failWrite`-on-reads mechanism.
