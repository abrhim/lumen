# Panel-2 adversarial — PERFORMANCE lane

- Lane: performance (panel-1 findings PERFORMANCE-1..9)
- Date: 2026-07-30
- Tagger role: PANEL-2 ADVERSARIAL, performance lane
- Method: every cited file/line re-read and verified (check-notes-bundle.mjs
  walk logic; notes.server.ts projections, sync loop, append chain;
  NoteEditor.tsx dispatchTransaction/debounce effect/boundary wiring via Read
  — file contains NUL bytes; scripture.tsx loader; auth.server.ts memo;
  root.tsx session await; notes-derive.ts prefix behavior).

| ID | CP | Tag | Rationale (evidence-based) |
|----|----|-----|----------------------------|
| PERFORMANCE-1 | CP-10 | material | Verified the checker: the closure walk tests only manifest keys and each entry's `file` name against `/prosemirror\|markdown-it\|components\/editor/` (check-notes-bundle.mjs:27,65); a Rollup-split shared chunk keyed `_markdown-<hash>.js` matches none of the three patterns, and the positive control (:74-82) only asserts an editor chunk exists under `dynamicImports` — it never exercises the walk against a known-bad static graph. The lane's probe-build demonstration (63KB gz into search.tsx's static closure, script exits 0) concedes the false negative empirically. The oracle fails to enforce A11's stated invariant on the most plausible regression class; the content-scan stopgap plus a negative control is proportionate. |
| PERFORMANCE-2 | CP-23 | risky | The projection gap is real (verified `.select("id, body_md, updated_at")` at notes.server.ts:372), but the 1.6MB headline assumes all 25 hits at the 64KB DDL cap — implausible for personal study notes at single-digit DAU — and the failure mode is the designed, explicit A4 degradation, not an outage. The fix adds a second STORED generated column encoding a presentation bound (600 chars) into DDL, and the byte-identity claim is self-limited ("whose title+snippet fit the bound"): verified in notes-derive.ts that `deriveNoteTitle` scans ALL lines for the first non-empty stripped line, so a note whose preamble strips to empty past the bound derives a different title on the leg than on /notes/:id. Schema coupling + a new list/page divergence class exceeds the transfer waste prevented. |
| PERFORMANCE-3 | CP-1 | material | Fully verified in code: the effect deps are `[dirty, latestMdRef.current, noteId]` (NoteEditor.tsx:547) — a ref `.current` is inert; `setDirty(true)` bails once dirty (:502), `setPopup(null)` bails while closed (:516), and `onMarkdown` writes to a ref with no re-render (:826) — so during continuous typing nothing re-renders and the 3s timer set at the first dirty render is never reset. The code performs periodic ~3s full saves (POST + Worker canonicalization + anchor diff) while typing, deviating from the settled G5/A13 wording "≥3s idle debounce". The proposed fix (own the timer in `dispatchTransaction` on `tr.docChanged`) is small, correct, and composes with the CP-1 data-loss cluster. |
| PERFORMANCE-4 | CP-30 | risky | Verified: `serializeNoteDoc(newState.doc)` runs on every doc-changing transaction (:503). But at realistic note sizes serialization is sub-millisecond; milliseconds-per-keystroke materializes only near the 64KB cap on low-end mobile. The value produced feeds `EditorBoundary.latestMarkdown` — the G5/A19 crash-preservation buffer (:825-826) — and the fix makes that buffer stale by the debounce window; the "try live PM state first" mitigation requires plumbing `viewRef` out of PMEditor into the wrapper boundary (verified: the boundary currently sees only `latest.current`), adding coupling inside a data-loss containment path to shave work that rarely registers. Fix regression-risk exceeds the defect. |
| PERFORMANCE-5 | CP-23 | risky | Verified `listNotes` selects `body_md` with limit 200 (notes.server.ts:117-119). The 12.8MB worst case assumes 200 notes all at cap — panel-1 itself concedes "realistic bodies are small and DAU is single-digit" and rates it low/slow-burn. The shared fix is the same new generated-column machinery as PERFORMANCE-2 and inherits the same derivation-divergence edge; same proportionality failure. |
| PERFORMANCE-6 | CP-16 | material | Verified the chain: append runs `getNote` (:252) → `updateNote` → `getNoteAnchors` (:269) → `syncNoteAnchors`, whose first statement re-fetches the same anchors (notes.server.ts:282) — the :269 result is discarded, 5 serial round trips on an interactive sub-second verb. The fix (single idempotent upsert of the one new row; `ignoreDuplicates: true` already in place at :304) is minimal, saves 2 RTs, and as a side effect removes the replace-set concurrent-anchor-deletion hazard DATA-3 flags in the same CP. Concede. |
| PERFORMANCE-7 | CP-16 | material | Verified: `for (const a of toDelete)` with an awaited per-row `.delete()` (notes.server.ts:287-296) while insert batches (:299-305). N serial PostgREST round trips inside the autosave action interact with the Workers subrequest ceiling and the documented session-pool cap-15 incident class (CP-16 merges DATA-3's mid-loop partial-sync consequence). Refs are grammar-validated fail-closed (`validateAnchorRefs`, :190-203), so the batched `.or()` filter is safe; the fix is proportionate. |
| PERFORMANCE-8 | CP-71 | material | Verified: `await getSessionUser` precedes creation of the 750ms signal (scripture.tsx:339-346) and `getSessionUser` is deliberately timeout-free with per-Request memoization (auth.server.ts:100-119). Root.tsx awaits the session on every document request (:31), so for document SSR the tail is pre-existing — but on chapter-to-chapter client navigations the root loader does not re-run, and the notes feature puts a fresh unbounded session read (gotrue network I/O on the refresh path) on the chapter data request's critical path, which the loader comment does not record. Weak-material: the accept-and-record option (one comment line) is a sufficient resolution, and any race-based bound must be co-resolved with CP-8's rotation-loss fix. |
| PERFORMANCE-9 | CP-72 | noise | Informational by its own declaration: it confirms the settled A2/CF-56 server-weight acceptance with measurements, verifies singletons, finds the lazy chunk correctly gated, and proposes no code change — only a learnings line. Useful retro telemetry, but it would not change shipped quality. |

## Carve-out downgrade suggestions

None. No finding in this lane is severity-high with category
security/data-loss/correctness: PERFORMANCE-1 is high but categorized
bundle-discipline/test-gap (tagged material on its merits anyway), and
PERFORMANCE-3's carve-out exposure rides the CP-1 correctness cluster owned
by other lanes — I concede it regardless.

## Overall stance

Mostly signal, and unusually well-evidenced: the two load-bearing claims
(PERFORMANCE-1's oracle false negative, PERFORMANCE-3's inert-ref debounce)
were verified empirically/in-code and both hold exactly as stated, and the
lane's "verified clean" section did real work. The weak spots are a
consistent one: worst-case arithmetic pinned to the 64KB cap at single-digit
DAU (P2/P5) and a hot-path micro-fix that trades against a crash-safety
guarantee (P4) — three of nine findings propose machinery heavier than the
defect they cure.
