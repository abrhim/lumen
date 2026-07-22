# Panel-2 / Adversarial meta-review — correctness (search-ui plan)

Reviewer stance: **mostly signal.** Six of eight findings are material; two are noise.
The crux finding (CU-1) is not just plausible — a live read-only probe *proves* it is a
real dup/skip bug in the plan's cursor format. The two noise tags are grounded in
verified file/plan facts, not vibes.

Live probe (read-only, `lumen_read`, Hyperdrive DSN), `q='faith'`:
- **scripture leg**: verse_hits=810 (sub=0), jst_hits=348 (sub=1), min_verse_score=0.00973,
  max_jst_score=0.0959, **jst_above_min_verse = 348 (all of them)**. The SQL orders by
  `(tier, sub, score DESC, id)` (search.ts:271) but plan.md:26 cursor = `v1|qhash|tier|score|id`
  (no `sub`). A keyset predicate without `sub` skips the entire 348-row jst block at the
  verse→jst boundary → proven gap.
- **tie density**: within the first 25 verse rows, a 10-way tie at `0.0261819958686829`
  and a 7-way tie at `0.0235178302973509`. Score precision in the cursor codec is load-bearing.
- **episodes leg**: 1 episode (sub=0, score 0.1636) + 220 moments (sub=1, 0.0097–0.0155) —
  here sub=0 also holds the top score, so faith/episodes is incidentally safe, exactly as CU-1 says
  ("true here by luck… nothing guarantees it in general"). The scripture leg is the one that bites.
- `apps/web/.env` contains only `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`, no
  `DATABASE_URL` — CU-2's premise verified. The cursor harness (mtime 21:18, after the review's
  19:39–19:40 artifacts) has already been rewritten to read the Hyperdrive key and cites "CU-2"
  in its comment — the fix landed, confirming materiality.

| ID | Tag | Rationale |
|----|-----|-----------|
| CU-1 | material | Live-proven: all 348 jst rows outscore min verse score, so `(tier,score,id)`-only keyset (plan:26) skips the jst block at the sub-boundary vs the actual `(tier,sub,score,id)` order (search.ts:271). Real dup/skip; fix (add `sub`) is clean, not risky. |
| CU-2 | material | Verified: `apps/web/.env` has no `DATABASE_URL`, only the Hyperdrive key; the only live cursor-continuity harness (F1/F5, catches CU-1) couldn't run. Already fixed post-review (file cites "CU-2") — confirms it was a real, incorporated harness-origin bug. |
| CU-3 | material | Live-verified `GET /api/search?q=faith&scope=` → 400 `scope_unknown`; exclude-all produces exactly that empty scope. Plan defines no ≥1-group floor; F7 pins round-trip but not the boundary. Real edge, cheap fix (disable excluding the last group). |
| CU-4 | material | Episodes cursor keys on `id`=moment id + score, both re-keyed on every future M3 re-run (recurring class, real). No F-number covers cursor-position validity across a re-window (F10 only covers deep-link href/React keys). Low probability in a solo beta, but a genuine uncovered gap with a clean minimal fix (dedupe on `episode_id,t_start_s`); material over the heavier fail-closed option. |
| CU-5 | material | Codec round-trip (harness:73) asserts only `{tier,id}`, never `score`; live-proven dense ties (10-way at 0.0262) make id-tiebreak-within-a-tie depend on exact score. A `.toFixed`-style precision loss would dup/gap at a tie cluster and this test passes. Real coverage gap on a correctness-critical codec. |
| CU-6 | noise | Divergence is by-design and both surfaces are acceptable: `searchAll` (search.ts:520) trims/slices to 200 with no floor and returns bounded low-value results for `q='a'`; api.search.tsx:47 enforces `Q_MIN=2` for the JSON contract (Q4 has the loader call `searchAll` directly on purpose). No bug — the fix is a DRY refactor + pinning already-acceptable behavior. |
| CU-7 | material | api.search.tsx:67 default `limitPerGroup=8`, but the loader derives adaptive `25` for an isolated single group from `scope.length` (not from the URL). The pagination `/api/search?after=` fetch must re-derive and carry `limit=25` or pages silently shrink 25→8 mid-scroll — an uncovered failure mode; non-obvious client/loader coupling. |
| CU-8 | noise | The plan is navigation/SSR-based (Q4 direct `searchAll`, plan:22 URL-driven loader, plan:24 Enter→navigate) — never a live-update fetcher. React Router serializes navigations, so the described "stale results land after fresh" fetcher race is precluded by the architecture. "300ms skeleton" fits nav loading state; the ask reduces to a doc sentence. |

## Notes / dissents from the specialist
- Agree with CU-1 and it is stronger than "high" implies — I upgraded it from plausible to
  **proven** via the 348/348 jst-above-min-verse probe. The plan's own F1 fixture
  (`q=faith,scope=scripture,limit=25`) structurally cannot reach the boundary (810 pure-verse
  rows first), so the harness as written would ship green over this bug even after CU-2 is fixed.
- CU-4's *primary* suggested fix (data-generation stamp → fail-closed "restart") would itself
  regress UX (rejecting valid cursors after any unrelated ingest). It escapes a `risky` tag only
  because the finding also offers the clean, non-regressive fallback (client dedupe on the durable
  `episode_id,t_start_s` key). Implementers should take the fallback, not the stamp.
- CU-6 and CU-8 are the two I part ways with the specialist on: both describe real divergences,
  but neither is a *risk* — CU-6's two surfaces are each individually correct for their contract,
  and CU-8's race is structurally impossible under the plan's chosen (navigation) model.
