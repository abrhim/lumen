# Panel-2 Adversarial — ux-a11y (art-graph)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| UX-1 | material | Overlapping unlabeled images risk broken tab stops for anyone using keyboard/AT; single-button + `aria-hidden` cards is a cheap correctness fix, not a nicety. |
| UX-2 | risky | Mostly subsumed by UX-1's single-button target; exact 44px WCAG minimum matters less for one known user, but still worth a build-time size check. |
| UX-3 | risky | Contingent, not present: plan specifies no animation at all, so the reduced-motion gate only applies if a fan/expand transform gets added later. |
| UX-4 | material | Missing `aspect-ratio` reservation risks real CLS and DOM/visual tab-order mismatch on image load, independent of masonry vs grid choice; cheap to spec now. |
| UX-5 | material | Confirmed in code: `?verse=` drives the existing scroll-restore effect (`scripture.tsx` selectedVerse hook); a bare-URL breadcrumb link silently drops it — concrete regression. |
| UX-6 | noise | Speculative header-density claim with no concrete evidence; Q1's default 3-card compact stack already bounds the height risk it worries about. |
| UX-7 | noise | Moot given task framing: the sole user explicitly requested the stack-behind-click trade-off, so no fresh "accept the regression" step is needed. |

**Stance:** UX-1, UX-4, and UX-5 are material because they produce concrete, observable defects — broken tab order, layout shift, and a verified loss of reading position via the `?verse=` param — that degrade the experience for the app's actual (single) user, not just hypothetical ones, and are cheap to fix now. UX-2 and UX-3 are real-but-contingent (largely covered by UX-1's fix, or not yet triggered since no animation exists), and UX-6/UX-7 are noise: UX-6 has no concrete grounding against the plan's compact-stack default, and UX-7 asks the plan to "accept" a trade-off the user already chose on purpose.
