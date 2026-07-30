# Panel-2 adversarial — accessibility (personal-notes)

Verification performed: every code cite re-checked against SearchModal.tsx,
scripture.tsx, search.tsx, app.css, bugs.md; greps re-run (zero
combobox/listbox/activedescendant hits in apps/web; no escape-registry
symbols; no axe or Playwright in any package.json). All of panel-1's
evidence claims are accurate. PM defaults reasoned from the library:
prosemirror-view renders a bare contenteditable div (no role, no
aria-multiline, no name); `undoInputRule` ships in prosemirror-inputrules
but is unbound unless the setup binds it (plan uses raw first-party
modules, not exampleSetup).

| ID | Tag | Rationale (≤25 words + evidence) |
|---|---|---|
| A11Y-1 | material | Verified: SearchModal.tsx:157-171 is one bare input, Enter→/search; zero combobox/listbox/activedescendant in apps/web. "Reused" hides building the entire §5 picker contract. |
| A11Y-2 | material | Verified: pointer-blur pattern (SearchModal.tsx:188-194) blurs to body — strands editor users. Selection-as-label (plan §Linking 5) requires selection survival anyway; B-U1/B5/B9/B21 class. |
| A11Y-3 | material | Verified: no escape-registry symbols in apps/web, yet plan §Linking 5 cites "per escape registry" — a dependency on nonexistent code. Doctrine 6 is binding; enumeration belongs at gate. |
| A11Y-4 | material | Verified: both dot surfaces `aria-hidden` (scripture.tsx:973, :988); §6a.1 carrier is presence-only. User's own actionable data invisible to SR; 1.1.1/1.4.1 below floor. Ring-form detail is optional design. |
| A11Y-5 | risky | undoInputRule binding is load-bearing (raw PM leaves it unbound). But per-fire announcements ("Linked to… Backspace to undo") on a scripture-notes app risk live-region chatter beyond AA; announcement text needs restraint at gate. |
| A11Y-6 | material | Verified reasoning: prosemirror-view renders a role-less contenteditable div — unlabeled editable region fails 4.1.2. Demotion rule cheap; schema h1 + page h1 duplicate confirmed from plan Q4+D4. |
| A11Y-7 | material | 1.4.1 core is real: wikilinks are the note body's only controls; plan specs no non-color affordance, and F5 "styled plain text" could retain link styling. The aria-label destination suffix is optional polish, not floor. |
| A11Y-8 | material | Objective plan contradiction: F12 pins "type, **bold**, insert link, save" on iOS; plan builds no formatting affordance and raw PM wires no native-callout path. Doctrine 11. Gate must build or cut. |
| A11Y-9 | material | Plan specs soft-delete (Q3) with no confirm surface; B5 documents the exact focus-to-body outcome. Proposed fix is all existing house idioms (AlertDialog, h1-focus, e.detail guard) — no over-engineering. |
| A11Y-10 | material | Doctrine 12 names reduced-motion inside the posture-independent AA floor; B14 (verified FIXED via motion-safe) proves the default shadcn path ships broken. One checklist line prevents a documented regression class. |
| A11Y-11 | out-of-scope | Verified: ⌘K opens everywhere (SearchModal.tsx:82-88). Real collision, but remapping SU-6's ratified chord is product design, not an AA floor issue; ⌘J preventDefault ordering is implementation hygiene. |

## Stance

This is an unusually well-grounded review: every line-number cite, grep
claim, and bug reference checked out on re-verification, and the PM-defaults
reasoning (role-less contenteditable, unbound undoInputRule) is correct for
the raw-modules constraint the plan rules in. The material findings are
material because the plan pins flows it doesn't build (F12 bold, escape
registry, "SearchModal reused") or inherits aria-hidden/color-only patterns
that were ratified for ambient canon hints but break on personal actionable
data — actual below-AA ship paths, not AAA ceremony. The two demotions are
where the fixes outrun the floor: A11Y-5's per-transformation announcements
court live-region chatter (keep the undo binding, ration the announcing),
and A11Y-11 re-litigates a ratified product decision under an a11y banner.
