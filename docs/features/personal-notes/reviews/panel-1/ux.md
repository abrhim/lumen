# UX review — personal-notes (panel-1, plan stage)

Lens: the writing/reading/linking experience the plan implies. Doctrine
citations are docs/design/navigation.md §2 unless noted. Editor choice
(ProseMirror WYSIWYG, syntax never renders) is human-ruled and not
re-litigated here; every finding takes it as given.

Findings ranked; UX-1 through UX-3 are the ones that change the plan's shape.

---

### UX-1: The compose flow is ambiguous, and the plan's own bundle invariant already decides it — the rail captures, the route composes

**Severity:** High (blocking — the v1 flow must be written down before implementation)

**Claim.** Plan §Linking mechanism 3 ("Reader capture — selected verse rail:
'Add to note' (new note anchored here / append link to last-touched note)")
and D5/routes leave the central question open: does "Add to note" navigate
away from Alma 32 to `/notes/:id`, or does composing happen inside the rail?
Walked as a user journey — reading Alma 32, select v.21, tap "Add to note",
land on `/notes/new` — the reading is gone. That looks like a doctrine-2
violation ("a casual reader must never meet a workspace uninvited") but the
opposite reading (embed the editor in the rail as a disclosure) is *worse*,
and the plan itself forbids it: **D7/F10 pin the editor chunk absent from the
scripture route's client graph** (plan.md:119-121, :143). An in-rail
ProseMirror instance cannot exist without breaking the plan's own asserted
invariant. The doctrine and the bundle rule converge on one shape:

- **Capture is a rail act, composition is a route act.** The rail never
  hosts an editor. It hosts two verbs and a confirmation line.

**Evidence.** plan.md:67-69 (mechanism 3, both verbs named but no flow),
plan.md:119-121 (D7), plan.md:143 (F10); doctrine 2 ("structure replaces,
content branches"); doctrine 13 ("routes, not surfaces");
scripture.tsx:1048-1102 (desktop rail, always-mounted, grid-locked so the
text column never reflows — an editor here would also fight that layout
contract); scripture.tsx:1104-1146 (on mobile the "rail" is a bottom Sheet
capped at 75dvh — an editor inside a sheet under the iOS keyboard is a
non-starter).

**Proposed fix — the concrete v1 flow, written to be adopted verbatim:**

1. **"Add to note" (append, stays in the reading).** Signed-in + verse
   selected → the Your-notes register area carries one quiet typed verb,
   `Add to note`. Tap: a React Router action appends `[[alma-32-21|Alma
   32:21]]` (plus an anchor row) to the **last-touched note**, without
   navigation. The register then prints a one-line confirmation in the
   house gloss register (11px sans, muted): *Added to "Faith is a seed" —
   open ·* where "open" is the door to `/notes/:id` and the note title is
   plain text. The confirmation line doubles as the **undo window**: an
   `undo` word sits beside it until the next selection change. No toast,
   no snackbar — the register itself speaks, in type.
2. **"New note" (compose, deliberately leaves).** A second verb, printed
   only when it differs in consequence (i.e. always): `New note`. Tap:
   navigates to `/notes/:id` with the anchor prefilled as the first line's
   wikilink. This is *structure replacing* — the user asked for the
   workspace, so meeting it is invited (doctrine 2 is about the
   *uninvited* case). Back (or the ⁂→reader path) must return to
   `/scripture/alma/32?verse=21` — the plan should pin the return-trip URL
   in e2e (see Harness gaps).
3. **No last-touched note exists** → "Add to note" degrades to the "New
   note" behavior (one verb prints, not a disabled second one — registers
   never print dead controls).
4. **Mobile:** same two verbs inside the verse Sheet
   (scripture.tsx:1104-1146). Append closes nothing — the sheet stays up,
   the confirmation line prints inside it. "New note" closes the sheet by
   navigating; back restores `?verse=` so the sheet re-opens (the URL
   already encodes drawer state — scripture.tsx:1000-1008).

Reading continuity is the product's spine; append-in-place is the flow
that respects it, and it must be the *first* verb, visually and in DOM
order.

---

### UX-2: "Cmd+J reuses SearchModal" reuses a component that cannot do the job — insert posture is a mini-palette build, and the plan should say so

**Severity:** High (scoping honesty; affects cut-line 2's real cost)

**Claim.** The shipped SearchModal is one input whose only outcome is
`navigate('/search?q=…')` (SearchModal.tsx:131-138). It has no result rows,
no listbox, no `aria-activedescendant` roving highlight, no destination
index, and no escape registry — the registry itself is sequenced to ship
*with the palette* (navigation.md §8.1), which is not yet built. "SearchModal
reused in insert mode: picks a destination" (plan.md:70-73) therefore names
a reuse that does not exist: picking a destination is precisely the part
SearchModal lacks. What insert posture actually requires is the palette's
§5 anatomy — combobox ARIA contract, destination-index rows, row highlight,
Enter-selects — scoped down. That is buildable, but it is *net-new palette
work smuggled in under "reuse"*, and it is exactly what cut-line 2 would cut.

**Evidence.** SearchModal.tsx:131-138 (submit = navigate, nothing else);
SearchModal.tsx:46-63 (its whole contract is "one input, Enter navigates");
navigation.md §5 (ARIA contract insert posture would owe: combobox →
listbox, `aria-activedescendant`, polite status region); navigation.md §2.6
(escape registry is the *binding* implementation of Esc order; it doesn't
exist yet); plan.md:167-170 (cut-line 2).

**Proposed fix.**
- Rename the plan line: "insert-posture **palette** (new, shares the shell
  and input styling of SearchModal; destination-picking rows are net-new,
  built to the §5 ARIA contract)". Cost it honestly against cut-line 2.
- Scope its data to the **client side only** for v1: `parseReference`
  (already client-shipped — scripture.tsx uses it) + the same
  books/chapters/entity-slug destination source mechanism 2's `[[`
  autocomplete needs anyway. One suggestion engine, two skins
  (inline autocomplete, modal). No `/api/search` leg in insert posture —
  that keeps it out of D3's blast radius and makes the modal fast enough
  to feel like typing.
- **Esc semantics, pinned:** insert posture must register a closer on open
  (the feature can ship a minimal escape-registry seed if the palette
  hasn't landed first — flag the sequencing dependency to the gate).
  Esc order: autocomplete-suggestions-open → suggestions close, input
  keeps focus; Esc again → modal closes, **PM view refocused,
  selection/cursor exactly as before summon**. Because "selection becomes
  label" (plan.md:72), the stored PM selection must survive the modal's
  focus theft — pin `view.state.selection` before open, restore via
  `view.focus()` + explicit selection restore on close-without-insert.
  A dropped selection here silently corrupts the label feature.
- **Insert posture must look like what it does.** Same input, same rows,
  but the foot line (the modal already has the `Enter to search · Esc to
  close` foot idiom, SearchModal.tsx:219-228) changes verb:
  `Enter to insert · Esc back to writing`. Words, not badges — the foot
  line *is* the posture signal. No title change to "INSERT MODE", no
  colored header.

---

### UX-3: Discovery has a hole the print-nothing rule digs — a zero-notes user never smells the feature

**Severity:** High

**Claim.** Registers print nothing when empty (navigation.md §3, §4). A
signed-in user with zero notes therefore never sees a "Your notes" register
— and the Desk register is explicitly out of scope (plan.md:56-57), and the
palette/floor aren't built. Trace every surface: no register, no Desk row,
no signage allowed (doctrine 7). The feature is undiscoverable by exactly
the user it must convert. Separately, `/notes` with zero notes is a *page*,
and a page cannot print nothing.

**Evidence.** navigation.md §3 ("a register with nothing prints nothing"),
doctrine 7 ("scent, not signage; the fallback for missed scent is enriching
home, never adding chrome"), plan.md:55-57 (Desk register out).

**Proposed fix.**
- **Rule the distinction: the print-nothing law governs content rows;
  capture *verbs* are affordances, not content.** The `Add to note` /
  `New note` verbs from UX-1 print whenever signed-in + verse selected,
  even at zero notes — they *are* the scent, one quiet typed line in the
  rail the user already opens for depth. This needs an explicit line in
  the plan so the print-nothing rule isn't applied mechanically to
  suppress the feature's only door. (Guided posture may louden the verb
  per doctrine 12 — label stays, ink lifts — volume, never a new surface.)
- **Empty `/notes` speaks once, in type.** One serif italic line in the
  title-plate idiom, e.g.: *"Nothing written yet. Select a verse as you
  read — a note begins there."* — beneath it, one plain text door:
  `Begin a note`. No illustration, no empty-state card, no button chrome.
  (House precedent: the Desk masthead's italic title-plate line,
  navigation.md §3.)
- First-run inline whisper (§6a.4 idiom) is available if the gate wants
  more: once, in type, on the first selected verse — *"Notes live here
  now."* Recommend holding this in reserve rather than shipping it;
  the verb-in-rail should be scent enough, and §6a.4's budget is
  already spent on depth.

---

### UX-4: The auto-link input rule needs its escape hatch designed now — Backspace-undo plus a no-retrigger memory, signaled in type

**Severity:** Medium (small code, but absent it produces the feature's most rage-inducing loop)

**Claim.** Mechanism 1 auto-links "Alma 32:21" as you type, with no syntax
(plan.md:63-64). The Google-Docs-y user's contract for autocorrection is:
it visibly happened, and one gesture undoes it. Docs shows a dismiss chip;
chips are banned dialect here. The plan has F4 (false-positive fixtures)
but no *recovery* design at all — and the failure loop without one is
vicious: undo via ⌘Z, keep typing, the rule re-fires, forever.

**Evidence.** plan.md:63-64 (mechanism 1), plan.md:130-131 (F4 covers
false positives only); house rules ("no pills/cards"; typography-first).

**Proposed fix.**
- Bind prosemirror-inputrules' `undoInputRule` to **Backspace**: one
  keystroke immediately after the rule fires reverts the link to the plain
  text typed. ⌘Z does the same as one history step. This *is* the house
  equivalent of the dismiss chip — the affordance is a keystroke the user
  already owns, not new chrome.
- **No-retrigger memory:** after an undo (either path), the same text run
  must not re-link while the user continues typing through it. (PM's
  undoInputRule handles the immediate case; verify the rule doesn't
  re-fire on the next boundary character and add a transaction-meta guard
  if it does.) Add this exact sequence to F4's fixtures: type ref →
  auto-link → Backspace → keep typing → still plain text.
- **The signal that a link happened is typographic:** the wikilink node
  renders in the dotted typed-link idiom the product already speaks
  (navigation.md §3 Trails: "each hop a typed, dotted link") — link ink +
  dotted underline, appearing at the moment of conversion. No animation
  needed beyond the ink change; under reduced motion it's already instant.

---

### UX-5: On a phone, insert posture has zero doors — decide `[[` is the universal door and say so, rather than waving at "selection affordance"

**Severity:** Medium

**Claim.** Doctrine 11: every gesture has three doors — key, click, touch.
Cmd+J is the key door (desktop only; iOS external keyboards are a niche).
The plan's third trigger is "selection affordance" (plan.md:72-73), never
specified. On mobile: the floor magnifier is navigation-scoped and the
floor isn't built (navigation.md §8.3); a floating selection bubble over
PM is the AI-dialect toolbar wearing a trench coat; there is no honest
touch door in the plan as written.

**Evidence.** plan.md:70-73; doctrine 11; navigation.md §6 (floor's
magnifier = palette-sheet trigger, location-scoped); memory: avoid
pill/card AI dialect.

**Proposed fix.** Declare **`[[` as the universal door**: typing `[[` in
the editor opens the *same* suggestion surface (inline popup on desktop,
docked-above-keyboard on mobile — reuse SearchModal's B13 visualViewport
inset pattern, SearchModal.tsx:113-129). Cmd+J is then a desktop
accelerator onto the same engine, and "selection affordance" should be
**cut from the plan's language** unless it can be named concretely; the
honest v1 sentence is "three triggers: `[[` (all widths), Cmd+J (desktop
accelerator), reader capture (mechanism 3)". Consequence for the harness:
F12's mobile "insert link" smoke (plan.md:145-146) must walk the `[[`
door, not Cmd+J.

---

### UX-6: Formatting affordance honesty — ship keyboard-only v1 with a typographic legend, and device-verify the iOS callout as the mobile bold path

**Severity:** Medium

**Claim.** The plan gives input rules + keyboard shortcuts and no visible
formatting affordance. A Google-Docs user who selects text and sees nothing
happen concludes the editor is broken — that is the single most predictable
support moment in this feature. Icon toolbars are banned (doctrine 8,
house rules). The gap is real and the plan neither fills it nor accepts it.

**Evidence.** plan.md:39-41 (schema + input rules; no affordance listed);
doctrine 8; doctrine 12 (Guided may louden/label existing affordances,
never add one — a legend line is an existing-affordance *label*).

**Proposed fix.** Accept keyboard-only v1, but not silently:
- A **one-line typographic legend** at the note page's foot, in the exact
  idiom the Desk foot and SearchModal foot already use (kbd words in
  11px sans, SearchModal.tsx:219-228): `⌘B bold · ⌘I italic · # heading ·
  - list · > quote`. Words and the marks themselves — the legend *shows*
  bold by being bold. It is content-side type, not chrome; it enumerates
  grammar, not destinations, so doctrine 1 is untouched.
- Make the legend an **earned-quiet** client (§3c): fades to the lightest
  passing ink after the user has applied ~3 formats; Guided pins it
  attended. No timer.
- **Mobile path:** iOS's native selection callout offers Bold/Italic on
  contenteditable ("Format" in the edit menu); if PM's `beforeinput`
  handling maps those to schema marks, mobile has a formatting path with
  zero new UI. This is a device check, not an assumption — it goes on the
  Q6 checklist (UX-9). If it fails, v1 mobile is plain-text-plus-links,
  and the plan should say that out loud at the gate rather than discover
  it in support.

---

### UX-7: The "Your notes" register — position, label mark, row anatomy, and a five-dot stack that may not fit

**Severity:** Medium

**Claim.** The plan reserves the register (plan.md:46-48) but specifies
none of: its position among art · Teaches · Mentions · Heard in ·
Cross-references, its label mark (the §7.1 ruling gives every rail register
a 13px lucide icon — notes needs a sixth), its row anatomy, or the fifth
dot's fit in the mobile vertical stack, whose arithmetic was done for four
kinds ("a four-kind stack runs ~23px, inside even a one-line row",
navigation.md §6a.2).

**Evidence.** scripture.tsx:1283 (Art), :1744-1760 (Teaches/Mentions),
:1330-1341 (Heard in), :1655 (Cross-references) — the shipped order;
navigation.md §7.1 (label idiom ruling: 13px lucide, 1.75 stroke,
currentColor); scripture.tsx:970-985 (mobile stack: 4px dots, 2.5px gap,
anchored `top-8` — five kinds run ~30px against four's ~23px).

**Proposed fix.**
- **Position: first, above art.** The register order was ruled as "moments
  read with the entities" — an ordering argument about the *communal*
  layers. The personal layer is a different species: Lumen's inversion is
  that the personal layer grows *on* the given canon, and the user's own
  words about a verse outrank the world's when both exist. First position
  also seats the capture verbs (UX-1) at the top of the rail where the
  selection just happened. This extends rather than reopens the shipped
  ruling, but it is Abram's to confirm — flag at the gate.
- **Label:** `Your notes`, sentence case, 13px sans normal weight, mark =
  lucide `NotebookPen` (or `PenLine`) at 13px/1.75 in currentColor —
  extending the §7.1 five-mark set to six by the same ruling.
- **Row anatomy = the CrossRefRow idiom** (scripture.tsx:1836-1877):
  serif 14.5px derived title, 11px sans gloss (`edited May 3 · 2 anchors`),
  hairline rules, whole row a door to `/notes/:id`, `bg-dot-note` 5px dot
  leading the row like EntityRows. Derived-title fallback when the first
  line is empty or link-only: `Untitled note` in the muted italic register
  — never a blank row (Q4 input below).
- **Five-dot stack fit:** verify a 5-kind stack (~30px from `top-8`)
  inside a one-line verse row on mobile before committing; if it clips,
  the note dot takes the stack's *first* slot (personal layer leads,
  matching register position) and the check clamps at four visible with
  the existing kinds — never a scrollbar, never a "+1". Desktop margin
  cluster (56px gutter, commit 18ccb6d) fits five at 5px/5px gap: 45px —
  fine. Legend teaching: dots stay unlabeled ("hinting, not data",
  scripture.tsx:1023-1026); the color is learned where the others are —
  by opening the rail and seeing the same ink lead the register's rows.

---

### UX-8: Mechanism collisions — the five doors must not fire into each other

**Severity:** Low (cheap to prevent now, confusing to debug later)

**Claim.** Five mechanisms share one text stream. Concrete collisions the
plan doesn't address: (a) typing `[[Alma 32:21` — does the reference input
rule (mechanism 1) fire *inside* the autocomplete span (mechanism 2)?
(b) pasting a Lumen URL while text is selected — does paste conversion
(mechanism 4) replace the selection with a link whose label is the
selection, or clobber it? (c) the reference rule firing inside an existing
wikilink's label text.

**Evidence.** plan.md:62-73 (all five, specified independently, no
interaction rules).

**Proposed fix.** One sentence of law in the plan: **input rules are inert
inside an active autocomplete span and inside wikilink nodes**; paste-over-
selection converts with the selection as label (mirroring mechanism 5's
"selection becomes label" — the two should share the rule). Add one F4
fixture per collision. Overlap itself is *not* a confusion problem —
doctrine 11 licenses many doors to one gesture, and all five emit the same
`[[ref|label]]`; the danger is only doors firing through each other.

---

### UX-9: Q6 mobile compose — the named device checklist, and the floor/keyboard standoff

**Severity:** Medium (v1 ships mobile compose per Q6 default; these are the checks that decide whether "basic" is true)

**Claim.** "Existing visualViewport patterns" (plan.md:183-185) covers one
of perhaps nine failure surfaces. PM-in-mobile-Safari with the keyboard up
is a known swamp; each item below has sunk a real editor.

**Evidence.** SearchModal.tsx:108-129 (B13 — the pattern exists but was
built for a Sheet, not a page-level editor); navigation.md §6 (floor is
visualViewport-driven, two-tap bottom-edge checklist already exists);
doctrine 3 (two bottom bars unforgivable); headless-Chrome memory (mobile
verification must be CDP emulation or device, not window-size crops).

**Proposed fix.** Pin this checklist into the plan's Q6 acceptance:
1. Caret visibility: focused PM keeps the caret above the keyboard while
   typing at document bottom (visualViewport resize + `scrollIntoView` of
   the selection head; the B13 inset pattern doesn't do this for a page).
2. iOS selection callout Format→Bold/Italic reaches PM marks via
   `beforeinput` (decides UX-6's mobile story).
3. `[[` autocomplete docks above the keyboard, and smart punctuation /
   autocorrect doesn't mangle `[[` or the typed reference (also: does
   `parseReference` accept "alma 32:21" lowercased by autocapitalize-off
   keyboards? — F4 fixture).
4. Paste conversion via the iOS paste menu (not just ⌘V).
5. Three-finger-swipe / shake undo maps to PM history (the mobile
   Backspace-undo path for UX-4).
6. Safari URL-bar collapse/expand bounce doesn't jitter the save
   affordance or the legend foot.
7. Save reachability with the keyboard up (no scroll-to-find-save).
8. **Floor v. keyboard:** when the floor (§6) later lands on /notes, editor
   focus must sliver or suppress it — keyboard + accessory + floor is
   doctrine 3's unforgivable outcome by another name. Notes routes should
   declare their floor behavior now (one line in the plan) so the floor
   feature doesn't have to re-open this one.
9. F12's smoke walks the `[[` door (UX-5), on the iOS Playwright profile
   *and* once on a physical device per the §6 precedent.

---

## Open-question input

- **Q2 (transcript anchoring): yes**, keep with cut-line 1 as planned.
  UX condition: the media-page capture verb must be the *same words* as
  the reader's ("Add to note", UX-1), in the transcript row's existing
  quiet idiom — one vocabulary for capture everywhere. If the UI cuts,
  the anchor kind shipping anyway is correct (paste conversion of a
  `?t=` URL becomes the interim door — mechanism 4 quietly covers the
  cut, worth noting at the gate).
- **Q4 (derived title): yes**, with the fallback pinned: first line
  empty/link-only → "Untitled note" in muted italic, and the derived
  title re-derives on every save (no stale-title state to manage).
- **Q6 (mobile compose): yes-basic**, gated on UX-9's checklist — with the
  explicit fallback stance that if check 2 fails, v1 mobile is
  text-and-links (no bold path) and that is said out loud, not
  discovered.
- **Cut-line 2 (Cmd+J):** re-cost after UX-2 — it is not a "reuse", it is
  a mini-palette. If it survives, it should be built as the §5 palette's
  seed (escape registry included) so the palette feature inherits rather
  than rebuilds; if that scope is too rich for this feature, cut it and
  let `[[` carry v1 (UX-5 makes `[[` the universal door regardless).

## Harness gaps (e2e flows worth pinning)

1. **Capture round-trip with reading continuity:** select Alma 32:21 →
   "Add to note" → note body gains the wikilink + anchor row → the
   reader URL never changed, selection intact, confirmation line printed
   → "open" door → `/notes/:id` → browser back →
   `/scripture/alma/32?verse=21` restored (desktop rail and mobile sheet
   variants).
2. **Append-undo:** capture → `undo` word → note body byte-identical to
   before, anchor row gone.
3. **Auto-link recovery loop (UX-4):** type ref → link forms → Backspace
   → plain text → continue typing → still plain text; separately ⌘Z path.
4. **Insert-posture Esc ladder (UX-2):** editor focused, selection made,
   Cmd+J → type → Esc (suggestions close, input keeps focus) → Esc
   (modal closes, PM focused, selection identical) → Esc (inert — never
   eats the note or a chapter).
5. **Collision fixtures (UX-8):** reference rule inert inside `[[` span
   and inside wikilink labels; paste-over-selection keeps selection as
   label.
6. **Zero-state:** signed-in, zero notes → chapter rail prints capture
   verbs but no register rows; `/notes` prints the empty line + "Begin a
   note"; signed-out prints neither (F2 already covers the negative).
7. **Five-dot stack visual regression:** a verse with all five kinds, one
   mobile viewport screenshot pinned (CDP emulation per house memory,
   not window-size crops) — stack inside the row box.
8. **Legend/earned-quiet:** formatting legend prints attended, quiets
   after third format, Guided pins it (localStorage bit, matches §3c
   grammar).
