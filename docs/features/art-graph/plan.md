# Plan — art-graph (art as a graph citizen + chapter gallery)

## Tier
**standard** — risk axes: data migration (edge materialization into prod
`lumen.edges`, est. ~12–15k rows), public surface (new route
`/scripture/:book/:chapter/art`, chapter-header UI change), behavior change.
Single-app blast radius (no @lumen/scripture query changes; getChapterArt
already exists).

## Goal
Make artworks first-class graph citizens and give chapters a real art
experience: a compact card stack at the top of the chapter (replacing the
scrolling strip) that opens a full chapter gallery, and DEPICTS/FEATURES
edges materialized from the metadata that already exists — so art joins the
knowledge layer instead of living in a JSON blob only `getChapterArt` reads.

## Prior learnings surfaced (step-2 requirement)
| Source | Learning | Application |
|---|---|---|
| canon-spine retro | Probe live conventions during planning | DONE: character tags are snake_case slugs; person names are ambiguous (6× "Mary", jesus-1 vs jesus-christ) → curated slug map, never name-fuzzing |
| tske retro | Removed-behavior audit at planning | The strip is being REPLACED: audit — strip shows ≤12 fame-ranked works, links out to source; stack+gallery must preserve outbound links + fame ranking (nothing else to lose) |
| tske retro | Never-throw wrappers need happy-path assertions | Gallery loader tests assert non-degraded art data explicitly |
| canon-spine retro | Export script constants/predicates; test like data | Edge-builder is a pure exported fn; slug map is an exported constant with an exhaustive test against live person ids |
| graph-view retro | Verify data-shape claims against the LIVE store | Live probe done (tags/ambiguity above); edge endpoints validated in-tx against chapters/verses/entities |

## Live facts (probed 2026-07-07)
- 4,461 artworks; 4,378 with mapped refs (NT 3,714 / OT 667 works; ~377 chapters covered)
- 766 works carry verse-level refs; 592 carry biblical_character tags
- Top tags: jesus 310, david 42, jacob 30, moses 26, joseph 23, john_baptist 19,
  noah 18, abraham 18, judas 18, mary 16, elijah 15, job 15 (long tail after)
- 3,869 person entities; names ambiguous → explicit ART_PERSON_MAP

## Scope
- **In:**
  1. **Edge materialization** (`scripts/materialize-art-edges.mjs`):
     - `DEPICTS` art→chapter for every ref (endpoint = spine chapter id
       `{book}-{chapter}`), metadata `{is_primary}`.
     - `DEPICTS` art→verse for verse-level refs, one edge per verse in the
       ref's range with `{range_start, range_end}` metadata (openbible
       pattern — cited-by works mid-range).
     - `FEATURES` art→person via exported `ART_PERSON_MAP` (curated slug →
       person entity id, top ~30 slugs); unmatched slugs counted + reported,
       never guessed.
     - collection_id='art', source='learnofchrist'; ONE transaction,
       delete-collection-CROSS-rel-types-then-insert idempotency; in-tx named
       invariants: zero orphan endpoints (chapters/verses/entities), counts
       logged; --dry-run; admin DSN + session probe + scrub; exit 0/1.
  2. **Card stack** (chapter header): compact overlapping stack (top card =
     highest-fame artwork, "+N" count chip), replaces `ChapterArtStrip`;
     absent when the chapter has no art. Click → gallery route.
  3. **Gallery route** `/scripture/:book/:chapter/art`: loader reuses
     `getChapterArt` with raised limit (100); responsive grid of cards
     (image, title, artist · year, outbound source link); breadcrumb back to
     the chapter; 404 on invalid chapter, empty-state if no art.
  4. **Smoke** (`scripts/smoke-art-edges.mjs`): counts by rel_type, zero
     orphans, famous spot check (a Luke 2 nativity work has DEPICTS luke-2;
     jesus-tagged work FEATURES jesus-christ), re-run stability marker,
     smoke-canon-spine re-run stays green (all-edges gate).
- **Out:**
  - Neo4j mirroring (graph view unchanged; chapter-id alignment is prior work)
  - Theme→principle mapping (judgment-heavy vocabulary work; own feature)
  - Artist entities/pages; art detail pages beyond outbound links
  - Word-level anchoring

## Files touched
- `scripts/materialize-art-edges.mjs` (new) + `scripts/__tests__/art-edges.test.mjs` (new: harness)
- `scripts/smoke-art-edges.mjs` (new)
- `apps/web/app/routes/scripture.tsx` (strip → stack)
- `apps/web/app/routes/scripture.art.tsx` (new gallery route) + routes config
- `apps/web/app/routes/__tests__/art.loader.test.ts` (new: harness)

## Public contract
- `lumen.edges` gains DEPICTS/FEATURES rows under collection 'art' (collection
  row exists); existing edges untouched; delete scope = collection_id='art'
  AND rel_type IN ('DEPICTS','FEATURES') (the art collection currently has
  ZERO edges — verified — but scoping by rel_type keeps future art edge types
  safe).
- New route `/scripture/:book/:chapter/art`; chapter page keeps `art` loader
  field (stack consumes the same data as the strip did — no loader change).
- Deployment order: additive both ways (UI works with zero edges — stack
  reads metadata like the strip; edges serve the graph layer), so deploy and
  ingest can land in either order. Edges before deploy preferred for smoke.

## Failure modes (harness assertions)
1. Ref → chapter id wrong (dc? art has no dc refs — Bible only) → unit: ref
   {book_id:'luke', chapter:2} → 'luke-2'; invalid book → skipped+counted.
2. Verse-range expansion off-by-one → unit: verse_start 8, verse_end 14 →
   7 edges, range metadata on each.
3. ART_PERSON_MAP maps to a nonexistent person id → exhaustive test against
   live-probed id list snapshot + in-tx endpoint invariant.
4. Duplicate edges from duplicate refs in metadata → dedupe by (from,to,rel),
   unit-tested.
5. Re-run duplicates edges → delete-then-insert in one tx; smoke count-stable.
6. Gallery loader: invalid chapter 404s; empty art → empty state (not error);
   happy path asserts non-degraded rows (tske B2 lesson).
7. Stack renders only when art exists; top card = max fame; "+N" correct →
   pure helper unit tests.
8. Outbound link regression (strip audit): gallery cards keep
   target=_blank rel=noreferrer source links.

## Harness scope
**behavior** — harness-first required; must fail initially.

## Plan amendments (post-panel synthesis)

1. **Stack semantics (UX-1/2/3):** ONE `<button aria-label="View {N} artworks for {reference}">` ≥44px; overlapping images aria-hidden; static (no fan animation).
2. **Gallery grid (UX-4):** CSS grid, fixed `aspect-ratio` placeholder boxes (no masonry); tab order = DOM order; alias books 301 to canonical like the sibling route (API-4).
3. **Return path (UX-5, code-verified):** gallery links carry `?verse=` through; back preserves chapter scroll/selection.
4. **URL scheme allowlist (SEC-1/2):** shared `safeHttpUrl()` helper gates every `href`/`src` from art metadata (strip + stack + gallery). Live scan: 0/4,461 bad today; zero code defense existed.
5. **Verse/chapter bounds (SEC-3/DATA-1/COR-4; COR-2's drift measured ZERO and merged here):** build-time gating against live chapter/verse counts; skipped refs counted with a 2% abort cap; the 16 apocryphal Daniel 13–14 refs are the documented expected skips.
6. **ART_PERSON_MAP rule (COR-3, escalated):** ambiguity is systemic (joseph 11 candidates, mary 7, judas 5…). Rule: map a slug only when one person entity clearly dominates by existing edge degree (jesus-christ 10,569 vs jesus-1 1); no clear winner → slug stays unmapped and reported. Exhaustive test asserts every map value against the live person-id snapshot (API-2).
7. **Contract fixes (API-1/3/5):** `fame` added to ArtItem/toArtItem (stack ranked on all-nulls otherwise); `DEPICTS` added to RELATIONSHIP_TYPES + exhaustive membership test; `ArtImage` exported and reused by stack + gallery.
8. **Observability (OBS-1..5, DATA-3):** events `art_edges_unmapped_slugs`/`art_edges_skipped_refs` {count, sample:10}; marker key `art-edges-materialize` {at, inserted, deleted, byRelType}; smoke canaries pinned to live-probed artwork ids at implement start, including a verse-RANGE work's per-verse rows; gallery loader logs `art_gallery_degraded` (never-throw + happy-path test — tske B2) and `art_gallery_404` {cause}.
9. **Backfill baseline (DATA-2):** known-missing note (+~4.4k art entities, ~15k art edges) added to backfill-neo4j-collections.mjs header.
10. **Merge policy (COR-1/5):** single-verse cite (verse_end null → start); is_primary true wins regardless of order; overlapping duplicate verse refs union their range metadata; all unit-tested.

## Decisions

| Finding(s) | Resolution |
|---|---|
| UX-1, UX-4, UX-5 · COR-1, COR-3, COR-4, COR-5 · SEC-1..4 · API-1..5 · DATA-1..3 · OBS-1..5 | incorporated (amendments above) |
| UX-2, UX-3 | rejected-with-rationale per tag (risky); substance delivered by amendment 1's single-button + static spec |
| COR-2 | rejected-with-rationale: live-measured zero within-chapter drift; merged into amendment 5 |
| COR-6, UX-6, UX-7, DATA-4, API-6 | dropped-as-noise (route collision affirmatively ruled out; stack-behind-click is the owner's chosen design) |
| OBS-6 | folded into API-5 (right fix, wrong lane) |

Panel-2 dissent: 25/31 = **0.806**.

## Open questions (for human gate)
- Q1 stack size: how many cards visibly stacked. **Default: 3 (+N chip).**
- Q2 gallery limit. **Default: 100, fame-ranked (no pagination v1).**
- Q3 FEATURES map coverage: top slugs only vs exhaustive. **Default: top ~30
  slugs (covers the fat head); remainder reported in ingest output for a
  future pass.**
- Q4 verse-level DEPICTS: include verse edges now (766 works). **Default: yes.**

## Drift baseline (filled at end of step 6)
- plan-hash: 8085483808274b84
- harness-hash: af6d43ca3d60cfd3
