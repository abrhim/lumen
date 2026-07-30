# panel-2 · api-contract — personal-notes (adversarial review of panel-1)

Every code citation was verified against the live tree. No re-litigation of
the ratified search-endpoint contract found: each finding concerns how the
NEW notes group interacts with it, and the GROUP_KEYS edit genuinely changes
the premise.

| ID | Tag | Rationale (≤25 words + evidence) |
|---|---|---|
| APIC-1 | material | Verified all three legs: search.ts:679/690 defaults scope=[...GROUP_KEYS]; buildLegs (556-585) silently skips unknown keys; parseScope message enumerates GROUP_KEYS (search-request.server.ts:40); pills map GROUP_KEYS (search.tsx:1104). Harness pin at notes-harness.test.ts:8 causes the F2 break. High-severity signed-out leak; survives carve-out regardless. |
| APIC-2 | material | Verified trap: `opts.scope?.length` falsy for `[]` → all seven canon groups (search.ts:679); route passes scope through (api.search.tsx:122-128). Unspecified semantics with a wrong obvious implementation. |
| APIC-3 | material | Spec gap real; B1/B2 precedent (bugs.md) is the cost record. Trace (b) overstated: hash binding (search.ts decodeSearchCursor) 400s organic canon cursors at scope=notes — only crafted cursors (FNV unkeyed) reach the leg. Trap (a) and the never-mints rule still need ratification. |
| APIC-4 | material | Verified: no pre-feature byte oracle in repo; meta already stripped (api.search.tsx:133); scope_unknown body WILL change bytes per APIC-1. F2 as written is unfalsifiable — the enforcement mechanism for a high-severity claim. Harness-first caveat: a pre-change structural snapshot is capturable now, which is exactly the proposed restatement. |
| APIC-5 | material | Verified: 'note' absent from ResultType (search-types.ts:24-38) — GROUP_RESULT_TYPES pin (notes-harness.test.ts:22) fails typecheck. Snippet plaintext law is producer-side (search-types.ts:70-71); route-computed snippet from body_md violates it. F6-adjacent. |
| APIC-6 | material | Verified: harness mints `/notes/new` magic segment (notes.routes.test.ts:74, makeArgs param derivation) that the plan never states; return shapes/save model genuinely unruled. 404-not-403 precedent confirmed (admin.users.tsx loader, D10). |
| APIC-7 | risky | Claims verified (login.tsx loader hard-redirects `/`, no next support; logout returnTo precedent) — but plan's Public contract already states the redirect gate, headers point is APIC-8's rule, and at single-digit DAU lost return-destination is polish. Wire `next` if cheap. |
| APIC-8 | material | Verified: B4 (bugs.md) is the identical shipped failure class; notes.routes.test.ts:26-30 builds Headers and never asserts them on any response. Five new header-bearing outcomes behind getSessionUser. Session-kill = correctness. |
| APIC-9 | material | Verified: labels containing `\|`/`]]` make F3's pinned byte-round-trip unprovable on Cmd+J selection-as-label inputs — a hole in a pinned invariant. Rename rot confirmed (migrate-entity-rename.mjs SEARCH_INDEX_COUNT_SQL informational-only) but D4 fail-closed + rare admin event make (b) a runbook note. |
| APIC-10 | risky | All four verified (short-circuit search.ts ref.shortCircuit path; B10 strip; merge-test drops empty group). Low severity by the specialist's own rating; point 4 (notes-leg failure degrades, never 500s the search) is the one line that must land. |

## Stance

This is a strong review: all ~30 line-level citations check out against the
tree, and the central finding (APIC-1) is a genuine plan-breaking defect —
the plan's own harness pin on GROUP_KEYS[0] structurally violates its own F2
signed-out contract three verified ways, with the merge fixture assuming the
problem away. My only refutation is partial: APIC-3's organic fall-through
trace is blocked by the cursor hash binding, though the underlying
unspecified-interaction claim survives on the B1/B2 record. The two risky
tags (APIC-7, APIC-10) are correct observations whose fixes are one-line
ratifications rather than gate material; nothing here re-litigates the
ratified search-endpoint decisions.
