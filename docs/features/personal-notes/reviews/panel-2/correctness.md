# Panel-2 adversarial review — correctness (personal-notes)

Verification performed: re-probed lumen.entities read-only (helaman-2/jeremiah-3/
mormon-1/matthew-1 = person; joel-1..3 = chapter, joel-4..11 = person — all
confirmed live 2026-07-30); traced slug-map.ts, search-request.server.ts,
api.search.tsx, search.tsx, search-types.ts, smoke-notes-rls.mjs:53, and all
cited harness lines. prosemirror-markdown/markdown-it are NOT installed
(node_modules + .pnpm checked), so COR-1/COR-2 library claims were traced
against the libraries' documented serializer/parser contracts, not executed.

| ID | Tag | Rationale (≤25 words + evidence pointer) |
|----|-----|------------------------------------------|
| COR-1 | material | `![alt]` containment test contradicts any correctly-escaping serializer; escape class unfixable. Bullet/newline classes are config-fixable, so "unachievable" is overstated — reframe stands. notes-markdown.test.ts:10,13,35 |
| COR-2 | material | MarkdownParser's documented throw-on-unhandled-token + plan's silence on editor-side rule disabling (plan.md D4 names renderer only). Paste with backtick/indent crashes. plan.md:112-114 |
| COR-3 | material | Every live-DB claim re-verified independently: helaman-2/jeremiah-3 persons, joel-4..11 persons, joel-1..3 chapters; 'helaman'→'hel' alias slug-map.ts:79. Collision set zero under proposed fix confirmed. |
| COR-4 | material | D2 puts deleted_at on notes only; D5 anchor fetch has no liveness filter; only getNote→null pinned (notes.routes.test.ts:84). Resurrection mechanism-less F8 confirmed. plan.md:103-107,115-117 |
| COR-5 | material | `#seq` fixture (notes-harness.test.ts:41-44) is byte-identical to the shape search-types.ts:63-67 forbids persisting; M3 re-window pending (search-endpoint/retro.md:8). Grammar blesses a forbidden id. |
| COR-6 | material | Two-write non-atomicity structural to D1 (PostgREST, no client transaction); retry duplicates notes. Cheap option (compensating delete + client uuid + ignore-duplicates) is scale-proportionate; RPC optional. plan.md:101-102 |
| COR-7 | material | Logically airtight: returned updated_at informs only the writer; detection needs base-echo compare. Narrow fix (one WHERE clause) or strike D6's implication — Q7 input was solicited. plan.md:118,186-187 |
| COR-8 | material | Verified all three paths: parseScope accepts GROUP_KEYS members + error message enumerates them (search-request.server.ts:36,40); chips render GROUP_KEYS (search.tsx:1104). 400→200 flip falsifies F2's byte-compat. |
| COR-9 | material | nextCursor contractually present when full (search-types.ts:80-83); `after` requires one scope, decoded against canon-minted cursors (api.search.tsx:73-95) — notes leg outside searchAll can't satisfy either. Uncursored-v1 fix proportionate. |
| COR-10 | material | Item 1 verified: no period-stripping in slug-map.ts:141-158, "1 ne." → unknown — plan's own F4 fixture fails. Chapter-form FP class real; harness line 49 pins chapter auto-link. |
| COR-11 | material | Weakest finding but real: naive snippet over body_md leaks `[[ref|label]]` into the pinned plain-text-⟪⟫ contract (search-types.ts:70). Title half is solicited Q4 input. Cheap, pin it. |

## Stance

This is an unusually well-grounded review: every citation I could re-check —
live entity ids, slug-map mechanics, parseScope/cursor/snippet contracts,
harness fixture lines, the smoke script's SERVICE_ROLE fallback — checked out
exactly as written, and the live-DB collision probe reproduced byte-for-byte.
My only substantive pushback is COR-1's severity framing (two of its three
fixture classes are house-serializer-configurable, which its own fix concedes;
only the escape/containment class is genuinely unachievable) and COR-6/COR-7
flirting with enterprise posture at single-digit DAU — but both offer
scale-proportionate cheap fixes, so neither tips to risky. No finding refuted;
all eleven should reach the plan-amendment gate.
