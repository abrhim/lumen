# Panel-2 (adversarial) — UX review of Panel-1/ux

Lens: I re-derived every finding against the PLAN text + shipped code, not against
`build-mockup.py` — that file is **absent from the worktree and all git history**, so
panel-1's line citations into it (`:271-280`, `:84-90`, `:166`, `:180-182`, etc.) are
unverifiable. I confirmed the codebase-precedent citations that carry weight: AppMenu.tsx:149-150
(44px "Emil touch rule") + its isMobile Sheet/Popover split (156-176), and media.tsx:810-853
(isMobile mount-gated Sheet) are all accurate. searchAll's missing q-floor and api.search.tsx's
Q_MIN=2 gate are verified in source.

## Stance
Mostly signal. Seven of nine catch genuine unspecified user-facing states or precedent-backed
design gaps on a public, pre-implementation surface — exactly what plan review should surface,
and consistent with this plan's own harness-first "pin the state" standard. Two (UU-3, UU-8)
restate behavior the plan/harness already specifies or that is routine implementation hygiene.

| ID | Tag | Rationale |
|----|-----|-----------|
| UU-1 | material | Plan is silent on the "More in X" truncation threshold; a group can return < limit (non-truncated), so a `>=N`-count rule fires a dead CTA. Fix (`length === limitPerGroup`) is sound. |
| UU-2 | material | Bare `/search` is reachable; plan lists only "zero state" (plan.md:23), conflating empty-query with zero-results, and no harness pins rendered copy. Dead page violates the anti-bounce brief (plan.md:17). |
| UU-3 | noise | plan.md:25 already specifies "struck+faint rendering" + `?scope=` persistence; F7 (plan.md:53) pins round-trip; Q5 (plan.md:70) keeps groups struck-in-place → each is one-click restorable. "Restore-all" is a minor add. |
| UU-4 | material | Typing model on `/search` (client debounce-fetch vs Enter-navigate) is unspecified in Scope/F-modes/Q1-Q5; pagination already adds a client-fetch path, so both are viable and must be chosen. |
| UU-5 | material | Verified: app's interactive chrome is uniformly isMobile-gated Sheet (AppMenu.tsx:156-176, media.tsx:810-853); plan's single centered modal has no mobile treatment, reads as generic AI-UX (binding memory). |
| UU-6 | material | Verified 44px hit-box precedent (AppMenu.tsx:149-150); the feature's signature "cull" gesture is small text with no touch-target spec — a real mobile-usability miss on a public surface. |
| UU-7 | material | Persistent kbd hint conflicts with the binding "zero workspace chrome" brief (plan.md:17); on touch (no physical `/`/`⌘K`) it is plainly wrong. Concrete, correct touch-gate refinement. |
| UU-8 | noise | F5 (plan.md:26) + cursor harness (search-cursor-harness.test.ts:58-67) already pin "empty page never yields nextCursor"; stopping on an empty fetch is routine pagination hygiene. "That's everything" copy is polish. |
| UU-9 | material | Verified: searchAll (search.ts:530-542) runs buildLegs unconditionally — no q-floor; Q4 loader bypasses api.search.tsx's Q_MIN=2 gate (api.search.tsx:47-49). Real behavioral split + undefined sub-min state. |

## Notes on tags I withheld
- **No risky tags.** UU-5's fix could plausibly regress via iOS-Safari keyboard overlap in a
  bottom Sheet wrapping a focused input, but I cannot verify iOS behavior in this environment;
  house rule forbids a risky tag on unverified speculation, so it stays material.
- **No out-of-scope tags.** None of the findings target the plan's deferred list (history,
  analytics UI, semantic, rate-limiting/abuse, MCP, in-episode search, admin, ranking/snippets).
  UU-9 is input validation (in scope), not abuse hardening (out).
