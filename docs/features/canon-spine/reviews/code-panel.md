# Code-panel aggregate — canon-spine

7/7 roles complete. Per-role files in `code-panel/` are the source of truth;
this file dedups across roles. 46 raw findings → 40 canonical (6 merged).
Correctness + observability were reviewed inline by the orchestrator after the
background agents failed twice (stall / connection); logged for retro.

## Merged (cross-role duplicates)

| Canonical | Merged from | Topic |
|---|---|---|
| CMIG-1 | CDATA-1 | `DROP TABLE lumen.words` in SPINE_DDL wipes ingested words on P1 re-run (Critical) |
| CSEC-5 | CDATA-5 | P3 marker existence-only / no freshness binding gates P4 forever |
| CDATA-6 | COBS-5 | P4 persists no audit marker in migration_state |
| CSEC-3 | COBS-4 | smoke's fatal catch uses ad hoc redaction, misses `password=` |
| CSEC-4 | CMIG-7 (DSN half) | smoke never validates session-mode/port on DATABASE_URL |
| COBS-2 | CMIG-7 (logging half) | marker-INSERT failure indistinguishable from invariant failure |

CAPI-5 and CCOR-2 are related, not duplicates: CAPI-5 = parity coverage for
rewritten *queries* (getPassage/searchScriptures/getBooksByVolume); CCOR-2 =
missing old-vs-new *books table* diff (dc row, sort_order). Both stand.

## Canonical findings by severity

**Critical**
- CMIG-1 (+CDATA-1) — SPINE_DDL unconditionally drops/recreates `lumen.words`; any plain P1 re-run after ingest-words destroys ~1.2M rows. `raised_by: [migration-safety, data-integrity]`
- CSEC-1 — `lumen.words` has no RLS enablement or read policy, unlike every sibling spine table (and any policy would be wiped by the DROP). `raised_by: [security]`

**High**
- CAPI-1 — `volume_id` moved source tables (verse row → joined books row) with no old-vs-new invariant anywhere; silent MCP JSON drift post-P4. `raised_by: [api-contract]`
- CCOR-1 — deployment-ordering hazard (web deploy before P1 breaks all scripture routes) documented nowhere. `raised_by: [correctness]`
- CMIG-2 — P4 runs the irreversible DROP on marker alone; plan promised marker + human confirmation. `raised_by: [migration-safety]`
- CMIG-3 — session-mode check is a `:6543` string test; portless/proxied DSNs pass unchecked. `raised_by: [migration-safety]`
- CPERF-8 — smoke's edge anti-join LEFT JOINs an un-materialized 6-way UNION view (incl. 1.2M words) twice over 253k edges, ungated by EXPLAIN/timeout, and it gates P4. `raised_by: [performance]`

**Medium**
- CSEC-3 (+COBS-4) — smoke fatal catch: ad hoc redaction misses `password=`. `raised_by: [security, observability]`
- CSEC-5 (+CDATA-5) — P3 marker: existence-only check, no content/freshness binding; stale marker authorizes P4 against re-mutated state. `raised_by: [security, data-integrity]`
- CSEC-6 — admin scripts `require()` the postgres driver from apps/web/node_modules (supply-chain blast radius on admin creds). `raised_by: [security]`
- CDATA-2 — `lumen.nodes` returns 2–3 rows per structural id (entities never pruned); no documented ordering for id lookups. `raised_by: [data-integrity]`
- CDATA-3 — plan promised structural entities "marked deprecated in place"; no code does it. `raised_by: [data-integrity]`
- CDATA-4 — duplicate (volume_id, sort_order) aborts via raw UNIQUE violation, not a named check. `raised_by: [data-integrity]`
- CMIG-4 — `--book` with unknown id silently no-ops and exits 0. `raised_by: [migration-safety]`
- CMIG-5 — P4 marker checked outside the tx (TOCTOU). `raised_by: [migration-safety]`
- CAPI-2 — getVerseByReference + 'unknown' resolver path have zero test coverage. `raised_by: [api-contract]`
- CAPI-3 — new getBook/getVolume exports untested. `raised_by: [api-contract]`
- CAPI-5 — parity checks cover only 3 of 10 rewritten queries. `raised_by: [api-contract]`
- CCOR-2 — no old-vs-new books parity (dc row, sort_order mapping). `raised_by: [correctness]`
- CPERF-1 — idx_verses_chapter_id promised in setup-indexes.sql too; only the migration has it. `raised_by: [performance]`
- CPERF-3 — prev/next bounds fetch all chapter rows (≤138) to Math.max one scalar per verse click. `raised_by: [performance]`
- CPERF-4 — no wall-clock estimate documented for the ~560-batch words ingest. `raised_by: [performance]`
- CPERF-6 — no query-count assertion on the scripture loader (home has one). `raised_by: [performance]`
- CPERF-7 — idx_words_normalized live-maintained across the entire 1.2M-row bulk load, contra setup-indexes.sql's own guidance. `raised_by: [performance]`
- COBS-1 — words_batch_failed doesn't identify the failed verse range. `raised_by: [observability]`
- COBS-2 (+CMIG-7) — smoke folds marker-persist failure into the invariant-failure counter. `raised_by: [observability, migration-safety]`

**Low**
- CSEC-2 — lumen_read granted SELECT on migration_state. `raised_by: [security]`
- CSEC-4 (+CMIG-7) — smoke skips the :6543 guard; loadAdminUrl not shared. `raised_by: [security, migration-safety]`
- CDATA-7 — deprecated structural entities permanently excluded from Neo4j stamping; future edits never propagate. `raised_by: [data-integrity]`
- CMIG-6 — round-trip estimate ~2× understated (BEGIN/COMMIT counted). `raised_by: [migration-safety]`
- CMIG-8 — dry-run sentinel is string-equality on e.message. `raised_by: [migration-safety]`
- CAPI-4 — getBooksByVolume test asserts SQL text only, not row key set. `raised_by: [api-contract]`
- CAPI-6 — BookRow.sort_order `| null` branch dead vs NOT NULL column. `raised_by: [api-contract]`
- CAPI-7 — queries.ts header doesn't flag getVerseByReference's coverage gap. `raised_by: [api-contract]`
- CCOR-3 — books pre-check validates volume_id presence, not FK validity. `raised_by: [correctness]`
- CCOR-4 — getAllBooks ORDER BY sort_order alone: cross-volume interleave, nondeterministic ties. `raised_by: [correctness]`
- CCOR-5 — tokenizer excludes non-ASCII letters; corpus verified 100% ASCII today; future-tradition note. `raised_by: [correctness]`
- CDATA-6 (+COBS-5) — P4 leaves no audit row. `raised_by: [data-integrity, observability]`
- COBS-3 — smoke has no structured summary line / total elapsed. `raised_by: [observability]`
- CPERF-2 — smoke latency check doesn't exercise the real VERSE_SPINE join. `raised_by: [performance]`
- CPERF-5 — volumes/books per-row insert loop (n=91, harmless). `raised_by: [performance]`
