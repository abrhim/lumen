# Adversarial review — migration-safety (canon-spine)

Verified against `scripts/migrate-canon-spine.mjs`, `scripts/ingest-words.mjs`, `scripts/smoke-canon-spine.mjs`, and `docs/features/canon-spine/plan.md`.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| CMIG-1 | material | Confirmed: SPINE_DDL unconditionally `DROP TABLE`+recreates `lumen.words` inside plain P1 tx; re-run after ingest destroys all rows. Critical survives. |
| CMIG-2 | material | Confirmed: plan.md:162-163 promises "marker + human confirmation"; code only checks marker, no `--confirm` flag/prompt exists. High survives. |
| CMIG-3 | material | Confirmed literal `/:6543\b/` regex in both scripts; portless/proxied transaction-mode DSNs bypass it. High survives — downgrade arguable given manual admin-only invocation. |
| CMIG-4 | material | Confirmed: invalid `--book` id yields empty verse set, empty batch list, exit 0 — silent no-op mistaken for success. |
| CMIG-5 | material | Confirmed marker SELECT (line 156) sits outside `sql.begin` (158). Fix is a one-line move-inside; cheap defense for an irreversible DROP. |
| CMIG-6 | noise | Concerns a documentation/estimate figure, not verifiable against these scripts' runtime behavior; no correctness or safety consequence either way. |
| CMIG-7 | noise | Confirmed smoke lacks the `:6543` check, but it issues no multi-statement tx (unlike P1/ingest) so the gap has no functional analog; failure is still visibly logged + non-zero exit. |
| CMIG-8 | noise | Confirmed string-equality sentinel exists, but collision requires an unrelated real error literally named `DRY_RUN_ROLLBACK` — no realistic trigger path in current code. |

## Overall stance

The three Critical/High findings hold up under direct code inspection: the unconditional `words` drop in P1 (CMIG-1) is a genuine and severe data-loss trap since nothing re-populates the table within P1 itself, and the plan-vs-code gap on P4's human-confirmation gate (CMIG-2) is independently confirmed in `plan.md`. CMIG-3's session-mode check is real but its blast radius is narrowed by the fact this is a manually-invoked, single-operator admin script with the port requirement already documented in comments — worth fixing, not worth blocking on. CMIG-4 and CMIG-5 are cheap, worthwhile fixes with low complexity relative to their (mild) impact. CMIG-6/7/8 are accurate observations but carry no realistic safety consequence given current invocation patterns, so they don't warrant action ahead of the higher-severity items.
