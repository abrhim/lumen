# Panel roles

Spawn N panel agents in parallel via the `Task` tool. Each agent runs with a 5-minute hard timeout and writes findings to its own per-role file `docs/features/<slug>/reviews/<panel>/<role>.md` (idempotent: skip if file exists and is non-empty).

## Panel sizes by tier

| Tier | Panel-1 specialists | Panel-2 (adversarial) |
|---|---|---|
| trivial | 0 | 0 |
| small | 3 | 0 |
| standard | **6** | **6** |
| large | **8** | **8** |

## Specialist roles for code features

### Mandatory at every tier ≥ small

- **security** — authn, authz, input validation, secrets, RLS, IDOR, injection, supply chain.
- **correctness** — failure modes, partial failures, idempotency, retries, edge cases.

### By feature type — pick to fill the rest of the slots

**backend**
- performance — N+1, indexes, hot paths, payload size, caching.
- api-contract — naming, versioning, error shape, idempotency keys, content-type.
- data-integrity — constraints, transactions, migration safety, race conditions.
- observability — logs, metrics, traces, audit.

**frontend**
- performance — bundle size, render hot paths, network waterfall, image weight.
- ux — copy, latency, empty/error states, focus management.
- accessibility — keyboard nav, ARIA, contrast, screen readers.
- observability — client errors, telemetry, session replay surface.

**full-stack**
- api-contract
- data-integrity
- ux
- observability

**infra / ops**
- reliability — failure isolation, retry budgets, SLOs.
- cost — runtime, bandwidth, storage, vendor pricing.
- observability
- blast-radius — what fails if this fails?

## Specialist roles for process / docs features

When the feature itself is a workflow, skill, or doc artifact (rare):

1. prompt-clarity — will an LLM follow this consistently?
2. workflow-rigor — does it close every gap it claims to?
3. cost-efficiency — proportional rigor; bypass paths where appropriate.
4. failure-modes — deadlock, runaway, conflicting feedback.
5. skill-ergonomics — Claude Code conventions, frontmatter, `allowed-tools`.
6. self-improvement — does the feedback loop actually close?

## Brief template (one per specialist)

```markdown
You are PANEL-1 / SPECIALIST <role>. Reviewing the plan below.

## Output
Markdown table:
| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |

5–10 findings. Severities: high / med / low. Be specific. Cite the plan. Don't restate strengths.

## Lens
<role-specific brief — see role definition below>

## Plan
<inline plan content>
```

## Severity definitions

- **high** — would materially change shipped quality or correctness; or violates a stated invariant; or introduces a security / data-loss / correctness risk.
- **med** — would meaningfully improve robustness, clarity, or maintainability but not block ship.
- **low** — preference / minor quality bump.

## Cost profile

- Panel agents: **Sonnet** (Haiku for trivial-tier sanity checks if ever revived).
- Tier decision (step 1) and adversarial-meta on tier=large: **Opus**.
- Use Anthropic prompt caching for the shared plan + artifact prefix across panel agents.

## Crash / timeout rules

- 5-minute hard timeout per panel agent.
- On timeout: record zero findings for that role, log to retro.
- Quorum: if **<½ of panel agents return**, restart the panel once; if still failing, escalate to human.
- Per-role files are idempotent — re-runs skip completed roles.

## Composability with built-in skills

- **Do not** delegate to built-in `review` / `security-review` from inside the panel — different lens, audit confusion.
- **simplify** is a post-implementation pass, not a panel role.
