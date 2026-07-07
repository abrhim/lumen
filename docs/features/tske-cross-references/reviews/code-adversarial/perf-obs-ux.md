# CODE-ADVERSARIAL — performance / observability / ux-a11y — tske-cross-references

Adversarial pass over `reviews/code-panel/{performance,observability,ux-a11y}.md`. Every
finding below was re-derived from source, not taken on the panel's word: `crossrefs.ts`,
`scripts/ingest-openbible-refs.mjs`, `scripts/smoke-openbible.mjs`, `scripts/setup-indexes.sql`,
`apps/web/app/routes/scripture.tsx`, `apps/web/app/lib/db.server.ts`,
`scripts/__tests__/openbible.test.mjs`, `scripts/migrate-canon-spine.mjs`,
`scripts/smoke-canon-spine.mjs`, and `docs/features/tske-cross-references/plan.md`, against the
stated context (0 users, ~614k edges post-ingest, max verse fan-out ~2,000, live ingest not yet
run).

## Performance

**Stance:** No blocking issues. All 6 findings verified accurate against code; the panel's own
severities already tell the real story — CPERF-1/4/5/6 are confirmed-but-inert at current scale,
CPERF-2 is a real but low-impact asymmetry, and CPERF-3 is the one item worth an explicit human
check before the still-pending live ingest.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| CPERF-1 | noise | Confirmed unindexed sort-before-LIMIT (`crossrefs.ts:44-64`); panel itself concludes no fix needed at ~2k max fan-out. |
| CPERF-2 | risky | Confirmed: `idx_edges_from_rel` exists, no `idx_edges_to_rel` (`setup-indexes.sql`); smoke only EXPLAINs outgoing. Negligible cost today (1 rel_type, 2 collections). |
| CPERF-3 | material | Confirmed single 2-4min write-locking tx (`ingest-openbible-refs.mjs:187-227`); live ingest hasn't run — timeout check is a real pending action. |
| CPERF-4 | noise | Heap math checks out (~614k × ~200-350B ≈ 150-250MB); one-time local/CI run, no `--max-old-space-size` needed. |
| CPERF-5 | noise | Confirmed chapters join runs exactly once at ingest start (`ingest-openbible-refs.mjs:149-156`); correctly scoped non-issue. |
| CPERF-6 | noise | Confirmed 6-way `Promise.all` vs pool `max:5` (`scripture.tsx:343-364`, `db.server.ts:32`); worst case one queued query, trivially small. |

## Observability

**Stance:** The most consequential table. Four material findings all trace to the same theme —
the pre-launch verification surface (smoke checks, dry-run logs, boundary tests) has real,
verified gaps right at the moment they matter most, since the live ingest has not run yet.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| COBS-1 | material | Confirmed `legacy.n >= 0` (`smoke-openbible.mjs:93`) — `count(*)` is never negative; the hybrid legacy-path guard can never fail. |
| COBS-2 | material | Confirmed 2 `VERSIFICATION_EXCEPTIONS` entries (`ingest:28-31`) but smoke only canaries 3John (`smoke:68-71`); Rev.12.18→rev-13-1 ships unverified. |
| COBS-3 | material | Confirmed dry-run throw (`ingest:222`) precedes `tx_done` log (`:223`); `ingest_done`'s `edges` field is post-dedupe count, not deleted/inserted. |
| COBS-4 | material | Confirmed ratio/cap check inlined in `main()` (`ingest:177-181`), untested; plan.md:153 explicitly requires a boundary-value unit test (amendment 7). |
| COBS-5 | risky | Confirmed `crossref_degraded` (`scripture.tsx:144-148`) omits `elapsedMs`/split book-chapter vs `graph_degraded`; `verse` id already encodes both, so real loss is modest. |
| COBS-6 | risky | Confirmed `postgres()` outside try/catch in `ingest:142`/`smoke:19`. "Mirrors migrate-canon-spine.mjs" is wrong — that file wraps it; only `smoke-canon-spine.mjs` shares the gap. |
| COBS-7 | noise | Confirmed: `openbible_unmapped_refs` rounds via `toFixed(5)` (`ingest:174`), `openbible_unmapped_threshold` logs raw float (`:178/181`). Cosmetic only. |
| COBS-8 | noise | Confirmed `dataFile: 'data/openbible/cross_references.txt'` literal (`ingest:130`) duplicates `DATA_FILE` const (`:21`). Real DRY gap, zero functional impact. |

## UX / A11y

**Stance:** All three findings verified as real, code-confirmed defects, not review artifacts.
CUX-1 is the sharpest — it doesn't just miss an a11y requirement, it inverts the one the plan
explicitly called out (A11Y-2).

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| CUX-1 | material | Confirmed `aria-live` on synchronous `CrossRefsSection` (`scripture.tsx:956`); the actually-streamed `Connections`/`EntityChips` (via `Await`, `:869-871`) has none. |
| CUX-2 | material | Confirmed fixed 1-block/2-card `CrossRefsSkeleton` (`:889-904`) vs real 0-2-group/0-40-card output; `isPending` (`:455`) fires it on every same-chapter nav. |
| CUX-3 | material | Confirmed plan.md:171 says credit sits "under the References header"; code (`:973-995`) renders it after BOTH groups, under "Referenced by." |

