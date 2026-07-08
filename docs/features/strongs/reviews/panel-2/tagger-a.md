# Panel 2 — ADVERSARIAL Review (tagger-a) — Panel 1 Correctness-Data + Security-Contract (strongs)

Verified against the source XML (`kjvfull.xml`, 25.4MB, re-derived every count
with a structural non-nested `<w>...</w>` extractor — not substring `grep`),
`scripts/ingest-words.mjs`, `scripts/ingest-openbible-refs.mjs`,
`packages/scripture/src/crossrefs.ts`, `scripts/__tests__/strongs.test.mjs`,
`packages/scripture/src/__tests__/strongs-queries.test.ts`,
`apps/web/app/routes/__tests__/scripture.loader.test.ts`, and
`apps/web/app/routes/scripture.tsx`. No implementation exists yet
(`ingest-strongs.mjs`, `strongs.ts` are absent — plan-stage only); the two
test files above already exist as failing/import-erroring harness stubs.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| CD-1 | material | Verified: 34 transChange elements contain a `<w>`; 33 wrap genuinely non-empty tagged spans (1 wraps only an already-excluded empty `<w/>`). Blanket-skip claim is false. |
| CD-2 | material | Verified but **undercounted**, not overcounted: 633 doesn't match anything real — actual is 359 "purely empty to naive regex" `<w>` spans, 6,878 total `<w>` containing nested `divineName`, across 5,816 verses (18.7% of all Bible verses). |
| CD-3 | risky | Count exact (116, all `title type="psalm"`, all tagged) and panel-1's own text says "confirmed harmless today" — real coverage gap, not a live bug. |
| CD-4 | risky | Count exact (556 verses, unbalanced `<q>`, Matt.5.3/5.48 confirmed). Design already never reads `<q>` balance, so this is a missing regression fixture for an already-safe-by-construction case, not a proven defect. |
| CD-5 | risky | Verified exact: real John 3:16 has `<w src="17"/><w src="12"/>` before "For"; fixture in `strongs.test.mjs:29` has only `src="17"`. Real fixture-fidelity gap, low stakes. |
| CD-6 | risky | No ingest code exists yet to confirm tx scope; genuine plan-text ambiguity ("same script" ≠ "same transaction") worth resolving before implementation, not a confirmed bug. |
| CD-7 | material | Verified directly against `strongs-queries.test.ts:16-27`: zero assertion on `entries[]` order for multi-strongs spans, despite plan's own Q2 promising "show all entries stacked." Cheap, concrete fix (`WITH ORDINALITY`). |
| SC-1 | material | Verified: no `.conf`-parsing precedent exists anywhere in `scripts/*.mjs`; plan text genuinely names no field/abort action. Directly repeats the TSKe license-mistake shape (`retro.md:15`) if skipped. |
| SC-2 | material | Credit-line precedent verified real (`scripture.tsx:1001-1170`, "CC-BY credit... per amendment 10"); Q4's 400-char truncation default (plan.md L124-125) genuinely risks silently cutting an un-checked embedded notice. TBESH file itself not in my verification set. |
| SC-3 | material | Verified exactly: `ingest-words.mjs:104` does `DELETE FROM lumen.words WHERE verse_id IN (...)` per batch; plan's word_tags DDL (L50-51) has no `ON DELETE` clause. Confirmed Critical. |
| SC-4 | material | Verified against loader test mock (`scripture.loader.test.ts:181`): `entries` shape is exactly `{strongs_no, translit, gloss}`, no `definition` — directly contradicts Q4's own truncation-of-definition default. |
| SC-5 | risky | Real, sound defensive ask (no `dangerouslySetInnerHTML` exists in `scripture.tsx` today, confirmed by grep) but purely preventive — nothing to violate yet since no lexicon-rendering code exists. |
| SC-6 | material | Verified against `strongs-queries.test.ts:30-39`: test only checks substrings (`@>`, `lumen.verses`, limit value), no field-shape assertion — confirms shape is genuinely unpinned, unlike `CrossRefRow` (`crossrefs.ts:17`). |

## Stance

**CD-2 is the standout adversarial catch: panel-1's own headline number is
wrong, and wrong in the dangerous direction.** I could not reconstruct "633"
under any parse of the file — not total `<seg><divineName>` occurrences
(6,880), not `<w>`-wrapped ones (6,878), not the subset that reads as fully
empty to a naive `[^<]*` capture (359, the case matching panel-1's own Ps
3:1/23:1 example), not distinct affected verses (5,816). The qualitative
claim is completely sound and the fix (strip nested tags when extracting `<w>`
text) is correct and necessary — but the true blast radius is ~9x panel-1's
figure at the verse level. That matters operationally: 5,816/31,102 verses
(18.7%) is nowhere near the plan's own 1% skip-cap abort threshold (Failure
mode #5) — if this parsing bug ships unfixed, the ingest doesn't quietly lose
633 tags, it **aborts outright** on first run. I kept CD-2 material (it would
survive regardless as a verified High correctness finding either way), but
the rationale and severity framing in panel-1's writeup should be corrected
before it goes into the fix queue, or the fix gets deprioritized against a
number that undersells the real risk.

**CD-1 is accurate to within a rounding edge**: panel-1's "34... wrap a
tagged, non-empty `<w>`" is one off — 34 is the total count of transChange
elements containing *any* `<w>` (including one that wraps only an already-
excluded empty `<w/>`); 33 is the count that actually wrap non-empty tagged
content and would be silently dropped. Doesn't change the verdict.

**CD-7 and SC-4/SC-6 are upgraded from what a skim would suggest** because I
checked them against artifacts that already exist on disk, not just plan
prose: the two harness test files
(`strongs-queries.test.ts`, `scripture.loader.test.ts`) are real, currently
in the repo, and confirm every claim — no ordinality assertion, no
`definition` field in the mocked shape, no field-shape assertion on
`getVersesByStrongs`. These aren't "the plan is vague" complaints; they're
"the checked-in harness stub already encodes the gap" findings, which is
about as verified as a pre-implementation review gets.

**SC-2 is the one finding I could only partially verify** — the "Online Bible
permission notice inside TBESH's Meaning field" claim rests on the TBESH
source file, which wasn't in my verification set (only `kjvfull.xml` was
provided). I verified the surrounding claims (credit-line precedent is real;
Q4's truncation default is real and does create genuine risk if an
un-inspected notice sits in a truncated field) and kept it material on that
basis plus its High severity, but the core embedded-notice premise is
inherited from panel-1's research, not independently re-confirmed here.

**Net**: 8 material (CD-1, CD-2, CD-7, SC-1, SC-2, SC-3, SC-4, SC-6), 5 risky
(CD-3, CD-4, CD-5, CD-6, SC-5), 0 noise, 0 out-of-scope. No finding was
refuted outright; the only correction is CD-2's count, which understates
rather than overstates the problem.
