# Bugs — search-ui (running log; code-panel findings merge in at step 11)

| ID | Severity | Provenance | Where | Problem | Status |
|----|----------|------------|-------|---------|--------|
| B-U1 | med | **Abram, live test 2026-07-21** | SearchModal.tsx trigger focus | Pointer-opened modal returned focus to the orb on close; the focused button turned Space-to-scroll into Space-reopens-search. | FIXED 19763c2, deployed f2d9dc6e — pointer-aware `onCloseAutoFocus` (keyboard opens keep return-focus per AU-3). e2e: manual (no browser automation in repo); code-panel to scrutinize. |
| B-U2 | high | **Abram, live test 2026-07-21** | search.tsx state machine (:246, :616) | Book/volume bare-name references (q='moses') suppressed ALL groups — the page treated every found reference as a verse-style short-circuit, hiding the graph behind the Book of Moses. Decision 4: only verse/chapter short-circuit. | FIXED d730fc1 (repro red-first, 23/23), deployed fd093ed4 — reference lead now renders above full results; Enter hint gated to true short-circuits. |
