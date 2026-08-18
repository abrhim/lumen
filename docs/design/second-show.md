# Second-show support (v2 — revised after adversarial review)

Design input, 2026-08-18. Lets a show other than Unshaken through the
pipeline and into every app surface. Driven by the second-show audit (15
findings) and REVISED after a 17-agent plan review (13 confirmed findings,
5 blockers — v1's extraction section was wrong on both of its "runs
unchanged" claims). Target: Stick of Joseph, 58 episodes, five collections
(docs/design/stick-of-joseph.md).

## The rule that shrinks everything: sources follow the COLLECTION

    source = `${collection_id}-youtube` | `${collection_id}-extraction`

Existing Unshaken rows already match → zero data migration; app hardcodes
become templates over ids the code already has. SCOPE (review): this rule
holds for podcast media edges only — canon/openbible/naves/word edges have
their own source vocabulary and are untouched.

## 1. The migration

The edges upsert arbitrates on `idx_edges_unshaken_unique (... ) WHERE
collection_id='unshaken'`. New collections need arbitration.

**Two artifacts, deliberately DIFFERENT (review blocker #1):**

- `supabase/migrations/2026…_edges_unique.sql`: plain
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique ON lumen.edges
  (from_id, to_id, rel_type, collection_id);` — the Supabase CLI applies
  migrations inside a transaction where CONCURRENTLY is illegal; local data
  is tiny, in-transaction build is fine. CONCURRENTLY here breaks
  `pnpm db:reset` and therefore the whole gate.
- Prod one-off script: `CREATE UNIQUE INDEX CONCURRENTLY` executed as a
  standalone statement OUTSIDE any sql.begin() (the house one-transaction
  pattern would also make it illegal), then invariants.

**Pre-check first** (decides everything): duplicate
(from,to,rel_type,collection_id) tuples must be zero across ALL writers.
The five real edge writers (review): ingest-podcast load + load-extraction,
backfill-phase-b.ts, ingest-openbible-refs.mjs, materialize-art-edges.mjs.
If dupes exist → fallback to per-collection partial indexes and keep the
WHERE form in the loader.

**KEEP `idx_edges_phaseb_unique`** (review major #2 — v1's "any other
collection has no arbitrating index" was FALSE). backfill-phase-b.ts has a
startup gate that exits if that index is missing, and its
`ON CONFLICT ... WHERE collection_id='phase-b'` can only infer the partial
index — the 4-column index does not satisfy that inference. The index is
redundant-but-load-bearing. Only `idx_edges_unshaken_unique` is dropped,
and only after the loader's ON CONFLICT moves to the 4-column form.

Notes: DROP INDEX takes a brief ACCESS EXCLUSIVE lock on edges (fine at
current traffic, do it in the same maintenance window); ANALYZE after; the
new index must survive `pnpm db:regen` (it will — regen dumps prod schema,
which will contain it).

## 2. Pipeline changes (scripts/ingest-podcast/)

- **Registry**: STICK_OF_JOSEPH into SHOWS (index.mjs); cli default stays
  unshaken.
- **Explicit-episode mode**: collections carry `episodes` lists → discover
  builds episodes.json from per-id `yt-dlp --print` fetches. The artifact's
  FULL shape must be produced (review minor): id, title, subtitle,
  spans, durationS, uploadDate — verbatim shows set `spans: null`,
  `subtitle: null`. Every listed id must resolve or discover fatals.
  episodeCount derives from the lists.
- **titleParse: 'cfm' | 'verbatim'**: loadEpisode branches BEFORE
  parseTitle (review blocker #7 — the re-parse dereferences null spans).
  Verbatim load shape, explicitly: no chapter-anchor edges;
  `blockLabel(spans)` is SKIPPED (it calls .map on its argument); the
  search_index tsvector COALESCEs every weighted part (subtitle null
  otherwise nulls the whole vector — setweight(to_tsvector(NULL)) poisons
  the concatenation).
- **Multi-collection loader**: the episode→collection map derives from the
  config lists; the episode's collection id flows into load.mjs (collection
  row, content_item, edges, search_index) AND — review major #8 — into
  BOTH extraction-load call sites in index.mjs (EXISTING_EDGES_SQL params
  and buildExtractionLoadPlan's collectionId), which currently pass
  show.id. Five collection rows upsert; `public` stays seeded-false,
  never updated.
- **Sources**: load.mjs has FOUR occurrences of 'unshaken-youtube'
  (42/90/125/137). load-extraction.mjs has FIVE literals, not two (review
  major #3): 'unshaken-youtube' at 11 (EXISTING_EDGES_SQL), 44 (the
  title-pair classification filter — the dangerous one), 77; and
  'unshaken-extraction' at 53, 89. Missing 11/44 makes every SoJ title
  edge classify as INSERT and collide on the new unique index. All nine
  become `${collectionId}-` templates.
- **Diarization**: `diarize: true` → request param. The transcribe
  skip-if-valid check does not fingerprint request params (review minor):
  the validation trio must run with `--refresh`, and the artifact gains a
  `params` field so future re-runs can detect drift.
- **tailToleranceS per show**: SoJ raises to 900 — raw streams carry
  trailing dead air and validateUtterances THROWS at 300, which would fail
  exactly the padded episodes we flagged (JM6ILq8hkyE).
- **Pinned tests**: scripts/__tests__/ingest-podcast.test.mjs pins the
  contracts this section changes (source literals, load shapes). Update
  the pins WITH the change, in the same commit.
- **Batching**: the runner already accepts `--episode` — the fleet runs as
  scripted loops of per-episode invocations; no new pipeline support.

## 3. Extraction no-block variant (rewritten — v1 was wrong twice)

What v1 claimed "runs unchanged" does not:

- **Verse resolution** (review blocker #4): with no chapter timeline,
  firstSegT is Infinity and EVERY parsed verse ref is dropped at the
  pre-segment filter. No-block mode needs its own resolution path: explicit
  "Book C:V" references resolve against the FULL canon (verseExists over
  all chapters), no timeline gating. Bare "verse 5" references without a
  book context are dropped (nothing to resolve against) — count them in
  the extraction report so the loss is visible.
- **Candidate entity pool** (review blocker #5): the pool is queried FROM
  episodeChapters today. No-block pool = the global top-N entities by edge
  degree (the same shape the keyterm query uses) UNIONed with entities
  linked to any book actually named in the transcript. Ambiguous-name
  disambiguation keeps working because it operates on the pool, not the
  block.
- **The eval gate** (review blocker #6): extraction-eval.mjs — the script
  that PRODUCES eval-verdict.json, which checkLoadGate requires — is
  hard-wired to Unshaken (module-level DIR/SHOW/EPISODES). Parameterize by
  --show, make answer-key derivation tolerate spans:null. For the
  validation trio the HUMAN eyeball is the quality gate; the eval harness
  gates the fleet.
- Prompt: the block-context section is omitted when spans is null, not
  sent empty.

## 4. App fixes (EIGHT, was six)

1. **media.tsx** — source templates over the episode's collection_id.
2. **scripture.tsx mediaRefs** — visibility moves INTO the SQL (review:
   publicCollections resolves in the same Promise.all, so the app-side
   ANY() list does not exist yet): `JOIN lumen.collections c ON c.id =
   g.collection_id AND c.public` (dev override kept). Kills the
   showUnshaken gate.
3. **scripture.tsx byline** — collection display name, which requires
   ADDING a collections join to loadMediaRefs (review: the query touches
   entities only today; v1's "already touches" was wrong).
4. **node.tsx** — source templates + per-collection visibility, AND
   (review major #11) the UI hardcodes: the "In Unshaken · N passages"
   heading, the `unshaken:` loader payload key, and quote aggregation —
   quotes group per collection and render each collection's name.
5. **scripture.tsx verseSignals** (review major #9 — v1 forgot it):
   loadVerseSignals' media leg hard-codes 'unshaken-extraction' and the
   `s.media` delete loop keys on showUnshaken. The media leg filters by
   collections.public in SQL; the delete loop is removed with the gate.
6. **collections.index.tsx** (rewritten per review major #12): Strong's
   and Art stay bespoke — they are not media collections and cannot render
   from lumen.collections. Only the episodes family goes dynamic:
   collections ∩ REGISTRY 'episodes', one GROUP BY count over content_item
   entities, filtered by canViewCollection (admin preview included).
7. **collections.tsx** (/collections/:id — review major #13, missed
   entirely in v1): its organizing principle groups episodes by
   spans[0].book. Spanless collections order by upload_date instead,
   suppress the book-group headers and the spans sub-line.
8. **collection-display.ts** — five SoJ ids join REGISTRY as 'episodes'.

## 5. Post-ingest steps that are NOT optional (review minors)

- `scripts/build-search-moments.mjs` — transcript search moments only
  exist after it runs. It joins the runbook as a per-ingest step.
- EPISODE_INDEX regeneration (packages/scripture) for [[-linking.
- Both recorded in docs/ops/ so they outlive this doc.

## 6. Validation before the fleet

| Episode | Why |
|---|---|
| a Todd interview (2 speakers) | modal case |
| LXoi1I_TQAk (4+ panel) | diarization stress |
| JM6ILq8hkyE (padded lecture) | dead-air + tailTolerance |

Transcribe only (with --refresh; nothing loads), Abram eyeballs. WhisperX
bake-off on the Todd episode: proper nouns, diarization, dead-air; decision
recorded in stick-of-joseph.md. Then extract on the trio, eyeball entity/
verse quality, THEN the fleet of 58 as batched --episode loops.

## Order of work

1. Migration pre-check → both migration artifacts (different SQL each)
2. Pipeline: sources (all nine) + registry + explicit mode + verbatim load
   shape + diarize + tailTolerance + pinned-test updates
3. Extraction: no-block verse path, no-block pool, eval parameterization
4. App fixes 1–8
5. Gate green; validation trio; bake-off; Abram eyeballs
6. Fleet, then build-search-moments + EPISODE_INDEX regen

## Non-goals

Interviews catch-all; retrofitting Unshaken to explicit lists; speaker
NAMES (diarization gives turns, not identities); generalizing the source
rule beyond podcast media edges.
