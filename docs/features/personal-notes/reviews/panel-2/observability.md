# Observability — panel-2 adversarial verdict (personal-notes)

Verified against code: search-obs.server.ts:34-41 (perGroup is the sole
degraded source), api.search.tsx:122-136 (meta stripped; logSearchExecuted
consumes `searchAll`'s result pre-merge), scripture.tsx:110-549 (six
`*_degraded` events; verse_signals_degraded:296), root.tsx:106-140 (boundary
logs nothing; only client boundary is SearchChromeBoundary), migrate-media-
collections.mjs:95-145 (COMMIT=1 / JSON events / exit 2 / scrubSecrets all
real), smoke-notes-rls.mjs (0-row RLS semantics as claimed).

| ID | Tag | Rationale (≤25 words + evidence) |
|---|---|---|
| OBS-1 | material | Verified: route-layer merge bypasses perGroup (search-obs.server.ts:34-41), meta stripped (api.search.tsx:132). Failed notes leg reads as "no notes" — B7 silent-swallow exactly. |
| OBS-2 | risky | Real gap, cheap client-side canary, clean hash-only fields. But invariant already harness-pinned (F3 + save-action); constrained schema makes prod divergence low-probability. Gate call, not must-fix. |
| OBS-3 | material | Verified: hottest loader, six-sibling degraded pattern (scripture.tsx:296). Unnamed at plan time → unguarded await 500s signed-in reader, or dot vanishes silently. Privacy line correct. |
| OBS-4 | material | LWW clobber destroys user writing with zero forensics — post-clobber the DB holds no history; the prev/new updated_at pair is the only record. Three cheap events. |
| OBS-5 | risky | The 0-row-success trap is real (smoke-notes-rls.mjs:87-101) and must be handled; the five-way cause enum is taxonomy refinement beyond single-digit-DAU need. Fold essentials into note_write_failed. |
| OBS-6 | material | Verified: root ErrorBoundary logs nothing (root.tsx:106-140); /notes/:id is read+edit, so a custom-wikilink-rule throw makes the note unopenable AND uneditable, zero signal. |
| OBS-7 | risky | Boundary catches only render-phase throws — PM exceptions live in DOM/dispatch handlers boundaries never see, so fix efficacy is partial. Failure is user-visible, population tiny; beacon = new telemetry infra. Decide containment at gate. |
| OBS-8 | material | B7 lesson verbatim (search.tsx:662-672 exists because of it): unread fetcher.data makes a failed save of personal writing silent. Highest-stakes user failure; posture must be decided at gate. |
| OBS-9 | risky | Ratified precedent verified (search-endpoint plan:51,77; migrate-media-collections.mjs:116-145). One-sentence fix; the no-grant migration invariant has real teeth, but operator watches scripts — nothing silent, nobody stranded. |

## Stance

Panel-1 correctly identified that the plan's real hole is not missing metrics
but missing *degraded contracts* at three merge/fetch seams (OBS-1/3) plus the
two silent-write failure classes (OBS-4/8) — all five clear the B7 bar and are
material; the rest is worthwhile but gate-discretionary, and OBS-7's proposed
React boundary overpromises since PM exceptions in dispatch/DOM handlers
bypass error boundaries entirely. The privacy whitelist survives adversarial
reading with two residual cracks the plan text should acknowledge:
`note_anchor_invalid_ref` is the single sanctioned ref_id in logs, and a
*sequence* of such events during an index-drift incident reconstructs a
partial reading/linking trail — acceptable only because the trigger is a bug
burst, and worth capping (log first-N per session or kind+hash); and
`note_anchors_degraded`'s signed-in-only existence still marks "a signed-in
user read book/chapter X," which at single-digit DAU is effectively
identifying even without userId — unavoidable in request-correlated logs, but
it should be a stated acceptance, not an accident. OBS-1's `message` field
potentially echoing the tsquery is a non-leak in practice since
`search_executed` already logs `q` house-standard, but the code-only fallback
panel-1 proposed should be kept.
