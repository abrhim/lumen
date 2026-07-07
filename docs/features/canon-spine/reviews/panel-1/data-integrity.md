# Panel 1 — Data Integrity Review (canon-spine)

Lens: migration transaction correctness, entity-metadata quality feeding new
NOT NULL columns, id-format consistency across verses/chapters/entities/graph,
and edge-endpoint resolvability through the deprecation transition.

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| DATA-1 | Critical | design.md "Open design question" (`lumen.nodes`); plan.md item 4 | 1,582 chapter entities may have ids ≠ derived `{book}-{n}`; if the view excludes deprecated structural entities as "superseded by spine," edges to a drifted id orphan silently. | Define `lumen.nodes` as literal union that always includes deprecated chapter/book/volume entities; never filter them as redundant with spine rows. |
| DATA-2 | High | `backfill-neo4j-collections.mjs` node-source switch (plan.md Files touched); design.md "spine carries no collection_id" | Spine tables have no `collection_id` column, but the script currently reads `entities.collection_id` to stamp book/chapter/volume graph nodes; plan doesn't specify the replacement value. | Hardcode `cid: 'canon'` for spine-sourced book/chapter/volume groups, mirroring the script's existing verse special-case (line 182). |
| DATA-3 | High | design.md schema (`verses.chapter_id`); `migrate-canon-spine.mjs` (not yet written) | Chapter id is built twice independently — once in `deriveChapters()` (`book_id-chapter_number`), once in the verses backfill `UPDATE` — with no shared expression, risking silent drift between the two. | Backfill `chapter_id` via a join back to the just-inserted `chapters` rows (by book_id+chapter_number), not a second hand-written string concat. |
| DATA-4 | Medium | design.md schema `volumes.tradition`; `ingest-phase-a.ts` `VOLUME_CANON` | `metadata.canon` only ever holds `'bible'` or `'restoration'`, never the design comment's own example vocabulary (`'hebrew'\|'christian'\|'restoration'`); promoting it collapses OT+NT into one indistinct tradition value. | Fix the design comment to match real data, or assign OT/NT distinct tradition values now — needed for the tradition-based scoping use case the design itself cites. |
| DATA-5 | Medium | plan.md Failure mode #9 | Smoke check only looks up "one id of each kind" in `lumen.nodes` — too weak to catch per-row id drift (the chapter-entity case), which is exactly the failure class in play. | Replace with an exhaustive anti-join: every distinct `edges.from_id`/`to_id` must resolve in `lumen.nodes`; report the unresolved count, not a one-id sample. |
| DATA-6 | Medium | `ingest-phase-a.ts` `bookSlug('Official Declaration')` → `'od'`; `batchInsertEntities` `ON CONFLICT DO UPDATE` | Two source book rows (OD 1, OD 2) both slug to `'od'` and upsert over each other; only the last-processed book's name/metadata survives as the row the migration reads as ground truth for the `books` table. | Audit the surviving `'od'` book entity's `sort_order`/name/`chapter_count` before migration; confirm it's intentional, not an accidental last-write-wins. |
| DATA-7 | Medium | design.md "Words" section; `ingest-words.mjs` (not yet written) | Delete-then-insert per verse batch is two separate round trips, not one transaction; a crash between them leaves every verse in that batch with zero words rows until the next full re-run. | Wrap each batch's `DELETE`+`INSERT` in a single `BEGIN`/`COMMIT` so a crash never leaves a batch half-applied. |
| DATA-8 | Low | plan.md failure modes / Scope item 1; design.md P1 | Book NOT NULL columns (`volume_id`, `sort_order`) rely on the DDL/backfill's own constraint-violation errors to abort, not a named pre-insert check as the plan's stated goal ("abort with a named check") requires. | Add an explicit pre-insert validation counting book entities missing `metadata.volume_id`/`sort_order`, named and logged before the `INSERT` runs. |

## Note on DATA-1 (checked hard, per request)

Today, resolution of a chapter-entity edge endpoint works because
`lumen.entities` is looked up directly by its own (possibly drifted) id — no
reconstruction happens. Post-migration, `lumen.chapters` is *derived from
verses* and therefore only ever contains the canonical `{book}-{n}` id; it
cannot represent a drifted chapter-entity id by construction. The only thing
standing between "still resolvable" and "silently orphaned" is whether the
`lumen.nodes` view keeps deprecated chapter/book/volume entities in the union.
The natural implementation instinct — exclude `entity_type IN ('chapter',
'book','volume')` from the entities half since "spine replaces them" — is
exactly wrong and would orphan every edge touching a drifted chapter id, with
no error until someone traverses that edge. This risk is deferred, not
resolved, by the plan's own "separate cleanup" note for Neo4j chapter-id
alignment (`X-ch-N`): nothing in the current plan quantifies how many
`lumen.edges` rows actually point at chapter-entity ids that would fail to
resolve if those rows were ever deleted (vs. merely deprecated-in-place) later.
