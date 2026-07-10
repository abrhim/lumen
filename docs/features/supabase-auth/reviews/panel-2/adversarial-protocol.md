# Panel-2 Adversarial — Protocol & Platform Skeptic

Reviewer: ADVERSARIAL-A. Targets: plan.md + panel-1 security-auth.md + panel-1 platform.md.
Evidence basis: extracted **@supabase/ssr 0.12.0** and **@supabase/auth-js 2.110.2** package sources (npm, July 2026 latest; the repo has neither installed yet — line numbers below are `dist/module/*` of those versions); **live read-only probes against the real project's public auth endpoints** (bogus tokens only; no emails sent, nothing consumed); credential audit of `wrangler.json` / `.env` files (key NAMES only); web sources cited inline.

---

## F1. [REFUTED] "Session death after 1h" is NOT baked in — `getClaims()` refreshes an expired token inline, `autoRefreshToken: false` notwithstanding; full chain verified to the cookie commit

The suspicion: root loader `getClaims()` + `autoRefreshToken: false` might silently sign readers out when the access token expires mid-session. **False.** Traced in auth-js 2.110.2 `GoTrueClient.js`:

1. `getClaims()` with no jwt arg → `this.getSession()` (line 5223).
2. `getSession` → `_useSession` → `__loadSession()` (line 2459).
3. `__loadSession` computes `hasExpired = expires_at*1000 - Date.now() < EXPIRY_MARGIN_MS` (line 2486–2488; `EXPIRY_MARGIN_MS = 3 × 30_000 = 90s`, `lib/constants.js` line 10) and if expired calls `await this._callRefreshToken(currentSession.refresh_token)` (line 2514). **There is no `autoRefreshToken` gate on this path** — that flag only controls the background ticker, which `createServerClient` disables.
4. `_callRefreshToken` → network `POST /token?grant_type=refresh_token` → `_saveSession` → `await this._notifyAllSubscribers('TOKEN_REFRESHED', data.session)` (line 4180). `_notifyAllSubscribers` **awaits every callback** via `Promise.all` (lines 4254–4262).
5. The awaited callback is `createServerClient`'s `onAuthStateChange` handler, which runs `applyServerStorage` → our `setAll` on `TOKEN_REFRESHED` (`createServerClient.js`). So by the time `getClaims()` resolves, the rotated cookies are already in the `commitHeaders()` accumulator. No race, no dead hour.

Panel-1 platform said this in one clause ("getClaims() internally goes through getSession(), which refreshes an expired access token inline") — correct, now proven at source level. **But both panels missed the two sharp corollaries — see F2.**

## F2. [ESCALATE] The inline refresh makes the plan's never-throw/timeout wrapper DANGEROUS as specified — a timed-out refresh drops rotated tokens and can genuinely kill the session

Corollary 1 — once per ~hour, one navigation's root loader **blocks on a network round-trip to the project region** (the refresh). That is a scheduled COR-2 exception nobody has named. Fine — but it means panel-1 security's "wrap in the never-throw degrade with a tight timeout (~1.5s)" (their Q2 recommendation) is a footgun if ever applied to the normal `getClaims` path: gotrue **rotates the refresh token on every refresh**. If the wrapper abandons `getClaims()` mid-refresh and returns `null`:
- server-side the old refresh token is already consumed;
- the response carries no Set-Cookie (nothing accumulated yet, or worse, `commitHeaders()` isn't attached to the degraded response);
- the browser retains the consumed refresh token;
- the next request refreshes inside the 10s reuse-grace if lucky — outside it, reuse detection revokes the whole token family. **That is the real session-death bug, and it would be introduced by the mitigation, not the protocol.**

Required amendments:
- The never-throw wrapper catches **thrown errors** only; it must NOT impose a wall-clock timeout on `getClaims()`/the inline refresh.
- `commitHeaders()` must be attached to the root response **even when the wrapper degrades to `null`** — partial cookie writes must still flush.
- Note the once-per-hour blocking refresh in the plan as an accepted COR-2 exception.
- Bonus caveat from source: `__loadSession`'s proactive-preserve (lines 2514–2533) hands back the still-valid session when a *proactive* refresh fails, so transient Supabase outages do NOT log users out mid-hour — don't "fix" that.
- Do not read `session.user` on the server — auth-js wraps it in `insecureUserWarningProxy` (line 2506) and console-warns per property access. Derive the header chip from `getClaims()` claims (`email` claim), which the plan implies but never states.

## F3. [CONFIRMED-HARDER] Login action must commit Set-Cookie — the verifier flush is a special-case in @supabase/ssr's `setItem`, and there are four subtleties Panel-1 didn't surface

Panel-1 security's critical finding is correct; here is the exact mechanism. `signInWithOtp` under PKCE calls `getCodeChallengeAndMethod(storage, storageKey)` (`GoTrueClient.js` line 1812), which writes `${storageKey}-code-verifier` (`lib/helpers.js` line 247). In `ssr/cookies.js`, the server storage's `setItem` special-cases exactly this: *"We don't have an `onAuthStateChange` event that can let us know that the PKCE code verifier is being set. Therefore, if we see it being set, we need to apply the storage"* → immediate `applyServerStorage` → `setAll`. So the Set-Cookie IS generated during the action — it just dies in the accumulator unless the action returns `data({sent:true}, { headers: commitHeaders() })`. Confirmed critical.

Subtleties missed:
1. **maxAge is force-overwritten to 400 days on ALL cookies** — `setCookieOptions = { ...DEFAULT_COOKIE_OPTIONS, ...cookieOptions, maxAge: DEFAULT_COOKIE_OPTIONS.maxAge }` (`cookies.js`, both `setItem` and `applyServerStorage`). You cannot shorten the verifier cookie's lifetime via `cookieOptions.maxAge`; an unconsumed verifier persists ~400 days (removed only on exchange, signOut, or the next signInWithOtp overwrite). Cosmetic, but H1's "assert flags exact-string" must expect `Max-Age=34560000`, not a custom value.
2. **`setAll` has a second parameter**: `applyServerStorage` calls `setAll(cookies, { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0", Expires: "0", Pragma: "no-cache" })`. Our adapter may ignore it, but its existence is upstream telling us: responses that set auth cookies should be non-cacheable. Cheap to honor.
3. **`signInWithOtp`'s error path removes the verifier via `removeItemAsync`** (line 1848) — but server-storage `removeItem` intentionally defers (no event follows) → the removal never flushes to a clearing Set-Cookie. Harmless (next attempt overwrites), but it means H2's failure case must NOT assert a clearing cookie.
4. **Verifier never chunks** (43-char value); only the session token chunks at ~3180B. ssr 0.12.0 also added `decodeChunkedCookieValue`, which treats mismatched/partial chunks as **absent** with a console.warn ("response committed before all Set-Cookie headers were sent") — i.e. a multi-Set-Cookie drop now manifests as silent signout, not an error. This upgrades platform panel's multi-cookie harness assertions from "worth adding" to load-bearing.

## F4. [NEW] RESEND overwrites the pending verifier — after any resend, only the NEWEST email can ever work; error copy must say so

The verifier lives in ONE cookie (`sb-<ref>-auth-token-code-verifier`); a second `signInWithOtp` overwrites it (`setItem` clears existing chunks and sets the new value — `cookies.js`). Consequence under the default template: the first email's `?code=` reaches `exchangeCodeForSession`, which sends verifier₂ against flow-state challenge₁ → server rejects. Under the token_hash template the old token is invalidated server-side as well (magic links are one-time and superseded; [passwordless docs](https://supabase.com/docs/guides/auth/auth-email-passwordless), [gotrue-js#503](https://github.com/supabase/gotrue-js/issues/503)). Either way: **"resend" quietly bricks every earlier email.** The login success state and the confirm error page should both say "use the most recent email we sent you." Neither panel nor the plan mentions this; it is the most common real-world confusion after cross-device.

## F5. [REFUTED] "The token_hash template edit is automatable via Management API" — not with any credential this repo or machine actually has; and the SAME missing credential blocks the URL-configuration prerequisite, which my live probe shows is unmet TODAY

Panel-1 security (Q3) is technically right that `PATCH https://api.supabase.com/v1/projects/{ref}/config/auth` with `mailer_templates_magic_link_content` exists ([email templates doc](https://supabase.com/docs/guides/auth/auth-email-templates), [Management API](https://supabase.com/docs/reference/api/introduction)) — but it requires a **personal access token (`sbp_…`)**. Credential audit (key names only):
- `apps/web/wrangler.json` vars: `NEO4J_URI`, `NEO4J_USER`, `NEO4J_DATABASE`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`
- `apps/web/.dev.vars`: `NEO4J_PASSWORD`; `apps/web/.env`: `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`; repo-root `.env`: `DATABASE_URL`
- No `SUPABASE_ACCESS_TOKEN`/`sbp_`/`sb_secret_` anywhere; `supabase` CLI not installed; no keychain token; the claude.ai Supabase MCP connector exposes **no auth-config tool** (migrations/SQL/functions only — panel-1's parenthetical was right).

So the realistic path is: **Abram either edits the template in the dashboard (2 minutes) or mints a PAT** — either way it is a human-gated deployment prerequisite, not automation this pipeline can perform. Escalation: my probe (F7) proves the project's Site URL is **still `http://localhost:3000` right now**, so the URL-configuration prerequisite is equally unmet — and `site_url`/`uri_allow_list` live behind the **same** dashboard page / same PATCH endpoint. Bundle all three (Site URL, redirect allowlist, template) into ONE user-facing checklist; a single PAT would automate all of them if Abram prefers.

## F6. [CONFIRMED-HARDER + ESCALATE] The POST interstitial is correct but USELESS without the template edit — with the default template the scanner burns the token at Supabase's `/verify`, before our interstitial exists; and it must NOT auto-submit

Panel-1 security recommended the interstitial as a standalone scanner fix. It is not standalone. With the default template, the email link points at `{SUPABASE_URL}/auth/v1/verify?...` — verification happens on Supabase's server **during the scanner's GET**, and my probe confirms `/verify` acts immediately on GET (bogus token → instant 303, F7). The scanner's sandbox receives the one-time `?code=`; the human's later click gets `otp_expired`. Our `/auth/confirm` interstitial never had a chance. **The interstitial only protects the token_hash path, where the link targets our site directly.** Panel-1's two recommendations (template edit; interstitial) are actually one dependent unit — ship together or the scanner protection is dead code. ([supabase/auth#1214](https://github.com/supabase/auth/issues/1214), [discussion #41618](https://github.com/orgs/supabase/discussions/41618))

Interstitial mechanics, answering the brief's questions:
- **Does POST break the PKCE `?code=` cookie dance? No.** The verifier cookie is `SameSite=Lax`; the interstitial's form POST is same-site (our page → our action), so cookies ride. `exchangeCodeForSession` reads the verifier from the request cookie in the action identically to a loader.
- **Does auto-submit defeat the purpose? Yes.** Mail-security sandboxes execute JavaScript in headless browsers; an onload-submitted form is indistinguishable from a click ([Suped analysis](https://www.suped.com/learn/email-deliverability/why-are-email-security-filters-auto-clicking-links-in-opt-in-emails-with-javascript-and-how-can-), [MS Defender behavior](https://techcommunity.microsoft.com/t5/microsoft-defender-for-office/possible-major-problem-with-ms-defender-scanning-clicking-links/td-p/3874918)).
- **Minimal correct interstitial:** GET loader does zero verification, renders params into hidden form fields + a human-clicked "Continue" button (no JS submission, no side effects — idempotent under prefetch); POST action runs `verifyOtp`/`exchangeCodeForSession` and redirects with committed cookies. GETs with `?error`/`?error_code` params (F7) render the error state directly — no button.

## F7. [NEW] Live probe: verify-failure errors arrive in the QUERY STRING (not just the fragment) — the confirm route has a third, server-visible arrival shape the plan doesn't handle; probe also proves Site URL is still localhost:3000

Read-only probe against the real project (bogus token, nothing consumed, no email sent):

```
GET {SUPABASE_URL}/auth/v1/verify?token=pkce_bogus…&type=magiclink&redirect_to=https://lumen.abramhimmer.workers.dev/auth/confirm
HTTP/2 303
location: http://localhost:3000?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired#error=access_denied&error_code=otp_expired&…&sb=
```

Three facts, each load-bearing:
1. **Errors are duplicated into the query string** — contra the widespread "errors are fragment-only, invisible to the server" belief. The plan's confirm loader (which only knows `?code=` and `?token_hash=`) will render its generic error for these arrivals by accident of fall-through; it should branch on `error_code` explicitly: `otp_expired` → "link expired or already used — request a new one (only the newest email works)"; other `access_denied` → generic. Per panel-1, do NOT distinguish expired/used/invalid beyond that — but note the **cross-device case is safely distinguishable anyway**: `exchangeCodeForSession` throws `AuthPKCECodeVerifierMissingError` locally, before any network call, when the verifier cookie is absent (`GoTrueClient.js` lines 1574–1578). That error names missing local state, not token state — zero leak, and it's exactly the "opened on a different device" copy trigger.
2. **The bogus `redirect_to` was ignored and the redirect went to `http://localhost:3000`** — live proof both that the silent Site-URL fallback works as the plan feared AND that the project's URL configuration is untouched as of this review (F5 escalation).
3. Expiry facts for the copy: hosted dashboard default Email OTP expiry is 3600s/1h (gotrue's internal fallback is 86400s; 86400 is also the allowed max), 60s per-address resend cooldown, strictly one-time use ([passwordless docs](https://supabase.com/docs/guides/auth/auth-email-passwordless), [expiry discussion #26330](https://github.com/orgs/supabase/discussions/26330)).

## F8. [CONFIRMED-HARDER] signOut: the deliberate-scope finding stands (default IS `global`, line 3347) — but Panel-1's "clear cookies even on failure" understates it: the DEAD-SESSION path returns early WITHOUT clearing, and it's the likeliest failure

Source trace (`GoTrueClient.js` 3347–3388):
- `signOut(options = { scope: 'global' })` — default confirmed; `{ scope: 'local' }` is the right header-menu semantic.
- `_signOut` → `_useSession` → `__loadSession`: **an expired access token triggers an inline refresh attempt before revocation** (F1 chain). If the session is genuinely dead (refresh rejected + token past real expiry), `sessionError` returns at lines 3365–3367 — **`removeCurrentSession()` never runs, no `SIGNED_OUT` fires, no clearing cookies are emitted.** The user whose session is most broken is precisely the one whose "Sign out" silently no-ops.
- The path panel-1 worried about (revocation endpoint errors non-401/403/404) actually DOES clear: lines 3377–3379 run `removeCurrentSession()` before returning the error, `_removeSession` fires `SIGNED_OUT` (line 4332), the ssr callback flushes clearing cookies.

Amendment: the logout action must clear cookies **unconditionally** — on ANY `signOut` error, emit `Max-Age=0` for all `sb-*` cookies itself (ssr 0.12.0 ships `clearAuthCookiesAtScopes({ getAll, setAll, storageKey, scopes })` for exactly this, or hand-roll over `getAll()`'s `sb-` names). H4's throw-case must assert clearing cookies specifically on the early-return sessionError shape (mock `getSession` erroring), not just a thrown `signOut`.

## F9. [CONFIRMED] `scope:'local'` + httpOnly + fetcher-without-redirect compose — with two deliberate choices to record

- Set-Cookie on a fetcher POST: `singleFetchAction` computes headers via the same `getDocumentHeaders` (platform panel verified in RR source) → the clearing cookies ride the `.data` action response; the browser applies them on arrival.
- Revalidation: after a fetcher action resolves, RR revalidates all matched loaders by default — the root loader reruns with the cleared Cookie header → `user: null` → chip flips. No redirect required. If the optional `shouldRevalidate` tuning lands, it must keep `formAction != null` returning true or logout stops updating the UI — platform panel already flagged this; I confirm it is the single coupling point.
- BUT the plan as written returns `redirect("/")` from the action — a fetcher **follows action redirects as a page navigation** in RR7, which contradicts the UX panel's no-redirect intent. Pick one: `data({ ok: true }, { headers })` + revalidation (no navigation), or keep the redirect and drop the no-redirect claim. Both are correct; shipping the pair unreconciled means the UX behavior is whatever the code accidentally does.
- httpOnly changes nothing here: all reads/writes are server-side; the fetcher never touches cookies from JS.

## F10. [CONFIRMED with full trace] Multi-device recovery loop works — and the error page's "request a new one" genuinely repairs it on the phone

Desktop requests link (verifier cookie → desktop). Phone opens email: default template → Supabase `/verify` consumes the token, 303 `?code=` to the phone → `exchangeCodeForSession` throws `AuthPKCECodeVerifierMissingError` **locally** (no verifier cookie on the phone; lines 1574–1578). Error page → user taps "request a new link" → login action on the PHONE runs `signInWithOtp` → new verifier is set on the phone (F3 mechanism) → new email opened on the phone → works. Two footnotes: (a) the original email is now burned on BOTH devices — the phone's `/verify` hop consumed the token, so "try again on your computer" would also fail; copy must push resend, not retry; (b) with the token_hash template (F5/F6) this entire failure class disappears — which is the strongest single argument for making the template edit a ship-gate, not a nicety.

---

## Verdict on Panel-1

Both specialists are high-signal; no finding is refuted on protocol substance. The two refutations here are operational: (1) the "session-death-after-1h" fear their getClaims verdicts implicitly answered is now CLOSED at source level — but their own ~1.5s-timeout mitigation would CREATE the session-death bug it guards against (F2, must be amended before synthesis); (2) "automatable via Management API" is false for this repo's actual credentials — it is a human-gated prerequisite, now escalated because the live probe proves Site URL is still localhost:3000 (F5/F7). Highest-leverage escalation: the scanner interstitial and the token_hash template edit are ONE dependent unit (F6); shipped separately, the interstitial protects nothing. New material for synthesis: query-string error params as a third confirm-route arrival shape (F7), resend-bricks-older-emails copy (F4), dead-session signOut early-return (F8), and the forced 400-day maxAge / `setAll` second-arg adapter details (F3).
