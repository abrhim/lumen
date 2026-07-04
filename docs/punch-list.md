# Punch list

Running list of things to fix/improve, from playing with the deployed app.
Add freely; strike when shipped.

## Abram's list

1. **Theme is too parchmenty.** Rework the palette — keep the reading-first
   feel, lose the sepia-everywhere. Candidate: neutral paper + one warm accent,
   or a proper light/dark pair (tokens all live in `apps/web/app/app.css`).
2. **Add art.** Chapter/book art, empty states, maybe volume identity marks.
   Decide: commissioned/static assets vs. generated, and where art lives
   (R2 bucket?).
3. **Expose more of the graph's data.**
   - **Strong's word study** — 14,197 `strongs_word` entities + `lumen.words`
     table + `USES_WORD` edges already exist in Postgres; not yet in Neo4j or
     any UI. The v11 mock has the word-study layer designed (hover lemma
     tooltips).
   - **The cross-reference project** — likely the *Treasury of Scripture
     Knowledge* (TSK / OpenBible.info dataset; phase-b notes already mention
     TSK rows). Confirm which project, ingest it as its own collection so it's
     filterable/attributable separately from the AI-generated refs.
   - Naves topics (5,319 entities), JST readings (31k) — same story: in
     Postgres, invisible in the product.

## Known follow-ups (from the feature retros)

- Component-test infra for apps/web (6 graph-view bugs shipped repro-deferred).
- Nested route split so verse clicks / graph recenters stop re-querying chapter
  data (PERF-4, twice-deferred).
- Principle/person pages — chips currently open the graph; the mock's
  PrinciplePage is the spec.
- Collections feature: toggle UI, user-owned collections (`owner_id` ready in
  Postgres), dual-write reconciliation story (backfill re-run is the stopgap).
- `getBooksByVolume` has the latent `od` (Official Declarations) trap — apply
  the getAllBooks UNION treatment when OD content ingests.
- "Chapter N+1 →" dead-links on the last chapter of each book (plumb
  chapter_count).
- Chapter nodes in Neo4j use `X-ch-N` ids and stay unstamped by the backfill
  (join miss, cosmetic today).
- CI: needs `gh auth refresh -s workflow` (push blocked) + `CLOUDFLARE_API_TOKEN`
  repo secret; then push-to-main auto-deploys.

## Graph view (untested-by-harness areas to bang on)

- Force-drag feel / simulation tuning on real hubs.
- Mobile sheet ↔ graph overlay handoff choreography.
- VoiceOver pass on the overlay (announcements, list view).
