# user-roles — go-forward worklist (Fable-safe)

Clean, defensive-only task list to finish the feature. No exploit content — safe
to run in a Fable session. Two exploit-adjacent items are sealed in
[deferred-security.md](./deferred-security.md) (DS-1, DS-2) — do NOT pull those
into this flow; take them later in Opus.

Source: trust-nothing code review (32 agents) + plan-stage audit (22 agents).
IDs (F#, P#) reference the review transcripts for provenance.

## 0. Awaiting your decision (blocks the record fixes below)
- **DEC-A (was P1):** D3 recorded the "no Admin link in v1" cut as "[CUT: both skeptics converge]" — but only the authz reviewer cut it; the product reviewer argued to keep a JWT-gated Admin link. The *outcome* can stand; the *record* is false. Decide: keep the cut (relabel D3 honestly as a rejected-with-rationale), or restore the Admin link (expands step 8: grant-role dual-writes JWT app_metadata + AccountChip shows Admin).
- **DEC-B (was P2):** Steps 1b + 7 (human approval gate) were self-waived on a "standing directive" the repo only substantiates as a prior-feature waiver. Decide: approve the 13 decisions as-is, or revise.

## 1. Plan-record fixes (integrity — cheap, do after DEC-A/DEC-B)
- **P4:** Add disposition labels to the unlabeled panel-1 findings (filter-chips, layout-shift/SWR spec, db-discipline, tone) in plan.md `## Decisions`.
- **P6:** Amend Harness section (plan-amendment commit): H5 asserts backslash-first escape order explicitly; add H4b (malformed/sort-mismatched cursor → page 1, no throw), H3b (cursor requests skip the count), H6b (unknown entitlement key → exit 1).
- **P5:** Annotate the superseded Design-section lines (`→ superseded by D3/D7/D8`) and correct the line-21 view projection to match the applied DDL (is_confirmed, is_anonymous, COALESCEd columns).
- **P9:** Correct D4's driver attribution in plan.md + the comment in entitlements.server.ts: the app uses **postgres.js** (drizzle-orm/postgres-js), not node-pg; note streaming APIs (.cursor/.forEach) are forbidden in that loader.
- **P3/P7:** Add a one-line note in `reviews/panel-2/adversarial-authz.md` that the ad-hoc item numbering skips 7–9 (self-numbering artifact, no missing findings).

## 1b. Code review of the two written files (3 independent Fable reviewers — all ran clean on Fable)
Two HIGH items are the priority; every fix here is defensive. Core fail-closed logic was verified sound end-to-end and live prod matches the DDL exactly — the issues are at the seams, not the security boundary.
- **CR-1 (HIGH, entitlements.server.ts) — the one fail-OPEN vector:** `requireEntitlement` returns `Promise<void>` and gates only via a thrown rejection. With no floating-promise lint in the repo, a future admin loader that omits `await` compiles clean, the 404 becomes an unhandled rejection, and the gated PII query runs anyway. Fix: make the return load-bearing (return the verified `Set<Entitlement>`/userId so the loader must consume it); write H3 so a missing `await` fails the test; consider adding a no-floating-promises lint.
- **CR-2 (HIGH, migrate-user-roles.mjs) — blind owner check (escalates P8):** checks the *connecting* role before the DDL but never the *view's actual owner after* `CREATE OR REPLACE VIEW` (which preserves a pre-existing owner). A re-run against a wrong-owner view commits green while the admin list silently shows 0 users. Fix: add idempotent `ALTER VIEW lumen.app_users OWNER TO postgres;` + a post-DDL invariant asserting the view's owner is bypassrls and `reloptions @> ['security_invoker=false']`.
- **CR-3 (MED, entitlements):** an unknown DB entitlement key is silently dropped with no log → a legitimately-granted user 404s with zero signal. Add `else logEvent("entitlements_unknown_key", {key})`. (Refines F13; this is fail-closed, not fail-open — the earlier "inverts D5" wording was overstated.)
- **CR-4 (MED, entitlements):** `entitlements_degraded` logs drizzle's wrapper string (`"Failed query… params: <userId>"`) — useless for triage and it leaks the userId. Log `err.cause` instead; add userId as its own field if wanted.
- **CR-5 (MED, migration):** add the negative invariant `NOT has_schema_privilege('lumen_read','auth','USAGE')` — the denial half of the bridge is currently unverified. (= P8's second half.)
- **CR-6 (MED, migration):** `bridge_probe` can't trip (a `log()` not a `check()`; 0-broken looks identical to 0-users). Superseded by CR-2's owner check; keep the probe as informational only.
- **CR-7 (LOW, migration):** `scrub()` leaks the password tail when the DB password contains `@` (`[^@\s]*@` stops at the first `@`, verified). Fix: `\S+@` to backtrack to the last `@`.
- **CR-8 (LOW, migration):** `lumen_read_select_only` false-fails on a correct DB with two grantors → `string_agg(DISTINCT privilege_type, …)`.
- **CR-9 (LOW, entitlements):** null guard `=== null` lets `undefined`/`""` hit the noisy false-`degraded` path → `if (!userId)`.
- **CR-10 (LOW):** F13 sharability IS achievable — build grant-role.mjs with the house `node --import tsx` header and import `ENTITLEMENTS` directly (no duplicate list). `ADMIN_USERS` const optional (call sites already typo-safe via the `Entitlement` union).
- Confirmed cosmetic: redundant index (= F2), driver misattribution (= P9), no entitlements.test.ts yet (= F6 / H1 / H2). Info: `is_confirmed` derives from `email_confirmed_at`, not `confirmed_at` (only matters if phone auth is enabled).

## 2. Code fixes (defensive — Fable-safe)
- **F2:** Remove the redundant `CREATE INDEX idx_user_roles_user` from `USER_ROLES_DDL` in scripts/migrate-user-roles.mjs (composite PK `(user_id, role_slug)` already covers every `user_id` lookup). Note the decision in plan.md. (Prod DROP INDEX optional — negligible.)
- **F3:** Session-integrity: two content-route alias redirects (`routes/scripture.tsx` ~L356, `routes/book.tsx` ~L25) throw bare 301s that drop the root loader's rotated auth Set-Cookie, which can cause an intermittent silent sign-out on a first post-expiry hit to a non-canonical URL. Fix: (a) correct the root.tsx invariant comment — it wrongly says only auth routes redirect; (b) carry the session commit headers on those 301s (run getSessionUser and attach its headers), or hoist alias canonicalization out of the loaders. Re-verify no double-refresh regression.
- **F5:** Tighten `hasAuthCookie` (auth.server.ts) so it does not match the `-code-verifier` cookie — only the session token — so a stuck-mid-login visitor doesn't run getClaims on every request (COR-2 zero-work-for-signed-out). Update the matching test.
- **F13 (do before grant-role.mjs):** Make one machine-readable source of truth for entitlement keys reachable from both TS and plain-node: e.g. `scripts/entitlements.json` (or a `.mjs` constants file) that entitlements.server.ts imports (derive the `Entitlement` union via `as const`) and grant-role.mjs `require`s. Optionally export `ADMIN_USERS = "admin.users"`. Drop the overclaiming comment; add a cross-ref in migrate-user-roles.mjs.

## 3. Test hardening (existing suite has can't-fail tests)
- **F6 (high):** Write `apps/web/app/lib/__tests__/entitlements.test.ts` — the fail-closed authz harness (H1/H2). DI-mock db.execute with the real postgres.js RowList shape. Assert: happy path grants `admin.users`; rejected query → empty set + `entitlements_degraded` logged; unknown keys filtered; requireEntitlement throws 404 for null user, missing entitlement, and degraded load; passes silently when granted.
- **F7 (high):** In auth.routes.test.ts, on the confirm-action success redirect, catch the thrown redirect and assert `err.headers.get("x-committed") === "1"` so the session-minting Set-Cookie is pinned. Same for the login-loader bounce and confirm-loader data responses.
- **F8 (med):** Replace the shape-only `toBeDefined()` header assertion on the login action with `res.init.headers.get("x-committed") === "1"` on the success AND both error-path responses; make the commitHeaders mock return a stable Headers instance.
- **F9 (med):** Add the promised B3 regression test (resend cooldown re-arms on every send — the `actionData` effect dep is load-bearing) plus an action-level test for the `isResend` contract (intent=resend + OTP error → `{sent:false, isResend:true}` with error copy).
- **F10 (low):** Add a test using the fake auth's returned-error channel (`{data:null, error}`) asserting user is null AND rotated cookies still ride; align the fake's null-claims shape with the real contract.
- **F11 (disputed, optional):** Consider asserting the auth-client config (`flowType:"pkce", autoRefreshToken:false, detectSessionInUrl:false`) in the H1 stub. First verify the static refutation (that @supabase/ssr's createServerClient hardcodes these, making the app block documentary) — if confirmed, this is documentation-only, skip or downgrade.

## 4. Step 8 — implement the feature (per plan.md D6–D12)
- `scripts/grant-role.mjs <email> <role>` (house admin-script style: session-mode probe, DRY_RUN_ROLLBACK, invariant_checks, exit 0/1): resolve email→auth.users.id via admin DSN, validate role + entitlement keys against the F13 shared source, upsert lumen.user_roles idempotently. Tests: H6 (+H6b unknown key → exit 1).
- `route("admin/users", "routes/admin.users.tsx")` in routes.ts (run `react-router typegen` after). Loader: requireEntitlement FIRST; then lumen.app_users LEFT JOIN aggregated user_roles; server-side search (ILIKE, backslash-first escape), role/status filters, sort allow-list, keyset pagination. Tests: H3/H3b/H4/H4b/H5.
- UI per D6/D9: real semantic table desktop / stacked cards mobile, URL-owned `?q&role&status&sort&dir`, "Load more" sentinel, existing badge variants only (no new tokens). Emil rules.

## 5. Deferred (Opus, later) — see deferred-security.md
- **DS-1** (safeReturnTo `//` guard) and **DS-2** (login Origin guard). Low severity; exploit-adjacent so kept out of the Fable flow.

## Close-out (unchanged)
Steps 9–15: code-panel (3) → code-adversarial (2) → bug filter → repro tests → fix → deploy + post-deploy smoke (app_users tripwire; anon /admin/users 404) → retro (Provenance histogram + json block w/ feature_slug, plan_to_code_drift, panel_2_dissent_rate) → `FEATURE_SLUG=user-roles node .claude/skills/feature-workflow/tests/validate.mjs --done` → append learnings → merge to main.
