# Code-adversarial aggregate — strongs

Single tagger, both code-panel docs (`reviews/code-panel/engine.md`,
`reviews/code-panel/surface.md`). Verified against source rather than
trusting panel prose. CE-1's data claim was spot-checked directly:
`awk -F'\t' '$1=="H0430"'` / `'$1=="H0001"'` / `'$1=="H7225"'` against the
vendored `data/strongs/TBESH.txt` confirms the first TBESH row per number is
always the base sense (H0430 line 617 → "God"; H0001 line 55 → "father";
H7225 line 9805 → "first: beginning") and later rows are proper-noun/derived
sub-entries (H0430's last row, H0430I → "(Gibeath)-elohim"; H0001's last row
→ "father of"; H7225's last row → "first: best") — exactly the finding's
claim, and exactly what a last-write-wins `Map` would ship. `scripts/ingest-strongs.mjs`
and `apps/web/app/routes/scripture.tsx` as currently checked in additionally
carry fixes for every one of these findings with comments citing the finding
IDs verbatim (e.g. `lexByNo` is now first-occurrence-wins with a comment
reading "FIRST-occurrence-wins de-dup (CE-1, Critical)"; `WordStudyCard`'s
effect comment reads "the idle guard served the PREVIOUS word's verses under
rapid taps (CS-1/CE-2)") — independent confirmation that each finding was
real, not merely plausible-sounding. Tag discipline is material / risky /
noise / out-of-scope, precedence material > risky > out-of-scope > noise,
High/Critical correctness survive regardless.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| CE-1 | material | Critical, survives regardless; spot-checked against live TBESH.txt — first row is base sense, last row the derived sub-entry, for all 3 sampled numbers. |
| CE-2 | material | High, survives regardless; live code now confirms the exact race (idle-guard removed, fetcher called unconditionally, comment cites CE-2 by name). |
| CS-1 | material | Duplicate of CE-2 (identical mechanism, identical fix) — tag matches CE-2; not double-counted as a second independent defect. |
| CE-3 | risky | Confirmed mechanism (357,343 `<w>` scanned, zero nested) but 0 live instances; fragility triggers only on a future re-vendor of the source XML, not today's data. |
| CE-4 | risky | Confirmed gap (`IF NOT EXISTS` can't retrofit a changed FK) but narrow: only bites if a stale pre-CASCADE table survives a future script edit, not on this feature's first run. |
| CS-2 | material | Medium a11y correctness, confirmed: the toggle/Done/verse-change paths unmount the focused control with no successor target — real focus-to-`<body>` loss, now fixed with explicit refocus calls. |
| CS-3 | material | Medium, confirmed: horizontal hit-area padding on adjacent tagged-word buttons reached into the shared space glyph — real mis-tap risk on real markup, not a hypothetical measurement. |
| CS-4 | material | Medium, confirmed: one `aria-live` region wrapped both immediately-rendered entries and the later-arriving "also in" list — real double-announcement on every tap, house pattern violated. |
| CS-5 | material | Low severity but a genuine house-parity gap: every sibling degraded state (`crossRefs`) gets a `DegradedNotice`; word-tags degraded collapsed into "no tags" with zero UI signal. |
| CS-6 | material | Low severity but traces to amendment 7's explicit claim (word-tags is a bounded "7th query" on the verse-selected Bible branch) — the existing CPERF-6 test never exercised that branch. |
| CS-7 | material | Low severity but traces to amendment 3/PO-3's explicit pin (`GROUP BY` + `json_agg`, one row per word) — the existing test asserted `LEFT JOIN`/`char_start` but not the aggregation itself. |
| CS-8 | risky | Confirmed omission (`strongs_lookup_degraded` lacked `elapsedMs`, present on 3 sibling `*_degraded` events) — real signal loss but modest, matches the same-shape tske precedent (COBS-5) tagged risky. |

## Stance

Nine findings hold as material: CE-1 and CE-2/CS-1 are mandatory
(Critical/High correctness, both independently data- and code-confirmed, not
resting on the panel's word alone). CS-2/CS-3/CS-4 are three independently
confirmed Medium-severity user-facing defects on the interactive word layer's
core interaction (focus, hit-testing, screen-reader announcement) — none
corrupts data but all three break a real interaction path for a real user
class. CS-5/CS-6/CS-7 are Low severity but each traces to an explicit,
already-agreed commitment (the house `DegradedNotice` parity pattern, and
amendments 3/7's own pinned claims about query shape and bounded query
count) rather than a generic nit, so they're held to that commitment's bar
rather than downgraded on severity alone. Three findings are risky, not
material: CE-3 and CE-4 are both confirmed-real mechanisms with zero live
trigger today, contingent on a future data re-vendor or script edit rather
than anything in this run; CS-8 is a confirmed omission but modest
(`no`/`elapsedMs` timing gap on an on-demand, non-critical-path fetch) and
matches a prior precedent (tske COBS-5) already tagged risky for the
identical defect shape. No findings were downgraded to noise or
out-of-scope — every item in both docs traces to a real, verifiable
mechanism in the reviewed diff, unlike a typical panel where some fraction
turn out to be hypothetical-only; the fact that the current tree's code
comments cite CE-1 through CS-8 by ID as the rationale for specific,
targeted fixes is independent corroboration that the panel's findings were
correctly identified rather than manufactured or overstated.
