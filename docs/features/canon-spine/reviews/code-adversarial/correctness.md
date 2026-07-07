| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| CCOR-1 | material | High, confirmed real: rewritten `queries.ts` already targets spine tables; plan/script mention blast radius but no explicit deploy-order gate. Survives per Critical/High rule. |
| CCOR-2 | material | Confirmed: `parityPairs` (3 entries) omits books entirely — no check on dc row, sort_order, or volume_id mapping. Cheap fix, real coverage gap. |
| CCOR-3 | noise | Confirmed code, but whole P1 runs in one tx — FK violation still safely rolls back everything; only effect is an uglier error message. |
| CCOR-4 | noise | Confirmed `ORDER BY sort_order` alone, but `home.tsx` (sole caller) always regroups per-volume and re-sorts client-side — finding itself concedes no user impact. |
| CCOR-5 | out-of-scope | Confirmed regex, but corpus is verified 100% ASCII today; finding explicitly scopes itself to a hypothetical future tradition, not current behavior. |
