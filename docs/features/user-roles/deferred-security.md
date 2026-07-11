# user-roles — deferred security items (sealed)

> Two low-severity, exploit-adjacent findings from the trust-nothing review are
> deferred out of the active Fable worklist. Full technical detail (repro,
> failure scenario) lives in the review transcripts, deliberately NOT copied
> here so this file stays safe to read in any model context. Pick these up in an
> Opus session when convenient.

## DS-1 — `safeReturnTo` should reject protocol-relative paths (was F1)
- **Where:** `apps/web/app/lib/auth.server.ts` (`safeReturnTo`), single call site `routes/logout.tsx` action.
- **Re-assessed severity:** LOW (reviewer tagged HIGH; real-world exploitability is low — POST-only, one call site, no token in the redirect). See conversation for the reassessment.
- **Defensive remediation (one line):** after the origin check, if the resolved `pathname` begins with `//`, return `"/"`. Add a regression assertion that a `//`-normalizing input collapses to `"/"`.
- **Why deferred here:** the finding's evidence contains offensive PoC content that trips Fable's `cyber` guardrail. The fix itself is trivial and defensive.
- **Status:** DEFERRED. Latent-risk note: matters more the day a GET `?next=` redirect reuses `safeReturnTo`.

## DS-2 — login action lacks an Origin/Sec-Fetch-Site guard (was F4)
- **Where:** `apps/web/app/routes/login.tsx` action; compare `routes/auth.confirm.tsx` which already has the guard.
- **Re-assessed severity:** LOW (largely inherent to forwardable magic-link tokens; victim lands in a non-admin account, no privilege escalation).
- **Defensive remediation (partial):** mirror the same-origin guard from `auth.confirm.tsx` into the login action before the OTP call. Note: this closes the code-verifier-planting vector but not the token-hash path, which is inherent to magic links — document the residual.
- **Why deferred here:** the finding's evidence contains offensive PoC content that trips Fable's `cyber` guardrail.
- **Status:** DEFERRED. Revisit alongside any future in-app per-user state beyond the admin read surface.
