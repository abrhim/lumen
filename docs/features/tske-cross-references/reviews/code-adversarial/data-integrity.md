# CODE-ADVERSARIAL / data-integrity — tske-cross-references

Adversarial pass against `docs/features/tske-cross-references/reviews/code-panel/data-integrity.md`
(CDATA-1/2/3). Re-read `scripts/ingest-openbible-refs.mjs` and `scripts/smoke-openbible.mjs` in
full; independently re-derived each claim rather than trusting the panel write-up.

**CDATA-1 verification.** Ran an independent scan of the vendored
`data/openbible/cross_references.txt` (344,799 rows): grouped by `from`, counted range vs. single
`to` targets, and checked exact raw `(from,to)` duplicate pairs — 0 exact-duplicate raw pairs,
consistent with the panel's fuller (OSIS-expanded) zero-collision scan cited in the task context.
Confirms the empirical premise: nothing fires today. Read `dedupeEdgeRows` (`:99-112`) directly —
the `byPair` Map keys strictly on `${from_id}\t${to_id}` post-expansion and keeps only the
higher-`votes` row wholesale (including its `metadata`), so any future collision between a range
and an overlapping single verse (or two overlapping ranges) *does* silently discard the loser's
`range_start`/`range_end`, exactly as the panel traced through the `Ps.148.4-5` / `Ps.148.5` example.
No unit test or in-tx invariant exists to catch a future recurrence — `buildEdgeRows` and
`dedupeEdgeRows` are exported and unit-testable but no test covers this overlap case (checked
`scripts/__tests__/openbible.test.mjs`... no such collision case present). Structural gap confirmed
real; blast radius is bounded to a future OpenBible.info data refresh, not the impending ingest.

**CDATA-2 verification.** Read `scripts/smoke-openbible.mjs:90-93` directly:
`check('legacy curated refs intact for 1 Nephi 3:7', legacy.n >= 0, ...)` where `legacy.n` is a
`count(*)::int`. Postgres `count(*)` cannot return a negative integer, so `legacy.n >= 0` is
true by construction for every possible result including `0` (i.e., total data loss on the legacy
`phase-b` collection passes silently). This smoke script is the explicit pre-deploy gate — the
ingest script's own header states the ingest runs against prod *before* the web deploy, and
`smoke-openbible.mjs`'s docstring says run it after ingest and before deploy. A tautological check
sitting in that gate is a live defect today, not a future-conditional one: it provides zero
protection right now, independent of whether live ingest has run. Independently converges with
observability's COBS-1 (same line).

**CDATA-3 verification.** Read the `ON CONFLICT (id) DO UPDATE SET` clause
(`scripts/ingest-openbible-refs.mjs:189-194`): `tier`/`category` are absent from the `SET` list
while present in the `INSERT` column list. Confirmed against `packages/scripture/src/schema.ts`
that both columns are real, `NOT NULL`, non-generated columns on `lumen.collections` — this is an
actual upsert-completeness gap, not a schema misunderstanding. Checked whether it can ever bite:
`'app'` and `'cross-references'` are inlined string literals in this script, so a same-code re-run
never needs to correct them — the gap only matters if a future edit changes either literal while an
existing `openbible` row survives from before that edit, in which case the column silently keeps
its stale value forever (no error, no log signal). Verified live risk is genuinely near-zero today,
consistent with the panel's own "cosmetic at current scale" caveat.

## Table

| ID | Tag | Stance vs. code-panel | Rationale (≤25 words) |
|---|---|---|---|
| CDATA-1 | risky | uphold (Medium) | Re-scan confirms zero live collisions; dedup's metadata-loss on range/single overlap is real but unguarded only against a future data refresh. |
| CDATA-2 | material | uphold (High) | `legacy.n >= 0` is a tautology by construction — the pre-deploy smoke gate provides zero legacy-data-loss protection today, not conditionally. |
| CDATA-3 | risky | downgrade-leaning (kept, not noise) | Upsert omits tier/category from SET; verified inert while values stay literal constants, but silently stale if either literal ever changes. |
