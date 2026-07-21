# FE hand-off prompt — Phase B (unshaken-surfaces)

Hand this to a fresh Fable session. It builds the Unshaken (Jared Halverson) podcast
front-end. Data shapes verified live; prompt self-reviewed + corrected 2026-07-20.

---

```
TASK: Build the Phase B front-end for the lumen scripture-study app — turn the
"Unshaken" podcast collection (Jared Halverson, verse-by-verse LDS scripture study)
from prototype-with-demo-data into a real production surface wired to live prod data.
Product/UI work; run it through the feature-workflow skill (standard tier). The UX is
taste-driven and Abram wants to be IN it — do the UX DISCOVERY phase below WITH him
before you plan or build.

CONTEXT (2 min): lumen is React Router v7 on Cloudflare Workers, PostgreSQL via
Hyperdrive, Neo4j for the scripture graph. The podcast pipeline is DONE: 10 Unshaken
episodes are ingested and AI-enriched in prod — transcripts + a timestamped semantic
graph (which verses/chapters/people/principles Halverson discusses, each anchored to
the second in the episode). It all sits behind collections.public=false (a deliberate
kill switch). A clickable PROTOTYPE UI exists on this branch but serves FAKE "Grove"
demo data. Your job: discover the UX with Abram, wire the real data, do the design
pass, add the admin surfaces, and flip it live — last.

YOU ARE ON branch feature/unshaken-surfaces (prototype + main merged). A dev server is
running (react-router dev, http://localhost:5173). Start with
`node .claude/skills/feature-workflow/tests/validate.mjs --quick`.

ONBOARD — read in this order:
  1. docs/design/media-collections.md — the canonical design. Note: the "collection-
     first display registry" (a map from collection id → layout family; media.kind only
     picks the renderer; fail-closed) is a DESIGN CONCEPT, not built yet — there is no
     collection-display.ts. Creating it is part of THIS work. Also study the LENS
     semantics (§4), the Phase-B scope block, and the enrichment-review-UI + storage
     design.
  2. The prototype you're replacing:
       apps/web/app/routes/media.tsx      (episode detail: facade YouTube player,
         transcript w/ ref auto-linking, "Discussed" row, active-block highlight, ?t=
         seek — THIS transcript treatment is the house reference; keep its soul)
       apps/web/app/routes/collections.tsx (show landing: episodes grouped by book)
       apps/web/app/lib/podcast-demo.ts    (the demo data source you'll delete)
  3. The house aesthetic to match — real shipped routes, typography-first:
       apps/web/app/routes/scripture.tsx, word.tsx, book.tsx, scripture.art.tsx
  4. Existing primitives you MUST reuse (don't reinvent):
       packages/scripture/src/queries.ts — the raw-SQL query layer. Already has
         getPublicCollectionIds(db) → string[] of public collection ids (THE public
         gate), getEntity, getChapterArt. Add podcast loaders here in the same pattern.
       apps/web/app/lib/entitlements.server.ts — requireEntitlement(db, userId, KEY);
         the A2 work added an ADMIN_COLLECTIONS key. admin.users.tsx is the reference
         for an entitlement-gated route.
       apps/web/app/lib/db.server.ts — the per-request Hyperdrive PG client.
       components/AppMenu.tsx (universal nav), components/graph/* (force/radial graph —
         AVAILABLE but see the lens note; the lens is a filter, not necessarily a viz).

UX DISCOVERY — do this FIRST, interactively with Abram, BEFORE you plan or build:
  This is the taste-driven half of the feature and Abram wants to be in it. Do NOT jump
  to the scoped build. Interview him AND prototype directions with him, as a design lead
  would — propose, don't interrogate:
  • Lead with concrete options he can REACT to, not a requirements questionnaire. One
    focused question at a time, each attached to something tangible. He has strong
    opinions and reacts well to pixels, poorly to abstract specs.
  • USE THE LIVE DEV SERVER. Build small, DISPOSABLE spikes of the reader/lens against
    one real episode (4pSrikfJ5Yw is loaded) and show him the actual thing at
    localhost:5173 — 2–3 DISTINCT directions to compare, not one. Throwaway code is
    fine and expected here; you're finding the feel, not shipping yet. (For pure-visual
    exploration an artifact mockup is also fine.)
  • Explore these experiential questions TOGETHER — do not assume the answers:
      - What should "watching an episode with the transcript" FEEL like — lean-back
        watch with the transcript as a companion, or lean-in study where the transcript
        is the main text and the video secondary? This choice drives the whole layout.
      - How do the "Discussed" moments (verses/people/principles) surface WITHOUT
        becoming AI-slop cards/pills — the exact pattern Abram keeps rejecting. The
        prototype's transcript treatment is his touchstone; word.tsx is the reference.
      - How should the LENS feel to ENTER (arriving through a node) and LEAVE (one-tap
        un-lens) — a filter settling over the page, a distinct view, a highlight? Show
        options.
      - Reading posture, density, motion — how much, where, and does any of it earn its
        place or read as decoration.
  • ITERATE. Several short rounds: spike → he reacts → refine → he reacts. Converge only
    when he says a direction feels right. His reactions are the arbiter of the aesthetic
    (this is the de-AI-UX bar — his stated hard preference; see memory
    avoid-ai-ux-patterns).
  • OUTPUT: the agreed UX direction becomes the design section of your feature-workflow
    plan; the spikes INFORM (do not become) the real implementation. Carry the agreed
    direction through the human gate together with the technical plan.

SCOPE — after discovery, build in this order; the public flip is the LAST act. Steps 2
and 3 execute the direction agreed in UX DISCOVERY:
  1. Real loaders + the display registry. Replace podcast-demo.ts wiring in media.tsx +
     collections.tsx with prod queries (added to queries.ts). CREATE the collection-
     display registry (collection-display.ts) keyed by collection id → layout family,
     fail-closed. Gate visibility with getPublicCollectionIds: anonymous users must NOT
     see unshaken until the flip. For YOUR dev preview, allow non-public collections
     when the viewer holds ADMIN_COLLECTIONS (via requireEntitlement) — and grant your
     own local session that role with `node --import tsx scripts/grant-role.mjs
     <your-login-email> admin`. Never flip public early to preview.
     • PLACEMENT NOTE: queries.ts lives in @lumen/scripture, ALSO consumed by an external
       MCP server under Ring-2 redeploy discipline. Decide consciously whether podcast
       queries belong in the shared package (consistent with getChapterArt) or web-local
       (apps/web/app/lib) — and say why in the plan.
  2. Reader panel + LENS (the discovered direction). The LENS is a FILTER first:
     ?lens=<entity-id> shows only the transcript moments connected to that origin node
     (arrival-via-a-node applies it); direct navigation = unfiltered; URL-owned/
     shareable. A rich graph viz is OPTIONAL polish, not the deliverable. GUARDRAIL: a
     lensed view MUST announce itself and un-lens in one tap ("Through: Faith · ✕").
     DECISION to surface in the plan: the confidence floor for showing a mention (ties to
     enrichment-review status — rejected hidden, accepted always shown, pending shown
     above a threshold you propose).
  3. De-AI-UX pass — this is the discovered aesthetic made real, applied throughout.
     Typography-first, no pill/card/kicker "AI dialect." His reactions in discovery are
     the bar.
  4. Admin: an /admin/collections page and the /admin/enrichment review UI, both gated
     via requireEntitlement(db, userId, ADMIN_COLLECTIONS) (mirror admin.users.tsx). The
     review UI = a confidence-sortable (asc = worst-first) queue of enrichment mentions,
     filter by kind/episode/status, accept/reject each with quote + transcript context
     inline. STORAGE (designed in the design doc): an OVERLAY table lumen.enrichment_
     reviews (edge triple + mention seq → status, reviewer, reviewed_at) is the source
     of truth (survives re-extraction); load materializes status into edge jsonb so read
     paths see a plain field. Seed the first 'rejected' rows from
     docs/features/unshaken-extraction/prune-round4.json. Needs an ADDITIVE migration
     (house pattern: scripts/migrate-*.mjs, DRY_RUN default, invariant checks).
  5. Small riders: getChapterArt (queries.ts:151) filters entity_type='artwork' but NOT
     collection_id — first verify whether any artwork entities live outside the 'art'
     collection, then add `AND collection_id='art'` (design-doc fix). Backfill episode
     upload dates (episodes.json has uploadDate:"NA").
  6. LAST — the deliberate collections.public=true flip for unshaken, as its own explicit
     step. Do NOT flip it as a side effect of anything earlier.

REAL DATA (verified live; collection id 'unshaken'):
  • Episodes: lumen.entities WHERE collection_id='unshaken' AND entity_type=
    'content_item', id='unshaken-<videoId>', metadata.media={kind:'youtube',video_id,
    duration_s}.
  • Transcript: lumen.transcripts (episode_id, seq, t_start_s, t_end_s, text), ~39.5k
    rows, ordered by seq.
  • Extraction "moments": lumen.edges WHERE from_id=<episode> AND
    source='unshaken-extraction':
      DISCUSSES → verses/chapters (to_id like '2-kgs-16' or '2-kgs-16-9')
      MENTIONS  → persons/places/events (to_id = entity id)
      TEACHES   → principles
    Each edge's metadata.mentions=[{t,seq,confidence}] sorted by t. Resolve targets via
    lumen.verses/chapters (text) and lumen.entities (name/description). Title-anchored
    chapters are source='unshaken-youtube', confidence 1.
  • ⚠️ postgres.js trap (bit the pipeline repeatedly — do NOT reintroduce): numeric
    columns (t_start_s) AND jsonb (metadata) can return as STRINGS. Coerce every
    timestamp with Number(); parse-if-string every jsonb before use. Verified live: a
    transcript row returned t_start_s:"1453.215" (a string).

CONSTRAINTS:
  • Cloudflare Workers runtime: per-request PG client via Hyperdrive, prepare:false,
    ctx.waitUntil(end()); deferred promises must never touch PG. Follow db.server.ts +
    the @lumen/scripture query pattern.
  • Do NOT touch the ingest/extraction pipeline (scripts/ingest-podcast/*, the extract
    stages) — the data is done and eval-gated; you consume it, you don't regenerate it.
  • Feature-workflow discipline: UX discovery feeds the plan; harness the loaders + the
    lens filter + the review-overlay logic (behavior pins, not string asserts); panels
    for the review-UI data path; Abram's human gate before implement; retro +
    validate --done at the end.
  • Mobile: verify via Chrome CDP device emulation, NOT --window-size (a 500px clamp
    turns window-size shots into crops — see the headless-chrome memory).
  • public=false stays until step 6; preview via the admin-entitlement path.

Nothing here touches security/exploit content — work end-to-end without concern for
model-safety refusals.
```
