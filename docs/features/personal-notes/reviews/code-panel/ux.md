# UX — code-panel findings (personal-notes, step 9)

Lane: /notes index + note page composition, editor shell (save-state /
legend / popup), reader rail register + capture verbs + gloss-undo, note
dot anatomy, media `+ note` door, /search notes section.

Compliance notes before the defects: the A9/A15 anatomy is implemented as
ratified — capture verbs print at zero notes while rows don't
(scripture.tsx:1533-1571), the ring takes the first slot in both clusters
(1080-1104, 1116-1119), the mobile stack clamps at 4 via `.slice(0, 4)`
(1104), SR parity `, your note` prints (1128), the empty /notes state is
one italic line + a plain door (notes.tsx:75-88), PanelBody is keyed by
verse.id so capture gloss state cannot leak across verses (scripture.tsx:899),
and registers print nothing when empty throughout. The findings below are
implementation defects inside that settled shape.

## UX-1: Rendered note content and editor content have no CSS — the whole markdown surface is typographically flat

- **Severity:** critical
- **Category:** missing-styles / doctrine-violation (A14, human-ruled editor rationale)
- **File:** apps/web/app/lib/notes-render.server.ts:84,89 (emits
  `note-wikilink`, `note-wikilink-dead`); apps/web/app/routes/notes.$id.tsx:481
  (`note-body`); apps/web/app/components/editor/NoteEditor.tsx:478
  (`note-editor`); apps/web/app/app.css (absence — the feature's only CSS
  addition is the `--t-dot-note` token)
- **Claim:** No stylesheet anywhere defines `.note-body`, `.note-editor`,
  `.note-wikilink`, or `.note-wikilink-dead` (repo-wide grep: the only hits
  are the emit sites and e2e selectors), and ProseMirror's base stylesheet
  (`prosemirror-view/style/prosemirror.css` — `white-space: pre-wrap` etc.)
  is never imported. Under Tailwind v4 preflight (`@import "tailwindcss"`,
  app.css:1): headings render at body size/weight, `ul/ol` lose bullets,
  numbers, and indent, `blockquote` loses all form, `p` margins are zero
  (a multi-paragraph note is one dense wall), and `a { text-decoration:
  inherit; color: inherit }` makes wikilinks visually identical to plain
  text — A14's "wikilinks get dotted underline" and F5's "styled plain
  text" for dead refs are both unimplemented. In the editor the same holds:
  pressing `#`/`-`/`>` (the constructs the A17 legend advertises) changes
  the document but changes nothing visible, gutting the human-ruled
  "Google Docs-y, syntax never renders" rationale — formatting is applied
  but invisible. Missing `white-space: pre-wrap` also makes consecutive
  typed spaces collapse in the contenteditable.
- **Green-harness gap:** vitest asserts HTML strings and e2e asserts DOM
  structure/classes; nothing asserts computed style. Axe passes because
  flat text is not a contrast violation.
- **Proposed fix:** Add a `.note-body`/`.note-editor` shared typography
  block in app.css (heading scale off the house Fraunces/Newsreader ramp,
  list/blockquote/paragraph rhythm, dotted-underline `.note-wikilink`,
  muted `.note-wikilink-dead`), import the ProseMirror base css inside the
  editor chunk, and add one e2e computed-style probe (e.g. wikilink
  `text-decoration-style: dotted`) so the class-emit/class-define seam
  can't silently reopen.

## UX-2: `[[`/⌘K popup is anchored to the editor's foot, not the caret

- **Severity:** high
- **Category:** layout / dead-state
- **File:** apps/web/app/components/editor/NoteEditor.tsx:691-753 (popup
  rendered in a `relative` wrapper placed after the `mountRef` div)
- **Claim:** The suggestion popup positions at the bottom of the entire
  editor (`absolute z-10 mt-1` in a container below the PM mount). In any
  note taller than the viewport, typing `[[` near the top opens the
  listbox below the last line — off-screen. The user sees nothing happen,
  which reads as "the `[[` door is broken"; the universal insert door
  (A9: "`[[` is the universal insert door (all widths)") is only usable
  in short notes. There is also no viewport-collision handling, so even
  at the editor foot the popup can clip below the fold. Green e2e gap:
  editor.spec types into empty one-line notes where foot ≈ caret.
- **Proposed fix:** Position the popup from
  `view.coordsAtPos(view.state.selection.head)` (fixed positioning or
  offset within the relative wrapper), flipping above the caret when the
  bottom edge would clip; keep the current placement only as the ⌘K
  insert-posture default if a stable anchor is wanted there.

## UX-3: The create surface has no idle autosave — the draft with the most to lose is the only one not autosaved

- **Severity:** high
- **Category:** save-state / gate-ruling gap (G5)
- **File:** apps/web/app/components/editor/NoteEditor.tsx:543-547
  (`if (!dirty || noteId === null) return;`)
- **Claim:** G5 (Abram, gate ruling): "autosave REQUIRED: ≥3s idle
  debounce, flush on blur/navigation/visibilitychange". The idle debounce
  is explicitly disabled when `noteId === null`, i.e. on /notes/new. A
  first draft composed for an hour in a focused tab persists nothing —
  only window blur, `visibilitychange`, ⌘S, or the manual Save button
  create the row; a crash, power loss, or browser OOM-kill loses the
  entire note. The machinery to do better already exists: the
  create-redirect keeps the same route component editing and adopts the
  fresh LWW base (NoteEditor.tsx:326-328, notes.$id.tsx comment "the SAME
  route component carries on editing"), so an idle-fired create is safe.
- **Green-harness gap:** editor.spec.ts:71-76 clicks the manual Save
  button on the create surface before exercising autosave — the idle
  path on a new note is untested.
- **Proposed fix:** Let the ≥3s idle debounce fire the create too (guard:
  only once the doc is non-empty), relying on the existing
  create-redirect continuation; keep the manual Save button as the
  explicit door.

## UX-4: Search notes rows are outside the roving tab-stop — with notes-only matches no result row is keyboard-reachable

- **Severity:** high
- **Category:** keyboard-access (overlaps a11y lane)
- **File:** apps/web/app/routes/search.tsx:1049-1064 (renderedKeys /
  firstRowKey built from `included` canon groups only), 1404-1410 (notes
  rows get `tabStop={rowKey(r) === activeRowKey}`), 690 (tabIndex −1
  otherwise)
- **Claim:** `renderedKeys`/`firstRowKey` iterate only the canon
  `included` groups, so a notes-row key can never equal `activeRowKey`:
  (a) the notes section renders FIRST (personal layer leads, A15) yet Tab
  lands past it on the first canon row; (b) focusing a notes row sets
  `rovingKey` to a key not in `renderedKeys`, so the roving memory
  resets; (c) when only notes match (canon groups all empty — common for
  personal vocabulary), `firstRowKey` is null, `activeRowKey` is null,
  and every row on the page has tabIndex −1 — the results list is
  unreachable by Tab entirely (↑↓ work only if focus is already inside
  via `[data-result-row]` DOM query, search.tsx:960). Relatedly,
  `totalShown` (1042) and `statusText` (1069) exclude notes hits, so the
  SR status announces "0 results for X" while three note rows are on
  screen.
- **Proposed fix:** Include the rendered notes group when building
  renderedKeys/firstRowKey (prepend, to match visual order), and add the
  notes count to totalShown/statusText (or announce it separately:
  "3 of your notes · 12 results").

## UX-5: Degraded notes leg is invisible exactly when canon is empty — the misread CF-4 forbids

- **Severity:** medium
- **Category:** dead-state / doctrine (A4/CF-4)
- **File:** apps/web/app/routes/search.tsx:1355-1361 (zero view),
  1367-1373 (notes section gated on `view === "results"`), 862-866 (view
  computed from `results.length` only)
- **Claim:** A4: "degraded → group present … absence would read as 'no
  matching notes'". The degraded branch renders only under
  `view === "results"`. When the canon groups are all empty AND the notes
  leg degrades (returns `results: [], degraded: true`), `view` computes
  to `"zero"` (no group has results) and the page prints "Nothing in the
  library matches …" with no notes-unavailable line — the user's notes
  may well match, the leg just failed. This is the exact misread the
  settled decision exists to prevent, surfacing in the one view where
  the user has nothing else to look at.
- **Proposed fix:** Render the degraded one-liner in the zero view too
  (same copy), or fold `degraded` into the view computation so a
  degraded-notes zero state gets its own sentence.

## UX-6: Delete dialog makes the 30-day purge promise the plan explicitly withheld

- **Severity:** medium
- **Category:** copy-tone / doctrine-violation (A6/CF-36)
- **File:** apps/web/app/routes/notes.$id.tsx:443-446
- **Claim:** A6: "`deleted_at` with 30-day-purge `COMMENT ON COLUMN`
  (**no user-facing promise**, no v1 job)"; CF-36 was incorporated
  "COMMENT only per panel-2 — no user-facing purge promise". The dialog
  says "Deleted notes may be purged after 30 days." — a user-facing purge
  promise, and one that implies pre-purge recoverability that does not
  exist (the DEFINER soft-delete ratification records that restore needs
  a future privileged path). No job exists, so the statement is also
  currently false in both directions.
- **Proposed fix:** Cut the second sentence. "It disappears from your
  notes, the reader, and search." is complete, true, and house-quiet.

## UX-7: Stale (409) save state offers a Retry that can never succeed and copy that destroys the buffer

- **Severity:** medium
- **Category:** save-state / missing-affordance
- **File:** apps/web/app/components/editor/NoteEditor.tsx:669-672
  (`failed` is true for code "stale" too), 774-792 (status line + Retry)
- **Claim:** On a 409 the status prints "Changed elsewhere — reload to
  merge" AND the Retry button prints (`failed` doesn't exclude
  `code === "stale"`). Retry resubmits the identical stale
  `base_updated_at` → guaranteed 409 loop. The copy's only instruction —
  reload — discards the local buffer (edits are unsaved by definition
  here), and no merge happens on reload; the 409 response's `current`
  row (notes.$id.tsx:223-233) is received and ignored. A13 settles LWW +
  409; the unresolvable-dead-end treatment is implementation.
- **Proposed fix:** Suppress Retry when `code === "stale"`; change copy
  to drop "merge"; add one buffer-preserving affordance — e.g.
  "Keep mine" (adopt `current.updated_at` as base, resubmit local body)
  next to "Take theirs" (replace doc with `current.body_md`). Either one
  alone would already beat reload.

## UX-8: Capture-created notes are titled and rendered as raw slugs ("alma-32-21")

- **Severity:** medium
- **Category:** copy-tone
- **File:** apps/web/app/components/editor/NoteEditor.tsx:382-384
  (prefill `[[${prefillAnchor}]]`, no label);
  apps/web/app/components/editor/markdown.ts:104 (editor shows
  `label ?? ref`); apps/web/app/lib/notes-render.server.ts:81-89 (visible
  text = label/ref; the human `displayRef` form goes only into
  aria-label); apps/web/app/lib/notes-derive.ts:26-27 (title strips
  `[[ref]]` to the ref)
- **Claim:** The reader-rail "New note" door and the media `+ note` door
  prefill a label-less wikilink, so the note's first line — and therefore
  its derived title on /notes, in the rail register, and in search rows —
  is the raw slug ("alma-32-21", "e217@1042.5"). Sighted users see slugs
  while screen readers hear "Alma 32:21" via aria-label — the polish is
  inverted. notes-derive.ts's own doc comment ("link-only bodies fall
  back to 'Untitled note'") is also false: the stripped ref is non-empty,
  so the slug wins. The rail's append path already does this right
  (label=verseRef, scripture.tsx:1481).
- **Proposed fix:** Prefill with a display label — the notes.$id loader
  already resolves the anchor (notes.$id.tsx:72), so pass a
  `displayRef`-derived label into the editor (`[[alma-32-21|Alma 32:21]]`);
  and make the renderer/editor fall back to the display form (not the
  slug) as visible text for label-less scripture/chapter refs.

## UX-9: "Add to note" dead-ends forever once the last-touched note is deleted

- **Severity:** medium
- **Category:** dead-state
- **File:** apps/web/app/routes/scripture.tsx:1467-1471 (failure line),
  1475-1487 (verb submits to the stored id); apps/web/app/routes/notes.$id.tsx:252-253
  (append → 404 when the note is soft-deleted); localStorage
  `lumen:last-note` written only on note-page visits (notes.$id.tsx:380-387)
- **Claim:** `lumen:last-note` is never invalidated. Delete that note (or
  soft-delete it in another tab) and every subsequent capture attempt
  posts to a 404: the rail prints "That didn't save — try again." — and
  trying again 404s identically, forever, until the user happens to open
  another note. The copy diagnoses a transient failure for a permanent
  one, and the one-click capture loop (the feature's core loop per the
  competitor analysis) silently degrades on every verse.
- **Proposed fix:** On append failure with `code === "not_found"`, clear
  `lumen:last-note`, drop `last` to null (the New-note door remains), and
  word the line honestly: "That note is gone — start a new one."

## UX-10: A failed editor-chunk load blows away a healthy read view

- **Severity:** medium
- **Category:** missing failed-affordance
- **File:** apps/web/app/routes/notes.$id.tsx:362 (`lazy(() => import(...))`),
  389-413 (Suspense with loading fallback only)
- **Claim:** The A19 EditorBoundary lives INSIDE the lazy chunk
  (NoteEditor.tsx default export), so it cannot catch the chunk's own
  load failure. Clicking Edit on flaky/offline network makes `React.lazy`
  reject, the rejection propagates past `<Suspense>` to the route
  ErrorBoundary, and the user's perfectly-readable note page is replaced
  by the route error surface. "Opening the editor…" covers loading;
  nothing covers failed. (A11's intra-route boundary makes this a real
  path: reading never loads PM, so the fetch happens exactly at the Edit
  click.)
- **Proposed fix:** Wrap the `<Suspense>` in a small error boundary in
  notes.$id.tsx whose fallback keeps the user on the page: one line —
  "The editor couldn't load — check your connection." + a retry that
  re-triggers the import — while the read view remains reachable
  (setEditing(false)).

## UX-11: "Note deleted" announcement mounts with its text — most screen readers will never speak it

- **Severity:** low
- **Category:** a11y (overlaps a11y lane; flagged for the flow I own)
- **File:** apps/web/app/routes/notes.tsx:71-73
- **Claim:** The post-delete navigation renders `/notes` fresh with the
  aria-live region ALREADY containing "Note deleted". Live regions
  announce mutations after mount, not initial content, so the CF-47
  announcement half of the delete exit likely never fires (the h1 focus
  half works and is what the delete-confirm e2e asserts).
- **Proposed fix:** Mount the region empty and set the message in an
  effect (post-paint tick) when `arrivedFromDelete`.

## UX-12: NoteEditor.tsx contains literal NUL bytes — git treats the feature's most complex file as binary

- **Severity:** low
- **Category:** code-hygiene (cross-lane; flagged because it hid this
  file from diff review)
- **File:** apps/web/app/components/editor/NoteEditor.tsx:94 and :215 —
  `textBetween(..., "\x00", "\x00")` with raw 0x00 bytes in the string
  literals (4 NULs total; verified by byte scan)
- **Claim:** `git diff` renders the file as `Bin 0 -> 28816 bytes`
  (visible in this panel's own `--stat`), so no diff-based review, blame
  hunk, or PR view can display the editor's changes — and the NULs are
  invisible in editors (they read as `" "`). The separator choice itself
  may be deliberate (NUL can't extend a reference match) but the encoding
  must not be a raw byte.
- **Proposed fix:** Replace the raw bytes with `" "` escapes (byte-
  identical semantics, text file again); add `text` gitattributes or a
  lint if regression matters.

## UX-13: Formatting legend is hidden forever exactly when it can't be earned-quiet

- **Severity:** low
- **Category:** copy-tone / dead-state
- **File:** apps/web/app/components/editor/NoteEditor.tsx:308-314 (init
  catch returns 3), 330-340 (bumpFmt catch: "legend just stays"), 795-800
  and 750 (hardcoded ⌘)
- **Claim:** A17's legend is "earned-quiet after ~3 formats". When
  localStorage throws (private browsing, storage-denied), the init
  fallback of 3 suppresses the legend permanently for users whose count
  can never accrue — while bumpFmt's catch comment documents the opposite
  intent ("legend just stays"). Separately, the legend and the popup foot
  line hardcode ⌘ (⌘B / ⌘I / ⌘↵) for Windows/Linux users, where the
  bindings are Ctrl.
- **Proposed fix:** Init fallback 0 (show the legend when the count is
  unknowable); derive the modifier glyph from platform (the usual
  `navigator.platform` Mac test) for both the legend and the foot line.

## UX-14: Autosave debounce is not idle-keyed — it fires mid-typing ~3s after the FIRST edit

- **Severity:** low
- **Category:** save-state / correctness
- **File:** apps/web/app/components/editor/NoteEditor.tsx:543-547 (deps
  `[dirty, latestMdRef.current, noteId]`)
- **Claim:** The effect's reset depends on re-renders, but continuous
  typing produces none: `setDirty(true)` bails when already true, and
  popup/announce setters bail on identical values — `latestMdRef.current`
  in the deps array is read only when something else renders. So the
  timer armed by the first keystroke runs to completion during active
  typing (a save every ~3s mid-composition), and conversely any unrelated
  render (popup open/close, announce) resets it arbitrarily. G5 specifies
  a ≥3s IDLE debounce. Harmless today only because update is fetcher
  JSON; it still burns writes and makes `updated_at` (the LWW base)
  churn while typing.
- **Proposed fix:** Reset a timer explicitly in `dispatchTransaction` on
  every `docChanged` (or bump a `useState` edit counter and key the
  effect on it) instead of dep-array coincidence.

## UX-15: A brand-new empty note reports "Saved"

- **Severity:** low
- **Category:** copy-tone / save-state
- **File:** apps/web/app/components/editor/NoteEditor.tsx:774-784
- **Claim:** On /notes/new before any keystroke, `dirty` is false and the
  status line renders "Saved" — nothing exists server-side. The G5
  requirement is save state "always visible while dirty"; while clean the
  line may print nothing (house rule: registers print nothing when
  empty), and on the create surface "Saved" is simply false.
- **Proposed fix:** On `noteId === null && !dirty`, render nothing (or
  nothing until the first save lands).

## UX-16: Paste conversion announces "Backspace to undo" but Backspace doesn't undo it

- **Severity:** low
- **Category:** copy-tone
- **File:** apps/web/app/components/editor/NoteEditor.tsx:480-495
  (handlePaste; announce at 493)
- **Claim:** The auto-link rule's Backspace handler restores the typed
  text (autoLinkKey `last`, lines 127-152). The paste path never sets
  that state, so after a paste-conversion Backspace is just the base
  atom-delete: the link vanishes and the pasted URL text is NOT restored
  — the user who wanted the raw URL gets nothing. The announcement
  promises the auto-link semantic the paste path doesn't have.
- **Proposed fix:** Register the paste in the same plugin state with the
  raw URL string as the restore text (one-line reuse), or reword to
  "Pasted as link" and rely on ⌘Z.

## UX-17: media `+ note` door is undiscoverable on touch

- **Severity:** low
- **Category:** missing-affordance / mobile
- **File:** apps/web/app/routes/media.tsx:528-536
- **Claim:** The door is `opacity-0 … group-hover:opacity-100
  focus-visible:opacity-100`. Keyboard is covered; touch is not — coarse
  pointers have no hover, so the new transcript-capture affordance is
  invisible on phones (Q6 mobile is in scope, and mobile is the recorded
  competitor gap). The adjacent timestamp button shares the pattern but
  is pre-existing; `+ note` is new surface adopting it.
- **Proposed fix:** Reveal on coarse pointers — e.g. add
  `pointer-coarse:opacity-100` (or show it whenever the paragraph is
  `active`), keeping the hover-reveal on fine pointers.

## UX-18: /search?scope=notes renders a ghost state — all canon pills lit, "0 results", only the notes leg ran

- **Severity:** low
- **Category:** dead-state (URL-only reachable; the scope pill is
  deliberately unshipped)
- **File:** apps/web/app/routes/search.tsx:243-262 (notes-only leaves
  `scope` undefined → loaderData.scope null), 729 (`included` defaults to
  all GROUP_KEYS), 1042/1069 (counts exclude notes)
- **Claim:** With `scope=notes` signed-in, the loader correctly runs only
  the notes leg (327-334), but the client receives `scope: null` and
  renders every canon pill as included, an all-groups scope line, and a
  status of "0 results" — the page claims a full-library search that
  never happened. Reachable only by hand-built URL today, but the API
  contract is public per A4 and the state actively lies.
- **Proposed fix:** Cheapest guard consistent with the pill-restraint
  ruling: when the loader ran notes-only, echo that in loaderData (e.g.
  `scope: []` + a flag) and print the existing scope-line treatment
  ("searching your notes only — restore all"), or normalize the URL to
  drop the scope.

## Summary

critical: 1 · high: 3 · medium: 6 · low: 8 — 18 findings.

The ratified anatomy (A9 verbs/rows split, A15 ring-first + clamp-4 + SR
parity, empty-state restraint, print-nothing registers) is faithfully
implemented. The dominant defect is UX-1: the entire rendered-markdown
surface (note page + editor) ships with zero CSS behind Tailwind
preflight — structurally correct, visually flat, and invisible to the
green harness because nothing asserts computed style.
