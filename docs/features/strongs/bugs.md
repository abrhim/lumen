# Bugs — strongs

Code-panel (2 combined reviewers, 12 findings) × adversarial (9 material /
3 risky / 0 noise — every finding traced to a verified mechanism). Plus two
found by the gates themselves (dry-run cap ×3 iterations, smoke ×1).

## Confirmed & fixed
### B1: lexicon last-write-wins corrupted 1,057 glosses (CE-1, Critical)
- H430 'God' shipped as '(Gibeath)-elohim'; found only by EXECUTING the dedup
  against the vendored files; invisible to all prior checks. Fix:
  first-occurrence-wins + gloss unit tests.
### B2: stale "also in" under rapid taps (CE-2/CS-1, High)
- idle-guard skipped loads mid-flight. Fix: unconditional load (fetcher
  supersedes) + stale-response guard.
### B3–B10 (medium/low, all fixed)
- CS-2 focus return on toggle/Done · CS-3 vertical-only hit areas · CS-4
  scoped live region · CS-5 degraded-vs-empty note · CS-6 verse-selected
  query-count guard · CS-7 GROUP BY/json_agg pinned in tests · CS-8
  elapsedMs parity · CE-3 nested-w defensive skip · CE-4 CASCADE retrofit
  startup check.

## Found by the gates (not reviewers)
### G1: three alignment-mismatch classes (dry-run cap, 3 rejections)
- en-dash compound names (1,187 verses), æ ligatures (Cæsar class), 1769
  spellings (enquire/vail/jubile/…). Histogram-driven deterministic fixes;
  final skip 219 verses (0.70%) = genuine edition wording variants.
### G2: 542 bare Strong's numbers missing from the lexicons (smoke)
- TBESH/TBESG carry only extended sub-entries (H1121a) for many
  high-frequency words. Fix: bare→A aliasing at ingest; unresolved now ZERO.

## Provenance histogram (for retro)
| Origin | Count |
|---|---|
| Should have been caught by plan | 0 |
| Should have been caught by harness | 3 (B1 — no gloss assertions; CS-6, CS-7) |
| Should have been caught by panel-1 | 1 (B2 — fetcher pattern was reviewable) |
| Should have been caught by panel-2 | 0 |
| Genuinely emergent (live-data classes the gates caught by design) | 8 (G1×3, G2, B3-class items) |
