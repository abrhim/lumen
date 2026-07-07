# Bugs — canon-spine

Filtered from code-panel (40 canonical findings) × code-adversarial (25 material).
The prod migration has NOT run; all fixes land before it.

## Confirmed bugs

### B1: P1 re-run destroys ingested words table
- Severity: critical
- Categories: data-loss, migration
- Source: CMIG-1 + CDATA-1 (independent) · Raised_by: [migration-safety, data-integrity]
- Description: SPINE_DDL does `DROP TABLE IF EXISTS lumen.words` + unconditional CREATE, unlike every sibling `IF NOT EXISTS`; a plain P1 re-run after ingest-words wipes ~1.2M rows, violating the plan's idempotent-re-run contract.
- Repro test path: scripts/__tests__/canon-spine.test.mjs (SPINE_DDL assertions)
- Fix commit: bb2026e

### B2: words table has no RLS
- Severity: critical
- Categories: security
- Source: CSEC-1 · Raised_by: [security]
- Description: volumes/books/chapters get ENABLE RLS + read policy in SPINE_DDL; words gets neither, breaking the project's committed RLS convention.
- Repro test path: scripts/__tests__/canon-spine.test.mjs (SPINE_DDL assertions)
- Fix commit: bb2026e

### B3: volume_id has no old-vs-new invariant
- Severity: high
- Categories: correctness, api-contract
- Source: CAPI-1 · Raised_by: [api-contract]
- Description: the one verse field that changed source table (verse row → joined books row) has neither a by-construction guarantee nor a check; drift silently changes MCP JSON after P4 drops the old column.
- Repro test path: in-tx invariant (live-executed at migration; asserted in P1)
- Fix commit: bb2026e

### B4: deployment-ordering hazard undocumented
- Severity: high
- Categories: correctness, ops
- Source: CCOR-1 · Raised_by: [correctness]
- Description: rewritten queries read spine tables that exist only post-P1; deploying web first breaks every scripture route. Stated nowhere.
- Repro test path: n/a (documentation)
- Fix commit: bb2026e

### B5: P4 runs on marker alone; stale marker never invalidated
- Severity: high
- Categories: data-loss, migration
- Source: CMIG-2 + CSEC-5 + CDATA-5 · Raised_by: [migration-safety, security, data-integrity]
- Description: plan promised "marker + human confirmation"; no --confirm exists. Marker is also existence-only. Resolution per adversarial (hash machinery rejected as risky): add `--confirm` AND have P1 invalidate the P3 marker on re-run.
- Repro test path: scripts/__tests__/canon-spine.test.mjs (p4Preflight)
- Fix commit: bb2026e

### B6: session-mode check is a string test
- Severity: high
- Categories: migration
- Source: CMIG-3 · Raised_by: [migration-safety]
- Description: `/:6543\b/` only rejects the literal port; portless/proxied transaction-mode DSNs pass and break multi-statement/tx semantics mid-run. Fix: runtime probe (SET custom GUC across two top-level statements, assert it persists).
- Repro test path: live probe self-asserts at run start
- Fix commit: bb2026e

### B7: P4-gating smoke anti-join is unbounded
- Severity: high
- Categories: perf, migration
- Source: CPERF-8 · Raised_by: [performance]
- Description: LEFT JOIN against un-materialized 6-way UNION view (incl. 1.2M words) twice over 253k edges, no timeout; worst case safe-fail but gates P4. Fix: per-table NOT EXISTS (indexed PK probes) + statement_timeout.
- Repro test path: n/a (query rewrite; live smoke validates)
- Fix commit: bb2026e

### B8: --book with unknown id silently exits 0
- Severity: med · Categories: correctness, ops
- Source: CMIG-4 · Raised_by: [migration-safety]
- Fix commit: bb2026e

### B9: P4 marker checked outside the tx (TOCTOU)
- Severity: med · Categories: migration
- Source: CMIG-5 · Raised_by: [migration-safety]
- Fix commit: bb2026e

### B10: smoke's fatal catch bypasses scrub()
- Severity: med · Categories: security
- Source: CSEC-3 + COBS-4 · Raised_by: [security, observability]
- Fix commit: bb2026e

### B11: admin scripts require() driver from apps/web/node_modules
- Severity: med · Categories: security, supply-chain
- Source: CSEC-6 · Raised_by: [security]
- Fix: add `postgres` as a root devDependency; require normally.
- Fix commit: bb2026e

### B12: structural entities never marked deprecated (plan promise)
- Severity: med · Categories: data-integrity
- Source: CDATA-3 · Raised_by: [data-integrity]
- Fix: `metadata.deprecated = true` UPDATE in the P4 transaction.
- Fix commit: bb2026e

### B13: P4 leaves no audit row
- Severity: med · Categories: data-integrity, observability
- Source: CDATA-6 + COBS-5 · Raised_by: [data-integrity, observability]
- Fix: canon-spine-p4-done row inside the P4 tx.
- Fix commit: bb2026e

### B14: parity checks cover 3 of 10 queries; books never diffed
- Severity: med · Categories: correctness, api-contract
- Source: CAPI-5 + CCOR-2 · Raised_by: [api-contract, correctness]
- Fix: add parity pairs for books table, getBooksByVolume, getPassage, searchScriptures.
- Fix commit: bb2026e

### B15: getVerseByReference / unknown-resolver / getBook / getVolume untested
- Severity: med · Categories: test-coverage
- Source: CAPI-2 + CAPI-3 · Raised_by: [api-contract]
- Fix commit: bb2026e

### B16: setup-indexes.sql drifted from migration DDL
- Severity: med · Categories: perf, docs
- Source: CPERF-1 (+ tagger-spotted idx_words_verse naming drift) · Raised_by: [performance]
- Fix commit: bb2026e

### B17: words indexes live-maintained across the 1.2M-row bulk load
- Severity: med · Categories: perf
- Source: CPERF-7 · Raised_by: [performance]
- Fix: drop idx_words_verse (redundant with UNIQUE(verse_id, position)) and idx_words_normalized from P1 DDL; ingest-words creates idx_words_normalized after a full clean run.
- Fix commit: bb2026e

### B18: scripture loader has no query-count guard
- Severity: med · Categories: test-coverage, perf
- Source: CPERF-6 · Raised_by: [performance]
- Fix commit: bb2026e

### B19: words_batch_failed omits the failed verse range
- Severity: med · Categories: observability
- Source: COBS-1 · Raised_by: [observability]
- Fix commit: bb2026e

### B20: lumen_read granted SELECT on migration_state
- Severity: low · Categories: security
- Source: CSEC-2 · Raised_by: [security]
- Fix commit: bb2026e

### B21: lumen.nodes multi-row-per-id contract undocumented
- Severity: med · Categories: data-integrity, docs
- Source: CDATA-2 · Raised_by: [data-integrity]
- Fix: extend the view's contract comment + design doc: id lookups may return >1 row (spine + deprecated entity); consumers must not assume single-row.
- Fix commit: bb2026e

## Needs investigation
(none — every material finding was verified against code by its tagger)

## Preference (captured for learnings)
- CMIG-6 round-trip estimate wording · CMIG-8 string sentinel · CAPI-4 SQL-text-only assertion style · CAPI-6 dead `| null` branch · CAPI-7 header cross-ref · CPERF-4 wall-clock doc · CPERF-5 n=91 insert loop · CCOR-4 getAllBooks ordering (sole caller re-sorts)
- Refuted with repo evidence by taggers: CDATA-4 (global sort counter), CDATA-7 (nothing writes collection_id on deprecated entities), CPERF-2/3 (PK joins, tiny scans), CCOR-3 (tx rollback)

## Out-of-scope
- CCOR-5 tokenizer unicode — corpus verified 100% ASCII; revisit when a non-English tradition lands (note added to tokenize.ts header)
- COBS-3 smoke JSON summary line — smoke's human format is a deliberate split
- CDATA-5's hash/snapshot freshness machinery — rejected-with-rationale (risky); replaced by B5's cheaper marker invalidation

## Provenance histogram (for retro)
| Origin | Count |
|---|---|
| Should have been caught by plan | 3 (B3, B4, B21) |
| Should have been caught by harness | 7 (B1, B2, B5, B6, B14, B15, B18) |
| Should have been caught by panel-1 | 2 (B7, B17) |
| Should have been caught by panel-2 | 0 |
| Genuinely emergent / refactor artifact | 9 (B8–B13, B16, B19, B20) |
