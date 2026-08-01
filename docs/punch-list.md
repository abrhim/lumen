# Punch list

Running list of things to fix/improve, from playing with the deployed app.
Add freely; strike when shipped.

## Abram's list

0. **Reading typography is too small, and the mobile reader's margins are
   too wide.** (2026-07-23) Base reading size goes up; the 56px verse
   gutter + container padding shrink on mobile (the freed gutter hosts the
   mobile depth affordance — see docs/design/navigation.md §6a). A
   type-size setting (Smaller · Standard · Larger) ships with the Desk.
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
- ~~"Chapter N+1 →" dead-links on the last chapter of each book (plumb
  chapter_count).~~ Shipped 5315988 — header + foot nav both gate on
  `maxChapter` (scripture.tsx).
- Chapter nodes in Neo4j use `X-ch-N` ids and stay unstamped by the backfill
  (join miss, cosmetic today).
- CI: needs `gh auth refresh -s workflow` (push blocked) + `CLOUDFLARE_API_TOKEN`
  repo secret; then push-to-main auto-deploys.

## Graph view (untested-by-harness areas to bang on)

- Force-drag feel / simulation tuning on real hubs.
- Mobile sheet ↔ graph overlay handoff choreography.
- VoiceOver pass on the overlay (announcements, list view).

## From Abram's text-message notes (transcribed 2026-07-31)

### Notes editor — the references workspace
4. **References rail on the LEFT of the note editor** — all of a note's
   links live in a left rail; rename the register "References" (or
   similar, not "Linked").
5. **Selected reference → detail pane on the RIGHT** — click a reference
   in the rail, read it in a right-hand detail pane.
6. **The detail pane reads the ref IN ITS ENTIRETY** — full chapter/talk/
   entry, not a snippet.
7. **Notes need tags — with colors.** Design (Abram, 2026-07-31): a new
   table; each tag RLS'd to its creator (FK to the user, visible only to
   them); a set of PLATFORM tags exists globally and users consume those
   too. Colors on the tag row.

### Reader
8. **Scripture stays CENTERED until a verse is clicked**; the verse detail
   pane appears on click — never a standing left-offset layout.
9. **Mobile verse detail pane renders only the verse itself** — and no
   italics anywhere in it (too hard to read).

### Data / graph hygiene
10. **Remove ALL AI-generated cross-references.** (Pairs with item 3's TSK
    ingest — the licensed set replaces the generated one.)
11. **Deep-clean duplicate-named nodes** (the melchisedec-1/melchizedek-1
    class, app-wide).
12. **Priests of Noah is a missing node.**
13. **Ingest the Scripture Citation Index.**
14. **A collection of General Conference links.**
15. **Collection summary pages** — plus principles scoped to a collection,
    and NEW node types unique to a collection.

### Product surfaces
16. **About page.**
17. **Roadmap page.**
18. **Feedback form.**

### Platform
19. **An MCP server for Lumen** — with a skill that builds outlines with
    references and URLs.
20. **Domain: scripture.study?** (Abram's own caveat: "not a normal
    domain" — undecided.)

## Today's picks (2026-07-31) — lowest-hanging, zero external services

In order:
- **Layout consistency sweep** (already queued first) — width canon,
  vertical rhythm, header anatomy; folds in item 8's centered-until-click
  reader layout.
- **Mobile verse detail: verse-only + no italics** (item 9) — small
  conditional render + style fix in the reader rail.
- **About page** (item 16) — static type.
- **Roadmap page** (item 17) — static type; seed it from this punch list.
- **Feedback form** (item 18) — internal sink: a `lumen.feedback` table,
  RLS insert-only (signed-in or anon-with-honeypot), read by admin. No
  external service.
- **Priests of Noah node** (item 12) — author the entity + edges via the
  admin DSN.
- **Duplicate-name audit** (item 11, first half) — the report of duped
  nodes; merges follow review.
- **Stretch: tags v1** (item 7) — table + RLS + platform seed + chips on
  the note page. Internal-only but the largest of the batch; runs as its
  own small feature if the day has room.

Deliberately NOT today: OAuth/Resend (external, queued), SCI + TSK
ingests (datasets to source), GC links collection (content sourcing),
MCP server (own feature), references-workspace redesign (the Panes era,
its own feature-workflow run), domain (a purchase).

21. **Flames on any entity** (Abram, 2026-08-01): the roadmap's press-flame
    generalizes — a `lumen.flames` table keyed by the wikilink-grammar ref
    (verses, entities, episodes, notes, collections) instead of feature_id.
    Decide what a flame MEANS on canon (favorites? most-pressed heat?)
    before building. FlameVote extracts from roadmap.tsx when the second
    surface lands.
