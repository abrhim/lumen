# Bugs — art-graph

Code-panel (3 combined reviewers, 17 findings) × adversarial (5 material /
7 risky / 5 noise). Live edge run had NOT happened; all fixes landed first.

## Confirmed bugs (fixed)

### B1: person map wrong per-ARTWORK, not per-slug (slug polysemy)
- Severity: high · correctness · Source: CCD-1 (live-verified: 3/18 judas = Maccabeus, ~13/30 jacob = poetic Israel)
- Fix: ART_PERSON_BOOK_GATE (jacob→gen; judas→gospels/acts); 15 live wrong
  edges prevented (context_skipped in the re-run dry run); gate unit tests.

### B2: gallery title/H1 showed raw slugs
- Severity: high · ux · Source: CUO-1 · Fix: loader fetches getBook name; reference used in meta/h1/back label (also closes CUO-5).

### B3: chapter-page art failures swallowed silently
- Severity: high · observability · Source: CUO-3 · Fix: art_gallery_degraded logged (view:'chapter') before returning [].

### B4: skip-cap numerator polluted; partial vs full conflated
- Severity: med · data-integrity · Source: CSC-3 + CCD-3 · Fix: skipped
  (whole-ref, cap) / partial / skippedPersons / contextSkipped separated,
  each with its own event.

### B5: range union inconsistent across an overlap group
- Severity: med · correctness · Source: CCD-2 (reproduced; 0 live occurrences) + CSC-4
- Fix: per-(artwork, chapter) interval merge BEFORE emission; group-consistency regression test.

### B6: RELATIONSHIP_TYPES membership test not exhaustive
- Severity: med · test-coverage · Source: CSC-2 · Fix: full-list equality assertion incl. DEPICTS.

### B7: assorted (all fixed)
- CSC-1 PanelBody href="" trap → conditional anchor · CUO-2 elapsedMs on
  art_gallery_degraded · CUO-4 non-linked gallery cards visibly inert ·
  CUO-6 decorative alt (double announcement) · CCD-5 Dürer canary IN-list.

## No action
- CCD-4 FEATURES-only works (6 live) — matches the plan's graph-citizen goal; noise.
- CUO-7 chapter-bounds 404 taxonomy — deliberate decoupling; noise.
- CUO-8 Link vs button — approved deviation (anchor is semantically right for navigation).

## Provenance histogram (for retro)
| Origin | Count |
|---|---|
| Should have been caught by plan | 1 (B1 — the per-slug rule was the plan's own amendment, wrongly scoped) |
| Should have been caught by harness | 2 (B5, B6) |
| Should have been caught by panel-1 | 1 (B2 — ux panel reviewed the route spec) |
| Should have been caught by panel-2 | 0 |
| Genuinely emergent / refactor artifact | 3 (B3, B4, B7) |
