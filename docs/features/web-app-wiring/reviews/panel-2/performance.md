# Panel-2 Adversarial Review — Performance (web-app-wiring)

| ID | Tag | Rationale (≤ 25 words) |
|----|-----|------------------------|
| PERF-1 | material | Confirmed in queries.ts: JOIN + fallback query × N volumes via Promise.all. Real N+1-ish pattern, proportionate single-query fix exists. |
| PERF-2 | risky | Restates PERF-1, but fix argues to override plan's deliberate "PG uncached this phase" scope decision — re-litigating a made call. |
| PERF-3 | material | Confirmed: fixed 20s AbortSignal.timeout for all calls. One-line constant change, proportionate fix, real UX/billing exposure on Aura cold-resume. |
| PERF-4 | risky | Real uncached payload, but same move as PERF-2: contests an explicit, deliberate scope exclusion rather than flagging a bug. |
| PERF-5 | noise | Speculative ("Possible..."), asks to "confirm" standard Workers fetch connection-pooling behavior. Due-diligence busywork, no code implicated. |
| PERF-6 | noise | Panel-1 itself concludes "accept... note as accepted risk, not a bug." Self-admitted non-actionable at near-zero traffic. |
| PERF-7 | noise | Duplicate root cause of PERF-1 (same query). Proposed fix contradicted by its own text: volume_id is JSONB, not a column. |
| PERF-8 | noise | Premise falsified by harness: headers.server.test.ts already shows one `applySecurityHeaders` transform, not per-loader logic. Warns against a non-issue. |
| PERF-9 | noise | Explicitly "no code change needed, just document as accepted cost." Self-admitted non-actionable observation. |
| PERF-10 | out-of-scope | Proposes cron keepalive Worker — the exact idea the user already questioned and deferred; also Phase 5 deploy/ops territory per plan's Out-of-scope list. |

## Overall stance

Two real findings (PERF-1, PERF-3) have proportionate, cheap fixes and should land. PERF-2 and PERF-4 correctly identify the same underlying gaps as PERF-1 but overreach by asking to reverse a scope decision the plan author already made deliberately (and reasonably, given Hyperdrive's edge query caching and ~zero traffic) — that's a scope debate dressed as a bug, not a fix-sized finding. The bottom half of the list (PERF-5 through PERF-9) is mostly speculative or self-admittedly non-actionable, and PERF-8 is flatly contradicted by the existing test harness. PERF-10 reintroduces the Neo4j keepalive cron the user explicitly deferred — out of scope twice over.
