# CODE-ADVERSARIAL / data-integrity — graph-view backfill review

Adjudicates `docs/features/graph-view/reviews/code-panel/data-integrity.md` against
`scripts/backfill-neo4j-collections.mjs`, `scripts/__tests__/backfill-collections.test.mjs`,
and `docs/features/graph-view/plan.md` (incl. amendment 2). Weighed against the live run:
0 conflicts, 0 unstamped, `--verify` exit 0, 253,499 edges uniformly `phase-b`.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| CDATA-1 | material | Verified: `conflicts` (line 165) is logged only, never filters `edgeRows` before stamping (line 235) — batch order last-write-wins, contradicting the header's own guarantee. |
| CDATA-2 | material | Verified: `edgeAgg` (188-192) only groups by value, no per-edge PG comparison. Violates DATA-7's explicit plan text ("compares every LM edge... reports mismatches") today, not hypothetically. |
| CDATA-3 | noise | Premise (structural rels untouched, dirty-count "can never reach 0") is empirically refuted: live verify hit 0 unstamped/exit 0 with edges uniformly `phase-b`. Not checked against live graph. |
| CDATA-4 | material | Verified: `SKIP $n LIMIT 10000` (174-180) has no `ORDER BY`; Cypher gives no row-order guarantee across paged calls — a real, documented anti-pattern already exercised on 40k+ nodes. |
| CDATA-5 | material | Verified: `observedNodes.set(row.id, ...)` (178) is a plain `Map`; plan amendment 2 §3 already confirms live id collisions (280 nodes/262 ids) — not speculative. |
| CDATA-6 | noise | Real but cosmetic: missing sample-id logging in `node_type_done`. No correctness/safety impact; pure debuggability nice-to-have, correctly scored Low by the panel. |
| CDATA-7 | noise | Plan amendment 2 §3 already scoped stamp-side collisions "harmless today"; this re-asks for extra per-id logging on a path the planning process already closed. |

## Stance

**CDATA-1 and CDATA-2 are the real findings here, and both are worse than "High" framing
suggests because they're present-tense, not future-data-contingent.** CDATA-1 is a bug in
the code as written today: `findConflictingEdgeRows` is computed and its count is logged
(lines 166, 257) but the returned array is never used to filter `edgeRows` before chunking
at line 235 — every conflicting PG row still gets its own `MATCH...SET`, so whichever batch
processes last silently wins. That the live PG data happened to contain zero conflicting
`(from,to,rel_type)` keys this run is a fact about today's dataset, not about the code's
correctness; the comment at line 16 makes an unconditional promise ("never last-write-wins")
that the implementation does not keep. CDATA-2 is stronger still: plan.md line 93 states
DATA-7's contract in plain language — `--verify` "compares every LM edge's Neo4j
collection_id against a fresh Postgres read and reports mismatches" — and DATA-7 is flagged
as a safety carve-out that *survived* a panel-2 downgrade specifically because it's
high-severity data-integrity (plan.md:170). The shipped code does not do this for edges; it
does a value-only aggregate with no PG-derived desired state at all. Nodes get the full
`reconcile()` treatment the plan promised; edges get a strictly weaker check. This is a
contract violation today, independent of how many collection values currently exist.

CDATA-4 and CDATA-5 are also material, not "concerns about the future" as the framing might
suggest. CDATA-5 is anchored to a fact the plan itself already confirmed live (280 nodes for
262 ids, amendment 2 §3) — the `observedNodes` Map collapsing collisions is not a hypothetical,
it is guaranteed to be losing information on the exact dataset this script already runs
against. CDATA-4's SKIP/LIMIT-without-ORDER-BY is a standard, documented Cypher gotcha that
was already exercised on this run's node paging; a clean verify result doesn't clear it,
because a silently skipped/duplicated row wouldn't necessarily change the dirty count — it's
absence-of-evidence, not evidence-of-absence.

**CDATA-3 is where the specialist's diligence breaks down, and it's the same pattern as the
"Notes" section's chapter-id dismissal.** Both are built by reading planning docs and script
source rather than querying the live graph the script actually operates on. CDATA-3's claim —
that structural containment relationships (cited as `IN_CHAPTER`/`IN_BOOK`/`IN_VOLUME`/
`USES_WORD`) sit in Neo4j untouched by PG and permanently prevent verify's dirty count from
reaching 0 — is directly falsified by the live run handed to me: verify returned exit 0 with
0 unstamped and *all* 253,499 edges bucketed as `phase-b`, meaning no null-`cid` bucket
existed at all. Whether that's because those structural edges don't currently exist under
those rel-type names (plan amendment 2 §3 itself calls the live relationship `CONTAINS`,
not `IN_CHAPTER`, when describing the actual probed graph) or some other reason, the
specific, falsifiable prediction in CDATA-3 did not hold. This is graded noise, not risky,
because the claim was checkable against a live probe and wasn't.

That same failure mode is worse in the "Notes" section, which I weigh into my overall stance
on the panel's diligence even though it isn't a numbered finding. The specialist dismissed the
49/1582 dry-run chapter mismatch as "no systemic `-ch-` infix discrepancy" by comparing
`ingest-phase-a.ts`'s `chapterId()` helper against a `backfill-phase-b.ts` code comment —
two pieces of this repo's own source, neither of which is the live graph. The context I was
given states a live Neo4j probe shows chapter ids are actually `gen-ch-36`-style, i.e. the
`-ch-` infix the specialist ruled out is real. Compounding this: I traced verify's exit-code
logic (lines 181-194) and found `missingFromGraph` (line 182) is computed and logged but
**never included in `dirty`** — only `pending`/`mismatched`/edge-null count gate the exit
code. A systemic chapter-id format mismatch would show up as `missingFromGraph`, not
`pending`, so verify could report clean (exit 0) while silently never having stamped a large
class of chapters. That's a materially bigger miss than anything in the panel's table, and
it's exactly the kind of thing a live-graph check (which the specialist skipped) would have
surfaced instead of a source-reading dismissal. I did not add it as a numbered finding here
since my brief is to adjudicate the panel's existing table, but it should be raised
separately — it's more consequential than CDATA-6's sample-id ask that this "Notes" section
spawned as a consolation-prize fix.

**Overall**: 4 material (CDATA-1, 2, 4, 5), 0 risky, 0 out-of-scope, 3 noise (CDATA-3, 6, 7).
The panel's severity labels track my tags well for CDATA-1/2/4/5 — keep those as-is and
prioritize CDATA-1 and CDATA-2 first, since both are current-state contract breaks, not
future-data hedges. Drop CDATA-3 as stated (the live probe already answers it) but replace it
with a live-graph-verified version if the underlying "structural rels get a null bucket"
concern is re-investigated. CDATA-6/7 are fine to defer or fold into a single "log collision
and missing-match sample ids" ticket. Separately: escalate the verify `missingFromGraph`/exit-code
gap and the chapter-id `-ch-` question — both surfaced by contradicting the panel's own
source-only reasoning against a live probe — as a new finding, since a "clean" verify run
today does not actually rule out a systemic chapter under-stamping bug.
