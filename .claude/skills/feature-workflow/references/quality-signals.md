# Quality signals

Four metrics, **observed not targeted**. Computed at retro from the per-feature artifacts. Do not optimize for these numbers — Goodhart's law applies. Targets become checkbox theatre.

## The four metrics

### 1. Plan-to-code drift (1–5)
Subjective. How different is the built thing from the synthesized plan?

- **1** — built exactly the plan.
- **2** — minor adjustments during implementation.
- **3** — visible reshape but core scope intact.
- **4** — significant restructuring; plan was aspirational.
- **5** — barely recognizable; plan was wrong.

A drift of 4–5 is a signal that the plan stage failed, not that the implementation succeeded.

### 2. Panel-2 dissent rate (canonical definition)
`(material + risky) / total findings` from panel-2 output.

**Threshold (canonical):** a rate **below 20% over the last 5 standard-or-large features** indicates panel-2 has collapsed to consensus-with-panel-1. Trigger an early meta-retro to rewrite the adversarial brief or rotate specialist roles.

`adversarial.md` references this section; do not redefine the threshold there.

### 3. Post-merge bugs caught per feature
Count of bugs filed against the merged feature within 30 days of merge. Updated retroactively on the retro entry.

This is the **only outcome metric**. It can't be gamed by writing weaker tests or stricter reviews. A trend up over 3 features is the strongest signal something is wrong with the workflow.

### 4. Bug yield per panel-agent invocation
`confirmed-bugs found / total panel-agent invocations`.

Trends down as the codebase matures. Trends up = something's wrong: spec drift, complexity creep, or a regression in code quality.

## Rolling-window meta-retro triggers

The standard cadence is every 15 features. Trigger early if:

- **Dissent rate < 20%** over the last 5 standard-or-large features → adversarial panel is collapsing.
- **Post-merge bug rate trending up** over 3 consecutive retros → workflow gaps.
- **Plan-to-code drift ≥ 4** for 2 features in a row → plan stage failing.

Early trigger is just a meta-retro running ahead of the counter. It does not reset the counter unless explicitly bumped.

## Computation

Each retro writes a JSON block (see `retro-template.md` section 6). The meta-retro reads:

```bash
# pseudo: read all retros
for retro in docs/features/*/retro.md; do
  extract_json "$retro" >> /tmp/quality-signals.jsonl
done
```

…and computes rolling stats per tier. Mixing tiers in the same average is misleading — small features will dominate by count.

## What NOT to do

- ❌ Set numeric targets in CI / dashboards. Observed-not-targeted means observed.
- ❌ Compare absolute values across projects. They're project-relative.
- ❌ Promote "improving the dissent rate" as a goal. The goal is good features shipping; dissent rate is a smoke detector, not a thermostat.
- ❌ Drop a metric because it's "noisy". Either fix what it measures or change the metric — don't ignore it.

## When to retire a metric

A metric is candidate for retirement if:

- It hasn't surfaced a single actionable insight in 10 features.
- It's gameable in a way that's locally rational but globally bad.
- It duplicates another metric.

Meta-retro is the place to retire metrics. Don't drop them ad-hoc.

## Corrections weight

`state/corrections.md` records user-recorded overrides for findings the workflow miscategorized (e.g., a finding tagged `noise` that the user later deems `material`). Weight rule:

- **A correction overrides the original tag 1:1** for that finding when meta-retro recomputes signals.
- Meta-retro reads `state/corrections.md` *before* aggregating retro JSON blocks; the corrected tag replaces the original in the rolling-window calculation.
- Corrections are only applied to features that have already had their retro merged; they cannot be applied retroactively to alter a `## Decisions` section already committed.
