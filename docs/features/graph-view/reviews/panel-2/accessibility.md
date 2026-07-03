# Panel 2 — Adversarial Review: accessibility (panel-1)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| A11Y-1 | out-of-scope | Real gap, but the specific ask (SVG canvas roving-tabindex + spatial arrow-key neighbor traversal) is the aspirational graph-traversal pattern; A11Y-2's list already gives keyboard/SR users full access. |
| A11Y-2 | material | Cheap: same `getNeighborhood` data, plain markup (list/links), no new interaction model. Also the thing that makes A11Y-1/7 safely deferrable. |
| A11Y-3 | material | Plan already promises "focus trapped and restored"; repo already uses Radix Dialog/Sheet on this exact route. Reusing it is near-zero cost, not aspirational. |
| A11Y-4 | material | `aria-pressed`/`role="radiogroup"` on plain toggle buttons is trivial, ordinary widget hygiene — not graph-specific, no reason to defer. |
| A11Y-5 | risky | Real WCAG 1.4.1 concern, but legible per-type glyphs at 13-26px radius need real design/asset work; legend text is a partial mitigant already. |
| A11Y-6 | risky | WCAG 2.5.8 AA minimum is 24px; 26px diameter already clears it, so citation is overstated — fix (invisible hit-slop) is cheap but not a compliance blocker. |
| A11Y-7 | out-of-scope | Keyboard pan/zoom for a physics canvas is a heavy, novel build; purely a viewport aid duplicated by A11Y-2's non-visual list + recenter action. |
| A11Y-8 | material | Polite `aria-live` for load/truncation/degraded states is standard, cheap, and directly required by the plan's own async/degraded-mode contract. |
| A11Y-9 | material | Cheap: contrast-check a small enumerated palette (incl. 0.55-opacity variants) against `--paper` before ship; concrete WCAG 1.4.11 risk, no new interaction work. |

## Overall stance

Panel-1's dialog-hygiene and data-equivalence findings (A11Y-2, A11Y-3, A11Y-4, A11Y-8, A11Y-9) are cheap, standard, and already implied by the plan's own contract or by primitives already in use elsewhere in this codebase — these are correctly material and shouldn't be negotiated away. The two canvas-interaction findings (A11Y-1, A11Y-7) describe a real gap but prescribe research-grade spatial/physics keyboard controls for a v1 force graph; both are made moot by the cheap SR/keyboard list-equivalent (A11Y-2), so they're out-of-scope rather than blocking. A11Y-5 and A11Y-6 are legitimate but lower-leverage: A11Y-5 needs real design work beyond a v1 patch, and A11Y-6's WCAG citation is technically overstated since 26px already clears the AA target-size minimum — both downgraded to risky rather than dropped.
