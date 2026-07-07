# Plan — canon-spine

## Tier
**large** — risk axes: data migration (always-escalate; new schema + transactional
backfill of prod), cross-system blast radius (`@lumen/scripture` consumed by web
+ separately-deployed MCP server), behavior change, ≥300 lines net-new
(DDL, migration, tokenizer, ~1.2M-row words ingest, consumer sweep).

## Goal
Normalize the scripture spine into real FK'd tables (volumes → books → chapters
→ verses → words) with today's slug ids preserved, populate the words table via
an offsets-based tokenizer, and sweep all consumers onto the spine — killing the
entity-namespace bug class (D&C collision, od trap, chapter-id drift, dead
chapter links, UNION heuristics) at the root. Design input: `docs/design/canon-spine.md`
(schema, migration phases, collections boundary — all pre-decided with Abram).

## Prior learnings surfaced (step-2 requirement)

| Source | Learning | Application |
|---|---|---|
| graph-view retro | Verify data-shape claims against the LIVE store; ingest source can predate reality | Chapters derive from `lumen.verses` (ground truth), never chapter entities; every migration claim gets a live-diff check |
| graph-view retro | Unlabeled matches can't use indexes; joins have namespace traps | Spine FKs make the join contract explicit; migration verification diffs row-for-row |
| web-app-wiring retro | Mock-only tests hid every data-shape bug; add real-data smoke | `smoke-canon-spine.mjs` runs post-migration invariants against prod (counts, FK orphans, dc row, query parity) |
| kedrec retro | Mock the database layer in harnesses — bugs live in unmocked data paths | Tokenizer + verification logic are pure functions with exhaustive unit harness; SQL is exercised by the live smoke |
| shared-infra retro | Error-path assertions must match happy-path coverage | Migration script asserts and aborts on every invariant violation (inside the transaction), not just happy path |
| multi-kb retro | Partial-failure handling is implementation scope | Words ingest is batched + idempotent per verse; interrupted runs converge |

## Scope

- **In:**
  1. **Spine DDL + migration** (`scripts/migrate-canon-spine.mjs` emitting one
     transaction): `volumes` (id, name, abbrev, tradition, source, sort_order;
     UNIQUE(tradition, sort_order)), `books`, `chapters` (derived from verses),
     `verses.chapter_id` (backfill → NOT NULL → FK), summary entities stamped
     `metadata.chapter_id`. The `dc` book row inserted explicitly. In-transaction
     invariant checks abort on any mismatch.
  2. **Words tokenizer + ingest**: pure `tokenize(text)` in
     `packages/scripture/src/tokenize.ts` returning `{position, surface,
     normalized, char_start, char_end}[]`; contract: offsets round-trip
     (`text.slice(start,end) === surface`), positions contiguous from 1,
     word-internal apostrophes/hyphens kept (`LORD's`, `Beth-el`), curly→straight
     apostrophe in `normalized`, punctuation never tokenized, deterministic.
     Ingest batches ~1.2M rows; idempotent (delete-and-insert per verse batch).
  3. **Consumer sweep**: `queries.ts` structural queries rewritten on spine —
     **public function signatures unchanged** (`getAllBooks`, `getBooksByVolume`,
     `getChapterNumbers`, `getVolumeList`, `getChapterSummary`, `searchScriptures`,
     `getPassage`) so the MCP server keeps working untouched until its own
     update; internals lose the UNION heuristic + jsonb casts. Reader prev/next
     uses real chapter bounds (last-chapter dead link dies). Book/home loaders
     read spine.
  4. **Edge-endpoint resolution convention**: `lumen.nodes` view
     (`spine ∪ entities` — id, kind, name) as the single lookup surface for
     arbitrary edge endpoints.
  5. **Transition-column drop** (P4): `verses.volume_id/book_id/chapter_number`
     dropped after parity verification passes; structural entities marked
     deprecated in place (Neo4j mirror source until graph chapter-id cleanup).
- **Out:**
  - Strong's alignment, TSKe ingest, JST surfaces (fast-follows on this substrate).
  - Collections user-half (resolution fn/cookie/toggles).
  - Multi-translation modeling (guardrail only: `volumes.source` carries text
    provenance; panels sanity-check we don't foreclose a translations table).
  - Word-study UI (hover tooltips) — needs Strong's alignment first.
  - Neo4j chapter-id (`X-ch-N`) alignment — separate cleanup.

## Files touched
- `scripts/migrate-canon-spine.mjs` (new: DDL + backfill + invariant checks, tx)
- `scripts/ingest-words.mjs` (new: tokenizer-driven words population)
- `scripts/smoke-canon-spine.mjs` (new: live post-migration invariants)
- `scripts/__tests__/canon-spine.test.mjs` (new: harness for migration pure fns)
- `packages/scripture/src/tokenize.ts` (new), `src/__tests__/tokenize.test.ts` (new: harness)
- `packages/scripture/src/queries.ts` (rewrite internals; signatures stable)
- `packages/scripture/src/__tests__/spine-queries.test.ts` (new: harness)
- `apps/web/app/routes/scripture.tsx` (prev/next real bounds), `book.tsx`, `home.tsx` (spine reads)
- `apps/web/app/routes/__tests__/*` (loader harness updates)
- `scripts/ingest-phase-a.ts` (frozen with tombstone comment OR updated — gate Q)
- `scripts/backfill-neo4j-collections.mjs` (node sources → spine)

## Public contract
- Spine tables exactly per `docs/design/canon-spine.md` §Schema (including:
  spine carries **no collection_id**; `IS NULL` = core corpus, documented rule).
- `@lumen/scripture` exported query signatures **unchanged** (MCP compatibility);
  `tokenize` newly exported.
- `node scripts/migrate-canon-spine.mjs [--dry-run]` — single transaction; any
  invariant failure aborts with a named check; idempotent re-run (IF NOT EXISTS
  + upserts) exits 0.
- `node scripts/ingest-words.mjs [--book <id>]` — idempotent; reports
  tokens/verses/skips; re-run converges.
- URLs, verse/chapter/book ids, `lumen.edges` contents: byte-identical before/after.

## Failure modes (must each have a harness assertion)
1. Tokenizer offsets don't round-trip (`slice(start,end) !== surface`) for any
   token in any verse → tokenizer harness property test + live smoke over full corpus.
2. Tokenizer emits non-contiguous/zero positions, empty tokens, or tokenizes
   punctuation → unit cases (apostrophes, hyphens, em-dashes, quotes, numerals).
3. Chapters derived from verses disagree with distinct (book, chapter) pairs →
   in-transaction invariant + smoke count check.
4. Any verse with NULL/orphan `chapter_id` after migration → NOT NULL + FK +
   smoke zero-orphan check.
5. `dc` book row missing, or any book row whose id appears in verses missing →
   smoke check (the D&C class, spine edition).
6. Query parity broken: any rewritten query returns different rows than its
   pre-migration counterpart → smoke runs old-SQL vs new-SQL diff on prod.
7. MCP surface drift: `resolveReference` behavior changes for volume/book/
   chapter/verse inputs → package harness against mocked db (signature +
   shape assertions).
8. Words ingest interrupted mid-run → re-run converges (idempotency unit on
   batch planner + smoke recount).
9. `lumen.nodes` view misses a kind (spine row or entity unreachable by id) →
   smoke lookup of one id of each kind.
10. Reader prev/next: last chapter shows no next link; first shows no prev →
    loader harness.

## Harness scope
**behavior** — harness-first **required**. Vitest (tokenizer pure-function
suite incl. property round-trip; spine query shape tests with captured SQL;
resolveReference compatibility) + node:test (migration invariant/diff pure fns)
+ live smoke script (post-migration, blocked until DB write exists — the rest
of the harness must fail now for honest harness-first).

## Open questions (for human gate)
- Q1 — `lumen.nodes` view as the edge-endpoint lookup convention? Default: yes.
- Q2 — Transition-column drop in this feature (P4) vs deferred feature? Default:
  this feature, gated on parity verification passing.
- Q3 — `ingest-phase-a.ts`: freeze with tombstone (default) or rewrite to spine
  now? Default: freeze; rewrite when the next real ingest need arises.
- Q4 — Tokenize all 5 volumes now (default) or Bible-only first? Default: all.
- Q5 — Words id format `{verse_id}-w{position}` (default) — confirm.
- Q6 — MCP: keep-signatures-stable strategy means no coordinated redeploy needed
  now; MCP picks up spine internals on its next routine update. Default: accept.

## Plan amendments (post-panel synthesis)

**Schema**
- `CREATE INDEX idx_verses_chapter_id ON lumen.verses (chapter_id, verse_number)`
  in the migration tx + `setup-indexes.sql` [PERF-1 — the index fell out of the
  committed design doc].
- `chapters.verse_count` **dropped** — derive via COUNT; resolves the design
  doc's self-contradiction in favor of its own "nothing derivable stored"
  principle [COR-5].
- `volumes.tradition` takes `metadata.canon` values **verbatim**
  (`'bible' | 'restoration'` — the real data); finer vocabulary arrives with
  new traditions. Design-doc comment corrected [DATA-4].
- RLS enabled + permissive `USING (true)` policies on volumes/books/chapters,
  matching the existing 5-table convention, so future tradition-scoped
  policies aren't silently inert [SEC-5].

**Migration script (`migrate-canon-spine.mjs`)**
- Startup assertion: session-mode connection (port 5432 / non-transaction
  pool); hard-fail otherwise [MIG-2].
- `--dry-run` = execute the full tx body + all invariant checks, always
  ROLLBACK; identical event names/fields to live (only writes differ)
  [MIG-4, OBS-2].
- Explicit `GRANT SELECT ON <new tables> TO lumen_read` inside the tx —
  `ALTER DEFAULT PRIVILEGES` binds only to the role that ran it [SEC-1].
- `verses.chapter_id` backfilled via JOIN to the just-inserted `chapters`
  rows — never a second hand-built concat [DATA-3].
- Pre-insert validation of book-entity metadata (named check, logged, aborts)
  [DATA-8]; per-check log tuple `{check, expected, actual, pass}` + phase
  counts + startedAt/finishedAt/elapsedMs [OBS-1, OBS-9]; parity-diff output
  capped samples per house style [OBS-3]; parity diff is key-based with a
  permuted-equal harness case [COR-4].
- **P4 is a separate invocation** (`--drop-transition-columns`) gated on a
  persisted P3-verification-passed marker + human confirmation [MIG-8].
- Pre-flight line: note Supabase PITR availability / `pg_dump --schema=lumen`
  before P1 [MIG-3 — survives as data-loss carve-out; right-sized].
- Header documents single-runner constraint (no concurrent ingests) [MIG-5
  rationale noted].
- In-tx check: every summary's stamped `metadata.chapter_id` resolves to a
  `chapters` row [COR-9].

**Queries / contract**
- All **13** `queries.ts` exports enumerated with explicit
  unchanged/rewritten/deprecated tags [API-2, API-6]; `getVersesByChapter`
  (hottest path) added to the rewrite list with a chapter_id-join shape
  assertion [API-2].
- `getPassage` rewritten to join `chapters` and order by
  `(chapters.number, verses.verse_number)` [COR-1, PERF-7]; `searchScriptures`
  volume filter via verses→chapters→books join [COR-3].
- `VERSE_COLUMNS` rebuilt spine-safe **with aliased columns preserving the old
  field names** (book_id, chapter_number, volume_id) so MCP verse/chapter JSON
  shapes are byte-stable through P4 [API-1, API-4].
- New exports `getBook(id)` / `getVolume(id)`; book.tsx migrates off
  `getEntity` [API-3 — required by existing scope; exports now named].
- Harness-revision at implementation start: resolveReference chapter+verse
  cases, getPassage/searchScriptures/getVersesByChapter/getVerseById shape
  tests, returned-key-set assertions, permuted parity case [COR-2, API-1,
  API-4, API-5, API-8].

**Web**
- Prev/next real bounds fold into the existing loader `Promise.all` (single
  chapters lookup), never a serial await [COR-7, PERF-2].
- `unit` helper ("Section"/"Chapter") exported from `@lumen/scripture`; reader
  nav text + aria-labels and book grid both consume it [UX-2, UX-3, UX-4].
- Explicit Out line: home keeps flat volume grouping; tradition grouping is a
  separate feature [UX-6 rationale]. No new web logEvent calls [OBS-8].

**Scripts**
- `ingest-words.mjs`: multi-verse batches (~2,000 rows/batch, bulk insert,
  bound params), round-trip count asserted in harness [PERF-5, MIG-7, SEC-4
  correctness note]; per-book logging + tokens/verse stats; zero-token verses
  fail the smoke [OBS-4, OBS-5]; per-batch DELETE+INSERT in one tx [DATA-7
  rationale honored cheaply].
- `ingest-phase-a.ts`: **runtime tombstone** — throw at top of `main()`
  naming canon-spine + replacement path [OBS-7].
- `backfill-neo4j-collections.mjs`: spine-sourced node groups stamp
  `cid: 'canon'`, mirroring its existing verse special-case [DATA-2].
- `scrub()` applied to every error/log path in both new scripts [SEC-3].
- `lumen.nodes`: **literal union that always includes deprecated structural
  entities** (drifted-id edge endpoints must never orphan) [DATA-1]; contract
  comment: id-lookup only [PERF-6 rationale]; consumers re-apply collection
  visibility filtering — the view does none [SEC-6].
- FM-9 upgraded: exhaustive anti-join of ALL edge endpoints against
  `lumen.nodes`, not a per-kind sample [DATA-5].

## Decisions

Panel-2 dissent: **(40 material + 15 risky) / 69 = 0.797.** Carve-outs
exercised: SEC-2 and MIG-3 (High, security/data-loss) survive their `risky`
tags — both incorporated in right-sized form. One panel-1 finding refuted with
repo evidence (DATA-6: 'od' is one book with two chapters, no collision).

| IDs | Resolution |
|---|---|
| SEC-1, SEC-3, SEC-5, SEC-6 | incorporated (see amendments) |
| SEC-2 | incorporated via carve-out — admin credential source documented in Public contract; provisioning is the gate blocker (MIG-1) |
| SEC-4 | deferred-out-of-scope as security; its bound-params substance incorporated under ingest-words |
| SEC-7, SEC-8 | dropped-as-noise / deferred-out-of-scope (word-study feature) |
| COR-1, COR-2, COR-3, COR-4, COR-5, COR-7, COR-9 | incorporated |
| COR-6 | rejected-with-rationale: "collision implausible under current slug conventions; citation doesn't support it" |
| COR-8 | rejected-with-rationale: "claimed characters unconfirmed in corpus" — cases added opportunistically if observed during ingest |
| DATA-1, DATA-2, DATA-3, DATA-4, DATA-5, DATA-8 | incorporated |
| DATA-6 | dropped-as-noise (refuted: od = one book, two chapters) |
| DATA-7 | rejected-with-rationale: "FM-8 accepts the window by design; converges on re-run" — single-tx batch honored anyway |
| MIG-1 | incorporated — **gate blocker**: admin session-mode credential |
| MIG-2, MIG-4, MIG-7, MIG-8 | incorporated |
| MIG-3 | incorporated via carve-out (right-sized: PITR note / schema dump line) |
| MIG-5 | rejected-with-rationale: "single developer, no concurrent triggers" — header constraint documented |
| MIG-6 | rejected-with-rationale: "SET NOT NULL rerun claim factually wrong" — ADD COLUMN IF NOT EXISTS retained |
| MIG-9 | rejected-with-rationale: "polish, not a gate" — logging contract adopted via OBS items anyway |
| API-1, API-2, API-4 | incorporated |
| API-3 | rejected-with-rationale per tag ("drift risk, not break") — superseded: getBook/getVolume added as plan-scope necessity |
| API-5 | rejected-with-rationale ("live smoke compensates") — shape tests added anyway under harness-revision |
| API-6, API-7, API-8 | dropped-as-noise (API-6/API-8 substance folded into enumeration + key-set assertions) |
| PERF-1, PERF-2, PERF-5, PERF-7 | incorporated |
| PERF-3 | rejected-with-rationale: "negligible at 42k rows" — EXPLAIN spot-check noted in smoke |
| PERF-4 | deferred-out-of-scope (word-study feature) |
| PERF-6 | rejected-with-rationale — id-lookup-only contract comment added anyway |
| PERF-8 | rejected-with-rationale: "negligible cost; overlaps FM-6" |
| PERF-9 | dropped-as-noise — timing fields ship via OBS-9 regardless |
| OBS-1, OBS-2, OBS-3, OBS-4, OBS-5, OBS-7, OBS-8, OBS-9 | incorporated |
| OBS-6 | dropped-as-noise (no CI consumer) — 0/1 convention used anyway |
| UX-2, UX-3, UX-4 | incorporated (unit helper) |
| UX-1, UX-5 | deferred-out-of-scope (new affordances; punch-list candidates) |
| UX-6 | rejected-with-rationale per tag — the requested Out line added to plan |
| UX-7, UX-9 | dropped-as-noise (restate plan verbatim) |
| UX-8 | rejected-with-rationale: "P50/P95 disproportionate at 0 users" — one manual latency sanity note in smoke |

## Plan amendment — code-review fixes (2026-07-07, steps 9–13)

Code-panel (7 roles, 40 canonical findings) × code-adversarial (25 material)
→ 21 confirmed bugs, all fixed pre-prod-run. Full filter in bugs.md; aggregates
in reviews/code-panel.md and reviews/code-adversarial.md. Plan-level changes:

- **DEPLOYMENT ORDER (B4/CCOR-1, new hard constraint):** P1 + summary stamping
  MUST run against prod before any web deploy of this branch. The rewritten
  query layer reads spine tables and stamped metadata that exist only post-P1;
  deploying first breaks every scripture route. Also stated in the migration
  script header.
- P4 now requires `--drop-transition-columns --confirm` (B5/CMIG-2 — restores
  the promised human-confirmation gate); any P1 re-run deletes the P3 marker
  (staleness fix, replacing the rejected hash-binding machinery); P4 re-checks
  the marker inside its transaction, marks structural entities
  `metadata.deprecated`, and writes a `canon-spine-p4-done` audit row.
- `lumen.words` is now `CREATE TABLE IF NOT EXISTS` + RLS'd like its siblings
  (B1/B2 — the DROP TABLE re-run wipe is dead); its search index moves to
  ingest-words.mjs post-bulk-load (B17).
- Session mode is verified by a live SET/current_setting probe, not the port
  string (B6); `--book` validates against lumen.books (B8).
- Parity now covers books, getBooksByVolume, getPassage, searchScriptures, and
  a volume_id old-vs-new drift invariant (B3/B14 — volume_id was the one field
  that changed source table with no check).
- Harness additions (repro tests): SPINE_DDL shape + p4Preflight in
  scripts/__tests__/canon-spine.test.mjs; getVerseByReference/getBook/
  getVolume/unknown-resolver in spine-queries.test.ts; scripture-loader
  query-count guard.
- `postgres` added as a root devDependency; admin scripts no longer reach into
  apps/web/node_modules (B11).

## Drift baseline (filled at end of step 6)
- plan-hash: e12d4c99f05a2255 (sha256/16 at synthesis, pre-stamp)
- harness-hash: d6eec528441e4eac (sha256/16; harness-revision applied post-gate: COR-2, API-1/4/5, COR-4 coverage)
- post-amendment (2026-07-07): re-baselined in the plan-amendment commit; hashes recomputed below
- plan-hash-2: d66e593ba488c808
- harness-hash-2: 313ad901f0092485
