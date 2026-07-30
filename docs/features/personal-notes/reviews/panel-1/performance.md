# Performance review — personal-notes (panel-1, plan stage)

Reviewer lens: performance. Scale frame: single-digit DAU, Cloudflare Workers
(CPU-time billed, cold starts), Supabase session pool cap 15 (documented
exhaustion incidents), KV 1,000/day budget and never used for user state
(navigation.md §3a). Findings ranked.

One load-bearing structural fact used throughout: the D1/D3/D5 write and read
paths go through **PostgREST (HTTPS fetch to Supabase)**, not `context.db`.
They therefore do NOT consume the PG session pool (cap 15) and do NOT count
against the CPERF-6 `db.execute` pin — but each one is a full cross-provider
HTTP round trip from the Worker, which is the latency unit to budget.

---

### PERF-1: D5 anchors fetch must join the loader's existing parallel window as a self-contained session→PostgREST chain; never streamed, never serialized after the Promise.all
- Severity: high
- Claim: The plan says "one call, signed-in only" but does not say *where* in
  the loader it runs. The scripture loader currently has a deliberately
  session-free hot path (scripture.tsx:598-600: "The reader stays session-free
  on its hot path") and one big `Promise.all` window at :539-582. The anchors
  fetch is data-dependent on `getSessionUser` (needs the user JWT to build the
  PostgREST client), so a naive implementation serializes
  `await getSessionUser(...)` → `await fetchAnchors(...)` after (or before)
  the parallel window and adds a full sequential HTTP RT (~30–100ms
  Worker→Supabase) to every signed-in chapter TTFB.
- Evidence: apps/web/app/routes/scripture.tsx:539-582 (the single
  `Promise.all`), :598-600 (session-free hot-path comment D5 will retire);
  apps/web/app/lib/auth.server.ts:100-121 (`sessionMemo` WeakMap keyed on
  Request — the root loader already reads the session on every document
  request, so the chapter loader's `getSessionUser` is memo-shared on
  document loads and a local ES256/JWKS verify on client navigations — sub-ms
  happy path, no gotrue RT).
- Proposed fix (pin these in the plan, not just "one call"):
  1. The anchors leg is one more element of the existing `Promise.all`:
     `(async () => { const { user } = await getSessionUser(request, env); if (!user) return null; return fetchChapterAnchors(user, bookId, chapter); })()`.
     `getSessionUser` is local-verify/memoized, so the PostgREST RT overlaps
     the PG queries and added wall-clock ≈ 0 (same PERF-1/PERF-2 doctrine the
     loader already documents for cross-refs and chapter numbers).
  2. Degraded-as-value with a hard abort budget (supabase-js `abortSignal`,
     ~750ms): timeout → `null` anchors, chapter renders without personal dots,
     one structured log line (`notes_anchors_degraded`). Never throws.
  3. Critical path, NOT streamed/deferred: the dot merges into `verseSignals`
     which SSRs with the chapter; a streamed per-user promise re-enters the
     RR turbo-stream 4950ms-abort class (web-app-wiring bug 4) for a query
     that is a single-user indexed lookup. Streaming buys nothing here.
  4. Signed-out cost stays zero via the existing `hasAuthCookie` short-circuit
     (auth.server.ts:87-89,138) — F2 already pins "zero notes calls"; state in
     the plan that the mechanism is the cookie check, not an RLS empty result.
  5. Accept and document one real regression: a signed-in user with an
     *expired* access token now pays the inline gotrue refresh RT on a chapter
     view where the loader previously did no session work (root-loader memo
     covers document loads; client navigations of only the scripture segment
     pay it). Once per ~expiry-interval per user — fine at this scale, but it
     retires the :598-600 invariant and the comment must be rewritten, not
     deleted.

### PERF-2: CPERF-6 pin — `db.execute` count stays 3; the pin must EXTEND to the PostgREST boundary, and the PERF-4 verse-click re-run multiplies the new call
- Severity: high
- Claim: The plan's D5 doesn't say how the query-count guard changes. Because
  anchors ride PostgREST, the existing pins
  (scripture.loader.test.ts:198-209: `getVersesByChapter`×1,
  `getChapterSummary`×1, `getChapterNumbers`×1, `db.execute`×3) are all
  *unchanged* — which means the guard as written would silently pass even if
  the implementation accidentally fired the anchors fetch N times. The new
  call needs its own pin at the `notes.server` module boundary.
- Evidence: apps/web/app/routes/__tests__/scripture.loader.test.ts:198-222
  (CPERF-6 + CS-6 pattern: named-function call counts, not just db.execute);
  docs/punch-list.md:34-35 (PERF-4: verse clicks re-run the whole chapter
  loader — twice-deferred). Every `?verse` navigation will re-fire the anchors
  PostgREST call along with everything else: a 15-verse reading session = 15
  anchor fetches for one chapter of anchors.
- Proposed fix:
  1. Amend the CPERF-6 test: mock `~/lib/notes.server`; signed-in chapter view
     → `fetchChapterAnchors`×1 exactly; signed-out → ×0 (this is also the F2
     perf assertion); `db.execute` stays pinned at 3 (comment updated to say
     the anchors call is PostgREST-side and deliberately absent from the pg
     count).
  2. Accept the per-verse-click re-fetch at this scale (it's inside the
     parallel window, adds no serial latency), but record in the plan that the
     anchors leg belongs to the *chapter-level* segment when the PERF-4
     nested-route split lands — otherwise that refactor will strand it on the
     verse segment and the debt compounds.

### PERF-3: D3 notes leg — parallel with `searchAll`, hard 400ms budget, degrade to empty group with canon intact; no keyset cursor for notes in v1
- Severity: high
- Claim: D3 correctly makes the notes leg a second round trip (the `lumen_read`
  no-grant makes joining the combined UNION statement structurally impossible
  — that's the point). But the plan doesn't say whether it's serialized or
  parallel, has no latency budget, and F9 doesn't say what happens to the
  notes group under the cursor contract. Serialized, it adds a full PostgREST
  RT on top of the shipped path whose p95 budget is 500ms
  (search.ts:310-314, TSQ_MAX_TOKENS comment). It also cannot reuse the
  cursor machinery: cursors are keyset over `(tier, sub, score_bits, id)`
  minted from `float8send` bits inside the leg SQL (search.ts:296-304,
  :597-604, :660-671), and PostgREST `textSearch` exposes no `ts_rank`, no
  `score_bits`, and no way to express that ORDER BY without an RPC.
- Evidence: packages/scripture/src/search.ts:675-780 (`searchAll`: one
  combined statement, per-leg fallback with `LegFailure` elapsed-ms, decision-7
  group-isolated degradation — the exact degradation grammar the notes leg
  should copy); apps/web/app/routes/api.search.tsx:105-136 (session +
  visibility already resolved before `searchAll`, so the user JWT is in hand —
  the two legs have no data dependency on each other).
- Proposed fix (pin in plan):
  1. `const [canon, notes] = await Promise.all([searchAll(...), user ? notesLeg(...) : NONE])`
     in api.search.tsx (and the /search page loader). Added signed-in p50 =
     max(legs) − searchAll ≈ 0 when the notes leg (single-user tsvector match,
     tiny table) comes back under the canon federated statement. Signed-out:
     the notes leg is never constructed — byte-compat (F2/F9) *and* zero added
     work.
  2. Budget: `abortSignal(400)` on the PostgREST call. Timeout/error → notes
     group present-but-empty with `meta.perGroup.notes = { ms, hits: 0, error }`
     (reuse the OBS-5/decision-7 shape); canon groups untouched. Add this as an
     explicit failure-mode row (it's a gap in F1–F12: no "notes leg degraded"
     mode exists).
  3. Cursor: notes group mints **no** `nextCursor` in v1 — `limit` +
     "see all in /notes?q=" affordance. `after` + `scope=["notes"]` returns
     `cursor_scope`-style 400 or simply never composes (decide one, pin it in
     F9). Do NOT try to thread notes through `encodeSearchCursor` — the
     score-bits invariant can't be honored from PostgREST without an RPC.
  4. Ordering inside the group: `updated_at desc` (recency), not rank —
     PostgREST can't ORDER BY ts_rank without an RPC function, and for
     personal notes recency is arguably the better product order anyway.
     Synthesize `tier`/`score` for the merged SearchResult shape at the route
     layer. If rank ordering is ever wanted, it's a `notes_search(q)` RPC
     (SECURITY INVOKER, RLS applies) — defer.
  5. `logSearchExecuted` gains the notes leg ms/hits so the 500ms p95 budget
     stays observable with the second RT in the picture.

### PERF-4: D7 editor chunk is ~90–105 kB gz with markdown-it in it (~55–65 without); F10 needs a real chunk-graph assertion — propose the Vite manifest closure test
- Severity: high (the F10 mechanism half); med (the size half — it's lazy)
- Claim: Honest size estimate for the pinned module set (min+gz, from package
  dist sizes; prosemirror-transform and orderedmap/w3c-keyname ride along as
  hard deps):
  prosemirror-view ~40 kB, prosemirror-model ~15 kB, prosemirror-transform
  ~13 kB, prosemirror-state ~8 kB, keymap+history+inputrules+commands ~8 kB,
  prosemirror-markdown ~5 kB, markdown-it + entities/linkify-it/mdurl/uc.micro
  ~35 kB → **~90–105 kB gz total**, ~55–65 kB gz if markdown-it stays off the
  client. markdown-it IS needed client-side *if* the client parses md→doc:
  `prosemirror-markdown`'s `MarkdownParser` wraps a markdown-it instance; only
  the `MarkdownSerializer` (doc→md) is dependency-free. There is no "preview
  parse" need beyond that (WYSIWYG means no separate preview pane). And F10 as
  written ("asserted") names no mechanism — the current build emits **no**
  `.vite/manifest.json` (verified: `apps/web/build/client/` contains only RR's
  hashed `assets/manifest-22502ed0.js`), so today there is nothing to assert
  against.
- Evidence: apps/web/vite.config.ts (no `build.manifest`);
  apps/web/build/client/assets/ listing (RR browser manifest only, hashed
  chunk names — unmatchable by name); docs/features/search-ui/bugs.md B18
  (the precedent: an 18.5 kB gz dead chunk rode a barrel import onto /search
  and was only *found* by a human bundle inspection, then DEFERRED — exactly
  the failure class F10 exists to prevent, at 5x the size).
- Proposed fix:
  1. Size posture: accept markdown-it inside the lazy editor chunk for v1
     (simplest; it loads only on edit intent). Record the alternative as a
     known cut: loader parses md→PM-doc JSON server-side, client keeps only
     the serializer — saves ~35 kB gz but moves the F3 round-trip boundary
     server-side; not worth the coupling at this scale.
  2. F10 mechanism, concretely: (a) set `build: { manifest: true }` in
     apps/web/vite.config.ts (client env) so `build/client/.vite/manifest.json`
     exists — keys are SOURCE module ids, values carry `file`, `imports`
     (static), `dynamicImports`. (b) New test (vitest suite or node script,
     wired into the feature's verification pipeline AFTER `react-router
     build`; it must skip-with-failure-message, not pass, when the manifest is
     absent): compute the static-`imports` transitive closure from each of
     `app/root.tsx`, `app/routes/scripture.tsx`, `app/routes/search.tsx`,
     `app/routes/notes.tsx`, `app/routes/notes.$id.tsx` and assert no reached
     manifest key matches `/prosemirror|markdown-it|components\/editor/`.
     (c) Positive control in the same test: assert the editor chunk DOES exist
     somewhere in the manifest (under `dynamicImports` of the notes route or
     as its own entry) — otherwise a renamed directory makes the assertion
     vacuously green forever. (d) e2e reinforcement (Playwright is in scope):
     open /notes/:id in read mode, assert zero network requests to the editor
     chunk's `file` (resolved from the manifest, not by name-guessing); enter
     edit mode, assert it loads. This is a test, not `vite-bundle-visualizer`
     in CI.

### PERF-5: the lazy boundary is NOT route-level — /notes/:id is read+edit in one route, so RR7's per-route splitting alone puts PM on the note READING path
- Severity: high
- Claim: D7 says "route-level lazy chunk", but RR7 code-splits per route
  module: anything `notes.$id.tsx` imports statically lands in the /notes/:id
  chunk and loads to *read* a note, violating the plan's own goal. The correct
  boundary is intra-route.
- Evidence: plan.md D7 + Routes (`/notes/:id` = "read + edit");
  apps/web/react-router.config.ts (plain RR7 SSR config — no route-module
  lazy tricks in play); B18 precedent that static import edges are exactly how
  dead weight rides a route.
- Proposed fix (name the mechanism in the plan):
  1. `notes.$id.tsx` (and `notes.tsx`, `scripture.tsx`, `media.tsx`,
     SearchModal) have **zero static imports** from `app/components/editor/*`.
  2. Edit mode mounts `const Editor = React.lazy(() => import("~/components/editor"))`
     behind explicit edit intent (button / `?edit`), client-only after
     hydration (PM view needs the DOM anyway; also dodges the B19 SSR-throw
     class).
  3. Dependency direction for Cmd+J: the insert-posture glue lives INSIDE the
     editor chunk and imports SearchModal (already in the root graph), never
     the reverse — a `SearchModal` prop/import for insert mode that touches
     editor code would pull PM into every route's hydration graph, the exact
     B18 shape at ~5x the size.
  4. Reader capture ("Add to note") in scripture.tsx is a link/fetcher action
     only — creating a note anchored to a verse must not require the editor
     chunk on the chapter route (the redirect to /notes/:id?edit loads it).
  5. These four edges are what the PERF-4 manifest test pins — the finding and
     the harness close together.

### PERF-6: autosave × tsvector generated column — the plan pins LWW but no autosave/debounce contract; anchors must not churn per save
- Severity: med
- Claim: D6 (LWW, fresh `updated_at`) implies a save action but the plan never
  says whether saves are explicit, on-blur, or debounced-keystroke. Every
  UPDATE rewrites the row, recomputes the generated tsvector over the full
  body, and fires the updated_at trigger. At note sizes (KBs) and this DAU
  that is genuinely fine — the risk is not Postgres load, it's an unpinned
  contract drifting to save-per-keystroke (a PostgREST HTTP RT per keystroke
  from the Worker/browser) and an anchor-sync implementation that
  delete+reinserts `note_anchors` on every autosave.
- Evidence: plan.md D2 (tsvector generated), D6 (LWW), F11 (trigger) — no
  autosave word anywhere; PostgREST path so the pool-cap-15 incident class
  does NOT apply (worth stating in the plan so nobody "fixes" it with a queue).
- Proposed fix: pin the contract: debounced autosave ≥3s idle + flush on
  blur/navigate; one PostgREST call per save; anchors are diffed and written
  only when the link set actually changed (or on explicit save), never
  rewritten per autosave tick. One vitest assertion on the debounce wiring is
  enough.

### PERF-7: anchor-count bound — loader selects a projection with a LIMIT; rail register uses LIMIT + "See all" per the existing rail pattern
- Severity: low-med
- Claim: A user with 500 notes anchored to one chapter (pathological, cheap to
  bound) would make the D5 fetch return 500 rows with whatever columns the
  select names — and if it names `notes.*` via an embed, bodies come too.
  Dots need only per-verse presence; the rail needs a handful of titles.
- Proposed fix: the chapter anchors call selects only
  `(note_id, kind, ref_id, updated_at)` — never note bodies —
  `order updated_at desc, limit 200`; dot merge dedupes to a boolean per
  verse; the rail register renders ≤ ~20 with "See all →" (/notes filtered by
  anchor), matching the rail's existing spread pattern. One fixture test at
  the limit.

### PERF-8: /notes index must not markdown-render N notes per request — derive title/excerpt from `body_md`; render full HTML only on /notes/:id; reject a stored-HTML column
- Severity: low-med
- Claim: Server-rendering markdown for every note on the /notes index is
  N × markdown-it per request on a CPU-billed Worker. Trivial at N≤100, but
  unnecessary at any N: Q4 already derives the title from the first line, and
  an index needs title + plain-text excerpt, not HTML.
- Evidence: plan.md Scope ("Server-rendered note reading"), Q4 (derived
  title); navigation.md §3a (KV never for user state — so no KV render cache,
  and none is needed).
- Proposed fix: index = cheap text derivation from `body_md` (first line +
  first ~200 chars, strip `[[...|label]]` to label); full markdown-it render
  only on /notes/:id (one note per request) and the rail/search snippet
  surfaces F6 already covers. Explicitly REJECT render-at-save (stored HTML
  column): it's a dual-write invariant, every renderer/wikilink-resolution
  change becomes a data migration, and it persists the F6 XSS surface into
  data instead of keeping escaping single-sourced at read time. Render-at-read
  is the right trade at every scale this product will see before the plan is
  revisited.

### PERF-9: server-side markdown-it adds ~100 kB min to the Worker bundle — note-only
- Severity: low
- Claim: `notes-render.server.ts` puts markdown-it in the SSR/Worker bundle
  (~100 kB min pre-gzip). Against Workers' size limits and cold-start profile
  this is noise; recorded so the number is on file and nobody re-derives it.
- Proposed fix: none — accept. If the Worker bundle ever nears a limit, this
  is not the first thing to cut.

---

## Open-question input

- **Q5 (markdown-it vs micromark): agree with markdown-it**, with one
  precision: the *client* editor chunk needs markdown-it only for md→doc
  parse (prosemirror-markdown's parser wraps it; the serializer is
  dependency-free). Keep it inside the lazy chunk (PERF-4.1); server-side
  parse-to-doc-JSON is the recorded fallback if the chunk budget ever matters.
- **Q7 (LWW): agree**, but D6 is incomplete without the autosave cadence —
  adopt the PERF-6 contract (≥3s debounce + blur flush, anchors diffed not
  churned) as part of the same decision.
- **New decision needed (D3 addendum): notes group ordering + pagination.**
  Recency-ordered, no keyset cursor in v1 (PERF-3.3/3.4). The alternative
  (rank-ordered via a `notes_search` RPC) is the only way to honor the
  score-bits cursor invariant and should be named-and-deferred, not left
  ambient.
- **New decision needed (D5 addendum): anchors leg placement + budget** —
  parallel-window, 750ms abort, degraded-as-value, critical-path-not-streamed
  (PERF-1). Cheap to write down now; expensive to re-derive in review.

## Harness gaps

1. **F10 has no mechanism and no substrate** — the build currently emits no
   Vite manifest at all. Adopt PERF-4.2 in full: `build.manifest: true`, a
   post-build closure test over `build/client/.vite/manifest.json` from
   root/scripture/search/notes/notes.$id with a **positive control** (editor
   chunk must exist under `dynamicImports`), plus the Playwright read-mode
   zero-network-request assertion. Without the positive control the test rots
   green.
2. **CPERF-6 amendment** (PERF-2): the pin as written cannot catch a
   duplicated or signed-out anchors fetch because the call is PostgREST-side.
   Add `fetchChapterAnchors` ×1 signed-in / ×0 signed-out to
   scripture.loader.test.ts; keep `db.execute` at 3 with an updated comment.
3. **Missing failure mode: notes leg degraded** (PERF-3.2) — F1–F12 has no row
   for "notes leg times out / errors → canon groups intact, notes group empty
   with meta error, one log line." Add it (F13) with a vitest assertion that
   aborts the mocked PostgREST call and asserts the canon payload is
   byte-identical to the notes-absent shape except the empty notes group.
4. **Anchors degraded mode** (PERF-1.2) — same shape for the chapter loader:
   mocked anchors timeout → chapter renders, `verseSignals` carries no note
   kind, no throw, one structured log event. Mirrors the existing
   neo4j_degraded test at scripture.loader.test.ts:258-268.
5. **Anchor LIMIT fixture** (PERF-7) — one test at the cap so the bound is a
   behavior, not a comment.
