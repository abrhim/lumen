# Bug filter

Apply at step 11, after the code-review panels return. Sort each finding into one bucket; act on the bucket.

## Buckets

### confirmed-bug
A defect. Action: write a failing repro test (step 12), then fix (step 13).

A finding is `confirmed-bug` if **any** of:
- It violates an invariant stated in the plan.
- It has a failing repro test (or the reviewer wrote one).
- It contradicts the public contract documented in the plan.
- **≥ 2 reviewers independently flagged the same issue** (any panel, any severity).
- It is severity:high AND tagged `security` / `data-loss` / `correctness`.

### needs-investigation
Ambiguous. Could be a bug, could be misreading. Action: 5-minute reproduce attempt. Reduces to `confirmed-bug` if reproducible, else `preference`. Log the attempt outcome in `bugs.md`.

### preference
Style / naming / would-write-it-differently. Action: capture in retro learnings. Only act if it's a recurring pattern across multiple retros.

### out-of-scope
Valid concern but for a different feature or future work. Action: file an issue or add to recommendations in retro.

## Default bias

When in doubt between `preference` and `needs-investigation`: **prefer `needs-investigation`**. The 5-minute repro attempt is cheap insurance against silently-dropped bugs.

When in doubt between `confirmed-bug` and `needs-investigation`: **prefer `confirmed-bug`**. Repro tests are the harness's job.

## Safety carve-out (NEVER demote)

A finding **must NOT** be downgraded to `preference` if any of:
- Severity:high in panel-1 OR code-panel.
- Tagged `security`, `data-loss`, or `correctness`.
- Touches authn / authz / RLS / secrets / billing / data migration.

Such findings are at minimum `needs-investigation`; usually `confirmed-bug`. The synthesizer enforces this.

## Output format

`docs/features/<slug>/bugs.md`:

```markdown
# Bugs — <slug>

## Confirmed bugs
### B1: <short title>
- Severity: high | med | low
- Categories: security | correctness | perf | …
- Source: <panel-1 finding id> + <panel-2 finding id> + …
- Raised_by: [<agent_role_or_panel_id>, ...]
- Description:
- Repro test path:
- Fix commit:

## Needs investigation
### N1: <short title>
- Source:
- 5-min attempt outcome:
- Disposition: confirmed-bug → B<n> | downgraded to preference

## Preference (captured for learnings)
- <one-line each>

## Out-of-scope
- <one-line each + issue link if filed>

## Provenance histogram (for retro)
| Origin | Count |
|---|---|
| Should have been caught by plan | |
| Should have been caught by harness | |
| Should have been caught by panel-1 | |
| Should have been caught by panel-2 | |
| Genuinely emergent / refactor artifact | |
```

### Histogram fill rule

For each `confirmed-bug`, attribute it to **exactly one** origin row using the highest-fit rule below:

1. **plan** — the bug is a contradiction or omission in the plan itself (a wrong invariant, a missing failure mode listed nowhere).
2. **harness** — the plan was right but the harness didn't assert the contract that broke (a stated invariant with no test).
3. **panel-1** — the plan was right and the harness was right but a relevant panel-1 specialist didn't surface it.
4. **panel-2** — the plan was right and panel-1 raised it but panel-2 incorrectly tagged it `noise`/`risky` and it got dropped.
5. **genuinely emergent / refactor artifact** — none of the above; the bug only became visible during implementation, e.g., a race surfaced by interaction with code outside the feature scope.

Tie-break: pick the **earliest gate** in the workflow (plan > harness > panel-1 > panel-2 > emergent) — earlier-gate attribution is more actionable.

## Aggregation rules

- **Dedup before counting.** Two reviewers raising the same issue = one canonical finding with `raised_by: [agent_ids]`.
- **The "≥ 2 reviewers" rule applies post-dedup**: 2 reviewers, 1 canonical finding → confirmed-bug.
- Severity = the highest severity any reviewer assigned to a canonical finding.
- Categories = union of all categories assigned across raisers.

## Edge cases

- **A reviewer marks a finding `noise` but another marks it `material`** → not a `confirmed-bug` automatically; resolves through panel-2 synthesis. The synthesizer chooses based on tie-break precedence.
- **A finding flagged by ≥ 2 reviewers but all `low` severity** → still confirmed-bug per the ≥ 2 rule. Repro test still required. Retro should track this as "we keep bikeshedding".
- **A finding nobody raises but you (the main agent) suspect during synthesis** → file as `needs-investigation`, not silently as `confirmed-bug`. The skill is not a back-channel for the main agent's opinions.
