# Aggregated panel-2 — canon-spine

## api-contract.md

# Panel 2 / api-contract ADVERSARIAL review — canon-spine plan

Verified against `packages/scripture/src/queries.ts` (13 exports, counted directly),
`packages/scripture/src/resolve-reference.ts`, `apps/web/app/routes/book.tsx`,
`apps/web/app/routes/scripture.tsx`, `packages/scripture/src/__tests__/spine-queries.test.ts`,
and `docs/design/canon-spine.md`.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| API-1 | material | Confirmed: harness only exercises volume/book (`spine-queries.test.ts` L63). Verse case (`resolve-reference.ts` L77) spreads `VERSE_COLUMNS`, incl. columns P4 drops, straight to JSON, untested. |
| API-2 | material | Confirmed: Scope §3 names exactly 7 of 13 exports (counted). `getVersesByChapter` — every chapter load (`scripture.tsx` L298) and every MCP chapter resolve (`resolve-reference.ts` L58) — is absent from both list and harness. |
| API-3 | risky | Confirmed `getEntity(bookId)` supplies the name (`book.tsx` L30); design doc deprecates book/volume entities at P4. No `getBook`/`getVolume` proposed — a forward drift risk, not an immediate break (query still succeeds post-migration). |
| API-4 | material | Confirmed `getVerseById`/`getVerseByReference` share the same dropped-column `VERSE_COLUMNS` fragment, back the verse/unknown MCP paths, and are absent from both Scope §3 and the harness — same unmitigated class as API-1. |
| API-5 | risky | Confirmed no shape test for `getPassage`/`searchScriptures` despite correct enumeration. Partially mitigated by P3's row-for-row smoke diff (Failure Mode 6), unlike API-1/API-4 which have no compensating control. |
| API-6 | noise | Confirmed 3 exports (`getEntity`, `getChapterArt`, `getPublicCollectionIds`) unlisted, but none touch spine tables/dropped columns — no functional risk, pure documentation completeness. |
| API-7 | noise | `tokenize.ts` doesn't exist yet (harness-first, pre-implementation); `ingest-words.mjs` is a plain `.mjs` script, so a TS-only named type has no actual runtime consumer to protect. |
| API-8 | noise | Self-limiting: the finding itself calls the current approach "acceptable," and its proposed fix duplicates API-1's ask (exact-field-set assertions) rather than adding new action. |

## Stance

The specialist's central claim survives literal verification: Scope §3 names exactly 7 of
`queries.ts`'s 13 exports (`getAllBooks`, `getBooksByVolume`, `getChapterNumbers`,
`getVolumeList`, `getChapterSummary`, `searchScriptures`, `getPassage`), and the omitted
`getVersesByChapter` is demonstrably the hottest query in the system — it fires on every
`/scripture/:book/:chapter` load (`scripture.tsx` L298) and every MCP `chapter`-level
`resolveReference` call (`resolve-reference.ts` L58), while filtering directly on
`book_id`/`chapter_number`, both slated for the P4 drop. That is API-2, and it is material.

API-1 and API-4 are the same root defect from two angles (verse-shape MCP leakage; the two
verse-lookup functions sharing the doomed `VERSE_COLUMNS` fragment) and share the same
unmitigated exposure: nothing in the current harness or Failure-modes table catches a
`VERSE_COLUMNS` break before P4 ships, since `spine-queries.test.ts` never exercises
`chapter`/`verse`-level `resolveReference` or the two verse-getters directly. Both are
material and, per instructions, survive as correctness-class findings regardless of any
downgrade instinct.

API-3 and API-5 are real, verified gaps but softer than the above: API-3 doesn't break
anything today (entities table isn't deleted, just deprecated-in-place) so it's a drift
risk rather than a guaranteed regression; API-5's functions are correctly enumerated and
have a compensating control (P3's live row-diff smoke) that the API-1/API-4 class lacks.
Both downgraded to risky.

API-6/7/8 are accurate but non-actionable: API-6's three orphaned exports don't touch any
column the migration changes; API-7 speculates about a TS type for a file that doesn't
exist yet, consumed only by a non-TS script; API-8 explicitly self-certifies the status
quo as acceptable while duplicating API-1's fix. All three tagged noise — true statements,
zero blast radius.

Net: keep API-1, API-2, API-4 as blocking; fold API-3/API-5 in as follow-up-gated (getBook/
getVolume export, plus the two missing shape tests); drop API-6/7/8 from the action list.

## correctness.md

# Panel 2 — Adversarial Correctness Review — Panel 1 correctness.md (canon-spine)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| COR-1 | material | Confirmed: `queries.ts` L48-49 reads `chapter_number` directly; plan/Scope never names the P4-safe join replacement. High severity survives. |
| COR-2 | material | Confirmed: `spine-queries.test.ts` tests only volume/book `resolveReference`, never chapter/verse, `getPassage`, or `searchScriptures`, despite FM-7's claim. |
| COR-3 | material | Confirmed: `searchScriptures` L61-70 filters on `verses.volume_id`, a P4-dropped transition column; no join path specified anywhere in scope/design. |
| COR-4 | material | Confirmed: both `diffQueryParity` cases (canon-spine.test.mjs L23-29) are same-order; no permuted-equal case exists to catch ts_rank-tie false positives. |
| COR-5 | material | Design doc L68 states "nothing derivable stored," yet L43 stores `chapters.verse_count` NOT NULL with no reconciliation or recompute rule. Real contradiction. |
| COR-6 | risky | Real gap, but citation (queries.ts L106) supports OD-as-book, not id collision; collision implausible under current human-curated slug conventions. |
| COR-7 | material | Confirmed: scripture.tsx L558-560 renders `chapter+1` link unconditionally; plan commits to "real bounds" but never names the source query. |
| COR-8 | risky | Confirmed test gap (no `--`/bracket/pilcrow cases), but corpus is gitignored SQLite dump — can't confirm these chars occur in source text. |
| COR-9 | material | Confirmed: no failure mode (1-10) checks summary `metadata.chapter_id` resolves to `lumen.chapters`; orphan stamping would silently return null. |

## Stance

Panel 1's correctness review holds up well under adversarial re-verification: 7 of 9 findings are **material** — each was checked directly against `queries.ts`, the three harness files (`spine-queries.test.ts`, `canon-spine.test.mjs`, `tokenize.test.ts`), `scripture.tsx`, and the design doc's exact wording, and each is a real, present gap (not speculation about unwritten code) with an actionable, proportionate fix. Notably COR-5 was flagged for extra scrutiny (challenges a human-approved design doc) and survives on the merits: the design doc's own words — "Nothing derivable stored" (L68) alongside a stored `verse_count NOT NULL` column (L43) with no recompute/reconciliation rule — is a genuine, textual self-contradiction, not a nitpick.

Two findings are downgraded to **risky**: COR-6's underlying concern (no id-collision invariant between `books.id`/`chapters.id`) is real and ties to the plan's own open "lumen.nodes" question, but panel-1's supporting code citation doesn't actually back the claim, and collision requires an implausible human-authoring accident under current slug conventions — plausible, not demonstrated. COR-8's harness gap is confirmed (no `--`/bracket/pilcrow test cases), but the actual scripture corpus lives in a gitignored SQLite dump inaccessible to verification, so whether those characters occur in-corpus is asserted, not shown.

No findings were tagged noise or out-of-scope — every item traces to a concrete file/line and a concrete, checkable claim about this feature's own plan, design, or harness.

## data-integrity.md

# Panel 2 — ADVERSARIAL Review — Panel 1 Data Integrity (canon-spine)

Verified against `scripts/ingest-phase-a.ts`, `scripts/backfill-neo4j-collections.mjs`,
`docs/design/canon-spine.md`, `docs/features/graph-view/{plan.md,retro.md,reviews/code-adversarial/data-integrity.md}`,
and `docs/punch-list.md`.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| DATA-1 | material | Real open question (design.md flags it too), but "Critical/1,582 drifted" premise unverified — `chapterId()` matches derived spine format by construction; keep as pre-migration decision item, not confirmed-today bug. |
| DATA-2 | material | Verified true: spine drops collection_id; `backfill-neo4j-collections.mjs:181-182` already hardcodes `cid:'canon'` for verses — book/chapter/volume need identical treatment post-migration. |
| DATA-3 | material | Sound forward guidance for an unwritten script; join-based backfill is strictly safer than independent string concat, cheap to adopt now. |
| DATA-4 | material | Verified: `VOLUME_CANON` (ingest-phase-a.ts:69-75) only ever yields `bible`/`restoration`; design.md's own comment promises `hebrew`\|`christian`\|`restoration`. Real self-inconsistency. |
| DATA-5 | material | Verified against plan.md FM#9 text ("one id of each kind"); legitimate weak-smoke critique independent of DATA-1's severity. |
| DATA-6 | noise | Contradicted by repo evidence: `od-1-2` sample id + bugs.md #9/#10 show `'od'` is one book with 2 chapters, not two colliding source rows. No upsert collision occurs. |
| DATA-7 | risky | Technically true, but plan.md FM#8 already accepts this exact window by design ("interrupted runs converge") — self-heals on re-run, same pattern as graph-view's risky-tagged concurrent-race finding. |
| DATA-8 | material | Verified against plan.md's own contract text ("abort with a named check"); Scope §1 doesn't enumerate this check. Low-cost, correctly scored Low. |

## Stance

**DATA-1's severity is inflated by an unverified premise, but the underlying question is real and should stay actionable, not be waved off.** The claim "1,582 chapter entities may have ids ≠ derived `{book}-{n}`" doesn't survive contact with `ingest-phase-a.ts`: `chapterId(bSlug, c.chapterNumber)` builds `{bookSlug}-{chapterNumber}` using the *same* `bookSlug()` call the verses loop uses for the same book, so Postgres chapter-entity ids are byte-identical to what the spine's `GROUP BY book_id, chapter_number` derivation would produce — no drift by construction. The one *confirmed* chapter-id drift in this system is on the Neo4j side (`X-ch-N` vs `X-N`), and it is (a) already scoped out of this feature by plan.md itself ("Neo4j chapter-id alignment — separate cleanup"), and (b) explicitly characterized by `docs/punch-list.md` as "join miss, cosmetic today" — a missing collection_id stamp, not an orphaned edge. This is the exact failure mode the graph-view retro warned about by name ("two specialists reasoned from scripts the live graph predates... and reached wrong conclusions") — panel-1 reasoned from design.md prose rather than checking whether the drift it names actually exists in the table it's about. That said, I'm not downgrading past material: design.md itself flags the `lumen.nodes` view definition as an "Open design question for panels," P4 keeps deprecated structural entities in place (not deleted) specifically to avoid breaking existing edges, and the punch-list's own "Add art" item plus the design's Strong's/TSK fast-follows will produce chapter-level edges soon. The recommended fix (literal union, always include deprecated rows) is correct and nearly free — worth locking in now on architectural grounds, just not framed as "edges silently orphan today."

**DATA-6 is a confirmed miss, not a hedge.** `docs/features/web-app-wiring/bugs.md` bug #9 references a real graph id `od-1-2` and states the ingest map "already contains `'Official Declaration': 'od'`" as a *working* single-book mapping; bug #10 describes the surviving problem as `getBooksByVolume` hiding this one legitimate `od` book from listings — not two source rows upserting over each other. The LDS-scriptures source models both Official Declarations as one book ("Official Declaration") with two chapters, not two same-titled books; panel-1's upsert/last-write-wins mechanism doesn't apply. This is the plan's own named "od trap," but it's a filtering-heuristic bug, not a collision bug — panel-1 misattributed the mechanism.

**DATA-7 downgraded to risky, not dropped**, on the same "self-heals" logic the graph-view panel-2 already applied to an analogous concurrent-write gap (tagged risky there): plan.md FM#8 makes idempotent re-run convergence the explicit accepted contract for interrupted words ingest, so the harm DATA-7 describes is a designed, bounded window, not a defect.

**Net**: 6 material, 1 risky, 1 noise, 0 out-of-scope. DATA-2 and DATA-4 are the strongest items — both are verified, present-tense, cheap-to-fix contract gaps. DATA-1 stays material but its rationale/fix text should be rewritten to cite the real (Neo4j-side, already-scoped, cosmetic-today) drift rather than an unverified Postgres-side one, so the plan doesn't chase a bug that isn't there while under-selling the real open design question.

## migration-safety.md

# Panel 2 — Adversarial Review of Panel 1's Migration Safety Review (canon-spine)

Verified against `apps/web/.env` / `.env.example`, `scripts/setup-readonly-role.sql`,
`docs/design/canon-spine.md`, `docs/features/canon-spine/plan.md`, `.gitignore`,
and prior ingest scripts (`ingest-phase-a.ts`, `backfill-phase-b.ts`,
`backfill-neo4j-collections.mjs`).

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| MIG-1 | material | Confirmed: `apps/web/.env` carries only `lumen_read` (SELECT-only per `setup-readonly-role.sql`); no root/admin `.env` exists, `.env` is gitignored. Real DDL blocker. |
| MIG-2 | material | Confirmed: Supavisor 5432=session, 6543=transaction; Supabase itself warns against transaction-mode for DDL. Current `.env` uses 5432 by luck, script has no assertion. |
| MIG-3 | risky | Overstates cost: P1 is one atomic transaction (design.md) — bad state can't commit; words table is currently empty, so "1.2M-row re-ingest" conflates not-yet-run work with data loss. Cheap `pg_dump`/PITR note still worth adding, but not blocker-grade given 0 users + re-ingestable source. |
| MIG-4 | material | Confirmed gap: plan.md line 83 asserts `--dry-run` with zero mechanics specified — real ambiguity, real consequence (false confidence or accidental prod execution). |
| MIG-5 | risky | Valid in principle, but no cron/multi-actor trigger exists in this repo — single developer runs one script at a time by design. Worth naming, not urgent. |
| MIG-6 | risky | Core claim is wrong: Postgres `SET NOT NULL` does not error on rerun, and P1's one-transaction design (design.md) means partial-failure state can't exist to rerun against. Real gap is `ADD COLUMN` needing `IF NOT EXISTS`, already implied by plan's own "IF NOT EXISTS + upserts" contract. |
| MIG-7 | material | Confirmed precedent: `backfill-neo4j-collections.mjs` uses `BATCH_SIZE=2000`. Plan states none for a 1.2M-row ingest over the Supabase pooler — concrete, actionable gap. |
| MIG-8 | material | Real gap confirmed: Files touched lists one migration script for all P1–P4, no flag/marker named. Note: the "true point of no return" quote does not appear verbatim in plan.md or design.md — panel-1 paraphrased as a direct quote; docking for sloppy attribution, not for the underlying finding. |
| MIG-9 | risky | Confirmed precedent (`log()`, `scrub()`, `exitCode = 2` in `backfill-neo4j-collections.mjs`) is real and the ask is cheap, but correctly scored Low by panel-1 — polish, not a safety gate. |

## Stance

Panel-1's table holds up well under adversarial pressure — five of nine items
(MIG-1, 2, 4, 7, 8) are verified, concrete, and correctly targeted; I'd ship
fixes for all five as written. MIG-1 is real and correctly the sole Blocker:
`apps/web/.env` (the only credential on this machine) is provably read-only,
`.env` is gitignored so nothing is "hiding" elsewhere, and DDL cannot run
without a privileged path — keep it Blocker, keep it gating.

The one place panel-1 reasoned reflexively rather than honestly is MIG-3.
"No backup" reads as an obvious High-severity gap only if you ignore two
things the design doc itself states: P1 is a single atomic transaction (so a
bad backfill rolls back completely — it can't partially corrupt live data),
and the words table this "costly re-ingest" refers to is *currently empty*
(§Schema: "rebuild of the empty table"). The real exposure is narrow — the
`verses.chapter_id` backfill inside P1 — and that's exactly the piece already
protected by transactionality plus the plan's own in-transaction invariant
aborts. Given 0 users, one developer, and a fully re-ingestable LDS
Documentation Project source, a backup step is good hygiene (cheap, add it)
but not a load-bearing safety gate; I downgraded it to risky rather than
letting the panel's "High" stand unchallenged.

MIG-6 has a factual error at its core (Postgres does not error on a repeated
`SET NOT NULL`, and the one-transaction design means there's no partial-apply
state to rerun into) but the instinct — double-check every DDL statement in
the migration is rerun-safe, not just the `CREATE TABLE`s — is worth keeping
as a lightweight risky item rather than discarding outright. MIG-5 is sound
reasoning applied to a threat (concurrent ingest) that has no actual trigger
in this single-developer repo, so it's real-but-low-urgency, not blocking.
MIG-9 is accurate and cheap but correctly scoped Low already — no argument,
just doesn't carry blocking weight.

Net: panel-1's review is honest and well-sourced overall; its one failure
mode is treating "no explicit backup step" as inherently unsafe without
weighing it against the transactional design and re-ingest cost the same
plan/design docs already establish.

## observability.md

# Panel 2 — Adversarial Observability Review — Panel 1 observability.md (canon-spine)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| OBS-1 | material | No script exists yet to check field-by-field, but plan/MIG-9 never name the per-check tuple; adding name/expected/actual/pass-fail is cheap, matches backfill's `verify_nodes` shape. |
| OBS-2 | material | Confirmed backfill keeps identical event names/fields dry-run vs live (only the `SET` clause is conditional) — genuine, cheap-to-copy precedent; without parity dry-run can't sanity-check a live run. |
| OBS-3 | material | Confirmed backfill already caps samples (`mismatchSample: ...slice(0,5)`, `missingSample: ...slice(0,10)`) on prod-scale diffs; same guard on a 1.2M-row parity diff is a one-line reuse of an existing pattern. |
| OBS-4 | material | Row/batch math checks out (~1.2M rows, batches ≫100); 66-book granularity matches backfill's ~14-group `node_type_done` scale — well-calibrated, not speculative. |
| OBS-5 | material | "Match-rate logging" in design.md L90 is genuinely unshaped; a zero-token verse is a real silent index gap (search fails, text intact) and stats are cheap alongside OBS-4's per-book loop. |
| OBS-6 | noise | `smoke-canon-spine.mjs` isn't CI-wired (deploy.yml runs no smoke script) and has no partial-vs-full-failure distinction as a one-shot gate — the 0/1 vs 0/1/2 choice has no consumer to affect. |
| OBS-7 | material | Verified: `ingest-phase-a.ts` `main()` (L812) is a plain top-level `async function` — a one-line `throw` before arg parsing is trivial, and it closes a real desync-on-invocation bug, not just a logging gap. |
| OBS-8 | material | Confirmed via loader audit: all `logEvent` sites in scripture/book/home routes instrument caller-visible failure shapes unchanged by the spine rewrite — zero new calls needed; stating so is a free, scope-creep-blocking sentence. |
| OBS-9 | material | Confirmed backfill's own `backfill_start`/`backfill_done` already carry `startedAt`/`finishedAt`; identical fields on a single multi-1.2M-row transaction are a direct copy, and a stuck/slow commit is otherwise invisible. |

## Stance

Eight of nine findings hold up as **material** under adversarial re-verification, and this panel's central habit — grounding every fix in an exact, already-shipped house pattern rather than inventing new conventions — is exactly right for a low-traffic personal app: none of these are enterprise-grade telemetry asks (no metrics pipeline, no alerting, no dashboards), they are all one-JSON-line-per-event additions that mirror `backfill-neo4j-collections.mjs` almost verbatim. OBS-7 was singled out for extra scrutiny (is the runtime tombstone actually cheap?) and survives cleanly: `ingest-phase-a.ts`'s `main()` is a flat top-level function starting at L812, so a guard throw before arg-parsing is a true one-liner, and unlike the rest of the table this finding also closes an actual correctness gap (a comment-only tombstone doesn't stop a future `--write` invocation from writing pre-spine-shape rows), making it the highest-value item despite being filed under "observability." OBS-8 was checked against the actual route files (`scripture.tsx`, `book.tsx`, `home.tsx`) via direct code audit: every existing `logEvent` call instruments a failure shape the spine rewrite leaves untouched, confirming zero new calls are needed and that the ask really is free.

One finding is downgraded to **noise**: OBS-6's exit-code contract for `smoke-canon-spine.mjs`. The underlying observation (two house exit-code conventions coexist) is accurate, but the target script is never invoked by CI (`.github/workflows/deploy.yml` runs only `backfill-collections.test.mjs`, no smoke script) and, as OBS-6's own rationale states, has no partial-vs-full-failure distinction to make as a one-shot gate — so neither convention has a consumer that would behave differently. Cheap, but not consequential enough to earn material here.

No findings were tagged risky or out-of-scope: nothing asks for observability infrastructure disproportionate to a 0-user/low-traffic app, and every item traces to a file this plan explicitly touches.

## performance.md

# Performance review — adversarial (panel-2)

Panel-2 / Adversarial re-review of `docs/features/canon-spine/reviews/panel-1/performance.md`.
Re-verified against `docs/design/canon-spine.md` §Schema, `scripts/setup-indexes.sql`,
`packages/scripture/src/queries.ts`, `docs/features/canon-spine/plan.md`, and
`apps/web/app/routes/scripture.tsx`. Scale checked literally: 42k verses, 1.2M words, 0 users.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| PERF-1 | material | Verified: no `idx_verses_chapter_id`/similar exists anywhere (design doc, `setup-indexes.sql`, plan's Files-touched); hot per-verse-click path; near-free fix. |
| PERF-2 | material | Verified: today's prev/next is unconditional arithmetic (real dead-link bug); rewrite-serial-await risk is concrete and cheap to guard now. |
| PERF-3 | risky | Join replaces one indexed column, but 42k rows makes hash-join cost negligible; EXPLAIN check is fine, "keep denormalized volume_id" pre-emptive fix is likely overkill at this scale. |
| PERF-4 | out-of-scope | Word-occurrence/hover UI is explicitly listed Out in plan.md ("needs Strong's alignment first"); no query path in this feature executes an uncapped word lookup. |
| PERF-5 | material | Ambiguous "per verse batch" wording genuinely risks 42k round trips vs ~1,200 (order-of-magnitude); wording + assertion fix is essentially free. |
| PERF-6 | risky | Quoted "plan says... warn against ever scanning it" isn't literally present in plan/design docs (grep-verified); underlying view-contract gap is real but speculative/future-use. |
| PERF-7 | material | Verified: `getPassage`'s `chapter_number*1000+verse_number` trick depends on a column P4 explicitly drops; plan's "structural queries rewritten" doesn't name this ordering fix. |
| PERF-8 | risky | Valid completeness ask, but at 42k rows/0 users an N+1 costs nothing in practice; largely overlaps existing failure-mode 6 (query-parity diff). |
| PERF-9 | noise | Finding's own text concedes the migration duration "is fine at this size"; asks only for logging on a one-time, 0-user transaction — not a performance risk. |

## Stance

Panel-1's performance review holds up well on the two highest-stakes items: PERF-1 (missing
chapter_id index) is not a wrong-premise finding — I grepped the whole repo and confirmed no such
index exists in the design doc, `setup-indexes.sql`, or plan.md's Files-touched list, and the fix
is a one-line `CREATE INDEX` that costs nothing to add now. PERF-2 is similarly grounded: the live
`scripture.tsx` loader really does render an unconditional "Chapter {chapter+1}" link with no
bounds check, confirming the dead-link claim, and the serial-await risk in the rewrite is worth
guarding against before code is written. PERF-5 and PERF-7 are both concrete, verifiable technical
debts (an ambiguous batch-unit spec with 30x cost swing; an ordering trick that breaks once P4
drops `chapter_number`) that the plan genuinely doesn't resolve — both are cheap to fix now and
expensive to discover mid-migration.

Where the review overreaches is in projecting query-optimization anxiety onto a 42k-row table with
zero users: PERF-3's join concern and PERF-8's N+1 concern are real shape changes but trivial in
absolute cost at this scale, so I downgraded both to risky (worth a mention, not a gate). PERF-6
attributes a quote to the plan/design docs that isn't there — grep found nothing resembling "fine
for id lookups... warn against ever scanning it" — so while the underlying contract gap on
`lumen.nodes` is legitimate, the finding's evidentiary basis is weaker than presented. PERF-4 aims
at a feature (word-study hover UI) the plan explicitly places out of scope, with no query path in
this feature that could hit the described cost. PERF-9 is the one true noise item: it flags a
migration step the finding itself admits is performance-fine, and asks only for diagnostic logging
on a single 0-user transaction — a nice-to-have, not a performance finding.

Net: 4 material, 3 risky, 1 out-of-scope, 1 noise. Recommend blocking on PERF-1, PERF-2, PERF-5,
PERF-7 before build; take PERF-3/PERF-6/PERF-8 as review-comment follow-ups, not gates; drop
PERF-4 and PERF-9 from this feature's punch list.

## security.md

# Security review — canon-spine plan (PANEL-2 / ADVERSARIAL)

Verified against `scripts/setup-readonly-role.sql`, `scripts/setup-triggers-and-rls.sql`,
`docs/features/canon-spine/plan.md`, `docs/design/canon-spine.md`, and
`scripts/backfill-neo4j-collections.mjs` (scrub/credential precedent). Context applied:
low-traffic personal app, single developer — enterprise-grade process asks are downweighted;
concrete, verified, cheap-to-fix defects are not.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| SEC-1 | material | Verified: `ALTER DEFAULT PRIVILEGES` without `FOR ROLE` binds to the executing role only. Real break if migration connects as a different role. |
| SEC-2 | risky | No admin/DDL credential source exists anywhere in repo (checked env, scripts) — real gap, but fails loudly (permission denied), not silently. |
| SEC-3 | material | `scrub()` precedent is established and cheap (backfill-neo4j-collections.mjs); omitting it from two new scripts is an easy, real credential-leak regression. |
| SEC-4 | out-of-scope | Tokenizer input is trusted canon text (verses.text), not attacker-controlled — "injection" framing is wrong; naive-SQL breakage is a correctness bug, not a security one. |
| SEC-5 | material | Claim verified: policy-without-RLS-enabled silently no-ops in Postgres. Matches an existing 5-table repo convention; 3-line, zero-risk addition. |
| SEC-6 | material | Design doc itself flags this as an open question (Q1); `lumen.nodes` filtering vs. `getPublicCollectionIds` convention is genuinely unresolved and consumer-visible. |
| SEC-7 | noise | No real attack surface identified — `tokenize()` is a pure string splitter; worst case of misuse is a doc-comment gap, not a vulnerability. |
| SEC-8 | out-of-scope | Targets the word-study UI, which plan.md explicitly excludes from this feature ("Out": needs Strong's alignment first). Not this plan's surface. |

## Stance

SEC-1 checks out exactly as written: `ALTER DEFAULT PRIVILEGES IN SCHEMA lumen GRANT SELECT ON TABLES TO lumen_read` (no `FOR ROLE` clause) binds only to whichever role executes it, so if `migrate-canon-spine.mjs` connects under a different admin identity than whoever ran `setup-readonly-role.sql`, the app silently loses SELECT on every new spine table — this is a concrete, high-value fix regardless of the app's scale. SEC-3, SEC-5, and SEC-6 are similarly grounded in verified code/design facts (an established scrub() precedent, verified Postgres RLS-without-ENABLE behavior matching a 5-table repo pattern, and a gap the design doc itself calls out as unresolved), so all three earn `material` despite the low-stakes deployment context — they're cheap, precedent-backed, and concretely actionable. SEC-2 is real (no admin credential convention exists in this repo) but downgraded to `risky`: for a single developer, requiring the plan to pre-name an env var is closer to process than to a defect, and the failure mode is a loud permission error rather than a silent hole. SEC-4 and SEC-8 are misframed as security findings — SEC-4's "injectable" framing doesn't survive contact with the actual trust boundary (canon text, not user input), and SEC-8 targets a feature plan.md explicitly defers — while SEC-7 identifies no actual exploitable surface. Per instructions, SEC-1 and SEC-2 (both High in panel-1) survive synthesis regardless of these tags.

## ux.md

# Panel 2 — adversarial review of Panel 1 UX — canon-spine

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| UX-1 | out-of-scope | "Next book →" is a new affordance beyond bounds-check fix (FM-10); plan's contract is byte-identical URLs/nav, not new navigation surfaces. |
| UX-2 | material | scripture.tsx is already being edited for real bounds (FM-10); reusing book.tsx's `unit` logic there is cheap and closes a genuine wording bug. |
| UX-3 | material | Same file, same fix as UX-2 — once `unit` exists in scripture.tsx, unit-aware `aria-label` is a free line, correctness not polish. |
| UX-4 | material | `packages/scripture` is already being rewritten this feature; exporting one `unit` helper prevents the exact duplicated-hardcoded-check drift the feature exists to kill. |
| UX-5 | out-of-scope | Correctly self-flagged by panel 1; `verse_count` surfacing is new UI, absent from plan scope, structural-data-only migration. |
| UX-6 | risky | Valid scope-creep risk (tradition data lands "free") but the ask is a plan.md doc line, not a code deliverable — guardrail, not implementation. |
| UX-7 | noise | Restates plan's existing explicit Out-list item ("Word-study UI... needs Strong's alignment first") verbatim; no new information. |
| UX-8 | risky | Real risk (joins replace jsonb reads) but P50/P95 assertions are disproportionate for a 0-user app; a one-line manual latency check suffices for FM-6. |
| UX-9 | noise | Affirms an invariant already stated verbatim in plan's Public contract; no action requested, nothing new to track. |

## Stance

Verified against source: `scripture.tsx` nav block (lines 549–561) confirms the hardcoded "Chapter N/N+1" text and `aria-label="Chapter navigation"` cited by UX-1/2/3; `book.tsx` line 52 (`bookId === "dc" ? "Section" : "Chapter"`) and line 69 aria-label confirm the unit-derivation asymmetry cited by UX-2/3/4; `home.tsx` loader (lines 23–40) confirms today's flat `volume_id` grouping with no tradition dimension, supporting UX-6's premise. Plan's Scope-Out list (plan.md lines 57–63) does not mention home.tsx/tradition-grouping, and plan's Files-touched list (lines 65–77) already includes `scripture.tsx`, `book.tsx`, and `packages/scripture/src/queries.ts`, which is the basis for tagging UX-2/3/4 material (cheap, in-file) versus UX-1/5 out-of-scope (net-new affordances/UI the plan never asked for).

The panel's overall discipline is good — it correctly self-polices UX-5 and largely respects the plan's Out list — but three items (UX-1, UX-6, UX-8) push toward scope beyond a data-layer migration: a new cross-book nav affordance, a plan-doc guardrail whose absence is a risk rather than a defect, and full latency-percentile tooling for an app with no traffic to characterize a baseline against. UX-7 and UX-9 add no information beyond what plan.md already states and should be dropped rather than tracked as separate line items. The four material items (UX-2/3/4, plus none needed for UX-5) are all low-cost corrections inside files the migration is already touching and should be folded into the sweep.

