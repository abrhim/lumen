# Expected tier decision — for the example fixture

Used as a sanity check: if the skill flow yields a different decision on the example fixture, something has changed in the rules.

## For the brief in `fixtures/example-feature.md`

Expected tier: **large**.

Risk axes tripped (correct list):
- Public surface
- Auth / authz / secrets
- Behavior change
- Cross-system blast radius

Justification (one sentence example): *"New POST endpoint touching authz, idempotency invariants, and shared DB constraints across api + future MCP — cross-system blast radius and four risk axes warrant tier=large."*

## What a correct tier-decision response looks like

```markdown
## Tier
**large** — risk axes tripped: public-surface, authz, behavior-change, blast-radius.
Justification: New endpoint introduces idempotency + uniqueness invariants
with cross-system reach (api + future MCP) and authz checks; mechanical
size is moderate but invariants make this large.
```

## Acceptable variations

- Tier may be `standard` IF the contributor argues the blast radius is contained (MCP tool not in this feature scope) AND idempotency is moved out of scope. The justification must explicitly cite the de-scoped pieces.
- Tier MUST NOT be `small` or `trivial` — auth-touching endpoints always escalate to ≥ standard per `references/tiers.md`.

## What this file is NOT

- Not a regression test for the LLM. Tier classification has acceptable variance; the rules in `references/tiers.md` are the source of truth.
- Not a cap on rigor. A contributor proposing tier=large is never wrong to err high; tier=trivial on auth-touching code is always wrong.
