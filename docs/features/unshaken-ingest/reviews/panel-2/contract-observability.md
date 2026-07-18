# Panel-2 adversarial — Contract + Observability (unshaken-ingest, Phase A1)

Reviewer: PANEL-2 ADVERSARIAL. Calibration: solo-dev, manual runs, ~0 users.
Each finding gets EXACTLY ONE tag. Tie-break: material > risky > out-of-scope > noise.

| ID | Tag | Rationale (≤25 words, with evidence) |
|---|---|---|
| CON-1 | risky | `.id` (test:123) vs `videoId` (test:184) vs prose "videoIds" (L72): unowned, untested transform. But per-stage dry-runs + live smoke exercise the seam; a mismatch self-reveals as `unshaken-undefined`. |
| CON-2 | noise | True — parse-title.mjs absent from Files-touched (L97) though harness imports it (test:9). Inconsequential: the harness-first import already makes the module mandatory. |
| CON-3 | noise | Plan L68 "grammar hooks in show config" vs standalone `parseTitle(title)` (test:75): real mismatch, but threading a hook for a single show is premature YAGNI; reuse is future. |
| CON-4 | noise | Proto's real descriptor DROPS `thumbnail_url` (facade box, podcast-demo.ts:11); `uploadDate` already flows through load (test:187); B is design's stated landing-page owner. Premise dissolves. |
| CON-5 | risky | H8's name promises C but body asserts only A/B (test:221-230); a load omitting the block-label C weight passes — the strongs trap. Low bite: C-terms ⊂ title(A); search deferred. |
| CON-6 | out-of-scope | payload `{episode}` is correct for an episode-level result; block t/seq routing is explicitly the future search feature's remit (design §6:64-66); plan L80-81 already notes blocks search via tsvector. |
| CON-7 | material | `log(event,data)` verified pervasive — identical helper in 8 scripts + `logEvent`, with `*_done`/`invariant_check{pass}` (strongs:195,381). Plan omits logging; a 42h/10-episode run needs `*_done` to answer "9/10 loaded." |
| CON-8 | material | "Resumable + disk-cached … never re-costs" is design-central (§workflow:125, risk-5), yet H1-H9 have no resume/skip mode or test. Skip-without-validity risks partial-artifact wrong-data on a breakage-prone 42h run. |
| CON-9 | noise | §rules-3's per-mention rule governs A2 extraction where mentions exist; A1's title anchor has `mentions:[]` EMPTY — no mention to carry confidence, so edge-level `confidence:1` is a coherent exception, not a contradiction. |

## Overall stance

Panel-1's contract mapping is careful, but its two HIGH calls overshoot: the discover→load seam (CON-1) is genuinely covered by the plan's per-stage dry-runs and content-asserting live smoke and self-reveals on first run, and CON-9's "contradiction" evaporates once you read that A1's `mentions` array is empty — there is no mention for per-mention confidence to attach to, so an edge-level `confidence:1` on a title-sourced anchor is coherent. The findings that actually bite the real 42h/10-episode manual run are the two observability/operability gaps: no adoption of the verified-pervasive house `log(event,data)` convention (CON-7) and no resume/skip failure-mode or test for the design-central "never re-costs" property (CON-8) — both cheap to close and squarely in this review's remit. Everything else is either a latent guardrail gap worth a cheap fix (CON-1, CON-5) or dissolves under the design/proto/harness evidence (CON-2, CON-3, CON-4, CON-6, CON-9).
