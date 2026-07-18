# Retro — unshaken-ingest (A1)

Ten Unshaken CFM deep-dive episodes ingested into prod: 10 `content_item`
entities, 39,459 timestamped transcript rows, 184 title-parsed `DISCUSSES`
anchors, 10 weighted search projections — via the new reusable 4-stage
pipeline (discover/fetch/transcribe/load; extract reserved for A2), the
`lumen.transcripts` + `lumen.search_index` migration, and $20.82 of
Deepgram's free credit (45.07h audio). Collection dark (`public=false`)
until Phase B. One session end-to-end: probes → plan → panels → gate →
implement → live run → code review → fix round → fix-verification.

## 1. Plan accuracy

**Drift: 2/5.** Architecture held exactly — stages, artifacts, schema,
anchors, search projections all as planned. Three amendments, none a
reshape: A1 (user-added concurrency model), A2 (harness-revision: two
statement finders collided with COR-1's own mandated DELETE pass), A3
(post-fix honesty: the concurrency prose overstated the implementation;
archive semantics; cache-by-design; two artifact-line corrections). The
biggest planning win was the probe round: 3 of 5 probes overturned
assumptions before a line was written (title grammar = 4 variants not 1;
creator chapter markers absent despite web claims; entity density lives at
VERSE granularity — recorded for A2). The biggest planning miss: Amendment
1 promised pipelining the implementation didn't deliver — caught by
code-panel with mtime forensics, resolved half in code (B8) and half in
honest text.

## 2. Panel signal vs noise

- **Plan round** (4 combined briefs → 32 findings; 4 Opus taggers):
  dissent 0.625. Two refutations by live evidence (yt-dlp `.part` default;
  1,578 phase-b duplicate edges killing the blanket unique index — the
  proposed fix would have ABORTED the migration). Safety carve-out
  exercised once (SEC-3, fix amended to subtractive env).
- **Code round** (3 combined briefs → 22 findings; 3 Opus taggers):
  dissent 0.909 by tags, but the filter's carve-outs + ≥2-reviewer rule
  yielded 10 confirmed bugs — every one real, several empirically
  reproduced by the finders themselves. Adversarial's best work: the
  causal correction (run-1's 14-min idle was the load stall, not the
  fetch barrier) and three harmful-fix kills (prune = archive data loss;
  PATH-only env; stale-lock deadlocks).
- **First-ever panel-2-origin bug**: B3 (whole-book "Joshua 1" labels) —
  CON-5 raised it at plan stage, the tagger called its guard risky, the
  synthesis recorded "flagged for code-panel attention," and code-panel
  caught it exactly there. The pointer worked; the tag was still wrong.
- Emergent cross-agent dedup appeared TWICE (a specialist reading sibling
  files mid-review and dropping duplicates) — unprompted, both times
  net-positive.

## 3. Harness coverage delta

51 tests (12 title fixtures from LIVE data + hostile synthetics carried
the adversarial-input lesson well — zero grammar bugs shipped). The gaps
that let bugs through repeat one shape: **functions tested, wiring
untested** — B2 (upsert-clause semantics unpinned), B4 (scrub fn tested,
call-site never), B9 (CON-7 explicitly "implementation-verified" = never
verified). Next-harness seed: every `incorporated` finding needs its test
to pin the INTEGRATION POINT, not the helper. Second seed: the invocation
wrapper is part of the system under test — the tee pipeline masked exit 2
and no test could see it because the harness stops at the runner's edge.

## 4. Wasted effort

- The 12-minute load stall (per-row INSERTs through the pooler) cost ~15
  live minutes + a fix cycle — the openbible batching pattern was in the
  repo all along; I re-derived instead of copied. Cheap tuition.
- Panel-2's REL-4 rejection was voided two rounds later by CPIPE-9 (its
  rationale assumed a committed episodes.json that wasn't) — rejection
  rationales should cite verified facts, and this one didn't.
- Monitor self-killed on the RETRY's run_done (shared log + terminal
  pattern) — one load event observed only via the DB. Fixed structurally
  by B1's per-invocation logs.
- Orchestrator counting slips ×4 (test counts, resolution tallies) — all
  caught by review passes, none material, but the pattern is real: counts
  asserted from memory instead of recounted.
- Everything else earned its keep. Fix-verification is now 2-for-2 across
  features: 4 agents, 3 residuals on green suites (a permanent
  corrupt-manifest wedge; silent total log loss on fatal, 30/30 repro; a
  label-fidelity gap) — plus one verifier accidentally stress-testing
  concurrent log uniqueness via its siblings.

## 5. Recommendations

1. **Promote fix-verification to a standing step for tier ≥ large**
   (meta-retro candidate): two features, six residuals, all invisible to
   green suites.
2. **Test the outermost layer**: invocation wrappers (tee, shells, cron)
   are system-under-test; a runner must own its exit/log surface end-to-end.
3. **Incorporated findings pin integration points** — the helper-tested/
   wiring-untested gap produced 3 of 10 bugs.
4. **Rejection rationales cite verified facts** — one rejection rested on
   an unverified "committed/reviewable" that wasn't true.
5. **Live-data checks belong in adversarial briefs permanently**: the two
   best calls of the feature (phase-b dup count; archive-growth semantics)
   both came from taggers querying prod instead of reasoning from the plan.

## 6. Quality signals

```json
{
  "feature_slug": "unshaken-ingest",
  "tier": "large",
  "plan_to_code_drift": 2,
  "panel_2_dissent_rate": 0.625,
  "code_round_dissent_rate": 0.909,
  "post_merge_bugs_caught": null,
  "panel_agent_invocations": 14,
  "fix_verification_agents": 4,
  "bug_yield_per_panel_agent": 1.67,
  "preplan_probes": 5,
  "probes_overturning_assumptions": 3,
  "tests_added": 51,
  "deepgram_billed_hours": 45.07,
  "deepgram_credit_spent_usd": 20.82,
  "skill_version": "a90350d"
}
```

`panel_agent_invocations` = plan (4+4) + code (3+3); verification (4)
listed separately — they verify, not find. `bug_yield` = 10 confirmed /
6 code-round agents.

## 7. Provenance histogram

| Origin | Count | Which |
|---|---|---|
| Should have been caught by plan | 3 | B6 (contract never wired), B7 (CLI deliberately under-specced), B8 (Amendment 1 over-promised) |
| Should have been caught by harness | 3 | B2, B4, B9 (the wiring-untested cluster) |
| Should have been caught by panel-1 | 0 | |
| Should have been caught by panel-2 | 1 | B3 (CON-5 tagged risky; bug shipped; flagged-pointer caught it at code-panel) |
| Genuinely emergent / interaction | 3 | B1 (invocation wrapper), B5 (operational concurrency), B10 (two-parse-sites artifact) |

## Deploy

Prod state: migration applied (6/6 invariants), 10 episodes + transcripts
+ anchors + search rows live and re-load-verified; collection
`public=false` (Phase B's deliberate flip is now re-run-safe — verified by
a rolled-back live rehearsal of that exact future). smoke-media 10/10,
smoke-vocab clean (DISCUSSES/content_item/podcast now live). No app
deploy — A1 ships data + pipeline only. Follow-ups queued: A2 extraction
(plans against these transcripts; candidate pool correction recorded),
Phase B surfaces (parallel), W1 upload-date backfill (B's, per CON-4).
