# Learnings — feature-workflow

Append-only rolling log. One block per completed feature. Most recent at top.

Cap: 50 entries. Older entries rotate to `state/archive/learnings-<YYYY-QN>.md`.

Read at: step 2 (Plan) of every feature flow — main agent loads this file plus the last 3 retros and surfaces overlapping-area entries into the new plan + panel-1 brief.

Read at: meta-retro — clusters and promotes recurring patterns into SKILL.md as rules; archives raw entries.

---

<!-- entries begin below; format:

## <YYYY-MM-DD> · feature: <slug> · tier: <tier>
- <key learning 1, ≤ 20 words>
- <key learning 2, ≤ 20 words>

-->

## 2026-07-03 · feature: graph-view · tier: large
- Variable-length Cypher paths explode before LIMIT; expand layer-by-layer with per-layer caps (bench-verified on prod hub).
- Unlabeled MATCH can't use per-label indexes on shared instances; label-union every node group, including scripts.
- Adversarial taggers refuted 6 findings (React remount, crash-boundary) by tracing vendored framework source — require traces before refactoring.
- Verify data-shape claims against the live store; ingest source can predate the graph (chapter id format).
- UI-heavy features need component-test infra up front; 6/24 bugs shipped repro-deferred without it.

## 2026-07-03 · feature: web-app-wiring · tier: standard
- Portals escape CSS-hidden wrappers; mount-gate portaled components with matchMedia, never `lg:hidden` classes.
- Mock-only loader tests hid every data-shape bug (D&C id collision, parallel edges); add real-data smoke assertions.
- Post-gate iteration reversing an approved decision (Q3) shipped 6/12 bugs; require plan-amendment + mini-panel.
- Streamed deferred promises need degraded-as-value AND a budget under RR's 4950ms turbo-stream abort AND Await errorElement.

## 2026-06-03 · feature: deploy-mcp-servers · tier: standard
- For Terraform features, add AWS resource name length assertions to harness — ALB 32-char limit invisible until `terraform apply`.
- Brief panel-1 with explicit traffic volume and SLA level; 54% noise rate came from enterprise-grade suggestions for 10-50 req/day internal tools.

## 2026-05-30 · feature: lumen-lambda-deploy · tier: standard
- Lambda init-error pattern (catch→store→re-throw) should be a template; 4/6 code-panel specialists found this independently.
- macOS `grep -E` treats `\|` as literal, not alternation — use `|` in ERE harness patterns to avoid cross-platform false failures.

## 2026-05-18 · feature: shared-infra-packages · tier: large
- Harness caught 0/11 bugs — error-path assertions (non-2xx, timeouts, message content) must match happy-path coverage.
- Assert mode-instruction tool references against actual tool list; dead refs invisible to functional tests.

## 2026-05-18 · feature: kedrec · tier: standard
- For porting tasks, mock the database layer in harnesses — all 5 code-review bugs were in unmocked data paths.
- Add Zod min/max constraints for values interpolated into non-parameterizable query syntax (depth ranges, type arrays).

## 2026-05-18 · feature: mcp-app-framework-spike · tier: large
- When 6+/8 specialists converge on one finding (JWKS caching), the plan had a lifecycle gap — add a completeness checklist pre-panel.
- For shared-package designs, resolve sync/async for every public-API callback before panel review to avoid breaking-change findings.

## 2026-05-13 · feature: multi-kb-mcp · tier: standard
- Code-adversarial found the only HIGH crash bug (toJson flattening) that 6 specialists missed — always verify hedged claims.
- For multi-store features, partial-failure handling belongs in implementation scope, not deferred as pre-existing.

## 2026-05-13 · feature: lumen-phase-b · tier: standard
- Checkpoint marking must follow DB writes, not parsing — 4 independent agents converged on this as the top bug.
- For script-only features, security code-panel yields zero signal; replace with a second prompt-quality specialist.

## 2026-05-12 · feature: ds-activate-mode · tier: standard
- When human gate adds scope (new tool), re-run harness author step — all 3 bugs were in the un-harnessed addition.
- Security code-panel rediscovered known-deferred auth gap; brief should exclude pre-existing deferred concerns.

## 2026-05-09 · feature: feature-workflow-skill · tier: large
- Adversarial framing ("be willing to disagree") produced 33% / 55% dissent — well above 20% threshold; keep verbatim.
- Synthesis self-consistency cross-check needed before human gate; 8/18 bugs were plan-stage drift between SKILL.md and references.
- For self-modifying / process-skill features, code-panel ~40% duplicates plan-stage panels; consider tier-specific panel sizing.

## 2026-05-09 · feature: migrate-api-to-hono · tier: large
- Cost-adversarial reframe ("don't pay for cost-only justification, do pay for DX") was the most valuable single finding; user override at gate confirmed.
- For code rewrites where the contract is pre-locked by prior docs and 60+ plan-stage findings are already implementation requirements, code-panel + code-adversarial yield is low — propose tier-sizing variant at next meta-retro.
- Hono + @cloudflare/workers-types `Request` type collision is a real DX papercut; document a wrapper/cast pattern in the next Hono-touching feature.

## 2026-05-09 · feature: consolidate-mcp-into-api · tier: standard
- 58% plan-stage adversarial dissent (highest yet). Panel-1 over-reached on infra for non-existent tools (per-tool authz, replay caches, Streamable HTTP).
- MCP 2025-03-26 spec REMOVED JSON-RPC batching; "reject array with -32600" is the correct posture.
- **REVERSAL of prior learning**: the "skip code-stage when plan-stage is comprehensive" hypothesis was wrong. After user pushback I ran code-stage retroactively and found 12 real bugs the harness couldn't catch. Two were stdio framing-corruption bugs only visible in code; uniquely findable by code-panel.
- Code-panel false positive: 4 of 6 specialists agreed `[ --]` regex was broken because they read rendered text rather than bytes; `od -c` proved the regex correct. Code-stage prompts must require byte-level verification for regex/encoding claims.


## 2026-07-07 · feature: canon-spine · tier: large
- canon-spine: live-data conventions (id prefixes, legacy tables) diverge from design assumptions; one prod SELECT during planning prevents in-tx aborts.
- canon-spine: DDL/gate logic kept inline is untestable — exported SPINE_DDL + p4Preflight let repro tests catch 2 Criticals.
- canon-spine: background panel agents stalled/died 4×; inline review of the same scope took 15 min. Critical-path roles should run synchronously.
- canon-spine: adversarial refuted 5 findings WITH repo evidence and rejected a heavy fix as risky — dissent working as designed, both directions.

## 2026-07-07 · feature: tske-cross-references · tier: large
- tske: never-throw degrade wrappers invert test semantics — a wrong-shaped mock passed 19/19 while every path silently degraded. Happy-path assertions are mandatory.
- tske: replacement features need a removed-behavior audit AT PLANNING (old path's filters/fields/labels vs new design) — the two product regressions were knowable from deleted code.
- tske: independent convergence ≈ certainty — the Critical was found by 4 reviewers with 2 repros; the tautology check by 5.
- tske: verify licenses before planning around a dataset — "TSKe is CC-BY" survived a whole session as false memory; one search flipped the source choice.

## 2026-07-08 · feature: art-graph · tier: standard
- art-graph: curated tag→entity maps must disambiguate per INSTANCE, not per tag — "judas"/"jacob" named different people per artwork (15 live wrong edges prevented).
- art-graph: combined-role reviewers (3 briefs w/ pre-seeded traps) matched 6-role quality at half the cost; every seeded trap confirmed a bug or verified clean.
- art-graph: panel-2 live-probing wrote exact prod expectations (16 Daniel skips) into the plan; the dry run matched to the row — plan-time data probes keep paying.

## 2026-07-08 · feature: strongs · tier: large
- strongs: reference CONTENT needs value assertions — existence checks passed while H430 shipped glossed '(Gibeath)-elohim' (executing the dedup against live files was the only way to see it).
- strongs: when a cap gate rejects, histogram ALL first-divergences before fixing — three rejections were three clean mechanical classes (en-dash, ligatures, 1769 spellings), zero debugging.
- strongs: one pre-plan source probe overturned the whole feature premise (fuzzy 83% → deterministic 93.5%); probe before you plan around a dataset.
- strongs: verify the counts of your verifiers — panel-2 corrected panel-1's divineName figure by 10× in the understating direction.

## 2026-07-10 · feature: supabase-auth · tier: large
- supabase-auth: a panel's RECOMMENDED FIX needs adversarial review as much as the bug — two proposed remedies (getClaims timeout; safeReturnTo regex `[\\:\s -]`) were themselves broken (would create a session-death bug; ate hyphen route slugs). Code-adversarial must re-run the proposed remedy against the same vectors.
- supabase-auth: probe the deploy target's LIVE behavior, not just its config API — settings said "email provider on" but a live verify-redirect probe proved Site URL unset (magic links → localhost:3000 today). One curl of real redirect behavior at plan time.
- supabase-auth: the highest-value plan-stage find was a would-ship-broken protocol mechanic (signInWithOtp writes the PKCE verifier cookie → login action MUST commit Set-Cookie) — invisible to the harness, only a docs-reading security specialist caught it. Auth features: read the SDK's cookie side-effects, don't infer them.
- supabase-auth: framework header-on-redirect semantics are unit-test-invisible — RR7 drops root-loader Set-Cookie on any thrown redirect short-circuit; our routes survive only by self-carrying headers. Verify header-merge behavior at plan time and encode it as a code invariant comment, not a test.
- supabase-auth: reframing the risk model beats enumerating risks — product-adversarial moved "hollow auth" (a non-problem) to "silent sign-out via dropped token rotation" (the real one), which directly authored harness H6; H6 then caught a fix-induced regression the same hour.

## 2026-07-11 · feature: user-roles · tier: large
- user-roles: 5 of 9 confirmed bugs were harness-origin — "totality"/"never-throw" tests that tried one benign value; H4 even pinned the µs-truncation bug as expected. Fixtures must carry the adversarial input.
- user-roles: a dedicated fix-verification pass (6 agents re-triggering each fixed bug) caught 3 residuals with green tests + clean typecheck (cast-range gap, a concealment regression, a dropped-dash typo). Verify fixes, don't trust the suite.
- user-roles: keyed workflow results by a prose `role` string the agents didn't echo → adversarial-B silently got [] to tag. Key by loop index or a constrained enum, never a trusted echo.
- user-roles: prod existence-concealment is unachievable when the route table ships in the client manifest — the ErrorBoundary re-throw removed the real leak (signed-in AccountChip/PII in the 404), which is what D10 actually needed.

## 2026-07-17 · feature: unshaken-ingest · tier: large
- unshaken-ingest: invocation wrappers are system-under-test — tee masked exit 2 on a failed:1 run; runners must own their log/exit surface.
- unshaken-ingest: fix-verification now 2-for-2 (3 more residuals on green suites, incl. a 30/30-repro'd silent log loss) — standing step for large tier.
- unshaken-ingest: adversarial live-data checks killed 3 harmful panel fixes — prune=archive data-loss; blanket index aborts on 1,578 real dups; PATH-only env breaks yt-dlp.
- unshaken-ingest: "incorporated" findings must pin INTEGRATION points — helper-tested/wiring-untested produced 3 of 10 bugs (scrub call-site, upsert clause, log convention).
- unshaken-ingest: first panel-2-origin bug (B3): a risky-tag rejection shipped the bug, but the synthesis's "flag for code-panel" pointer caught it — keep writing those pointers.

## unshaken-extraction (2026-07-18)

- **Measured-precision gates catch what review can't; review catches what
  gates can't.** Eval r1 failed entity 0.667 on error classes invisible in
  code (pool persons named "So"/"On", same-name collisions); code review
  found gate races and key divergence invisible to measurement. Run both.
- **fatal()-without-return is a CLASS, not a bug.** Fixed at one gate,
  found again at two more by fix-verification (streak now 3-for-3). Any
  fix to a recurring-shape bug sweeps ALL call sites in the same commit.
- **Fix the finding's MODE, not its example.** F12 fixed the cited
  utterance but not the next one; F14 fixed equality but not containment
  ("Sinai" in "Mount Sinai"). Verifiers caught both — write fixes against
  the failure mode statement.
- **A harness can PIN a bug** (H8 asserted the trap-marker leak as tested
  behavior). Adversarial review of the harness itself is part of eval
  design, not paranoia.
- **Workflows made re-runs free, which changed the process shape**: 4 eval
  rounds, full re-extraction after every fix tranche, 460 agents, $0
  external. When re-verification is free, verify after every change.
- **Coverage-first finders + adversarial verifiers**: 78 found, 9% killed.
  The layering works; don't ask finders to self-filter.
