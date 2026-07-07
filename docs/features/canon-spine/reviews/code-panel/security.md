# Code-panel — security (canon-spine)

Verified in-code before findings: SEC-1 GRANT inside tx incl. lumen.nodes ✓;
SEC-3 scrub() on all catches in migrate/ingest-words (smoke's fatal path is the
exception — CSEC-3); injection surfaces clean (static SPINE_DDL, tx.json params,
tagged-template binds); nodes view exposes only id/kind/name; migration_state
payloads carry no credentials. New finding beyond synthesis: admin scripts load
the postgres driver from apps/web/node_modules (CSEC-6).

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| CSEC-1 | Critical | migrate-canon-spine.mjs SPINE_DDL (DROP/CREATE lumen.words) | DROP TABLE wipes the RLS enablement/policy staged for words; SPINE_DDL re-enables RLS on volumes/books/chapters but not words. | Add `ALTER TABLE lumen.words ENABLE ROW LEVEL SECURITY;` + `CREATE POLICY words_read ... FOR SELECT USING (true);` matching the other tables. |
| CSEC-2 | Low | SPINE_DDL GRANT list | lumen_read granted SELECT on migration_state — internal bookkeeping exposed to the public-read role; no app feature needs it. | Drop migration_state from the GRANT list; admin-only. |
| CSEC-3 | Medium | smoke-canon-spine.mjs fatal catch | Ad hoc inline redaction regex instead of shared scrub(); misses the password= query-param pattern. | Use scrub() (shared or duplicated verbatim) in smoke's catch. |
| CSEC-4 | Low | URL loading in the three scripts | smoke never rejects a :6543 DSN like the other two scripts do. | Factor loadAdminUrl() (with the 6543 guard) into one shared helper used by all three. |
| CSEC-5 | Medium | P4 gate check | Marker check is existence-only; a stale canon-spine-p3-verified row from an earlier run lets the irreversible DROP proceed against re-mutated state. | Stamp the marker with content (row counts) at write; P4 re-derives and compares before dropping. |
| CSEC-6 | Medium | require(apps/web/node_modules/postgres) in all three scripts | Admin-credentialed scripts load their DB driver from a sibling workspace's node_modules — supply-chain blast radius against prod admin creds. | Add postgres as a root (or scripts-workspace) dependency; import normally. |
