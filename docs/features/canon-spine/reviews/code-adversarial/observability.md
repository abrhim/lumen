# Code-Adversarial Review — Observability (canon-spine)

Source: docs/features/canon-spine/reviews/code-panel/observability.md
Scripts verified against: scripts/ingest-words.mjs, scripts/smoke-canon-spine.mjs, scripts/migrate-canon-spine.mjs

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| COBS-1 | material | Verified: `words_batch_failed` (ingest-words.mjs:106) omits verse ids/range. Trivial fix (log batch bounds); real diagnostic value even though `--book` targeting exists. |
| COBS-2 | risky | Verified marker-INSERT shares `failures` counter/exit path with checks, but the fatal-line message text already differentiates cause; smoke's contract is documented binary 0/1 — fix adds structure for mostly cosmetic gain. |
| COBS-3 | out-of-scope | Smoke's human ✓/✗ format is a documented, intentional split from JSON house style; requesting a structured JSON summary line contradicts that established design decision. |
| COBS-4 | material | Verified: smoke's inline redaction (smoke-canon-spine.mjs:100) omits the `password=` regex present in shared `scrub()` (migrate/ingest). Trivial fix: import/reuse `scrub()`. |
| COBS-5 | material | Verified: P4 branch (migrate-canon-spine.mjs:154-165) inserts nothing into `migration_state`, unlike P1's audit row. Irreversible op with no DB audit trail; cheap, analogous fix. |

## Overall stance

Three of five findings hold up under direct code inspection and are cheap, low-risk fixes worth taking before the prod migration runs, especially COBS-5 given P4 is the irreversible gate and currently leaves zero DB-side trace of having executed. COBS-4 is a genuine, easily-fixed credential-redaction gap that should be treated with above-Low urgency despite its assigned severity, since it's a straight regression relative to the shared `scrub()` already in use elsewhere. COBS-2 is technically accurate but overstates real-world impact — the fatal-line text already differentiates cause for a human reader, and smoke's exit contract is deliberately binary — so it's flagged risky rather than dismissed. COBS-3 is rejected as out-of-scope: it asks smoke to adopt the JSON logging convention that the codebase has deliberately excluded it from as the human-run gate.
