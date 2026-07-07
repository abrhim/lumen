# Code-adversarial aggregate — tske-cross-references

6 taggers over 7 roles + 8-angle parallel sweep folded in. Bug filter in ../bugs.md.

## api-contract
# CODE-ADVERSARIAL / api-contract — tske-cross-references

Adversarial pass against `docs/features/tske-cross-references/reviews/code-panel/api-contract.md`
(CAPI-1..7). Re-ran the actual test suite, re-read `packages/scripture/src/crossrefs.ts`,
`packages/scripture/src/__tests__/crossref.test.ts`,
`apps/web/app/routes/__tests__/scripture.loader.test.ts`, and `apps/web/app/routes/scripture.tsx`
directly, and checked every claim against plan.md amendment 11 (exact `CrossRefRow`/`CrossRefCard`
shapes, `getCrossReferences` signature) and amendment 14 (UNION ALL / no-new-index posture) rather
than trusting the panel's prose.

**CAPI-1 verification.** Ran `pnpm --filter web exec vitest run
app/routes/__tests__/scripture.loader.test.ts`. Confirmed exactly: the mock at line 12
(`getCrossReferences: vi.fn(async () => [])`) resolves an array, but `loadCrossRefs`
(`scripture.tsx:136`) destructures `const { refs, totals } = await getCrossReferences(...)`.
Destructuring an array as `{refs, totals}` doesn't throw — both come back `undefined` — but
`groupCrossRefs(undefined)`'s `for (const r of rows)` (`crossrefs.ts:92`) does:
`TypeError: rows is not iterable`, caught by `loadCrossRefs`'s own try/catch, logged as
`crossref_degraded`, degraded silently. Live stderr confirms the exact error on every test that
touches `?verse=`, and the suite still reports `19 tests passed`. Net effect: no test in this file
exercises the crossRefs non-degraded path at all — `data.crossRefs.cards`/`.totals` are never
asserted, so the loader's `{refs,totals}` → `groupCrossRefs` → `CrossRefsPanel` wiring has zero
integration coverage despite 19 green checkmarks implying otherwise. This is worse than a missing
assertion; it's a false-positive test file.

**CAPI-2 verification.** Reproduced standalone: `groupCrossRefs` fed two `incoming` rows for
distinct citing verses (`ps-148-4`, `ps-22-1`) that both cite the same target range
(`range_start: 'heb-1-1'`, `range_end: 'heb-1-3'`) collapses to **one card**, `verse_id: "heb-1-1"`
(the target's own book — not either citer), label `"Psalm 148:4–3"` (Psalm reference spliced with
the target's chapter:verse — internally incoherent). This is the identical mechanism
`code-adversarial/correctness.md` already confirmed under CCOR-1 independently (dedup key
`` `${direction}:${range_start ?? verse_id}` `` uses the target-side `range_start` for incoming rows,
which isn't citer-identifying). Two independent adversarial passes reproducing the same defect by
different routes is strong corroboration, not redundant noise.

**CAPI-3 verification.** Amendment 11's pinned shape is unambiguous: `CrossRefRow = { verse_id,
reference, text, direction, votes: number, range_start: string|null, range_end: string|null }` — 7
fields, non-nullable `votes`. The actual interface (`crossrefs.ts:17-26`) has 8 fields (adds
`total: number`) and `votes: number | null`. Both are real, checked against the amendment text
directly, not inferred. Note the nullable-`votes` deviation is arguably the *amendment* being
incomplete, not the code: `crossrefs.ts`'s own docstring (line 14) says "Legacy curated edges carry
no votes → NULLS LAST," and the SQL casts `(e.metadata->>'votes')::int` which is `NULL` when the key
is absent — so `votes: number` as pinned cannot hold for the curated/`phase-b` collection this same
function serves. The `total` field is contained (never reaches `CrossRefCard`, which correctly omits
it — `groupCrossRefs`'s param type is `Omit<CrossRefRow,'total'> & {total?: number}`), so there's no
client-facing leak, but it's still an unpinned field on an "exact shape" contract whose entire reason
for existing (per amendment 11) is to be exact.

**CAPI-4 verification.** Grepped `crossref.test.ts` for `totals` — zero matches. Confirmed: both
SQL-shape tests call `capturingDb([])`, so `getCrossReferences`'s totals-extraction loop
(`for (const r of rows) totals[r.direction] = r.total`) never runs over a non-empty array in any
test. This isn't cosmetic — amendment 10 pins `totals` as the mechanism for the "20 of N" truncation
disclosure in the References section header, a named UX requirement, and it's exercised by zero
tests.

**CAPI-5 verification.** Grepped `crossref.test.ts` for `UNION ALL` and `toHaveBeenCalledTimes` —
zero matches for either. Amendment 14 states the UNION ALL single-round-trip design is "pinned by
the SQL-shape test"; that's false as written — the two existing tests assert substring presence of
`lumen.edges`/`from_id`/`to_id`/`votes`/`lumen.verses`, none of which pins single-statement,
single-round-trip execution. The implementation itself does use `UNION ALL` (`crossrefs.ts:53`,
confirmed by direct read) and a single `db.execute` call, so the code matches amendment 14's intent
— only the amendment's claim that this is test-locked is wrong, and a regression to two round trips
would pass every existing test.

**CAPI-6 verification.** Grepped `crossref.test.ts` for `LIMIT`/`limitPerDirection` — zero matches.
Confirmed: no test passes a custom `limitPerDirection` or asserts the emitted `LIMIT` value with the
option omitted. Real gap, but narrow: it's a single scalar default (`?? 20`, `crossrefs.ts:38`)
gating a `LIMIT` clause, with no cross-cutting behavior riding on it the way totals (CAPI-4) or
routing (CAPI-7) do — a regression here changes how many rows come back, not which collection or
whether the query is well-formed.

**CAPI-7 verification.** Grepped the same test file for `collection_id` — zero matches. Confirmed:
neither SQL-shape test asserts the WHERE-clause filter, even though `opts.collectionId` is what
routes the entire openbible/curated (`phase-b`) hybrid amendment 11 specifies. Note this is narrower
than it first sounds — `scripture.loader.test.ts`'s FM-7/FM-8 test *does* assert the loader calls
`getCrossReferences` with the correct `collectionId` argument for Bible vs. BoM verses — but that
only pins the caller side. Nothing pins that `crossrefs.ts` actually threads `collectionId` into the
SQL `WHERE e.collection_id = ${opts.collectionId}` filter (it does, confirmed by direct read of
lines 49/63) rather than, say, silently dropping it. A regression there would leak one collection's
rows into the other volume's panel with no test catching it.

## Table

| ID | Tag | Rationale (≤25 words) |
|---|---|---|
| CAPI-1 | material | Reproduced live: 19/19 green while every crossRefs path throws-and-degrades internally; happy path has zero real integration coverage. |
| CAPI-2 | material | Reproduced standalone (2 rows → 1 card, wrong verse_id/label); independently corroborates CCOR-1 via a different route. |
| CAPI-3 | material | Confirmed 8-field/nullable-votes vs amendment 11's pinned 7-field/non-null shape; `total` is contained, but the pin is genuinely violated. |
| CAPI-4 | material | Confirmed zero non-empty-row tests; totals gate the amendment-10 "20 of N" truncation UX with no coverage. |
| CAPI-5 | material | Confirmed: amendment 14's "pinned by the SQL-shape test" claim is false — no test asserts UNION ALL or call count; doc inaccuracy plus real gap. |
| CAPI-6 | risky | Confirmed untested default, but narrow blast radius — one scalar gating row count, not routing or shape. |
| CAPI-7 | material | Confirmed unasserted `collection_id` WHERE filter — the actual routing mechanism for the openbible/curated hybrid, only caller-side pinned elsewhere. |

## Stance

Six of seven hold as material, and two (CAPI-1, CAPI-2) are independently reproduced, not just
re-read — CAPI-1 by re-running the suite and capturing the live `crossref_degraded` stderr, CAPI-2
by isolating `groupCrossRefs` and observing the 2-into-1 collapse plus the wrong `verse_id`/label
directly. CAPI-1 is the standout: it means the loader test file's 19 passing tests assert nothing
real about crossRefs success, which should block merge on its own — a broken `getCrossReferences`
return shape in production would pass this suite unchanged. CAPI-2 should be fixed once, tracked
under CCOR-1 (correctness.md), not duplicated as two open items. CAPI-3 stays material because the
api-contract role's entire mandate is pinning exact shapes per amendment 11, but the fix is not
obviously "change the code" — `votes: number` in the amendment is arguably wrong given the code's own
documented null-votes case for legacy edges, so resolving CAPI-3 requires either stripping `total`
and updating the amendment's nullability, or both; flagging it material rather than risky keeps that
decision from being silently dropped. CAPI-4, CAPI-5, and CAPI-7 are downgraded from "generic missing
test" to material on their merits: totals feed a named UX contract (amendment 10), the UNION ALL
claim is a documented-but-false pin (amendment 14), and collection_id is the sole mechanism
separating two data collections that must never cross-contaminate. CAPI-6 is the one genuine
downgrade — real and worth a follow-up test, but it gates row count, not data shape or routing, so it
doesn't carry the same blocking weight as the others.

## correctness
# CODE-ADVERSARIAL / correctness — tske-cross-references

Adversarial pass against `docs/features/tske-cross-references/reviews/code-panel/correctness.md`
(CCOR-1/2/3). Re-read `packages/scripture/src/crossrefs.ts`, `scripts/ingest-openbible-refs.mjs`,
and `apps/web/app/routes/scripture.tsx` directly rather than trusting the panel write-up; traced
each claim against the actual SQL/JS rather than the panel's prose summary. Context: live
`openbible` ingest has not run — CCOR-2/3's live frequency is unverified, but both are argued from
static code paths that don't depend on the ingest having happened.

**CCOR-1 verification.** Direct trace of `groupCrossRefs` (`crossrefs.ts:89-105`) confirms the claim
exactly, and finds it slightly worse than stated. The dedup key
`` `${r.direction}:${r.range_start ?? r.verse_id}` `` uses `range_start`, which per the SQL/ingest
comments is always the *target* range's start — for `direction: 'incoming'` rows, `r.verse_id` is
the *source* (citing) verse and is the only field that actually identifies the row. Two distinct
citing verses whose ranges share the same `range_start` (target-side) collapse to one card. Worse:
the surviving card's `verse_id` field (line 97, `r.range_start ?? r.verse_id`) and its label
(line 98, `rangeLabel(r.reference, r.range_start ?? r.verse_id, r.range_end)`) both key off the same
wrong value — a "Referenced by" card's link target becomes a verse in the *reader's own chapter*
(the target range start), not the citing verse, so the click navigates to the wrong book entirely
while the label text (built from the citer's `reference` string, spliced with the target range's
book/chapter/verse via `splitId`) is internally incoherent. Outgoing rows are unaffected — the SQL's
`e.to_id = e.metadata->>'range_start'` filter (line 50) already pre-selects one representative row
per range before `groupCrossRefs` ever sees it, so `r.verse_id === r.range_start` there by
construction. Independently reproduced by `code-panel/api-contract.md` CAPI-2 (High) via a concrete
2-rows-in/1-card-out repro, which corroborates without my needing to re-derive it. No credible
downgrade argument exists: this is a data-shape bug that fires for any Bible verse that is the
middle/end of a multi-source-cited range, which the panel correctly notes is a normal pattern at
614k edges, not an edge case.

**CCOR-2 verification.** Traced the interaction across two files. `buildEdgeRows`
(`ingest-openbible-refs.mjs:73-77`) sets `rangeStart = targets[0]` — the first expanded target —
without excluding the case where that target equals the citing `from_id`. `dedupeEdgeRows`
(`:100-112`) then unconditionally drops any row with `from_id === to_id` as a self-ref, with no
special case for a row that happens to be a range's designated representative. Downstream, the
outgoing SQL branch (`crossrefs.ts:50`) *requires* a surviving row with `to_id = range_start` to
represent the range at all — if that specific row was the dropped self-ref, no substitute is
promoted (e.g. to the next-lowest surviving `to_id`), so the entire range disappears from the
References panel even though its other member edges remain in `lumen.edges`. This is a genuine
mechanism-level bug, not a hypothetical: the code-panel's own dry-run stats (cited in its intro)
report **67 self-refs** across 614,209 edges, so the precondition (self-refs existing in the real
corpus) is empirically confirmed at nonzero count; only the *range-starting* subset of those 67 is
unquantified pre-ingest. Separately: the code-panel's "Notes on severity" section mislabels its own
elaboration — the paragraph headed "**CCOR-3**" (discussing the 67 self-refs and recommending a
before/after range-representative query) is entirely about the CCOR-2 mechanism; CCOR-3 (the
out-of-range `?verse` query) never gets its own elaboration. Flagging this so whoever runs the
panel's suggested verification query doesn't file it under the wrong finding.

**CCOR-3 verification.** Confirmed via `scripture.tsx`: `loadCrossRefs` is invoked whenever
`requestedVerse !== null` (line ~361, inside the loader's `Promise.all`), which only checks that the
`?verse=` param parsed as a positive integer (`parseVerseParam`, lines 154-159) — it does not check
that the number is within the current chapter's verse count. `selectedVerse` (lines 372-375) applies
that membership check afterward, and `crossRefs` is set to `null` when it fails (line 377), so an
out-of-range `?verse` still pays for a full Postgres query (and, if `cards.length === 0`, a
`crossref_empty` log at lines 138-140) whose result is then thrown away. Real and exactly as
described. Blast radius is narrow: no incorrect data ever reaches the UI (the discarded promise
means the panel correctly shows nothing selected), so this is a resource-waste and
observability-hygiene issue, not a data-correctness one. It does have one real downstream
consequence worth keeping on the books: the code's own comment at line 139 says the `crossref_empty`
log exists specifically so OBS-7 can distinguish "a Bible verse with zero refs" (rare) from a
pipeline bug — a scanner or stale link probing `?verse=999` repeatedly would inject false
`crossref_empty` events into that signal, degrading its usefulness without anyone touching real
cross-reference data.

## Table

| ID | Tag | Rationale (≤25 words) |
|---|---|---|
| CCOR-1 | material | Confirmed: incoming cards keyed *and* linked by target `range_start`; navigation goes to the wrong book. Corroborated independently by CAPI-2. |
| CCOR-2 | material | Confirmed mechanism (self-ref drop removes a range's sole representative row); 67 real self-refs in dry run make the precondition non-hypothetical. |
| CCOR-3 | risky | Confirmed wasted query + discarded result; real but non-corrupting — only downside is `crossref_empty`/OBS-7 log-signal pollution from adversarial `?verse` values. |

## Stance

CCOR-1 is undisputed and independently corroborated — it stays material with no downgrade argument
offered. CCOR-2 is upgraded in confidence, not just upheld: the panel's own dry-run numbers (67
self-refs at 614k edges) turn "architecturally demonstrable" into "empirically nonzero," so it
belongs alongside CCOR-1 as a merge-blocking fix rather than a nice-to-have, and the panel's
"Notes on severity" mislabeling should be corrected so the pre/post-ingest verification query lands
under the right ID. CCOR-3 is the one finding I'd keep off the blocking list: it is real and worth a
one-line gating fix, but its only externally visible effect is noise in a diagnostic log, not
incorrect data or a broken link.

## data-integrity
# CODE-ADVERSARIAL / data-integrity — tske-cross-references

Adversarial pass against `docs/features/tske-cross-references/reviews/code-panel/data-integrity.md`
(CDATA-1/2/3). Re-read `scripts/ingest-openbible-refs.mjs` and `scripts/smoke-openbible.mjs` in
full; independently re-derived each claim rather than trusting the panel write-up.

**CDATA-1 verification.** Ran an independent scan of the vendored
`data/openbible/cross_references.txt` (344,799 rows): grouped by `from`, counted range vs. single
`to` targets, and checked exact raw `(from,to)` duplicate pairs — 0 exact-duplicate raw pairs,
consistent with the panel's fuller (OSIS-expanded) zero-collision scan cited in the task context.
Confirms the empirical premise: nothing fires today. Read `dedupeEdgeRows` (`:99-112`) directly —
the `byPair` Map keys strictly on `${from_id}\t${to_id}` post-expansion and keeps only the
higher-`votes` row wholesale (including its `metadata`), so any future collision between a range
and an overlapping single verse (or two overlapping ranges) *does* silently discard the loser's
`range_start`/`range_end`, exactly as the panel traced through the `Ps.148.4-5` / `Ps.148.5` example.
No unit test or in-tx invariant exists to catch a future recurrence — `buildEdgeRows` and
`dedupeEdgeRows` are exported and unit-testable but no test covers this overlap case (checked
`scripts/__tests__/openbible.test.mjs`... no such collision case present). Structural gap confirmed
real; blast radius is bounded to a future OpenBible.info data refresh, not the impending ingest.

**CDATA-2 verification.** Read `scripts/smoke-openbible.mjs:90-93` directly:
`check('legacy curated refs intact for 1 Nephi 3:7', legacy.n >= 0, ...)` where `legacy.n` is a
`count(*)::int`. Postgres `count(*)` cannot return a negative integer, so `legacy.n >= 0` is
true by construction for every possible result including `0` (i.e., total data loss on the legacy
`phase-b` collection passes silently). This smoke script is the explicit pre-deploy gate — the
ingest script's own header states the ingest runs against prod *before* the web deploy, and
`smoke-openbible.mjs`'s docstring says run it after ingest and before deploy. A tautological check
sitting in that gate is a live defect today, not a future-conditional one: it provides zero
protection right now, independent of whether live ingest has run. Independently converges with
observability's COBS-1 (same line).

**CDATA-3 verification.** Read the `ON CONFLICT (id) DO UPDATE SET` clause
(`scripts/ingest-openbible-refs.mjs:189-194`): `tier`/`category` are absent from the `SET` list
while present in the `INSERT` column list. Confirmed against `packages/scripture/src/schema.ts`
that both columns are real, `NOT NULL`, non-generated columns on `lumen.collections` — this is an
actual upsert-completeness gap, not a schema misunderstanding. Checked whether it can ever bite:
`'app'` and `'cross-references'` are inlined string literals in this script, so a same-code re-run
never needs to correct them — the gap only matters if a future edit changes either literal while an
existing `openbible` row survives from before that edit, in which case the column silently keeps
its stale value forever (no error, no log signal). Verified live risk is genuinely near-zero today,
consistent with the panel's own "cosmetic at current scale" caveat.

## Table

| ID | Tag | Stance vs. code-panel | Rationale (≤25 words) |
|---|---|---|---|
| CDATA-1 | risky | uphold (Medium) | Re-scan confirms zero live collisions; dedup's metadata-loss on range/single overlap is real but unguarded only against a future data refresh. |
| CDATA-2 | material | uphold (High) | `legacy.n >= 0` is a tautology by construction — the pre-deploy smoke gate provides zero legacy-data-loss protection today, not conditionally. |
| CDATA-3 | risky | downgrade-leaning (kept, not noise) | Upsert omits tier/category from SET; verified inert while values stay literal constants, but silently stale if either literal ever changes. |

## perf-obs-ux
# CODE-ADVERSARIAL — performance / observability / ux-a11y — tske-cross-references

Adversarial pass over `reviews/code-panel/{performance,observability,ux-a11y}.md`. Every
finding below was re-derived from source, not taken on the panel's word: `crossrefs.ts`,
`scripts/ingest-openbible-refs.mjs`, `scripts/smoke-openbible.mjs`, `scripts/setup-indexes.sql`,
`apps/web/app/routes/scripture.tsx`, `apps/web/app/lib/db.server.ts`,
`scripts/__tests__/openbible.test.mjs`, `scripts/migrate-canon-spine.mjs`,
`scripts/smoke-canon-spine.mjs`, and `docs/features/tske-cross-references/plan.md`, against the
stated context (0 users, ~614k edges post-ingest, max verse fan-out ~2,000, live ingest not yet
run).

## Performance

**Stance:** No blocking issues. All 6 findings verified accurate against code; the panel's own
severities already tell the real story — CPERF-1/4/5/6 are confirmed-but-inert at current scale,
CPERF-2 is a real but low-impact asymmetry, and CPERF-3 is the one item worth an explicit human
check before the still-pending live ingest.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| CPERF-1 | noise | Confirmed unindexed sort-before-LIMIT (`crossrefs.ts:44-64`); panel itself concludes no fix needed at ~2k max fan-out. |
| CPERF-2 | risky | Confirmed: `idx_edges_from_rel` exists, no `idx_edges_to_rel` (`setup-indexes.sql`); smoke only EXPLAINs outgoing. Negligible cost today (1 rel_type, 2 collections). |
| CPERF-3 | material | Confirmed single 2-4min write-locking tx (`ingest-openbible-refs.mjs:187-227`); live ingest hasn't run — timeout check is a real pending action. |
| CPERF-4 | noise | Heap math checks out (~614k × ~200-350B ≈ 150-250MB); one-time local/CI run, no `--max-old-space-size` needed. |
| CPERF-5 | noise | Confirmed chapters join runs exactly once at ingest start (`ingest-openbible-refs.mjs:149-156`); correctly scoped non-issue. |
| CPERF-6 | noise | Confirmed 6-way `Promise.all` vs pool `max:5` (`scripture.tsx:343-364`, `db.server.ts:32`); worst case one queued query, trivially small. |

## Observability

**Stance:** The most consequential table. Four material findings all trace to the same theme —
the pre-launch verification surface (smoke checks, dry-run logs, boundary tests) has real,
verified gaps right at the moment they matter most, since the live ingest has not run yet.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| COBS-1 | material | Confirmed `legacy.n >= 0` (`smoke-openbible.mjs:93`) — `count(*)` is never negative; the hybrid legacy-path guard can never fail. |
| COBS-2 | material | Confirmed 2 `VERSIFICATION_EXCEPTIONS` entries (`ingest:28-31`) but smoke only canaries 3John (`smoke:68-71`); Rev.12.18→rev-13-1 ships unverified. |
| COBS-3 | material | Confirmed dry-run throw (`ingest:222`) precedes `tx_done` log (`:223`); `ingest_done`'s `edges` field is post-dedupe count, not deleted/inserted. |
| COBS-4 | material | Confirmed ratio/cap check inlined in `main()` (`ingest:177-181`), untested; plan.md:153 explicitly requires a boundary-value unit test (amendment 7). |
| COBS-5 | risky | Confirmed `crossref_degraded` (`scripture.tsx:144-148`) omits `elapsedMs`/split book-chapter vs `graph_degraded`; `verse` id already encodes both, so real loss is modest. |
| COBS-6 | risky | Confirmed `postgres()` outside try/catch in `ingest:142`/`smoke:19`. "Mirrors migrate-canon-spine.mjs" is wrong — that file wraps it; only `smoke-canon-spine.mjs` shares the gap. |
| COBS-7 | noise | Confirmed: `openbible_unmapped_refs` rounds via `toFixed(5)` (`ingest:174`), `openbible_unmapped_threshold` logs raw float (`:178/181`). Cosmetic only. |
| COBS-8 | noise | Confirmed `dataFile: 'data/openbible/cross_references.txt'` literal (`ingest:130`) duplicates `DATA_FILE` const (`:21`). Real DRY gap, zero functional impact. |

## UX / A11y

**Stance:** All three findings verified as real, code-confirmed defects, not review artifacts.
CUX-1 is the sharpest — it doesn't just miss an a11y requirement, it inverts the one the plan
explicitly called out (A11Y-2).

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| CUX-1 | material | Confirmed `aria-live` on synchronous `CrossRefsSection` (`scripture.tsx:956`); the actually-streamed `Connections`/`EntityChips` (via `Await`, `:869-871`) has none. |
| CUX-2 | material | Confirmed fixed 1-block/2-card `CrossRefsSkeleton` (`:889-904`) vs real 0-2-group/0-40-card output; `isPending` (`:455`) fires it on every same-chapter nav. |
| CUX-3 | material | Confirmed plan.md:171 says credit sits "under the References header"; code (`:973-995`) renders it after BOTH groups, under "Referenced by." |


## security
# CODE-ADVERSARIAL / security — tske-cross-references

Adversarial pass against `docs/features/tske-cross-references/reviews/code-panel/security.md`
(CSEC-1..5). Re-read `scripts/ingest-openbible-refs.mjs`, `scripts/smoke-openbible.mjs`,
`packages/scripture/src/crossrefs.ts`, and `scripts/setup-triggers-and-rls.sql` in full, plus their
siblings (`scripts/migrate-canon-spine.mjs`, `scripts/smoke-canon-spine.mjs`,
`scripts/ingest-phase-a.ts`, `apps/web/app/routes/scripture.tsx`,
`packages/scripture/src/queries.ts`, `scripts/setup-readonly-role.sql`) rather than trusting the
panel write-up.

**CSEC-1 verification.** Confirmed line-accurate: in both scripts, `.env` read → `DATABASE_URL`
extraction → port check → `postgres()` client construction all run before the `try {}` that ends in
`catch (err) { ...scrub(err.message)... }`. Checked the "mirrors pre-existing gap" claim against
both true siblings rather than accepting it: `smoke-canon-spine.mjs:11-17` has the *identical*
unwrapped pattern — `smoke-openbible.mjs` is a faithful structural copy, claim holds there.
`migrate-canon-spine.mjs` is different: its `main()` wraps exactly this step (`loadAdminUrl()` +
`postgres(...)`) in its own `try { ... } catch (err) { log(...scrub(err.message)...); }`
(`:168-176`). So `ingest-openbible-refs.mjs` does *not* mirror its nearest sibling — it drops a
protection that sibling already has. The panel's softening framing is half-true and, if anything,
undersells the ingest-script instance.

**CSEC-2 verification.** Confirmed: `data/openbible/README.md` records source URL, download date,
and license, but no hash. Confirmed the file is gitignored (`git check-ignore -v` hits `.gitignore:14
data/`) — not version-controlled, so there's no independent commit-history integrity trail either.
Weighed against actual blast radius: ingest already has a structural tripwire independent of any
checksum — `UNMAPPED_CAP` aborts the whole run (exit 1, no commit) if >0.5% of source rows fail to
parse/resolve (`ingest-openbible-refs.mjs:23,177-180`), and `smoke-openbible.mjs` asserts an exact
row-count floor and specific known edges post-ingest. A corrupted or truncated substitute file is
very likely caught functionally even with zero cryptographic verification; a *silent*,
structurally-valid tamper is the only gap left, and the threat model (single admin, own laptop, own
file) has no plausible actor for that.

**CSEC-3 verification.** Went looking for the "public-collections allowlist other flows enforce"
the panel cites, rather than accepting it as asserted — it's real:
`packages/scripture/src/queries.ts:161-165` exports `getPublicCollectionIds` (`SELECT id FROM
lumen.collections WHERE public = true`), and it's actually imported and called in the very same
route file, `scripture.tsx:347`, to gate the graph-panel's collection set. `getCrossReferences`
(`crossrefs.ts:33-71`) sits in the same file/route neighborhood and takes `collectionId` as a bare
opaque string with no equivalent check. Traced every call site: `scripture.tsx:134` sets
`collectionId` from a ternary over two inlined literals (`"openbible"` / `"phase-b"`) — never from
request input — so there is no exploitable path today. This is a real, concretely-sourced
inconsistency with an established sibling convention, not a speculative worry, but current
exploitability is genuinely zero.

**CSEC-4 verification.** Confirmed the SQL exactly: `edges_public_read`/`collections_public_read`
are both `USING (true)` (`setup-triggers-and-rls.sql:37-43`). Confirmed `lumen_read`
(`setup-readonly-role.sql`) is a plain `LOGIN` role, not the table owner/superuser, so RLS actually
binds it — this isn't a moot policy. Confirmed scope via `git diff main...HEAD --
scripts/setup-triggers-and-rls.sql`: empty diff, this branch touches nothing in this file. The
finding is accurate and non-trivial but is entirely pre-existing infrastructure this feature neither
introduces nor worsens in kind — it does add ~345k new rows that ride on the existing gap, but that's
a volume change, not a new mechanism.

**CSEC-5 verification.** Confirmed: the `openbible` INSERT (`ingest-openbible-refs.mjs:189-194`)
column list omits `public`. Confirmed against `scripts/ingest-phase-a.ts:154` (`CREATE TABLE
lumen.collections`) that the column is `public BOOLEAN DEFAULT true NOT NULL`. Default and intent
match exactly — this collection is meant to be public (CC BY 4.0 data, no `owner_id`). Implicit
reliance on a default is a legitimate style nit but has no daylight between current behavior and
correct behavior.

## Table

| ID | Tag | Stance vs. code-panel | Rationale (≤25 words) |
|---|---|---|---|
| CSEC-1 | material | uphold, sharpened (Medium) | Confirmed in both scripts; "mirrors sibling" holds only for smoke — `migrate-canon-spine.mjs` already scrubs this step, so ingest regresses, not mirrors. |
| CSEC-2 | noise | downgrade | Verified true (no checksum, gitignored file) but `UNMAPPED_CAP` + smoke row/edge assertions already catch corruption functionally; no plausible tamper actor in a single-admin threat model. |
| CSEC-3 | risky | uphold (Low) | Verified concrete: `getPublicCollectionIds` is a real sibling allowlist used in the same route for the graph panel and skipped here — zero exploitability today since both callers hardcode literals. |
| CSEC-4 | out-of-scope | uphold, rescoped | RLS gap confirmed real and non-trivial (`lumen_read` isn't exempt) but `git diff` confirms zero touch to this file on this branch — pre-existing infra, not this feature's regression. |
| CSEC-5 | noise | downgrade | Confirmed omitted from INSERT, but schema default (`public DEFAULT true`) exactly matches intended state for this collection — no gap between current and correct behavior. |

