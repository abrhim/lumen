# Code-panel review — accessibility (search-ui, diff f352bae..46d888d, prod fd093ed4)

Reviewer lens: roving focus, aria-pressed scope toggles, status live-region, modal
focus-trap + B-U1 return-focus, mark contrast as shipped, reduced-motion, Enter-hint
gating post-B-U2. Live prod probed read-only (compiled CSS + one API GET).

## Bug-fix verification (B-U1 / B-U2)

- **B-U1 HOLDS.** `SearchModal.tsx:80-82` sets `openedByPointer` only on `pointerdown`;
  keyboard activation of the orb (Enter/Space → click, no pointerdown) and both hotkeys
  (`:43`, `:58` set it `false`) take the default Radix return-focus path. Pointer opens
  preventDefault + blur in `onCloseAutoFocus` (`:112-118`, `:133-139`) and reset the flag.
  Keyboard opens still return focus to the trigger. Residual instances of the same MODE
  found elsewhere → AC-6.
- **B-U2 HOLDS.** `isShortCircuitReference` (search.tsx:178-180) gates both the state
  machine (`:254`, `:631`) and the Enter hint (`:955`); book/volume references render the
  lead block above full groups (`:936`). Residual hint-accuracy gap in the live-typed
  path → AC-4.

## Findings

| ID | Sev | Where | Problem | Fix |
|----|-----|-------|---------|-----|
| AC-1 | high | search.tsx:1012-1033 | Keyboard "More" loses focus every page: click → `disabled={pageFetcher.state !== "idle"}` (:1021) blurs the focused button to `<body>`; on the final page the button unmounts (→ "That's everything", :1029). With focus on body, the roving `onMainKeyDown` (on `<main>`, :800) never fires — ↑↓ dead, user re-Tabs from document top through orb/menu/input/toggles each page. Defeats the plan's ratified keyboard pagination path (":1014 the button IS the keyboard path", F22/AU-2). | Don't disable while loading (use `aria-busy` + no-op guard, which `loadMoreRef` already has); on last page move focus to "That's everything" (`tabIndex={-1}` + `.focus()`) or the last appended row. |
| AC-2 | med | SearchModal.tsx:111,132 + ui/dialog.tsx:42,64 + ui/sheet.tsx:38,63 | `motion-reduce:animate-none` is a dead rule against the Radix open/close animations: in the deployed CSS (`root--C9fu5Oc.css`) `.motion-reduce\:animate-none{animation:none}` sits at byte 59012 but `.data-open\:animate-in:where([data-state=open]){animation:enter…}` at 63524 and `.data-closed\:animate-out` at 65778 — `:where()` zeroes the variant's specificity, both selectors are (0,1,0), later rule wins. Under `prefers-reduced-motion: reduce` the dialog still zooms (`zoom-in-95`) and the sheet still slides (`slide-in-from-bottom-10`). Ratified AU-5 ("motion-safe animation variants") is non-functional as shipped. MODE: `motion-reduce:animate-none` works only against base-utility animations (skeleton `animate-pulse` @16572 — earlier, so that one works); it always loses to variant-prefixed animation utilities. | In dialog.tsx/sheet.tsx use `motion-safe:data-open:animate-in` (etc.) per AU-5's own wording, or add an app.css `@media (prefers-reduced-motion: reduce)` override targeting `[data-slot=dialog-content]`/`[data-slot=sheet-content]`. |
| AC-3 | med | search.tsx:527, 714-730 | Roving tabindex has no tab-stop anchor: every row is permanently `tabIndex={-1}`, so results are unreachable by Tab (Tab goes input → 7 scope toggles → "More in X" pills, skipping all rows), and ↑↓ only works while focus is already inside `<main>` — on a fresh SSR load (no autofocus when q present, :817) focus is on `<body>` and arrows do nothing. Tabbing away from a focused row also discards the roving position. The standard roving pattern keeps the active row at `tabindex=0`. | Give the active (or first) row `tabIndex={0}` (state-tracked), rest `-1`; optionally listen for ↑↓ at document level when focus is on body. |
| AC-4 | low | search.tsx:955-959 vs :662-665 | Live-typed reference (e.g. typing "1 nephi 3:7" without committing): hint says "press Enter again to go" but the onSubmit reader-gate requires `trimmed === q`, so Enter #1 commits the URL navigation and only Enter #2 opens the reader — the hint under-counts by one. The SR status (:794) announces "Reference — X" with no equivalent affordance info. B-U2's gating itself is correct; this is the residual hint-accuracy instance of the mode. | Gate the "press Enter again" copy on `trimmed === q` (else "Enter to search, Enter again to open"), or let onSubmit go straight to the reference when `view === "reference"` regardless of commit state. |
| AC-5 | low | search.tsx:483 | Words-group original script (live probe: `be.rit בְּרִית` H1285, `kibōtos κιβωτός` G2787) renders in a span with no `lang` attribute — WCAG 3.1.2 Language of Parts; screen readers hit Hebrew/Greek glyphs with the page language. The H/G prefix of `payload.strongs_no` is right there to derive it. | `lang={strongs_no.startsWith("H") ? "he" : "grc"}` (+ `dir="rtl"` for Hebrew) on the original-script span. |
| AC-6 | low | search.tsx:845-869, 875-881, 1018-1025 | Residual B-U1 MODE: scope toggles / "Show all" / "More" are `<button>`s that stay focused after a pointer click (Chrome focuses buttons on mousedown; the commit navigation re-renders in place, keeping DOM focus) — Space-to-scroll then re-fires the toggle and commits a navigation, the exact Space-hijack B-U1 fixed on the orb. | Same treatment as the orb: blur on pointer-driven activation (`onPointerDown` flag + `blur()` after commit), or `onMouseDown={e => e.preventDefault()}` on these buttons. |
| AC-7 | low | search.tsx:848, 866-868 | Last-included scope toggle: `aria-disabled` is set, but the sr-only text still instructs ", included — activate to exclude" and activation silently no-ops (:675) — contradictory instruction, no feedback for SR users on the floor-of-1 rule. | Swap sr-only text when `lastIncluded`: ", included — at least one group must stay included". |
| AC-8 | low | search.tsx:787-795, 922-926 | The status live-region never announces the keepTyping state (`statusText` falls through to `""`): an SR user whose query drops below Q_MIN gets silence while sighted users see "Keep typing…". Also a narrow focus-loss window: a pending 350 ms debounce fired after ArrowDown into rows re-keys the list (:586-589, :1006-1008) and can unmount the focused row → focus to body. | Add `view === "keepTyping" ? "Keep typing — at least N characters" : …` to statusText; cancel the pending debounce when roving focus enters the rows. |

## Verified non-findings

- **Mark contrast (AU-1/F21) — CONFIRMED as shipped.** `MARK_CLASS` decoration
  `color-mix(in srgb, var(--t-selbar) 85%, var(--t-ink))` recomputed from app.css hexes:
  paper `#3b5296` 7.09:1 / 6.50:1, parchment `#9c7029` 3.78:1 / 3.65:1, linen `#216681`
  5.89:1 / 5.35:1, ink `#d7ac61` 8.42:1 / 6.25:1 (vs paper / bg-sel). All ≥3:1; the
  source-comment ratios (search.tsx:98-106) are byte-accurate. Mark also carries
  non-color cues (underline + font-medium).
- **ONE live region (AU-4) — CONFIRMED.** Exactly one `aria-live` in the SSR'd prod
  HTML (`role="status" aria-live="polite"`, fixed `h-5`); result list never live;
  "Searching…" gated behind the 300 ms `busySlow` timer so per-keystroke spam doesn't
  occur (350 ms debounce + only-on-slow).
- **Modal focus-trap / stacking (F9/AU-3)** — house Radix Dialog/Sheet; hotkey listener
  stands down on `/search` (SearchModal.tsx:38); `/` suppressed in editable targets both
  sides; sheet keeps its visible close button, desktop dialog is Esc/overlay-dismissible
  with sr-only DialogTitle.
- **No `scroll-behavior: smooth`** in compiled CSS → roving `scrollIntoView` (:729) is
  instant, no reduced-motion exposure. `motion-safe:group-hover:translate-x-0.5` (:950)
  compiles correctly (only rule for that property).
- **F11 append-selection survival** — stable `rowKey` (episode_id#t_start_s for moments)
  preserves the focused row's DOM node across appends; dedupe keys match rowKey.

## Evidence

```
# Contrast (node, WCAG relative luminance, color-mix in srgb 85/15):
paper     mixed #3b5296  vs paper 7.09  vs sel 6.50
parchment mixed #9c7029  vs paper 3.78  vs sel 3.65
linen     mixed #216681  vs paper 5.89  vs sel 5.35
ink       mixed #d7ac61  vs paper 8.42  vs sel 6.25

# Deployed CSS (https://lumen.abramhimmer.workers.dev/assets/root--C9fu5Oc.css, 85934 B):
.animate-pulse{                          index 16572   (base — loses to 59012: skeleton OK)
.motion-reduce\:animate-none{animation:none}   index 59012
.data-open\:animate-in:where([data-state=open])…{animation:enter…}   index 63524  ← wins
.data-closed\:animate-out:where([data-state=closed])…{animation:exit…} index 65778 ← wins
(shadcn/dist/tailwind.css:28-41 defines data-open/data-closed via :where() → specificity
(0,1,0) each; equal specificity, later source order wins ⇒ reduced-motion opt-out dead
for Radix open/close animations.)

# Live words probe (GET /api/search?q=covenant&scope=words&limit=3):
{"title":"be.rit בְּרִית","strongs":"H1285","snippet":"⟪covenant⟫"}
{"title":"kibōtos κιβωτός","strongs":"G2787","snippet":"⟪covenant⟫"}
{"title":"diatithēmi διατίθημι","strongs":"G1303","snippet":"make a ⟪covenant⟫"}

# SSR /search (prod): exactly 1 aria-live region —
role="status" aria-live="polite" class="mt-3 flex h-5 items-center font-ui text-xs tabular-nums text-faint"
```
