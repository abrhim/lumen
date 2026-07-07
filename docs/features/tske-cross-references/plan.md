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

## Plan amendments (post-panel synthesis)

1. **Ingest atomicity (DATA-1/SEC-2/COR-2):** the entire delete+insert runs in
   ONE transaction (canon-spine P1 precedent; ~600k rows is fine). No
   half-populated window, no resume marker needed.
2. **Dedup + self-ref filter (DATA-2/DATA-4):** aggregate duplicate
   (from,to) pairs (keep max votes) and drop from_id=to_id rows pre-insert;
   both counted in named in-tx checks.
3. **Collection row upsert (DATA-5):** `ON CONFLICT (id) DO UPDATE` — plain
   INSERT would throw on re-run (collections.id is a real PK).
4. **Post-ingest gate (DATA-3):** re-run `smoke-canon-spine.mjs` after ingest;
   its exhaustive edge-endpoint anti-join must stay green.
5. **Versification drift (COR-1, Critical):** explicit exceptions map for
   known KJV-vs-modern drift refs (3John.1.15→3john-1-14, Rev.12.18→rev-13-1);
   any other target verse id that doesn't exist counts toward the unmapped cap
   (never clamped, never guessed). Smoke adds a Psalm-title spot check
   (a title-sensitive psalm's top ref must land on the expected KJV text).
6. **Cross-book ranges (COR-4, verified 18 rows):** `expandOsisRange` takes an
   ordered chapter sequence (derived from spine books.sort_order + chapters)
   and rolls over book boundaries; unit test uses the live `Lev.27.34-Num.1.1`
   example.
7. **Unmapped cap semantics (COR-5/OBS-3, FM-11):** evaluated once over the
   whole run; denominator = source TSV rows (344,799); named check
   `openbible_unmapped_threshold` at 0.5%; exit code 1 on breach;
   boundary-value unit test.
8. **Critical-path degrade (COR-6/OBS-1/PERF-1):** `getCrossReferences` call
   is wrapped never-throw (empty-with-degraded-flag + `crossref_degraded` log,
   mirroring `loadConnections`); it joins the EXISTING loader Promise.all so
   added wall-clock ≈ 0 (parallel with verses/summary/art); chapter text is
   never gated beyond that existing barrier.
9. **Ingest observability (OBS-2/OBS-5, PERF-3):** `openbible_unmapped_refs
   {count, ratio, sample}` event; run summary logs deleted/inserted totals +
   elapsedMs; batch size documented (5,000 rows/batch ≈ 120 batches, est.
   2–4 min); smoke adds a re-run count-stability bullet.
10. **Panel UI (UX-1..6, A11Y-1/2/4/5, SEC-4 substance):** principles/people
    keep reserved-height skeleton slots inside their own `aria-busy` region
    (no layout shift, no masked-ready content); section headers disclose
    truncation "20 of N" via `COUNT(*) OVER()`; range cards link to
    range_start and title the full range ("Ps 148:4–5") — also the accessible
    name; chip wording is **"Curated"** (not "legacy"), real text ≥12px,
    contrast-checked on all four themes; empty states differ (Bible: "No
    cross-references found" / BoM-D&C: "Not yet curated for this volume");
    CC-BY credit sits under the References header with a license link and
    "adapted (ranges expanded)" note; vote counts are sort-only, never
    rendered as bare numbers.
11. **Contract specification (API-1/API-2/API-3):** plan claim corrected —
    `getVerseConnections`'s only caller is the web loader (MCP uses the
    separate `findCrossReferences`), so its result type DROPS
    `cross_references` and the loader updates. Exact shapes:
    `getCrossReferences(db, verseId, { collectionId, limitPerDirection = 20 })`
    → `{ refs: CrossRefRow[], totals: { outgoing: number, incoming: number } }`
    where `CrossRefRow = { verse_id, reference, text, direction:
    'outgoing'|'incoming', votes: number, range_start: string|null,
    range_end: string|null }`; `groupCrossRefs(refs)` → `CrossRefCard[] =
    { verse_id, label, text, direction, votes, range_end: string|null }`.
12. **Source vendoring (SEC-1, high/security carve-out):** the already-
    downloaded TSV is vendored at `data/openbible/cross_references.txt`
    (8.3 MB) with its CC-BY header intact + a README noting source, date,
    license; ingest reads the file, never the network. (Panel-2 tagged the
    pinning-infra version risky; vendoring is the zero-upkeep form.)
13. **scrub() + parameterized inserts (SEC-3/SEC-5):** explicit requirements:
    scrub() on every logged error; `jsonb_to_recordset(${tx.json(batch)})`
    batch inserts only.
14. **Index posture (DATA-7, PERF-4 refuted):** no new indexes planned
    (fan-out ≈ tens/verse); one `EXPLAIN` sanity check post-ingest recorded in
    smoke output. UNION ALL single-round-trip is the implementation choice,
    pinned by the SQL-shape test (PERF-2's mandate rejected as risky —
    redundant with the harness).

## Decisions

| Finding(s) | Resolution |
|---|---|
| DATA-1, DATA-2, DATA-3, DATA-4, DATA-5, DATA-7 | incorporated (amendments 1–4, 14) |
| COR-1, COR-2, COR-4, COR-5, COR-6 | incorporated (amendments 1, 5–8) |
| SEC-2, SEC-3, SEC-5 | incorporated (amendments 1, 13) |
| SEC-1 | incorporated via zero-upkeep vendoring (amendment 12) — panel-2 downgrade to risky logged; high/security carve-out applies |
| OBS-1, OBS-2, OBS-3, OBS-5, OBS-7 | incorporated (amendments 7–10) |
| PERF-1, PERF-3 | incorporated (amendments 8–9) |
| UX-1, UX-2, UX-3, UX-4, UX-5, UX-6 | incorporated (amendment 10; Q6 default becomes "Curated") |
| API-1, API-2 | incorporated (amendment 11) |
| A11Y-1, A11Y-2, A11Y-4, A11Y-5 | incorporated (amendment 10) |
| COR-3 | rejected-with-rationale: panel-2 empirically refuted the canonical-order mechanism (from/to ≈ 53/47 random); direction labels stay, legacy-convention check folded into implementation notes |
| DATA-6 | rejected-with-rationale: typed votes column is schema DDL the contract forbids; strict ingest validation (votes must parse as int) suffices at LIMIT-20 scale |
| API-4 | rejected-with-rationale: the plan deliberately routed the card contract to panel review; amendment 11 now specifies it — no further action |
| PERF-2, PERF-5 | rejected-with-rationale: UNION ALL already the implementation choice pinned by harness; separate KV cache flow costs more than the ~10–50ms PG hit it saves at 0 users |
| A11Y-3 | rejected-with-rationale per tag (risky); substance delivered anyway by amendment 10's range-title spec |
| API-3, API-6, API-7, PERF-4, PERF-6, UX-7, OBS-4, OBS-6, OBS-8, A11Y-6 | dropped-as-noise (aggregated for retro) |
| SEC-4 | deferred-out-of-scope as a security finding; its substance (license link + modification note) ships via amendment 10 |
| API-5 | deferred-out-of-scope: volume→collection pure fn belongs to the future MCP-adoption feature |

Panel-2 dissent: (33 material + 7 risky) / 52 = **0.769**.

## Open questions (for human gate)
- Q1 source: **RESOLVED pre-plan** — OpenBible CC-BY (Abram approved after TSKe license finding).
- Q2 BoM/D&C: **RESOLVED pre-plan** — hybrid; legacy curated refs render only for volumes OpenBible doesn't cover, labeled.
- Q3 range storage: expand to per-verse edges (correct cited-by, ~600k rows) vs store-start-only (~345k rows, cited-by misses mid-range). **Default: expand.**
- Q4 negative-vote refs (1,239): ingest and rank last vs drop at ingest. **Default: ingest, rank last.**
- Q5 per-direction limit in the panel. **Default: 20, with "20 of N" disclosure (UX-2/A11Y-1); "show all" affordance deferred.**
- Q6 chip wording for BoM/D&C fallback refs. **Default: "Curated" (panel consensus: "legacy" reads as broken to lay readers).**
- Q7 vendor the 8.3 MB CC-BY TSV in the repo (`data/openbible/`). **Default: yes (SEC-1; zero-upkeep, reproducible ingest).**
- Q8 versification exceptions map (3John.1.15→3john-1-14, Rev.12.18→rev-13-1; others hit the unmapped cap). **Default: yes.**

## Drift baseline (filled at end of step 6)
- plan-hash: dfeb3216f7309654 (sha256/16 at synthesis)
- harness-hash: 9aca5ea38f5763d1 (osis-map.test.ts + crossref.test.ts + openbible.test.mjs + scripture.loader.test.ts)
