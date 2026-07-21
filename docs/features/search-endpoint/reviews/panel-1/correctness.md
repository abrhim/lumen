# Panel-1 — correctness

| ID | Severity | Where | Problem (≤25 words) | Fix (≤30 words) |
|----|----------|-------|---------------------|-----------------|
| COR-1 | high | plan decision 7 / "Stage order" | Concurrent per-group dispatch has no per-group error isolation: one failing group (e.g., M5 live after M1 rollback, `word_similarity` undefined) rejects everything → 500, contradicting "never 500". | Use `Promise.allSettled`; failed group → empty results + logged error. Or explicitly couple M5 rollback ordering to M1/M2. Harness-pin a group-level SQL failure degrading, not 500ing. |
| COR-2 | high | plan decisions 1+6; search-harness.test.ts H8 (lines 184-189) | Fail-closed check exempts the whole `scripture` group, but 31,262 JST readings (collection `jst`) live inside it — a JST visibility leak passes the harness. | State JST sub-query is gated by `entities.collection_id`; H8 must assert scripture group contains no `variant:'jst'` results when `jst` is not visible. |
| COR-3 | high | plan M4 / H7 | Strong's translit is stored accented (`agapē`, 6,153/20,734 non-ASCII); probed: english FTS `agape` does not match `agapē`. Plan installs unaccent but never applies it anywhere. | M4 must build strongs tsv from `unaccent(translit)` (concatenated with raw fields). Note unaccent() is STABLE — fine at insert time, unusable in indexes/generated columns. |
| COR-4 | med | plan decision 2 | "Score breaks ties within tier" is not a total order: 23 persons named `Zechariah` rank identically (0.0607927) — LIMIT-8 page membership is nondeterministic across runs. | Mandate `ORDER BY tier, score DESC, id` (stable final key) in every group query; pin determinism by running one duplicate-name query twice in the harness. |
| COR-5 | med | plan "Ring-2 invariant" / H2 | "Behavior unchanged" overclaims: dual-index shifts length-normalized ts_rank (probed 0.0608→0.0384), so MCP's LIMIT-10 pages reorder; pre-change top-10 rows can drop off page. | Soften claim to match-set superset (WHERE-clause only); either accept ordering drift explicitly in the plan or pin top-1 stability for 2–3 archaic queries. |
| COR-6 | med | plan decision 4; slug-map.ts:141-153 | Chapter/verse parses always short-circuit even when unresolvable: "john 99", "acts 2:99" skip FTS and return nothing useful; humanMatch path also accepts "john 0" (no >0 validation). | Fall back to full FTS when `resolveReference` returns `found:false`/empty chapter; validate chapter/verse > 0 in the human-ref path (slug path already does). |
| COR-7 | med | plan decision 9 / H15 (search-harness.test.ts:129-146) | Aggregate Σ(seq_end−seq_start+1)=captions passes when one gap and one overlap cancel; contiguity (probed: all 10 episodes 0-based, gap 0) is an unstated precondition. | H15: order windows per episode, assert each seq_start = prev seq_end+1, first = min(seq), last = max(seq). build-search-moments.mjs asserts seq contiguity before windowing. |
| COR-8 | med | plan M3 / build-search-moments.mjs | `t_start_s/t_end_s` are numeric(9,3) → postgres.js strings; 113 captions have t_end_s > next t_start_s. String comparison misorders gap logic silently; H15/H13 won't catch wrong boundaries. | Number()-coerce timings at read in the build script; compute gap = next_start − cur_end, clamp negatives to 0; write payload timestamps as numbers (H13's write-site fix). |
| COR-9 | med | harness (search-harness.test.ts:54) / plan decision 6 | Harness premise "unshaken is public=false" contradicts live prod: all 8 collections including `unshaken` are `public=true`, so the anonymous path already exposes unshaken; H8 tests a hypothetical config. | Either flip `unshaken.public` as a stated ship prerequisite, or correct the fixture comment and add an assertion deriving the expected list from live `lumen.collections` flags. |
| COR-10 | low | plan decisions 3+5 / H13 | Boost arithmetic via `(metadata->>'fame')::numeric` yields numeric → postgres.js string scores; contract implies `score` is a number but only `t_start_s` is type-pinned. | Cast final score to `::float8` in every group SELECT; add `typeof result.score === 'number'` assertion beside the H13 t_start_s pin. |

## Evidence

All probes run 2026-07-21 against live prod via the worktree `.env` DSN (`node -e` + `pg`, SELECT-only).

**Transcript seq contiguity (COR-7 precondition holds today):**

```
episode_id             |    n | min_seq | max_seq | gap
unshaken-25hrVBU3Vz8   | 6030 |       0 |    6029 |   0
unshaken-4pSrikfJ5Yw   | 3045 |       0 |    3044 |   0
unshaken-6lXWLIOUKC8   | 3965 |       0 |    3964 |   0
unshaken-8SvK7L87o1A   | 4105 |       0 |    4104 |   0
unshaken-ivzxaLpbZws   | 2068 |       0 |    2067 |   0
unshaken-jMYk190JBys   | 3600 |       0 |    3599 |   0
unshaken-ki0bTvQsaCo   | 5557 |       0 |    5556 |   0
unshaken-O3SiM9Yi940   | 4059 |       0 |    4058 |   0
unshaken-RLirbnj-kGk   | 2792 |       0 |    2791 |   0
unshaken-yAQlljeet-0   | 4238 |       0 |    4237 |   0
```

All 10 episodes contiguous and 0-based; H15's span arithmetic is valid only while this holds (it is nowhere asserted by the build script). Empty/whitespace captions: **0** (`btrim(text)=''`); min caption length 1 char, 166 captions under 3 chars.

**Caption timing overlaps (COR-8):** 113 rows where `t_end_s > lead(t_start_s)`, e.g. `unshaken-25hrVBU3Vz8` seq 240: `t_end_s='960.160'`, next start `'959.515'` — note pg returns these numerics as **strings**.

**Collections visibility (COR-9, COR-2):**

```
id        | public          entities WHERE collection_id='jst':
art       | true            jst_reading | 31262
canon     | true
jst       | true
naves     | true
openbible | true
phase-b   | true
strongs   | true
unshaken  | true            ← harness comment says public=false
```

**Strong's accents (COR-3):** G26 → `translit='agapē'`, gloss `'love'`. 6,153 of 20,734 translits contain non-ASCII. Probe:
`to_tsvector('english','agapē') @@ plainto_tsquery('english','agape')` → **false** (and `simple` config → false).

**Dual-index superset mechanism (sound) + rank shift (COR-5):**
`(to_tsvector('english','he believeth and spake') || to_tsvector('english','he believes and spoke'))` matches both `believeth` (keeps_old=**true**) and `believe` (gains_new=**true**) — lexeme-union superset confirmed; description lengths cap at 10,000 chars (naves), so tsvector 1MB/position caps are not a risk at this corpus.
But `ts_rank(..., 1)` (length-normalized, plan decision 3) shifts: single vector 0.0607927 → dual vector **0.0383559** for the same match — LIMIT-bounded orderings change.

**Rank ties (COR-4):** 23 `person` entities named exactly `Zechariah` (also Shemaiah 21, Azariah 18, Shimei 18); `SELECT DISTINCT ts_rank(...)` over all 23 returns a single value `0.0607927` — no intra-tier discriminator exists without an id tiebreak.

**Reference parsing (COR-6):** `slug-map.ts:141-153` humanMatch path parses `"john 0"` → `{level:'chapter', chapter:0}` (no `ch > 0` guard, unlike the slug path at :127/:134); `resolve-reference.ts:56-78` returns `verse_count:0` / `found:false` for out-of-range refs — plan decision 4 short-circuits FTS on any chapter/verse-level *parse*, resolvable or not. Collision checks: `"1 john"`/`"judges"`/`"job"` all parse as book-level → correctly run both paths; `"acts 2"` → chapter short-circuit (by design, Q5).

**Harness pins verified live (no findings):** H4 captions seq 100/101 of `unshaken-4pSrikfJ5Yw` read exactly as pinned; H2 floors exact-match current prod (believeth=59, spake=782, faith=810); H10 ids `melchizedek-1` (person, phase-b) and `naves-melchizedek` (naves_topic) both exist uniquely; H16 pinned lexemes confirmed: `to_tsvector('english','cries cry spoke swore believes loves')` → `'believ' 'cri' 'love' 'spoke' 'swore'`; `search_index.tsv` is a plain (non-generated) column, so table-reading `normalize_kjv` at insert time is legal.
