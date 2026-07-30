# Code-panel — ACCESSIBILITY (personal-notes, step 9)

Scope reviewed: NoteEditor.tsx (role=textbox, `[[`/⌘K combobox contract,
CF-13 focus/selection restore), lib/escape-registry.ts + clients, the
polite status regions, alert-dialog.tsx + notes.$id.tsx + notes.tsx delete
focus ladder, scripture.tsx noted-verse suffix + register h3 + capture
verbs, media.tsx `+ note` door, reduced-motion coverage, and the e2e
a11y suite (axe/reduced-motion/delete-confirm/noted-verse/editor specs).

What's right (verified, not assumed): the contenteditable carries
`role="textbox" aria-multiline aria-label="Note"` (NoteEditor.tsx:474–478);
the sr-only `, your note` suffix sits INSIDE the verse link so it joins the
accessible name (scripture.tsx:1128) with the dots correctly aria-hidden
(1077, 1113); the register label is a real h3 (scripture.tsx:1537);
AlertDialog is motion-safe-gated, Radix owns Esc-cancel + focus-return, and
delete-confirm.spec.ts asserts trigger-return and the /notes h1 landing;
the `+ note` door has `focus-visible:opacity-100` (media.tsx:531) so it is
keyboard-reachable and visible on focus; capture verbs are real
buttons/links. The axe suite's `.text-faint` / corner-link exclusions are
PRE-EXISTING reader-chrome debt — noted, not relitigated (but see A11Y-9:
a NEW element shelters under that exclusion).

## A11Y-1: `[[` popup combobox ARIA is wired to a non-focused wrapper div — SR users get nothing

Severity: high
Category: aria-contract
File: apps/web/app/components/editor/NoteEditor.tsx:681–689 (vs 472–479)

Claim: `aria-expanded`, `aria-haspopup`, `aria-controls`, and
`aria-activedescendant` are rendered on the React wrapper
`<div ref={mountRef} …>`. The element that actually holds focus in the
`[[` posture is the ProseMirror contenteditable (view.dom, a CHILD of that
wrapper) which carries `role="textbox"` via `EditorView` attributes.
`aria-activedescendant` is only honored on the focused element (or one
reached via aria-owns from it); on a role-less, non-focusable ancestor it
is inert, and `aria-expanded` on a generic div is invalid ARIA. Result:
in the `[[` posture screen-reader users get no popup announcement and no
active-option tracking — the entire A10 combobox contract is visually
present but programmatically absent. (The ⌘K insert posture is fine: its
`<input role="combobox">` at 713–718 carries its own correct wiring.)
The green axe suite never opens the popup (axe.spec.ts scans closed
states only), so no test contradicts this.

Proposed fix: put the popup attributes on view.dom itself — e.g. make
`attributes` a function of state in the EditorView config (ProseMirror
supports `attributes: (state) => ({...})`, re-computed per update) that
emits `aria-expanded/aria-haspopup/aria-controls/aria-activedescendant`
from the autocomplete plugin state; delete the wrapper-div copies.

## A11Y-2: global Esc handler consumes the registry asynchronously — preventDefault is a no-op

Severity: medium
Category: escape-registry
File: apps/web/app/components/editor/NoteEditor.tsx:610–619

Claim: the document-capture keydown handler does
`import("~/lib/escape-registry").then(({ popEscape }) => { if (popEscape()) e.preventDefault(); })`.
By the time the promise resolves the keydown dispatch has completed:
`e.preventDefault()` after the fact does nothing, and any other Escape
listener (bubble phase, PM handlers, future layers) runs BEFORE the pop —
the "innermost layer only, never falls through" guarantee holds by luck of
there being no competing listener today, not by construction. The dynamic
import is also pointless: line 35 already statically imports `pushEscape`
from the same module, so it is in the chunk.

Proposed fix: statically import `popEscape` alongside `pushEscape` and
call it synchronously in the handler; keep the capture phase.

## A11Y-3: listbox empty state is an invalid child of role=listbox

Severity: medium
Category: aria-contract
File: apps/web/app/components/editor/NoteEditor.tsx:722–727

Claim: when `suggestions.length === 0` the popup renders a plain `<li>`
("Type a reference — …") with no role inside `<ul role="listbox">`.
`listbox` requires `option`/`group` children (axe rule
`aria-required-children`, WCAG 1.3.1); an implicit `listitem` child fails
it. The axe e2e stays green only because no scan runs with the popup open.
Additionally `aria-activedescendant` on the input/wrapper is correctly
omitted in this state, but `aria-controls` still points at a listbox with
invalid content.

Proposed fix: render the hint `<p>` outside the `<ul>` and render the
`<ul role="listbox">` only when there are suggestions (adjusting
`aria-expanded` accordingly), or give the hint row
`role="option" aria-disabled="true"`.

## A11Y-4: "Note deleted" announcement mounts pre-populated — most SRs will not speak it

Severity: medium
Category: live-region
File: apps/web/app/routes/notes.tsx:71–73 (with routes/notes.$id.tsx:373–377)

Claim: after delete-confirm the client navigates to /notes with
`state.deleted`, and NotesIndex renders
`<div aria-live="polite">Note deleted</div>` with the text already present
on the region's FIRST render. Live regions announce mutations to an
existing region; content present at insertion time is unreliable across
SR/browser pairs (frequently silent in VoiceOver/NVDA). The h1 focus
(lines 58–60) works, but the announcement half of the CF-47 ladder is
best-effort at most. delete-confirm.spec.ts asserts only DOM presence
(`getByText("Note deleted")`), which is why the suite is green over this
gap. Secondary: `location.state` persists in the history entry, so
returning to /notes via Back re-focuses the h1 and re-renders the message.

Proposed fix: render the region empty, set the text in a `useEffect` after
mount (a tick later), and clear the history state
(`navigate(".", { replace: true, state: null })`) once consumed.

## A11Y-5: capture verbs drop focus to body on append/undo

Severity: medium
Category: focus-management
File: apps/web/app/routes/scripture.tsx:1473–1493 (gloss at 1438–1472)

Claim: a keyboard user activates "Add to note"; when the fetcher settles,
`appended` flips true and the `<p>` containing the focused button unmounts
(`{!appended && …}`), dropping focus to `<body>` — exactly the B5 class
this same file documents and defends against for "See all"/"Show fewer"
(lines 1854–1884). Same on "undo": the gloss unmounts and focus dies. In
the mobile sheet this is worse — a dead focus can strand the SR virtual
cursor outside the sheet's layer.

Proposed fix: on append success move focus to the gloss's "undo" (or
"open") link via a ref+effect; on undo, focus the re-printed "Add to note"
button. Symmetric with the file's existing expand/collapse discipline.

## A11Y-6: editor "Done" exit drops focus to body

Severity: medium
Category: focus-management
File: apps/web/app/routes/notes.$id.tsx:404–409, 419–424

Claim: `onClose` flips `editing` false; the "Done" button (inside the
editor chunk) unmounts with the whole editor and nothing receives focus —
the read-view h1 already carries `tabIndex={-1}` (line 421), which only
makes sense as the intended landing, but no code ever focuses it. Every
keyboard edit session therefore ends in dead-body focus.

Proposed fix: in `onClose` (or an effect keyed on `editing` becoming
false in read mode), call `h1Ref.current?.focus()` on the title.

## A11Y-7: identical auto-link announcements do not re-announce

Severity: low
Category: live-region
File: apps/web/app/components/editor/NoteEditor.tsx:300, 507, 677–679

Claim: `announce` is React state rendered into the polite region and never
cleared. Setting the same string twice (link "Alma 32", undo, retype the
same ref later after the suppression set is bypassed via a different note
session — or paste the same URL twice: "Pasted as link — Backspace to
undo" both times) produces no DOM mutation, so no announcement the second
time.

Proposed fix: clear the region (set null) on a short timeout after each
announcement, or append an alternating zero-width space.

## A11Y-8: combobox misses aria-autocomplete; listbox unnamed

Severity: low
Category: aria-contract
File: apps/web/app/components/editor/NoteEditor.tsx:713–718, 722

Claim: both postures present a filtering suggestion list but neither the
insert-posture `role="combobox"` input nor the textbox declares
`aria-autocomplete="list"`; the shared `#note-insert-listbox` has no
accessible name. Non-blocking (pattern still operable) but short of the
APG combobox contract A10 pins ("one palette, one ARIA implementation").

Proposed fix: add `aria-autocomplete="list"` to the input (and to the
textbox attributes once A11Y-1 lands) and `aria-label="Link destinations"`
to the listbox.

## A11Y-9: the NEW `+ note` door shelters under the PRE-EXISTING .text-faint axe exclusion

Severity: medium
Category: contrast / test-gap
File: apps/web/app/routes/media.tsx:530–534; apps/web/e2e/axe.spec.ts:49–53

Claim: the axe suite excludes `.text-faint` explicitly as "PRE-EXISTING
reader-chrome contrast debt, not personal-notes surface" — but the
brand-new `+ note` link is styled `text-faint` at `text-xs`, i.e. a NEW
personal-notes element inherits the exclusion's shelter. Worse, /media is
not in the axe suite at all (only /notes, /notes/:id, reader), so the new
door is doubly unscanned. `--t-faint`-class colors on this codebase's
backgrounds are the documented AA failures the exclusion exists for; the
capture affordance — "the scent" per CF-20 — is the last place a
sub-contrast token belongs once revealed on hover/focus.

Proposed fix: style the door `text-muted-foreground` (matching the reader
capture verbs' class at scripture.tsx:1433–1434), and/or add a /media
transcript scan to axe.spec.ts without the reader exclusions applied to
new nodes. (Not relitigating the pre-existing debt itself.)

## A11Y-10: escape-registry doc drift — a phantom client and a stale contract comment

Severity: low
Category: doc-drift
File: apps/web/app/lib/escape-registry.ts:9–18

Claim: the header enumerates "rail note-compose → invoking verse control"
as a client, but no compose layer exists (A9 shipped capture as direct
verbs; `grep pushEscape` finds exactly one client: the NoteEditor popup)
— and the ONLY document-level Escape listener lives inside PMEditor
(NoteEditor.tsx:610), so the registry is editor-scoped in practice; a
future non-editor client would push entries nobody ever pops.
`EscapeEntry.onEscape`'s docstring says "return true if the entry consumed
the escape" but the signature returns void and `popEscape` uncondition-
ally reports consumption. LIFO itself is correct (push/`stack.pop()`), the
dispose is idempotent, and empty-registry Esc is inert (never eats a
chapter) — semantics are sound; the prose is not.

Proposed fix: trim the enumerated-clients list to reality, fix the
onEscape comment, and either move the keydown listener to a root-level
mount or note in the header that the listener currently rides the editor
chunk.

## A11Y-11: insert-posture popup has no outside-click dismissal

Severity: low
Category: interaction / aria-state
File: apps/web/app/components/editor/NoteEditor.tsx:691–754

Claim: the ⌘K popup closes only via Esc (registry) or commit. Clicking
back into the document (or anywhere else) blurs the autofocused input but
leaves the popup mounted, `aria-expanded="true"` stuck, and the stored
selection stale — a pointer user who then presses Esc gets a surprise
selection jump back to the pre-⌘K range.

Proposed fix: a pointerdown-outside listener (or blur-within check) that
runs the same close path as the registry entry, keeping CF-13's restore
semantics for keyboard closes only.

## A11Y-12: second aria-live in the editor — save-state chatter (observation)

Severity: low
Category: live-region
File: apps/web/app/components/editor/NoteEditor.tsx:774–784

Claim: A12's "one polite status region" is satisfied for reference
announcements (line 677 is the only one), but the save-state `<span>` is a
SECOND polite region that re-announces "Saving…"/"Saved" on every 3s-idle
autosave cycle — a steady drumbeat for SR users during normal writing, and
it can queue-collide with an "Inserted link…" announcement. Loud FAILURE
is mandated (A13/OBS-8) and correct to announce; routine success is not.

Proposed fix: keep the visible text as-is but move `aria-live` to a
wrapper that only carries the failed/stale strings (or set
`aria-live="off"` while the value is Saving/Saved/Unsaved).

## Out-of-lane note (for correctness lane)

NoteEditor.tsx is flagged binary by git (`Bin 0 -> 28816 bytes` in
--stat): lines 94 and 215 contain non-UTF-8/control bytes inside the
`textBetween(0, …, " ", " ")` separator arguments. Grep without `-a`
silently skips the file — which will hide it from future audits. Worth
normalizing to plain spaces regardless of behavior.

## Summary

12 findings: 0 critical / 1 high / 6 medium / 5 low. The delete focus
ladder, noted-verse SR parity, register h3, escape LIFO semantics, and
reduced-motion gating are implemented and e2e-verified; the high-severity
gap is the `[[` posture's combobox ARIA landing on a non-focused wrapper
(A11Y-1), with the remaining mediums clustered in focus-restoration on
unmount paths and live-region timing.
