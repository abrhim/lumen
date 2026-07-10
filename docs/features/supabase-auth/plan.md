# supabase-auth — plan

**Feature**: Passwordless sign-in via Supabase Auth magic email links for the Lumen web app.
**Tier**: large (auth always escalates per tiers.md).
**Gates**: steps 1b + 7 waived by Abram verbatim: "you don't need to use human in the loop. just go all the way until it is done." Pipeline runs in full otherwise.

## Proposed pipeline (tier: large) — self-approved per waiver
  [x] Plan   [x] Harness   [x] Panel-1 (3 combined-role specialists)   [x] Panel-2 adversarial (2)
  [x] Synthesize (self-approved gate)   [x] Implement   [x] Code-panel (3)   [x] Code-adversarial (2)
  [x] Bug filter + fix   [x] Retro

## Probes (pre-plan, per strongs/art-graph learnings)

- `GET {SUPABASE_URL}/auth/v1/settings` → `external.email: true`, `mailer_autoconfirm: false`, `disable_signup: false`. Magic link (signInWithOtp) works server-side today.
- `apps/web/wrangler.json` vars already carry `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` (new-style `sb_publishable_` key ⇒ new API-key system).
- `GET /auth/v1/.well-known/jwks.json` → one `EC/ES256/P-256` key. **Asymmetric signing confirmed** ⇒ `getClaims()` verifies locally (JWKS cached by supabase-js); root-loader session read is zero-network on the happy path. COR-2 satisfied.
- No global header exists; `root.tsx` renders a fixed top-right `ThemeSelect`. The auth affordance joins that cluster.
- House pattern to mirror: `db.server.ts` per-request factory + DI (`makeCreateDb`), never-throw degrade wrappers WITH happy-path assertions (tske B2), loader critical path stays cheap (COR-2).

## Design

### Dependencies
`@supabase/ssr` + `@supabase/supabase-js` in apps/web (worker-compatible; no Node APIs beyond what nodejs_compat provides).

### Server helper — `app/lib/auth.server.ts`
`makeAuthClient(createServerClientImpl)` → `getAuth(request, env)` returning `{ supabase, commitHeaders(): Headers }`:
- `createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll, setAll } })` over the Request's `Cookie` header; `setAll` accumulates `Set-Cookie` values for `commitHeaders()`.
- Cookie options: `path=/`, `sameSite=lax`, `secure` (prod), **httpOnly=true** — no client-side supabase-js exists in this app, so cookies never need JS access. (Panel-1 to confirm @supabase/ssr honors this.)
- Per-request, no module state (Workers I/O isolation — same reason as db.server.ts).
- `getUser(request, env)` convenience for root: **never-throw** degrade to `null` with named event `auth_user_degraded` (+elapsedMs); happy path asserted in tests.

### Routes (react-router routes.ts additions)
1. `route("login", "routes/login.tsx")`
   - loader: signed-in users redirect `/`.
   - action: validate email (single field, trim, shape check), `signInWithOtp({ email, options: { emailRedirectTo: origin + "/auth/confirm" } })`. Returns `{ sent: true }` on success. **Generic success regardless of account existence** (no enumeration). Errors surface as themed inline message.
   - UI: paper-theme card — `font-display` heading, one email input (`text-base` ≥16px, iOS no-zoom), submit button, success state ("Check your email — the link signs you in on this device"), resend link, reduced-motion-safe entrance.
2. `route("auth/confirm", "routes/auth.confirm.tsx")`
   - loader handles BOTH arrival shapes (robust to email-template changes):
     - `?code=` → `exchangeCodeForSession(code)` (PKCE, default template's ConfirmationURL redirect).
     - `?token_hash=&type=` → `verifyOtp({ token_hash, type })`.
   - Success → redirect `/` with committed Set-Cookie headers. Failure → themed error page: "This link expired or was opened on a different device" + link to `/login`. PKCE cross-device failure is expected — copy explains it.
3. `route("logout", "routes/logout.tsx")`
   - action (POST only): `signOut()` → redirect `/` with cookie-clearing headers. GET loader redirects `/`. CSRF posture: POST + SameSite=Lax cookies.

### Root integration
- `root.tsx` loader: `const user = await getUser(request, env)` → `data({ user }, { headers: commitHeaders() })` so token refreshes persist. Cheap-path requirement: prefer local JWT verification (`getClaims()` w/ asymmetric keys) over network `getUser()`; degrade documented. Panel-1 verdict required.
- Layout top-right cluster (next to ThemeSelect): signed-out → "Sign in" ghost link; signed-in → initial-letter chip (44px target) opening a radix DropdownMenu: email (truncated), "Sign out" (fetcher POST /logout).

### Explicitly out of scope
Profiles table, RLS, gated content, custom SMTP, account page, next-URL deep-linking (`?next=` deliberately NOT supported v1 — open-redirect surface for zero current need).

## Deployment prerequisite (USER-SIDE — surface loudly at the end)
Supabase Dashboard → Auth → URL Configuration:
- Site URL: `https://lumen.abramhimmer.workers.dev`
- Redirect URLs: `https://lumen.abramhimmer.workers.dev/auth/confirm`, `http://localhost:5173/auth/confirm`
Without this, magic links point at the default localhost:3000. `emailRedirectTo` silently falls back to Site URL when not allowlisted.
Built-in mailer is rate-limited (~2–4 emails/hr) — fine for testing; custom SMTP is a later feature.

## Harness (behavior scope → required)
`apps/web/app/lib/__tests__/auth.server.test.ts` + `apps/web/app/routes/__tests__/auth.routes.test.ts`, DI-mocked supabase (no network):
- H1 cookie adapter: request Cookie header → getAll shapes; setAll → commitHeaders emits Set-Cookie with httpOnly/secure/samesite flags.
- H2 login action: valid email → signInWithOtp called with allowlisted emailRedirectTo derived from request origin; invalid email → field error, otp NOT called; supabase error → generic themed error (no enumeration leak).
- H3 confirm loader: `?code=` → exchange path → 302 `/` + Set-Cookie; `?token_hash=` → verifyOtp path; neither/failure → error UI (200, no redirect loop).
- H4 logout action: signOut called, 302 `/`, cookies cleared; GET → redirect without signOut.
- H5 root getUser degrade: throwing client → null + `auth_user_degraded` event (AND happy path returns the user — tske B2).

## Learnings surfaced (state/learnings.md + last 3 retros)
- strongs: probe before you plan → settings endpoint probed; JWKS probe scheduled at implement.
- tske: never-throw wrappers invert tests → H5 asserts BOTH directions.
- canon-spine: critical-path panel roles run synchronously; art-graph: 3 combined-role briefs with pre-seeded traps ≈ 6-role quality at half cost → panels sized 3/2/3/2.
- COR-2: root loader must not add a blocking network call per page → getClaims-vs-getUser is a NAMED open question for Panel-1.

## Open questions → Panel-1
- Q1: httpOnly cookies with @supabase/ssr — supported/safe given zero client-side supabase usage?
- Q2: root-loader session read: `getClaims()` local verification vs `getUser()` network call — what does the new key system actually allow on Workers?
- Q3: PKCE `?code=` flow vs `token_hash` template edit — correct default given we cannot edit the email template programmatically?
- Q4: RR7 single-fetch: does `data(payload, { headers })` from the ROOT loader reliably set cookies on document + data requests?

## Decisions (synthesis — panels 1+2; human gate waived by Abram; his one directive is D1)

Tie-break precedence honored: human > panel-2 > panel-1. Labels per skill: incorporated / rejected-with-rationale / dropped-as-noise / deferred-out-of-scope.

- **D1 [HUMAN, pinned]** 100% SSR auth (Abram verbatim: "we should be using ssr auth 100%"): @supabase/ssr server-only, httpOnly+secure+lax cookies, NO createBrowserClient anywhere, all auth ops in loaders/actions. Code-stage panels must treat any client-side auth as a Critical.
- **D2 [incorporated: sec#4, adv-proto F5/F7]** token_hash is the PRIMARY flow; email-template edit is a HUMAN-GATED deploy prerequisite (no sbp_ PAT exists — Management API refuted). `?code=` PKCE remains the working fallback until the template is edited (same-device only). Confirm loader branches on a THIRD arrival shape: `error_code`/`error_description` in the query (live probe: failures 303 with `error_code=otp_expired`; also proved Site URL is unmet today — links currently redirect to localhost:3000).
- **D3 [incorporated: sec#6 + adv-product#6, shape per adv-proto F6]** /auth/confirm GET = POST interstitial ("Continue to sign in", token params as hidden fields, NO auto-submit — scanners execute JS); verification happens in the action. GET branches FIRST on already-signed-in (most common error-page visitor is a signed-in user reusing the link — show "You're already signed in → Continue reading", never false failure). Interstitial+template-edit ship as one unit; pre-edit ?code= links are consumed at Supabase's /verify before our page — interstitial protects nothing until then (documented, accepted).
- **D4 [incorporated: sec#1 CRITICAL, adv-proto F3]** login action returns commitHeaders() on the {sent:true} response — the PKCE verifier cookie rides there. H1 expects the ssr-forced maxAge (400d) rather than fighting it.
- **D5 [REVERSAL of panel-1 sec#3's wrapper: adv-proto F2]** getClaims() refreshes expired tokens inline (traced auth-js 2.110.2 __loadSession→_callRefreshToken) — no 1h-logout bug exists. Therefore: NO timeout on the root session read; the never-throw degrade wrapper ALWAYS attaches commitHeaders() even when returning user:null. New harness H6: expired-token path → response carries rotated cookies (adv-product #1: dropped rotation commit = permanent silent sign-out; single auth-read site = root loader only).
- **D6 [incorporated, hardened: sec#8 + adv-proto F8]** signOut({scope:'local'}); clear auth cookies UNCONDITIONALLY (auth-js dead-session path returns early WITHOUT clearing — do our own clearing via ssr's cookie removal on top).
- **D7 [reconciled: ux#9 vs plan]** logout = POST with hidden returnTo (validated: leading "/", not "//", no ":") → redirect back to where the reader was. Works identically JS and no-JS; no reader gets yanked to home. GET /logout → redirect "/".
- **D8 [made explicit: sec#5]** shouldCreateUser stays true (sign-up IS sign-in for a public reading app; Abram's own first sign-in needs it; generic success already blocks enumeration).
- **D9 [incorporated: platform#4]** emailRedirectTo derived from request origin (workers.dev host-routing is trustworthy); APP_ORIGIN pin deferred until a custom domain exists.
- **D10 [incorporated: ux panel + adv-product cuts]** Sign-in invitation on the HOME header only (deep-link attack self-refuted: nothing is gated). Signed-in chip: fixed cluster, chip LEFT of ThemeSelect, visual size-7 with expanded hit area to 44px; fix ThemeSelect's 28px target in passing. Login page: bare editorial frame (no card), h-11 text-base email input (autoComplete=email, autoCapitalize=none), reserved min-h-6 error slot (zero CLS), pre-mounted aria-live region, success replaces form and shows the entered email + "open it in this browser" (pre-template-edit reality) + "use the newest email" (resend supersedes: adv-proto F4), 60s resend guard with honest "about two emails per hour" copy, privacy sentence "used only to send this link". Chip menu: DropdownMenuLabel for email (not Item), Sign out via POST form.
- **D11 [simplified from platform#6]** No shouldRevalidate tuning v1 — getClaims is local crypto (~sub-ms warm); root loader reruns per navigation harmlessly. Noted as perf lever.
- **D12 [incorporated: platform#8]** supabase#37592 ("Dynamic require of 'stream'", Vite SSR) — probe-first: build + local smoke immediately after adding deps; fetch-shim alias is the documented fallback.
- **D13 [deferred-out-of-scope / human-gated deploy prerequisites]** (a) Dashboard: Site URL https://lumen.abramhimmer.workers.dev + redirect allowlist /auth/confirm (prod+localhost:5173) — PROVEN unmet; (b) email template → token_hash form; (c) verification email budget: built-in mailer ≈2/hr project-wide — deploy checklist counts sends; (d) ask Abram once: control a domain for Resend SMTP later.
- **D14 [dropped-as-noise / cut: adv-product]** multi-tab sync (architecturally homeless with httpOnly), account page, email-change/delete (sole user is the operator), ?next= deep-linking, roadmap-promise copy, per-theme QA matrix, prefilled use-different-email flow.

## Drift baseline
- plan.md (pre-hash): 372c3cc4838038a9
- harness: apps/web/app/lib/__tests__/auth.server.test.ts + apps/web/app/routes/__tests__/auth.routes.test.ts (H1-H6) — hashed at implement-exit
