# Code-panel — correctness (search-ui, diff f352bae..46d888d, deployed fd093ed4)

Reviewed against plan.md (ratified Decisions ledger respected; "Out (deliberate)" untouched).
B-U1 fix verified holds (pointer-aware onCloseAutoFocus; keyboard return-focus per AU-3 is ratified).
B-U2 fix verified holds live (`/search?q=moses` → 1 reference lead + 56 result rows). CC-5 below is the
residual instance of the B-U2 MODE, per the fix-the-mode house rule.

| ID | Sev | Where | Problem | Fix |
|----|-----|-------|---------|-----|
| CC-1 | high | packages/scripture/src/search.ts:344-347, :362-368, :705-714, :719-730 | Keyset cursor is minted from the JS-sorted (code-unit/"C") last row, but SQL ORDER BY and the `id >` keyset compare run in the column's en_US.UTF-8 collation. Inside real score ties with mixed-case ids (episode/moment ref_ids embed YouTube ids) the two orders disagree → duplicate rows across pages. **Live-proven on prod**: `q=israel&scope=episodes&limit=8` serves `unshaken-O3SiM9Yi940#144` on BOTH page 1 and page 2 — F1's no-dup contract violated on the deployed API. Web UI masks it via dedupe (silently short appends); raw API/Ring-2 consumers see dups. Verse ids happen to be collation-neutral (0 divergent), which is why F1/F15 harness passes. | Add `COLLATE "C"` to every leg's `ORDER BY … id` and to the `keysetAfter` id comparison (matches the JS comparator and the harness oracle's stated intent) — or mint the cursor from SQL row order instead of the JS re-sort. |
| CC-2 | high | apps/web/app/routes/search.tsx:604-618, :750-752, :755-759 | On a single-scope page with appended pages, live-typing a new query updates `display` via the fetcher but never resets `extra`: `mergedSingle` (:751) appends the OLD query's pages under the NEW query's results, and `currentCursor` (:752) prefers the stale `extra.nextCursor`. Clicking More then fetches new `q` + old-q cursor → guaranteed 400 `cursor_mismatch` → CC-4 crash. Flow: isolate a group → scroll/More → edit query without Enter. | Reset `extra` (and `pendingCursorRef`) whenever the live display query changes — in `onInputChange` next to `setLive(null)`, and when live data with a different `query` lands. |
| CC-3 | med | apps/web/app/routes/search.tsx:580-585, :592-602 | Commit-discard is incomplete for the pagination fetcher: the navigation-commit reset effect nulls live state and `extra` but NOT `pendingCursorRef.current`. An in-flight More response landing after a commit passes the `pendingCursorRef !== null` gate and, when the new page has the same single-scope key (Enter with a new q while scope=X), appends the old query's rows to the new page. | Add `pendingCursorRef.current = null` to the :580 reset effect. |
| CC-4 | med | apps/web/app/routes/search.tsx:596 | `pageFetcher` effect dereferences `d.groups.find(...)` with no shape guard. API 400/500 bodies arrive as `fetcher.data`, not boundary errors (proven: `/api/search.data?q=x` turbo-stream encodes `{error, code}` under `"data"`), so any transient 500 — or CC-2's deterministic `cursor_mismatch` — throws TypeError in the effect and swaps the whole page to the ErrorBoundary, losing input. `liveFetcher` survives only by accident of its `d.query` guard. | Guard `Array.isArray(d?.groups)` before merging; clear `pendingCursorRef`; show a quiet retry state instead of crashing. |
| CC-5 | med | apps/web/app/routes/search.tsx:627-638, :929-935, :937 | B-U2 mode residue, inverse direction: a FOUND volume/book reference with zero group hits renders the zero state and suppresses the reference lead entirely. **Live**: `/api/search?q=pgp` returns `reference.found:true` + all-empty groups; `/search?q=pgp` SSRs "Nothing in the library matches" with zero "Reference" blocks. Same for `bom`/`ot`/`nt`, and for any book name once the matching groups are scope-excluded. B-U2 was "reference suppresses groups"; this is "zero groups suppress reference". | Render the reference lead in the zero state too (gate on `displayReference` rather than `view === "results"`), with the zero copy beneath it. |
| CC-6 | low | apps/web/app/routes/search.tsx:587-590, :620-638 | Live path has no failure feedback: an error body is silently discarded by the `d.query` guard, so a >200-char input (API 400 `q_length` — the client never gates max length) or a transient failure leaves `view === "pending"` — blank below the header, empty status line, forever. | Client-gate q ≤ 200 like Q_MIN; on a live-fetch error body show the quiet zero/error copy instead of staying "pending". |
| CC-7 | low | packages/scripture/src/__tests__/search-cursor-harness.test.ts:52-76, :109-143 | F1/F15 keyset pins only exercise the scripture leg, whose verse ids are collation-neutral (probe: 0/41,995 divergent). The episodes/art/words legs — mixed-case ref_ids, 16/38 tie sets order-divergent for q=faith — are exactly where CC-1 lives; the oracle's "C == default live" comment is true only for its own window. | Add an episodes-leg F1 continuity pin at a divergent tie (q=israel, limit=8 fixture) — goes red today, green with the CC-1 fix. |

## Evidence

All probes 2026-07-21/22 against LIVE prod (worker fd093ed4) and the live DB as `lumen_read` (read-only, connections closed).

**DB collation + divergence (CC-1/CC-7):**
```
datcollate = en_US.UTF-8 (datctype en_US.UTF-8); id columns collation_name = null (database default)
verses.id      default-vs-"C" divergent positions: 0
entities.id    divergent positions: 22,015   (e.g. 'a despicable person-1' rn 337 default vs 14,535 "C")
search_index.ref_id divergent positions: 27,080
episodes-leg tie sets ordering differently default vs "C":  q=faith 16/38 · q=covenant 9/42 · q=temple 9/37
topics-leg tie sets: 0 divergent for probed q's (entity ids lowercase) — global order still diverges
moment ref_id shape: unshaken-<YouTubeId>#<t> — mixed case, e.g. unshaken-O3SiM9Yi940#144 vs unshaken-ki0bTvQsaCo#356
  en_US: ki0b… < O3Si… (case-insensitive primary) · JS/UTF-16: 'O'(0x4f) < 'k'(0x6b) → orders flip inside ties
```

**Live duplicate across a page boundary (CC-1), prod API:**
```
GET /api/search?q=israel&scope=episodes&limit=8
page1: …, unshaken-O3SiM9Yi940#1294, unshaken-O3SiM9Yi940#144, unshaken-ki0bTvQsaCo#1536, unshaken-ki0bTvQsaCo#356
  (last three all score_bits-equal at 0.015496106818318367; cursor minted from JS-last = ki0bTvQsaCo#356,
   but SQL en_US-last of the served tie members is O3SiM9Yi940#144)
GET …&after=<nextCursor>
page2: unshaken-O3SiM9Yi940#144, unshaken-RLirbnj-kGk#225, …
DUPLICATES across pages: ["unshaken-O3SiM9Yi940#144"]
```
Simulation over the exact leg SQL found further live reproducers: q=israel limits 8/10/18, q=faith limit 23,
q=spirit limit 21. Analysis: dup-only, no gap (predicate `id > cursor` in en_US admits every unserved tie
member), and progress is monotone — no loop. score_bits fix itself verified: response scores are 17-sig-digit
float64 (0.015496106818318367 ties bit-equal), page-boundary tie splits correctly on the id when collations agree.

**Reference suppressed by zero groups (CC-5), prod:**
```
GET /api/search?q=pgp → {"reference":{"level":"volume","display":"pgp","found":true},"groups":[all 7 empty]}
GET /search?q=pgp     → SSR contains "Nothing in the library matches", grep -c "Reference" = 0
GET /search?q=moses   → 1 reference lead + 56 data-result-row (B-U2 fix HOLDS at book level)
```

**Fetcher error-body shape (CC-4), prod:**
```
GET /api/search?q=x        → 400 {"error":"q must be 2–200 characters","code":"q_length"}
GET /api/search.data?q=x   → 400 text/x-script, turbo-stream:
  ["routes/api.search",{…},{"error":"q must be 2–200 characters","code":"q_length"}]  ← encoded as DATA
→ fetcher.data = {error, code}; d.groups === undefined; search.tsx:596 `d.groups.find` throws TypeError.
```

**Checked and clean (no finding):** cursor codec round-trip incl. `|` in ids and bit-exact float64 via
float8send/DataView; JS number param → postgres float8in round-trip (shortest-repr text is exact); sub
derivation SQL-vs-JS cannot drift (subOf matches every leg CASE); F16 visibility re-gate (gates inside
`inner`, cursor carries no visibility); scope floor-of-1 (UI) + `scope=` → 400 scope_unknown (ratified);
adaptive limit mapping 7→8/4→12/2→18/1→25 exact and F20 explicit `limit=` on every client fetch;
dedupeMoments keys `(episode_id, t_start_s)` consistent with rowKey; moment payloads live-verified
(4000/4000 carry episode_id + t_start_s, deep-links never use result.id); routes.ts `search` above the
catch-all; F17 static headers() covers thrown 400/500; exhausted-page/no-cursor and empty-page/no-mint (F5).
