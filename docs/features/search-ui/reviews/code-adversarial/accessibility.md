# Code-adversarial meta-review — accessibility (search-ui)

Adversarial pass over the code-panel accessibility findings. Verified every
claim against source (`apps/web/app/routes/search.tsx`, `components/SearchModal.tsx`,
`components/ui/dialog.tsx`, `components/ui/sheet.tsx`, `lib/search-request.server.ts`)
and re-probed the pivotal CSS-specificity claim live (compiled
`root--C9fu5Oc.css`, GET-only) plus the shadcn variant source. Skeptical of both
the specialist and the ratified plan.

## Tags

| ID | Tag | Rationale |
|----|-----|-----------|
| AC-1 | material | Verified: `disabled={pageFetcher.state !== "idle"}` (search.tsx:1096) on the keyboard "More" button; a focused element going `disabled` is browser-blurred to `<body>`, and `onMainKeyDown` is bound on `<main>` (:815) so ↑↓ events on body never reach it. Real keyboard-pagination focus loss; last page unmounts the button entirely (:1104). Fix (aria-busy + existing no-op guard at :770) is safe. |
| AC-2 | material | Confirmed at byte level in deployed CSS: `.motion-reduce\:animate-none{animation:none}` @59012 (inside `@media(prefers-reduced-motion:reduce)`) vs `.data-open\:animate-in:where([data-state=open])` @63524 and `.data-closed\:animate-out:where(...)` @65778. shadcn `@custom-variant data-open` uses `:where()` → variant adds 0; all three selectors are (0,1,0); later source order wins ⇒ opt-out dead, dialog still zooms / sheet still slides under reduced motion. No rescuing reduced-motion rule exists (only unrelated .shimmer/view-transition). Ratified AU-5 ("motion-safe variants") is non-functional as shipped — a defect, not a blessed deviation. |
| AC-3 | material | Verified: rows are permanently `tabIndex={-1}` (:529) with no `tabIndex=0` anchor; `autoFocus={state === "empty"}` (:832) so a q-bearing SSR load leaves focus on `<body>`, where ↑↓ never reach the `<main>`-bound handler — arrows are advertised (":↑↓ to move" hint) but dead until the user Tabs to the input. Incomplete roving pattern + advertised-dead arrows = real defect; tabindex=0 anchor fix is safe. Plan blessed `tabindex=-1` rows but not the missing entry anchor. |
| AC-4 | material | Verified residual (not a B-U2 re-flag): in the live-typed reference state (view==="reference", trimmed!==q) onSubmit skips the reference-open branch (:674 requires `trimmed === q`) → first Enter commits the search URL, only the second opens the reader, yet the hint "press Enter again to go" (:1032) shows in that state → under-counts by one. Low but real; copy-gate fix is safe. |
| AC-5 | material | Verified: words original-script `orig` renders in `<span className="ml-1.5 font-reading text-[19px]">` (:485) with no `lang`; live probe confirms Hebrew (בְּרִית, H1285) / Greek (κιβωτός, G2787) glyphs. WCAG 3.1.2 Language of Parts failure on content the feature deliberately ships; `strongs_no` H/G prefix makes the fix trivial and safe. |
| AC-6 | material | Verified residual of the B-U1 MODE (focused button hijacks Space-scroll): scope toggles / Show-all / More are `<button>`s with no pointer-aware blur (unlike the fixed orb). Chrome focuses buttons on pointer click (the documented `:focus-visible` rationale); `commitNavigate` re-renders in place without blur (:652-656) so focus persists → Space re-fires the toggle/commit. Cannot refute without a browser; premise matches known Chrome behavior and the deployment's headless-Chrome target. Pointer-scoped blur fix is safe. |
| AC-7 | material | Verified: last-included toggle sets `aria-disabled` (:923) and `toggleScope` no-ops (:688), but sr-only text still reads ", included — activate to exclude" (:942) — contradictory for SR users, no floor-of-1 feedback. Real SR-content defect; text-swap fix is safe. |
| AC-8 | material | Verified both: (a) `statusText` (:802-810) has no keepTyping branch → falls to "" while sighted users see "Keep typing…" (:997) = SR silence/parity gap; (b) a pending 350 ms `debounceRef` (:625) fires after ArrowDown-into-rows, `setLive` re-keys the list (:1049/rowKey) and can unmount the focused row → focus to body. Both real (b narrow); statusText + debounce-cancel fixes are safe. |

## Stance

**8/8 material — verdict upheld across the board.** The specialist's review is
rigorous and evidence-backed, and independent verification held on every axis:

- The pivotal AC-2 claim was re-probed at the byte level in the live compiled
  CSS and cross-checked against shadcn's `:where()`-based `data-open`/`data-closed`
  custom variants — the reduced-motion opt-out genuinely loses on source order,
  and no other reduced-motion rule rescues the modal animations.
- Every keyboard/focus/SR claim (AC-1 disabled-blur + `<main>`-scoped handler,
  AC-3 tabindex/autofocus, AC-4 live-typed Enter double-commit, AC-5 missing
  `lang`, AC-7 aria-disabled/sr-only contradiction, AC-8 statusText gap + debounce
  re-key) reproduces in the current source.

None re-flag an already-fixed B-U1/B-U2/B-U3 instance: **AC-4 and AC-6 are genuine
RESIDUAL instances** of the fixed hint-accuracy and focused-button-Space modes,
which the task's rule classes as material. None flag a blessed A1–A11 / Decisions
deviation, none touch an "Out (deliberate)" item, and each proposed fix is
pointer-scoped or additive — no fix is worse than the defect it prevents (no
risky). AC-6 is the only finding I could not fully verify (no browser in this
environment); the house rule keeps it material because its premise matches
documented Chrome button-focus behavior and I cannot refute it. Two low findings
(AC-5, AC-7) sit near the material/noise line but each is a concrete WCAG/SR-content
failure on shipped content, not style or restatement.
