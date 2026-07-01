# Tiers

Determine the tier **by risk axes**, not line count. Cite the axes evaluated in `plan.md`.

## Risk axes

A feature trips a risk axis if any of:

1. **Public surface** — adds, changes, or removes a public API, endpoint, exported function, or user-visible UI flow.
2. **Auth / authz / secrets** — touches authentication, authorization, RLS policies, secrets handling, or session state.
3. **Data migration** — adds, alters, or removes a database schema element (table, column, index, enum, view, trigger, RLS policy).
4. **Money / billing** — touches pricing, tier math, payment, invoice, or refund logic.
5. **Behavior change** — net-new product behavior (vs. mechanical refactor / rename / typegen / dependency bump).
6. **Cross-system blast radius** — modifies code or contracts shared by two or more apps/packages.

## Tier table

| Tier | When | Reviewers (panel-1) | Panels | Harness | Retro |
|---|---|---|---|---|---|
| **trivial** | typo, comment, formatting, single-line config; **zero** risk axes tripped; ≤ 20 lines changed | 0 | none | skip | skip |
| **small** | 1 risk axis tripped; ≤ 100 lines mechanical change; non-public-surface | 3 | panel-1 only | required for behavior scope only | optional |
| **standard** | new public surface; OR 1+ risk axes + non-mechanical; OR 100–300 lines net-new behavior | **6** | **panel-1 + adversarial meta** | required for behavior scope | mandatory |
| **large** | new module; cross-system; schema migration; auth/crypto/billing; ≥ 300 lines net-new behavior | **8** | **panel-1 + adversarial meta** | required | mandatory + meta-retro counter +1 |

## Always-escalate to ≥ standard

Regardless of size, the following **always** require at least standard tier:

- Auth / authz / authn changes
- Crypto / secrets handling
- Data migrations (schema or data)
- Billing / payments
- RLS policy changes
- Cross-system contract changes

## Tie-break

When attributes span two tiers, **pick the higher tier**. Line count is a tiebreaker only — never the primary signal.

## Mid-flight re-check

The synthesizer reassesses tier at:

- End of step 2 (Plan), and
- End of step 4 (Panel-1).

If a tier change is warranted (e.g., panel-1 surfaces a security concern that pushes a `small` to `standard`), the synthesizer proposes the change with a one-line justification. Human gate confirms. Logged for the retro.

## Worked examples

### trivial

- Fix a typo in a markdown file.
- Bump `tailwindcss` patch version in `package.json`.
- Rename a private constant in a single file (no exports).
- Add a `// TODO` comment.
- Update copy on a button label (no a11y consequence — see "always-escalate").

### small

- Add a new private utility function used by one module; ≤ 100 lines.
- Fix a single failing test by adjusting an assertion (no production code change).
- Add a new internal config key with default; no consumer changes.
- Add a single field to an internal DTO (no API exposure).

### standard

- Add a new REST endpoint that reads existing data (no schema change).
- Add a new SPA page wired to an existing API.
- Add a new field to a public DTO + endpoint to read it (touches API contract).
- Add a new MCP tool that calls an existing API endpoint.
- Add a feature flag that gates a new code path.

### large

- New NestJS module with CRUD + new tables + RLS policies (e.g., Events).
- Magic-link auth flow end-to-end (auth + JWT validation + `users` mirror migration).
- Order placement with idempotency, tier pricing math, and aggregate views.
- Push notification subsystem (VAPID + subscription mgmt + dispatch).

## Plan template (used at step 2)

```markdown
# Plan — <slug>

## Tier
**<trivial|small|standard|large>** — risk axes tripped: <list>. Justification: <1 sentence>.

## Goal
<1–2 sentences>

## Scope
- In:
- Out:

## Files touched
- <path> (new|edit|delete)

## Public contract
- <endpoints / exports / UI surface>

## Failure modes (must each have a harness assertion)
- <case 1>
- <case 2>

## Harness scope
**<behavior|ui-only|config|docs|spike>** — harness-first <required|optional|skipped>.

## Open questions (for human gate)
- Q1 — proposed default: …
- Q2 — proposed default: …

## Drift baseline (filled at end of step 6)
- plan-hash: <sha>
- harness-hash: <sha>
```
