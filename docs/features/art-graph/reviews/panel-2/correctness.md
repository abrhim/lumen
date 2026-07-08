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
