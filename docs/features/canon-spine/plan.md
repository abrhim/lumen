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

## Drift baseline (filled at end of step 6)
- plan-hash: <pending>
- harness-hash: <pending>
