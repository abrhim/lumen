# panel-1 (aggregated 2026-07-10) — roles: security-auth, platform, ux-theme

---
<!-- panel-1/security-auth.md -->
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

---
<!-- panel-1/platform.md -->
# Platform-correctness review — supabase-auth plan

Reviewer: PLATFORM-CORRECTNESS (React Router 7.9.6 + Cloudflare Workers + Supabase SSR).
Scope: plan.md at `/Users/abram/code/lumen/docs/features/supabase-auth/plan.md`. Claims below verified against RR source (`main`, server-runtime), @supabase/ssr and auth-js source, and current CF/Supabase docs — not from memory.

---

### [SEVERITY: high] Q4 — Root-loader `Set-Cookie` DOES flow without a `headers` export, on both document and .data requests (verified in RR source)

**Evidence.** RR docs say loader headers are NOT sent automatically and require a `headers` export — *"One notable exception is `Set-Cookie` headers, which are automatically preserved from `headers`, `loader`, and `action` in parent routes, even without exporting `headers` from the child route."* ([HTTP Headers doc](https://reactrouter.com/how-to/headers)). Confirmed in source, `packages/react-router/lib/server-runtime/headers.ts` — `getDocumentHeaders` runs the no-`headers`-export branch:

```ts
if (headersFn == null) {
  let headers = new Headers(parentHeaders);
  prependCookies(actionHeaders, headers);
  prependCookies(loaderHeaders, headers);
  return headers;
}
```

and `prependCookies` splits + `headers.append("Set-Cookie", …)` per cookie (dedupe via `getSetCookie()`).

Crucially for single fetch: `packages/react-router/lib/server-runtime/single-fetch.ts` calls **the same** `getDocumentHeaders(context, build)` inside both `singleFetchAction` and `singleFetchLoaders` before `generateSingleFetchResponse`. So `.data` client-navigation requests carry the same merged `Set-Cookie` headers as document requests. Loader redirects on `.data` requests are encoded as status 202 (`SINGLE_FETCH_REDIRECT_STATUS`) with `Location` moved into the body payload — but the response still carries the computed document headers, i.e. `Set-Cookie` survives the single-fetch redirect encoding.

**The exact working pattern** (no `headers` export needed on root or leaves):

```ts
// root.tsx
export async function loader({ request, context }: Route.LoaderArgs) {
  const { supabase, commitHeaders } = getAuth(request, context.cloudflare.env);
  const user = await getUser(supabase); // never-throw degrade
  return data({ user }, { headers: commitHeaders() }); // Set-Cookie only
}
```

**Two conditions to respect** (both bite silently if violated):
1. Only `Set-Cookie` gets this free ride. Any other header from the loader needs a `headers` export. Fine for this plan.
2. If any route in the matched branch later ADDS a `headers` export, it takes over header computation for the branch — it must forward `loaderHeaders`' cookies (the special-case still prepends parent cookies, but a sloppy `headers` fn on the SAME route can drop its own loader's non-cookie headers). Keep the invariant: auth cookies only ever travel via `data(..., { headers })` / `redirect(..., { headers })`, never via a `headers` export.

**Known upstream bug that does NOT apply here:** [react-router#13657](https://github.com/remix-run/react-router/issues/13657) (only last `Set-Cookie` reaches the client) is in the Node/Express `createRequestListener` header serialization path (@react-router/node). On Workers the RR handler's `Response` goes straight to workerd, which is `getSetCookie()`-aware. Still worth a harness assertion because @supabase/ssr CHUNKS large sessions into multiple cookies (`sb-…-auth-token.0`, `.1`) — multiple `Set-Cookie` correctness is load-bearing, not cosmetic. Add to H1: two appended cookies in → `commitHeaders().getSetCookie().length === 2` out, and the same through `applySecurityHeaders`.

---

### [SEVERITY: high] One real cookie-drop window: document-request redirects thrown by OTHER routes' loaders don't merge a concurrent root refresh

`getDocumentHeaders` merging happens when RR renders/encodes a normal result. When a loader **throws a `redirect()` during a document request**, RR returns that Response as-is — sibling/parent loader `Set-Cookie` headers from the same navigation are not merged in. If the root loader rotated the refresh token (Supabase rotates on every refresh) in the same document navigation where a child loader threw a redirect, the new token's `Set-Cookie` is dropped → browser retains the consumed refresh token.

**Why this is survivable:** Supabase Auth has a refresh-token reuse grace interval (default 10 s) and reuse-detection lineage, so the immediate follow-up request usually recovers. And in this app today no child loader redirects post-login. But:

**Recommendation.**
- Any redirect this feature itself issues must carry the cookies on the redirect Response — the plan already does this for `/auth/confirm` and `/logout` (`redirect("/", { headers: commitHeaders() })`). Keep that; it is the only reliable channel on redirects.
- Add one sentence to the design doc: "any future loader that redirects must not assume root-loader cookie refresh was committed." Cheap insurance against a genuinely nasty intermittent logout bug later.

---

### [SEVERITY: high] Q2/Q6 — Root loader on single fetch reruns on EVERY client navigation; `getUser()` there is a per-navigation network round-trip to the project region. Use `getClaims()`; the JWKS cache is module-global and Workers-safe

**Revalidation fact:** with single fetch (always-on in RR7 framework mode), all matched loaders — root included — rerun on every client navigation and after every action unless `shouldRevalidate` opts out ([discussion #12589](https://github.com/remix-run/react-router/discussions/12589), [single-fetch guide](https://v2.remix.run/docs/guides/single-fetch)). So the plan's root loader IS a per-navigation server call; what matters is what it does.

**`getUser()`** hits `GET /auth/v1/user` on the Supabase project (single region) — Supabase's own docs recommend avoiding that from edge runtimes per-request. That violates COR-2.

**`getClaims()`** with asymmetric signing keys verifies locally via WebCrypto. Verified in auth-js source (`GoTrueClient.ts`): the JWKS cache is **module-level**, shared across client instances:

```ts
const GLOBAL_JWKS: { [storageKey: string]: { cachedAt: number; jwks: { keys: JWK[] } } } = {}
```

It stores plain JSON (not a fetch Promise / I/O object), so cross-request reuse of this cache is **legal on Workers** — the per-request-I/O prohibition covers I/O objects (sockets, streams, in-flight Responses), not data. Per-request `createServerClient` + warm isolate ⇒ zero JWKS network calls after the first (10-min TTL; Supabase edge-caches the JWKS endpoint for cold isolates). Also note: `getClaims()` internally goes through `getSession()`, which refreshes an expired access token inline even with `autoRefreshToken: false` — that refresh is exactly what `commitHeaders()` must flush, and Q4 above confirms it flows on `.data` requests.

**The load-bearing precondition:** on **symmetric (HS256, legacy JWT secret)** projects, `getClaims()` falls back to a network `getUser()` call ([getClaims reference](https://supabase.com/docs/reference/javascript/auth-getclaims), [JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys)). The plan's implement-time JWKS probe is therefore not a nicety — it decides whether COR-2 holds. The `sb_publishable_` key suggests the new key system, but new-API-key projects can still be on the legacy shared secret. If the probe finds no asymmetric key: migrate signing keys in the dashboard **before** shipping, or accept per-navigation latency knowingly.

**`shouldRevalidate` tuning (optional, recommended):** with local `getClaims` the per-navigation cost is ~cookie-parse + WebCrypto verify — acceptable, no tuning strictly needed. If you want the root read off plain GET navigations anyway:

```ts
// root.tsx — rerun auth only after mutations (logout fetcher POST, login action)
export function shouldRevalidate({ formAction }: ShouldRevalidateFunctionArgs) {
  return formAction != null;
}
```

This is safe for session persistence: skipped revalidations just mean the refresh happens on the next document request or action instead; the refresh token stays valid regardless. Do NOT return `false` unconditionally — the header chip would go stale after logout (fetcher-action redirects revalidate via the same rules).

---

### [SEVERITY: med] Q3 (bundling half) — `@supabase/ssr` on this exact stack has a known dev/build failure mode: "Dynamic require of 'stream' is not supported"

[supabase#37592](https://github.com/supabase/supabase/issues/37592) reports precisely this stack — React Router 7 + Cloudflare Workers + `@supabase/ssr` — failing at Vite SSR build/dev with a dynamic `require("stream")` from a transitive CJS dep (`@supabase/node-fetch`, supabase-js's fetch fallback). It is environment/bundling, not runtime: with `nodejs_compat` + compat date 2025-10-08 (already set in `wrangler.json`) `node:stream` exists at runtime; the failure is Vite/esbuild CJS→ESM prebundling without the node platform. `@cloudflare/vite-plugin` 1.15.3 with `unstable_viteEnvironmentApi` handles node builtins for the worker environment in most cases, but this repo pins exact versions and the issue is recent.

**Recommendation (probe-first, per house learnings):** immediately after `pnpm add`, before writing feature code, do the 3-way smoke: `react-router dev` (load a route importing `auth.server.ts`), `react-router build`, `wrangler deploy --dry-run`. If the stream error appears, the cheap durable fix is aliasing the fallback away — Workers always has global `fetch`, so `@supabase/node-fetch` is dead code:

```ts
// vite.config.ts
resolve: { alias: { "@supabase/node-fetch": path.resolve("./app/lib/fetch-shim.ts") } }
// fetch-shim.ts
export default globalThis.fetch;
export const Headers = globalThis.Headers, Request = globalThis.Request, Response = globalThis.Response;
```

Also pin a current `@supabase/supabase-js` (2.5x+) — recent versions lazy-load the node-fetch fallback, which often makes the alias unnecessary. Realtime/WebSocket is a non-issue here: `SupabaseClient` constructs a `RealtimeClient` but opens no socket unless `.channel()` is called; this app never calls it. `process.version` sniffs are satisfied under `nodejs_compat` at this compat date.

---

### [SEVERITY: med] Per-request client discipline — `createServerClient` per request is correct AND required; no post-response I/O risk with the plan's config

Verified in @supabase/ssr source (`createServerClient.ts`): every call constructs a fresh `SupabaseClient` — no module-level singleton, no shared state — and its own docs mandate per-request construction. It configures the underlying GoTrueClient with `flowType: "pkce"`, `autoRefreshToken: false`, `detectSessionInUrl: false`, `persistSession: true`, `skipAutoInitialize: true`. Consequences:

- **No timers, no background refresh loop** (`autoRefreshToken: false`), and `skipAutoInitialize` means zero work until the first auth call — construction is allocation-only, cheaper than the `createDb` the worker already does per request. No `ctx.waitUntil` needed for auth; nothing runs after the response.
- The only cross-request state anywhere in the stack is the `GLOBAL_JWKS` data cache (finding above) — legal and desirable on Workers.
- Mirror `db.server.ts`: build the client inside `getAuth(request, env)` called from loaders/actions (or construct in `workers/app.ts` fetch and pass via `AppLoadContext`, matching the `db` pattern — either is per-request; the loader-level factory is simpler since auth needs the `Request` for cookies anyway).
- One inversion vs `db.server.ts`: there is no `end()` to `waitUntil` — do NOT add one; supabase-js over `fetch` holds no socket.

**Verdict-level answer:** per-request construction is correct, cheap, and the only Workers-safe option. No I/O-after-response risk with `autoRefreshToken: false`; the inline refresh inside `getClaims()/getSession()` completes before the loader returns.

---

### [SEVERITY: low] Q1 — `httpOnly: true` via `cookieOptions` is honored by the server client; keep it, and assert it in H1

`createServerClient` merges user `cookieOptions` over its defaults when `setAll` fires during `applyServerStorage`; it does not force `httpOnly: false` on the server client (that concern applies to `createBrowserClient`, which this app doesn't use). Since no browser-side supabase-js exists, `httpOnly: true; Secure; SameSite=Lax; Path=/` is strictly better. The plan's H1 already asserts the flags — good; make the assertion exact-string on one emitted `Set-Cookie` so a dependency bump that changes defaults fails loudly. One sizing note: session cookies chunk at ~3180 bytes into `.0/.1` suffixed cookies — H1 should include one oversized-session case so `commitHeaders()` is proven to emit multiple `Set-Cookie` lines (ties into the #13657 assertion above).

---

### [SEVERITY: low] Origin derivation from `request.url` is acceptable on this deployment; the Supabase redirect allowlist is the actual security boundary — optionally pin `APP_ORIGIN`

On Workers, `request.url` reflects the incoming Host, but routing is host-based: a request only reaches this worker if the Host resolves to `lumen.abramhimmer.workers.dev` (or a future bound custom domain). Arbitrary Host-header games route elsewhere or 404 at Cloudflare's edge; workers.dev names can't be shadowed. So `new URL(request.url).origin` is trustworthy here. Defense in depth is already structural: `emailRedirectTo` outside the dashboard allowlist **silently falls back to Site URL** — a spoofed origin can't redirect the magic link anywhere hostile, it can only break the flow back to Site URL. Recommendation: keep request-derived origin (it makes localhost:5173 work with zero config), but if a custom domain is ever added alongside workers.dev, switch to an `APP_ORIGIN` var then — two live hosts is when Host-derived origins start producing links that bounce between hosts and break PKCE's same-device requirement. Note the fallback behavior in the error copy consideration: a non-allowlisted origin does not error, it mis-redirects — the deployment-prerequisite section of the plan already surfaces this; good.

---

### [SEVERITY: low] Q5 — Route module shapes are correct RR7; two sharp edges to respect

1. **`/auth/confirm` loader-only + error UI:** a route with a default-export component may return `data({ ok: false, reason })` from its loader and render the themed error — correct. The sharp edge: **without** a default export RR treats the module as a resource route, and a non-Response return breaks. The plan renders UI, so the component exists — fine. Types come from `./+types/auth.confirm` (matches the `routes/auth.confirm.tsx` filename; typegen runs in `typecheck` already). On success return `redirect("/", { headers: commitHeaders() })` — cookies must ride the redirect itself (see finding 2). No hydration concern: the error UI is plain loader data.
2. **`/logout` action+loader both redirecting, no component:** correct RR7 resource-route idiom — POST hits the action (`signOut()` + cookie-clearing redirect), GET hits the loader (bare redirect, no signOut — plan's H4 asserts this; good, it keeps logout un-CSRF-able and un-prefetchable). Both must return `Response`s since there's no component — they do. The header chip should trigger it via `useFetcher().submit(null, { method: "post", action: "/logout" })`; after the action redirect, revalidation refreshes the root user (respect the `shouldRevalidate` note above — `formAction != null` keeps this working).
3. `routes.ts` additions are mechanical: `route("login", "routes/login.tsx")`, `route("auth/confirm", "routes/auth.confirm.tsx")`, `route("logout", "routes/logout.tsx")` alongside the existing config-style entries in `/Users/abram/code/lumen/apps/web/app/routes.ts`.

---

### [SEVERITY: low] Q7 — `applySecurityHeaders` is Set-Cookie-safe and redirect-safe; add one harness line to keep it that way

`/Users/abram/code/lumen/apps/web/app/lib/headers.server.ts` copies via `new Headers(response.headers)` then reconstructs the Response. Per the post-2023 Fetch spec (implemented in workerd, `getSetCookie` on by default at this compat date, and matched by undici in the vitest environment), Headers iteration yields each `Set-Cookie` entry separately, so the copy constructor preserves multiples — no coalescing, no stripping. Status/statusText/body pass through, so 302s from confirm/logout and single-fetch 202 redirect encodings survive. None of the four security headers conflict with auth (`X-Frame-Options: DENY` is fine — magic-link flow never iframes). Recommendation: one assertion in the route harness — wrap a Response carrying two `Set-Cookie` headers plus a 302 through `applySecurityHeaders` and assert `getSetCookie().length === 2` and status 302. It pins the copy-constructor behavior against future refactors of that function.

---

### [SEVERITY: low] Q8 — `.server.ts` discipline is sufficient; the framework enforces it loudly

Name the helper `app/lib/auth.server.ts` (plan already does). RR7's Vite plugin hard-fails the build if a `.server.` module reaches the client graph, so a mistaken client-side import of `@supabase/ssr` is a build error, not a silent leak. Route modules imported by the client bundle are safe as long as supabase imports live only in the loader/action path via `auth.server.ts` — RR removes server-only exports from client route chunks, and the `.server` suffix is the belt to that suspenders. Keep `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` flowing via `context.cloudflare.env` (as `wrangler.json` `vars`), never `import.meta.env` — publishable key leaking client-side would be harmless by design, but the discipline keeps the door shut for future secret-class vars.

---

## Verdict

**Q4 (root-loader cookies under single fetch):** YES — `data(payload, { headers })` from the root loader emits `Set-Cookie` on BOTH document requests and `.data` client-navigation requests, **without any `headers` export**. `Set-Cookie` is explicitly special-cased: `getDocumentHeaders`' no-headers-fn branch appends loader/action cookies via `prependCookies`, and the single-fetch handlers (`singleFetchAction`/`singleFetchLoaders`) call the same `getDocumentHeaders` for `.data` responses, including 202-encoded redirects. The plan's session-persistence mechanism is sound as designed. Constraints: cookies must also ride explicitly on any `redirect()` Response the feature itself returns (plan complies); never introduce a `headers` export on these routes that doesn't forward `loaderHeaders`; and add the multiple-`Set-Cookie` harness assertions (chunked sessions + `applySecurityHeaders` pass-through) since the one known upstream multi-cookie bug (#13657) lives in the Node adapter, not workerd — assert it stays irrelevant.

**Per-request client:** Per-request `createServerClient` is correct, required, and cheap — verified: no module-level client state, `skipAutoInitialize` defers all work, `autoRefreshToken: false` means no timers and **no I/O after the response** (inline token refresh completes inside the loader; no `waitUntil` needed, and unlike `createDb` there is nothing to `end()`). The only shared state is auth-js's module-level `GLOBAL_JWKS` plain-data cache, which is Workers-legal and is what makes per-request `getClaims()` a zero-network local verification on warm isolates. **Conditional:** this whole cheap-path story requires asymmetric signing keys — on legacy HS256, `getClaims()` silently degrades to a per-navigation network `getUser()`, so the implement-time JWKS probe is a ship-gate, not a checkbox.

---
<!-- panel-1/ux-theme.md -->
# Panel-1 review — UX / Theme / Accessibility

Reviewer role: UX + theme + a11y specialist. Sources read: plan.md; root.tsx; app.css (full token/theme block); routes/home.tsx, word.tsx, scripture.tsx (header/rail/sheet), scripture.art.tsx; ui/select.tsx, button.tsx, dropdown-menu.tsx, sheet.tsx, dialog.tsx; emil-design-engineering SKILL.md + forms-controls.md + touch-accessibility.md.

---

### [SEVERITY: high] Signed-out "Sign in" does not belong in fixed chrome on reading pages — and v1 gives it no reason to be there

The plan puts a persistent "Sign in" ghost link in the fixed top-right cluster on every page (§Root integration). Two problems compound:

1. **This is a contemplative reading app.** The chapter view is deliberately chromeless — no header bar, just a `max-w-prose` column of Newsreader 19px and one small floating ThemeSelect. ThemeSelect earns its fixed position because it *serves the reading* (you change theme mid-read). "Sign in" serves nothing mid-read; it is the one element in the viewport asking the reader to stop reading.
2. **v1 auth gates nothing.** The out-of-scope list cuts profiles, RLS, gated content, and the account page. A signed-out reader who taps "Sign in" on Alma 32 gets an email round-trip and lands back on `/` (not even the chapter they left — see the `?next=` finding) with *zero visible benefit*. A persistent CTA to a no-op is worse than no CTA.

**Recommendation:** Split the affordance by state:
- **Signed-out:** show "Sign in" **only on the home page**, and make it *static, not fixed* — a quiet `font-ui text-xs font-semibold text-muted-foreground hover:text-ink` link. Two acceptable placements: (a) in the home header row, right-aligned opposite the "Lumen" eyebrow (`flex items-baseline justify-between`); or (b) route-conditional in root (`pathname === "/"`) inside the fixed cluster. Prefer (a): it keeps reading routes 100% clean and the library page is where an account decision naturally happens.
- **Signed-in:** the initial chip DOES join the fixed cluster on all pages (see chip findings below). It is a state indicator + the only path to sign-out, it is quiet (a 28px letter disc), and unlike "Sign in" it never solicits.

This asymmetry (chip everywhere, sign-in home-only) is the whole verdict; argued further under `## Verdict`.

---

### [SEVERITY: high] Fixed-cluster geometry: exact placement, and the chapter-rail overlap you are about to make worse

Current state: ThemeSelect is `fixed right-4 top-4 z-40`, size `sm` → **h-7 (28px)**, ~90px wide, `bg-surface shadow-sm`. Overlays (Sheet, Dialog, Select/Dropdown content) are all `z-50`, so the cluster correctly sits *under* every overlay and *over* page content.

Per-page collision audit:
- **Home** (`max-w-4xl px-6 py-12`): header text starts ~48px down, left-aligned. Top-right is empty. No collision, even with a 44px-tall cluster.
- **Word page** (`max-w-4xl px-6 py-10`): eyebrow at ~40px, left-aligned; the 5xl Hebrew/translit row wraps below it. Cluster spans y 16–44px (or 16–52 with a chip) — clears it. Fine.
- **Chapter view desktop** (`max-w-6xl` grid with a 380px rail, rail is `lg:sticky lg:top-6`): **there is an existing overlap**. Once the reader scrolls, the rail's top edge pins at 24px; ThemeSelect occupies y 16–44px and, at viewports between ~1024 and ~1400px, x-overlaps the rail's top-right corner (at 1280px the rail's right edge is ~88px from the viewport edge; the trigger spans ~16–106px). Today this is survivable because the rail has `p-5` interior padding and its top-right is usually empty. Adding a second element grows the cluster ~44–60px further left, deepening the incursion over the rail's heading/graph-button row.
- **Chapter view mobile:** header eyebrow is left-aligned and content starts at ~40px; no collision. The bottom sheet is `z-50 side=bottom` with a full-viewport `z-50` overlay — the cluster dims beneath the overlay, which is correct. No action needed.
- **Art gallery** (`max-w-6xl px-6 py-10`): same shape as word page. Fine. Lightbox Dialog is `z-50` — covers the cluster correctly.

**Recommendation (exact):**
1. Replace the bare fixed trigger with one cluster container in root:
   ```tsx
   <div className="fixed right-4 top-4 z-40 flex items-center gap-2">
     <AuthChip />      {/* signed-in only */}
     <ThemeSelect />   {/* drop `fixed right-4 top-4 z-40` from SelectTrigger */}
   </div>
   ```
   Chip **left of** ThemeSelect: ThemeSelect keeps its exact current position in every state and on every page — no positional shift of a control users already have muscle memory for when auth state changes. (The corner-avatar convention argues the other order; positional stability of the existing control wins in an app this quiet.)
2. Cap cluster growth: signed-in adds only a `size-7` disc + 8px gap (~36px). Do NOT put a signed-out "Sign in" here on reading routes (previous finding) — that is what keeps the rail overlap from getting worse where it matters (chapter view is the only overlap page, and signed-in adds the minimum width).
3. Optional hardening, cheap: `lg:top-6` → the rail already tucks under; if the overlap ever bites, change the rail to `lg:top-16` on chapter view rather than moving the cluster. Not required for v1.
4. Keep `z-40` for the cluster. Do not mint a new z value.

---

### [SEVERITY: med] ThemeSelect trigger and the proposed chip are both under the 44px touch minimum — fix both while you're in here

`size="sm"` SelectTrigger is `h-7` = 28px. The plan promises a "44px target" chip but a 44px *visual* disc next to a 28px select will look like a fried egg beside a stamp. Emil's rule separates visual size from hit area.

**Recommendation:** visual `size-7` (28px, matches ThemeSelect optically), hit area 44px via pseudo-element:
```tsx
<DropdownMenuTrigger
  aria-label={`Account: ${email}`}
  className="relative flex size-7 items-center justify-center rounded-full border border-rule2 bg-panel2 font-ui text-xs font-semibold uppercase text-ink shadow-sm outline-none transition-colors duration-150 hover:border-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 after:absolute after:-inset-2 after:content-[''] touch-action-manipulation"
>
  {initial}
</DropdownMenuTrigger>
```
`after:-inset-2` on 28px = 44px hit box with zero layout cost. Apply the same `after:-inset-2` trick to the ThemeSelect trigger (pre-existing violation, one-line fix, this feature touches the file anyway). Add `touch-action: manipulation` to both.

---

### [SEVERITY: med] Chip appearance across the four themes — use neutral panel2/ink, not the selbar accent

Rating the chip against a selbar-filled avatar (the obvious "brand accent" move): selbar is **#3f5aa9** (paper), **#b07d2b** (parchment), **#21708e** (linen), **#d4a24a** (ink). A filled gold disc in parchment/ink reads as a notification badge or warning dot — exactly wrong for a passive identity marker, and the two gold themes would need dark foreground while the two blue/teal themes need light foreground (two contrast regimes to maintain).

The neutral recipe above (`bg-panel2 border-rule2 text-ink`) renders as:
- **paper:** #f1f1ec disc, #e6e6e0→#d4d5cd border, charcoal #25272b letter — a pale stone button, sits level with the white bg-surface ThemeSelect.
- **parchment:** warm cream #f0e8d8 disc, sand border #d8ccb5, near-black-brown #2a251f letter — looks like a wax-less seal on the parchment; right register.
- **linen:** cool mist #e8eef0 disc, #c8d4da border, slate #22303a letter.
- **ink:** graphite #26282e disc, #43464e border, bone #e8e6e1 letter — quiet, legible, no glow.

All four are ≥12:1 contrast letter-on-disc. Focus ring picks up the theme accent automatically via `--ring` (blue/gold/teal/gold) — the accent shows exactly when it should (keyboard focus) and never at rest. One nit: use `font-ui` (Archivo) semibold for the initial, `uppercase` — a Fraunces display initial at 12px turns to mush.

---

### [SEVERITY: med] Login form spec — the plan's one line ("text-base ≥16px, iOS no-zoom") is necessary but not sufficient

Concrete gaps against the Emil checklist, with the full recommended field spec (there is no `ui/input.tsx` in the project — this will be hand-rolled, so spell it out):

```tsx
<form method="post" className="mt-8">
  <label htmlFor="email"
    className="block font-ui text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
    Email
  </label>
  <input
    id="email" name="email" type="email" required
    autoComplete="email" inputMode="email"
    autoCapitalize="none" autoCorrect="off" spellCheck={false}
    aria-invalid={!!error} aria-describedby={error ? "email-error" : undefined}
    className="mt-2 h-11 w-full rounded-lg border border-input bg-surface px-3
      font-ui text-base text-ink outline-none transition-colors
      focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
      aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
  />
  <p id="email-error" className="min-h-6 pt-1 font-ui text-[13px] text-destructive">
    {error ?? " "}
  </p>
  <button type="submit" disabled={busy}
    className="h-11 w-full rounded-lg bg-primary font-ui text-sm font-semibold
      text-primary-foreground transition-[transform,opacity] outline-none
      focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]
      disabled:opacity-50 touch-action-manipulation">
    {busy ? "Sending…" : "Email me a sign-in link"}
  </button>
</form>
```

Point-by-point rationale:
- `text-base` (16px) on the input — iOS zoom, plan already has it. `h-11` = 44px gives the tap target on both input and button.
- **Do** use `autoComplete="email"` here. Emil's default is autocomplete OFF, but that guidance is for noise fields; a sign-in email field is the canonical autofill case and it feeds iOS's QuickType email chip. `autoCapitalize="none"` + `autoCorrect="off"` prevent "Abram@Soar.com" mangling. `inputMode="email"` is technically redundant with `type=email` but harmless and belt-and-braces across Android keyboards.
- **Enter submits** falls out of the native `<form method="post">` + `type="submit"` — do not intercept keydown. Use the RR7 `<Form>`/fetcher, not onClick.
- **No layout shift on error:** the `min-h-6` error slot is always in flow and holds an nbsp when empty; the message colocates under the field (Emil: colocate errors). `aria-invalid` + `aria-describedby` wire it for SR users. Do not put the error above the form or in a toast.
- **Double-submit:** `disabled={fetcher.state !== "idle"}` — the plan's action will happily fire two OTP emails otherwise, burning the 2–4/hr budget on one impatient double-click.
- **Autofocus:** `autoFocus` on the email input desktop-only (`!('ontouchstart' in window)` or just skip autofocus entirely — a one-field form loses little).
- **Reduced-motion entrance:** reuse the house pattern verbatim from scripture.tsx:1327 — `motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200 motion-safe:ease-out` on the page's inner container. It's already reduced-motion-safe via `motion-safe:` and matches every other entrance in the app. No spring, no scale.
- **Page frame:** bare editorial, not a floating card — match home.tsx: `main.mx-auto max-w-md px-6 py-16` (or `min-h-dvh flex flex-col justify-center` for vertical centering), "Lumen" eyebrow linking `/`, `font-display text-3xl` "Sign in" heading, one `font-reading italic text-muted-foreground` line: "We'll email you a link — no password needed." A bg-panel card would be the only card-in-a-void page in the app.

---

### [SEVERITY: med] Success state: replace the form in place, always show the entered email, and make the live region actually announce

**Replace vs alongside:** replace the form region *in place* within the same page frame (same eyebrow + heading stay mounted). Rendering success alongside a still-armed form invites "let me just submit again" resend spam, and two competing blocks is more UI than a one-field flow deserves. But replace *only the form region*, not the whole page component — for two a11y reasons: (1) keep heading/landmark stability, (2) the live region must pre-exist.

**aria-live gotcha (this WILL be missed in implementation):** a live region that mounts *with* its content usually does not announce. Render the container unconditionally:
```tsx
<div aria-live="polite" role="status">
  {sent && <SuccessBlock email={email} />}
</div>
```

**Show the email: yes, prominently.** Two reasons: typo confirmation is the #1 "the email never came" cause, and with PKCE the user must return to *this browser* — anchoring "sent to **abram@soar.com** — open it here" reinforces the device constraint. Copy:

> **Check your email**
> We sent a sign-in link to **{email}**. Open it in this browser — the link only works on the device that asked for it.
> Wrong address? [Use a different email]

"Use a different email" returns to the form with the field prefilled (fetcher state reset, no navigation).

**Resend + rate limits:** Supabase's built-in mailer enforces a 60s per-address cooldown and a small hourly cap (~2–4). Recommendations:
1. Client-side 60s countdown before resend enables: `Resend link (42s)` as a disabled button — sets expectation and absorbs the per-address cooldown so users rarely see a 429. Freeze the countdown on `visibilitychange` per the Emil time-limited-actions rule is *not* wanted here (it's a real-world cooldown, keep it wall-clock).
2. If the action does get a 429/`over_email_send_rate_limit`, **do not mask it as success**. The plan's "generic success regardless of account existence" is an anti-enumeration measure; a rate-limit error reveals nothing about account existence and masking it strands the user waiting for an email that will never come. Copy: "Email limit reached — Lumen can only send a few sign-in emails per hour. Wait a bit and try again, or check your spam folder for the earlier link."
3. Passive expectation line under the resend button: `font-ui text-[13px] text-muted-foreground`: "Links can take a minute. Check spam before resending — sign-in email is limited to a few per hour."

---

### [SEVERITY: high] /auth/confirm error copy: the plan's line is B-minus — it names the wrong villain and omits the most common failure

Plan copy: *"This link expired or was opened on a different device."*

What's right: it acknowledges the PKCE cross-device failure instead of a generic "invalid token." What's wrong:
1. **"Different device" undersells it — it's a different *browser*.** The most common same-device failure is the Gmail/Outlook app opening the link in its **in-app browser**: same phone, same user, dead link, and the plan's copy tells that user something false ("but I *am* on the same device!").
2. Two causes are fused into one sentence with no way for the user to tell which applies and no recovery verb in the sentence itself.
3. It leads with blame, not recovery.

**Proposed copy** (heading `font-display text-3xl`, body `font-reading text-muted-foreground max-w-prose`):

> **That link didn't work**
> Sign-in links expire after an hour, and they only open in the browser that requested them. If you asked for the link on another device, open the email there instead. If your email app opened this in its own built-in browser, copy the link into your regular browser — or just request a fresh one below.
> **[Request a new link →]** (link to `/login`, styled as the primary `font-ui text-sm font-semibold text-primary`)

**Chrome question:** the premise "this page has no chrome" is already false — ThemeSelect renders from root's `App` on every route, including this one, so a theme-consistent floating control is present. Add exactly one more piece: the house eyebrow `<p className="font-ui text-[11px] font-semibold uppercase tracking-[0.22em] text-faint"><Link to="/">Lumen</Link></p>` (the identical pattern word.tsx and scripture.tsx use). A user who lands here from an email on the *wrong* browser has never seen the app in that browser — the wordmark tells them they arrived at the right place, and it links to safety. No full header, no auth chip (they are by definition signed out here).

---

### [SEVERITY: med] Signed-in chip vs alternatives — chip + DropdownMenu is right; here is the a11y spec the plan omits

Rating the four options:
- **Text email in header** — worst: PII permanently on screen (screen-share/projector risk for a scripture app used in classes), long addresses truncate badly at `right-4`, loud in exactly the way this app refuses to be.
- **Avatar only, no menu** — dead end; no path to sign out; violates "every interactive element does something."
- **No header presence + /account page** — cleanest reading surface, but the account page is explicitly out of scope, so this option doesn't exist in v1; it would leave sign-out unreachable.
- **Initial chip + DropdownMenu** — correct: quiet at rest, PII only on demand, sign-out reachable everywhere. **Winner, with the a11y spec below.**

Radix DropdownMenu gives arrow-key roving focus, Escape-to-close, typeahead, and focus-return-to-trigger for free. What must be specified on top:
1. Trigger: `<button>` (Radix default), `aria-label={"Account: " + email}` — the visible content is one letter; SR users need the full identity. Radix supplies `aria-haspopup`/`aria-expanded`.
2. **Email row = `DropdownMenuLabel`, not `DropdownMenuItem`.** Both exist in ui/dropdown-menu.tsx. A menuitem that does nothing is a keyboard trap-adjacent annoyance (arrow to it, press Enter, nothing). Label is skipped by roving focus and read as context. Style: `font-ui text-xs text-muted-foreground truncate max-w-[240px]`, `title={email}` for hover-capable pointers.
3. Sign out: `DropdownMenuItem` wrapping a `fetcher.Form method="post" action="/logout"` submit (or `onSelect={() => fetcher.submit(...)}`) — must be POST per the plan's CSRF posture; never a GET link.
4. **Focus after sign-out:** the trigger unmounts (user is signed out), so Radix's focus-return target disappears → focus drops to `<body>`, an SR user is lost. On successful logout, move focus deliberately: `document.getElementById("main")?.focus()` on a `tabIndex={-1}` main, or since the plan redirects to `/`, the fresh document load resets focus anyway — acceptable, but see next finding on that redirect.
5. Menu content: `align="end"` `sideOffset={8}`, `font-ui text-xs` — mirror the ThemeSelect's SelectContent so the two corner menus feel like siblings.
6. Menu items are 32px in the stock component — acceptable inside a menu (Radix pattern), but give the Sign out item `py-2.5` to reach ~40px+ on touch.

---

### [SEVERITY: med] Sign-out from a chapter yanks the reader to `/` — don't

Plan: logout action → `redirect("/")` with cookie-clearing headers. If a reader signs out from Alma 32 (the chip is available there — that's its point), they lose their place. Nothing about the chapter view is auth-dependent in v1, so there is no security reason to relocate them.

**Recommendation:** submit sign-out via `useFetcher` with **no redirect** (action returns cookie-clearing headers + `{ ok: true }`); RR7 revalidates the root loader, `user` becomes null, the chip becomes nothing (signed-out shows no fixed affordance per finding 1), and the reader hasn't moved. Keep the `redirect("/")` only for the non-JS `<form>` fallback and for the GET loader. This is *less* code surface than it sounds and it is the difference between "I signed out" and "the app threw me out."

---

### [SEVERITY: low] Post-sign-in landing is `/` with zero acknowledgment — one quiet line of copy prevents "did that work?"

Because nothing is gated in v1, a user who completes the magic-link dance lands on the library looking *identical* to before, except a 28px letter disc appeared in the corner. There is no toast system in this app (correctly), and building one for this would be overkill. Two cheap mitigations:
1. Set expectation *before* the round-trip, on the login page's success state (already speced above: "the link signs you in on this device").
2. On the login page itself, one honest sentence about why sign in exists: `font-reading italic text-muted-foreground` — "Signing in gives Lumen a place to keep your study — notes and history arrive in coming releases." If Abram doesn't want to promise roadmap, cut it — but then accept that v1 sign-in is purely for early adopters and keep the affordance as quiet as this review recommends.

---

### [SEVERITY: low] Out-of-scope cuts audit — what will actually feel broken

- **No account page:** absorbed cleanly *iff* the email row is a `DropdownMenuLabel` (finding above). If it's rendered as a clickable item, it feels broken immediately.
- **No `?next=` deep-linking:** correct cut for v1 (open-redirect surface, nothing gated so nothing to return to)… *except* it interacts with finding 1: a user who taps "Sign in" from home loses nothing, which is one more argument for home-only sign-in. If sign-in were on every reading page, losing your chapter through the email round-trip would sting and `?next=` pressure would return. The placement recommendation makes this cut safe.
- **No custom SMTP:** the 2–4/hr mailer cap is a *hard UX wall* for any second household member or classroom demo on the same hour. Not fixable in-scope; the resend cooldown + honest 429 copy (finding above) is the required mitigation. Surface the cap in the deploy notes as plan already does.
- **No profiles/RLS/gated content:** fine structurally; the cost is motivational (previous finding), not functional.
- **One real gap the list doesn't name: no "you're already signed in" affordance on `/login`.** Plan redirects signed-in users to `/` from the login loader — good, that covers it. Verified as fine.

---

### [SEVERITY: low] Confirm-page success has no UI at all — that's correct, don't add one

`/auth/confirm` success is a 302 to `/`. Resist any temptation to add a "signing you in…" interstitial: it's a server-side loader, the user never sees a frame, and an artificial welcome screen would be the slowest possible way to say "done." Noting it so nobody "improves" it during implementation.

---

## Verdict

**On the chip placement question:** the plan's signed-in **initial chip in the fixed top-right cluster, on all pages, is right** — place it *left* of ThemeSelect inside a single `fixed right-4 top-4 z-40 flex items-center gap-2` container so ThemeSelect never moves; visual `size-7` disc matching ThemeSelect's height, 44px hit area via `after:-inset-2`, neutral `bg-panel2 border-rule2 text-ink` styling that resolves correctly in all four themes, DropdownMenu with the email as a Label (not an Item) and a POST sign-out that does not navigate the reader away. **But the plan's signed-out "Sign in" ghost link in that same fixed cluster is wrong for this app and this version**: it is the only solicitation in an otherwise contemplative reading surface, it deep-links to a flow that delivers no v1 benefit, and it widens the one real layout collision (the chapter rail at 1024–1400px). Signed-out affordance goes on the home page header, static and quiet. Chip everywhere; invitation nowhere the reader is reading.

