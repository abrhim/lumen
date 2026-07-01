# Adversarial review (panel-2)

> *"Consensus is cheapest where scrutiny is absent."*

Panel-2 reviews panel-1's findings. Each panel-2 specialist takes one panel-1 specialist's findings and assigns exactly one tag per finding.

## Tags

### material
**Definition.** Changes the design or catches a real risk. Would materially affect what's shipped.

Examples:
- Plan says "X is idempotent" but no test enforces it. Material — invariant unverified.
- Endpoint returns 200 on partial failure. Material — data-loss path undocumented.

### risky
**Definition.** The suggested fix would itself introduce a new bug, regression, or coupling worse than what it prevents.

Examples:
- "Switch to event sourcing" to fix a missing audit log row. Risky — rewrite > fix.
- "Add `schema_version` to every markdown file" to handle migration. Risky — heavy machinery for occasional shape changes.

### noise
**Definition.** Style / preference / restating. Would not change shipped quality.

Examples:
- "Use `const` instead of `let` here." Noise unless mutation is the bug.
- "Variable name could be clearer." Noise unless ambiguity causes a defect.

### out-of-scope
**Definition.** Valid concern but for a different feature or future work.

Examples:
- "While we're here, refactor the auth module." Out-of-scope.
- "Consider adding telemetry to the whole app." Out-of-scope of one endpoint.

## Tie-break precedence

When a finding could fit two tags, pick the higher one on this list:

**material > risky > out-of-scope > noise**

Exactly one tag per finding.

## Safety carve-out

Findings tagged severity:high in panel-1 with categories `security`, `data-loss`, or `correctness` **always survive panel-2** regardless of tag. Panel-2 may *suggest* downgrading them, but the synthesizer does not act on the downgrade. Logged for retro.

## Brief template

```markdown
You are PANEL-2 ADVERSARIAL reviewer for <role>. Evaluating findings from panel-1 specialist <role>.

## Job
For each finding, assign EXACTLY ONE tag: material / risky / noise / out-of-scope.
Tie-break precedence: material > risky > out-of-scope > noise.
Be skeptical. Don't rubber-stamp. Mark `risky` if the fix's complexity exceeds the bug.

## Output
Markdown table:
| ID | Tag | Rationale (≤ 25 words) |

After the table: 2–3 sentences of overall stance — is the panel-1 specialist mostly signal or noise?

## Plan summary
<inline summary>

## Findings to tag
<panel-1 findings inline, with IDs>
```

## Synthesis (step 6 of the main flow)

The main agent processes panel-2 output. Each panel-1 finding gets exactly one of these resolutions, recorded in `plan.md` `## Decisions` with this verbatim label:

1. **material** → resolution = `incorporated`. Fold the finding's fix into the plan.
2. **risky** → resolution = `rejected-with-rationale`. Record rejection reason verbatim.
3. **noise** → resolution = `dropped-as-noise`. Aggregate into retro learnings.
4. **out-of-scope** → resolution = `deferred-out-of-scope`. File an issue (or note in retro recommendations).

**Tie-break precedence**: `human > panel-2 > panel-1`. Except safety-tagged findings always survive (see carve-out above).

The synthesizer must not produce a both-sides summary. Each panel-1 finding gets one of those four resolutions, recorded in `plan.md`.

## Quality signals computed at retro

The adversarial dissent rate and its rolling-window threshold are defined in `references/quality-signals.md` (canonical). This file does not redefine them.

## Composability

- Panel-2 must not delegate to other skills. The lens is "rebut the panel-1 specialist on their own terms."
- Each panel-2 agent gets only its corresponding panel-1 specialist's findings (not all 6 specialists' output) to avoid scope blur.
