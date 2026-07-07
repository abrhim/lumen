# Code-adversarial aggregate — canon-spine

7/7 taggers complete. Per-role files in `code-adversarial/` are the source of
truth. Tally over 40 canonical findings: **25 material · 3 risky · 10 noise ·
2 out-of-scope**.

| Role | material | risky | noise | out-of-scope |
|---|---|---|---|---|
| security | CSEC-1,2,3,5,6 | CSEC-4 | — | — |
| migration-safety | CMIG-1,2,3,4,5 | — | CMIG-6,7,8 | — |
| data-integrity | CDATA-1,2,3,6 | CDATA-5 | CDATA-4,7 | — |
| api-contract | CAPI-1,2,3,5 | — | CAPI-4,6,7 | — |
| performance | CPERF-1,6,7,8 | — | CPERF-2,3,4,5 | — |
| correctness | CCOR-1,2 | — | CCOR-3,4 | CCOR-5 |
| observability | COBS-1,4,5 | COBS-2 | — | COBS-3 |

## Cross-role conflicts (synthesizer resolution, precedence panel-2 > panel-1)

- **CSEC-5 (material) vs CDATA-5 (risky)** — same underlying defect (P3 marker
  staleness). Resolution: the heavy hash/snapshot fix is rejected per CDATA-5's
  risky tag; the defect is still closed cheaply by (a) CMIG-2's `--confirm`
  flag and (b) P1 invalidating the P3 marker on re-run (one DELETE). Both land.
- **CSEC-4 (risky) vs CMIG-7 (noise)** — agree in effect: no shared-helper
  extraction; smoke runs no multi-statement DDL so the port guard is
  non-functional there. Dropped.
- **Refuted by taggers with repo evidence**: CDATA-4 (global bookSortOrder
  counter makes the collision structurally impossible), CPERF-2/3 (PK joins /
  ≤150-row indexed scans), CCOR-3 (single-tx rollback makes the raw FK error
  harmless), CCOR-4 (sole caller re-sorts).
- Tagger bonus finding (performance): `setup-indexes.sql` vs migration DDL
  naming drift `idx_words_verse` vs `idx_words_verse_position` — folded into
  the CPERF-1 fix.
