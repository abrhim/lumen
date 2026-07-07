# Plan — tske-cross-references (OpenBible cross-references)

> Naming note: the feature slug predates source selection. The shipped source
> is **OpenBible.info cross-references** (CC-BY), chosen at clarification after
> TSKe turned out to be © Timothy Morton (redistribution obligation, no clean
> raw download) rather than CC-BY STEPBible data as first believed. Classic
> TSK (public domain, phrase-keyed) and BYU SCI (verse→talk citations, no
> license path yet — permission email to scriptures@byu.edu) are follow-ups.

## Tier
**large** — risk axes: data migration (~345k-row ingest into prod
`lumen.edges` + new collection row), cross-system blast radius
(`@lumen/scripture` gains exported queries; MCP server consumes the package —
explicitly OUT of scope per Abram, adopts later), behavior change + public
surface (verse panel cites/cited-by swaps data source Neo4j→Postgres and
presentation), ≥300 lines net-new.

## Goal
Replace the inaccurate curated cites/cited-by in the reader's verse panel with
OpenBible.info's 344,799 vote-ranked cross-reference pairs, served from
Postgres. Bible verses get vote-sorted refs both directions; BoM/D&C/PGP
verses keep the legacy curated refs (labeled) since no open verse↔verse source
covers them. Old curated edges stay in the DB, out of the Bible UI (Abram's
call, twice confirmed).

## Prior learnings surfaced (step-2 requirement)

| Source | Learning | Application |
|---|---|---|
| canon-spine retro | Probe live id/shape conventions with one SELECT during planning | DONE at plan time: data profiled (66 OSIS codes, 88,150 to-ranges, 655 cross-chapter, 1,239 negative votes, no verse-0), edges schema + collections read live |
| canon-spine retro | Export script constants / gate predicates; harness-test them like data | OSIS map + ref parser + range expander are exported pure functions; ingest invariants use named checks |
| canon-spine retro | Critical-path review roles run synchronously; background agents stalled 4× | Panels this run: launch in parallel but relaunch-inline on first failure |
| graph-view retro | Verify data-shape claims against the LIVE store | Ingest validates every generated verse id against `lumen.verses` in-tx; unmapped rows are counted, capped, and reported |
| graph-view retro | apps/web lacks component-test infra; UI bugs get repro-deferred | Panel logic extracted to pure functions (group/sort/label); loader tests assert data shape |
| web-app-wiring retro | Mock-only tests hid data-shape bugs; add real-data smoke | `smoke-openbible.mjs` runs live invariants incl. spot-checked famous refs |
| canon-spine (in-run) | Deferred promises must never touch the PG connection (COR-2/waitUntil) | Cross-refs fetched in the loader critical path (2 indexed lookups); Neo4j principles/people stay streamed |

## Scope

- **In:**
  1. **OSIS mapping + ref parsing** (`packages/scripture/src/osis-map.ts`, pure):
     fixed 66-entry OSIS→slug table (`1Cor`→`1-cor`, `Ps`→`ps`, `Phil`→`philip`,
     `Hos`→`hosea`, …), `parseOsisRef('Gen.1.1')` → verse id, range expansion
     `Ps.148.4-Ps.148.5` → per-verse ids (cross-chapter ranges — 655 rows —
     expand via an injected chapter→verse-count lookup).
  2. **Ingest** (`scripts/ingest-openbible-refs.mjs`): downloads/reads the CC-BY
     TSV; `openbible` collection row (license `cc-by`, provenance
     `openbible.info`); ranges EXPANDED to one edge per target verse
     (est. ~600k edges total) with `metadata: {votes, range_start, range_end}`
     so cited-by is correct for mid-range verses while the panel renders one
     card per range; `rel_type='CROSS_REF'`, `collection_id='openbible'`,
     `source='openbible'`. Idempotent: delete-collection-then-insert in
     batched transactions. Admin DSN (root .env) + session probe. In-tx named
     invariants: every from/to id resolves in `lumen.verses`; unmapped-row
     count reported and capped (<0.5% or abort); negative votes kept.
  3. **Query layer** (`queries.ts`): `getCrossReferences(db, verseId, opts)` —
     one function, both directions (outgoing = from_id match; incoming =
     to_id match), joined to verses for reference+text, vote-sorted desc,
     per-direction limit (default 20), collection parameter so the same
     function serves `openbible` (Bible) and the legacy collection (BoM/D&C/PGP).
     Range dedup (one row per from/range group) happens in SQL or a pure
     helper — panels to weigh in.
  4. **Verse panel swap** (`scripture.tsx`): loader fetches cross-refs from
     Postgres in the critical path when a verse is selected (volume decides
     collection: bible→openbible, else legacy+label); Neo4j `getVerseConnections`
     slims to principles/people only; KV cache key bumps `vconn:v1:`→`vconn:v2:`
     (payload shape changes). Panel renders grouped, vote-ranked "References" /
     "Referenced by" with target reference + snippet; legacy refs get a small
     "legacy" label; ranges render as one card ("Ps 148:4–5").
  5. **Live smoke** (`scripts/smoke-openbible.mjs`): counts, zero orphan
     endpoints, famous-ref spot checks (Gen.1.1→Heb.11.3 votes=271 present;
     John.3.16 has refs both directions), votes ordering, legacy path intact.
- **Out:**
  - MCP adoption (`find_cross_references` stays Neo4j; adopts `getCrossReferences` later — Abram: "come to mcp later").
  - BYU SCI verse→talk citations (separate ingest once permission lands; panel design leaves room for a third section).
  - Phrase/word anchoring (needs a public-domain phrase-keyed TSK copy; words-table anchoring path already proven by canon-spine).
  - Neo4j mirroring of openbible edges (graph view unchanged this feature).
  - Removing curated CROSS_REF edges from Neo4j/PG (kept, just not surfaced for Bible verses).

## Files touched
- `packages/scripture/src/osis-map.ts` (new, pure) + `__tests__/osis-map.test.ts` (new: harness)
- `packages/scripture/src/queries.ts` (+`getCrossReferences`) + `__tests__/spine-queries.test.ts` (extend)
- `packages/scripture/src/index.ts` (export)
- `scripts/ingest-openbible-refs.mjs` (new) + `scripts/__tests__/openbible.test.mjs` (new: harness for exported pure fns)
- `scripts/smoke-openbible.mjs` (new)
- `apps/web/app/routes/scripture.tsx` (panel + loader) + `__tests__/scripture.loader.test.ts` (extend)

## Public contract
- `lumen.edges` gains ~600k rows under `collection_id='openbible'`; no schema DDL
  (table, indexes on from_id/to_id already exist). Existing edges untouched.
- `getCrossReferences(db, verseId, {collectionId, limit})` exported from
  `@lumen/scripture`; existing exports unchanged (MCP untouched).
- `getVerseConnections` keeps its signature; its cross_references field becomes
  empty/ignored by the web panel (MCP still calls it unchanged).
- CC-BY attribution: collection row carries license + provenance; panel footer
  credits "Cross-references: openbible.info (CC-BY)".
- Deployment order: ingest BEFORE web deploy (else Bible panels render empty
  sections); additive-only, so old deployed app is unaffected by the ingest.

## Failure modes (must each have a harness assertion)
1. OSIS code maps to wrong/missing slug → exhaustive 66-code table test against
   the live book id list.
2. Range expansion wrong at chapter boundaries (655 cross-chapter ranges) →
   unit cases incl. cross-chapter with injected verse-count lookup; property:
   expansion length == span; first/last match endpoints.
3. Generated verse id doesn't exist in lumen.verses (versification drift) →
   in-tx invariant with capped unmapped report; smoke zero-orphan check.
4. Cited-by misses mid-range verses → expansion design + unit test (Ps.148.5
   inbound from Gen.1.1 row).
5. Panel double-counts a range (one edge per expanded verse) → group/dedup
   helper unit test: one card per (from, range) group.
6. Vote ordering broken or negative-vote spam ranks high → SQL-shape ORDER BY
   assertion + panel helper sorts desc, negative votes render below fold/limit.
7. Legacy BoM/D&C path broken by the swap → loader test: bom verse selects
   legacy collection; bible verse selects openbible.
8. PG touched from a deferred promise (COR-2 class) → loader test asserts
   cross-refs resolve in critical path (no PG call inside the streamed promise).
9. KV cache serves stale v1 payload shape → key literal test `vconn:v2:`.
10. Ingest re-run duplicates edges → idempotency: delete-then-insert per run;
    smoke count stable across re-run.

## Harness scope
**behavior** — harness-first required. Vitest: osis-map exhaustive table +
parser + expansion property tests; getCrossReferences SQL-shape (capturingDb);
panel group/sort pure helpers; loader collection-selection + cache-key tests.
node:test: ingest exported pure fns (row planner, invariant predicates).
Live smoke post-ingest. Initial harness must FAIL (nothing implemented).

## Open questions (for human gate)
- Q1 source: **RESOLVED pre-plan** — OpenBible CC-BY (Abram approved after TSKe license finding).
- Q2 BoM/D&C: **RESOLVED pre-plan** — hybrid; legacy curated refs render only for volumes OpenBible doesn't cover, labeled.
- Q3 range storage: expand to per-verse edges (correct cited-by, ~600k rows) vs store-start-only (~345k rows, cited-by misses mid-range). **Default: expand.**
- Q4 negative-vote refs (1,239): ingest and rank last vs drop at ingest. **Default: ingest, rank last.**
- Q5 per-direction limit in the panel. **Default: 20, "show all" affordance deferred.**
- Q6 legacy label wording for BoM/D&C refs. **Default: "curated (legacy)" chip.**
