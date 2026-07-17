# Bugs — unshaken-ingest (A1)

Step-11 filter over 22 code-round findings (3 panel + 3 adversarial files,
all tags evidence-backed, several by executed repro). Carve-outs enforced;
adversarial refutations honored where execution disproved the mechanism.

## Confirmed bugs

### B1: Partial-failure exit code masked by tee invocation
- Severity: med · Categories: correctness, operability
- Source: CPIPE-3 (adversarial RAISED to material) + CPIPE-7 (subsumed)
- Raised_by: [code-panel/pipeline, code-adversarial/pipeline, orchestrator-seeded]
- Description: runner computes exit 2 correctly; the `tee`-piped invocation
  reported 0 on `failed:1`. Unattended weekly runs would silently miss
  episodes. Fix: runner OWNS a per-invocation-NAMED log file
  (`run-<ts>-<pid>.log` via fs.createWriteStream) — kills the tee dependency
  AND the shared-log collision that broke the monitor (CPIPE-7).
- Repro test path: pending · Fix commit: pending

### B2: Collection upsert reverts Phase B's public flip on every re-run
- Severity: med · Categories: correctness, data
- Source: CCOR-3 (adversarial: material; fix verified safe — INSERT still
  seeds first ingest)
- Raised_by: [code-panel/correctness, code-adversarial/correctness]
- Description: `public = EXCLUDED.public` + hardcoded false un-publishes the
  collection on the first weekly re-run after B flips it. Fix: drop `public`
  from the ON CONFLICT SET list; INSERT keeps seeding false.
- Repro test path: pending · Fix commit: pending

### B3: Whole-book search block-label renders "Joshua 1"
- Severity: high (aggregation rule: highest assigned) · Categories: correctness
- Source: CCOR-2 (panel high, executed repro; adversarial risky —
  deferred-consumer argument; carve-out forbids demotion; CON-5's rejected
  guard is the lineage)
- Raised_by: [code-panel/correctness, code-adversarial/correctness (repro ×2)]
- Description: `end=null` spans render `"Joshua 1"` in the C-weight label —
  wrong on 3 of 10 live episodes. Fix: whole-book → book name; single →
  "Book N"; range → "Book A-B". Re-load refreshes live rows.
- Repro test path: pending · Fix commit: pending

### B4: scrubSecrets known-key fallback is dead code
- Severity: med · Categories: security
- Source: CSEC-3 (adversarial: no reachable leak today — key only appears
  Token-prefixed, already scrubbed — but the wired-looking defense is unwired;
  env-set fix REJECTED as 47bf9d2 regression)
- Raised_by: [code-panel/security, code-adversarial/security (repro ×2)]
- Description: fallback reads an env var nothing sets. Fix: pass
  `{extraSecrets:[apiKey]}` explicitly at index.mjs scrub call sites.
- Repro test path: pending · Fix commit: pending

### B5: Non-atomic deepgram.json write (+ documented m4a race posture)
- Severity: high (CSEC-1 panel high; carve-out) · Categories: security, data
- Source: CSEC-1 + CSEC-4 (dedup: same race family; adversarial — locks
  REJECTED as stale-lock deadlock; ONLY temp+rename endorsed; truncated-JSON
  self-heal verified but double-transcribe costs real credit)
- Raised_by: [code-panel/security, code-adversarial/security]
- Description: concurrent runners can interleave on `deepgram.json`
  (writeFileSync, no rename). Fix: write `.tmp` then rename (atomic); m4a
  side documented as protected by yt-dlp's own .part+rename (asserted in H3);
  no locks.
- Repro test path: pending · Fix commit: pending

### B6: episodes.json not committable despite plan contract
- Severity: low · Categories: contract
- Source: CPIPE-9 (also VOIDS REL-4's plan-stage rejection rationale — logged)
- Raised_by: [code-panel/pipeline, code-adversarial/pipeline]
- Description: `.gitignore` `data/` has no negation; plan:72 promises
  committed/reviewable. Fix: `!data/podcasts/*/episodes.json` + commit the
  manifest (2,965B).
- Repro test path: n/a (config) · Fix commit: pending

### B7: --stage values unvalidated; load/transcribe silently cascade paid stages
- Severity: med · Categories: correctness, cost
- Source: CPIPE-6 (+ --stage=transcribe confirmed same shape) + CCOR-7 folded
  (opaque --episode-no-match TypeError → clear validation error, same guard
  block)
- Raised_by: [code-panel/pipeline, code-adversarial/pipeline, code-panel/correctness]
- Description: unknown --stage accepted; --stage=load with missing artifacts
  re-runs fetch+transcribe ($). Fix: whitelist stage values; per-stage
  prerequisite check with actionable error; --episode membership validated
  with a clear message.
- Repro test path: pending · Fix commit: pending

### B8: Rest-fetches blocked behind probe chain (Amendment-1's cheap half)
- Severity: med · Categories: performance, plan-drift
- Source: CPIPE-1 (adversarial: risky — but the "fetches proceed underneath"
  promise has a ~5-line fix; the full CPIPE-2 streaming rewrite stays
  rejected as disproportionate)
- Raised_by: [code-panel/pipeline, code-adversarial/pipeline, orchestrator-seeded]
- Description: `await runChain(probe)` precedes the rest pool entirely. Fix:
  start rest FETCHES concurrently with the probe chain; keep the
  probe-transcribe gate. CPIPE-2 (fetch→transcribe barrier) becomes honest
  plan text instead (see amendment 3).
- Repro test path: pending (structural) · Fix commit: pending

### B9: CON-7 stage roll-ups partially unimplemented + untimestamped logs
- Severity: low · Categories: contract, observability
- Source: CPIPE-5 (CON-7 was `incorporated` — a Decisions contract) + CPIPE-4
  (house `at:` convention; the stall was dated by mtime forensics, not logs)
- Raised_by: [code-panel/pipeline, code-adversarial/pipeline]
- Description: only discover rolls up; no timestamps. Fix: `at: Date.now()`
  in log(); `<stage>_stage_done {ok, failed, billed_seconds_sum}` per stage.
- Repro test path: pending · Fix commit: pending

### B10: Metadata/search store stale discover-time parse while edges re-parse
- Severity: low · Categories: correctness
- Source: CCOR-4 (adversarial: real-but-narrow; panel fix endorsed)
- Raised_by: [code-panel/correctness, code-adversarial/correctness]
- Description: loadEpisode re-parses for anchors but stores cached
  ep.spans/subtitle. Fix: single parse at load feeds anchors AND stored
  metadata/search.
- Repro test path: pending · Fix commit: pending

## Needs investigation

### N1: CCOR-1 orphaned-episode pruning (carve-out: correctness-high)
- Source: CCOR-1 (panel high) · adversarial: noise + fix-harmful
- Investigation outcome: adversarial's design reading CONFIRMED against the
  portability invariants ("weekly ingestion of the NEW episode") and Q1's
  scope ("10 most recent" describes THIS ingest, not a forever-window). The
  archive is a library, not a rolling window; the proposed prune would
  delete history — a data-loss fix. Legitimate sliver (retitle/delete
  reconciliation) deferred to the workflow-hosting feature.
- Disposition: NOT a bug; design semantics documented in amendment 3.
  Carve-out honored via this recorded investigation, not silent demotion.

## Preference (captured for learnings)
- CCOR-6: cross-book titles admit empty subtitle (fail-closed inconsistency;
  no plausible live title) — grammar polish note.
- CCOR-5: transcribe cache deliberately ignores keyterm/model drift —
  documented as design in amendment 3 (adversarial: re-costing is worse).
- CPIPE-10: `<id>.load.json` never written — plan line dropped in amendment 3.

## Out-of-scope
- Episode retitle/delete reconciliation → workflow-hosting feature.
- True streaming pipeline (CPIPE-2 rewrite) → workflow-hosting fan-out makes
  it moot.

## Refuted with executed evidence (retro record)
- CSEC-2 (unguarded init leaks): malformed-DSN throw carries no password;
  proposed fix double-throws. CSEC-5 (env quoting): fails loud, not silent;
  live .env clean. Both noise.

## Known-wart log (pre-review, from step 8b)
- W1 upload_date "NA" → Phase B backfill (CON-4 ruling). W2 jsonb-as-string
  driver habit → smoke fixed; B-loader rule recorded.
- Step-8 fix log: env-key plumbing (47bf9d2) · batching+timeouts (0e485b6) ·
  monitor terminal-pattern kill (workflow note).

## Provenance histogram (for retro)
| Origin | Count | Which |
|---|---|---|
| Should have been caught by plan | 3 | B6 (contract never wired to impl), B7 (CLI "deliberately loose" = under-spec), B8 (Amendment 1 promised what design review never checked) |
| Should have been caught by harness | 3 | B2 (REL-8 pinned values, not upsert-clause semantics), B4 (scrub fn tested, wiring untested), B9 (CON-7 explicitly "not test-pinned") |
| Should have been caught by panel-1 | 0 | |
| Should have been caught by panel-2 | 1 | B3 (CON-5 raised it; tagged risky; guard rejected; bug shipped) |
| Genuinely emergent / refactor artifact | 3 | B1 (invocation wrapper, not code), B5 (operational concurrent-runner pattern), B10 (two-parse-sites artifact) |
