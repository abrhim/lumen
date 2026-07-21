# Panel-2 — adversarial tags for correctness

| ID | Tag | Rationale (≤25 words) |
|----|-----|------------------------|
| COR-1 | material | Plan line 42 promises 'never 500'; decision 7 specifies no isolation, and api-search.test.ts:110-118 pins searchAll rejection to 500. Real inconsistency. |
| COR-2 | material | Verified: H8 lines 185-188 exempt the whole scripture group; jst is a separate collection (31,262 entities) planned inside it. A leak passes the harness. |
| COR-3 | material | Reprobed: to_tsvector('english','agapē') @@ plainto_tsquery('agape') is false. H7 fails unless M4 applies unaccent; plan installs it but never uses it. |
| COR-4 | material | Reprobed: 23 Zechariah persons share only 4 distinct ranks — tie groups straddle LIMIT 8, so page membership is nondeterministic. Stable id tiebreak is correct. |
| COR-5 | material | Length-normalized ts_rank provably shifts under dual vector (probe 0.0608→0.0384); 'behavior unchanged' overclaims the cross-system Ring-2 invariant ratified at the gate. |
| COR-6 | material | Verified slug-map.ts:141-151: humanMatch lacks the ch>0 guard the slug path has; short-circuit fires on unresolvable parses, skipping FTS and returning nothing. |
| COR-7 | material | Verified H15 lines 133-144: sum-based coverage passes when a gap and an overlap cancel. Per-window chain assertion is strictly stronger; contiguity precondition is unasserted. |
| COR-8 | material | Reprobed: t_start_s numeric(9,3) returns JS string '8990.650'; 113 timing overlaps confirmed. Decision 9's gap logic misbehaves silently without coercion and negative-gap handling. |
| COR-9 | risky | Probed: unshaken public=true deliberately (launched 2026-07-21, kill-switch design). Suggested flip would unship a live feature; H8 passes explicit lists, so the mechanism is unaffected. |
| COR-10 | noise | Probed pg_typeof: both boost formulas times ts_rank resolve to double precision, JS typeof number. No string-score path exists in the planned formula. |

## Stance

Mostly signal: 8 of 10 findings survive adversarial re-probing and would materially change what ships — the JST fail-closed gap, unapplied unaccent, missing group error isolation, and the dead-end reference short-circuit are genuine catches backed by evidence. Two fail verification: COR-10's numeric-string premise is refuted by live type-resolution probes (score expressions resolve to double precision), and COR-9 misreads the deliberate unshaken public launch — its primary fix would regress a shipped feature.