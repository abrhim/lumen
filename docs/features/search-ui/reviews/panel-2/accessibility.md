# Panel-2 (adversarial) / Accessibility — search-ui plan

Reviewer verified panel-1's accessibility findings against the live mockup source
(`scratchpad/build-mockup.py`), production tokens (`apps/web/app/app.css`), the shared
Radix Dialog primitive (`components/ui/dialog.tsx`), the house aria-live + motion-safe
idioms (`admin.users.tsx`, `scripture.tsx`, `login.tsx`, `AppMenu.tsx`), the plan's
scope + failure modes, and the red-first harness. AU-1's contrast numbers were
independently reproduced (`scratchpad/contrast2.py`, WCAG relative-luminance, 60/80/100%
alpha-composite cases).

## Stance

Mostly signal. The plan is genuinely thin on accessibility: F9 pins hotkeys/Escape/Enter
but nothing on modal focus-trap, roving focus, live-region strategy, mark contrast, or
toggle state, so the specialist's six structural findings (AU-1..AU-6) each close a real
gap and verify against production tokens or the shared primitive. The three low-severity
findings (AU-7/8/9) restate conventions already shipped in adjacent code or overstate the
harm, and are tagged noise. No fix here introduces a worse regression, so nothing is risky;
everything sits on the in-scope search-ui surface, so nothing is out-of-scope.

## Tags

| ID | Tag | Rationale |
|----|-----|-----------|
| AU-1 | material | Reproduced independently (contrast2.py): 60%-alpha selbar underline = 1.85–2.67:1 in paper/parchment/linen, under the 3:1 floor, on the only visual match signal. In-scope mark rendering (plan.md:22, F12). (Note: the "≥80%" fix is still <3:1 for parchment — the "pin per-theme contrast-checked values" part is the sound fix.) |
| AU-2 | material | Verified: mockup blurs the input and never focuses the row (build-mockup.py:291), so aria-current alone is SR-silent. Plan omits any focus mechanism; mandating real roving focus is a genuine a11y requirement, not a mockup nit. |
| AU-3 | material | F9 covers Escape/Enter but no failure mode covers modal focus-trap or return-focus; Radix Dialog (dialog.tsx) provides both for free and is the house idiom (Sheet/Popover in AppMenu). Real modal-a11y gap. |
| AU-4 | material | Mockup wraps the whole #results tree in aria-live (build-mockup.py:170) and the plan says "per the approved mockup" with no live-region strategy; the house one-status-region idiom (admin.users.tsx:378, D9) prevents dozens-of-rows over-announcement on append. |
| AU-5 | material | Verified: dialog.tsx:42,64 animate-in/fade/zoom lack motion-safe:; app.css:280 reduced-motion covers only view-transitions. A Radix-based modal would ignore the OS preference, diverging from the house motion-safe convention (scripture.tsx:1302, login.tsx:94). In-scope via a SearchModal override. |
| AU-6 | material | Plan specifies exclude as "struck+faint rendering" only and F7 asserts URL round-trip only; line-through is not announced by SRs. aria-pressed + visually-hidden state text is a real, in-scope requirement the plan omits. |
| AU-7 | noise | Sibling AppMenu.tsx:145 already ships aria-label="Menu" and the plan mounts the orb "beside AppMenu"; the mockup orb sits inside an aria-hidden container (build-mockup.py:155). The label is near-automatic from the adjacent shipped convention. |
| AU-8 | noise | The 7 h2 group headings (build-mockup.py:272) already give SR users heading-based group jumping; region landmarks are a minor enhancement, not the lost capability the finding claims. Overstated impact. |
| AU-9 | noise | F9 already pins "typing / inside any input does NOT hijack" and the mockup already preventDefaults on "/" (build-mockup.py:286); isContentEditable coverage is speculative — finding itself admits no contenteditable surfaces exist in the app. Restating + future-proofing. |
