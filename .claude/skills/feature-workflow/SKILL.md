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

Run `node .claude/skills/feature-workflow/tests/validate.mjs --quick`. **If exit code ≠ 0, halt and report failures to the user; do not proceed to step 1.** Warnings (`!`) on dirty working tree are allowed but should be acknowledged.

Branch: `git switch -c feature/<slug>` (slug = short kebab from feature title).

## References

| File | Use when |
|---|---|
| [references/tiers.md](references/tiers.md) | Step 1 — choose tier; mid-flight tier re-check at end of steps 2 and 4. |
| [references/panel-roles.md](references/panel-roles.md) | Step 4 + step 9 — pick the panel-1 / code-panel specialists for the feature type. |
| [references/adversarial.md](references/adversarial.md) | Step 5 + step 10 — adversarial meta-reviewers tag findings. |
| [references/harness-template.md](references/harness-template.md) | Step 3 — author the harness. Step 12 — repro test for confirmed bugs. |
| [references/bug-filter.md](references/bug-filter.md) | Step 11 — sort findings into confirmed-bug / preference / out-of-scope. |
| [references/retro-template.md](references/retro-template.md) | Step 14 — write the retro. |
| [references/quality-signals.md](references/quality-signals.md) | Step 14 — compute the four signals. Meta-retro reads aggregate. |

## Step map

| # | Step | Reference |
|---|---|---|
| 0 | Pre-flight + branch | `tests/validate.mjs` |
| 1 | Tier decision | `references/tiers.md` |
| 1b | **Pipeline confirmation** | (inline rule below) |
| 2 | Plan + load prior learnings — **REQUIRED**: read `state/learnings.md` and the last 3 retros under `docs/features/`; surface entries with overlapping area into the plan + Panel-1 brief. | `references/tiers.md` (template), `state/learnings.md` |
| 3 | Harness (required for `behavior` scope) | `references/harness-template.md` |
| 4 | Panel-1 (parallel specialists) | `references/panel-roles.md` |
| 5 | Panel-2 (adversarial) | `references/adversarial.md` |
| 6 | Synthesize → append `## Decisions` to plan.md | (inline rule below) |
| 7 | **Human gate** | (inline rule below) |
| 8 | Implement (cap: 3 attempts, then `blocked.md`) | `references/harness-template.md` |
| 9 | Code-panel | `references/panel-roles.md` |
| 10 | Code-adversarial | `references/adversarial.md` |
| 11 | Bug filter | `references/bug-filter.md` |
| 12 | Repro tests for confirmed-bugs (severity ≥ med) | `references/harness-template.md` |
| 13 | Fix |  |
| 14 | Retro + append `state/learnings.md` | `references/retro-template.md`, `references/quality-signals.md` |
| 15 | Done — `validate.mjs --done` | `tests/validate.mjs` |

## Inline rules

**Pipeline confirmation (step 1b).** After the tier decision, present the proposed pipeline to the user before executing any steps. Format:

```
## Proposed pipeline for <feature title> (tier: <light|full>)

Steps I'll run:
  [ ] Plan
  [ ] Harness
  [ ] Panel-1 review (N specialists)
  [ ] Panel-2 adversarial
  [ ] Synthesize + human gate
  [ ] Implement
  [ ] Code-panel review
  [ ] Code-adversarial
  [ ] Bug filter + fix
  [ ] Retro

Skip or modify any steps? (approve / skip:<step,step> / "let's co-design the plan first")
```

The user may:
- `approve` → run the full pipeline as proposed
- `skip:<steps>` → remove specific steps (e.g., `skip:panel-2,code-adversarial`). Security-related steps cannot be skipped for Full-tier features.
- Request collaborative mode for any step (e.g., "let's co-design the plan" or "I want to pair on the harness") — the step still runs, but interactively with the user instead of autonomously.
- Reorder steps if they have a reason.

Do not proceed past step 1b without explicit user confirmation of the pipeline.

**Synthesis (step 6).** Tie-break precedence: **human > panel-2 > panel-1**. Safety-tagged findings (security / data-loss / correctness severity:high) always survive panel-2 regardless of tag. Append `## Decisions` to plan.md listing each panel-1 finding's resolution using exactly one of these labels: `incorporated` / `rejected-with-rationale` / `dropped-as-noise` / `deferred-out-of-scope`. Hash plan.md and harness; record in plan.md `## Drift baseline`.

**Human gate (step 7).** Enumerate every open question with proposed default. User responds:
- `approve` → all defaults accepted
- `approve-with-changes: {q1: ..., q2: ...}` → override specific defaults
- `revise` → loop to step 2 with notes
- `abort` → mark feature aborted, run abbreviated retro

**Implement (step 8).** Cap 3 attempts. After 3, halt with `blocked.md` describing the gap; require human unblock. Verify hashes against drift baseline at exit; refuse step 9 if plan or harness changed without an explicit `plan-amendment` commit. Cap replans at 2 per feature.

**Sub-agent orchestration.** Spawn N specialists in parallel via `Task`. Per-role files: `docs/features/<slug>/reviews/{panel-1|panel-2|code-panel|code-adversarial}/<role>.md` (per-role files are idempotent — re-runs skip completed roles). The aggregator (the main agent) overwrites `panel-1.md` / `panel-2.md` / `code-panel.md` / `code-adversarial.md` from the per-role files; per-role files are the source of truth. Target 5-min wall-clock per agent (the `Task` tool does not expose abort, so this is a soft target — log truncation in retro if exceeded). If <½ of agents return, restart panel once; if still failing, escalate to human. Dedup by topic/file/line; canonical with `raised_by: [agents]`.

**Cost profile.** Prefer Sonnet for panel agents and Opus for tier decision + adversarial-meta on tier=large. Note: the `Task` tool does not currently expose a per-call model parameter, so this is a recommendation, not an enforced policy. Prompt caching for the shared plan + artifact prefix is supported by Anthropic SDK; rely on it where the platform allows.

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
- `state/corrections.md` — user overrides for miscategorized findings (see `references/quality-signals.md` for the weight rule).
- `CHANGELOG.md` — bumped by meta-retro per its versioning rules.
- **Meta-retro** triggers every 15 features total. Reads last 10 retros + state. Emits diff to SKILL.md / references/ + CHANGELOG entry. Approval applies the diff and bumps version.

## Invocation

Activates automatically when the user requests a new feature (see frontmatter `description`). No slash command is registered for v0.1.0.
