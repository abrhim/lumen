# Panel-2 Adversarial Review — ux (web-app-wiring)

Reviewed against `plan.md` public contract, scope line ("styling polish beyond
readable Tailwind" is explicitly Out), Q3 human-gate decision (SSR reload, no
client JS, accepted default: yes), and current `root.tsx` (confirms generic
404 boundary, `<main>` pattern already used in error boundary only).

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| UX-1 | risky | Scroll loss is inherent to the Q3-approved SSR-reload design, not an omission; fragment/anchor-scroll fix fights `ScrollRestoration` already in root.tsx. |
| UX-2 | material | Contract never states how a user leaves the panel; a plain link back to the chapter URL is trivial and clearly in-scope (routing, not visual). |
| UX-3 | material | Prev/next links are a core reading affordance missing from the public contract entirely; cheap, non-visual, blocks basic sequential reading. |
| UX-4 | risky | Degraded-state trust concern is legitimate, but mandating exact placement ("not a banner") prescribes layout before any layout exists. |
| UX-5 | out-of-scope | No-client-JS architecture already forces real anchors (keyboard-reachable by construction); `:focus-visible` styling is exactly the deferred design pass. |
| UX-6 | material | Heading/landmark structure is semantic HTML, not visual polish; root.tsx's own error boundary already sets an (inconsistent) `<main>` precedent worth aligning. |
| UX-7 | out-of-scope | `max-w-prose` is a Tailwind width/visual constraint — explicitly the "styling polish beyond readable Tailwind" the plan defers to the design pass. |
| UX-8 | noise | Panel-1 itself flags this low/non-blocking/optional; no real harm identified, self-admittedly not worth fixing now. |
| UX-9 | risky | Plan's contract already lists "source" as a rendered field; plain-text is the obvious default rendering, so the finding mostly restates the given. |
| UX-10 | material | root.tsx confirmed generic, no links anywhere in any state; adding a link to `/` is trivial, high-value, and clearly in-scope. |

## Overall stance

Panel-1 did solid work but leaned toward re-litigating an already-approved
architectural choice (UX-1, Q3) and pre-specifying layout/visual details
(UX-4, UX-5, UX-7, UX-9) that belong to the deferred design pass or don't
survive contact with the "no client JS, plain Tailwind" constraints already
in the plan. The four `material` items (UX-2, UX-3, UX-6, UX-10) are cheap,
non-visual, and genuinely missing from the public contract — worth fixing
before ship. UX-8 is correctly disposable. Net: tighten the plan's contract
on navigation/dismissal/landmarks/404, but don't let this review re-open the
SSR-reload/no-JS decision or smuggle in styling requirements under a UX
label.
