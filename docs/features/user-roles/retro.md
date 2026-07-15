# Retro — user-roles

Role-based entitlements + an admin-only `/admin/users` list. Resumed mid-flow
from `worklist.md` (plan + panels committed a prior session at `17caa80`);
this session ran DEC-A/DEC-B, the record fixes, the code fixes, step 8, the
code-review close-out, an adversarial fix-verification pass, deploy, and this
retro.

## 1. Plan accuracy

**Drift: 2/5.** The data model (roles/user_roles/app_users bridge), the
fail-closed gate, keyset pagination, search/filter, and the table/cards UI were
all built as D1–D13 specified. The only deviations were review-driven hardening,
not reshapes: the cursor is minted from a `::text` projection (B2) rather than a
JS `Date`, and the route now HAS an ErrorBoundary (B6) — directly reversing the
plan's "deliberately no ErrorBoundary" line, which turned out to be the bug.

## 2. Panel signal vs noise

Two panel rounds. Plan-stage panels (prior session) are recorded in `plan.md`.
This session's **code-review** round is the one scored here.

Code-adversarial-A formally tagged the 15 security+correctness findings:

| tag | count |
|---|---|
| material | 12 |
| risky | 1 (SECURITY-4 — its lead fix would reintroduce F3; took CORRECTNESS-7 instead) |
| noise | 2 (SECURITY-5, SECURITY-6) |
| out-of-scope | 0 |

**Dissent rate = (12 + 1) / 15 = 0.87.** Code-panel was overwhelmingly signal;
adversarial-A confirmed it by independently reproducing B1/B2/B3 *before* reading
the panel files, and made one real severity correction (SECURITY-4 → risky).

**Caveat (workflow bug, see §4):** code-adversarial-B received an EMPTY findings
list to tag (0 tags) because the orchestration keyed panel results by a prose
`role` string the agents didn't echo verbatim. B recovered by producing 9
independent client findings (ADVB-1..9), which converged with the ux-a11y panel —
so no signal was lost, but the ux-a11y findings were never formally tagged.

## 3. Harness coverage delta

The dominant provenance origin was **harness (5 of 9 confirmed bugs)**. Every one
was a stated invariant whose test asserted the happy *shape* but never the
hostile *input*:

- **B1** — "the allow-list is total" (H3/parseSort test) only tried `"evil"`,
  never a prototype key (`toString`). The `in`-operator bypass shipped green.
- **B2** — H4 "no dupes/skips across ties" used whole-day `Date` fixtures and
  even *pinned the lossy* `toISOString` as the expected cursor. The µs-truncation
  was encoded as correct.
- **B3** — H4b "bad cursor → page 1, never throws" never fed a valid-shape /
  garbage-value cursor; and the fix's first cut (a regex) still missed
  value-invalid dates (month 13) that only Postgres rejects.
- **B7** — H6 covered unknown role/entitlement keys but not unknown CLI *flags*;
  the `--dryrun` typo → real grant was untested.
- **B5** — the incorporated SWR/pending spec had no assertion (the node suite
  can't render), so the "wrong state machine" wiring shipped as dead code.

Next-harness seed: a "totality"/"never-throw"/"fail-closed" test MUST include the
adversarial input class, not one benign value. Where the suite can't render
(client effects B4/B5/B6), reasoning + a dedicated verification pass substitutes.

## 4. Wasted effort

- The first code-review workflow **stalled ~1 hr**: 2 of 5 agents died on an API
  "connection closed mid-response," well past the 5-min soft target. A
  kill + `resumeFromRunId` recovered the 3 completed agents from cache and re-ran
  only the 2 dead ones — the resume mechanic paid off, but the stall was dead time.
- On resume, an **orchestration bug** made both adversarial agents receive `[]`:
  results were keyed by `byRole[p.role]` where `p.role` was a prose string
  (`"CODE-PANEL SPECIALIST security"`), not the `"security"` key. The agents
  self-recovered (read the per-role `.md` files from disk), so signal survived,
  but adversarial-B's formal tagging was lost.
- Everything else earned its time. The **fix-verification pass was the highest-ROI
  step**: 6 agents, 3 residuals caught (B3 cast-range, B6 concealment regression,
  B7 dropped-dash) — all with green tests and clean typecheck. Without it, three
  fixes would have shipped subtly broken.

## 5. Recommendations

- Write harness fixtures that carry the **adversarial input**, not the happy
  shape — a totality/never-throw/fail-closed test that tries one benign value
  (or *pins the bug* as expected, as H4 did) proves nothing.
- Run a **dedicated fix-verification pass** after every fix round on a risky
  feature — re-trigger each fixed bug against the committed code; it caught 3
  residuals here that all had green suites.
- In multi-agent orchestration, **key results by loop index or a constrained enum
  field**, never by a prose string the agent is trusted to echo — the silent
  empty-findings handoff wasted adversarial-B's tagging pass.

## 6. Quality signals

```json
{
  "feature_slug": "user-roles",
  "tier": "large",
  "plan_to_code_drift": 2,
  "panel_2_dissent_rate": 0.87,
  "post_merge_bugs_caught": null,
  "panel_agent_invocations": 5,
  "bug_yield_per_panel_agent": 1.8,
  "skill_version": "17caa80"
}
```

`panel_agent_invocations` = code-panel (3) + code-adversarial (2) for the
code-review round. `bug_yield` = 9 confirmed bugs / 5 = 1.8. The fix-verification
round (6 agents) and test-hardening round (3 agents) are excluded — they verify /
build, not find. `panel_2_dissent_rate` is from the formally-tagged set
(adversarial-A's 15); the ux-a11y findings went untagged (§2 caveat).

## 7. Provenance histogram

| Origin | Count | Which |
|---|---|---|
| Should have been caught by plan | 1 | B6 (D10 no-boundary over-extended to background pagination) |
| Should have been caught by harness | 5 | B1, B2, B3, B5, B7 (stated invariants whose tests didn't exercise the failing input — B2's test even pinned the bug) |
| Should have been caught by panel-1 | 0 | |
| Should have been caught by panel-2 | 0 | |
| Genuinely emergent / interaction | 3 | B4 (client epoch race), B8 (migration idempotency × future-schema), B9 (F3 fix × parallel loaders) |

## Deploy

Migration committed to prod (8 invariants green, redundant `idx_user_roles_user`
dropped per F2). App deployed live (version `168e1a7d`). Post-deploy smoke: home
200, anon `/admin/users` 404 with no chrome/PII leak (B6 verified live);
byte-identical existence-concealment is NOT achieved (RR ships the matched route's
module preload + manifest entry + echoes the URL in the no-match message) — a
low-severity, pre-existing residual, accepted because the entitlement gate (404,
no data, no PII query) is the real control, not obscurity. `lumen.app_users`
resolves (0 rows — the coupling tripwire). Full e2e is deferred (D12): 0 real
users until Abram completes the Supabase sign-in config (Site URL now set) and
self-grants via `grant-role.mjs`.
