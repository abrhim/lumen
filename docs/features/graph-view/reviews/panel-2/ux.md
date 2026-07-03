# Panel 2 — Adversarial UX review: graph-view

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| UX-1 | material | Confirmed in scripture.tsx: mobile Sheet mounts on `selected !== undefined` independent of `?graph`; graph button lives inside it, no mutual-exclusion exists. |
| UX-2 | risky | Missing graph loading state is real, but fix dictates exact visuals (pulsing center node, ring placeholders, radial gradient) — a design-pass call, not UX's to spec. |
| UX-3 | material | Depth control has no in-flight feedback; disable+dim is a standard interaction pattern (not a visual-design over-reach) and prevents mashing/confusion. |
| UX-4 | material | `truncated:{shown,total}` is a plan contract field with zero defined UI surface anywhere in mock or plan — genuine functional gap, fix stays generic ("e.g."). |
| UX-5 | material | Mock's hover-only recenter cue (CSS ~344-345, JSX ~567) fails touch per emil-design-engineering guidance; fix offers options, doesn't mandate one design. |
| UX-6 | noise | Re-derives Q5 (recenter push default), already an open question the plan tracks for human gate; extending it to the Read jump adds no new decision. |
| UX-7 | material | Failure modes 1-9 cover only technical failures; a legitimate `found:true` + zero-neighbor node has no defined copy — distinct, real, low-cost gap. |
| UX-8 | material | Plan adds Era/Event/Symbol/Topic types absent from mock's `TYPE_LEGEND`; plain-language legend copy is in-scope content work (plan item 5), not visual over-spec. |
| UX-9 | material | ForceLayout re-seeds from scratch each depth change (mock ~581-599) so tracked nodes jump position; seeding from prior `{x,y}` is a correctness fix, not decoration. |
| UX-10 | material | Plan says focus "trapped and restored" but not to what, across 3 real entry points (rail, chip, chapter header); storing an invoker ref is scoped and concrete. |

## Overall stance

Panel-1's findings are grounded in the actual code (scripture.tsx's Sheet mount logic, the mock's ForceLayout re-seed and hover-only CSS) rather than speculative nitpicking, so most hold up as material — UX-1, UX-9, and UX-5 in particular catch concrete bugs the plan doesn't address. UX-2 is downgraded to risky because it prescribes specific visual treatment (exact skeleton imagery) that belongs to the design pass, not this review. UX-6 is noise: it dresses up an extension of the plan's own open question (Q5, still pending human gate) as a new finding rather than surfacing anything the plan hasn't already flagged for resolution.
