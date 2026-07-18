# Media Collections — design input (2026-07-17)

Decisions from design discussion (Abram + Claude), input to the unshaken-*
feature plans. Extends [canon-spine.md](./canon-spine.md); its two governing
principles carry forward unchanged. First media collection: **Unshaken**
(Jared Halverson), 10 episodes starting from the current Come Follow Me week.

## Governing rules

1. **Collection decides WHERE media appears; media kind only decides HOW an
   item renders once there.** Presentation is a per-collection registry in app
   code (`collection-display.ts`), keyed by collection id, values = named
   layout families (`gallery`, `episodes`, …). Unregistered collections are
   **fail-closed for presentation** — queryable, rendered nowhere. No reader
   surface may select media by entity_type/media.kind across collections
   (today's `getChapterArt` violates this — fix assigned to Phase B). When
   community/personal collections arrive, the registry's `family` promotes to
   a `display_kind` column and user collections pick from the fixed set.
2. **Three layers, extending the spine's boundary test:**
   - **Spine** — canonical structure (volumes→…→words). Unchanged.
   - **Claims** — entities + edges under collections. An episode is a
     `content_item` entity carrying a `media` descriptor in metadata
     (`{kind: 'youtube', video_id, duration_s, thumbnail_url}` |
     `{kind: 'audio', url, duration_s}`). Claims extracted FROM media are
     edges (see §edges).
   - **Substrate** — transcripts. Sequenced text content, NOT claims: the
     words-table of media. Dedicated table (§schema), never entity rows.
     Rationale (debated 2026-07-17): full back-catalog ≈ 600–900k blocks
     would make entities >90% transcript filler — polluting entity search
     relevance, the Neo4j backfill verify baseline, and the MCP tools that
     query entities (Ring-2). Promotion door: a specific segment can become a
     `content_segment` entity referencing `(episode_id, seq)` any time;
     the reverse migration would be painful. Start separate, promote on demand.
3. **Aggregated edges.** One edge per `(episode, target, rel_type)` pair;
   every occurrence lives in edge metadata
   `mentions: [{t, seq, confidence}, …]`. One clean line per connection in any
   graph render; episode page and reader panel enumerate moments from the
   array; maps 1:1 onto a future Neo4j mirror (no parallel-edge stamping).
   Extraction MUST emit block anchoring (`seq`), not bare seconds, and
   confidence per mention, not per edge.
4. **Lens.** Arriving at an episode VIA another node applies that origin as a
   lens: `/media/:id?lens=<entity>` shows only the moments connected to it.
   Direct navigation = unfiltered. URL-owned → shareable. Guardrail: a lensed
   view must announce itself and un-lens in one tap ("Through: Faith ·
   7 moments of a 52-min episode · ✕ full episode") — a filtered episode
   silently posing as the whole thing is a trust bug. Works for any connected
   node type (principle, person, verse). Ships when measured extraction
   precision supports it (in-scope-if, Phase B / addendum).
5. **Graph membership is episode-level** (future graph-membership feature):
   one node per episode; timestamps ride edges, never segment nodes (altitude
   discipline — the graph view's cap/cluster design). "Listen → t" affordance
   mirrors the verse node's "Read →". The parked art-neo4j feature is
   ABSORBED into that future feature; its open question (DEPICTS→chapter
   edges vs the summary-node proxy pattern, see graph-view plan #2) applies
   to episode→chapter edges identically and is decided there.
6. **Search: Postgres, decisively.** No second search store (sync-tax:
   the Neo4j mirror already costs a backfill + verify + known-missing
   baseline; a search index would drift the same way). Visibility filtering
   stays a WHERE clause in the store that owns collections/entitlements —
   never authorization state synced into an external index. **A collection
   declares its search projection the way it declares its display family:**
   each ingest writes explicit weighted rows (title A / primary text B /
   description C / curated keywords D) into `lumen.search_index` — never raw
   metadata dumps. Transcript blocks are searchable in place (generated
   tsvector on the table); whether universal search UNIONs typed sources or
   materializes blocks into search_index is decided by the search feature.
   Known ceilings, accepted: typo tolerance (pg_trgm mitigates), KJV-form
   stemming ('english' config handles believeth/spake poorly — custom text
   config or trgm fallback when the search feature lands). Escape hatches
   that stay open: Typesense/Meilisearch fed from canonical tables later;
   pgvector for semantic/hybrid.

## Schema (Phase A1 migration)

```sql
CREATE TABLE lumen.transcripts (
  episode_id    text NOT NULL REFERENCES lumen.entities(id) ON DELETE CASCADE,
  seq           int  NOT NULL,
  t_start_s     numeric(9,3) NOT NULL,   -- seconds on the EMBEDDED video's timeline
  t_end_s       numeric(9,3),
  speaker       text,                    -- null for single-voice shows
  text          text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
  PRIMARY KEY (episode_id, seq)
);
CREATE INDEX idx_transcripts_search ON lumen.transcripts USING gin (search_vector);

CREATE TABLE lumen.search_index (
  kind          text NOT NULL,           -- 'verse'|'entity'|'episode'|… (result template key)
  ref_id        text NOT NULL,
  collection_id text REFERENCES lumen.collections(id),  -- NULL = core corpus rule
  title         text NOT NULL,
  tsv           tsvector NOT NULL,       -- setweight()ed projection, written at ingest
  payload       jsonb NOT NULL DEFAULT '{}',  -- deep-link makings, e.g. {episode, t}
  PRIMARY KEY (kind, ref_id)
);
CREATE INDEX idx_search_tsv  ON lumen.search_index USING gin (tsv);
CREATE INDEX idx_search_coll ON lumen.search_index (collection_id);
-- + pg_trgm index on title when the search feature lands
```

Properties doing quiet work: FK cascade keeps **collection = rollback unit**
(delete a collection's entities → its transcripts vanish); `collections.public
= false` is the one-statement kill switch for any show's surfaces;
`t_start_s` names the alignment invariant. Drizzle definitions land in
`packages/scripture/src/schema.ts`; additive for the MCP consumer (Ring 2 —
no coordinated redeploy needed until MCP wants transcript search).

## Ingestion workflow (reusable; config per show)

```
scripts/ingest-podcast/   config: channel/playlist, collection id, title parse rules
  1 discover    yt-dlp playlist → episodes.json (titles, videoIds, dates, durations)
  2 fetch       yt-dlp bestaudio (m4a) — from the SAME videoId we embed (invariant)
  3 transcribe  Deepgram nova, prerecorded, utterances + timestamps;
                keyterm boost fed from OUR entity vocabulary for the episodes' range
  4 extract     LLM pass → verse/chapter anchors + person/principle links
                (closed vocab, per-episode candidates, per-instance disambiguation,
                {t, seq, confidence} per mention)          [Phase A2]
  ── human-sampleable checkpoint: artifacts on disk, seeded-trap verification ──
  5 load        idempotent tx per episode: collection row, content_item entity,
                transcripts rows, edges (A2), search_index projections
```

Stages resumable + disk-cached (yt-dlp breakage stalls, never corrupts or
re-costs). Stage 4's eval is designed against A1's REAL transcripts
(probe-before-plan applied to extraction — the reason A2 is its own phase).

## Decisions log (attributed)

- **Dedicated transcripts table, not entities** — Claude recommendation,
  Abram accepted after debate ("looks clean"). §rules-2 rationale.
- **Full transcript display ships; no permission gate** — Abram. Recorded as
  posture, not legal conclusion; supporting logic: embedded playback accrues
  every view to the creator; transcript is navigation TO the work. Reversal
  lever documented above. Creator outreach = optional goodwill, off critical
  path.
- **One edge per (episode,target) + arrival-context lens** — Abram.
- **Episode-level graph nodes** — Abram ("yeah?") + Claude altitude rationale.
- **PG over Typesense; search_index projection contract** — Claude
  recommendation, Abram: "pg first. i like the table the way you suggested."
- **Deepgram nova over YouTube auto-captions** — Abram proposal, Claude
  endorsed with refinements (bestaudio not mp4; alignment invariant; keyterm
  boost). Free signup credit assumed ≈$200 — VERIFY terms at A1 probe.
- **Three-phase roadmap** — Abram pushed ("why no three phase?"); the
  probe-before-plan argument flipped Claude's two-phase recommendation.
- **Vocabulary home = `@lumen/scripture`** (`src/vocab.ts`); `@lumen/shared`
  deleted. Reconciliation is EVIDENCE-BASED (live prod DISTINCTs 2026-07-17),
  not aspirational: tiers `base|app|enrichment` (+ `community|personal`
  reserved), categories = live set + `podcast`; entity/rel types = live sets +
  explicitly-marked planned entries. Shared's never-used fictional entries
  dropped — a type joins the vocab when a writer exists or is planned.
- **DEC-A carried** (user-roles): no Admin link in ambient chrome/menu.
- **De-AI-UX** (Abram, 2026-07-17): typography over containers; TOC-ruled
  rows not card lists; pills only for true tags; the transcript treatment is
  the reference point. Applies to all Phase B work.

## Risk register

1. **Extraction precision is the load-bearing wall** — lens/edges/search
   moments all inherit it. Fenced: closed vocab, per-episode candidates,
   sampled checkpoint w/ seeded traps, per-mention confidence, lens gated on
   measured precision. Where the vision succeeds or embarrasses.
2. **Spoken references are adversarial** — "verse twenty-seven" minutes after
   the chapter was named; ranges; anaphora. Harness fixtures MUST carry these
   hostile shapes (user-roles lesson), incl. chunk-boundary continuity.
3. **Timestamps are ±2s truth** — Deepgram clock vs YouTube seek. Seek floor
   t−2s; never render sub-second precision.
4. **2–4h episodes stress the UI** — transcript view needs virtualization or
   pagination at Phase B; prototype rendered 7 blocks, reality is 400–600.
5. **yt-dlp is brittle by nature** — staged disk-cached pipeline is the
   insurance.
6. **Deepgram free-tier terms drift** — verify amount/card/expiry/concurrency
   at A1 probe before leaning on them.
7. **Entity density for target chapters unknown** — A2's candidate lists come
   from entities linked to the episodes' chapters; if the current CFM block is
   thin in phase-b coverage, lens quality caps early. One SELECT at A1 probe.
8. **A2 LLM batch cost** — 300–500k transcript words through extraction;
   small real dollars; cost line in A2's plan, not a surprise.
9. **Graph allow-lists reference Neo4j-side rel types** (PARALLELS, EXTENDS,
   CONTRASTS) absent from PG edges — reconcile during graph-membership, not
   0b (deferred sweep debt, below).

## Phase map + status

- **0a** this document. **0b** vocab consolidation (refactor, no workflow):
  `vocab.ts` + delete shared + `smoke-vocab.mjs` drift gate. DEBT deferred
  from 0b: sweep hardcoded copies (graph label unions, backfill `LM_LABELS`,
  slug-map edge list, ingest literals) — pick up opportunistically in A2 /
  graph-membership.
- **A1 `unshaken-ingest`** (feature-workflow, tier large, branch from main) —
  migration (both tables + `admin.collections` entitlement grant), stages
  1–3, load of episodes/transcripts/title-parsed chapter anchors/search
  projections, 10-episode run. Probes: channel/title format, captions/embeds,
  Deepgram terms, current CFM block, entity density (risk 7).
- **A2 `unshaken-extraction`** (feature-workflow, standard, from main, after
  A1) — stage 4 + edge load; eval vs real transcripts. Parallel with B.
  SHIPPED 2026-07-18: eval round 2 passed (verse/chapter 0.932 · entity
  0.900 · principle 0.925; 11/11 traps, 4/4 golds) — 2,250 extraction edges
  / 7,970 timestamped mentions live behind `public=false`. LENS GREEN-LIT.
- **B `unshaken-surfaces`** (feature-workflow, standard, from
  `proto/podcast-ui` + merge main) — real loaders, de-AI-UX pass, reader
  panel, admin collections page, `getChapterArt` collection scope fix,
  lens-if-precision (condition MET — see A2), **enrichment review UI
  (below, Abram 2026-07-18)**.
- **B-scope: enrichment review UI** (Abram, verbatim: "a system in which an
  admin can review all collection AI enrichment. and they can go sort by AI
  confidence and mark accepted or not… in the ui"). Design:
  - `/admin/enrichment` route behind the `admin.collections` entitlement
    (granted since A1's migration, so far surface-less). Table of enrichment
    mentions across a collection: sortable by confidence (asc = worst-first
    review queue), filterable by kind/episode/status, row actions
    accept / reject with quote + transcript context inline.
  - Review unit is the MENTION (one timestamped claim), status
    `pending | accepted | rejected`; "live" is derived (rejected → never
    shown; accepted → always shown; pending → confidence-threshold rules).
  - Storage (Abram 2026-07-18, "a column on enrichment data… accepted/live
    or rejected"): hybrid. Source of truth = OVERLAY table
    (`lumen.enrichment_reviews`: edge triple + mention seq identity →
    status, reviewer, reviewed_at) because the governing invariant is
    "a pipeline re-run must never wipe a human's review decisions" — and
    extraction re-runs rebuild edges wholesale. The app-facing column is
    MATERIALIZED: load stamps each mention's `review` status from the
    overlay into the edge jsonb, so read paths see a plain field with no
    joins; re-extraction re-applies the overlay automatically.
  - Seeds: the ~13 round-2 adjudicated-wrong eval mentions land as the
    first `rejected` rows (verdicts double as review data). Review
    decisions accumulate into a per-confidence-band calibration signal
    that future extraction rounds and the lens threshold read.
- **Later, in no order:** universal search UI · graph membership (episodes +
  art; absorbs parked art-neo4j) · transcript quality upgrade (Whisper) ·
  more shows (config reuse) · collections user-half (toggles/cookie — spine
  fast-follow, now with the AppMenu as its natural home) · **workflow-system
  hosting** (below).

## Portability invariants (decided 2026-07-17: local now, AI workflow system later)

The pipeline runs locally today and moves to an orchestrated/AI workflow
system later (e.g. weekly scheduled ingestion of the new episode; A2's
extract stage is an LLM step by nature). Implementation MUST preserve what
makes that move a re-shelling, not a rewrite:

1. Stage logic stays in pure, DI'd functions; process/fs/network calls only
   at the edges (the harness already enforces this shape).
2. Artifacts are the ONLY inter-stage coupling, addressed by
   (show, videoId, stage); filesystem access goes through per-stage helpers
   so disk can become R2/S3 without touching logic.
3. Per-episode independence: own tx, own artifacts, idempotent delete-first
   load, skip-if-valid resume — an orchestrator gets retries and per-episode
   fan-out for free. The only shared write (collection upsert) stays
   conflict-safe.
4. Secrets via env only; JSON-line logs; exit codes 0/1/2; zero interactive
   prompts; no cwd assumptions (ROOT-relative paths).
5. Known frictions, accepted: yt-dlp is blocked from datacenter IPs — the
   staged design permits SPLIT execution (fetch local, transcribe→load
   hosted); hosted fetch would need a yt-dlp+ffmpeg container. Neither is
   built until the workflow-hosting feature runs.
- **Abram:** `DEEPGRAM_API_KEY` into repo-root `.env` before A1 stage 3.

Prototype (`proto/podcast-ui`, commits 8e46c4f + 9c354b2) holds the UI
starting material: episode page w/ facade player + `?t=` entry links +
transcript view w/ active-block highlight, show landing, universal AppMenu,
demo module whose types preview these contracts.
