# Code Panel — Data Integrity Review — tske-cross-references

Reviewed `tske-impl.diff`, `scripts/ingest-openbible-refs.mjs`, `scripts/smoke-openbible.mjs`,
`packages/scripture/src/crossrefs.ts`, and `packages/scripture/src/schema.ts` against plan
amendments 1–14. Prod ingest has **not** run live (dry-run clean). Cross-checked the dedup-collision
hypothesis against the real vendored dataset (`data/openbible/cross_references.txt`, 344,799 rows):
scanned every `from` verse for (a) a range `to` overlapping a standalone single-verse `to`, (b) two
overlapping ranges, and (c) exact duplicate raw `(from,to)` pairs — all three counts are **0** in the
current file, so CDATA-1 below does not fire on this specific dataset, but the code has no defense
if a future OpenBible update introduces one.

Traced and confirmed *not* bugs, for the record: the entire write set (collection upsert, delete,
batched inserts, `migration_state` marker) runs through `tx` inside one `sql.begin(...)`
(`scripts/ingest-openbible-refs.mjs:187-227`) — no stray `sql.\`...\`` write executes outside it, so
the one-transaction guarantee holds; the `DELETE` is scoped by an exact `collection_id = 'openbible'`
equality (`:196`), never touching the legacy `phase-b` collection; the `DRY_RUN_ROLLBACK` string
sentinel (`:222,225`) is an established house pattern (identical in `align-edge-chapter-ids.mjs` and
`migrate-canon-spine.mjs`), and since the marker insert (`:217-220`) happens *inside* the same
transaction, a dry run rolls it back along with everything else — so `smoke-openbible.mjs`'s marker
comparison (`:15-17`) never sees a stale/inconsistent marker, it just correctly reports "missing"
until the first real ingest runs; `lumen.collections.tier`/`.category` are real `NOT NULL` columns in
`packages/scripture/src/schema.ts:67-81` (confirmed against `scripts/ingest-phase-a.ts`'s live DDL,
no drift), so the collection-row `INSERT` at `:189` will not fail.

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| CDATA-1 | Medium | `scripts/ingest-openbible-refs.mjs:99-112` (`dedupeEdgeRows`), consumed by `packages/scripture/src/crossrefs.ts:50` representative filter | When a from-verse cites both a range and an overlapping single verse, dedup's max-votes winner can discard the range's metadata, dropping or duplicating that card. | Merge metadata across colliding pairs instead of picking a winner: preserve range_start/range_end from any colliding row and keep the highest vote; add a unit test for this overlap. |
| CDATA-2 | High | `scripts/smoke-openbible.mjs:93` (`legacy curated refs intact for 1 Nephi 3:7`) | `legacy.n >= 0` is a tautology — `count(*)` is never negative, so the legacy-path-untouched check can never fail, even if those edges were wiped. | Assert `legacy.n > 0` or compare against a recorded pre-ingest baseline count so a regression in the untouched legacy path is actually detectable. |
| CDATA-3 | Low | `scripts/ingest-openbible-refs.mjs:189-194` (collection upsert `ON CONFLICT`) | `ON CONFLICT (id) DO UPDATE` refreshes name/description/provenance/license/storage but omits `tier`/`category`, so those two columns never self-correct on re-run. | Add `tier = EXCLUDED.tier, category = EXCLUDED.category` to the `ON CONFLICT` `SET` clause for full upsert parity. |

## Notes on severity and scope

**CDATA-1** is a distinct failure mode from `code-panel/correctness.md`'s CCOR-1/CCOR-2 (both
scoped to a *self*-referencing range-start row, or to incoming-card keying) — this one requires two
genuinely *different* source citations (a range and an independent single-verse row, or two
overlapping ranges) landing on the same `(from_id, to_id)` pair. Traced through concretely: if
`X` cites `Ps.148.4-Ps.148.5` (votes 10) and separately cites `Ps.148.5` alone (votes 20), dedup
keeps the higher-voted single-verse row at `to_id=ps-148-5` and discards its sibling range row's
`range_start`/`range_end`. Two outcomes depending on *which* member collides: if the collision lands
on a non-start member, the panel shows a duplicate — `Ps 148:5` appears both standalone and inside
the `Ps 148:4–5` range card; if it lands on the range's *start* verse, the range's representative row
loses `range_start`, so the SQL filter (`e.to_id = e.metadata->>'range_start'`) never matches any
surviving row for that range and the non-start members (e.g. `Ps 148:5`) silently disappear from the
outgoing panel entirely — a true lost card, with no invariant catching it (the in-tx check only
verifies referential integrity of endpoints, not range-group consistency). Rated Medium rather than
High because the exhaustive real-data scan above found zero occurrences in the current 344,799-row
file, so there's no evidence this manifests in the impending live ingest — but there's also zero test
coverage or in-tx invariant guarding it, so a future OpenBible data refresh could reintroduce it
silently.

**CDATA-2** converges with `code-panel/observability.md`'s COBS-1 (same line, same finding) — noted
here too since it's squarely a data-integrity gap: it's the *only* smoke check meant to confirm the
hybrid BoM/D&C legacy path (FM-7) survived the swap untouched, and it currently provides zero signal.

**CDATA-3** is cosmetic at current scale (tier/category are static constants in this script, so they
won't actually drift across re-runs unless someone edits the literal values) but breaks the "full
idempotent upsert" pattern DATA-5 established for the rest of the row.
