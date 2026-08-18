# No-block extraction — implementation map

Generated 2026-08-18 by a 4-reader recon workflow + synthesis over the
live code; supersedes nothing — it OPERATIONALIZES docs/design/second-show.md §3.

IMPLEMENTATION MAP — no-block extraction variant (spans:null), synthesized from four reader reports + verification reads of `extract.mjs`, `extract-lib.mjs`, `.claude/workflows/unshaken-enrichment.mjs`, `docs/design/second-show.md:100-133`, `docs/features/unshaken-extraction/plan.md`.

**Mode signal**: `titleParseMode(show) === 'verbatim'` ⇔ `ep.spans === null` (`scripts/ingest-podcast/show-shape.mjs:26-28`). Derive one boolean `noBlock` per episode and thread it through both stages; never infer it twice differently (the merge stage's pure re-run contract, `extract.mjs:107-108`).

## 1. No-block verse resolution — exact edits

**1a. Crash guard first.** `anchorsForBlock` (`scripts/ingest-podcast/parse-title.mjs:86-98`) iterates `spans` with no null guard — `extract.mjs:419` and `:563` throw `TypeError: spans is not iterable` before any logic runs. Either add a null-tolerant wrapper returning `[]` or branch at both call sites. With `episodeChapters = []`, `deriveBookMaps` (`extract.mjs:55-75`) conveniently yields `bookAliases = {}` and `foreignBooks` = the FULL book-alias→book-id map (ordinal + ASR variants included) — reuse this as the citation lexicon.

**1b. Full-canon verseExists.** `extract.mjs:422-424` scopes the verse set to `chapter_id = ANY(episodeChapters)` — empty in no-block. Branch: `SELECT id FROM lumen.verses` (no WHERE) when `noBlock`. Read-only, `lumen_read` is fine.

**1c. New citation parser.** Critical gap the design doc glosses: `parseSpokenVerseRefs` (`extract-lib.mjs:162-211`) parses ONLY bare "verse X" shapes — there is no book-qualified form anywhere. The regex shape for book citations already exists in `detectForeignWindows` (`extract-lib.mjs:230-245`): `\b<alias>\s+(?:chapter\s+|section\s+)?NUM\b`. Add `parseBookCitations(text, bookAliasMap)` to extract-lib.mjs producing `{book_id, chapter_num, position}` per match, plus the inline-entry form "verse three of Second Kings 21" (pattern precedent at plan.md item 1, `docs/features/unshaken-extraction/plan.md:59-62`).

**1d. New resolution path inside `runDeterministicExtraction`** (`extract.mjs:109-311`), gated on `noBlock`:
- Skip timeline entirely: no `detectChapterTransitions` (:126-133), no chapter mentions (:149-159), no `firstSegT` filter (:162, 186-189 — this is the filter that drops everything today), no `chapterAt` governing check (:190-191).
- Skip `detectForeignWindows` (:120-125) — with no block, "foreign" is meaningless; the citation parser subsumes it.
- Per utterance: run `parseBookCitations` + `parseSpokenVerseRefs`. A bare verse ref resolves iff a book-chapter citation appears in the SAME utterance at an earlier position (governing context = nearest preceding citation in-utterance). Chapter id = `<book_id>-<chapter_num>`; verse id = `<chapter_id>-<verse>` checked against full-canon `verseExists`. Bypass the `episodeChapters.includes` gate in `resolveVerseRef` (`extract-lib.mjs:352-354`) — either a `noBlock` option or a variant resolver; do NOT pass a fake episodeChapters list.
- Bare verse refs with NO same-utterance citation: drop and count in a new `counts.noContextDropped` (design requirement "count them so the loss is visible", second-show.md:118-120). Also count `counts.citationResolutionFailures` for cited-but-nonexistent verses. These counts flow into `buildCoverageBlock` (:313-379) and the judgment brief.
- `lastVerse` relative-ref chain (:192-195): keep, but scope it to the same-utterance governing chapter; reset per utterance in no-block mode (cross-utterance carry is what the design explicitly declines to do in v1).
- Keep `RANGE_CAP = 40` (:37) and the confidence ladder (explicit 0.95 / range 0.9).

**1e. Merge-stage symmetry.** `runExtractMerge` re-runs the deterministic pass (:597-607) with `timelineOverride: judgment.timeline`. In no-block: pass `timelineOverride: undefined`, `noBlock: true`, and make `readJudgment` (:491-545) NOT require `timeline-review` — with `episodeChapters = []` the validator at :510 rejects every segment anyway, and its absence must not push `timeline-review` into `missing` (:532) or `judgmentComplete` can never be true and `checkLoadGate` (`load-extraction.mjs:24-29`) blocks every episode. Required-artifact set in no-block = `{aliases, principles.0, principles.1}`.

**1f. Surfaces are already compatible** (surfaces reader): DISCUSSES/MENTIONS/TEACHES land under `${collectionId}-extraction` via the insert path (`load-extraction.mjs:88-98` — no `-youtube` title edges exist for verbatim shows, so `titlePairs` classification at :48-51,74 finds nothing to UPDATE). media.tsx per-paragraph verse refs, scripture.tsx Heard-in + dots, node.tsx quote sections all light up; the Chapters rail stays dark by construction (`media.tsx:93-97` reads only `-youtube`) — expected, guarded empty (`media.tsx:756, 792`). Fix the overstating comment at `media.tsx:754-755` while there.

## 2. Candidate-pool replacement query

Replace `fetchCandidatePool(sql, episodeChapters)` (`extract.mjs:77-93`) with a two-leg UNION, called at both :421 and :565:

```sql
-- Leg A (episode-invariant, compute ONCE per run and pass down):
SELECT e.id, e.name, e.entity_type
FROM lumen.entities e JOIN lumen.edges ed ON ed.from_id = e.id OR ed.to_id = e.id
WHERE e.entity_type IN ('person','place','event','principle','symbol')
GROUP BY e.id, e.name, e.entity_type
ORDER BY count(*) DESC LIMIT ${topN}
-- Leg B (per episode): identical shape to the current query at extract.mjs:79-92
-- but patterns = bookIds.map(b => `${b}-%`)  (verse ids prefix with chapter ids
-- which prefix with book ids — one-token change)
-- Merge: UNION / DISTINCT ON (id) in SQL or dedupe by id in JS.
```

Precedent for leg A is the keyterm query at `index.mjs:474-478` (add `e.id`, `entity_type`, all five types). `bookIds` = the set of book ids whose aliases (from the full `foreignBooks` map, 1b) appear as citations in the utterances — a pre-scan between `utterancesToRows` (:418) and pool build. **Both stages must derive the identical bookIds set from the same inputs** — the cache fingerprint (:397-416, utteranceCount + duration) does not cover pool contents, so divergence silently changes merge output. Cap principles: `pool.principle` flows uncapped into the brief's `principlePool` (:465-ish) — a global pool balloons it; cap principles to the top-degree N_p (~50) or restrict leg A to person/place/event/symbol and take principles only from leg B. Keep the disambiguation machinery (:249-277) untouched — it operates on the pool and fail-closes on collisions, which is the point. Update the A1-probe rationale comment at :77-78 to record both scoping modes.

## 3. Eval parameterization (`scripts/extraction-eval.mjs`)

1. Kill module-load hardwiring: DIR/SHOW/EPISODES (:17-20; SHOW at :19 is dead — delete). Derive dir + episodes from `--show` via `scripts/ingest-podcast/shows/*.mjs` + `show-shape.mjs` accessors, inside `main` (:551-556) — the module currently fails on import if the unshaken dir is absent.
2. Route every DIR consumer through the parameter: `loadArtifacts` (:56-64), `transcriptLines` (:66-68), `buildContext` (:259-291, including the second episodes.json read at :261), round dirs (:301, :366). The verdict MUST keep writing to `join(<show dir>, 'eval-verdict.json')` (:529) — that path is what `index.mjs:425-434` reads, and `episodeHashes` keys stay show-prefixed `${show.id}-${ep.id}` (already correct: keyed by `a.episodeId`, :74).
3. Spans:null branch in `buildContext` (:269): `anchorsForBlock` throws (same crash as 1a). With no block: verse-trap and chapter-trap target swaps (:172-177) have no block to swap within — derive trap alternates from the set of chapters actually CITED in the episode's extraction instead (swap to an uncited-but-existing verse in the same cited chapter); chapter stratum is empty by construction (no chapter mentions in no-block), so the chapter stratum must be skippable without tripping the sub-floors (:122, :494) — make STRATA per-mode.
4. Drift baseline (:381-384) pins `docs/features/unshaken-extraction/{plan.md,eval-prompt.md}` — adopt a per-show convention (`docs/features/<show>-extraction/` or a shows/-adjacent prompt file) and stamp per show.
5. Sequencing note from the design doc (second-show.md:127-130): the human eyeball gates the validation trio; the eval harness gates the fleet. So the eval work can land AFTER 1-2 ship, but `checkLoadGate` (`load-extraction.mjs:16-31`) hard-requires a passing verdict file before ANY load — no-block episodes cannot load until this is done (or the gate grows an explicitly-logged per-show override, which touches load safety and should be escalated to Abram, per CLAUDE.md escalation rules — it gates prod writes).

## 4. Prompt changes (spans:null)

The live prompts are in `.claude/workflows/unshaken-enrichment.mjs` (NOT `buildChunkPrompt`/`buildTimelinePrompt` in extract-lib.mjs:560-598 — those and the `prefilterCandidates` import at `extract.mjs:18` are dead code from the pre-Revision-1 API design; consider deleting rather than adapting).

- **Judgment brief** (`extract.mjs:458-475`): when `noBlock`, OMIT `blockChapters` and `timeline` (not sent empty — second-show.md:132-133), omit coverage's `zeroSegmentChapters`, add the new drop counts from 1d. `zeroHitPoolNames` (:334-337) is noise under a global pool — restrict it to leg-B (book-linked) entities before it feeds `aliasCandidates` (:469-472), or the alias judge drowns.
- **Workflow** (`unshaken-enrichment.mjs:174-181`): no-block episodes launch 3 agents, not 4 — drop the timeline agent (its prompt at :113-134 is meaningless without blockChapters, and merge ignores its output per 1e). `aliasPrompt` (:87-111) and `principlesPrompt` (:136-158) need no text changes — neither references block context. Parameterize the workflow's `DIR` (:16, hardwired `data/podcasts/unshaken`) by show, same move as the eval.

## 5. LLM cost per episode-hour

External API dollars: **$0** — extract.mjs contains no API client by design (header, `extract.mjs:1-5`); enrichment is Claude Code subagents on the session's own quota (plan.md "Cost" section, Revision 1). Token load, from the recorded corpus measurement (plan.md item 6: 577k transcript tokens over the Unshaken corpus ≈ 12-16k transcript tokens per audio-hour, consistent with ~150 wpm speech):

- Block mode today: 4 agents/episode; principles pair reads the full transcript between them (1.0×), timeline judge ~1.0× (high effort), alias judge slices ~0.3× → ~2.3× transcript ≈ **30-40k input tokens per episode-hour** + brief (~2-5k) + agent overhead.
- No-block mode: timeline agent gone → ~1.3× transcript ≈ **18-25k input tokens per episode-hour**, ~3 subagent invocations per episode (2 medium + 1 medium effort). Output is small (bounded JSON; principles capped 30/window). For SoJ's 58 episodes at interview length (~1h), order 1.5M session input tokens total. If it were priced as API at Opus-class rates this would be roughly $0.30-0.60 per episode-hour, but the operative budget is subagent quota, not dollars.

## 6. Risks / unknowns

1. **Two-stage determinism**: bookIds derivation and pool contents are outside the cache fingerprint (:397-416); any nondeterminism (query LIMIT ties in leg A, ordering) makes extract-merge's re-run diverge from extract-code. Order leg A `count DESC, e.id` for a stable tiebreak; consider adding a pool hash to the fingerprint.
2. **Ambiguity blowup fail-closes silently**: a global pool multiplies duplicate-name (`naaman-1`/`naaman-2`) and contained-name exclusions (:249-266); high-degree entities have common names, so top-N is adversely selected. Surface the exclusion count in coverage so shrinkage is visible; tune N against it.
3. **Alias gate loosens**: `validateAliasTable`'s pool-membership check (`extract-lib.mjs:320`) now admits aliases binding to popular but episode-irrelevant entities. Mitigation: validate alias ids against leg-B + zero-hit-restricted set, not the whole global pool.
4. **Same-utterance context rule is a design decision, not in the doc**: the doc says bare refs "without a book context" drop, but doesn't define context scope. Same-utterance (recommended, fail-closed) vs. carried-across-utterances (higher recall, higher wrong-anchor risk — an interview can drift topics without re-citing). Confirm with Abram before widening.
5. **Silent drop at :190-191** (`if (!governing) continue;` — uncounted even in block mode) — while touching this loop, add it to `counts` in both modes; free observability.
6. **Load gate deadlock** (3.5): no eval → no verdict → `checkLoadGate` blocks all no-block loads. Decide order-of-work up front; any gate override touches prod-write safety → escalate.
7. **Eval trap validity in no-block is unproven**: traps derived from cited-chapter alternates (3.3) have no precedent in this harness; trap under-fill only warns (:520-524), so a thin trap pool can quietly weaken the gate — check the warning output on the first `--build`.
8. **Interview register**: the chapter-gold regex (:135) and STRATA floors assume CFM chapter-walk episodes; interviews may cite few verses at all, tripping `nFloor` — per-show STRATA/GOLD_COUNT tuning (eval reader item 4) is likely mandatory, not optional.
9. **Premise correction carried from the surfaces reader**: mentions-preserving upsert lives in `load.mjs:160-171`, and `load-extraction.mjs` writes title-edge mentions via plain UPDATE (:74-86, count===1 assert :132-147) — irrelevant for verbatim shows (no title edges) but do not "fix" it while in there.
10. **Design-rationale hygiene**: block-scoping of the pool is a recorded A1-probe correction (:77-78); the deferred design overrides it deliberately — update the comment trail or the next reader re-litigates it.
