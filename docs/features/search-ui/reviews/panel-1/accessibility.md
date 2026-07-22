# Panel-1 / Accessibility review — search-ui plan

Reviewed: `docs/features/search-ui/plan.md` (plan under review), harness (`search.loader.test.ts`,
`api-search-cursor.test.ts`, `search-cursor-harness.test.ts`), shipped `api.search.tsx` /
`search.ts`, design-language references (`scripture.tsx`, `media.tsx`, `AppMenu.tsx`, `root.tsx`),
and the approved mockup build source (`build-mockup.py`). Lens: keyboard + screen reader.

## Findings

| ID | Severity | Where | Problem | Fix |
|----|----------|-------|---------|-----|
| AU-1 | high | `build-mockup.py:128-130` (mark CSS) + `apps/web/app/app.css:56-67` (parchment `--t-selbar`/`--t-sel`); plan.md:22 "selbar-underline marks" | Selbar-underline search-hit mark at the specified 60% opacity computes 1.85–2.67:1 contrast in paper/parchment/linen themes — under the 3:1 non-text minimum (ink theme borderline at 3.04–3.55:1). | Raise decoration alpha to ≥80% or use a solid selbar color/thicker stroke; pin per-theme contrast-checked values and add a computed-contrast assertion beside F12. |
| AU-2 | high | `build-mockup.py:285-296` (arrow-key handler) + plan.md Scope "Keyboard nav" bullet; `search.loader.test.ts:4-6` defers F11 to e2e-smoke | Arrow-key row "selection" toggles `aria-current` + CSS only, never moves real DOM focus (`input.blur()`, no `row.focus()`) — invisible to screen readers; F11 remains unit-untested. | Mandate real roving focus (`row.focus()`, `tabindex=-1` on inactive rows) as a pinned F11 assertion before implementation, not deferred to e2e-smoke. |
| AU-3 | high | plan.md Scope "Global entry" bullet + Failure modes F9; `apps/web/app/components/ui/dialog.tsx` (existing accessible primitive, absent from Files touched) | No failure mode covers modal focus-trap or return-focus-on-close (Escape→orb, Enter-navigate→page); plan never pins SearchModal to the existing accessible Radix Dialog primitive. | Build `SearchModal.tsx` on `ui/dialog.tsx` (Radix Dialog, already used via Sheet/Popover in AppMenu) and add an explicit focus-trap + return-focus failure mode to F9. |
| AU-4 | high | `build-mockup.py:170` (`<div id="results" aria-live="polite">`) + mockup note lines 180-182 (live-as-you-type); no F# in plan.md governs live-region strategy | Plan defines no live-region strategy; the approved mockup wraps the entire result tree in `aria-live="polite"`, so every keystroke/append re-announces dozens of full rows. | Adopt the codebase's own "one aria-live region" idiom (`admin.users.tsx:378-392`, D9): a small status region for counts/append deltas only, with the result list itself outside `aria-live`. |
| AU-5 | med | `apps/web/app/components/ui/dialog.tsx:42,64` (`data-open:animate-in`/`fade-in-0`/`zoom-in-95`, no `motion-safe:` prefix) vs `scripture.tsx:1536` and `app.css:280` (reduced-motion covers only view-transitions) | Shared Dialog primitive's open/close animation lacks the `motion-safe:` prefix used elsewhere in the codebase; global reduced-motion CSS only covers view-transitions, so modal open ignores the OS preference. | Add `motion-safe:` variants to the modal's animate-in classes (globally or via a SearchModal override); add a reduced-motion failure mode for modal open, not just infinite scroll. |
| AU-6 | med | plan.md Scope "Faceting" bullet ("struck+faint rendering"); F7 (URL round-trip only, no state-exposure assertion) | Scope-exclude toggle is specified only as visual strikethrough+faint styling; `text-decoration:line-through` isn't announced by default, and F7 only checks URL round-trip. | Implement exclude as `button[aria-pressed]` with visually-hidden excluded/included state text; add a failure-mode assertion on the accessible name/state, not just the URL. |
| AU-7 | low | `build-mockup.py:156` (`title="Search (/ or ⌘K)"`, no `aria-label`) vs `AppMenu.tsx:148` (`aria-label="Menu"` precedent) | Mockup's search-orb markup uses `title` only, no `aria-label`, unlike AppMenu.tsx's shipped trigger; plan doesn't pin the new orb to that convention. | Require `aria-label` on the new search orb (`title` as a supplementary tooltip only), matching AppMenu's existing icon-button pattern. |
| AU-8 | low | `build-mockup.py:271-280` (`<section id="g-${g.key}"><h2 class="ghead">`, no `aria-labelledby`) | Each result group's `<section>` contains an `h2` but no `aria-labelledby`, so it never surfaces as a named region landmark for screen-reader group-jumping. | Add `aria-labelledby` on each `<section>` pointing at its `h2` id (or `aria-label`) so the 7 groups become jumpable landmarks. |
| AU-9 | low | plan.md F9 ("typing `/` inside any input does NOT hijack"); `build-mockup.py:286-287` (`document.activeElement!==input` check only) | F9's input guard is worded tag-based only; doesn't pin `isContentEditable`/`role=textbox` coverage or explicit `preventDefault()` to suppress Firefox's native "/" quick-find. | Pin F9's guard predicate to include `isContentEditable`/textbox roles and require `preventDefault()` on the global "/" handler. |

## Evidence

**AU-1 (mark contrast).** `apps/web/app/app.css` confirms the mockup's palette is the real
production token set: parchment `--t-selbar: #b07d2b` (line 66), `--t-sel: #f6e9c8` (line 65),
`--t-paper: #f3ede1` (line 57) — matching `build-mockup.py`'s demo values exactly. The mark CSS
(`build-mockup.py:128-130`) sets `text-decoration-color:color-mix(in srgb,var(--selbar) 60%,transparent)`.
Computed WCAG contrast (relative-luminance formula) of the resulting **60%-alpha-composited**
selbar against each theme's paper/sel background:

```
paper      underline(60% selbar) vs paper: 2.67:1   vs sel: 2.56:1
parchment  underline(60% selbar) vs paper: 1.89:1   vs sel: 1.85:1
linen      underline(60% selbar) vs paper: 2.46:1   vs sel: 2.34:1
ink        underline(60% selbar) vs paper: 3.55:1   vs sel: 3.04:1
```
(script: `/private/tmp/claude-501/-Users-abram-code-lumen/e08e0036-b9be-449d-a5f0-35fab2f84789/scratchpad/contrast.py`,
extended inline for the 60%-blend case.) All three light themes fail the 3:1 non-text-contrast
floor by a wide margin; ink is marginal. Since this is the *only* visual signal (besides the
`<mark>` semantic tag itself) that shows a sighted, non-screen-reader low-vision user *why* a
result matched, the near-invisible underline defeats the mark's purpose in 3 of 4 themes. This is
one of the mockup's called-out "human-approved visual decisions," but the review brief's own lens
item ("mark contrast — selbar underline at AA on all four themes — probe hexes") anticipated
exactly this failure; the plan should not treat the visual as final without a contrast pass.

**AU-2 (roving selection / tab order).** `build-mockup.py:285-296`:
```js
if(e.key==="ArrowDown"||e.key==="ArrowUp"){
  e.preventDefault(); input.blur();
  const nxt=e.key==="ArrowDown"?Math.min(cur+1,rows.length-1):Math.max(cur-1,0);
  rows.forEach(r=>r.removeAttribute("aria-current"));
  rows[nxt].setAttribute("aria-current","true");
  rows[nxt].scrollIntoView({block:"nearest",behavior:"smooth"});
}
```
`input.blur()` removes focus from the search input but nothing ever calls `.focus()` on the
newly-"selected" row — real DOM focus lands on `<body>` (nowhere), so the highlight is purely
visual/CSS (`row[aria-current="true"]{background:var(--sel)}`, line 118). A screen reader user has
no way to perceive which row is "selected": `aria-current` on an unfocused element is not
announced proactively. Separately, rows are real `<a>` elements individually in normal Tab order
(`.rows` is a plain `<ol>` of anchors — grep confirms no `role="listbox"`/`aria-selected` anywhere
in `apps/web/app`), so at the plan's own adaptive-limit ceiling (7 groups × up to 25/group) a user
tabbing instead of arrow-keying could face on the order of 100+ stops. `search.loader.test.ts:1-6`
explicitly notes F11 ("selection-across-append") is "e2e-smoke" and "not unit-mocked here," so this
mechanism has no unit-level pin at all going into implementation.

**AU-3 (modal focus trap / return focus).** plan.md's only modal-behavior spec is the Scope bullet
("minimal modal (input only, Enter → navigate `/search?q=`, Escape closes...)") and F9
("`/` and `⌘K` open anywhere; Enter navigates...; Escape closes; typing `/` inside any input does
NOT hijack; on `/search` itself hotkeys focus the inline input"). Neither mentions focus trapping
inside the open modal nor restoring focus to the invoking orb after Escape (or to the `/search`
page's primary input after an Enter-navigate close). `apps/web/app/components/ui/dialog.tsx`
already wraps Radix's `Dialog` primitive, which provides both behaviors for free and is the pattern
already established via `Popover`/`Sheet` in `AppMenu.tsx`. Plan's "Files touched" list
(`SearchModal.tsx` + `search-hotkeys.tsx` or `root.tsx` wiring) never references `ui/dialog.tsx`,
leaving open the possibility of a hand-rolled modal without trap/return semantics.

**AU-4 (aria-live scope).** `build-mockup.py:170`: `<div id="results" aria-live="polite">` wraps
the single mount point that `render()` (line 250) replaces wholesale via `out.innerHTML = ...` on
every keystroke (debounced 160ms, line 284) and, by extension, would wrap paginated appends too.
The mockup's own on-page note (lines 180-182) states: "In the app, results stream live at ~250 ms
as you type" — i.e., this is described as the real production behavior, not just a demo
convenience. A literal port announces every group header, row, and snippet to screen readers on
every keystroke. Contrast with the codebase's existing pattern at `admin.users.tsx:378-392`,
explicitly commented "fixed-height count bar = the ONE aria-live region (D9)" — a small
`role="status" aria-live="polite"` div holding only a count string, with the actual results table
outside any live region. `scripture.tsx:1534-1536` similarly scopes `aria-live` to a small
late-arriving block, not an entire content tree. plan.md's Failure-modes list (F1–F14) has no entry
governing live-region behavior at all.

**AU-5 (modal reduced motion).** `apps/web/app/components/ui/dialog.tsx:42`:
`"fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"`
and line 64: `"...data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"`
— neither uses the `motion-safe:` prefix. Compare `scripture.tsx:1302,1335,1536` and
`login.tsx:94`, which all gate identical `animate-in`/`fade-in`/`slide-in-from-*` utilities behind
`motion-safe:`. `apps/web/app/app.css:280-286` is the only global `prefers-reduced-motion` rule in
the stylesheet and it targets `::view-transition-*` only — it does not blanket-disable Tailwind's
`animate-in` utilities. So if `SearchModal.tsx` uses `DialogContent`/`DialogOverlay` as shipped,
the modal's fade/zoom-in plays regardless of the reduced-motion preference. Plan's reduced-motion
coverage is scoped only to infinite scroll ("Infinite scroll via sentinel + ... More button
fallback (reduced-motion / keyboard / no-JS-observer path)"); nothing covers the modal's own
mount/dismiss animation.

**AU-6 (scope-exclude accessible state).** plan.md Scope: "scope-line click = toggle-exclude
(struck+faint rendering, URL `?scope=` persistence)." F7: "scope exclusion round-trips the URL and
survives a subsequent query edit" — URL-level only. `text-decoration: line-through` (or a color/
opacity change) is a purely visual cue; VoiceOver/NVDA do not announce strikethrough by default
outside of explicit `<s>`/`<del>` semantics or textual state. There is no plan language requiring
`aria-pressed`, a visually-hidden state label, or any other AT-perceivable signal for
included/excluded scope.

**AU-7 (icon-only orb label).** `build-mockup.py:156`:
`<button class="orb" title="Search (/ or ⌘K)">...` — `title`-only, no `aria-label`. Compare the
real, shipped `AppMenu.tsx:145-153` trigger: `aria-label="Menu"` (no reliance on `title`). `title`
attributes are inconsistently exposed to screen readers (many SRs need explicit "read title"
settings) and never fire on touch without a long-press. Plan's Scope bullet ("Global entry: search
orb beside AppMenu") gives no accessible-name requirement for the new orb.

**AU-8 (section landmark labelling).** `build-mockup.py:271-280`:
```js
out.innerHTML = nonEmpty.map(g=>`<section id="g-${g.key}">
  <h2 class="ghead"> ... <span class="glabel">${LABELS[g.key]}</span> ... </h2>
  <ol class="rows">...</ol>
```
No `aria-labelledby="..."` (or `aria-label`) ties the `<section>` to its heading. Per the HTML-AAM
mapping, a bare `<section>` without an accessible name does not expose an accessible `region` role
— it's an unnamed group, so screen-reader users lose landmark-based jump navigation between the 7
result groups that sighted users get for free from the Fraunces section headers (a design element
explicitly called out as approved).

**AU-9 (hotkey guard predicate).** plan.md F9: "typing `/` inside any input does NOT hijack."
`build-mockup.py:286-287`: `if(e.key==="/" && document.activeElement!==input){...}` — checks
against one specific known input element, not a general `INPUT`/`TEXTAREA`/`isContentEditable`
predicate, and the real app will have more than one focusable text field on the page (e.g. the
inline `/search` input plus any future field). Low current risk (grep found no
`contenteditable`/rich-text surfaces in `apps/web/app`), but the plan doesn't pin the guard's exact
predicate or require `preventDefault()` specifically to suppress Firefox's native "/" quick-find,
leaving both to implementer discretion.
