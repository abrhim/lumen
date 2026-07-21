# Panel-2 — adversarial tags for observability

| ID | Tag | Rationale (≤25 words) |
|----|-----|------------------------|
| OBS-1 | material | Q7 posture is 'measurement only' yet plan specifies no query logging; verified logEvent house helper + wrangler observability make the fix precedented and cheap. |
| OBS-2 | material | Plan line 42's silent empty-group degradation is real: search_index has only episode rows today; graph_degraded precedent verified at scripture.tsx:287. |
| OBS-3 | material | Verified api-search.test.ts:110-118: route catches and scrubs the error, so without a logEvent the 500 leaves zero trace anywhere. |
| OBS-4 | material | Plan states prod p95<500ms with only laptop-side H12; probe table shows RTT-dominated ~62ms floor — budget is unverifiable without per-group prod timing. |
| OBS-5 | noise | No feature dir has harness-final.log (verified: strongs/unshaken-ingest/user-roles keep initial only); laptop actual is RTT-dominated, superseded by OBS-4's prod path. |
| OBS-6 | material | 'House pattern' demonstrably doesn't self-execute: repo drifted across COMMIT=1 vs --dry-run vocabularies (verified), so unstated conventions for M3/M4 script output are a real gap. |
| OBS-7 | noise | entity_degree builds inside migrate-search-projections.mjs (plan files list), covered by OBS-6/OBS-9; proposed count invariant is self-satisfying at build time, no runner exists later. |
| OBS-8 | noise | Solo-dev beta, <1k req/day (plan.md:20); sole admin is the owner, and the mirrored preview path (scripture.tsx:394) has no elevation audit today either. |
| OBS-9 | material | Verified: no script reads DRY_RUN; canon-spine:162 and user-roles:120 are apply-by-default. Plan's false 'DRY_RUN=1 default' claim invites an accidental prod write. |

## Stance

Mostly signal — unusually strong panel-1 work. Six of nine findings are material, every file:line citation I checked verified exactly, and the core insight (plan commits to a "measurement only" posture and a prod p95 budget while specifying zero logging) is a real plan defect with cheap, precedented fixes. The three I demoted are peripheral: a durable-log convention no prior feature uses, a tautological staleness invariant, and audit trail for a solo admin auditing himself.