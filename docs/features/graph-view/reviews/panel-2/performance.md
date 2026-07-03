# Panel 2 — Adversarial review of Panel 1 performance findings: graph-view

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| PERF-1 | material | `explore-graph.ts:86-101` proves the exact anti-pattern in production precedent; APOC Core `apoc.path.expandConfig`/`subgraphAll` confirmed available on Aura; non-APOC fallback fix also offered. |
| PERF-2 | material | Read `get-neighborhood.test.ts` — confirms no assertion on captured Cypher structurally bounding per-hop work; matches project's own "mock-only tests hid data-shape bugs" retro learning. |
| PERF-3 | material | Reference mock (`lumen-study-v11.jsx:594-595`) literally calls `bump(b=>b+1)` per tick — the plan follows this design; fix (refs/canvas, commit on settle) is standard, low-risk. |
| PERF-4 | material | Confirmed: no `shouldRevalidate` anywhere in app code; recenter would re-run `getVersesByChapter`/`getChapterSummary` needlessly. Fix is a well-known, cheap RR pattern. |
| PERF-5 | material | Confirmed: `cachedJson` mandates an explicit `ttlSeconds`; plan never states one for graph entries despite `CONNECTIONS_TTL_SECONDS` precedent for the same "immutable" data. |
| PERF-6 | out-of-scope | Real gap (fixture shows `name: null` for Verse) but it's a display/correctness issue, not a performance concern — belongs to correctness/UX lens, not this one. |
| PERF-7 | material | Legitimate complement to PERF-3: node-count/viewport threshold for layout fallback is cheap and directly protects the low-end-mobile case the plan already cares about. |
| PERF-8 | material | Plan's Q6 wording ("~35kb lazy chunk") implies one bundle for all d3 packages; splitting `RadialLayout` out is a real, low-risk, low-cost win for reduced-motion/mobile paths. |
| PERF-9 | out-of-scope | Speculative "grows over time" claim with no current cardinality data; plan explicitly defers collections toggle/cardinality to a separate follow-up feature. |

**Stance:** Seven of nine findings hold up under scrutiny — several are corroborated directly by reading the actual precedent code (`explore-graph.ts`, the `ForceLayout` reference mock, the harness test files), not just plausible-sounding theory, and none of the proposed fixes are disproportionate or infeasible (APOC Core is confirmed available on Aura, `shouldRevalidate` and off-React tick handling are standard, low-risk patterns). PERF-6 and PERF-9 are the exceptions: PERF-6 is a real bug but not a performance issue (mislabeled lens), and PERF-9 is a speculative, forward-looking concern about a dimension (collections cardinality) the plan explicitly scopes to a later feature. No finding rose to "risky" — every proposed fix is proportionate to the problem it addresses.
