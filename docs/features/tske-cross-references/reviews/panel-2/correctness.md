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
