# Performance — panel-2 adversarial review (personal-notes)

Verification performed read-only against the repo: scripture.tsx:539-582 /
:597-600, auth.server.ts:87-89/100-121/138, scripture.loader.test.ts:198-209/
258-268, search.ts (score_bits, keyset ORDER BY, mintNextCursor, TSQ 500ms-p95
comment), api.search.tsx:105-136, react-router.config.ts, vite.config.ts,
build/client output, bugs.md B18, punch-list PERF-4 — all citations accurate.
One correction: prosemirror-*/markdown-it are NOT in the pnpm store, so the
"~90–105 kB gz" figure is reasoned from public dist sizes, not locally
verified; the numbers are consistent with published package sizes and the
markdown-it-required-for-MarkdownParser dependency claim is correct.

| ID | Tag | Rationale (≤25 words + evidence) |
|----|-----|----------------------------------|
| PERF-1 | material | Protects the pinned Promise.all loader shape and RR 4950ms stream-abort class; verified scripture.tsx:539-582, :597-600 comment retired, sessionMemo/hasAuthCookie mechanics accurate. |
| PERF-2 | material | CPERF-6 is a pinned invariant; verified the guard (loader.test.ts:198-209) counts only pg-side calls — an N-times PostgREST anchors fetch passes silently today. |
| PERF-3 | material | Verified: score_bits keyset cursor is PostgREST-inexpressible without an RPC; F9 is ambiguous without the no-cursor pin. Parallelization/degradation copies existing decision-7 grammar, no new machinery. |
| PERF-4 | material | F10 says "asserted" with no substrate — verified no build.manifest, no .vite/manifest.json. B18 is the exact deferred precedent. Size figure reasoned, not measured (packages uninstalled); plausible. |
| PERF-5 | material | Verified plain RR7 config: static editor imports in notes.$id.tsx (read+edit route) load on note READING, defeating D7's own goal. B18 shape at ~5x size. |
| PERF-6 | material | Perf impact nil at this scale (review admits), but D6/Q7 is incomplete without a save cadence; fix is one plan sentence + one assertion, zero machinery. |
| PERF-7 | noise | 500 anchors on one chapter is fantasy at single-digit DAU; projection-only select is a one-line implementation detail, not a plan finding. Premature bound. |
| PERF-8 | noise | Reviewer concedes trivial at any N this product sees; stored-HTML column is a strawman nobody proposed — plan already says render-at-read. |
| PERF-9 | noise | Self-tagged noise by the reviewer; ~100 kB min in a Workers SSR bundle is nowhere near limits. Correctly recorded-and-accepted. |

## Stance

This is an unusually well-evidenced review: I verified every file:line citation
and found all accurate, including the two claims flagged for independent check
(no Vite manifest today; RR7 route-splitting puts PM on the note-reading path
because /notes/:id is read+edit in one module). PERF-1 through PERF-5 sit
squarely on pinned invariants (Promise.all shape, CPERF-6, stream-abort class,
F9 cursor contract) or the B18 bundle discipline, and their fixes reuse
existing degradation grammar rather than adding caching or precomputation
machinery — nothing here earned a `risky` tag. The tail (PERF-7/8/9) is honest
about being scale-noise and should be treated as implementation notes, not plan
amendments; the one factual overclaim is "verified from package dist sizes" for
an estimate that was necessarily reasoned, since the packages are not installed.
