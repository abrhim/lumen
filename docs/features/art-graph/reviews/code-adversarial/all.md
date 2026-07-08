# Code-adversarial aggregate — art-graph

Single tagger, all roles. Verified each finding against source
(`scripts/materialize-art-edges.mjs`, `apps/web/app/routes/scripture.art.tsx`,
`apps/web/app/routes/scripture.tsx`, `apps/web/app/lib/art.ts`,
`packages/scripture/src/__tests__/slug-map.test.ts`) rather than trusting the
panel prose; the code-panel findings already carry live/repro verification —
this pass is tag discipline (material / risky / noise / out-of-scope),
precedence material > risky > out-of-scope > noise, High correctness/security
survive regardless.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| CCD-1 | material | High correctness, survives regardless; confirmed live: `ART_PERSON_MAP` is a fixed per-slug map, 3/18 judas + ~13/30 jacob works mapped to the wrong person. |
| CCD-2 | risky | Confirmed mechanism (`put()` unions per edge, not per overlap-group) but 0 live occurrences today; existing test only pins one edge in the group, so a regression ships unnoticed. |
| CCD-3 | noise | Confirmed conflation exists, but verse-bounds-only skips are 0 live today (all 16 skips are chapter-level, documented Daniel 13-14); metric is cosmetically wrong, not currently misleading. |
| CCD-4 | noise | Confirmed 6 live FEATURES-only works, but graph-only reachability matches the plan's stated goal ("art joins the knowledge layer... not only a JSON blob"), not a defect. |
| CCD-5 | noise | Confirmed `LIKE` is unscoped, but currently safe by construction (exactly one live rev-1 ref); fragility is hypothetical, fires only on a future catalog addition. |
| CSC-1 | risky | Confirmed real: `a.sourceUrl \|\| a.image` both default to `""`, producing `href=""`, unlike the gallery's conditional `<a>`/`<div>` split; narrow trigger (both fields must sanitize empty). |
| CSC-2 | material | Confirmed: amendment 7 explicitly requires an "exhaustive membership test"; the actual test never asserts `DEPICTS` or the full list — the amendment's own bar is unmet. |
| CSC-3 | material | Confirmed via read: `totalRefs` counts only `refs.length` while `skipped[]` also holds person-missing entries — pollutes the numerator of the 2% abort-cap safety gate. |
| CSC-4 | risky | Confirmed: `put()` only unions when both sides already have `range_start`; real gap but narrow (single-verse + overlapping multi-verse ref on the same verse), metadata-only, not endpoint correctness. |
| CUO-1 | material | Confirmed live: `meta()`/`<h1>` render raw `bookId` for every multi-word book, on the tab title and page heading, while the sibling route already solves this with a derived reference. |
| CUO-2 | risky | Confirmed omission (no `startedAt`/`elapsedMs`), matching the tske precedent (COBS-5) for the identical gap — real signal loss, modest since book/chapter are already logged. |
| CUO-3 | material | Confirmed: chapter-page `.catch(() => [])` has zero `logEvent`, unlike the identical failure on `/art`; silent failure indistinguishable from "no art" on the default, highest-traffic surface. |
| CUO-4 | risky | Confirmed real fallback (`<div>{card}</div>`, no visual distinction) when `href` is null; live frequency of artworks with unsafe/missing `sourceUrl`+`image` not quantified. |
| CUO-5 | risky | Confirmed omission of book name in the back-link `aria-label`; real for screen-reader users landing on this landmark directly via rotor navigation, not a visual-context read-through. |
| CUO-6 | risky | Confirmed structure: `alt` text duplicates adjacent visible title/artist inside the same link — real, known a11y redundancy anti-pattern, non-blocking verbosity not a functional break. |
| CUO-7 | noise | Finder's own write-up frames this as optional/design-choice ("accept as intended... or add"); art is deliberately decoupled from chapter existence elsewhere in the plan. |
| CUO-8 | noise | Finder concludes this is an approved deviation ("No change needed... record as approved deviation, not a defect") — no actionable defect to tag beyond noise. |

## Stance

Five findings hold as material and should block or gate the merge: CCD-1 is
mandatory (High correctness, live-confirmed wrong-person edges on real
artworks), CUO-1 and CUO-3 are independently confirmed High-severity
user-facing/observability regressions on every multi-word book and every
chapter page respectively, and CSC-2/CSC-3 both trace to explicit amendment
text (an "exhaustive" test that isn't, and a 2%-cap denominator that's
polluted) rather than generic test-coverage nits. The seven risky items
(CCD-2, CSC-1, CSC-4, CUO-2, CUO-4, CUO-5, CUO-6) are all confirmed-real
mechanisms with narrow or currently-inert blast radius — worth a follow-up
fix but none corrupts data or breaks a flow today, and CUO-2 in particular
matches a prior tske precedent (COBS-5) tagged the same way for the same
defect shape. The five noise items (CCD-3, CCD-4, CCD-5, CUO-7, CUO-8) were
downgraded on their merits, not dismissed reflexively: CCD-3/CCD-5 have zero
live occurrences and are safe-by-construction today, CCD-4's "gap" actually
matches the plan's own stated graph-citizenship goal, and CUO-7/CUO-8 are
the finders' own conclusions of no defect.
