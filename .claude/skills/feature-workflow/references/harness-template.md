# Harness template

The harness is the **executable contract** for a feature. Written before implementation when the feature has `behavior` scope.

## What a good harness asserts

1. **Public contract.** Every endpoint, exported function, or user-visible flow named in the plan has at least:
   - One happy-path test.
   - One failure-mode test.
2. **Plan invariants.** Every claim in the plan ("X is idempotent", "Y is transactional", "Z handles partial failure") has a test that would fail if the invariant is violated.
3. **Stated failure modes.** Every entry in the plan's `## Failure modes` section has an explicit test.

## What a good harness does NOT assert

- Implementation details (private helpers, internal data structures).
- Coverage ratios as a goal.
- Behaviors not in the plan ("future-proofing").
- Things the framework already guarantees (e.g., type-checked enum values).

## Harness scope by feature type

| Scope | Harness-first required? | Notes |
|---|---|---|
| `behavior` | **Yes**, for tier ≥ standard. Tier=small may do harness-after with one-sentence justification in plan.md. | The default. New product behavior. |
| `ui-only` | Optional. | Visual tweaks, copy, layout. Snapshot/visual tests OK if cheap. |
| `config` | Optional. | Tweaking thresholds, env, deps. |
| `docs` | Optional but recommended for skills/process artifacts. | Validator-style structural checks. |
| `spike` | Skip. | Throwaway exploration. Not merged. |

## Harness-first protocol (step 3)

1. Author the harness against the plan's public contract + invariants + failure modes.
2. Run the harness. Capture stdout + exit code → `docs/features/<slug>/harness-initial.log`.
3. **Refuse to advance to step 4 if the harness did not actually fail.** A harness that passes on the unmodified codebase is asserting either (a) trivially-true things or (b) behavior that already exists — both indicate the harness is wrong.

The validator at step 15 (`tests/validate.mjs --done`) compares `harness-initial.log` to the final harness run. Initial-fail → final-pass is the proof of work.

## Implement loop bound (step 8)

- **Cap: 3 attempts.** After three implementation attempts that don't make the harness pass, halt with `docs/features/<slug>/blocked.md` describing the gap and which assertions remain failing.
- Require human unblock: either replan (loop to step 2 with notes; cap replans at 2 per feature) or revise the harness (this is a `harness-revision` event — re-runs panel-1 over the new harness).
- **Forbid silent harness weakening.** Harness edits during the implement loop are only allowed via an explicit `harness-revision` step.

## Repro-test protocol (step 12)

For each `confirmed-bug` from the bug filter (severity ≥ med):

1. Write a failing test that reproduces the bug.
2. **Reproduce = fails on current main, passes after the fix.** Both halves must hold.
3. Cap: 3 reproduce attempts. After 3, mark the bug `repro-deferred`, file an issue with the integration / manual reproduction recipe, and continue.

Severity:low confirmed bugs may fix-then-test or fix-only with a note in retro.

## What to do when the harness conflicts with reality

If implementation reveals that the harness asserts something impossible or contradictory:

1. Stop. Do not weaken the harness silently.
2. Log the conflict in plan.md as a `## Plan amendment` section.
3. Re-trigger panel-1 on the revised harness + plan.
4. Continue implementation only after the new panel-1 returns.

## Harness file layout

There's no prescribed layout — use whatever the project already uses (`apps/api` uses Jest + Supertest; `apps/web` uses Vitest + Testing Library; `apps/mcp` uses Vitest; etc.). The harness lives alongside production code in the repo's normal test paths, not under `docs/features/`.

`docs/features/<slug>/harness-initial.log` records the **first run** of the harness for the feature. The harness itself stays in code.

## Anti-patterns

- ❌ Harness with 100% coverage but zero invariant assertions.
- ❌ Harness that mocks the thing under test.
- ❌ Harness modified during step 8 to make tests pass.
- ❌ Harness that asserts implementation details (e.g., "calls helper `foo` exactly twice").
- ❌ Snapshot-only harness for behavior features.
