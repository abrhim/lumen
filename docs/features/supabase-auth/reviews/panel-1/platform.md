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
