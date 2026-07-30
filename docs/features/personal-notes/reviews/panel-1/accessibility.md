# Accessibility review — personal-notes (panel-1, plan stage)

Reviewer lens: first rich-text EDITOR in the product. House floor: WCAG AA in
every posture (navigation.md doctrine 12), reduced-motion instant (doctrine
15), Esc/focus rules (doctrine 6). ProseMirror choice is ruled; its a11y
consequences are in scope. Findings ranked high→low.

Evidence bases: plan.md; navigation.md §2 (6, 9, 12), §4, §5, §6a;
apps/web/app/components/SearchModal.tsx; apps/web/app/routes/scripture.tsx
(:926-996 dots, :1744-1806 rail registers); apps/web/app/routes/search.tsx
(:965-1000 roving/status); docs/features/search-ui/bugs.md (B-U1, B5, B9,
B14, B15, B21, B24).

---

### A11Y-1: The insert posture inherits an ARIA contract that exists only on paper — the plan must own building it

- **Severity:** high
- **Claim:** Plan §Linking 5 says "SearchModal reused in insert mode: picks a
  destination, inserts link at cursor." The shipped SearchModal
  (apps/web/app/components/SearchModal.tsx) is input-only: one `<input>`,
  Enter navigates to `/search?q=`. It has **no result list, no
  `role="combobox"`, no `aria-activedescendant`, no status region** — grep
  confirms zero occurrences of combobox/listbox/activedescendant anywhere in
  apps/web. The §5 palette ARIA contract (aria-modal dialog; input
  `role="combobox"` + `aria-expanded`/`aria-controls` → `role="listbox"`;
  `role="option"` rows with stable ids; roving highlight via
  `aria-activedescendant` with DOM focus never leaving the input; ONE
  visually-hidden polite status region) is spec, not code. "Reused" therefore
  under-states the work: the insert posture is the **first implementation**
  of the house combobox contract, and personal-notes becomes its reference
  client — or the feature silently ships a picker below the AA floor.
- **Evidence:** SearchModal.tsx:157-171 (form is a bare input);
  navigation.md §5 (contract); §8 sequencing puts the full palette in the
  search-UI stroke, but plan.md lists no dependency on it.
- **Proposed fix:** Plan must state explicitly: the insert-posture picker
  implements the full §5 contract (combobox/listbox/activedescendant/stable
  option ids/doctrine-4 append rules), with the insert-mode deltas specified:
  (a) activating an option **inserts and closes** instead of navigating — the
  status/confirmation announcement is "Inserted link to Alma 32:21", never
  "Navigating…"; (b) option accessible names carry type ("Alma 32:21 —
  verse", "Rameumptom — place", per §3 Trails idiom); (c) the `[[`
  autocomplete (mechanism 2) is the SAME contract hosted on the
  contenteditable: PM's DOM element carries `aria-expanded`,
  `aria-controls`, `aria-haspopup="listbox"`, and `aria-activedescendant`
  pointing into the popup while DOM focus stays in the editor — "one
  implementation, three doors" must include one ARIA implementation.
  Add a failure mode (F-new): axe + manual SR pass on the picker in both
  postures.

### A11Y-2: Focus-return-to-editor with cursor intact is unspecified — the repo's worst recurring bug class, now with a selection to lose

- **Severity:** high
- **Claim:** Doctrine 6 focus rule is "palette → its invoker." For the insert
  posture the invoker is a **selection inside a contenteditable**, not a
  button. Radix's default `onCloseAutoFocus` restores DOM focus to the
  previously-focused element, but restoring focus to the PM DOM node does
  not by itself restore the PM selection/cursor, and the shipped
  pointer-open pattern (SearchModal.tsx:188-194 — `openedByPointer` →
  `preventDefault()` + `blur()` to body, the B-U1/B21 fix) is actively
  **wrong** in insert posture: a pointer-opened insert (selection-affordance
  door) that blurs to body on close strands the user outside their note.
  Every close path — insert, Esc, backdrop click — must return focus to the
  editor with the pre-open selection restored (selection-as-label per plan
  §Linking 5 means the selection must survive the round trip to become the
  label). Additionally the insert transaction must apply at the **stored**
  PM selection, not at `document.activeElement`, or a mid-open loader
  revalidation reorders state under it. History: B-U1, B9, B21, B5 are all
  focus-residue bugs; this surface adds cursor position to what can rot.
- **Evidence:** SearchModal.tsx:70-73, 188-194 (pointer-blur pattern);
  bugs.md B-U1/B9/B21/B5; doctrine 6 focus rules.
- **Proposed fix:** Plan pins: (1) capture `view.state.selection` (and a doc
  version) on open; (2) on ANY close, `view.focus()` +
  `dispatch(tr.setSelection(stored))` (mapped through any interim steps);
  (3) the pointer-blur exception explicitly does not apply in insert
  posture (both doors refocus the editor); (4) inserted-link transaction is
  built from the stored selection. Playwright assertion: open via Cmd+J with
  a mid-word cursor, Esc, type one character — the character lands where the
  cursor was (byte-exact doc assertion); same for insert-then-type.

### A11Y-3: Escape registry entries unenumerated — and the registry itself does not exist in code yet

- **Severity:** high
- **Claim:** Doctrine 6 mandates one LIFO escape registry; grep finds no
  registry implementation in apps/web (navigation.md §8 assigns its birth to
  the palette stroke, which has not shipped — the current SearchModal rides
  Radix's built-in Esc). Personal-notes stacks up to four escapables at once
  in the reader (suggestion popup → insert modal → note-compose surface →
  rail) and the plan never enumerates them, so each will hand-roll Esc — the
  exact condition doctrine 6 exists to prevent. Specific hazard: PM's keymap
  handles Esc inside the editor's capture path; the `[[` popup must consume
  Esc in the PM keymap (returning true) BEFORE Radix or any global listener
  sees it, or one Esc closes popup+modal together. And "never eats a
  chapter": Esc with a note surface open on /scripture must close the
  innermost note thing only, never deselect the verse or (future) hop to
  Desk.
- **Evidence:** doctrine 6 (binding implementation note); grep: no
  escapeRegistry/registerCloser symbols in apps/web.
- **Proposed fix:** Plan gains an "Escape registry" subsection: either
  personal-notes builds the registry (it becomes the first client) or the
  plan declares a hard dependency on the palette stroke landing first —
  choose at the gate. Enumerate the entries with their focus-return targets:
  1. `[[` suggestion popup → close popup, focus stays in editor, `[[` text
     remains typed (composable retry);
  2. Cmd+J insert modal → editor, cursor restored (A11Y-2);
  3. reader note-compose surface (rail "Add to note" flow) → the invoking
     verse control (matches the rail/sheet rule);
  4. soft-delete confirm dialog → the delete trigger;
  5. rail itself → invoking verse control (existing rule, unchanged);
  6. registry empty → Esc inert on the chapter (v1 rule).
  On /notes/:id with a clean editor, Esc is inert (never navigates away from
  the note). Playwright: full-chain spec — open popup inside modal-less
  editor, then modal, assert 3 discrete Esc presses unwind in LIFO order and
  the 4th does nothing.

### A11Y-4: The note dot is invisible to screen readers and colorblind users — the one dot that is personal data, not ambient hint

- **Severity:** high
- **Claim:** Both dot surfaces are `aria-hidden` (scripture.tsx:972-981
  mobile stack, :986-996 desktop cluster) and the §6a.1 non-color carrier
  (deeper number ink + hairline tick) is a **binary** "has depth" signal —
  it cannot say WHICH kind. That was ratified for canonical hints
  ("hinting, not data"). The 5th dot breaks the ratification's premise:
  "you wrote a note on this verse" is the user's own data with a distinct
  action behind it (open MY note), and under the current pattern a
  screen-reader user can never find their own notes in the chapter, and a
  colorblind user cannot tell the note dot from teaches/mentions in a
  4px cluster (1.4.1 — color as sole differentiator of the one dot that
  matters personally). D5 "merges into existing verse-signals shape as 5th
  kind" inherits aria-hidden by default.
- **Evidence:** scripture.tsx:972, :988 (`aria-hidden`); §6a.1 ("color is
  not the sole carrier (weight + tick)") — carrier covers presence, not
  kind; plan.md D5.
- **Proposed fix:** Two carriers, both cheap:
  (a) **SR parity:** noted verses append a visually-hidden suffix to the
  verse link's accessible name — sr-only `", your note"` inside the link
  (the verse link's name is currently the verse text; the suffix rides it).
  Rail register label "Your notes" is a real `<h3>` per register anatomy —
  icon in currentColor per §7.1 ruling (label's own ink, not the dot token);
  rows inside carry `bg-dot-note` dots as the color legend, same as
  EntityRows (scripture.tsx:1782-1805).
  (b) **Non-color kind carrier:** the note dot takes a distinct FORM, not
  just a 5th color — a hollow ring (2px stroke, transparent fill) reads
  "yours vs canon" at 4-5px and survives every palette. Stable position
  (always last in the cluster/stack) is secondary reinforcement.
  Playwright/axe: assert the accessible name of a noted verse; assert no
  contrast/1.4.1 regression on the new token in all themes.

### A11Y-5: Input-rule and paste auto-linking are silent transformations — announce them, and pin the undo escape hatch

- **Severity:** medium
- **Claim:** Mechanism 1 (typing "Alma 32:21" auto-becomes a wikilink) and
  mechanism 4 (pasted URL becomes a typed link) mutate the user's text with
  zero announcement. A screen-reader user cannot perceive that their plain
  text is now a link node (nor that a false positive fired — F4's fixtures
  protect correctness, not perception). Sighted users get the link styling;
  SR users get nothing. Google Docs' precedent is a polite live-region
  announcement for auto-corrections; the house already has the ONE-status-
  region idiom (search.tsx:1162-1169, "The ONE aria-live region (house D9):
  fixed height, text swaps only").
- **Evidence:** plan.md §Linking 1/4; search.tsx:1162-1169 (D9 idiom);
  bugs.md B24 (announcement-parity gap class).
- **Proposed fix:** The editor surface carries one visually-hidden polite
  status region (D9 pattern — fixed height, text swaps): input rule fires →
  "Linked to Alma 32:21 — Backspace to undo"; paste conversion → "Pasted as
  link — Alma 32:21". Bind PM's `undoInputRule` so an immediate Backspace
  reverts the auto-link to plain text (the standard PM escape hatch; also
  the fastest false-positive recovery for everyone). Same region announces
  save state ("Saved") — one region, never several (D9). Vitest: input rule
  + undoInputRule round-trip in the F4 fixture suite; Playwright: status
  region text after typing a true ref.

### A11Y-6: Editor region semantics and the heading-hierarchy collision (note h1 inside a page h1)

- **Severity:** medium
- **Claim:** (a) PM renders a bare `contenteditable` div; without
  `role="textbox"` + `aria-multiline="true"` + an accessible name, SR users
  land in an unlabeled editable region (the Lexical/ProseMirror community
  norm is exactly these three attributes). (b) The constrained schema allows
  heading 1–3 and Q4 derives the note title from the first line. On
  /notes/:id (read view) the page already has an h1; a note whose body
  contains `# heading` renders a second h1 (and if the first line IS the
  title, the same text prints twice as h1). The document outline breaks on
  both the read view and /notes index → note surfaces (WCAG 1.3.1 /
  2.4.6-adjacent; also trips axe `page-has-heading-one`/heading-order in the
  planned e2e).
- **Evidence:** plan.md §Scope (schema: heading 1–3), Q4 (derived title),
  D4 (renderer); scripture.tsx ErrorBoundary/page pattern (single h1 per
  page).
- **Proposed fix:** Pin a **demotion rule in the renderer** (D4): note
  heading level N renders as `h(N+1)` — schema h1–h3 → DOM h2–h4; the page
  h1 is the derived title; if the first line is itself a heading, the read
  view suppresses its duplicate body rendering (title consumes it). Inside
  the EDITOR, PM keeps native h1–h3 nodes (contenteditable interiors don't
  join the page outline in practice, and round-trip bytes are governed by
  F3) but the editor element gets `role="textbox"`,
  `aria-multiline="true"`, and `aria-labelledby` pointing at the page's
  note-title element (or `aria-label="Note"` on a fresh note). Add the
  demotion rule to the renderer fixture corpus.

### A11Y-7: Wikilink read-view rendering — link purpose and non-color affordance

- **Severity:** medium
- **Claim:** `[[ref|label]]` licenses labels like "the seed" whose text
  names nothing (WCAG 2.4.4 — the surrounding prose is user-written and
  cannot be assumed to supply context). And if wikilinks are distinguished
  from prose by color alone in the note body, 1.4.1 fails for the body's
  only interactive elements. F5's unresolvable-ref fallback ("styled plain
  text") must also not retain link semantics or the link styling that
  implies them.
- **Evidence:** plan.md §Linking (label grammar), D4, F5; house typed-link
  idiom: navigation.md §3 Trails ("typed, dotted link; entity type in the
  accessible name — 'Rameumptom (place)'").
- **Proposed fix:** Renderer emits
  `<a aria-label="{label} — {resolved destination}">{label}</a>` when label
  ≠ destination name (2.5.3 label-in-name holds — the visible text is a
  prefix of the accessible name); destination name resolved from the slug
  map (packages/scripture/src/notes-refs.ts already validates against it).
  Visual affordance = the house dotted underline (trails idiom), never color
  alone. Unresolvable refs render as `<span>` (no role, no underline) with
  the fail-closed styling. Renderer fixtures assert all three shapes.

### A11Y-8: Formatting has no touch door — bold/italic/headings are keyboard-shortcut-only on mobile

- **Severity:** medium
- **Claim:** The plan's editor ships input rules + keymap; no toolbar or
  formatting affordance is mentioned anywhere. Doctrine 11: "Every gesture
  has three doors — key, click, touch." On a phone (Q6 says mobile compose
  is v1) there is no Cmd+B; iOS's selection callout B/I/U fires
  `document.execCommand`, which raw PM does not wire up by default. Result:
  a touch or switch-access user can type but never bold, head, or list —
  and F12's own smoke ("type, bold, insert link, save" on iOS) is
  unexecutable as specced. This is also the AT story on desktop: voice
  control and on-screen-keyboard users need visible, labeled controls.
- **Evidence:** plan.md §Scope (editor bullet — no toolbar), F12, Q6;
  doctrine 11.
- **Proposed fix:** Decide at the gate: minimal formatting affordance in v1
  (a quiet, words-not-icons control row per doctrine 8 — "Bold · Italic ·
  Heading · List", each a real `<button>` with `aria-pressed` reflecting the
  active mark at the selection, 44px hit areas per the ORB_CLASS idiom), OR
  cut mobile formatting explicitly and reword F12 ("type, insert link,
  save"). Silence is not an option — F12 currently pins a flow the plan
  doesn't build.

### A11Y-9: Soft-delete confirm — dialog pattern and the post-delete focus destination

- **Severity:** medium
- **Claim:** Q3 ships soft-delete but the plan never specs the confirm
  surface. Two focus hazards, both in the B5/B9 class: (1) a confirm built
  as anything but a proper dialog (e.g. an inline swap) strands focus when
  the trigger unmounts; (2) after confirm, the note page navigates to
  /notes — focus falls to `<body>`, the exact dead-roving state B5
  documented, and an SR user gets no confirmation the note is gone.
- **Evidence:** plan.md Q3, §Public contract (soft-delete action); bugs.md
  B5 (unmount-blurs-to-body), B9 (pointer-focus residue on action buttons).
- **Proposed fix:** House Radix AlertDialog (`role="alertdialog"`,
  focus lands on Cancel, Esc = cancel via the escape registry entry from
  A11Y-3); destructive action described by the dialog title ("Delete this
  note?"). After confirm: navigate to /notes and move focus to the page h1
  (`tabIndex={-1}` + `.focus()` — the B5 fix idiom) with the status region
  announcing "Note deleted". The delete/save buttons take the B-U1
  `e.detail` pointer-blur guard so Space never re-fires them. Playwright:
  focus assertions on cancel AND confirm paths.

### A11Y-10: Reduced-motion pins for every new appear/recede — use motion-safe variants, not motion-reduce overrides (B14)

- **Severity:** medium
- **Claim:** Doctrine 15: every recede/appear is instant under
  `prefers-reduced-motion`. New animated moments this feature adds: the
  "Your notes" rail register arriving (the Connections block it will sit
  beside animates in — scripture.tsx:1752-1755), the dot appearing after
  save, insert modal/sheet entrance, `[[` popup entrance, save-state
  affordance transitions. B14's lesson is mechanical: `motion-reduce:
  animate-none` LOSES on specificity to shadcn's `data-open:animate-in`
  (`:where()` zeroes the variant) — the pattern that actually works is
  `motion-safe:` prefixing on the animating classes, as Connections already
  does.
- **Evidence:** doctrine 15; scripture.tsx:1753-1754 (motion-safe idiom);
  bugs.md B14 (specificity defeat, FIXED via motion-safe rewrite);
  app.css:296-299 (view-transition stills, already covers the rail
  promote).
- **Proposed fix:** Plan pins "all new appear/recede uses `motion-safe:`
  variants (never `motion-reduce:` overrides)" as a review-checklist line;
  the note dot's post-save appearance and the register's arrival reuse the
  Connections classes verbatim. Playwright: one spec runs with
  `reducedMotion: 'reduce'` context and asserts no `animate-in` computed
  animation on the insert modal and register.

### A11Y-11: Global shortcut posture inside the editor — ⌘K/⌘J collisions with editor muscle memory

- **Severity:** low
- **Claim:** SU-6 makes ⌘K open the global search modal EVERYWHERE,
  including editable fields (SearchModal.tsx:82-88; only bare `/` is
  contenteditable-guarded). Inside a rich-text editor ⌘K is the
  near-universal "insert link" chord (Docs, Notion, Slack, Obsidian) — the
  user mid-note who presses ⌘K expecting a link gets yanked into the
  navigation modal, losing editor focus (a designed-in focus theft that
  doctrine-6 focus rules then have to unwind). Meanwhile ⌘J — the chosen
  insert chord — must reach preventDefault before the browser (Firefox:
  downloads) and before PM's keymap swallows it.
- **Evidence:** SearchModal.tsx:80-102; plan.md §Linking 5.
- **Proposed fix:** Cheapest coherent rule: inside the note editor, ⌘K ALSO
  opens the **insert** posture (both chords land in the same modal; outside
  the editor ⌘K stays global search) — muscle memory becomes a feature and
  no focus is stolen. If Abram rejects the remap, at minimum document the
  collision and assert ⌘J's preventDefault ordering in the keymap. Either
  way the decision belongs in the plan, not the diff.

---

## Open-question input

- **Q1 (Playwright layer) — yes, emphatically; this feature is the reason.**
  Every high finding above is browser-only behavior (focus, Esc, live
  regions) — the class vitest cannot see and the class this repo's worst
  bugs (B-U1, B5, B9, B21) lived in. Name these a11y specs among the ~6
  flows:
  1. **focus-return-after-insert** — ⌘J open → pick destination → focus in
     editor, cursor restored, typed char lands at the stored position (and
     the Esc-without-insert variant).
  2. **esc-chain** — `[[` popup + modal stacked → 3 Escs unwind LIFO, 4th
     inert; on /scripture with note surface open, Esc never changes the URL
     ("never eats a chapter").
  3. **axe pass** on /notes, /notes/:id (read + edit), and the reader with
     the notes register present — light and dark themes.
  4. **noted-verse name** — accessible name of a noted verse contains "your
     note"; register `<h3>` present.
  5. **delete-confirm focus** — cancel path returns to trigger; confirm path
     lands focus on /notes h1, status region announces.
  6. **reduced-motion** — `reducedMotion: 'reduce'` context; no entrance
     animation on modal/register.
  The F12 mobile smoke should fold in assertion 1 on the touch door.
- **Q3 (soft-delete)** — soft is the a11y-friendlier default too: it makes
  an "Undo" affordance in the post-delete announcement nearly free later.
  Supports the proposed default.
- **Q4 (derived title)** — acceptable, but adopt the A11Y-6 demotion rule
  and define the empty-first-line fallback name ("Untitled note, edited
  {date}") so /notes index links never have empty accessible names.
- **Q6 (mobile compose)** — "yes, basic" is only coherent if A11Y-8 is
  resolved; "basic" must still include a touch door to formatting or an
  explicit cut of it.

## Harness gaps

- **No jsdom-reachable pin for the §5 combobox contract** — aria-attribute
  wiring (`aria-activedescendant` tracks the highlighted option; stable
  option ids under doctrine-4 appends) is unit-testable in vitest with
  jsdom + PM's test builders; don't leave it all to Playwright.
- **F4's fixture corpus tests parsing, not perception** — extend the fixture
  runner to also assert the announcement text emitted per fixture (true ref
  → announcement; non-ref → silence), so A11Y-5 can't regress separately
  from correctness.
- **F6 (XSS) fixture set should include ARIA-bearing payloads** — e.g.
  `[[ref|<span aria-hidden="true">…]]` and `aria-label` injection through
  the label grammar; the renderer's escaping must neutralize attribute
  injection, not just script.
- **No axe/automated-a11y runner exists in the repo today** — the Playwright
  layer should install `@axe-core/playwright` as part of this feature's e2e
  infra (it is the cheapest standing guard for the heading-order and
  name-computation findings above).
- **Round-trip corpus (F3) lacks an a11y-shaped case** — a note whose first
  line is a heading (the A11Y-6 duplicate-h1 case) belongs in the corpus so
  the demotion rule and the byte-round-trip invariant are pinned against
  each other.
