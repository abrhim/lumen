# Retro — web-app-wiring

Closed 2026-07-03. Original scope (SSR reader) shipped at bc0b7f3; the feature
then absorbed a user-directed interaction pass (streaming panel, client nav,
mobile sheet, D&C fixes) before this retro.

## 1. Plan accuracy

**Drift: 4.** The plan's load-bearing decision — Q3, "SSR reload, no client
JS" — was deliberately reversed post-gate at the user's direction; the shipped
route is a streaming, client-navigated, optimistic-UI surface the plan never
described. Core data contract (URL shapes, loader fields, 404 semantics)
survived intact. Drift was human-directed evolution, not plan failure — but no
plan-amendment was filed and no panel re-ran, which the process should have
forced.

## 2. Panel signal vs noise

Panel-2 (plan stage, 6 roles): **material 22 / risky 15 / noise 17 /
out-of-scope 6** → dissent rate **0.62** (37/60). Well above the 20% collapse
threshold; the adversarial framing is earning its keep. Panel-1 tags were not
independently recounted (aggregates live in reviews/panel-1/).

## 3. Harness coverage delta

Post-implementation confirmed bugs caught by the initial harness: **0 of 12.**
Why, by class:

- #1–#3 (portal containment, D&C routing/home): the harness never exercised a
  real database or a real browser; loader tests mock `getAllBooks`, so an
  entire volume rendering zero books was invisible. A one-assertion smoke
  ("every volume on / renders ≥1 book link") against real data catches #3.
- #4–#8 (streaming/interaction layer): these live in code the harness predates;
  the post-gate pass added behavior without adding harness assertions —
  same failure mode as ds-activate-mode's learning ("human gate adds scope →
  re-run harness author step").
- #5, #9, #10 (data-shape traps): only visible against production data or the
  ingest script — mocks structurally cannot catch them.

## 4. Wasted effort

The conventions finder (8-angle review) returned zero findings — no CLAUDE.md
exists in this repo; skip that angle here until one does. Everything else
earned its time: the 8-finder pass produced 9 confirmed bugs for 8 invocations,
and per-candidate fact-checking against prod data/framework source killed
several plausible-but-wrong candidates cheaply. The larger process gap is the
inverse of waste: the interaction pass ran with *no* plan-stage review at all,
and the bugs it shipped (#1, #4–#9) were all caught late, by user or by the
after-the-fact review.

## 5. Recommendations

1. Add a real-data smoke harness tier: one live query per critical SQL path and
   one "every volume renders ≥1 book" assertion — mock-only loader tests hid
   every data-shape bug this feature had.
2. When post-gate iteration changes an approved architectural decision (Q3
   here), require a plan-amendment commit plus a mini-panel before
   implementing — freeform iteration shipped 6 of this feature's 12 bugs.
3. Add a portal checklist item to UI review briefs: CSS wrappers do not contain
   portaled components; mount-gate them with matchMedia instead.

## 6. Quality signals

```json
{
  "feature_slug": "web-app-wiring",
  "tier": "standard",
  "plan_to_code_drift": 4,
  "panel_2_dissent_rate": 0.62,
  "post_merge_bugs_caught": null,
  "panel_agent_invocations": 20,
  "bug_yield_per_panel_agent": 0.45,
  "skill_version": "9b2b876"
}
```

(12 plan-stage roles + 8 code-stage finders = 20 invocations; 9 finder-confirmed
bugs / 20 = 0.45.)

## 7. Provenance histogram

```
user-report:          3   (#1 #2 #3)
code-review-finder:   9   (#4–#12)
harness:              0
panel (plan-stage):   0   (post-gate evolution never went back through panels)
```
