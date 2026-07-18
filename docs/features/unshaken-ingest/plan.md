# Plan — unshaken-ingest (Phase A1)

Design input: [docs/design/media-collections.md](../../design/media-collections.md)
(all §rules apply; this plan implements phase A1 only — stages 1–3 + load, NO
extraction (A2), NO UI (B)).

## Tier

**large** — risk axes tripped: data migration (two new tables + role-entitlement
grant — always-escalate), behavior change (prod data + search projections),
cross-system (drizzle schema in @lumen/scripture consumed by MCP, additive),
external dependencies (yt-dlp, Deepgram). Justification: prod schema + pipeline
novelty; UI axis absent (deferred to B).

## Goal

Ten Unshaken CFM deep-dive episodes in prod as `content_item` entities with
full timestamped transcripts, title-parsed chapter anchors, and search
projections — via a reusable, staged, resumable podcast-ingestion workflow.

## Probe results (2026-07-17, all live)

1. **Channel**: youtube.com/c/Unshaken. Two content shapes — weekly deep dives
   titled `Come Follow Me - <block> - <subtitle>` (2.5–6.1h) and short topical
   clips (20–55min, ~7:1 ratio). **Filter: title `^Come Follow Me` selects deep
   dives.** Clips out of scope (candidate future collection).
2. **Episode window** (9 found in first 80 uploads; 10th lies deeper — Exodus
   era): `4pSrikfJ5Yw` 2 Kgs 14–25 (3.6h, uploaded 2026-07-12 = this week ✓),
   `6lXWLIOUKC8` 2 Kgs 1–13 (4.7h), `RLirbnj-kGk` 1 Kgs 12–22,
   `O3SiM9Yi940` 1 Sam 17–2 Sam 10 (4.9h), `ivzxaLpbZws` 1 Sam 8–16,
   `jMYk190JBys` Ruth & 1 Sam 1–7, `8SvK7L87o1A` Joshua (whole book),
   `ki0bTvQsaCo` Numbers (6.1h), `yAQlljeet-0` Leviticus. Nine sum to 38.4h;
   ten ≈ **42–44h**.
3. **Title grammar is NOT one regex** — observed live variants: `Book C1-C2`;
   cross-book `1 Samuel 17 - 2 Samuel 10`; multi-book `Ruth & 1 Samuel 1-7`;
   whole-book `The Book of Joshua: <subtitle>`. All nine real titles are
   harness fixtures verbatim (user-roles lesson: fixtures carry the
   adversarial input).
4. **Sample video** (`4pSrikfJ5Yw`): `playable_in_embed: True` ✓; no manual
   subtitles; **creator chapters ABSENT** (a third-party page claimed they
   exist — refuted for our sample; downgrade to capture-if-present, never
   depend).
5. **Deepgram terms VERIFIED**: $200 signup credit, no card, credits don't
   expire; Nova-3 $0.0077/min ≈ 433h coverage. Our run ≈ **$20 of credit**.
   Key already in root `.env` (`DEEPGRAM_API_KEY`).
6. **CFM context**: 2026 = Old Testament; week of Jul 13–19 = 2 Kings ("He
   Trusted in the Lord God of Israel") — matches episode 1's block.
7. **Entity density (risk 7) — resolved with a design correction**: at
   CHAPTER granularity the window's books have zero persons/principles (only
   summaries + art). At VERSE granularity + summary FEATURES the pool is rich:
   **1,029 persons, 802 places, 249 events, 141 principles, 91 symbols**.
   → A2's candidate lists MUST derive from verse-level edges + summary
   entities within the episode's chapter range. Recorded here for A2's plan.

## Scope

- **In**: migration (transcripts, search_index, `admin.collections` append to
  admin role entitlements); `scripts/ingest-podcast/` stages discover / fetch /
  transcribe / load (extract is A2's slot — the stage interface reserves it);
  show config for Unshaken; run on the 10-episode window; smoke additions;
  drizzle defs + vocab usage (`content_item`, category `podcast`).
- **Out**: extraction/edges (A2); any UI (B); Neo4j (graph-membership);
  transcript search UI (search feature); clips collection.

## Design (delta to design doc)

- **Show config** (`scripts/ingest-podcast/shows/unshaken.mjs`): channel URL,
  `collection` row values, title filter regex, block-parse grammar hooks,
  episode entity id scheme `unshaken-<videoId>`.
- **Stage artifacts** under `data/podcasts/unshaken/`: `episodes.json`
  (discover), `<id>.m4a` (fetch), `<id>.deepgram.json` (transcribe, utterances
  verbatim), `<id>.load.json` (projection preview). Gitignored except
  episodes.json (small, reviewable).
- **Anchors in A1**: title-parsed chapter spans → `DISCUSSES` edges
  episode→chapter (`chapters.id`), metadata `{source: 'title', confidence: 1}`,
  mentions array EMPTY until A2. Whole-book blocks anchor every chapter of the
  book (default; open Q3).
- **Search projections (A1)**: one `search_index` row per episode — title (A),
  subtitle (B), block label (C); payload `{episode}`. Transcript blocks are
  searchable via their own generated tsvector (design §schema); no per-block
  search_index rows in A1.
- **Transcribe**: Deepgram prerecorded, nova model, `utterances=true`,
  `smart_format=true`, keyterm boost fed from window-book person/place names
  (probe 7 pool). Upload local m4a (no URL fetch — alignment invariant:
  bestaudio of the SAME videoId we embed).
- **Load**: one tx per episode; idempotent (episode re-run = delete+reinsert
  its entity/transcripts/edges/search rows — INCLUDING an explicit
  `DELETE FROM lumen.edges` scoped by episode + collection, since edges have
  no PK/cascade [COR-1]); collection row upsert (`unshaken`, tier `app`,
  category `podcast`, storage `link`, provenance `youtube`, license `embedded
  playback; transcript indexed`, **`public=false` until Phase B flips it
  deliberately** [REL-8]); `buildLoadPlan` returns a `summary`
  ({entities, transcripts, edges, search}) asserted by tests and printed by
  the house `log(event,data)` convention with a `*_done` roll-up per stage
  [CON-7]; invariant checks post-load (counts, FK, orphans, vocab smoke).

### Panel-driven deltas (step 6; harness-pinned where testable — CON-7's
### logging convention is implementation-verified, not test-pinned)

- **Migration** gains a PARTIAL unique index on `lumen.edges
  (from_id, to_id, rel_type) WHERE collection_id = 'unshaken'` — the blanket
  index would abort on 1,578 live phase-b duplicate tuples (panel-2 live
  probe); and `ROLE_GRANT_SQL` is scoped `WHERE slug = 'admin'` [SEC-4].
- **Secrets hygiene**: shared `scrubSecrets` (house scrub + bearer-token +
  known-key redaction) on every stage fatal [SEC-1/2]; child processes get a
  SUBTRACTIVE env (strip `DEEPGRAM_API_KEY`/`DATABASE_URL`, keep the rest —
  PATH-only would break yt-dlp) [SEC-3 amended]; `assertVideoId`
  `^[A-Za-z0-9_-]{11}$` before any argv [SEC-5].
- **Resumability is validated, not assumed** [CON-8/H10]: a stage skips only
  when its artifact exists AND passes a validity check (episodes.json parses +
  count matches; m4a is final-named and non-empty; deepgram.json passes
  `validateUtterances`). yt-dlp's default `.part`+rename is load-bearing —
  `--no-part` is asserted absent [REL-2 residual].
- **Transcript coverage**: `validateUtterances` takes `{durationS,
  tailToleranceS=300}` and rejects transcripts whose last utterance ends more
  than the tolerance before the episode's known duration [REL-1].
- **Transcribe order**: the LARGEST file (Numbers, 6.1h/~500MB) runs FIRST as
  the upload-mechanics probe before the batch [REL-3].
- **Driver type trap**: postgres.js returns `numeric` as string — all
  `t_start_s` reads Number()-coerce, and smoke asserts `typeof === 'number'`
  before the ±2s content check [COR-5].
- **entitlements-keys.ts + DB grant land in the same commit** — a partial
  land bricks grant-role.mjs via the unknown-key refusal [SEC-7].

## Plan amendment 1 (2026-07-17, post-gate — Abram: "as async as it can be")

Concurrency is runner-shell orchestration over the unchanged tested cores
(portability invariant 1); per-episode independence (invariant 3) makes it
safe. Model:

- **Pipelined per-episode chains** (fetch → transcribe → load) with
  PER-RESOURCE pools, not one global knob: fetch pool **2** (YouTube-throttle
  politeness; each download also passes yt-dlp `-N 4` fragment concurrency),
  transcribe pool **3** (held prerecorded requests = overlapped server-side
  processing; free-tier concurrency cap VERIFIED at dry-run, configurable),
  load **serial** (seconds each; clean logs; trivially safe upsert).
- **Serialization points kept**: discover once, first; REL-3's probe — the
  largest file (Numbers) COMPLETES transcription before other transcribes
  start (fetches may proceed underneath).
- **Failure isolation**: an episode's failure logs and continues; run exit 2
  on partial completion (house exit-code convention).
- **Streaming uploads**: transcribe streams the m4a from disk; never buffers
  whole files in memory.
- **Harness delta**: `util.mjs` gains pure `runPool(taskFns, limit)` —
  order-preserving results `{ok, value|error}`, concurrency ≤ limit, sibling
  isolation on failure — pinned by a new test.
- Rationale: wall-clock ≈ max(resource-class totals) instead of their sum;
  the future workflow system's fan-out replaces the pools without touching
  any tested contract.

## Plan amendment 2 (2026-07-17, step 8 — harness-revision, no weakening)

First implementation run: 41/44 green; the 2 failures were a HARNESS
CONFLICT, not code bugs — the H8 and edges tests located their statements by
first-match-any (`/lumen\.(edges|search_index)/`), which now matches the
DELETE pass that COR-1's incorporated fix itself mandates. Revision: both
finders target `INSERT INTO …` explicitly. Assertions unchanged; finders
strictly more precise. Panel re-trigger over a two-regex finder fix judged
disproportionate — waived, logged for retro per the conflict protocol.

## Plan amendment 3 (2026-07-17, step 13 — drift honesty + fix-round deltas)

- **Concurrency, as actually shipped (supersedes Amendment 1's prose):**
  rest FETCHES run concurrently with the probe chain (B8); the REL-3 gate
  serializes only TRANSCRIPTION behind the probe; fetch→transcribe remains a
  phase boundary (the CPIPE-2 streaming rewrite is REJECTED — zero
  steady-state payoff at 1 episode/week; true pipelining arrives free with
  workflow-hosting fan-out); loads run inside the chain pool, ≤pool
  concurrent, NOT serial (safe: row-locked upsert, 60s guards, idempotent).
- **Archive semantics (N1 adjudication):** the collection GROWS — the
  10-episode window scopes THIS ingest, never a retention policy. No pruning.
  Retitle/delete reconciliation belongs to workflow-hosting.
- **Transcribe cache is deliberately parameter-blind (CCOR-5):** a valid
  cached transcript is reused across keyterm/model changes — re-costing the
  batch to chase parameter drift is the worse trade. Force with artifact
  deletion.
- **Runner invocation contract (B1):** the runner OWNS a per-invocation log
  (`run-<ts>-<pid>.log`); invoke bare — never through tee (exit-code masking
  was run-1's silent-failure vector).
- **Artifacts:** `<id>.load.json` line DROPPED (never consumed; dry-run logs
  the summary). `episodes.json` now genuinely committed (B6; layered
  gitignore negation).
- **Harness delta:** +8 repro tests (+1 R2 open-end label case post-verification) (B1-B5, B7, B9) + cli.mjs contract; B8
  repro-deferred (structural — verify via next backfill's mtime overlap);
  B10 fix-only (low, single-parse-site by construction).

## Files touched

- `packages/scripture/src/schema.ts` (edit — transcripts + search_index defs)
- `packages/scripture/src/vocab.ts` (no change expected; validation consumer)
- `scripts/migrate-media-collections.mjs` (new — DDL + role grant + invariants)
- `scripts/ingest-podcast/{index.mjs,discover.mjs,fetch.mjs,transcribe.mjs,load.mjs,parse-title.mjs,util.mjs,shows/unshaken.mjs}` (new)
- `apps/web/app/lib/entitlements-keys.ts` (edit — `admin.collections`; same
  commit as the DB grant [SEC-7])
- `scripts/smoke-media.mjs` (new — post-load invariants; value assertions per
  strongs lesson: sample transcript CONTENT, not just counts)
- `scripts/__tests__/ingest-podcast.test.mjs` (new — harness)
- `docs/features/unshaken-ingest/*` (this flow)

## Public contract

- `lumen.transcripts`, `lumen.search_index` (DDL per design doc §schema)
- `lumen.collections` row `unshaken`; `lumen.entities` rows
  `unshaken-<videoId>` (`content_item`, media descriptor per design)
- `lumen.edges`: episode→chapter `DISCUSSES` (title-sourced)
- admin role gains `admin.collections` entitlement (key added to
  entitlements-keys.ts; no route until B)
- No HTTP/UI surface changes.

## Failure modes (each → harness assertion)

1. Title grammar variant misparsed → wrong/missing anchors. (H1: all 9 live
   titles + hostile synthetics: subtitle containing " - ", "&" in subtitle,
   unicode dashes.)
2. Episode title containing SQL-meaningful chars flows into entities/search.
   (H2: injection fixtures; parameterized-only writes.)
3. Transcript seconds off the embedded timeline (wrong audio variant fetched).
   (H3: fetch stage asserts videoId of downloaded stream == embed id; seek
   floor t−2s documented, not sub-second.)
4. Re-run duplicates rows / partial-failure leaves orphans. (H4: idempotency —
   run load twice, counts identical; kill mid-episode, no orphans (tx).)
5. Deepgram response shape drift / empty utterances. (H5: transcribe stage
   validates utterance schema + non-empty + monotonic timestamps before
   writing artifact; degraded episode halts THAT episode only.)
6. Migration re-run unsafe / grant clobbers role. (H6: DDL idempotent;
   entitlements append preserves existing keys (user-roles B8 ⊇ pattern).)
7. Whole-book anchor explosion sanity. (H7: Joshua → exactly 24 chapter
   edges, no verse-level rows in A1.)
8. Search projection weight regression. (H8: title match outranks block-label
   match for a fixture query.)
9. DSN/secret leakage in any stage error path. (H9: scrub on all fatals; key
   never in argv (env only) — argv leaks via ps.)

## Harness scope

**behavior** — harness-first REQUIRED. Runner: `scripts/__tests__` node tests
(DI: stage fns take injected exec/fetch/sql fakes; the house pattern). Live
gates: `--dry-run` per stage; smoke-media post-load with CONTENT value
assertions (a known utterance substring from ep 1 at a known ±2s timestamp).

## Learnings surfaced (step-2 requirement)

- strongs: content VALUE assertions in smoke (existence passes while content
  is wrong); mismatch-histogram before fixing alignment classes; tuned dry-run
  caps reject real classes.
- supabase-auth: adversarial must re-run PROPOSED fixes; probe live behavior
  not settings (done: embed flag probed, not assumed).
- user-roles: totality tests need adversarial inputs (9 real titles + hostile
  synthetics); fix-verification pass after fix rounds; key workflow results by
  index/enum never prose echo.
- art-graph: per-INSTANCE disambiguation (deferred to A2 but recorded);
  plan-time data probes wrote exact expectations (episode list above is the
  dry-run's expected input).
- canon-spine: DDL/gate logic exported + testable, not inline.

## Open questions (human gate, step 7)

- Q1 10th episode: take the next `^Come Follow Me` upload deeper in the feed
  (Exodus-era). **Default: yes — "10 most recent CFM deep dives."**
- Q2 Clips: excluded entirely this feature. **Default: yes; noted as future
  collection.**
- Q3 Whole-book blocks anchor all chapters of the book. **Default: yes.**
- Q4 Load target: direct-to-prod with per-stage dry-runs (house pattern), no
  staging DB. **Default: yes (0-user surface; collection kill switch exists).**
- Q5 Keyterm list size: Deepgram keyterm limits unknown-ish — cap at top-N
  (by edge count) window persons/places. **Default: N=100, measured at
  transcribe dry-run.**

## Decisions (step 6 — panel-1 × panel-2 synthesis, 2026-07-17)

Tags per panel-2 (per-role files canonical); resolutions per adversarial.md
mapping; tie-break human > panel-2 > panel-1; safety carve-out exercised where
noted. 32 findings: 14 incorporated · 4 rejected-with-rationale ·
1 deferred-out-of-scope · 13 dropped-as-noise.

| ID | Resolution | Note |
|---|---|---|
| SEC-1 | incorporated | scrubSecrets on every stage fatal; harness-tested |
| SEC-2 | incorporated | bearer-token + known-key redaction added to scrub |
| SEC-3 | incorporated | SAFETY CARVE-OUT (security-high survives risky tag); fix AMENDED to subtractive env — panel-2 proved PATH-only breaks yt-dlp |
| SEC-4 | incorporated | `WHERE slug='admin'` scope asserted |
| SEC-5 | incorporated | videoId charset gate before argv |
| SEC-6 | dropped-as-noise | leak mechanism refuted (validated-utterances-only artifact) |
| SEC-7 | incorporated | entitlements-keys.ts in Files-touched; same-commit rule |
| SEC-8 | dropped-as-noise | staged/cached design already fences yt-dlp brittleness |
| COR-1 | incorporated | delete-first half only; blanket unique index rejected on 1,578 live phase-b dups → PARTIAL index `WHERE collection_id='unshaken'` |
| COR-2 | incorporated | load-plan edge totality (Joshua=24) asserted via plan.summary |
| COR-3 | dropped-as-noise | loud, immediate, zero-data-risk failure |
| COR-4 | dropped-as-noise | speculative vs single-creator titles; 9/9 live covered |
| COR-5 | incorporated | Number() coercion + typeof smoke assert (driver returns numeric as string) |
| COR-6 | dropped-as-noise | inert in A1 (seq-ordered storage, ±2s slop accepted) |
| COR-7 | dropped-as-noise | live-query lookup adopted as impl note; DI fixtures correct |
| REL-1 | incorporated | duration-coverage check, tolerance 300s default |
| REL-2 | dropped-as-noise | premise refuted: yt-dlp `.part`+rename is default; residual `--no-part` assertion adopted; carve-out considered, declined on tool evidence |
| REL-3 | incorporated | largest-file-first upload probe before batch |
| REL-4 | rejected-with-rationale | low-prob + recoverable; CON-8's H10 validity gate delivers the protective half; episodes.json committed/reviewable |
| REL-5 | dropped-as-noise | $200 non-expiring/no-card credit, 10× headroom; billed-minutes logging folded into CON-7's summaries as observability, not risk |
| REL-6 | rejected-with-rationale | subsumed by Q5 (cap at N=100, measured at transcribe dry-run) |
| REL-7 | dropped-as-noise | 2–3GB trivial; disk-full fails loudly |
| REL-8 | incorporated | tag/prose mismatch — rationale argues fail-safe+cheap; substance followed: `public=false` until B. Logged for retro |
| CON-1 | rejected-with-rationale | dry-runs + content smoke exercise the seam; plan text clarified: discover owns the enrichment (emits canonical episodes.json shape) |
| CON-2 | dropped-as-noise | parse-title.mjs added to Files-touched as text fix |
| CON-3 | dropped-as-noise | grammar hook premature for one show; reuse future |
| CON-4 | dropped-as-noise | premise dissolves vs proto's actual descriptor usage |
| CON-5 | rejected-with-rationale | C ⊂ title(A), search deferred; unpinned C flagged for code-panel attention |
| CON-6 | deferred-out-of-scope | block deep-link payload is the search feature's remit (already noted in plan) |
| CON-7 | incorporated | house log(event,data) + `*_done` summaries per stage |
| CON-8 | incorporated | H10 skip-only-when-valid, per-artifact validity contracts |
| CON-9 | dropped-as-noise | contradiction dissolves: mentions empty ⇒ no per-mention carrier; edge-level confidence coherent for title anchors |

## Drift baseline (stamped end of step 6)

Method (reproducible): harness-hash = `shasum -a 256
scripts/__tests__/ingest-podcast.test.mjs`; plan-hash = `sed '/^## Drift
baseline/,$d' docs/features/unshaken-ingest/plan.md | shasum -a 256` (the
baseline section excludes itself).

- plan-hash: 666521bfe2b7388f188fd04ef4db4c789fb7bab4b963dfb5f3f5d2c1ea70d910
- harness-hash: d3567e5a570f0ab783103c1bcd08de01c5fa69395ad754bafe94db4bae4f19f9
