# CODE-PANEL — api-contract (search-ui, IMPLEMENTED)

Reviewed: `f352bae..46d888d` (= deployed worker fd093ed4). Lens: `after`/`nextCursor` shape vs plan, 400-code exhaustiveness/stability, score full-precision side-effect, silent-ignore of continuation intent, `searchAll` additivity, response invariants under `after`. Live prod + lumen_read DB probed 2026-07-21.

## Findings

| ID | Sev | Where | Problem | Fix |
|----|-----|-------|---------|-----|
| ACC-1 | **high** | `packages/scripture/src/search.ts:363/367` (leg `ORDER BY … id`), `:344-347` (`keysetAfter`), `:705-713` (`sortResults` JS id tiebreak), `:719-730` (`mintNextCursor`) | Cursor id-tiebreak collation split: SQL legs order/compare `id` under the DB default collation (**en_US.UTF-8**), but `sortResults` re-sorts with UTF-16 code-unit `<` and `mintNextCursor` mints from the **JS-last** row. Inside exact score ties whose ids invert between the two collations, the minted cursor is not the SQL page boundary → page 2 **re-serves page-1 rows**. Live-proven on prod: `q=faith&scope=episodes&limit=23` → cursor decodes to `…|unshaken-ivzxaLpbZws#0`; page 2's first row `unshaken-RLirbnj-kGk#2408` is a duplicate of page-1 row 22 (same id AND same `(episode_id, t_start_s)`). Violates F1/F15 "no dup, order preserved" at the API level; the shipped UI masks it via `dedupeMoments`, API consumers see it raw. Affected universes today: episodes leg (1885/4010 ref_id positions diverge — mixed-case YouTube ids), topics leg (996 positions — `God-with-us`); verses/people/places/art/words probed 0-divergent. The cursor-harness oracle already pins `id COLLATE "C"` but only for the scripture leg ("pin of intent") — the shipped legs don't. | Add `COLLATE "C"` to every leg's `ORDER BY … id` **and** to `keysetAfter`'s id comparison so SQL order equals the JS code-unit tiebreak; extend F1/F15-style pins to episodes + topics (the diverging universes). No index impact — the sort runs on computed subquery output. |
| ACC-2 | low | `packages/scripture/src/search.ts:744-747`; route param surface (`apps/web/app/routes/api.search.tsx:74`); `/search` loader ignores `after` entirely | Silent-drop-of-continuation-intent mode, three instances: (a) HTTP `cursor=` (or any misnamed param) is silently ignored → page 1 re-served with a fresh `nextCursor` (live-confirmed identical body); (b) **library**: `searchAll` silently ignores `opts.after` whenever `scope` isn't exactly one group — a direct caller gets page 1, no error (docstring'd, but the route 400s the same shape); (c) `/search?after=…` ignored. Verdict on the verifier's question: (a) is **acceptable** — ignoring unknown query params is web convention, the only shipped client uses `after`, and a mis-paginating client re-receives a cursor it can act on. But the mode should not live inside the library where the route can't guard it. | Make `searchAll` throw (e.g. `SearchCursorError`-family) when `after` is supplied with `scope?.length !== 1`, matching the route's `cursor_scope` semantics; leave HTTP unknown-param behavior as-is. |
| ACC-3 | low | `apps/web/app/routes/api.search.tsx:88` + `packages/scripture/src/search.ts:744-747` | The cursor is decoded twice — route (validation) and `searchAll` (use), with independently-derived bind inputs (`parseQ` trim/len-check vs `trim().slice(0,200)`). Identical today, so unreachable; but any future drift (q normalization, hash input change) makes searchAll's decode throw **inside the route's catch-all** → 500 `internal` + `search_failed` log instead of a stable 400. | Belt-and-braces: in the route's catch, map `SearchCursorError` to its 400 code before the 500 fallback (or pass the decoded cursor through instead of the raw string). |
| ACC-4 | low | `packages/scripture/src/search.ts:648-684` (`score_bits`/`coerceRow`) | Score full-precision side-effect (builder-flagged): `score` in the JSON body now carries bit-exact float64 (live sample `0.015548055991530418`, 17 sig digits) instead of the pooled path's 15-digit textual rounding. Assessed **benign**: field type unchanged (number); no in-repo consumer reads `.score` (only api.search.tsx + search.tsx call `searchAll`, neither renders score); it's the ratified CU-5 mechanism and the precision is *required* for the cursor's score-equality tiebreak; ordering now genuinely matches SQL (the old rounded-score JS re-sort could disagree). Residual: any external snapshot-consumer of /api/search sees changed score digits with no doc note. | One line in the API contract/plan noting score values changed precision at fd093ed4 (additive, within-type). No code change. |

## Contract verdicts (assigned questions, no finding needed)

- **`after`/`nextCursor` shape vs plan** — MATCHES. Live cursor decodes to exactly `v1|b0cc20b3|3|1|3f8b4d2100000000|unshaken-ivzxaLpbZws#0` = `v1|qhash|tier|sub|scorehex16|id`, base64url, bit-exact float64 hex, id may contain `|` (decode rejoins `parts.slice(5)`). `nextCursor` present only when `results.length === limit` (F5), minted per-group in multi-group responses and redeemable only after isolating scope to that group — coherent with the UI's More-pill flow.
- **400 codes exhaustive/stable** — VERIFIED live: `cursor_scope` (no scope / 2 scopes), `cursor_invalid` (garbage, oversize >256), `cursor_mismatch` (other q, other scope group); raw cursor never echoed in any body. Legacy `q_required/q_length/scope_unknown/limit_invalid` moved verbatim into `search-request.server.ts` — byte-identical codes. No other new 400 path exists in the route.
- **`searchAll` additivity** — VERIFIED: `SearchOptions.after?` and `SearchGroup.nextCursor?` are optional; only api.search.tsx and search.tsx call `searchAll`; no-`after` calls behave identically except ACC-4's score precision.
- **Response invariants under `after`** — HOLD: groups always exactly the scoped keys in GROUP_KEYS order (`parseScope` canonicalizes; probe `scope=words,art,scripture` → `["scripture","art","words"]`; `after` pages return `["episodes"]`); empty groups present, not omitted; F16 visibility re-gate pinned in harness.
- **AFTER_MAX=256 headroom** — SAFE: max live id length 99 (entities/search_index; verses 12) → worst-case cursor text 132 chars → 176 b64url chars < 256.
- **B-U1 fix holds** — pointer-aware `onCloseAutoFocus` guards BOTH Dialog and Sheet branches (SearchModal.tsx:112-118, 133-139); keyboard opens keep return-focus (no pointerdown fires); flag resets after close. No other new focus-returning trigger in the diff.
- **B-U2 fix holds live** — `/api/search?q=moses` returns book-level reference `{level:"book", found:true}` AND all 7 groups with hits; `/search?q=moses` HTML renders the Reference lead plus People/groups sections; `Cache-Control: private, no-store` on the page. `isShortCircuitReference` gates both loader state and client `view`; the engine itself only short-circuits chapter/verse — no residual instance of the suppress-groups mode found.

## Evidence

**DB (lumen_read, 2026-07-21):**
- `datcollate = en_US.UTF-8` (PostgreSQL 17.6). `'Faith' < 'faith'` → SQL **false**, JS **true** (direct inversion witness).
- Default-vs-`COLLATE "C"` ORDER BY divergence (row positions): verses 0; entities 22,015 (whole table); **per-leg universes**: people 0, places 0, **topics 996** (`God-with-us` principle: pos 996 default vs pos 1 in "C"), **episodes(si) 1885** of 4010 (moment ref_ids embed mixed-case YouTube ids: `unshaken-25hrVBU3Vz8#1007`), art 0, words 0.
- Live tie groups reproduce the shipped episodes-leg scoring: q='faith' has a 15-way tie at score `0.0107172345742583` (tier 3, sub 1) whose default order ends `…ki0bTvQsaCo#955, RLirbnj-kGk#2388, RLirbnj-kGk#620, RLirbnj-kGk#702` while "C" order ends `…ivzxaLpbZws#1171, ki0bTvQsaCo#…` — every probed q (faith/covenant/temple/church/joseph) has multiple diverging tie groups.
- Offline page simulation (exact leg SQL + shipped JS comparator): q='faith', N=23 → JS-last `unshaken-ivzxaLpbZws#0` ≠ SQL-last `unshaken-RLirbnj-kGk#2408` → duplicate predicted.

**Live prod (`https://lumen.abramhimmer.workers.dev`, GET only):**
```
P1 GET /api/search?q=faith&scope=episodes&limit=23 → 200, 23 rows, groups=["episodes"]
   nextCursor decodes: v1|b0cc20b3|3|1|3f8b4d2100000000|unshaken-ivzxaLpbZws#0
   page-1 tail: [...,"unshaken-RLirbnj-kGk#2408","unshaken-ivzxaLpbZws#0"]
P2 GET …&after=<cursor> → 200, first row "unshaken-RLirbnj-kGk#2408"
   DUPLICATE ids across pages: ["unshaken-RLirbnj-kGk#2408"]
   DUPLICATE (episode,t) pairs: ["unshaken-RLirbnj-kGk#10547.676"]   ← ACC-1 proven
P3 …&cursor=<cursor> (misnamed param) → 200, byte-identical to page 1  ← ACC-2(a)
P4 after w/o scope → 400 cursor_scope · 2 scopes → 400 cursor_scope
   garbage → 400 cursor_invalid · 300-char → 400 cursor_invalid
   other q → 400 cursor_mismatch · other scope group → 400 cursor_mismatch
   raw cursor echoed in any error body: false
P5 raw JSON score sample: "score":0.015548055991530418 (17 sig digits) ← ACC-4
P6 q=moses → reference {level:"book",found:true} + hits in all 7 groups; /search?q=moses
   HTML has Reference block + People section; cache-control: private, no-store ← B-U2 holds
P7 scope=words,art,scripture → keys ["scripture","art","words"] (canonical order)
```
Probe scripts: scratchpad `db-probe{,2,3,4,5}.js`, `api-probe.js`; single pg connection each, closed after use.
