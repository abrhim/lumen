# Retro — canon-spine

Shipped 2026-07-07: normalized spine (volumes/books/chapters/verses/words) live
in prod, 1,195,361 words tokenized, transition columns dropped (P4), 41k edge
endpoints aligned, art catalog ingested (4,461 works), web deployed on spine.

## 1. Plan accuracy
**Drift: 2/5.** Implementation matched the plan's shape closely; three
live-data surprises forced deviations the plan couldn't have specified but
should have probed: summary ids are prefixed not suffixed, a legacy empty
`lumen.words` existed in prod, and the deferred `X-ch-N` edge alignment turned
out to gate the smoke pass (pulled into scope with human approval).

## 2. Panel signal vs noise
- Plan stage (panel-1/panel-2): 69 findings, dissent 0.797 (recorded at synthesis).
- Code stage: 46 raw → 40 canonical; adversarial tags: **25 material / 3 risky
  / 10 noise / 2 out-of-scope** → dissent rate **0.70**.
- Adversarial earned its keep both directions: killed the heavy hash-binding
  fix as risky AND refuted 5 plausible findings with repo evidence (global
  sort counter, PK-join scans, tx rollback) instead of rubber-stamping.

## 3. Harness coverage delta
Of 21 confirmed bugs, 7 were harness-attributable gaps (see histogram):
- Nothing asserted DDL shape (B1 words-DROP, B2 words-RLS) — fixed by
  exporting SPINE_DDL and testing it like data.
- p4Preflight logic existed only as inline code (B5) — pure-function extraction
  made it testable.
- Parity pairs covered 3 of 10 queries (B14); loader had no query-count guard
  (B18); getVerseByReference/getBook/getVolume untested (B15).
- The in-tx invariants (the live half of the harness) worked exactly as
  designed: summaries_resolve_to_chapters caught the prefix bug 1582/1582 on
  the first prod dry run with zero data committed.

## 4. Wasted effort
Background-agent infra flakiness, not review design, was the biggest waste:
correctness stalled twice and observability died twice on connection errors
(4 dead invocations, ~40 min wall-clock) before both reviews were done inline
in ~15 min. The security agent completed but never wrote its file (persisted
from its returned table). Nothing else under-earned: even the noise-heavy
performance panel produced CPERF-7/CPERF-8, which changed the prod run.

## 5. Recommendations
1. Probe live id/shape conventions with one SELECT during planning — the
   summary-prefix and legacy-words surprises were each one query away.
2. Export script constants (DDL, gate predicates) and harness-test them like
   data; inline-only logic is where Critical bugs hid.
3. Run code-panel roles inline (or synchronously with one retry) when they
   gate the critical path; background stalls cost more than parallelism saves.

## 6. Quality signals
```json
{
  "feature_slug": "canon-spine",
  "tier": "large",
  "plan_to_code_drift": 2,
  "panel_2_dissent_rate": 0.70,
  "post_merge_bugs_caught": null,
  "panel_agent_invocations": 30,
  "bug_yield_per_panel_agent": 0.7,
  "skill_version": "9e035de"
}
```

## 7. Provenance histogram
| Origin | Count |
|---|---|
| Should have been caught by plan | 3 (B3, B4, B21) |
| Should have been caught by harness | 7 (B1, B2, B5, B6, B14, B15, B18) |
| Should have been caught by panel-1 | 2 (B7, B17) |
| Should have been caught by panel-2 | 0 |
| Genuinely emergent / refactor artifact | 9 (B8–B13, B16, B19, B20) |

Post-plan live-data bugs (summary prefix, legacy words, edge drift blocking
smoke): all three "plan" in spirit — none was findable without querying prod,
which is recommendation 1.
