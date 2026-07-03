---
name: feature-workflow
version: 0.1.0
description: Activates when implementing a new product feature ("implement a feature", "build out a feature for X", "add a new feature", "ship a feature for Y", "develop a feature"). Enforces tiered planning, harness-first design, two-panel review with adversarial meta-review, bug provenance tagging, and post-feature retro. SKIP for bug fixes ("fix X"), refactors with no new behavior, doc-only edits, dependency bumps, formatting/typo changes, deploys, releases, or any change scoped to a single one-line config tweak.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TodoWrite
---

# feature-workflow

> *"A frame that holds everything shows nothing." — Scope*

Disciplined process for shipping product features. Tiered rigor — no ceremony for typos, full panel review for risky changes.

## Pre-flight (always)

Run `node .claude/skills/feature-workflow/tests/validate.mjs --quick`. **If exit code ≠ 0, halt and report failures to the user; do not proceed to step 1.** Dirty-tree warnings (`!`) are allowed but acknowledge them.

Branch: `git switch -c feature/<slug>` (slug = short kebab from feature title).

## References

| File | Use at |
|---|---|
| [references/tiers.md](references/tiers.md) | Step 1 tier choice; re-check after steps 2 and 4 |
| [references/panel-roles.md](references/panel-roles.md) | Steps 4 + 9 — pick panel specialists |
| [references/adversarial.md](references/adversarial.md) | Steps 5 + 10 — adversarial finding tags |
| [references/harness-template.md](references/harness-template.md) | Step 3 harness; step 12 repro tests |
| [references/bug-filter.md](references/bug-filter.md) | Step 11 — confirmed-bug / preference / out-of-scope |
| [references/retro-template.md](references/retro-template.md) | Step 14 — write the retro |
| [references/quality-signals.md](references/quality-signals.md) | Step 14 signals; meta-retro reads aggregate |

## Step map

| # | Step | Reference |
|---|---|---|
| 0 | Pre-flight + branch | `tests/validate.mjs` |
| 1 | Tier decision | `references/tiers.md` |
| 1b | **Pipeline confirmation** | (inline rule below) |
| 2 | Plan — **REQUIRED**: read `state/learnings.md` + last 3 retros; surface overlapping entries into plan + Panel-1 brief | `references/tiers.md` (template) |
| 3 | Harness (required for `behavior` scope) | `references/harness-template.md` |
| 4 | Panel-1 (parallel specialists) | `references/panel-roles.md` |
| 5 | Panel-2 (adversarial) | `references/adversarial.md` |
| 6 | Synthesize → `## Decisions` in plan.md | (inline rule below) |
| 7 | **Human gate** | (inline rule below) |
| 8 | Implement (cap: 3 attempts → `blocked.md`) | `references/harness-template.md` |
| 9 | Code-panel | `references/panel-roles.md` |
| 10 | Code-adversarial | `references/adversarial.md` |
| 11 | Bug filter | `references/bug-filter.md` |
| 12 | Repro tests (confirmed bugs, severity ≥ med) | `references/harness-template.md` |
| 13 | Fix |  |
| 14 | Retro + append `state/learnings.md` | `references/retro-template.md`, `references/quality-signals.md` |
| 15 | Done — `validate.mjs --done` | `tests/validate.mjs` |

## Inline rules

**Pipeline confirmation (step 1b).** After the tier decision, present the proposed pipeline and stop:

```
## Proposed pipeline for <feature title> (tier: <tier>)
  [ ] Plan   [ ] Harness   [ ] Panel-1 (N specialists)   [ ] Panel-2 adversarial
  [ ] Synthesize + human gate   [ ] Implement   [ ] Code-panel   [ ] Code-adversarial
  [ ] Bug filter + fix   [ ] Retro
approve / skip:<step,step> / "co-design <step>"
```

User may `approve`, `skip:<steps>` (security steps unskippable at Full tier), request collaborative mode for any step (it still runs, interactively), or reorder with a reason. **Do not proceed past 1b without explicit confirmation.**

**Synthesis (step 6).** Tie-break precedence: **human > panel-2 > panel-1**. Safety findings (security / data-loss / correctness severity:high) always survive panel-2. Append `## Decisions` to plan.md labeling every panel-1 finding exactly one of: `incorporated` / `rejected-with-rationale` / `dropped-as-noise` / `deferred-out-of-scope`. Hash plan.md + harness into plan.md `## Drift baseline`.

**Human gate (step 7).** Enumerate every open question with a proposed default. Responses: `approve` · `approve-with-changes: {q1: …}` · `revise` (loop to step 2 with notes) · `abort` (mark aborted, abbreviated retro).

**Implement (step 8).** Cap 3 attempts; then halt with `blocked.md` describing the gap and require human unblock. Verify hashes against drift baseline at exit; refuse step 9 if plan or harness changed without an explicit `plan-amendment` commit. Cap replans at 2 per feature.

**Sub-agent orchestration.** Spawn specialists in parallel via `Task`. Per-role files `docs/features/<slug>/reviews/{panel-1|panel-2|code-panel|code-adversarial}/<role>.md` are the source of truth (idempotent — re-runs skip completed roles); the aggregator overwrites `panel-1.md` / `panel-2.md` / `code-panel.md` / `code-adversarial.md` from them. Soft target 5 min wall-clock per agent (`Task` exposes no abort; log overruns in retro). If <½ of agents return, restart the panel once; then escalate to human. Dedup by topic/file/line; canonical finding lists `raised_by: [agents]`.

**Cost profile.** Prefer Sonnet for panel agents; Opus for tier decision + adversarial-meta on tier=large. Advisory only — `Task` exposes no per-call model param. Rely on prompt caching for the shared plan/artifact prefix.

## Per-feature artifacts

```
docs/features/<slug>/
├── plan.md            (plan + ## Decisions + ## Drift baseline)
├── reviews/
│   ├── panel-1/<role>.md  → panel-1.md (aggregated, overwritten)
│   ├── panel-2/<role>.md  → panel-2.md
│   ├── code-panel/<role>.md → code-panel.md
│   └── code-adversarial/<role>.md → code-adversarial.md
├── harness-initial.log
├── bugs.md
└── retro.md
```

## State + meta-retro

- `state/learnings.md` — append-only, capped 50 entries, rotated to `state/archive/`.
- `state/corrections.md` — user overrides for miscategorized findings (weight rule: `references/quality-signals.md`).
- `CHANGELOG.md` — bumped by meta-retro.
- **Meta-retro** every 15 features: reads last 10 retros + state, emits diff to SKILL.md / references/ + CHANGELOG entry; approval applies it and bumps version.

## Invocation

Activates automatically on new-feature requests (see frontmatter `description`). No slash command in v0.1.0.
