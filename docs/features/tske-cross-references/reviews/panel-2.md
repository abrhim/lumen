# Panel-2 aggregate — tske-cross-references

8/8 taggers. 33 material / 7 risky / 10 noise / 2 out-of-scope → dissent 0.769.

## accessibility
| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| A11Y-1 | material | Verified: no total-count field anywhere; existing `{title} · {refs.length}` would render misleadingly with a silent 20-cap. Cheap, proportionate fix. |
| A11Y-2 | material | Verified: today one `VersePanelData` promise + one `aria-busy` skeleton wraps cross-refs+principles+people; plan's timing split (sync refs, streamed entities) breaks that without new loading semantics. |
| A11Y-3 | risky | Real gap in Failure-mode #5's assertion, but Scope §4's own example ("Ps 148:4–5") already implies range_start–end; overstates ambiguity. Fix is trivial to include anyway. |
| A11Y-4 | material | Verified: `sourceLabel` precedent is literally `text-[9px] ... text-faint` (scripture.tsx:984); an unspecified new legacy chip is likely to inherit it. Fix is proportionate. |
| A11Y-5 | material | Verified: plan says "vote-sorted"/"vote-ranked" but never states whether counts render; a shipped bare-number badge would be undecided SR noise. Cheap decision + label fix. |
| A11Y-6 | noise | Verified titles differ ("Cites"/"Cited by" vs "References"/"Referenced by") but that reads as a deliberate rename with the data-source swap, not a structural a11y hazard; h3+ul reuse is already implied by "panel + loader" edit scope, not rewrite. |

Overall: five of six findings hold up against the live markup — `ConnectionsSkeleton`'s single `aria-busy` region, `CrossRefGroup`'s h3+ul structure, and the 9px `text-faint` `sourceLabel` precedent are all real and directly relevant to how the new cross-ref UI will be built. A11Y-3 is downgraded to risky because the plan's own "Ps 148:4–5" example already answers most of the ambiguity it flags, even though the failure-mode test doesn't lock it in. A11Y-6 is downgraded to noise since a "Cites"→"References" rename is plausibly intentional (data source is changing) and carries no accessibility risk on its own — the h3+ul structural reuse it worries about isn't actually threatened anywhere in the plan.

## api-contract
# Panel 2 / api-contract ADVERSARIAL review — tske-cross-references plan

Verified against `packages/scripture/src/graph/find-cross-references.ts`,
`packages/scripture/src/graph/get-verse-connections.ts`,
`apps/web/app/routes/scripture.tsx`, `apps/web/app/lib/cache.server.ts`, and a
repo-wide grep for `getVerseConnections` / `findCrossReferences` callers.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| API-1 | material | Confirmed: no TS return shape given for `getCrossReferences` despite a stated future-MCP-adoption path. Cheap fix (write the interface), real future-rework risk. |
| API-2 | material | Confirmed by grep: `getVerseConnections`'s only caller is `scripture.tsx:231`; MCP's `find_cross_references` tool maps to the separate `findCrossReferences`. Plan's contract claim is factually wrong. |
| API-3 | noise | Overstated: scope item 3 already says "per-direction limit (default 20)" plainly; Q5 repeats it. No real ambiguity, just a terser restatement at L91. |
| API-4 | risky | Real gap, but plan explicitly routes this decision to "panels to weigh in" — which is this very review round — and the helper has no cross-system consumer, unlike API-1. |
| API-5 | out-of-scope | Asks for a pure volume→collection fn to serve MCP, but MCP adoption is explicitly punted by this plan's own Scope→Out list; nothing today needs a second caller. |
| API-6 | noise | `cachedJson` (`cache.server.ts`) always writes `expirationTtl`, no purge path exists anywhere in this codebase's KV usage — the "one line" the fix asks for restates an established, self-evident invariant. |
| API-7 | noise | Real wording drift (cites/cited-by vs References/Referenced by) but direction mapping is already unambiguous by precedent — current code's `cites`=outgoing/`citedBy`=incoming stays the obvious default. |

## Stance

API-1 and API-2 hold up under verification and stay material: API-2 in particular is a
plain factual error the grep disproves outright (`getVerseConnections` has one caller,
not an MCP one), and correcting it is a one-line fix with real downstream consequence —
if there's no MCP consumer to protect, the field should likely be dropped rather than
kept empty. API-1's missing return shape is real and cheap to fix given the plan itself
anticipates MCP adopting the function later.

API-4 is a genuine gap but downgraded to risky: the plan's own "panels to weigh in" line
is process working as intended (this round), and the helper it flags is internal to the
web panel with no cross-system exposure, unlike API-1. API-5 is downgraded further to
out-of-scope — it's asking the plan to design for an MCP consumer that the plan's own
Scope→Out section explicitly defers to a future feature.

API-3, API-6, and API-7 are downgraded to noise: API-3's "ambiguity" doesn't survive a
plain reading of scope item 3; API-6 asks the plan to restate a TTL-always invariant
that's already structural in `cachedJson` with no purge path anywhere in the codebase;
API-7 is a true wording inconsistency but has zero behavioral stakes given the existing
direction→label precedent in the current component.

## correctness
# Panel 2 — Adversarial Correctness Review — tske-cross-references

Evaluated panel-1's `correctness.md` against the plan and empirically against
the live TSV (`cross_references.txt`, 344,799 rows).

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| COR-1 | material | Confirmed real: `3John.1.15` exists in TSV, KJV only has 14 verses — a genuine versification-drift case; silent-wrong-mapping risk for Psalms unruled-out. |
| COR-2 | material | Codebase precedent (`ingest-phase-a.ts`) already does plain batched inserts with no cross-batch atomicity — same gap, unaddressed, now hitting live prod panels. |
| COR-3 | risky | Empirically refuted the specific mechanism: from/to is ~53/47 (near-random), not canonical-spine order. Direction-mislabel/legacy-convention risk still plausible but unmechanized. |
| COR-4 | material | Verified: 18 cross-book ranges exist (e.g. `Num.3.1→Lev.27.34-Num.1.1`); sum with same-book cross-chapter (637) = 655, the plan's own cited figure — hidden, unhandled. |
| COR-5 | material | Confirmed ambiguity in plan.md:55 text itself; combined with COR-4's book-concentrated failure mode, a per-batch or wrong-denominator cap plausibly masks a real spike. |
| COR-6 | material | Confirmed `loadConnections` (scripture.tsx:219) is the only never-throw wrapper today; plan's FM list (10 items) has no assertion forcing the new PG call inside it. |

## Overall stance

Panel-1's findings hold up better under empirical pressure than a typical
adversarial pass expects: COR-4 goes from "unstated assumption" to a
directly-counted 18 real cross-book rows hiding inside the plan's own "655
cross-chapter" figure, and COR-1's drift example (3 John 14 vs 15) is
independently reproducible in the source data rather than theoretical. COR-3
is the one downgrade — the "canonical-spine order" mechanism it proposes
doesn't match the data (from→to is close to a coin flip by canonical
position, both cross-book and within-book), so the plan is not systematically
biased toward spine order; the residual risk is real but is about
non-directional thematic pairs and an unverified legacy-edge convention, not
the mechanism as stated. COR-2, COR-5, and COR-6 remain sound, low-cost,
concrete plan gaps and should all gate before ingest/ship.

## data-integrity
| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| DATA-1 | material | Plan text literally says delete-collection-then-BATCHED-insert; a crash mid-batch strands the collection empty. Fix (single tx, mirrors ingest-words.mjs) is cheap. |
| DATA-2 | material | Confirmed: `edges` has no PK/unique constraint in schema.ts. Overlapping source ranges can double-insert; app-level dedup before insert is a cheap fix. |
| DATA-3 | material | smoke-canon-spine.mjs's exhaustive edge-endpoint check already exists and is free to re-run; plan cites no post-ingest deploy step invoking it. One-line gap. |
| DATA-4 | material | Cheap addition alongside the already-planned unmapped-id invariant; same pattern, same in-tx counter. Proportionate fix for a plausible range-overlap edge case. |
| DATA-5 | material | Confirmed: `collections.id` is a real PK in schema.ts. Plain INSERT on re-run throws and aborts the whole script — breaks FM-10's idempotency claim outright. |
| DATA-6 | risky | Core fix proposed (typed INT column) is schema DDL, contradicting the plan's stated "no schema DDL" contract; "no index" concern is moot at per-verse LIMIT-20 scale. Ingest-side validation alone suffices. |
| DATA-7 | material | Ask is "verify, add if needed" — an EXPLAIN check is near-zero cost, and setup-indexes.sql already establishes manual index additions as normal practice here. |

Overall stance: five of seven findings are confirmed against the actual schema and scripts, not speculative — `lumen.edges` genuinely has no unique constraint, `lumen.collections.id` genuinely is a PK that a naive re-run INSERT will collide with, and smoke-canon-spine.mjs's edge-endpoint gate genuinely exists unused post-ingest. These survive as material regardless of the 0-user context because the fixes are all cheap (one transaction wrapper, one ON CONFLICT clause, one extra invariant counter, one extra deploy-step line) and the codebase already has working precedent for each (ingest-words.mjs's per-batch atomic delete+insert). DATA-6 is downgraded to risky solely because its headline fix (a typed votes column) is schema DDL that conflicts with the plan's own "no schema DDL" contract and is unwarranted at this row-per-query scale; ingest-time validation is the proportionate fix panel-1 already offered as an alternative but didn't lead with. No finding is noise or out-of-scope — all seven engage the plan's actual ingest/schema text, not hypotheticals.

## observability
# Panel-2 Adversarial Review — Observability (tske-cross-references)

Verified against `scripts/ingest-words.mjs`, `scripts/smoke-canon-spine.mjs`,
`scripts/migrate-canon-spine.mjs`, and the live `apps/web/app/routes/scripture.tsx`
loader (`neo4j_degraded` / `graph_degraded` patterns, `isEmpty` panel state,
`migration_state` usage).

| ID | Tag | Rationale (≤25 words) |
|---|---|---|
| OBS-1 | material | Confirmed: loader already has `neo4j_degraded`/`graph_degraded` "never rejects" pattern for critical-path enhancements; plan is silent on reusing it for PG cross-refs. |
| OBS-2 | material | House pattern (`words_ingest_done`) always names its event + shape; plan leaves the unmapped report unnamed. Trim the "per-book counts" ask — no house precedent for that granularity. |
| OBS-3 | material | Plan states a numeric abort threshold with no FM entry, exit code, or boundary test — real silent-early-return risk; ingest-words.mjs's exit-code convention (0/1/2) is the precedent to match. |
| OBS-4 | noise | House pattern logs per-batch only on *failure* (`words_batch_failed`), success is aggregate-only; per-batch deleted/inserted logging is noisier than precedent and redundant with OBS-5's count-stability check. |
| OBS-5 | material | Plan is internally inconsistent: FM-10 requires re-run count stability but §5's smoke bullet list omits it — a direct contradiction, one-line fix. |
| OBS-6 | noise | Negative-vote ordering and range-collapse already have dedicated unit/property tests (FM-5, FM-6); duplicating them as *live* spot checks is redundant verification, not a gap. |
| OBS-7 | material | Loader already has a house-precedented distinct empty state (`isEmpty` → "No connections recorded"); plan should extend it to cross-refs so degrade and empty aren't visually identical. |
| OBS-8 | noise | `migration_state` is self-referential bookkeeping read only by `migrate-canon-spine.mjs` to gate its own destructive P4 step — never read by the app. This plan has no analogous gated follow-on, so persisting an audit record has no consumer. |

## Overall stance

Panel-1 correctly found the two sharpest gaps: the plan moves a PG query into
the loader's critical path without stating its failure behavior (OBS-1) even
though the codebase already has a proven, cheap-to-reuse degrade pattern for
exactly this situation, and the 0.5% abort threshold is unimplementable as
written (OBS-3). OBS-5's FM-10/smoke-bullet contradiction is a genuine plan
defect, and OBS-7 has real teeth once you notice the panel already
distinguishes empty from degraded elsewhere — the plan just needs to say so.
Three findings (OBS-4, OBS-6, OBS-8) don't hold up against the actual house
patterns they cite: OBS-4 and OBS-8 ask for log/persistence granularity the
codebase doesn't use anywhere else (and OBS-8's cited precedent, `migration_state`,
is a self-gate with no analog here), and OBS-6 duplicates coverage already
committed to in the harness plan. For a personal project whose logs the owner
reads directly, these three add implementation cost without a corresponding
debugging or correctness payoff.

## performance
# Panel-2 (adversarial) / performance review — tske-cross-references

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| PERF-1 | material | Plan's own COR-2 line forces cross-refs into the awaited critical path; real first-paint delta, cheap fix (state parallelism or split Promise.all). |
| PERF-2 | risky | Harness scope (plan.md L124) already mandates a `getCrossReferences` SQL-shape test, pinning this at implementation time; mandating UNION ALL now adds join/labeling complexity for a ~10-50ms delta that's likely parallelized away regardless. |
| PERF-3 | material | Real gap vs established project precedent (`ingest-words.mjs` batch size + elapsedMs logging); cheap to document, doesn't mandate the riskier index-drop suggestion. |
| PERF-4 | noise | ~600k edges / ~31k verses ≈ 19-40 avg incoming rows/verse; single-column index-scan-then-filter is sub-ms at that cardinality, even for outlier verses. |
| PERF-5 | risky | Splitting the existing single `cachedJson` wrapper into two cache flows/keys is real plumbing work for near-zero payoff — a direct indexed PG query (~10-50ms) is comparable to a KV round trip anyway. |
| PERF-6 | noise | Panel-1 already scored this low and its own fix asks only for a fan-out confirmation; in-memory sort of tens-to-low-hundreds of rows is free regardless. |

## Overall stance

Panel-1's read of the plan text is accurate throughout, but three of six findings (PERF-2, PERF-4, PERF-6) size the actual data wrong: at ~600k edges over ~31k Bible verses, average per-verse fan-out is in the tens, not the thousands, so index-recheck and in-memory-sort costs the findings worry about are sub-millisecond regardless of which SQL shape or index strategy ships — PERF-2 additionally has its stated fix already covered by the plan's own SQL-shape harness requirement. PERF-1 and PERF-3 survive scrutiny: both point at genuine, plan-text-grounded gaps (the COR-2-forced critical-path move, and the missing batch/wall-clock spec that this repo's own `ingest-words.mjs` sets precedent for) with fixes that cost a sentence of documentation, not new engineering. PERF-5 is downgraded to risky rather than material because the concern is real (the single-cache-wrapper assumption does break once cross-refs move to the critical path) but its prescribed fix — a second cache flow and key — is more plumbing than a ~10-50ms-vs-KV-round-trip tradeoff justifies at zero users.

## security
# Panel-2 Adversarial Review — Security (tske-cross-references)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| SEC-1 | risky | Parameterized inserts + in-tx verse-id invariant bound blast radius to well-formed bogus data; pinning/vendoring adds ongoing maintenance for near-zero real impact. |
| SEC-2 | material | Real gap; cheap precedented fix — `align-edge-chapter-ids.mjs` already wraps a full `lumen.edges` delete+update in one `sql.begin` on this exact table. |
| SEC-3 | material | scrub() is a real 5-site pattern; one-line fix prevents plausible DSN leak via PG connection-error messages into logs/CI. |
| SEC-4 | out-of-scope | CC-BY attribution wording is a licensing/legal-compliance question, not a confidentiality/integrity/availability or injection concern — not a security finding. |
| SEC-5 | material | Cheap, precedented (3 sibling scripts) ask to pin the parameterized `jsonb_to_recordset` pattern for untrusted TSV fields, closing off ad hoc string SQL. |

## Overall stance

Panel-1's factual claims check out against the codebase (scrub(), jsonb_to_recordset, the permissive `USING (true)` RLS on `lumen.edges`, and the single-tx precedent in `align-edge-chapter-ids.mjs` are all real), so this isn't a case of hallucinated house patterns. SEC-2, SEC-3, and SEC-5 are legitimate, cheap, precedented fixes worth requiring explicitly in the plan. SEC-1's "high" severity overstates the actual threat model for this project — a manually-invoked, owner-run admin script ingesting public CC-BY data through parameterized inserts with a verse-id invariant gate — so the recommended checksum-pinning machinery costs more ongoing upkeep than the residual risk justifies; downgrade and treat as optional hardening rather than a blocker. SEC-4 is a reasonable licensing-compliance catch but belongs to a legal/content review, not a security one, and should be routed there instead of gating this panel.

## ux
# Panel-2 (adversarial) / ux review — tske-cross-references

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| UX-1 | material | Real: cross-refs go critical-path, principles/people stay Neo4j-streamed, but chips sit *above* refs in DOM — pop-in shifts already-rendered cards. "One payload" fix option violates plan's own COR-2 rule. |
| UX-2 | material | Real disclosure gap (Q5 caps 20/direction, no total shown); panel-1's "count query already available" is false but a `COUNT(*) OVER()` addition is cheap, so worth fixing. |
| UX-3 | material | Plan text literally invites this ("panels to weigh in" on range dedup); current single-verse highlight architecture can't span a range, so at minimum the title-disclosure fix is warranted. |
| UX-4 | material | Q6 is an explicitly open question the plan wants resolved; "Curated" is a low-cost, defensible alternative even though the sole reader is the developer who chose "legacy." |
| UX-5 | material | Genuine gap: one generic empty-state string conflates "Bible verse, no OpenBible refs" (rare/suspicious) with "BoM verse, no legacy refs" (expected); not covered by any of the 10 failure modes; cheap conditional-copy fix. |
| UX-6 | material | Public contract commits to a CC-BY footer credit below up to 40 scrollable cards — genuinely easy to miss; moving the line under the section headers is a few-line change. |
| UX-7 | noise | Premise is wrong: plan's Scope §4 explicitly spells out "References"/"Referenced by" as the new labels — it *is* documented, just not justified. Direction-clarity worry is unsubstantiated bikeshedding for a one-user app. |

## Overall stance

Panel-1's UX read holds up well against the actual plan text and `scripture.tsx`: six of seven findings point at concrete, plan-grounded gaps (an architectural timing split that isn't reconciled with DOM order and the house "no layout shift" rule, an unaddressed truncation/empty-state/attribution disclosure trio, and a genuinely open wording question) with fixes cheap enough to justify flagging even for a one-user app. UX-1 deserves a caveat rather than a downgrade: its "reserve fixed-height slots" fix is sound, but its "one resolved payload" alternative directly contradicts the plan's own COR-2 constraint (PG must never be touched from a deferred promise), so only half of its prescribed fix is actually usable. UX-7 is the one finding that doesn't survive scrutiny — it asserts the rename is "undocumented as intentional" when the plan's Scope §4 states the new labels outright, and its directional-clarity concern is speculative wordsmithing with no user (beyond the developer) to confuse.

