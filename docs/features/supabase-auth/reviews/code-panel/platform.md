# supabase-auth — code-panel review: PLATFORM-CORRECTNESS

Reviewed against plan.md Decisions D1–D14. Versions verified from the lockfile/node_modules:
react-router 7.9.6, @supabase/ssr 0.12.0, @supabase/supabase-js 2.110.2 (auth-js 2.110.2).
All source citations below are from the INSTALLED packages, not docs. Tests: 23/23 pass
(auth.server.test.ts + auth.routes.test.ts). `pnpm run build` clean. `tsc --noEmit` clean.

---

### [MAJOR] Resend cooldown never restarts after the first resend

**File**: apps/web/app/routes/login.tsx:61-67

```tsx
const sentAt = useRef<string | null>(null);
useEffect(() => {
    if (sent && sentAt.current !== actionData.email) {
        sentAt.current = actionData.email;
        setCooldown(RESEND_SECONDS);
    }
}, [sent, actionData]);
```

**Scenario**: First send → `sentAt.current` becomes the email, cooldown = 60, counts down
correctly. User clicks "Resend the link" (same email — the hidden field guarantees it,
login.tsx:98). The action returns a NEW `actionData` object, the effect re-runs, but
`sentAt.current === actionData.email` → cooldown is NOT reset. The button re-enables
immediately. The 60s guard (plan D10: "60s resend guard") works exactly once per email;
every subsequent resend can be hammered with zero cooldown — against a mailer with a
~2/hour budget (D13c).

**Fix**: drop the ref guard entirely. `actionData` identity only changes on a new
submission (revalidation never replaces actionData), so keying the reset on it is
already the correct dedupe:

```tsx
useEffect(() => {
    if (sent) setCooldown(RESEND_SECONDS);
}, [sent, actionData]);
```

(The interval effect itself is CORRECT — verified by simulation: the `[cooldown > 0]`
boolean dep stays `true` across ticks 60→1 so the interval persists and fires every
second; it flips to `false` at 0 which tears the interval down. Not a bug.)

---

### [ADVISORY] The rotation-commit invariant (D5) is NOT framework-enforced — it holds only by app convention

RR 7.9.6 drops the ROOT loader's headers whenever ANY loader/action on the navigation
throws a redirect. Full source trace in the Verdict below. Today no dropped-rotation
path exists because:

1. Every redirect-throwing site attaches its own `commitHeaders()`:
   login.tsx:12 (`redirect("/", { headers })`), auth.confirm.tsx:63,69.
2. logout.tsx is a resource route (no default export) → served via
   `handleResourceRequest`/`queryRoute` — the root loader never runs on /logout, so its
   bare `redirect(returnTo)`/`redirect("/")` (logout.tsx:21,27) has no rotation to drop.
3. The root loader itself never redirects.

**The trap**: the first future child loader that does a bare
`throw redirect("/login")` (e.g. a gated route) breaks the invariant: on a navigation
where the root loader's `getClaims()` refreshed the token, the rotated cookie is
dropped, the browser keeps the consumed refresh token, and the next refresh outside
gotrue's 10s reuse interval is `refresh_token_already_used` → permanent silent sign-out
(exactly the failure D5 names).

**Fix (cheap)**: add a sentence to the `RequestAuth.commitHeaders` doc block
(auth.server.ts:24-27) and to plan D5: "redirects thrown from loaders/actions bypass
`getDocumentHeaders` in RR 7.9.6 — any route-level redirect MUST carry its own
`commitHeaders()`; never throw a bare redirect from a route that has signed-in
visitors." Optionally export a `redirectWithAuth(to, headers)` helper so the convention
has a named carrier.

---

### [MINOR] Double refresh race: /login and /auth/confirm run getSessionUser twice per navigation

**Files**: apps/web/app/root.tsx:40 + apps/web/app/routes/login.tsx:11 +
apps/web/app/routes/auth.confirm.tsx:32

On a document GET to /login or /auth/confirm, the root loader and the child loader run
in parallel (static `callDataStrategy` awaits all matches — chunk-4WY6JWTD.mjs:3676) and
BOTH construct their own client and call `getClaims()`. With an expired access token
that is two concurrent `_callRefreshToken` calls on the SAME refresh token. Safe under
default config: both land inside gotrue's 10s refresh-token reuse interval, which
returns the same child session — both loaders emit equivalent rotated cookies, and on
the non-redirect path both header sets merge via `prependCookies` (last Set-Cookie for a
name wins in the browser; both are valid). But it doubles the refresh traffic on these
routes and silently depends on `SECURITY_REFRESH_TOKEN_REUSE_INTERVAL` staying at its
default — with reuse-interval 0, the losing loader's failed refresh triggers auth-js's
`_removeSession` → ssr emits REMOVAL cookies on the same response as the winner's
rotation, and header order makes the removal win → sign-out.

**Fix (v2, not blocking)**: cache the session read per request (e.g. a WeakMap keyed on
Request, or read the root's result via `context`) so one navigation performs at most one
refresh. Not urgent: refresh only happens when the token is expired AND the user visits
/login or /auth/confirm at that moment.

---

### [MINOR] hasAuthCookie matches the PKCE verifier cookie — permanent no-op getClaims for abandoned sign-ins

**File**: apps/web/app/lib/auth.server.ts:84-86

`/(?:^|;\s*)sb-[^=;]*auth-token[^=;]*=/` deliberately matches
`sb-<ref>-auth-token-code-verifier` (asserted at auth.server.test.ts:138). A visitor who
requests a magic link but never completes it carries that verifier cookie for the ssr
maxAge (400 days), so EVERY root-loader run does `getClaims()` → `getSession()` →
storage read → no session → null. No network (nothing to refresh) and sub-ms, so this is
a perf nit, not a bug — but the "signed-out visitors skip all auth work" comment is
slightly overstated for this cohort. Optional fix: exclude `-code-verifier` from the
gate (`/sb-[^=;]*auth-token(?:\.\d+)?=/`), or clear the verifier cookie on successful
verification.

---

### [NIT] Redundant auth options passed to createServerClient

**File**: apps/web/app/lib/auth.server.ts:47-53

@supabase/ssr FORCES `flowType: "pkce"`, `autoRefreshToken: false`,
`detectSessionInUrl: false`, `persistSession: true` AFTER spreading `options.auth`
(createServerClient.js:32-37 in @supabase/ssr 0.12.0) — the app's three explicit options
are overwritten no-ops that happen to match. Harmless; keep them as documentation or
drop them, but know they are not load-bearing. `persistSession` must stay true (it IS
the cookie storage path) and correctly isn't touched.

---

### [NIT] Failed confirm action drops the retry form

**File**: apps/web/app/routes/auth.confirm.tsx:108,130-147

After a failed POST, `loaderData.state` is still `"confirm"` (token params still in the
URL) but the `!actionData?.error` guard routes to the error branch, which has no
hidden-field form — a transient gotrue 500 forces the user back through /login for a
whole new email. Accepted per D2/D3 copy ("Request a fresh one below"), and for the
common failures (expired/used/cross-device) a retry would fail anyway. Verified the full
(loaderData, actionData) matrix renders sensibly: (already, *) → "already signed in";
(confirm, no-error) → interstitial; (confirm, error) / (error, *) → error page with
actionData.error taking precedence over loader reason. No combination renders blank or
throws. Union narrowing through `data(... satisfies ConfirmState)` typechecks
(tsc clean).

---

## Checklist verifications (no findings)

**2. getClaims reality-check — VERIFIED against installed auth-js 2.110.2**
- Shape: `{ data: { claims, header, signature }, error }` — GoTrueClient.js:5222,5275-5283.
  `claims.sub`/`claims.email` reads in auth.server.ts:105-109 match.
- Inline refresh: `getClaims()` → `getSession()` → `__loadSession()`
  (GoTrueClient.js:2450) → expiry check with 90s early margin (`EXPIRY_MARGIN_MS` =
  3×30s, constants.js:6-13) → `_callRefreshToken` (GoTrueClient.js:2517). D5's premise
  holds in the installed version.
- Rotation commit ordering: `_callRefreshToken` AWAITS
  `_notifyAllSubscribers('TOKEN_REFRESHED')`, and `_notifyAllSubscribers` awaits every
  subscriber callback (Promise.all over `x.callback(...)`), and @supabase/ssr's
  `onAuthStateChange` handler awaits `applyServerStorage` → the rotated cookies are in
  the accumulator BEFORE `getClaims()` returns, so `commitHeaders()` after the await
  always sees them. The PKCE verifier cookie is written even more directly: ssr's
  server storage `setItem` calls `applyServerStorage` synchronously-awaited for
  `-code-verifier` keys (cookies.js:328-339) — D4 holds without any event.
- JWKS on Workers: cache is MODULE-level — `const GLOBAL_JWKS = {}` keyed by storageKey
  (GoTrueClient.js:49, `get jwks` at :54), so it survives the per-request client
  construction and lives per isolate. TTL 10 min (constants.js:38). COR-2 impact: the
  first signed-in request on a cold isolate performs ONE network JWKS fetch inside the
  root loader (`fetchJwk`, GoTrueClient.js:5125-5156 — Supabase serves this from their
  edge cache); signed-out requests skip everything via `hasAuthCookie`. Acceptable:
  amortized to once per isolate per 10 min, only on signed-in traffic, and the fallback
  is graceful (a JWKS fetch failure is a thrown non-AuthError → caught by
  getSessionUser's degrade, headers still attached).
- WebCrypto fallback: if `crypto.subtle` were absent or the alg were HS*, getClaims
  silently falls back to network `getUser()` (GoTrueClient.js:5244-5265). Workers has
  WebCrypto and the project's key is ES256 (probed), so the local path is taken.

**3. Client options** — correct. See NIT above: ssr forces the right values regardless.
httpOnly is applied in OUR `setAll` (auth.server.ts:65, `buildCookieOptions`), which is
the one layer ssr cannot override — correct placement for D1.

**6. logout resource route** — correct, no default export needed. Dispatch:
`route.module.default == null && ErrorBoundary == null` → `handleResourceRequest`
(chunk-G3INQAYP.mjs:1157-1167) → `queryRoute` (single route; root loader never runs on
/logout). Client `<Form method="post" action="/logout">` submits to `/logout.data` →
`singleFetchAction` → the thrown redirect (with Set-Cookie) short-circuits and is
converted by `generateSingleFetchRedirectResponse`, which copies the redirect's headers
and sets `revalidate: headers.has("Set-Cookie")` → true (chunk-G3INQAYP.mjs:922-958) —
plus action submissions revalidate all loaders by default → root loader reruns with
cleared cookies → AccountChip disappears. No-JS document POST → `queryRoute` returns the
raw redirect Response with its Set-Cookie intact. GET /logout → loader redirect, no
signOut (asserted in auth.routes.test.ts:148-152).

**7. applySecurityHeaders multi-Set-Cookie** — safe.
`new Headers(response.headers)` (headers.server.ts:7) preserves duplicate Set-Cookie:
verified at runtime on this machine's Node (getSetCookie() returns both values after
copy) and workerd implements the same fetch-spec set-cookie iteration. `.set()` is only
called on non-Set-Cookie names; the final `new Response(response.body, ...)` carries the
Headers object through. Nothing downstream flattens (this is the outermost wrapper in
workers/app.ts:39).

**8. routes.ts** — flat `route("auth/confirm", "routes/auth.confirm.tsx")` is correct
(no nesting needed; no pathless parent). Typegen emitted
`.react-router/types/app/routes/+types/auth.confirm.ts`; the `./+types/auth.confirm`
import resolves; tsc clean.

**9. Build** — `pnpm run build` exits 0; no `Dynamic require of 'stream'` (the D12
supabase#37592 probe is clean on this Vite/RR version); no @supabase warnings. Server
bundle: build/server/assets/server-build-*.js at 1,784 kB total (supabase-js and its
sub-clients are inside — sane for a server-only bundle; it never ships to browsers).
D1 verified mechanically: `grep -rl supabase build/client/assets/` → zero matches; no
auth code in the client bundle.

---

## Verdict: the rotation-commit invariant (D5) under RR 7.9.6

**Framework behavior (source evidence, installed react-router 7.9.6):**

- Loader-thrown redirects short-circuit `query()` as raw Responses: the static
  `callDataStrategy` throws the ORIGINAL redirect Response (Set-Cookie intact) via
  `normalizeRelativeRoutingRedirectResponse`
  (dist/development/chunk-4WY6JWTD.mjs:3693-3700), and `queryImpl`'s catch returns it
  as-is: `if (isRedirectResponse(e)) { return e; }` (chunk-4WY6JWTD.mjs:3450-3452).
- **Document requests**: `handleDocumentRequest` only calls `renderHtml` — and therefore
  `getDocumentHeaders`, the ONLY place parent `loaderHeaders` are merged — when the
  query result is NOT a Response: `if (!isResponse(result)) result = await
  renderHtml(...)` (chunk-G3INQAYP.mjs:1319-1322, getDocumentHeaders at :685,
  loader-cookie prepend at :716-740). A redirect Response returns directly →
  **the root loader's headers are dropped**.
- **.data requests**: same short-circuit through `singleFetchLoaders`'s
  `handleQueryResult` (`isResponse(result) ? result : ...`, chunk-G3INQAYP.mjs:850-852),
  then `generateSingleFetchRedirectResponse` builds the 202 turbo-stream response from
  `new Headers(redirectResponse.headers)` ONLY (chunk-G3INQAYP.mjs:922-936) →
  **root loader headers equally dropped on client navigations**.
- Non-redirect paths are safe: `getDocumentHeaders` reduces over ALL matches and
  `prependCookies` carries every match's loaderHeaders/actionHeaders Set-Cookie even
  with no `headers` export (chunk-G3INQAYP.mjs:692-740) — the root's rotation rides
  every 200 document and .data response.

**Can a rotation be dropped in THIS app today? No.** The only same-navigation
(root-rotation + child-redirect) pair is the /login signed-in bounce, and login's
loader attaches its OWN `commitHeaders()` to the redirect (login.tsx:12) — its parallel
`getSessionUser` performs an equivalent refresh (gotrue's 10s reuse interval makes the
concurrent refresh return the same child session), so the cookie that rides the redirect
is the rotated one. auth.confirm's redirects carry `commitHeaders()` (auth.confirm.tsx:63,69).
logout's bare redirects run as a resource route where the root loader — the single
auth-read site — never executes. The root loader itself never redirects.

**Verdict: HOLDS — by application convention, not by framework guarantee.** RR 7.9.6
provably discards root-loader headers on every redirect short-circuit (document AND
.data). The invariant survives because each redirect site self-carries its headers and
the resource route bypasses the root loader. This is one bare
`throw redirect("/login")` in a future gated route away from D5's permanent-silent-
sign-out failure mode — see the [ADVISORY] above for the one-line documentation/helper
guard.
