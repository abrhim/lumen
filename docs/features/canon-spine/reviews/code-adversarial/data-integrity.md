# CODE-ADVERSARIAL — Data Integrity (canon-spine)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| CDATA-1 | material | Verified: unconditional `DROP TABLE`/`CREATE` for `lumen.words` in P1, unlike every other table's `IF NOT EXISTS`. Wipes real rows; fix is one word. |
| CDATA-2 | material | Verified 2-3 row fan-out per id (e.g. `'dc'`) in `lumen.nodes`, the plan's own named single-lookup surface for edge endpoints (scope item 4). Cheap doc/ordering fix. |
| CDATA-3 | material | Verified: design doc P4 explicitly promises entities "deprecate"; grep of P1+P4 blocks shows zero UPDATE doing it. Real broken promise, few-line fix. |
| CDATA-4 | noise | `bookSortOrder` in ingest-phase-a.ts is one global counter, so no two books can ever share `(volume_id, sort_order)` — the feared collision is structurally impossible today. |
| CDATA-5 | risky | Real gap (marker checked by existence only), but proposed fix (hash/snapshot freshness binding) is nontrivial versus a low-likelihood risk under the documented single-runner, human-gated P4 flow. |
| CDATA-6 | material | Verified: P4 block logs completion but never writes a `migration_state` row, unlike P1's `canon-spine-p1` marker. Trivial one-INSERT fix, real audit gap on an irreversible op. |
| CDATA-7 | noise | Confirmed no code path outside this exclusion writes `collection_id` on volume/book/chapter entities; panel's own notes call it harmless today. Purely speculative, already-accepted per plan DATA-2. |

## Stance

Read `scripts/migrate-canon-spine.mjs`, `scripts/backfill-neo4j-collections.mjs`, `scripts/smoke-canon-spine.mjs`, `scripts/ingest-phase-a.ts`, `docs/design/canon-spine.md`, and `docs/features/canon-spine/plan.md` in full to verify each claim against actual code rather than the panel's characterization. CDATA-1 is a genuine, cheap-to-fix Critical bug that directly violates the plan's own idempotent-re-run public contract and should block sign-off before any P1 re-run against prod. CDATA-2, CDATA-3, and CDATA-6 are real, verified gaps against explicit plan/design promises with trivial fixes, so they stay material rather than being smoothed into risky. CDATA-4 and CDATA-7 are downgraded to noise: both describe failure scenarios that are provably impossible or already-inert given the actual current write paths (mirroring the plan's own precedent of refuting DATA-6/DATA-8 with repo evidence rather than accepting a plausible-sounding but unverified collision). CDATA-5 survives as risky — the underlying staleness gap is real, but the suggested hash/snapshot remediation is disproportionate to the actual risk given the documented single-runner, human-gated invocation pattern for P4.
