# Panel 1 — Security + Auth-Protocol Review

Reviewer role: security / auth-protocol specialist. Scope: `docs/features/supabase-auth/plan.md` (plan only; no code exists).
Context read: `apps/web/app/lib/headers.server.ts`, `apps/web/workers/app.ts`. All Supabase claims verified against current docs and the `supabase/ssr` source (July 2026).

---

### [SEVERITY: critical] Login action must commit Set-Cookie or the PKCE `?code=` path is dead even same-device

`@supabase/ssr`'s `createServerClient` defaults to `flowType: 'pkce'`. When the login action calls `signInWithOtp(...)`, the client **generates a PKCE code_verifier and writes it through the cookie adapter** (`setAll`). If the action returns `{ sent: true }` without attaching `commitHeaders()`, the verifier cookie never reaches the browser, and the later `exchangeCodeForSession(code)` at `/auth/confirm` fails with `code challenge does not match` — on the *same* device, the happy path. The plan (line 34) says the action "Returns `{ sent: true }` on success" with no mention of headers, and harness H2 does not assert Set-Cookie on the login response.

**Recommendation:**
- Login action returns `data({ sent: true }, { headers: commitHeaders() })`.
- Amend H2: assert the success response carries the `sb-*-auth-token-code-verifier` Set-Cookie (httpOnly, path=/).
- Amend H3: the `?code=` test should seed the request Cookie header with a verifier, mirroring reality.

---

### [SEVERITY: high] Q1 — httpOnly:true is supported, honored, and correct here; enforce it in the adapter anyway

Verified in `supabase/ssr` source (`src/utils/constants.ts`, `src/cookies.ts`):

```ts
export const DEFAULT_COOKIE_OPTIONS: CookieOptions = {
  path: "/", sameSite: "lax", httpOnly: false, maxAge: 400 * 24 * 60 * 60,
};
// cookies.ts merge:
const setCookieOptions = { ...DEFAULT_COOKIE_OPTIONS, ...options?.cookieOptions, maxAge: DEFAULT_COOKIE_OPTIONS.maxAge };
```

`httpOnly` defaults to **false** but a user-supplied `cookieOptions.httpOnly: true` survives the spread (only `maxAge` is force-overwritten). More importantly, with the `getAll`/`setAll` adapter **our code serializes the Set-Cookie header itself**, so we can force `HttpOnly` regardless of library behavior.

Supabase's official answer ("Does @supabase/ssr support HttpOnly cookies? — No … not necessary; the browser-based side of your application needs access to the refresh token", [advanced guide FAQ](https://supabase.com/docs/guides/auth/server-side/advanced-guide), [troubleshooting](https://supabase.com/docs/guides/troubleshooting/how-do-i-make-the-cookies-httponly-vwweFx)) presumes a `createBrowserClient` exists. This app has none: no `onAuthStateChange`, no client-side `getUser()`, no RR7 hydration dependency (the user object arrives as root-loader JSON, not from cookies read in JS). With zero browser client, httpOnly is strictly better — it converts any future XSS from session theft into (at most) same-session request forgery.

**Recommendation:**
- Keep `httpOnly: true`; set it **both** in `cookieOptions` and hard-coded in the `setAll` serializer (belt and braces, asserted by H1).
- Add a guard comment in `auth.server.ts` (and ideally a lint/grep in CI) that `createBrowserClient` must never be introduced without revisiting httpOnly — it would fail silently (client sees no session) rather than loudly.
- Consider `cookieOptions.name` with a `__Host-` prefix in prod (requires Secure, path=/, no Domain — all already true). Low-cost hardening against subdomain cookie tossing.

---

### [SEVERITY: high] Q2 — local JWT verification requires the *signing-key* migration, which is separate from the `sb_publishable_` key migration

Two independent migrations are being conflated by the probe note (plan line 15):

1. **API keys** (`sb_publishable_`/`sb_secret_`) — replace `anon`/`service_role`. Having `sb_publishable_` says **nothing** about JWT signing ([API keys doc](https://supabase.com/docs/guides/api/api-keys)).
2. **JWT signing keys** — migrating from legacy HS256 shared secret to asymmetric (ECC/RSA) keys, done separately on the dashboard's JWT Signing Keys page ([signing keys doc](https://supabase.com/docs/guides/auth/signing-keys)).

`getClaims()` behavior, per [reference docs](https://supabase.com/docs/reference/javascript/auth-getclaims):
- **Asymmetric**: "verification is done locally usually without a network request using the WebCrypto API"; JWKS fetched once from `/auth/v1/.well-known/jwks.json` and cached in-memory. On Workers this cache lives at module scope, which is legal isolate state (it is data, not an I/O object — the db.server.ts per-request rule does not apply). Cost: one JWKS fetch per cold isolate, then zero network per request. Passing the `jwks` option to `getClaims` makes even the cold path zero-network.
- **Symmetric HS256**: "it always sends a request to the Auth server (similar to GoTrueClient.getUser) to verify the JWT" — i.e. `getClaims()` silently degrades to a per-request network call, violating COR-2 with no error to catch.

**Recommendation:**
- Promote the JWKS probe from "verify at implement time" to a **deployment prerequisite**: if `/auth/v1/.well-known/jwks.json` contains no asymmetric key, migrate the project to ECC (P-256) signing keys in the dashboard *before* ship. This is the correct degrade order: fix the project, don't ship the legacy HS256 secret to the Worker (it is a project-wide credential; embedding it to verify locally is the wrong trade).
- If migration is impossible for some reason, accept network `getClaims()` in the root loader but wrap it in the planned never-throw degrade with a tight timeout (~1.5s) and the `auth_user_degraded` event, and document the COR-2 exception.
- Document the revocation tradeoff: local verification means a session revoked elsewhere (global sign-out, banned user) stays "signed in" until the access token expires (default 1h). Acceptable for this feature's scope (no gated content), but must be re-examined the day anything is gated. Anything security-sensitive later should call `getUser()` at point of use, not trust root-loader claims.

---

### [SEVERITY: high] Q3 — with the default email template, one branch of the both-shapes handler is dead and the other is cross-device-broken; edit the template

Mechanics, verified: the default Magic Link template uses `{{ .ConfirmationURL }}` → Supabase's `/auth/v1/verify` endpoint → 302 to `redirect_to` with `?code=`. `exchangeCodeForSession(code)` then requires the `code_verifier` cookie **set on the browser that requested the link**. Supabase's own docs: "PKCE stores a code verifier in the browser that requested the link, so opening the email on a different device or browser can stop the code exchange from completing" ([PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [troubleshooting](https://supabase.com/docs/guides/troubleshooting/pkce-flow-errors-cannot-parse-response-or-zgotmplz-in-magic-link-emails-433665)). The server-side fix is the documented template edit ([magic link guide](https://supabase.com/docs/guides/auth/passwordless-login/auth-magic-link)):

```html
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Sign in</a></p>
```

`verifyOtp({ token_hash, type: 'email' })` has no browser-state dependency — works cross-device, which is the *normal* magic-link usage pattern (request on laptop, open in phone mail app). As planned, the app ships with: `token_hash` branch = dead code (default template never sends it), `?code=` branch = fails for every cross-device open. That is a broken v1 for a predictable majority flow, not an edge case.

The plan's premise "we cannot edit the email template programmatically" (Q3, line 75) is **not strictly true**: the Management API supports `PATCH /v1/projects/{ref}/config/auth` with `mailer_templates_magic_link_content` (needs a personal access token; the MCP toolset here doesn't expose it). Either way it is a one-time change.

**Recommendation:**
- Keep the both-shapes handler (good robustness), but make the `token_hash` template edit a **listed deployment prerequisite** alongside the URL configuration — same section, same loudness. After the edit, `token_hash` is the primary path and `?code=` is the fallback for stale emails.
- Error copy: "This link expired or was opened on a different device" is right for the `?code=` failure. Add a one-click "Send me a new link" CTA (prefilled email if available; otherwise link to /login). Do **not** distinguish "expired" vs "already used" vs "invalid" in copy — that distinction leaks token state to an attacker holding a guessed/intercepted link.

---

### [SEVERITY: med] Email-scanner prefetch will consume one-time links if verification runs in a GET loader

Corporate mail security (Outlook SafeLinks / Microsoft Defender, Barracuda) follows links in email with GET requests before the user clicks. Both arrival shapes are one-time tokens, so the scanner's GET burns them and the human gets "otp_expired" ([supabase/auth#1214](https://github.com/supabase/auth/issues/1214), [discussion #28903](https://github.com/orgs/supabase/discussions/28903), [discussion #41618](https://github.com/orgs/supabase/discussions/41618)). The plan verifies in the `/auth/confirm` **loader** (GET), which is the vulnerable shape.

**Recommendation:** make `/auth/confirm` an interstitial: the loader renders a themed "Continue to sign in" button carrying the params; the **action** (POST) performs `verifyOtp`/`exchangeCodeForSession`. Scanners issue GETs, not form POSTs. One extra click, eliminates the whole class. For a personal-audience app this is med; it becomes high the moment any user is behind Microsoft 365. If deferred, record it as a known limitation in the plan.

---

### [SEVERITY: high] Open signup is currently implicit — `shouldCreateUser` defaults to true; the enumeration story is actually solvable server-side

The plan never mentions `shouldCreateUser`. The default is `true`: `signInWithOtp` **creates an account for any email on Earth** ([signInWithOtp reference](https://supabase.com/docs/reference/javascript/auth-signinwithotp)). Enumeration analysis:

- `shouldCreateUser: true` (default): Supabase's response is identical for new vs existing users — no enumeration, but anyone can mint an account. Today "signed in" grants nothing (no gated content, RLS out of scope), so risk is dormant — but the moment anything checks `user != null`, every attacker already has a valid account.
- `shouldCreateUser: false`: Supabase returns a distinguishable error for unknown emails ([supabase/auth#1955](https://github.com/supabase/auth/issues/1955)) — an enumeration leak **only if you forward it**. This flow is fully server-side: the action can catch that specific error and still return the generic `{ sent: true }`. Server-side masking gives closed signup *and* no enumeration — an option a client-side flow doesn't have.

**Recommendation:** make the decision explicit in the plan. For Lumen's current posture (personal project, no gated content, no profiles) I recommend `shouldCreateUser: false` + generic-success masking, flipping to open signup as a deliberate later decision. If open signup is intended, say so and note the dormant-account caveat. Either way, amend H2 to assert: unknown-user error from supabase → response is still generic `{ sent: true }` (no enumeration through error shape, status code, or timing-visible copy).

---

### [SEVERITY: med] Built-in mailer is a 2-email/hour project-wide fuse — trivially blown by one stranger

Verified limits ([rate limits doc](https://supabase.com/docs/guides/auth/rate-limits)): built-in provider = **2 emails per hour project-wide**; `/otp` endpoint = 30/hr project-wide default; 60s per-address cooldown. Consequence: any anonymous visitor submitting the login form twice locks *everyone* (including Abram) out of sign-in for an hour. That is not a "testing is fine" footnote; it is the availability profile of the login system at launch. Secondary abuse: the form is an email-sending oracle to arbitrary addresses from Supabase's sender (reputation + harassment surface), and a cross-site POST can trigger it (see CSRF finding).

**Recommendation:**
- Reframe custom SMTP from "later feature" to "prerequisite for any non-personal usage"; keep built-in mailer only while the sole user is Abram.
- Add a cheap per-IP throttle at the Worker on the login action (Cloudflare rate-limiting rule on `POST /login`, or a KV counter) so one client can't drain the project-wide quota.
- Surface Supabase's 429/`over_email_send_rate_limit` as the *same generic* "check your email" success in prod copy (or a neutral "try again shortly") — never confirm to an attacker that they exhausted the quota, and never differ by account existence.

---

### [SEVERITY: med] Logout: `signOut()` DOES revoke refresh tokens server-side — but default scope is `global`; choose deliberately and clear cookies even on failure

Verified ([signOut reference](https://supabase.com/docs/reference/javascript/auth-signout)): `signOut()` calls the auth server and revokes refresh tokens; default scope is **`global`** — "signs the user out of every device they are currently signed in on". `local` revokes only the current session; docs recommend it "for most apps". Two plan gaps:

1. Scope unspecified → you silently get `global`. For a header-menu "Sign out" the least-surprise behavior is `{ scope: 'local' }`. (Global sign-out is a fine *future* control on an account page.)
2. If the network revocation fails (Supabase down, token already expired), the action must **still clear cookies and redirect** — never leave the user visibly signed in because revocation errored. Pair with the house never-throw pattern + a named degrade event (`auth_signout_degraded`).

Also note the completeness caveat: revocation kills the *refresh* token; the access-token JWT stays technically valid until expiry (~1h), and local `getClaims()` verification (Q2) will keep honoring it. For this feature (nothing gated) that's acceptable — document it so nobody later assumes logout is instant revocation.

Amend H4: assert `signOut` called with explicit scope; add a case where `signOut` throws → cookies still cleared, still 302 `/`.

---

### [SEVERITY: low] CSRF: POST + SameSite=Lax is sufficient for logout; add an Origin check on POST actions as cheap defense-in-depth

Logout: `SameSite=Lax` blocks cookies on cross-site POST, so a forged logout arrives sessionless and no-ops — the plan's posture is correct. Login: the action needs no cookies, so Lax does nothing for it; a cross-site form POST *can* trigger email sends (the abuse path in the mailer finding — classic login-CSRF impact here is nil because the magic link goes to the email's owner, not the attacker). On Workers, browsers send an `Origin` header on all POSTs; comparing it to the request URL's origin is ~3 lines in a shared action guard and closes both cross-site-POST surfaces at once. Recommend adding it (reject mismatched non-null Origin with 403); not blocking.

---

### [SEVERITY: low] Open redirect: dropping `?next=` is the right call; pin `emailRedirectTo` to an explicit origin allowlist rather than raw request origin

Agree with the plan: no `?next=` in v1 removes the classic post-auth open-redirect surface for zero cost. Remaining surfaces reviewed: `/auth/confirm` success redirects to a hardcoded `/` (good); the only derived value is `emailRedirectTo = origin + "/auth/confirm"`. Host-header injection on Cloudflare Workers is largely theoretical — routing to the Worker is itself Host-based (workers.dev and custom-domain routes), so `request.url`'s host is the hostname Cloudflare actually routed, not attacker free-text. Supabase backstops it anyway: a non-allowlisted `redirect_to` silently falls back to Site URL. But that same *silent fallback* is the real operational hazard the plan already noticed (line 55): a derivation bug doesn't fail, it mis-mails links.

**Recommendation:** don't derive from raw origin — match `url.origin` against a hardcoded two-entry allowlist (`https://lumen.abramhimmer.workers.dev`, `http://localhost:5173`) and fail loudly (500 + event) on anything else. H2 already asserts "allowlisted emailRedirectTo"; make the allowlist the mechanism, not just the test's expectation.

---

### [SEVERITY: low] Root-loader cookie commitment on SPA navigations (flag for framework panelist — security-adjacent)

Q4 is framework territory, but the security-relevant corner: in RR7 the **root loader does not re-run on ordinary client-side navigations** (only on document loads and post-action revalidation). Token refresh — and its Set-Cookie commit — therefore happens only when the root loader actually executes. A long-lived SPA session that never triggers root revalidation can silently cross the access-token expiry; next root-loader run must then perform a refresh (network) or the user degrades to signed-out. Not exploitable, but it shapes where `commitHeaders()` must be honored: **every** loader/action that touches `getAuth` must commit, not just root. Worth an explicit line in the plan.

Also noting: `headers.server.ts` (`applySecurityHeaders`) uses `headers.set(...)` on a copied Headers object — verify at implement time that multiple `Set-Cookie` values survive the `new Headers(response.headers)` copy (Workers' Headers preserves them; a refactor to a plain-object copy would coalesce them — classic auth-breaking footgun).

---

## Verdict

**Q1 — httpOnly with @supabase/ssr:** YES — supported and safe here. Verified in source: `DEFAULT_COOKIE_OPTIONS.httpOnly = false` but `cookieOptions.httpOnly: true` survives the merge (only `maxAge` is forced), and the `getAll`/`setAll` adapter means our code writes Set-Cookie anyway. Supabase's "don't do it" FAQ presumes a browser client; this app has none, and RR7 hydration consumes the user from loader JSON, not cookies — no hidden client dependency. Enforce httpOnly in the adapter itself and guard against future `createBrowserClient` introduction. **Plan is right; docs' discouragement does not apply.**

**Q2 — getClaims() vs getUser():** getClaims() gives zero-network per-request verification on Workers **only if the project uses asymmetric JWT signing keys** — a migration *separate* from the `sb_publishable_` API-key migration, which the plan's probe conflates. Asymmetric: local WebCrypto verify, JWKS cached at module scope (one fetch per cold isolate; pass `jwks` explicitly for zero even cold). Symmetric HS256: getClaims **silently degrades to a network call per request** (equivalent to getUser) — a COR-2 violation you can't catch as an error. Correct degrade order: (1) probe JWKS, (2) migrate project to ECC P-256 as a deployment prerequisite, (3) only if impossible, accept network verification behind the never-throw wrapper with timeout + degrade event. Never ship the legacy HS256 secret to the Worker. Accept and document the ~1h revocation lag inherent to local verification.

**Q3 — PKCE `?code=` vs `token_hash`:** The both-shapes handler is good engineering but the plan's default is wrong: with the stock email template the `token_hash` branch never fires and the `?code=` branch fails for every cross-device open — the *normal* magic-link pattern. The template edit to `{{ .TokenHash }}` is a one-time dashboard action (and *is* automatable via Management API `PATCH /v1/projects/{ref}/config/auth`, contra the plan's premise); make it a deployment prerequisite next to URL configuration, with `?code=` retained as fallback. Error copy "expired or opened on a different device" + resend CTA is right; never distinguish used/expired/invalid. Additionally, verify via POST interstitial, not in the GET loader, or email scanners will burn the one-time tokens.

**Severity roll-up:** 1 critical (login action must commit the PKCE verifier cookie), 4 high (Q2 signing-key migration, Q3 template default, implicit open signup, httpOnly enforcement details), 3 med, 3 low. No architectural rejection — the plan's server-only, httpOnly, no-`?next=`, POST-logout posture is fundamentally sound; the findings are protocol-mechanics corrections.
