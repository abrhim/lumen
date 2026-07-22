# Bugs — search-ui (running log; code-panel findings merge in at step 11)

| ID | Severity | Provenance | Where | Problem | Status |
|----|----------|------------|-------|---------|--------|
| B-U1 | med | **Abram, live test 2026-07-21** | SearchModal.tsx trigger focus | Pointer-opened modal returned focus to the orb on close; the focused button turned Space-to-scroll into Space-reopens-search. | FIXED 19763c2, deployed f2d9dc6e — pointer-aware `onCloseAutoFocus` (keyboard opens keep return-focus per AU-3). e2e: manual (no browser automation in repo); code-panel to scrutinize. |
