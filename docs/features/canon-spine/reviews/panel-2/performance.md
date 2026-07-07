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
