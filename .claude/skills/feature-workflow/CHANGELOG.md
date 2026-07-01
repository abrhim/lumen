# CHANGELOG — feature-workflow skill

Bumped by the meta-retro every 15 features (or earlier if a quality-signal trigger fires). Each entry records the diff applied to SKILL.md / references/ and the rationale.

## Versioning

Loose semver:

- **patch** (`0.1.0` → `0.1.1`) — wording tweaks, typo fixes, reference clarifications, validator hardening that doesn't change pass/fail semantics.
- **minor** (`0.1.0` → `0.2.0`) — new reference file, new validator check that can newly fail, new step in the flow, new tier rules, new panel role.
- **major** (`0.1.0` → `1.0.0`) — breaking changes to the artifact layout (`docs/features/<slug>/...`), step numbering, or required frontmatter shape that requires migrating existing feature dirs.

Bump the `version:` field in `SKILL.md` frontmatter as part of the meta-retro merge commit.

## v0.1.0 — initial

- Initial skill scaffolded by dogfooding the workflow on its own design.
- Plan + panel-1 (6 specialists) + panel-2 (6 adversarial) + synthesized plan persisted under `docs/features/feature-workflow-skill/`.
- Standard tier flow with 6+6 panels, harness-first, bug provenance, retro + learnings.
- 45 of 67 panel-1 findings incorporated; 8 risky fixes explicitly rejected with rationale; 12 noise dropped to learnings; 2 OOS deferred.
- Panel-2 dissent rate at synthesis: 33% (above 20% threshold).
