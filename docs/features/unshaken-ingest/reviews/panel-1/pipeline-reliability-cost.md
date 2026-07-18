# Panel 1 — Pipeline Reliability + Cost (unshaken-ingest A1)

Lens: reliability/cost/blast-radius of the 5-stage resumable pipeline over
~44h audio / 10 episodes, run manually. Implementation does not exist yet
(`scripts/ingest-podcast/` absent; `harness-initial.log` confirms the
harness fails on missing modules) — findings are against plan.md +
design/media-collections.md + the harness contracts as written.

| ID | Severity | Where | Problem (≤25 words) | Fix (≤30 words) |
|---|---|---|---|---|
| REL-1 | High | plan.md H5 (L125-127); harness `validateUtterances` (test.mjs L155-167); `durationS` field exists on episode records (test.mjs L188) | Utterance validation checks non-empty, monotonic, non-negative only — never compares final timestamp against the episode's known `durationS`. Truncated audio "passes." | Assert last utterance `end` is within tolerance (e.g. 30s) of `durationS` before writing the artifact; fail the episode otherwise. |
| REL-2 | High | plan.md Stage artifacts (L70-73); design.md risk register #5 ("yt-dlp is brittle by nature," L171-172); no atomic-write test in harness | No atomic-write contract for fetch: a network/disk death mid-download of a 4-6h file leaves a truncated `<id>.m4a` that "artifact exists ⇒ skip" treats as done. | Download to `<id>.m4a.part`, rename only after yt-dlp exits 0; resumability check must stat the final filename, never the partial. |
| REL-3 | High | plan.md L82-85 (Transcribe spec); Probe result 5 (L43-45, verifies pricing/credit terms, not upload mechanics) | Sync-vs-async for a 6.1h/~500MB upload (Numbers, longest of 10) is unverified — plan confirms pricing, not whether the prerecorded endpoint handles multi-hour uploads without timing out. | Probe the sync endpoint on the largest real file first; if it times out, use callback/async polling and add retry-on-disconnect around the upload call. |
| REL-4 | Med | plan.md Stage artifacts (L70-73, `episodes.json` committed); discover test covers filter/rank purity only (test.mjs L113-123), not re-run semantics | Nothing defines `discover.mjs` re-run behavior across a multi-day manual run — a shifted newest-first ranking could silently drop an episode with sunk cost. | Make discover a no-op once `episodes.json` exists (require `--refresh` to overwrite); on refresh, diff old vs new ids and warn/abort if a previously-fetched episode would drop out. |
| REL-5 | Med | plan.md Probe result 5 (L43-45, pre-run estimate only); Q5 (L168-170); no cost field anywhere in stage-artifact spec (L70-73) | The ~$20 figure is a pre-run estimate only — no stage logs Deepgram's actual billed duration per episode, so real spend is never reconciled against credit. | Log `metadata.duration` (or equivalent billed-minutes field) from each Deepgram response into the artifact; sum and print a running total after each episode. |
| REL-6 | Med | plan.md Q5 (L168-170, self-flagged "keyterm limits unknown-ish... measured at transcribe dry-run"); no boundary test for keyterms in harness | N=100 keyterms is an unverified default with no code-level cap — a limit violation would surface only as a 400 after a multi-hour upload. | Before the costed run, confirm Nova's actual keyterm limit against current Deepgram docs; add an assertion in `buildDeepgramRequest` that truncates/rejects an oversized list pre-upload. |
| REL-7 | Low | plan.md Stage artifacts (L70-73, gitignored except `episodes.json`); no disk-budget or retention line anywhere in plan.md or design.md | ~2-3GB of m4a + Deepgram JSON accumulate under `data/podcasts/unshaken/` with no preflight disk check and no stated retention/cleanup policy after a successful load. | Add a free-space preflight check before each fetch; document whether artifacts are deleted after a successful load or kept for re-run/audit (pick one, state it). |
| REL-8 | Low | plan.md Load spec (L86-90, no `public` field set); design.md L103-104 ("`collections.public = false` is the one-statement kill switch"); `packages/scripture/src/schema.ts:77` (default `true`) | Load spec never sets `public`; schema defaults it `true`, contradicting the design's kill-switch framing. Verified nil impact today — no live reader, graph overlay inert. | Have `load.mjs` explicitly upsert `public: false` for the `unshaken` row until Phase B intentionally flips it; assert this in `buildLoadPlan` tests. |

Verification for REL-8 (blast radius, lens g): grepped the app — no route reads
`lumen.transcripts` or `lumen.search_index`; `getChapterArt`
(`packages/scripture/src/queries.ts:151-159`) filters `entity_type =
'artwork'`, which cannot match the new `content_item` rows. The only live
`collections`-table consumer is `getPublicCollectionIds` →
`scripture.tsx`'s `?graph=` overlay, which queries **Neo4j**
(`getNeighborhood`), and no Neo4j mirror exists for unshaken until a future
graph-membership phase — so today's blast radius is nil regardless of the
`public` default. Confirmed via plan.md's own scope line 111: "No HTTP/UI
surface changes."

8 findings — High 3, Medium 3, Low 2.
