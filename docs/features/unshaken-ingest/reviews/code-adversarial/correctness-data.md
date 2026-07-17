# Code-adversarial — correctness-data (unshaken-ingest A1)

Role: CODE-ADVERSARIAL. Each CCOR re-verified independently by execution against
the real modules (`scripts/ingest-podcast/*.mjs`). Calibration: solo-dev,
0-user surface (`public=false`), A1 = one-time 10-episode run; weekly manual
re-runs are the expected future; UI + search consumers are Phase B / the search
feature.

| ID | Tag | Rationale (≤25 words, evidence or executed repro) |
|---|---|---|
| CCOR-1 | noise | Load deletes only the current episode (confirmed). But archive is meant to GROW (portability inv: "weekly ingestion of the NEW episode"); proposed prune would destroy prior episodes — misread + harmful fix. |
| CCOR-2 | risky | Repro: `buildLoadPlan` emits block-label `"Joshua 1"` for whole-book (verified). Real wrong-render, but only feeds deferred-search C-weight; book token still indexed; no A1 surface. Borderline, CON-5-flagged. |
| CCOR-3 | material | `public = EXCLUDED.public` + hardcoded `false` reverts B's deliberate `public=true` on every re-run (INSERT still seeds first ingest, so fix is safe). Bites the routine weekly re-run. |
| CCOR-4 | risky | Verified: edges use fresh `parseTitle`; metadata/search use cached `ep.spans`/`ep.subtitle`. Parse-fix + un-refreshed episodes.json silently diverges them. Real but narrow; panel's pass-`parsed.*` fix is correct. |
| CCOR-5 | noise | Cache reuses a valid transcript across keyterm/model drift — but that IS the design: transcription is the expensive cached stage. Force-retranscribe re-costs the batch; weekly keyterm recompute would thrash. Deliberate. |
| CCOR-6 | noise | Repro: cross-book title sans subtitle yields `subtitle=''` (single-book form rejects). Real fail-closed inconsistency, but no live/plausible Unshaken title lacks a subtitle; spans still correct. Inert. |
| CCOR-7 | noise | Repro: absent `--episode` → `probe` undefined → TypeError, but CAUGHT at index.mjs:305 → fatal exit 1 (opaque msg, not a crash). Manual debug flag, fail-loud, zero data/user impact. |

## Overall stance

The panel's executable reproductions all hold — I re-ran CCOR-2/4/6/7 against the
real modules and confirmed each — but its severities over-weight a Phase-A1
world with no UI, no live search consumer, and a single one-time load. The one
finding that earns real urgency is **CCOR-3**: `public = EXCLUDED.public` is a
shipped landmine on the explicitly-designed REL-8 publish path that will
silently un-publish the collection on the first weekly re-run after Phase B
flips it — cheap, safe fix, so material. **CCOR-1 inverts the design**: its
"orphans accumulate forever" is intended archive growth (weekly ingest ADDS an
episode; the collection is a library, not a rolling 10-window), and its proposed
prune-on-refresh would delete every previously-ingested episode down to the
newest 10 — a data-loss fix, hence noise; the only legitimate sliver
(retitle/delete reconciliation) is a deferred workflow-system concern, not A1's.
