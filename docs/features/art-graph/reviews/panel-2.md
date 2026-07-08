# Panel-2 aggregate — art-graph

22 material / 3 risky / 5 noise / 1 out-of-scope → dissent 0.806. Live-verified: Daniel 13-14 refs exist (16), person ambiguity systemic, 0 bad URLs today, route collision ruled out, COR-2 drift measured zero.

## api-data-obs
# Panel-2 adversarial — api-contract + data-integrity + observability (art-graph)

Verified against: `apps/web/app/routes/scripture.tsx` (`ArtItem`/`toArtItem`/`ArtImage`/loader/`getChapterArt` call),
`apps/web/app/routes/__tests__/art.loader.test.ts`, `packages/scripture/src/queries.ts` (`getChapterArt`),
`packages/scripture/src/slug-map.ts` (`RELATIONSHIP_TYPES` + `slug-map.test.ts`),
`scripts/__tests__/art-edges.test.mjs` (harness for the not-yet-written `materialize-art-edges.mjs`),
`scripts/backfill-neo4j-collections.mjs`, `scripts/ingest-openbible-refs.mjs`.

## API (api-contract)

| ID | Severity | Tag | Stance |
|---|---|---|---|
| API-1 | high | **material** | Confirmed live: `getChapterArt` (queries.ts:151-158) selects the full `metadata` column and even `ORDER BY (metadata->>'fame')`, but `ArtworkRow`/`ArtItem`/`toArtItem` (scripture.tsx:66-101) never surface `fame`. The gallery harness (`art.loader.test.ts:13-17,54-62`) already mocks `metadata.fame` and asserts `pickArtStack` ranks by it — the fix is required for the harness's own fixtures to be honest, not hypothetical. |
| API-2 | high | **material** | Confirmed: `art-edges.test.mjs:18` `personExists` mock is `['jesus-christ','mary-1','moses-1']` — 3 entries — while the plan (L89-90, FM-3) promises an exhaustive test against the live-probed ~3,869-id snapshot. `materialize-art-edges.mjs` doesn't exist yet (harness-first, correctly failing), so this is fixable before real risk, but as written the harness would pass while silently permitting `ART_PERSON_MAP` values with no live person. |
| API-3 | med | **material** | Confirmed: `slug-map.ts:169-177` `RELATIONSHIP_TYPES` has `FEATURES` but no `DEPICTS`; `slug-map.test.ts:87-91` only asserts `toContain('TEACHES')`/`length > 5` — no exhaustive-membership guard exists yet either, so today nothing would even fail if `DEPICTS` ships unlisted. Plan should add both the constant entry and tighten the test to exhaustive membership (matching the DATA/OBS convention of listing every live rel_type). |
| API-4 | med | **material** | Confirmed: `scripture.tsx:342-348` redirects book aliases with a 301 on the chapter route; `art.loader.test.ts:41-44` only covers unknown-book and non-numeric-chapter 404s, no alias case. Plan text for the gallery route never mentions alias handling at all — silent inconsistency risk (e.g. `/scripture/1ne/2/art` behaving differently than `/scripture/1-nephi/2/art`) if the loader is a naive rewrite of the 404 checks only. |
| API-5 | low | **material** | Confirmed: `ArtImage` (scripture.tsx:826) is a bare `function`, not exported. Plan's gallery card field list (image/title/artist·year/source link) never states reuse. Cheap, real fix — export it (or move to a shared module) before `scripture.art.tsx` is written, otherwise a second thumb-fallback implementation is the likely default. |
| API-6 | low | **noise** | Not an independent defect — it's a documentation cross-reference that self-resolves once API-1 lands (the "no loader change" claim becomes true again once `fame` is added to the existing `ArtItem` shape rather than a new field bolted on separately). No separate fix needed beyond API-1. |

## DATA (data-integrity)

| ID | Severity | Tag | Stance |
|---|---|---|---|
| DATA-1 | High | **material** | Confirmed: `art-edges.test.mjs` exercises `chapterExists`-driven skip (L56-63, invalid book) but has no case for `verse_start`/`verse_end` beyond the mocked chapter's real range, and the plan has no analog to openbible's `UNMAPPED_CAP`/ratio-abort (`ingest-openbible-refs.mjs:22,113-120`). Given the plan's own zero-orphan in-tx invariant hard-aborts the transaction (per the openbible precedent it's modeled on), an unvalidated out-of-range verse ref would generate an orphan edge and abort all ~15k rows on one bad source record. Real, high-consequence gap — needs a per-verse existence gate plus a tolerance ratio like FM-11.
| DATA-2 | Medium | **material** | Confirmed: `backfill-neo4j-collections.mjs` queries `lumen.entities`/`lumen.edges` with no collection filter (L163-166 nodes, L197-203 edges) and already documents *some* expected-missing classes (jst/strongs/naves, deprecated structural types) in comments/log fields (`missingFromGraph`, B15 comment L219-224) — but nothing art-specific. ~4.4k artwork entities + ~15k DEPICTS/FEATURES edges will land in that same `missingFromGraph`/unstamped-edges bucket unexplained, which erodes the signal the backfill's own "distinguish real regressions" design depends on. Cheap doc/comment fix. |
| DATA-3 | Medium | **material** | Confirmed: Scope §4 (plan.md L58) names exactly two spot checks (chapter-level DEPICTS, one FEATURES) and nothing for the verse-range expansion path — the most structurally complex logic per FM-2 (766 works, one-edge-per-verse-in-range). Openbible's own smoke precedent spot-checks a range case; art-graph's plan currently doesn't mirror that for its own range logic. |
| DATA-4 | Low | **noise** | The plan text panel-1 flagged already names `lumen.edges` in the same bullet/sentence ("`lumen.edges` gains DEPICTS/FEATURES rows... delete scope = collection_id='art' AND rel_type IN (...)") — the delete-scope clause is contextually anchored to the immediately preceding "lumen.edges gains rows" clause, not floating ambiguously. Misapplication risk against `lumen.entities` is low; restating the table name in the script header (which will happen naturally when the script is written, per every other script in this repo) covers it without a plan amendment. |

## OBS (observability)

| ID | Severity | Tag | Stance |
|---|---|---|---|
| OBS-1 | Medium | **material** | Confirmed no event names in plan.md L46 ("unmatched slugs counted + reported") vs. the established convention `openbible_unmapped_refs {count, ratio, sample:10}` (`ingest-openbible-refs.mjs:198-202`). Same repo, same script family, same review cycle — no reason to skip the naming convention here. |
| OBS-2 | Medium | **material** | Confirmed: plan.md L47 says "re-run stability marker" with no key name; precedent keys (`'openbible-ingest'`, `'canon-spine-p3-verified'`) are all named and consumed by a paired smoke script (`smoke-openbible.mjs:42`). `smoke-art-edges.mjs` doesn't exist yet — nothing for it to diff against without a named key up front. |
| OBS-3 | High | **material** | Confirmed: plan.md L58 says only "a Luke 2 nativity work" / "jesus-tagged work" — generic, not a probed artwork id. The plan's own "Live facts (probed 2026-07-07)" section (L26-31) shows this project already does concrete live probing (4,461 artworks, tag counts, etc.) — the same discipline should apply to naming the actual `art:<id>` used in smoke, exactly as openbible named `gen-1-1 → heb-11-3 votes=271`. Without it the smoke check is either untestable as written or will be filled in ad hoc at implementation time with no plan-level review. |
| OBS-4 | High | **material** | Confirmed: `scripture.tsx:376-378` already swallows `getChapterArt` failures to `[]` with **no log call** (unlike the `neo4j_degraded` pattern at L309-317 for connections). The gallery loader test (`art.loader.test.ts`) has zero coverage for a `getChapterArt` rejection — only happy-path and true-empty-array cases (L46-50). Failure mode #6 in the plan explicitly conflates "empty art" with "loader threw," which this test file's gap reproduces exactly. Needs its own test + named degraded event, distinct from empty-state. |
| OBS-5 | Low | **material** | Confirmed: `scripture.tsx` chapter loader logs `scripture_404` with a `cause` taxonomy (`unknown_book`/`invalid_chapter`/`empty_chapter`, L331/L337/L393) before every 404 throw. `art.loader.test.ts:41-44` tests the 404 status but the plan never states a matching log call for the gallery route — cheap, consistent fix given the sibling route already sets the pattern. |
| OBS-6 | Low | **out-of-scope (for this role)** | The underlying fix (export/reuse `ArtImage`, confirmed not exported today — scripture.tsx:826) is real, but it's a UI-component-reuse concern, not an observability concern — no logging/telemetry angle here. It's already correctly owned by API-5 in the api-contract review; flagging it a second time under "observability" invites two independent fixes for one change. Fold into API-5, don't track separately in this lane. |

## Summary
- **Material and worth blocking on before implementation:** API-1, API-2, API-3, API-4, API-5, DATA-1, DATA-2, DATA-3, OBS-1, OBS-2, OBS-3, OBS-4, OBS-5 (13 of 16 hold up under direct source verification).
- **Noise:** API-6 (self-resolves with API-1), DATA-4 (already contextually unambiguous in plan text).
- **Out-of-scope for its assigned role:** OBS-6 (real fix, wrong lane — belongs to API-5).
- Every "material" tag above was checked against a real file/line, not just plan prose — see inline citations.

## correctness
# Panel-2 (adversarial) / correctness review — art-graph

Verified against: `docs/features/art-graph/plan.md`, `docs/features/art-graph/reviews/panel-1/correctness.md`,
`scripts/__tests__/art-edges.test.mjs`, `apps/web/app/routes/scripture.tsx` (verse-art filter L577),
`apps/web/app/routes.ts`, and a live probe of `lumen.entities`/`lumen.verses`/`lumen.chapters`/`lumen.edges`
via the read-only Hyperdrive DSN (4,461 artwork rows; 768 verse-level refs across 766 works).

| ID | Tag | Rationale (≤ 25 words) | Stance |
|---|---|---|---|
| COR-1 | material | Live: verse_end null = 32/768 (4.2%), end==start = 26/768 (3.4%) — real but rare, not "likely common case" as claimed; ranges dominate at 92.4%. | Confirmed gap, correct rationale overstated frequency — keep fix, soften claim. |
| COR-2 | risky | Live: 0/6436 true within-chapter verse drift; all 63 invalid verse-units (0.98%) trace to the same 4 dan-13/dan-14 works as COR-4 — "drift" framing is unsupported by data. | Test still needed but reframe/merge into COR-4; drop the versification-drift narrative. |
| COR-3 | material | Live: jesus-christ (10,569 in / 41 out edges) vs jesus-1 (1 edge) confirms the map target, but Joseph(11), Mary(7), Judas(5), Jacob(5), Elijah(5) show the ambiguity is systemic, not jesus-only. | Escalate: needs a per-slug verified-mapping rationale, not one doc line about jesus. |
| COR-4 | material | Live: 4 artworks (Susanna/Bel-and-the-Dragon) cite dan-13/dan-14, chapters that don't exist for canonical Daniel (12 ch.) — the exact untested scenario, present today, not hypothetical. | Confirmed live occurrence; also contradicts plan's "dc? no dc refs — Bible only" claim. |
| COR-5 | material | buildArtEdges doesn't exist yet (harness-first) so no live signal either way; order-independent reduce/merge bugs are a standard class — cheap test, Low severity is fair. | Agree with panel-1 as-is; no escalation, no evidence to downgrade. |
| COR-6 | noise | routes.ts: `scripture/:book/:chapter` (3 segments) vs new `scripture/:book/:chapter/art` (4 segments), no splat/catch-all route present — structurally no ambiguity in React Router path matching. | Non-issue; confirms task brief's note that api-contract already ruled it out. |

## Summary
Live probing upgraded two findings and downgraded one: COR-3's ambiguity problem is broader than
panel-1 stated (6 of the plan's own top-12 character slugs have multiple person candidates, not just
jesus), and COR-4 is a confirmed-present bug (4 real artworks), not a hypothetical gap — both merit
material status and priority over COR-1/COR-2. COR-2's own "verse-drift" framing doesn't hold up: measured
drift is zero, and every rejected verse in the live catalog is actually a COR-4 case (invalid chapter, not
misaligned verse numbering within a valid chapter) — recommend collapsing COR-2's rejected-verse test into
COR-4's fix rather than tracking it as a separate high-severity risk. COR-1 is real but its "likely common
case" justification is wrong by the data (7.6%, not the majority — ranges are). COR-5 has no data angle
(function not yet implemented) and stands as panel-1 stated it. COR-6 is confirmed noise: differing route
segment counts make the stated collision risk structurally impossible under React Router's matching, and
no catch-all route exists to shadow it.

## security
# Panel-2 adversarial — security (art-graph)

Verified against `apps/web/app/routes/scripture.tsx` (live) and live data
(4,461 artwork entities, `lumen.entities` via read DSN + the
`~/Downloads/art-database-export/artworks.json` export — both checked,
matched).

## Empirical checks run

1. **URL schemes** — every `source_url`, `image_url`, `thumbnail_800_url`
   across all 4,461 artworks (live DB *and* export file, cross-checked) is
   `https:`; 0 non-http(s) values exist today (9 artworks have a null
   `thumbnail_800_url`, no scheme at all — not malicious).
2. **Verse-range bounds** — 768 verse-level refs checked against live
   per-chapter max verse number: 0 exceed their chapter's actual verse
   count.
3. **Chapter-existence** — all refs checked against live `book_id+chapter`
   pairs in `lumen.chapters`: **16 refs across 4 distinct chapters fail**
   (`dan-13` ×11, `dan-14` ×5 — Susanna / Bel-and-the-Dragon, apocryphal
   Daniel additions not in this canon's 12-chapter Daniel). Real, will hit
   on the very first materialize run, not hypothetical.
4. **Collection `public` flag** — live `art` row is `public: true`, but via
   the `collections.public` column's schema **default** (`true`), not an
   explicit set — confirmed `ingest-art-catalog.mjs`'s
   `INSERT INTO lumen.collections (id, name, description, tier, category,
   provenance, license, storage)` omits `public` from the column list.
   Confirmed `ingest-openbible-refs.mjs` (CSEC-5 precedent) *does* set it
   explicitly in both the insert and the `ON CONFLICT ... DO UPDATE`. All 7
   live collections are `public: true` today (all riding the same default).
5. `scripture.tsx` confirmed: `href={a.sourceUrl || a.image}` (lines 805,
   871) and `src={art.thumb ?? art.image}` (line 829) — no scheme
   validation anywhere in the file, nor anywhere else under `apps/web/app`
   (grepped for `isSafeUrl`/`sanitizeUrl`/scheme checks — none exist).
   `rel="noreferrer"` is present on both anchors (no tabnabbing gap).

## Table

| ID | Tag | Rationale (≤ 25 words) | Stance |
|---|---|---|---|
| SEC-1 | material | Confirmed at both href sites; 0 malicious URLs *today* (curated museum sources), but zero code-level defense and gallery deliberately widens exposure 12→100 (~8x, not "triples"). | Concur, high holds — cheap fix, new public route, defense-in-depth for a supply-chain-latent stored-XSS class. |
| SEC-2 | material | Confirmed same unvalidated pattern at `<img src>`; correctly scoped as low (no javascript: execution via img src in modern browsers, but fallback/phishing risk at scale is real). | Concur as stated. |
| SEC-3 | material | Verse-overflow scenario (0/768 today) doesn't exist in current catalog, but empirical scan found a closely-related, guaranteed-live failure: 16 refs cite nonexistent Daniel 13–14 chapters. | Concur, med holds — likely already caught by the harness's `chapterExists` gate (FM-1 test design generalizes to it), but there is still no test proving verse-level bound-checking, which is the actual gap SEC-3 names. |
| SEC-4 | material | Confirmed omission in `ingest-art-catalog.mjs`'s insert vs. `ingest-openbible-refs.mjs`'s explicit precedent; currently harmless only because schema default happens to already be `true`. | Concur, low holds — no live exposure, pure defense-in-depth/consistency; do it because the codebase already established "explicit not default" as policy, not because of a demonstrated breach. |

## Notes for the human gate

- SEC-3's real near-term trigger is the Daniel 13/14 apocrypha refs, not a
  verse-count overflow — the fix should be verified against this concrete
  case (assert `dan-13`/`dan-14` land in `skipped`, not just a synthetic
  'tobit' book-level case) in addition to the bound-check SEC-3 requests.
- SEC-1's "triples exposure" framing is an understatement (100 vs. strip's
  `slice(0, 12)` is ~8.3x); doesn't change the tag, noted for accuracy.
- No new findings surfaced beyond panel-1's four; all four confirmed
  material against live code and live data.

## ux-a11y
# Panel-2 Adversarial — ux-a11y (art-graph)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| UX-1 | material | Overlapping unlabeled images risk broken tab stops for anyone using keyboard/AT; single-button + `aria-hidden` cards is a cheap correctness fix, not a nicety. |
| UX-2 | risky | Mostly subsumed by UX-1's single-button target; exact 44px WCAG minimum matters less for one known user, but still worth a build-time size check. |
| UX-3 | risky | Contingent, not present: plan specifies no animation at all, so the reduced-motion gate only applies if a fan/expand transform gets added later. |
| UX-4 | material | Missing `aspect-ratio` reservation risks real CLS and DOM/visual tab-order mismatch on image load, independent of masonry vs grid choice; cheap to spec now. |
| UX-5 | material | Confirmed in code: `?verse=` drives the existing scroll-restore effect (`scripture.tsx` selectedVerse hook); a bare-URL breadcrumb link silently drops it — concrete regression. |
| UX-6 | noise | Speculative header-density claim with no concrete evidence; Q1's default 3-card compact stack already bounds the height risk it worries about. |
| UX-7 | noise | Moot given task framing: the sole user explicitly requested the stack-behind-click trade-off, so no fresh "accept the regression" step is needed. |

**Stance:** UX-1, UX-4, and UX-5 are material because they produce concrete, observable defects — broken tab order, layout shift, and a verified loss of reading position via the `?verse=` param — that degrade the experience for the app's actual (single) user, not just hypothetical ones, and are cheap to fix now. UX-2 and UX-3 are real-but-contingent (largely covered by UX-1's fix, or not yet triggered since no animation exists), and UX-6/UX-7 are noise: UX-6 has no concrete grounding against the plan's compact-stack default, and UX-7 asks the plan to "accept" a trade-off the user already chose on purpose.

