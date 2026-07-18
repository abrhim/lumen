# Panel 1 — data-integrity (unshaken-extraction A2)

Lens: correctness of data writes only. Sources: plan.md, harness
(`scripts/__tests__/ingest-extraction.test.mjs`), A1 load
(`scripts/ingest-podcast/load.mjs`, `index.mjs`), migration
(`scripts/migrate-media-collections.mjs`), vocab
(`packages/scripture/src/vocab.ts`), plus **live read-only prod probes**
(2026-07-18, DSN per `scripts/smoke-media.mjs:17-28`). Implementation files
(`extract-lib.mjs`, `load-extraction.mjs`) do not exist yet — findings target
the plan + harness contract while both are still cheap to change
(drift hashes are PENDING).

## Findings

### F1: A1's live metadata is double-encoded jsonb — every `metadata->>'source'` filter in the plan matches ZERO rows

**Severity: CRITICAL (blocks both the idempotency delete and the title-edge split as designed)**

Probe, all 184 live unshaken edges and all 10 episode entities:

```
by_metadata_source:    [{ meta_source: null, n: 184 }]
metadata_jsonb_typeof: [{ t: "string", n: 184 }]      -- jsonb STRING scalar, not object
entity_meta_typeof:    [{ t: "string", n: 10 }]
sample_edge.metadata:  "{\"source\":\"title\",\"confidence\":1,\"mentions\":[]}"
typeof_by_collection:  openbible 614,209 object · phase-b 253,499 object ·
                       art 11,373 object · unshaken 184 STRING
```

The value is a jsonb *string scalar* containing JSON text. Unshaken-only —
this is A1's runner, not an endemic condition. Mechanism reproduced
read-only against prod (postgres@3.4.9, `prepare:false`):

```
sql.unsafe('SELECT jsonb_typeof($1::jsonb)', [JSON.stringify(obj)]) → "string"   ← A1 path
sql.unsafe('SELECT jsonb_typeof($1::jsonb)', [obj])                 → "object"
sql`… ${obj}::jsonb …` / sql.json(obj)                              → "object"
```

Culprit: `scripts/ingest-podcast/index.mjs:232` —
`s.values.map((v) => (… typeof v === 'object' ? JSON.stringify(v) : v))`
pre-stringifies, then postgres.js serializes the string again. This is the
same W2 family as A1's read-side wart, but on the WRITE side, and A1's smoke
masked it: the `parse-if-string` accommodation (smoke-media.mjs:99-100)
normalized the symptom instead of failing on it.

Consequences for the A2 plan as written:

- `DELETE … WHERE metadata->>'source' = 'extraction'` deletes nothing on
  re-run; the following INSERT of the same pairs hits
  `idx_edges_unshaken_unique` → per-episode tx aborts. Idempotency (H7) is
  dead on arrival — loud, not silent, but dead.
- Title-edge detection via `metadata->>'source' = 'title'` finds zero rows →
  every title pair is classified INSERT → unique violation on the FIRST run.
- Design §rules-3 mentions arrays are unreadable by any SQL consumer
  (`metadata->'mentions'` on a scalar is NULL; `jsonb_object_keys` on these
  rows *errors* — my first probe crashed on exactly this).

**Recommendation** (all three, in order):
1. Fix the write path: drop the manual `JSON.stringify` in the statement
   runner (pass objects raw; postgres.js serializes correctly through
   `unsafe`). A2's load-extraction must NOT copy line 232 as-is.
2. One-time repair, guarded and idempotent, before A2's first load:
   `UPDATE lumen.edges SET metadata = (metadata #>> '{}')::jsonb WHERE
   collection_id = 'unshaken' AND jsonb_typeof(metadata) = 'string'`
   (same for the 10 `lumen.entities` rows). House-style migration script
   with DRY_RUN + invariants.
3. Pin it forever: smoke-extraction invariant
   `jsonb_typeof(metadata) = 'object'` for every unshaken edge AND entity;
   file an A1 bug entry (provenance: escaped harness because the executor
   seam was untested; escaped smoke because smoke accommodated).

### F2: Verse/chapter id format in plan + harness is wrong — prod is `2-kgs-14-3`, not `2kgs-14-3`

**Severity: CRITICAL (a shipped normalizer in this shape orphans every verse edge; no FK will catch it)**

Probe:

```
verse_candidates ('2kgs-14-3','2-kgs-14-3','2kings-14-3',…): only "2-kgs-14-3" exists
chapters:        "2-kgs-14" (and "ex-19", "1-kgs-12" on live A1 edges)
verses PK:       id;  uniform shape verified: 0 rows where id NOT LIKE chapter_id||'-%'
cross-book:      ex-19 → "ex-19-1"
```

The plan (`2kgs-14-3`, Design §pass-2), harness TIMELINE fixtures, the
`VERSE_EXISTS` regex `^(2kgs-\d+)-(\d+)$`, and the pinned
`resolveVerseRef → {id: '2kgs-14-3'}` all use a book-token shape that does
not exist in prod. Tellingly, the fixture's verse counts are exactly right —
probe: `2-kgs-14: 29, 2-kgs-15: 38, 2-kgs-16: 20` — the authors knew the
content and guessed the id syntax. The construction rule
`${chapter_ctx}-${verse_num}` itself is correct *iff* `chapter_ctx` is a real
chapter id; nothing in the harness proves the runtime path sources chapter
ids from A1's `anchorsForBlock` output rather than re-deriving them from book
names, and a hardcoded `2kgs`-style normalizer would pass every current test
while writing 100% orphaned verse edges (`lumen.edges` has no FK on
from_id/to_id — probe: no PK, from_type NULL for verse from_ids).

**Recommendation**: switch all fixtures/pins to real shapes (`2-kgs-14`,
`ex-19`) while the harness hash is still PENDING; add a harness test that
chapter timeline ids are consumed opaquely (pass-1 prompt's closed set =
episode's live edge to_ids, verbatim); implement `verseExists` as a
per-episode prefetch of real ids (`SELECT id FROM lumen.verses WHERE
chapter_id = ANY($episodeChapters)`), never string arithmetic; keep the
planned smoke invariant "every to_id resolves" but make it kind-aware
(chapter → lumen.chapters, verse → lumen.verses).

### F3: An A1 re-run silently destroys every A2 edge and resets title mentions

**Severity: HIGH (cross-stage ownership hole; weekly cadence is designed-in)**

A1's load deletes ALL episode edges then reinserts title edges with
`mentions: []` (`load.mjs:37-39` — `DELETE FROM lumen.edges WHERE from_id =
$1 AND collection_id = $2`; `load.mjs:119` — fresh `{source:'title',
confidence:1, mentions:[]}`). The B2 comment in the same file establishes
weekly re-runs as the operating cadence. The plan's H6/H7 protect title edges
from A2's delete, but nothing protects extraction edges (or enriched title
mentions) from A1's blanket delete. After any A1 re-ingest, extraction work
vanishes with zero errors.

**Recommendation**: decide ownership now, in this plan. Cheapest sound
option: (a) scope A1's edge delete by its own source
(`AND source = 'unshaken-youtube'`, see F4) AND make its title-edge insert
`ON CONFLICT … DO UPDATE` that preserves the existing mentions array;
or (b) declare load-extraction a mandatory downstream stage of every A1 load
(wire into `index.mjs` stage prereqs) — acceptable only with the loud
backstop either way: smoke invariant "every episode with transcripts has
extraction-sourced edges" so a wipe cannot pass silently.

### F4: Idempotency should scope on the first-class `source` column — which EXISTS (probe refutes the plan's premise)

**Severity: HIGH (turns F1's failure class into a non-event for A2's own edges)**

Probe, `lumen.edges` columns: `from_id, to_id, rel_type, collection_id,
metadata (jsonb NOT NULL), source (text NULL), created_at`. All 184 A1 edges
carry column `source = 'unshaken-youtube'` — intact and queryable even while
their jsonb is broken. The review brief assumed no such column; the schema
says otherwise, and A1 already populates it.

**Recommendation**: A2 writes column `source = 'unshaken-extraction'` on its
edges and the operative delete becomes
`DELETE … WHERE from_id = $1 AND collection_id = 'unshaken' AND source =
'unshaken-extraction'` — typed, indexed-adjacent (idx_edges_from covers the
scan; probe lists idx_edges_from/collection), and immune to every jsonb
encoding/parse trap. Keep `metadata.source` for shape symmetry if desired,
but no correctness path may depend on a json extraction. Update H7/H6b pins
so `sourceFilter`/`metadata.source` assertions reflect column semantics, and
title-vs-extraction classification never reads metadata at all (see F5).

### F5: UPDATE-vs-INSERT split — the classification FETCH is the untested seam; crash-mid-tx is safe, concurrency fails loud

**Severity: MEDIUM-HIGH**

Analysis against `idx_edges_unshaken_unique` (probe confirms live definition
`(from_id,to_id,rel_type) WHERE collection_id='unshaken'`):

- **Crash mid-tx**: per-episode tx (A1 pattern, `sql.begin`) is atomic — a
  previous A2 run that died mid-tx leaves NO partial state; re-run sees clean
  pre-state. Partial success ACROSS episodes (1–4 committed, 5 crashed) is
  handled by per-episode delete+insert idempotency once F1/F4 land. No
  index conflict is reachable from a crashed run per se.
- **The real hazard is classification drift**: `buildExtractionLoadPlan`
  takes `existingTitleEdges` as a pure input; the query that produces it
  lives in the untested shell. If that query filters on
  `metadata->>'source' = 'title'` it returns [] today (F1) → title pairs
  classified INSERT → unique violation aborts every episode. Fetch ALL
  existing `(to_id, rel_type)` for `(from_id, collection_id)` with no
  metadata predicate, and pin the fetch SQL string in the harness.
- **Concurrent A2 runs**: second run's DELETE either re-evaluates after the
  first commits (deletes + reinserts, converges) or misses the first's
  uncommitted inserts and its own INSERT aborts on the unique index. Loud
  failure, no corruption — acceptable; a per-episode advisory lock (A1's B5
  concurrent-runner lesson) is optional polish.
- **Stronger alternative worth adopting**: after F1's repair, a partial
  unique index is a valid ON CONFLICT arbiter —
  `INSERT … ON CONFLICT (from_id, to_id, rel_type) WHERE collection_id =
  'unshaken' DO UPDATE SET metadata = CASE WHEN lumen.edges.source =
  'unshaken-youtube' THEN <preserve source/confidence, replace mentions>
  ELSE excluded.metadata END` collapses the UPDATE/INSERT split entirely and
  removes the classification seam. If the split stays, H6's "UPDATE preserves
  source:title + confidence 1" must also preserve UNKNOWN future metadata
  keys (jsonb merge, not whole-object replace).

### F6: Confidence floor 0.5 — right gate, but store an edge-level rollup and pin artifact-before-floor ordering

**Severity: MEDIUM**

Floor enforcement in `validateMention` (pre-aggregation, fail-closed, logged,
H4-pinned with a distinct reason) is the right place: nothing below 0.5 can
reach an edge. Two gaps for "lens filters at higher thresholds later":

- Per-mention confidence is stored (design §rules-3), but SQL-side threshold
  filtering over `metadata->'mentions'` requires `jsonb_array_elements` per
  row. Title edges already carry top-level `confidence: 1`. Write the same
  top-level key on extraction edges as `max(mentions[].confidence)` — one
  uniform, indexable-ish read path for lens/graph queries; H2's
  keep-higher-confidence merge is already consistent with a max rollup.
- Sub-floor mentions are unrecoverable from the DB by design; that is fine
  ONLY if `<id>.extraction.json` caches RAW batch output upstream of
  validation. Pin the ordering (artifact write precedes floor filtering) in
  the harness so a future threshold change costs $0, not a $6–10 re-batch.

### F7: rel_type vocab and direction — clean; enforcement is convention-only, so smoke must resolve targets per kind

**Severity: LOW (verification, one caveat)**

MENTIONS and TEACHES are live in `PG_REL_TYPES`; DISCUSSES is declared
planned with writer A2 (and already live via A1's 184 edges — probe
`by_rel_type: DISCUSSES 184`). Prod direction convention, probed:
MENTIONS = verse → person; TEACHES = chapter/chapter_summary → principle;
DISCUSSES = episode → chapter. A2's episode → target for all three matches
the established container→target convention. Caveat: edges has no PK and no
FKs (probe: 0 primary indexes; from_ids reference the verses table, not
entities), so direction and target validity are enforced nowhere but code —
smoke-extraction must assert per-kind resolution (person/place/event/
principle → lumen.entities; verse → lumen.verses; chapter → lumen.chapters).
Pool-hygiene note: person ids include artifacts like `"a despicable
person-1"` (probe, min(id) for person, n=3,869) — name-based prefiltering
keeps these out unless their names genuinely appear, but the eval sample
should confirm no junk-pool targets ship.

### F8: Fixture truth vs prod — counts right, and implement existence via id sets

**Severity: LOW**

Harness fixture verse counts are exactly prod truth (29/38/20 for
2-kgs-14/15/16) — only the id SHAPE is wrong (F2). When implementing
`verseExists`, prefetch the SET of verse ids per episode chapter rather than
`max(verse_number)` bounds — `lumen.verses` carries `verse_number` but gaps
cannot be ruled out across the corpus (JST readings etc.); membership in the
real id set is the fail-closed formulation and costs one query per episode.

## Verdict

The A2 write design — aggregated one-edge-per-pair, per-mention confidence,
fail-closed resolution, per-episode tx, delete-then-insert idempotency — is
structurally sound and the partial unique index converts every residual race
into a loud abort rather than silent duplication. But the plan is built on
two false premises about live data, both probe-refuted: (1) `metadata->>`
filters work — they match zero rows today because A1 shipped all 184 edges
(and 10 entities) as double-encoded jsonb string scalars via the
`index.mjs:232` pre-stringify bug, and (2) verse ids look like `2kgs-14-3` —
prod is `2-kgs-14-3`, and with no FKs a wrong-shape writer orphans every
verse edge invisibly. **Fix order**: repair + write-path fix + typeof smoke
(F1), re-shape fixtures/pins to real ids (F2), move idempotency scoping to
the first-class `source` column (F4), close the A1-rerun wipe hole (F3),
pin the classification fetch or adopt ON CONFLICT (F5). With those landed,
this loader is safe to build. NOT approved as written; approvable after
F1–F4 amendments, which are all cheap while the drift hashes are PENDING.
