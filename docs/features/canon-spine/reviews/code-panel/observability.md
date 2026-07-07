# Code-panel — observability (canon-spine)

Reviewed inline (background agent failed twice on connection errors).

Verified clean: migrate + ingest-words follow the structured-JSON house style
(`log(event, data)`) with elapsedMs on start/done, per-book progress with
tokens/verse min/median/max, zeroTokenVerses tracked with capped sample,
invariant_check logs expected/actual/pass per check (payloads bounded), exit
codes documented and consistent (migrate 0/1, ingest 0/1/2, smoke 0/1),
scrub() on migrate/ingest error paths, dry-run outcomes explicitly logged
(dry_run_rollback with note).

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| COBS-1 | Medium | ingest-words.mjs words_batch_failed | Logs book + scrubbed message but not which verses failed; a partial run (exit 2) gives no way to target the gap short of a full re-run. | Include the batch's first/last verse id (`range: [batch[0].id, batch.at(-1).id]`) in the words_batch_failed payload. |
| COBS-2 | Medium | smoke-canon-spine.mjs fatal catch | Marker-INSERT failures and invariant failures fold into one `failures` counter and one fatal line — a permissions misconfig is indistinguishable from real data corruption (overlaps CMIG-7). | Wrap the marker INSERT in its own try/catch logging a distinct `marker_persist_failed` line. |
| COBS-3 | Low | smoke-canon-spine.mjs throughout | Smoke uses human ✓/✗ lines while sibling scripts emit structured JSON; fine for a human-run gate, but CI/pipe consumers can't parse it and there's no total elapsed time. | Keep the human lines; add one final JSON summary line (`{event:'smoke_done', failures, checks, elapsedMs}`). |
| COBS-4 | Low | smoke-canon-spine.mjs fatal catch | Inline redaction regex diverges from shared scrub() and misses the `password=` query-param pattern (same defect as CSEC-3; logged here for the log-hygiene angle). | Use the shared scrub() implementation. |
| COBS-5 | Low | migrate-canon-spine.mjs P4 block | P4 logs migration_done but persists no audit row; post-hoc there is no in-DB evidence of when the irreversible drop ran (same as CDATA-6, observability angle). | Insert a canon-spine-p4-done migration_state row inside the P4 transaction. |
