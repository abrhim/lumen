# Code-panel review — correctness + data-integrity (combined) — art-graph

Reviewed: `scripts/materialize-art-edges.mjs`, `scripts/smoke-art-edges.mjs`,
`apps/web/app/lib/art.ts`, plus the full diff, against
`docs/features/art-graph/plan.md` amendments. Dry-run baseline: 11,388 edges,
16 expected skips, 0 orphans. All findings below were reproduced either by
running `buildArtEdges` directly or by querying prod (read-only `lumen_read`
credential) — not inferred from reading code alone.

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| CCD-1 | High | `materialize-art-edges.mjs:30-52` `ART_PERSON_MAP` | Character-tag slugs are polysemous per-artwork, not per-slug: "judas" (Judas Iscariot vs Maccabeus, 3/18 live works) and "jacob" (patriarch vs poetic "Israel", ~13/30 live works) get one map target each — live wrong FEATURES edges. | Disambiguate per-artwork using ref book/chapter (Maccabees vs Torah/Gospels) or drop "judas"/"jacob" to unmapped like joseph/noah/daniel until split upstream. |
| CCD-2 | Medium | `materialize-art-edges.mjs:74-79` `put()` range union | Range union merges per edge (keyed by `to_id`), not per overlap-group: reproduced luke-2 case where verse 8's edge shows `range_end=luke-2-10` while verses 9-10 show `range_end=luke-2-12` for the *same* two overlapping refs — inconsistent metadata across one range group. | Two-pass: union overlapping ranges per (artwork, chapter) first, then stamp the same `range_start`/`range_end` on every verse edge in the group. |
| CCD-3 | Low | `materialize-art-edges.mjs:89-108` skip vs `put` ordering | The chapter DEPICTS edge is `put` before verse bounds are checked; a ref whose verses fail bounds/inversion still gets `skipped.push(...)` even though its chapter edge exists — `art_edges_skipped_refs.count`/ratio conflates full misses with partial (chapter-ok) ones. | Log a distinct `partial` skip reason/counter separate from full ref misses; keep chapter-edge behavior (matches plan's "chapter edge for every ref"). |
| CCD-4 | Low | `materialize-art-edges.mjs:120-128` FEATURES loop | 6 live artworks (e.g. `art:dore-judas-before-nicanor`) have `biblical_character` tags but zero `refs` — they get FEATURES-only edges and are unreachable via `getChapterArt` (chapter stack/gallery), existing only as graph-only nodes. Plan is silent on this path. | If intentional, add a one-line plan note + regression test asserting FEATURES-without-DEPICTS is expected; otherwise gate FEATURES on `refs.length > 0`. |
| CCD-5 | Low | `smoke-art-edges.mjs:64-71` Dürer canary | `to_id LIKE 'rev-1-%'` isn't scoped to the 3 expected verses; currently safe only because `art:durer-title-page` has exactly one live ref (rev 1:1-3) — a future second rev-1 ref on that work would silently break the `length === 3` assertion. | Assert `to_id IN ('rev-1-1','rev-1-2','rev-1-3')` explicitly instead of a prefix `LIKE`. |

## Traps verified with no bug found

- **Cross-key aliasing (trap 3):** each `put()` call constructs a fresh
  `metadata` object literal; `rangeStart`/`rangeEnd` are shared *string*
  references across sibling verse edges but strings are immutable, so
  `prev.metadata` mutation never leaks across unrelated edges. No bug.
- **Writes outside tx (trap 6):** all four writes (`UPDATE collections`,
  `DELETE`, batched `INSERT`, `migration_state` upsert) run inside
  `sql.begin(tx => ...)`; the `DRY_RUN_ROLLBACK` throw correctly unwinds the
  whole transaction. No bug.
- **Gallery loader limit arg (trap 7):** `getChapterArt(db, bookId, chapter,
  limit = 24)` in `packages/scripture/src/queries.ts:151` — the gallery's
  `getChapterArt(context.db, bookId, chapter, 100)` call matches positionally
  and correctly overrides the 24 default used by the chapter-page call
  (`scripture.tsx:345`, 3 args). No bug (the two call sites intentionally
  differ: 24 for the inline stack's source, 100 for the dedicated gallery).
- **`pickArtStack` sort stability (trap 8):** `Array.prototype.sort` is
  spec-stable since ES2019 (V8/Node); equal-fame ties preserve insertion
  order deterministically. Cosmetic only, no bug.

## Live-data verification notes

- Trap 1 (cross-chapter range collision): confirmed impossible — `to_id`
  includes the chapter, so overlapping refs across different chapters never
  share a dedupe key. The *real* bug is the within-chapter inconsistency
  (CCD-2), not a cross-chapter one.
- Trap 2 scenario (valid chapter, invalid verse bounds) currently has **zero**
  live occurrences (queried all artwork refs against live chapter/verse
  counts: 16 refs fail at chapter level — matches the documented Daniel
  13-14 skips — 0 fail at verse-bounds-only). CCD-3 is latent, not active in
  this dry-run's 11,388 edges.
- CCD-2's exact overlap scenario also currently has zero live occurrences
  (scanned all 63 multi-ref artworks; no pair of refs in the same chapter is
  overlapping-but-not-identical today), so the current dry-run's 11,388 edges
  are not corrupted by it — but the bug will fire on the next catalog update
  that adds such a pair, and the new COR-5 test in
  `scripts/__tests__/art-edges.test.mjs` only checks one edge (`luke-2-9`)
  in the group, so it won't catch a regression.
- CCD-1 is **not** latent — it's live today: 3 of 18 "judas"-tagged
  artworks (`art:dore-judas-before-nicanor`, `art:dore-judas-pursues-timotheus`,
  `art:schnorr-157-judas-maccabeus-s-vision`) are Judas Maccabeus, not Judas
  Iscariot; roughly 13 of 30 "jacob"-tagged artworks are Israel/Israelites
  scenes (e.g. `schnorr-047-moses-called-to-lead-israel`,
  `schnorr-051-israel-s-deliverance-and-egypt-s-destruction-at-the-red-sea`,
  `dore-slaughter-syrians`), not the patriarch Jacob — both slugs get
  force-mapped to a single wrong-in-context person id by the current map.
