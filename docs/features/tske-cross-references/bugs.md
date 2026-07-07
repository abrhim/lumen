# Bugs — tske-cross-references

Sources: code-panel (7 roles, 35 findings) × code-adversarial (6 taggers) PLUS
a parallel 8-angle code-review sweep (conventions/reuse/simplification/
altitude/efficiency/line-by-line/removed-behavior/cross-file) whose findings
were folded in. Live ingest had NOT run; all fixes landed first.

## Confirmed bugs (all fixed in this commit unless noted)

### B1: incoming cards keyed/labeled by the TARGET range, not the citing verse
- Severity: critical · Categories: correctness
- Source: CCOR-1 + CAPI-2 + line-by-line + cross-file (4 independent, 2 repros)
- Collapsed distinct citers sharing a target range into one card and navigated
  "Referenced by" clicks to the wrong verse (sometimes the reader's own chapter).
- Fix: groupCrossRefs is direction-aware — incoming rows ignore range metadata
  entirely; regression test with two citers of one range.

### B2: loader-test mock shape let every crossRefs path silently degrade
- Severity: critical · Categories: test-coverage
- Source: CAPI-1 (empirically reproduced: 19/19 green while every path threw)
- Mock returned `[]` instead of `{refs, totals}`; the never-throw wrapper ate
  the TypeError. The exact failure class the "mock-only tests" learning warns about.
- Fix: contract-shaped mock + a real happy-path test asserting cards/totals.

### B3: Bible verses lost curated CROSS-CANON links (removed-behavior regression)
- Severity: high · Categories: correctness, product
- Source: removed-behavior angle (verified vs live data: 1 Cor 1:27 → Ether 12:27)
- Old Neo4j panel had no collection filter; new single-collection routing hid
  Bible→BoM bridges on the Bible side. **Abram decided: merge.**
- Fix: Bible verses query both collections; legacy refs filtered to cross-canon
  targets only; totals merged; loader test + smoke bridge check.

### B4: smoke legacy check was a tautology (`>= 0`)
- Severity: high · Categories: observability, data-integrity
- Source: COBS-1 + CDATA-2 + simplification + line-by-line + cross-file (5×)
- Fix: `> 0` on both directions for 1-ne-3-7.

### B5: aria-live on the wrong block (inverted A11Y-2)
- Severity: high · Categories: accessibility
- Source: CUX-1 · Fix: moved to the streamed chips container.

### B6: legacy null-vote rows tiebroke on lexicographic v.id (3:1, 3:11, 3:2)
- Severity: medium · Categories: correctness, ux
- Source: line-by-line angle
- Fix: ORDER BY … v.chapter_id, v.verse_number (numeric within chapter).

### B7: self-cite at a range's start orphaned the representative row
- Severity: medium · Categories: correctness
- Source: CCOR-2 (67 real self-refs in the dry run make it non-hypothetical)
- Fix: self member dropped BEFORE deriving range_start; unit test (Gen.1.1-1.3).

### B8: "N of M" disclosure could misread duplicates as truncation ("1 of 2")
- Severity: medium · Categories: ux
- Source: removed-behavior angle (verified: duplicate phase-b edges exist)
- Fix: disclosure only when cards hit the limit (real truncation).

### B9: curated per-source trust labels lost (AI-suggested vs human-curated)
- Severity: medium · Categories: ux, product
- Source: removed-behavior angle
- Fix: rows carry e.source; non-openbible cards show a provenance label.

### B10: FM-11 cap check inlined/untestable + dry-run never logged write volume
- Severity: medium · Categories: observability
- Source: COBS-3 + COBS-4 · Fix: exported unmappedCapVerdict (boundary-tested,
  exclusive pass at exactly 0.5%); ingest_done logs deleted/inserted always.

### B11: Rev.12.18 exception had no smoke canary
- Severity: medium · Categories: observability
- Source: COBS-2 · Fix: rev-12-18-absent/rev-13-1-present check.

### B12: ingest env/client setup outside the scrubbed path (regression vs migrate)
- Severity: medium · Categories: security
- Source: CSEC-1 (tagger sharpened: migrate-canon-spine already scrubs this)
- Fix: setup wrapped in try/catch + scrub in ingest AND smoke.

### B13: missing (to_id, rel_type) composite; smoke EXPLAIN only checked outgoing
- Severity: medium · Categories: perf
- Source: CPERF-2 + efficiency angle · Fix: idx_edges_to_rel created post-bulk-load
  in the ingest tx + setup-indexes.sql; smoke EXPLAINs both directions.

### B14: contract drift — untyped `total` leaked; UNION ALL/limit/collection untested
- Severity: medium · Categories: api-contract, test-coverage
- Source: CAPI-3/4/5/6/7 · Fix: total stripped from returned refs; tests for
  totals extraction, UNION ALL + single round trip, LIMIT default/override,
  collection_id. (votes stays nullable — the hybrid makes null legitimate;
  plan amendment 11 superseded on that one field.)

### B15: collection upsert didn't self-correct tier/category or set public
- Severity: low · Categories: data-integrity
- Source: CDATA-3 + CSEC-5 · Fix: explicit public=true + full SET list.

### B16: skeleton shape mismatch; CC-BY credit after both groups
- Severity: low · Categories: ux
- Source: CUX-2 + CUX-3 · Fix: two-group median-shaped skeleton; credit renders
  under the References header (falls back to Referenced-by when References empty).

### B17: crossref_degraded missing elapsedMs/book/chapter; log-literal drift
- Severity: low · Categories: observability
- Source: COBS-5 + COBS-7 + COBS-8 · Fix: sibling-shaped event fields; verdict
  ratio reused in both log lines; dataFile logs the constant.

## Rejected-with-rationale / preference / out-of-scope
- CCOR-3 (query fired for out-of-range ?verse, result discarded) — risky per
  tagger; matches the existing pendingConnections pattern; log-noise only.
- CDATA-1 (dedup loses range metadata on range/single collisions) — risky;
  empirically zero instances in the vendored data (verified twice); note left
  for a future data refresh.
- CSEC-2 (vendored-file checksum) — noise per tagger; single-admin threat model.
- CSEC-3 (collectionId allowlist inside getCrossReferences) — risky; both
  callers hardcode; revisit with MCP adoption.
- CSEC-4 (RLS USING(true) gating) — out-of-scope: pre-existing infra, untouched.
- CPERF-1/4/5/6, COBS-7-precision-nit-part, A11Y noise items — dropped as noise.
- Reuse/simplification/altitude angle items (splitId vs parseReference,
  buildVerseId reuse, shared degrade helper, smoke boilerplate module,
  CrossRefsPanel union type, collection-id registry, third-section panel
  shape) — captured as cleanup candidates for the MCP-adoption/SCI feature,
  where the descriptor-object refactor naturally lands.

## Provenance histogram (for retro)
| Origin | Count |
|---|---|
| Should have been caught by plan | 2 (B3, B9 — removed-behavior audit of the old panel belonged in planning) |
| Should have been caught by harness | 4 (B1, B2, B10, B14) |
| Should have been caught by panel-1 | 2 (B5 — A11Y-2 was its finding; B13) |
| Should have been caught by panel-2 | 0 |
| Genuinely emergent / refactor artifact | 9 (B4, B6, B7, B8, B11, B12, B15, B16, B17) |
