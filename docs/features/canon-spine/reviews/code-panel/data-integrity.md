# CODE-PANEL / SPECIALIST — Data Integrity Review (canon-spine implementation)

Reviewed `spine-impl.diff` in full plus `scripts/migrate-canon-spine.mjs`,
`scripts/smoke-canon-spine.mjs`, `scripts/backfill-neo4j-collections.mjs`,
`scripts/ingest-phase-a.ts` (tombstone), `packages/scripture/src/queries.ts`,
and `docs/features/canon-spine/plan.md`/`docs/design/canon-spine.md` for the
promises being checked against. Migration has **not** run against prod.

## Verified landed cleanly (no finding needed)
- DATA-3: `verses.chapter_id` backfilled via `JOIN lumen.chapters` on
  `book_id`/`number`, not a second hand-built concat.
- COR-9: both an in-transaction check (`summaries_resolve_to_chapters`) and a
  live smoke check assert every `chapter_summary.metadata.chapter_id`
  resolves in `lumen.chapters`.
- `migration_state` P1 marker: inserted before the `dry-run` throw, inside the
  same `sql.begin`, so a dry run's marker insert is rolled back with
  everything else — confirmed.
- `smoke-canon-spine.mjs` never references the P4-dropped `verses.book_id` /
  `volume_id` / `chapter_number` columns (its `ch.book_id` reference is
  `lumen.chapters.book_id`, a permanent column) — it is safe to run both
  before and after P4, as its dual role (P4 gate + post-P4 re-run) requires.
- The `getVersesByChapter_1ne3` parity pair inside P1 legitimately reads the
  transition columns — correct, since P4 hasn't run yet at that point.
- DATA-2's `cid: 'canon'` stamping for spine-sourced groups landed as
  specified; excluding deprecated chapter/book/volume entities from the
  backfill's node-source query is harmless *today* because those entities
  were already stamped `collectionId: 'canon'` at ingest (see CDATA-7 below
  for the residual risk this leaves).

## Findings

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| CDATA-1 | Critical | `scripts/migrate-canon-spine.mjs` `SPINE_DDL` (`DROP TABLE IF EXISTS lumen.words`) | Unlike every other spine table (`CREATE TABLE IF NOT EXISTS`), `lumen.words` is unconditionally dropped and recreated every P1 run, wiping ~1.2M ingested rows on re-run. | Change to `CREATE TABLE IF NOT EXISTS lumen.words`; only drop-and-recreate on an explicit schema-change path, never inside routine idempotent P1 re-runs. |
| CDATA-2 | Medium | `migrate-canon-spine.mjs` `lumen.nodes` view; `lumen.entities` (never pruned) | Entities are never pruned, so most spine ids (e.g. `'dc'`) resolve to 2-3 conflicting rows in `lumen.nodes` with no documented row-order guarantee for id lookups. | Document that `lumen.nodes` can return >1 row per id; require consumers doing single-row lookups to explicitly prefer spine kind or add deterministic ordering. |
| CDATA-3 | Medium | plan.md Scope item 5 vs `migrate-canon-spine.mjs` (P1 and P4 blocks) | Plan promises structural entities are "marked deprecated in place" at P4; no column, flag, or UPDATE does this anywhere in the script. | Add a `metadata.deprecated = true` (or status column) UPDATE for migrated volume/book/chapter entities in P1 or P4, honoring the plan's commitment. |
| CDATA-4 | Medium | `migrate-canon-spine.mjs` `badBooks`/`badVols` checks (DATA-8) | Pre-insert validation checks only missing `volume_id`/`sort_order`; a real duplicate `(volume_id, sort_order)` pair aborts via a raw Postgres UNIQUE violation, not a named check. | Add an explicit `books_sort_order_unique` pre-insert check (group by volume_id+sort_order, count>1) before the INSERT loop, matching the named-check contract. |
| CDATA-5 | Low | `migrate-canon-spine.mjs` P4 gate (`canon-spine-p3-verified` marker) | The P3 marker has no freshness binding — once written it authorizes P4 forever, even if verses/chapters change afterward without re-running smoke. | Bind the marker to a row-count/hash snapshot and re-validate against current state before P4 proceeds; invalidate the marker on any P1 re-run. |
| CDATA-6 | Low | `migrate-canon-spine.mjs` P4 block | P4 (the irreversible column drop) persists no completion marker in `migration_state`, unlike P1 and P3, leaving no audit trail that it ran. | Insert a `canon-spine-p4-done` row into `lumen.migration_state` inside the P4 transaction, mirroring the P1 `canon-spine-p1` marker pattern. |
| CDATA-7 | Low | `scripts/backfill-neo4j-collections.mjs` (`entity_type NOT IN ('volume','book','chapter')`) | Deprecated chapter/book/volume entities are now permanently excluded from stamping; harmless today (already `'canon'`) but any future `collection_id` edit on them never propagates. | Note in the script header that deprecated structural entities are frozen post-migration; if ever mutated, they must be re-included or backfilled manually. |

## Notes on specifically-requested checks

- **DATA-1 duplicate-id question**: confirmed real. `'dc'` resolves to three
  `lumen.nodes` rows (volume, book, and the D&C volume entity, entity_type
  `'volume'`); most other volume/book ids resolve to two. This is harmless
  for the anti-join in `smoke-canon-spine.mjs` (a `LEFT JOIN` existence check
  is unaffected by fan-out on the matched side), but it is not harmless for
  the "single lookup surface for arbitrary edge endpoints" use case the plan
  names for `lumen.nodes` — see CDATA-2.
- **DATA-8 dc/sort_order=0 collision**: checked against `ingest-phase-a.ts` —
  `bookSortOrder` is a single counter incremented *before* first use, so the
  first real book gets `sort_order = 1`, never `0`; and books whose slug
  collides with a volume id (which would include a D&C "book") are filtered
  out of `bookEntities` entirely, so no book ever carries `volume_id = 'dc'`.
  The synthetic `dc` row (`sort_order = 0`) is therefore alone in its
  `UNIQUE(volume_id, sort_order)` group — confirmed no collision today. The
  broader validation gap (no duplicate-sort_order check at all) is CDATA-4.
