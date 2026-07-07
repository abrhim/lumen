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
