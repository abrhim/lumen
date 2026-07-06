# Aggregated panel-1 — canon-spine

## api-contract.md

# Panel 1 / api-contract review — canon-spine plan

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| API-1 | High | `resolve-reference.ts` 'verse'/'chapter' cases; `spine-queries.test.ts` | FM-7 claims verse/chapter shape coverage but harness tests only 'volume'/'book' levels; verse rows spread `VERSE_COLUMNS` (incl. dropped `book_id`/`volume_id`/`chapter_number`) straight into MCP JSON. | Add resolveReference('chapter') and ('verse') cases to spine-queries.test.ts asserting exact field set survives P4's column drop. |
| API-2 | High | `queries.ts` `getVersesByChapter`; `scripture.tsx` L298 | Highest-traffic query (every chapter load) filters on `book_id`/`chapter_number`, both dropped in P4; absent from plan's Scope §3 "signatures stable" list and from the harness. | Add `getVersesByChapter` to the stable-signature enumeration; add an SQL-shape test asserting it joins via `chapter_id`, not `book_id`. |
| API-3 | High | `book.tsx` L30; plan Files-touched/Public contract | `getEntity(bookId)` supplies the book NAME; plan commits book.tsx to "spine reads" but names no `getBook()`/`getVolume()` export to replace it. | Add `getBook(id)`/`getVolume(id)` to Public contract and Files-touched; migrate book.tsx off `getEntity`. |
| API-4 | Medium | `queries.ts` `getVerseById`/`getVerseByReference`; used by `resolveReference` | Both select the same dropped-column `VERSE_COLUMNS` fragment and back the MCP verse/unknown paths, yet neither appears in the plan's enumeration or the harness. | List both in Scope §3; add SQL-shape assertions confirming no reference to `book_id`/`volume_id`/`chapter_number`. |
| API-5 | Medium | `queries.ts` `getPassage`/`searchScriptures`; `spine-queries.test.ts` | Both are named "signatures stable" and both filter on soon-dropped columns (multi-chapter range hack, `volume_id`), but neither has any harness test — the shape claim is unverified pre-smoke. | Add spine-queries.test.ts cases for `getPassage` (join via chapters) and `searchScriptures` (join via books→volumes), pre-empting a prod-only parity discovery. |
| API-6 | Low | `queries.ts` `getEntity`/`getChapterArt`/`getPublicCollectionIds` | 3 of 13 queries.ts exports never appear in the plan's contract enumeration — not flagged rewritten, not flagged unchanged, just absent. | Enumerate all 13 exports in Public contract with an explicit unchanged/rewritten/deprecated tag each. |
| API-7 | Low | plan §Scope item 2; `tokenize.ts` (new) | "`tokenize` newly exported" doesn't say whether the token interface (`position/surface/normalized/char_start/char_end`) is an exported named TS type for `ingest-words.mjs` and future consumers. | Export a named `Token`/`TokenizeResult` type from `tokenize.ts` and re-export via `index.ts`; state it in Public contract. |
| API-8 | Low | `spine-queries.test.ts` `capturingDb` | JSON.stringify-of-drizzle-sql substring assertions only prove literal-text presence/absence, not join correctness or the actual returned column set — brittle to formatting, blind to the API-1 shape risk. | Acceptable as a smoke layer; supplement with at least one assertion per query on the returned row's key set, not just SQL text. |

## correctness.md

# Panel 1 — Correctness Review — canon-spine plan

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| COR-1 | High | `queries.ts` `getPassage` (chapter*1000+verse arithmetic) | Arithmetic reads `verses.chapter_number`, a P4 transition column slated for drop; plan never specifies the join-based replacement for cross-chapter range queries. | Name the P4-safe rewrite now (row-compare via joined `chapters.number`, not lexical `chapter_id` sort) and add it to Scope/Files touched. |
| COR-2 | High | `spine-queries.test.ts`, failure mode #7 | Harness never exercises `getPassage`, `searchScriptures`, or chapter/verse-level `resolveReference`, though FM-7 claims "volume/book/chapter/verse" coverage and both are named signature-stable functions. | Add capturing-db + resolveReference cases for `getPassage`, `searchScriptures`, chapter and verse levels before implementation starts. |
| COR-3 | Medium | `searchScriptures` volume filter (`queries.ts` L61-70) | Filter reads `verses.volume_id` directly; after the sweep it needs a verses→chapters→books join, but scope doesn't name this path or test ts_rank+join interaction. | Specify the join in the design doc; add a harness case asserting the volume-filtered query still joins through `lumen.books`. |
| COR-4 | Medium | `diffQueryParity` (canon-spine.test.mjs L23-29) | Both test cases compare same-order arrays only; no reordered-but-equal-content case, so ties in `ts_rank`/`DISTINCT` ordering can produce false-positive parity failures. | Add a harness case with permuted-but-equal rows; make diff key-based (e.g. by `id`) rather than index-positional. |
| COR-5 | Medium | `docs/design/canon-spine.md` §Schema (`chapters.verse_count`) | `verse_count` is stored, contradicting the doc's own "nothing derivable stored" principle; idempotent re-run semantics don't say whether it's recomputed, so future verse edits can drift it silently. | Either drop the column (derive via `COUNT` at query time) or make every migration re-run unconditionally recompute it. |
| COR-6 | Medium | Migration invariants (plan.md "Failure modes", `chapters.id` grammar) | No invariant guards `chapters.id` (`{book_id}-{number}`) against colliding with a future book id of the same shape — already anticipated in code (`queries.ts` L106 "Official Declarations"). | Add an in-transaction check: no `books.id` may match any existing `chapters.id` pattern, and vice versa for future inserts. |
| COR-7 | Low | `apps/web/app/routes/scripture.tsx` L553-560 | Next-chapter link renders unconditionally (`chapter + 1`) with no upper-bound check today; plan promises "real bounds" but never says which query supplies max-chapter to this loader. | Specify the query (reuse `getChapterNumbers` or add chapter-count to `getVersesByChapter`) in Files touched, and wire it into the loader's `Promise.all`. |
| COR-8 | Low | Tokenizer contract, `tokenize.test.ts` | Harness only covers unicode em-dash and curly apostrophe; no case for ASCII `--` double-hyphen, bracketed editorial insertions, or pilcrow marks that occur in real KJV/BoM text. | Add unit cases for `--`, `[bracketed text]`, and `¶` before the tokenizer is implemented against the full corpus. |
| COR-9 | Medium | Summary stamping (`metadata.chapter_id`), plan.md P1 | No invariant checks that every summary's stamped `chapter_id` resolves to a row in `lumen.chapters`; an orphaned summary silently returns null post-migration with no smoke coverage. | Add an in-transaction/smoke check: every `chapter_summary` entity's `metadata->>'chapter_id'` must exist in `lumen.chapters`. |

## data-integrity.md

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

## migration-safety.md

# Panel 1 — Migration Safety Review (canon-spine)

Lens: operational mechanics of running `migrate-canon-spine.mjs` and
`ingest-words.mjs` against prod Supabase Postgres, safely, with rollback.

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| MIG-1 | Blocker | plan.md Scope/Files; no env/credential step | No privileged Postgres credential exists locally — `.env.example` only carries the `lumen_read` SELECT-only role; root `.env` with admin creds is gone. | Add a plan step to provision/rotate an admin (or `postgres`) credential path before P1 can run; document its storage, never commit it. |
| MIG-2 | High | plan.md contract line 83; design.md "Migration" section | Neither doc names which host/port `migrate-canon-spine.mjs` must use. Pooler `*.pooler.supabase.com` also serves transaction-mode (6543), which breaks multi-statement BEGIN/DDL/DML sessions. | Require the script to hard-fail unless connected via session-mode/direct (port 5432, non-transaction pool) — assert at startup, don't infer. |
| MIG-3 | High | plan.md Scope item 1; design.md "Migration" | No pre-migration backup/snapshot step anywhere in either doc. At 0 users the risk is process, not people, but a bad P1 DDL/backfill forces a costly ~1.2M-row scripture re-ingest. | Add explicit pre-flight step: Supabase PITR checkpoint noted or `pg_dump --schema=lumen` before running P1. |
| MIG-4 | Medium | plan.md contract line 83 (`--dry-run`) | Dry-run contract is asserted but not specified mechanically — unclear if it executes every statement then `ROLLBACK`, or only simulates, risking false confidence or missed lock/timeout behavior. | Define dry-run explicitly: execute full transaction body, run all invariant checks, always `ROLLBACK` at the end regardless of result, log what would commit. |
| MIG-5 | Medium | plan.md Scope item 1 & Files touched | Plan doesn't say ingest scripts (`ingest-words.mjs`, `backfill-neo4j-collections.mjs`, `ingest-phase-a.ts`) must not run concurrently with the P1 migration transaction; table locks on `verses` would collide. | Name the constraint explicitly: acquire a Postgres advisory lock (or documented run-order) so P1 and any concurrent ingest can't overlap. |
| MIG-6 | Medium | plan.md contract line 84-85 ("idempotent re-run … exits 0") | `SET NOT NULL` and the `chapter_id` backfill `UPDATE` aren't naturally idempotent like `IF NOT EXISTS` table creation — a second run after a partial failure can error on re-applying `NOT NULL` or re-scanning already-set rows. | Guard backfill with `WHERE chapter_id IS NULL`; check `information_schema` before `ALTER ... SET NOT NULL` so re-run is a true no-op. |
| MIG-7 | Medium | plan.md Scope item 2; design.md "Words" | ~1.2M-row words ingest over the pooler has no stated batch size, statement/lock timeout awareness, or duration estimate — precedent (`backfill-neo4j-collections.mjs`) uses `BATCH_SIZE=2000`; this plan gives none. | State a batch size (e.g. per-verse or ~2000-row chunks), note Supabase pooler idle/statement timeout limits, estimate expected wall-clock duration. |
| MIG-8 | High | plan.md Scope item 5 (P4); design.md P4 | P4 column-drop is called "the true point of no return" but no script/flag/human-confirmation gate is named — Files touched lists only one migration script, ambiguous whether P4 auto-runs after P3 passes. | Require P4 as a separate, explicitly-invoked step (e.g. `--drop-transition-columns`) that refuses to run without a persisted "P3 verification passed" marker and manual confirmation. |
| MIG-9 | Low | plan.md Files touched; Failure modes | Migration script's logging/exit-code contract isn't specified to match the `backfill-neo4j-collections.mjs` precedent (structured per-step logs, 0/1/2 exit code taxonomy, redaction of creds in log lines). | Adopt the same contract: structured JSON log lines per invariant/step, exit 0 clean / 1 fatal / 2 partial, scrub credentials from any logged connection string. |

Cross-cutting note: MIG-1 blocks everything else in this table — until an admin
credential path exists on this machine, none of P1–P4 can be executed or even
dry-run against prod, and this gap isn't named anywhere in plan.md or
docs/design/canon-spine.md.

## observability.md

# Panel-1 review — observability — canon-spine

Lens: migration-run observability, dry-run/live parity, words-ingest progress
logging, tokenizer data-smell stats, smoke exit-code contract, ingest-phase-a
freeze signal, web-side instrumentation right-sizing. Precedent: house style is
one `console.log(JSON.stringify({event, ...fields}))` line per step
(`scripts/backfill-neo4j-collections.mjs`), `logEvent` for the worker
(`apps/web/app/lib/log.server.ts`), checkmark-style pass/fail for smoke
(`scripts/smoke-graph-view.mjs`).

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| OBS-1 | med | `scripts/migrate-canon-spine.mjs` (plan §Scope/§Files) | Plan says invariant checks "abort on any mismatch" but never specifies the log shape — no named-check event, no per-phase created/updated counts. | Emit `log(event, data)` per phase and per invariant check (name, expected, actual, pass/fail) before abort, matching backfill's `node_type_done`/`verify_nodes` shape. |
| OBS-2 | med | `migrate-canon-spine.mjs [--dry-run]` (plan §Public contract) | Dry-run is contractually required but plan doesn't say it must emit the same events/fields as a live run — without parity, dry-run output can't be diffed against the real run to sanity-check before committing. | Thread `dryRun` through every log call (as backfill does), same event names/fields in both modes, only the writes differ. |
| OBS-3 | med | Failure mode 6 / FM-6 parity-diff (plan §Failure modes) | Plan requires a row-for-row old-SQL-vs-new-SQL diff on prod but never says where mismatches get written when found — full dump risks flooding console/log sink. | Log one `query_parity_mismatch` event per query with `{query, mismatchCount, sample: rows.slice(0,5)}`, capped sample per house style (backfill's `mismatchSample`). |
| OBS-4 | low | `scripts/ingest-words.mjs`, ~1.2M rows / plan says "batched" (plan §Scope item 2) | Batch size isn't stated but 1.2M rows implies ~1000+ batches; per-batch logging at that volume is noise, unlike backfill's ~10-100 batch runs where per-batch is legible. | Log per-book (`words_book_done`: book id, tokens, verses, skips, elapsedMs) — ~66 books total, not per-batch; keep a single final rollup event. |
| OBS-5 | med | Tokenizer / design doc "match-rate logging" (canon-spine.md §Migration, Words) | "Match-rate logging" is named as the contract but never shaped — no mention of tokens/verse distribution or zero-token verses, which is the actual data smell (a verse indexable by nothing). | Log per-book stats (min/median/max tokens-per-verse) and an explicit `zeroTokenVerses: {count, sample}` field; non-zero should fail the smoke, not just be reported. |
| OBS-6 | low | `scripts/smoke-canon-spine.mjs` (plan §Files, §Harness scope) | No stated exit-code contract. Two house conventions coexist (`smoke-graph-view.mjs`: 0/1 via `check()`+`failures`; `backfill-neo4j-collections.mjs`: 0/1/2 with a distinct "partial failure" code) and the plan doesn't pick one. | State explicitly: follow `smoke-graph-view.mjs`'s `check()`/`process.exit(failures===0?0:1)` pattern since this is a one-shot post-migration gate, not a re-run-until-clean tool. |
| OBS-7 | med | `scripts/ingest-phase-a.ts` freeze (plan Q3, files touched) | Plan's default is "freeze with tombstone comment" but a comment is silent — nothing stops a future invocation from writing rows in the pre-spine shape and desyncing the DB. | Tombstone must be a runtime guard (throw at top of `main()` referencing canon-spine + the replacement path), logged as `phase_a_frozen` if invoked, not just a header comment. |
| OBS-8 | low | `apps/web/app/routes/{scripture,book,home}.tsx` (plan §Files touched) | Loader changes are read-path-only (spine reads, real prev/next bounds); existing `logEvent` calls (`scripture_404`, `graph_not_found`, etc.) already cover the error surface — plan doesn't say no new `logEvent` calls are needed. | State explicitly in plan/PR: no new web-side `logEvent` calls for this feature; flag any added in review as scope creep for a schema-only change. |
| OBS-9 | low | `migrate-canon-spine.mjs` overall (plan §Public contract) | Single-transaction migration over ~1.2M+ verse rows has no stated timing signal — no `startedAt`/`finishedAt`/`elapsedMs`, so a stuck or slow transaction is invisible until it commits or times out. | Add `startedAt`/`finishedAt`/`elapsedMs` to the start/done log events, matching backfill's `backfill_start`/`backfill_done` fields. |

## performance.md

# Performance review — canon-spine plan

Panel-1 / Specialist (performance lens). Reviewed `docs/features/canon-spine/plan.md`,
`docs/design/canon-spine.md`, `packages/scripture/src/queries.ts`,
`scripts/setup-indexes.sql`, `apps/web/app/routes/scripture.tsx`.

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| PERF-1 | High | `verses.chapter_id` (design doc §Schema; `getVersesByChapter` rewrite) | New FK column gets no index anywhere in the plan/design/`setup-indexes.sql`; today's `getVersesByChapter` is a covering-index lookup on every verse click. | Add `CREATE INDEX idx_verses_chapter_id ON lumen.verses(chapter_id, verse_number)` in the migration tx; add to `setup-indexes.sql` and Files-touched. |
| PERF-2 | Medium | `scripture.tsx` loader, reader prev/next (plan: "real chapter bounds") | Prev/next currently costs zero queries (arithmetic links, dead-link bug). Real bounds need a chapters lookup — plan doesn't say it joins the existing `Promise.all`, risking a serial round trip on the hot per-verse-click loader. | Fold bounds into the existing verses/summary `Promise.all` (e.g. return chapter row with prev/next flags from one query), not a bolt-on await. |
| PERF-3 | Medium | `searchScriptures` volume filter (queries.ts:61-77) | Volume filter today is a single indexed column (`idx_verses_volume`); post-drop it becomes verses→chapters→books join (chapter_id opaque, no denormalized volume_id). Plan doesn't call for an EXPLAIN check. | Verify query plan post-migration at 42k rows; if hash-join cost is non-trivial, keep a denormalized `volume_id` on verses (design doc already flags multi-translation tension here). |
| PERF-4 | Low | `lumen.words` (design doc, "surface/normalized for search-direction") | `idx_words_normalized` has no LIMIT posture; a common-word lookup ("every occurrence of X") over 1.2M rows returns thousands with no cap named anywhere in the contract. | Document a default LIMIT (e.g. 200) for any future word-occurrence query before word-study UI fast-follow lands. |
| PERF-5 | High | `scripts/ingest-words.mjs` (plan: "batched; idempotent (delete-and-insert per verse batch)") | Batch size is unspecified. "Per verse batch" read literally means ~42k round trips (one delete+insert per verse), not the ~1,200 implied by a 1000-row batch — over a pooler at 50-100ms/RT that's 35-70 min, not 1-2 min. | Name the batch unit explicitly: multi-verse batches (~1000 words/batch, bulk multi-row INSERT), not per-verse; assert round-trip count in the harness. |
| PERF-6 | Medium | `lumen.nodes` view (plan §4, design doc "Open design question") | Plan says "fine for id lookups... warn against ever scanning it" but no contract enforces that — a future `WHERE kind = X` or `LIKE` query against the 5-way UNION scans every branch. | Document "id-lookup only" as the view's contract in code comment + add a query-shape test that rejects non-`id =` predicates in review. |
| PERF-7 | Medium | `getPassage` (queries.ts:36-53) post transition-column drop (P4) | Current cross-chapter range trick (`chapter_number*1000+verse_number`) is sortable on transitional columns being dropped; `chapter_id` is an opaque slug, so ordering needs a join to `chapters.number`, unaddressed in plan detail. | Rewrite `getPassage` to join `verses.chapter_id = chapters.id` and order by `(chapters.number, verses.verse_number)`; add to spine-queries harness. |
| PERF-8 | Low | Home/book loaders (`getVolumeList` + `getAllBooks`) | Plan's failure-modes list (10 items) has no invariant guarding query count; today's home page is 2 queries via clever UNION ALL — easy to regress to N+1 when rewritten onto real `books`/`volumes` tables. | Add an 11th failure-mode / harness assertion: home and book loaders stay at their current query count after the sweep. |
| PERF-9 | Low | Migration P1, `verses.chapter_id` backfill + `SET NOT NULL` + FK add | Single 42k-row UPDATE plus FK-validation table scan is fine at this size but runs inside the one big transaction (design doc: "0 users") without any named duration budget. | Log elapsed time per invariant-check step in `migrate-canon-spine.mjs` so a future row-count regression becomes visible, not silent. |

## security.md

# Security review — canon-spine plan (PANEL-1 / SPECIALIST)

Reviewed: `docs/features/canon-spine/plan.md`, `docs/design/canon-spine.md`, the harness
(`tokenize.test.ts`, `spine-queries.test.ts`, `canon-spine.test.mjs`), `packages/scripture/src/queries.ts`,
`scripts/backfill-neo4j-collections.mjs`, `scripts/setup-readonly-role.sql`, `scripts/setup-triggers-and-rls.sql`.

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| SEC-1 | High | `setup-readonly-role.sql` §`ALTER DEFAULT PRIVILEGES` vs plan.md migration step | `ALTER DEFAULT PRIVILEGES` only applies to objects later created by the *same role* that ran it; if `migrate-canon-spine.mjs` connects as a different admin role, `lumen_read` gets no auto-SELECT on volumes/books/chapters/words. | Plan must name the migration's connecting role and either match it to the role that ran `setup-readonly-role.sql`, or add an explicit `GRANT SELECT ON lumen.volumes, lumen.books, lumen.chapters, lumen.words TO lumen_read` inside the migration transaction. |
| SEC-2 | High | plan.md "Public contract" / "Files touched" — `scripts/migrate-canon-spine.mjs` | Migration needs a DDL-capable (CREATE/ALTER/DROP) Postgres credential distinct from the app's `lumen_read`-scoped Hyperdrive connection, but the plan names no source for it (no env var, no `loadConfig()`-style doc, unlike the backfill precedent). | Document the admin credential's source (e.g. dedicated env var, never `HYPERDRIVE`/app runtime string) in the plan's public contract before implementation. |
| SEC-3 | Medium | plan.md Files touched (`migrate-canon-spine.mjs`, `ingest-words.mjs`) vs `backfill-neo4j-collections.mjs`'s `scrub()` (labeled SEC-10 there) | Plan doesn't require the new scripts to redact credentials from thrown/logged connection errors; a failed admin-DB connection can leak the password string to stdout/logs. | Require `scrub()` (or equivalent) applied to every caught error/log line in both new scripts, per the established precedent. |
| SEC-4 | Medium | plan.md "Words tokenizer + ingest" (~1.2M rows) vs `tokenize.test.ts` (`LORD’s`, `Beth-el`, `children's`) | Tokenizer contractually preserves apostrophes/hyphens in `surface`/`normalized`; plan doesn't specify parameterized inserts, so naive string-built `INSERT`/`jsonb_to_recordset` SQL breaks or is injectable on these values at scale. | Require bound-parameter batch insert (single bound array/jsonb param, mirroring the Neo4j `UNWIND $rows` pattern already used in `backfill-neo4j-collections.mjs`), not string concatenation. |
| SEC-5 | Medium | `setup-triggers-and-rls.sql` (RLS pre-staged only for `verses`/`entities`/`edges`/`collections`/`words`) vs plan.md schema for `volumes`/`books`/`chapters` | New spine tables have no RLS-enable/policy scaffolding in the plan; Postgres silently no-ops a future `CREATE POLICY` if `ENABLE ROW LEVEL SECURITY` was never run, a footgun for the design doc's planned tradition-scoping feature. | Add `ENABLE ROW LEVEL SECURITY` + permissive `USING (true)` policy for volumes/books/chapters to the migration, matching the words precedent, so future tradition-scoped policies aren't silently inert. |
| SEC-6 | Medium | design.md "Edge-endpoint resolution convention" (`lumen.nodes` view) vs `queries.ts` `getPublicCollectionIds` (app-level `public = true` filtering) | `lumen.nodes` (spine ∪ entities) as planned has no collection-visibility filter; entities RLS is permissive (`USING (true)`), so DB-level access relies on app code filtering by `public` collections — the new view bypasses that convention. | Specify in the plan whether `lumen.nodes` filters non-public-collection entities, or document that consumers must re-apply `getPublicCollectionIds`-style filtering before using view results. |
| SEC-7 | Low | plan.md scope / design.md — `tokenize` newly exported from `@lumen/scripture` | `tokenize()` is documented as processing only trusted canon verse text, but once exported it's callable by any consumer (web app or MCP) on arbitrary strings; plan has no explicit guard or doc note against running it on user input. | Add a doc comment on `tokenize` stating it must only run on ingest-time canon text, never request/user-supplied strings. |
| SEC-8 | Low | plan.md Scope "Out" (word-study UI deferred) vs `queries.ts` existing `LIMIT` convention (`searchScriptures` defaults to 10) | No LIMIT/pagination convention is set for future queries against the ~1.2M-row `words` table (publicly SELECT-able via `lumen_read`), risking an easy unbounded-query DoS vector when the fast-follow word-study feature ships. | Note in the plan/design that any future `lumen.words` query must carry a bounded `LIMIT` (scoped by `verse_id`), same convention as existing verse queries. |

## ux.md

# Panel 1 — UX review — canon-spine

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| UX-1 | Medium | `scripture.tsx` header nav (lines 553–561) | Fixing the dead "Chapter N+1" link makes next simply vanish on the last chapter — a dead end with no path onward to the next book. | Consider a "Next book →" (and symmetric "← Previous book") affordance when at a volume/book boundary, not just link removal. |
| UX-2 | Medium | `scripture.tsx` nav labels (lines 554, 558) vs `book.tsx` unit logic (line 52) | Reader prev/next hardcodes "Chapter N/N+1" even for `dc`, while the chapter grid already calls them "Sections" — inconsistent vocabulary for the same book, worse now that real bounds make this link trustworthy. | Reuse the `unit` (Section/Chapter) logic in the reader's prev/next text and breadcrumb while the sweep is already touching this file. |
| UX-3 | Low | `scripture.tsx` `aria-label="Chapter navigation"` (line 549) and `book.tsx` `aria-label={`${unit}s in ${name}`}` (line 69) | The reader's nav landmark label is hardcoded "Chapter" even for D&C, unlike the book grid's unit-aware label — a screen-reader inconsistency once UX-2 is fixed elsewhere. | Make the nav `aria-label` unit-aware too, e.g. `` `${unit} navigation` ``. |
| UX-4 | Low | `book.tsx` (bookId === "dc" check, line 52) vs proposed fix duplicating the same check into `scripture.tsx` | The Section/Chapter unit decision is a hardcoded id check duplicated per-file; fixing UX-2 doubles that duplication instead of centralizing it. | Derive `unit` once (helper in `@lumen/scripture` or shared util) so book.tsx and scripture.tsx can't drift again. |
| UX-5 | Low | `book.tsx` chapter grid (lines 70–82) | Chapters table now carries `verse_count` for free, but the grid still shows bare numbers — a plausible "worth it?" addition not mentioned anywhere in the plan's scope. | Treat as explicitly out-of-scope for this feature (structural data only) unless the plan is amended to add a UI line item. |
| UX-6 | Medium | plan.md Scope/Out; `home.tsx` (volume_id grouping, lines 23–40) | `volumes.tradition` lands this feature and enables tradition-grouped library views, but the plan's "Out" list doesn't explicitly name home.tsx/tradition-grouping — an implicit exclusion invites scope creep. | Add an explicit line to plan.md "Out": home.tsx keeps today's flat volume grouping; tradition-based grouping/scoping is a separate feature. |
| UX-7 | Low | plan.md Scope (Word-study UI, line 62); scripture.tsx (no words usage found) | Words table lands this feature with real offsets, and nothing in the reader currently surfaces it — confirms no drift today, but flagging as a guardrail since the data now *exists* to tempt an in-flight addition. | Keep as-is; reviewers of the implementation PR should reject any hover/word-highlight UI sneaking in under this feature. |
| UX-8 | Medium | Failure modes list (plan.md); FM-6 "query parity" only covers row correctness | No failure mode or smoke check addresses perceived latency: spine joins (volumes→books→chapters→verses) replace single-table jsonb reads for `scripture.tsx`/`book.tsx`/`home.tsx` loaders. | Add a lightweight smoke assertion (or note in FM-6) that P50/P95 loader latency doesn't regress post-migration — parity is a UX requirement, not just a data one. |
| UX-9 | Info (affirm) | plan.md "Public contract" (line 88): "URLs, verse/chapter/book ids ... byte-identical before/after" | Confirmed as the correct UX contract — book/chapter grid links, reader prev/next, and cross-ref navigation all key off `bookId`/chapter number, none of which change. | No action; keep this invariant in the smoke script's explicit assertions so a future PR can't silently regress it. |

