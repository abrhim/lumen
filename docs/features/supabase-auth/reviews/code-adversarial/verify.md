# Code-adversarial A (step 10) — executable verification of the code-panel

Reviewer: CODE-ADVERSARIAL A. Method: copied the real functions / read the installed
package source (react-router 7.9.6, @supabase/ssr 0.12.0, @supabase/auth-js 2.110.2,
@radix-ui/react-menu 2.1.19) and PROVED each claim in Node. Verdicts lead with the
safeReturnTo CRITICAL.

---

## 1. [CONFIRMED-HARDER] safeReturnTo backslash bypass — CRITICAL is real, and the panel's own "minimal" fix is broken

**The bug is real.** Ran the *exact* current `safeReturnTo` (auth.server.ts:141-145,
guard = `!startsWith("/") || startsWith("//") || includes(":")`) against 15 vectors, and
resolved each accepted value through `new URL(result, "https://lumen.example")` (what a
browser does with a `Location` header):

```
"/\evil.com"     -> ACCEPTED -> Location resolves: https://evil.com/   *** CROSS-ORIGIN ***
"/\\evil.com"    -> ACCEPTED -> https://evil.com/                      *** CROSS-ORIGIN ***
"/\/evil.com"    -> ACCEPTED -> https://evil.com/                      *** CROSS-ORIGIN ***
"/\r/evil" (rawCR)-> ACCEPTED -> https://evil/                         *** CROSS-ORIGIN ***
"/\n/evil" (rawLF)-> ACCEPTED -> https://evil/                         *** CROSS-ORIGIN ***
"//evil.example" -> blocked   (existing guard catches it)
"https://evil"   -> blocked   (":" catch)
```

The single-slash + backslash slips every clause (`startsWith("/")` true, not `//`, no
`:`), and per WHATWG the browser treats `\` as `/` in a `Location`, giving a
protocol-relative → cross-origin navigation. **Session-lure / open-redirect off Lumen's
own origin, exactly as the panel's CRITICAL states.** The current D7 test only checks
`//evil.example` and `https://…`, both of which the *existing* guard already blocks — the
whole backslash class is untested.

**Which vectors are actually browser-reachable** (ran the real RR `redirect()`):
```
redirect("/\evil.com")  -> 302, Location: "/\evil.com"     (LIVE open redirect)
redirect("/\/evil.com") -> 302, Location: "/\/evil.com"    (LIVE open redirect)
redirect("/\r/evil")    -> THROWS "invalid header value"   (undici/Workers Headers rejects raw CR/LF → 500, not a redirect)
```
So the **live exploit is the backslash family**; the raw CR/LF variants degrade to a 500
(DoS-ish, not open-redirect). Either way the guard must reject them.

**PROVEN FIX — use the URL-resolve variant, NOT the panel's "minimal" one.** I tested
both fixes the panel proposed. The panel's "minimal" regex fix is itself a bug:

```js
// PANEL "minimal" (auth.server.ts security.md:44-46) — DO NOT SHIP
if (/[\\:\s -]/.test(value)) return "/";   // the trailing " -" is a LITERAL hyphen
```
Its char-class rejects any path containing a hyphen. Proven against real Lumen slugs:
```
"/word-study"                -> "/"   (BROKEN — bounced to home)
"/scripture/john-3-16?v=kjv" -> "/"   (BROKEN)
"/read/genesis-1"            -> "/"   (BROKEN)
"/verse-detail"             -> "/"   (BROKEN)
```
Since `returnTo` is `location.pathname + location.search`, this fix would send **every
hyphenated reading URL to `/` on sign-out** — it silently guts the D7 feature.

The URL-resolve fix blocks 14/14 attacks AND preserves 8/8 legit paths (hyphens, queries):
```js
export function safeReturnTo(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "/";
  try {
    const u = new URL(value, "http://x");         // WHATWG resolves the backslash for us
    return u.origin === "http://x" ? u.pathname + u.search : "/";
  } catch { return "/"; }
}
```
Proof (same harness): `/\evil.com`→`/`, `/\/evil.com`→`/`, `//evil.example`→`/`,
`javascript:…`→`/`, while `/word-study`→`/word-study`, `/scripture/john-3-16?v=kjv`
preserved verbatim. Add the backslash + raw-CR vectors to the D7 test.

---

## 2. [CONFIRMED] Cooldown restart bug — real; the proposed fix is safe (no reset-loop)

**Bug confirmed by trace** (login.tsx:61-67). `sentAt.current !== actionData.email` gates
the reset. First send: `sentAt.current = "a@b.co"`, cooldown=60. Resend carries the SAME
email (hidden field, login.tsx:98) → new `actionData` object but identical `.email` →
guard false → **cooldown never resets, button re-enables instantly.** The 60s guard works
exactly once per email; every subsequent resend is uncooled against a ~2/hr mailer.

**The proposed fix does NOT reintroduce a reset-loop.** The concern was: if `actionData`
is a new object every render, `useEffect(..., [actionData])` fires every render and pins
cooldown at 60. Verified against react-router source: `useActionData` returns
`state.actionData?.[routeId]` (chunk-4WY6JWTD.mjs:5860,5958). `state.actionData` is only
replaced when a new action completes; a local `setCooldown` re-render does **not** rebuild
router state, so the reference is stable between renders. Therefore:
- new submission → new `actionData` ref → effect runs once → `setCooldown(60)` ✓
- interval tick `setCooldown(c=>c-1)` → re-render, same `actionData` ref → deps unchanged →
  effect does NOT re-run → counts down cleanly. No loop.

Fix (either panel form works): `useEffect(() => { if (sent) setCooldown(RESEND_SECONDS); }, [sent, actionData]);`
and delete `sentAt`.

---

## 3. [CONFIRMED] Radix menu-form submit works only by animation accident; `onSelect` preventDefault fix is correct AND still submits

Read @radix-ui/react-menu 2.1.19 `MenuItem` (dist/index.mjs:373-420). Exact sequence:
`handleSelect` runs on the item's `onClick` (line 401). It dispatches a **separate**
cancelable `CustomEvent("menu.itemSelect")` (line 385-387); if that event is
`defaultPrevented`, the menu stays open, else `rootContext.onClose()` runs (line 388-392).

- **Today (no onSelect):** click → `handleSelect` → `onClose()` → React flushes the close
  synchronously (discrete event) → `DropdownMenuContent` starts unmounting. The
  `<button type=submit>`'s **default action (form submit) fires only after** the click
  listener returns. It survives *only* because `DropdownMenuContent` has exit animations
  (`data-closed:animate-out …`, dropdown-menu.tsx:46) → Radix `Presence` keeps the subtree
  mounted ~100ms, so the button still has a form owner when submit fires. Remove/shorten
  the animation (or a shadcn bump) → synchronous unmount → **submit becomes a silent
  no-op.** HIGH confirmed.
- **Fix `onSelect={e => e.preventDefault()}` is correct.** It sets `defaultPrevented` on
  the `menu.itemSelect` CustomEvent → `onClose()` is skipped (line 388) → menu stays open →
  button definitely still mounted when the submit default fires. Crucially, `preventDefault`
  on the `menu.itemSelect` CustomEvent is a *different event object* from the native click;
  it does **not** touch the click's default action, so the `<Form>` still submits. Verified
  in source: no path from `itemSelectEvent.preventDefault()` to the DOM click event.

---

## 4. [CONFIRMED] RR7 header-drop on redirect — real framework behavior, no live drop in THIS app (accurately characterized as advisory)

Spot-checked every cited react-router 7.9.6 line; all exist and say what the platform
reviewer claimed:
- `queryImpl` catch: `if (isRedirectResponse(e)) return e;` (chunk-4WY6JWTD.mjs:3450-3452)
  — redirect short-circuits, returned raw.
- redirect thrown via `normalizeRelativeRoutingRedirectResponse` (chunk-4WY6JWTD.mjs:3693-3700).
- `getDocumentHeaders` (the ONLY parent-header merge, via `prependCookies`) at
  chunk-G3INQAYP.mjs:685/742 — reached ONLY when the result is not a Response:
  `if (!isResponse(result)) result = await renderHtml(...)` (1319-1321). A redirect Response
  skips it → **root loader headers dropped** on documents.
- `.data`: `generateSingleFetchRedirectResponse` builds `new Headers(redirectResponse.headers)`
  only (928) → root headers dropped on client navigations too.

**Real in the app today? No.** login.tsx:12 and auth.confirm.tsx:63,69 each attach their
OWN `commitHeaders()` to their redirects; logout.tsx is a resource route (verified: no
default export — only `action`+`loader`), so the root loader never runs on `/logout` and
its bare `redirect(returnTo)` has no root rotation to drop. **Theoretical/latent** — the
first future gated route doing a bare `throw redirect("/login")` detonates D5's
permanent-silent-sign-out. The advisory + a `redirectWithAuth(to, headers)` helper is the
right cheap guard.

---

## 5. NEW hunts

### [CONFIRMED] getClaims() DOES refresh expired tokens inline — D5 premise verified at source
`supabase.auth.getClaims()` is called with no jwt arg (auth.server.ts:104). Source
(GoTrueClient.js:5219-5228): no-arg → `await this.getSession()` → `__loadSession` → expiry
check → `_callRefreshToken`, and it returns claims decoded from the **fresh** access_token.
So an expired token rotates inline and the rotated cookies ride `commitHeaders()`. D5 holds
in the installed version — not just asserted.

### [CONFIRMED] Chunked-cookie clearing is complete — proven with the real @supabase/ssr
Built a Request carrying a realistic chunked session
(`sb-abcdef-auth-token.0`, `.1`, `-code-verifier`, plus `lumen-theme`/`other`) and ran the
real `clearAuthCookieHeaders`:
```
Set-Cookie count: 3
  sb-abcdef-auth-token.0=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax
  sb-abcdef-auth-token.1=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax
  sb-abcdef-auth-token-code-verifier=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax
theme/other preserved: true | all 3 sb-* cleared: true | every clear Max-Age=0 + hardened flags: true
```
Both chunks AND the verifier clear with the SAME hardened flags; non-sb cookies untouched.
No leak.

### [REFUTED — not exploitable] two Set-Cookie collision (verifier vs session)
Verifier (`sb-…-auth-token-code-verifier`) and session (`sb-…-auth-token[.n]`) are
distinct cookie NAMES, so they never collide in the browser jar. On the only concurrent
path (root + login/confirm both refreshing), both emit the same rotated `sb-…-auth-token`;
last-Set-Cookie-wins and both are valid within gotrue's 10s reuse interval (platform
MINOR). No new issue.

### [NOTE] login action origin on Workers — fine
`new URL(request.url).origin` (login.tsx:25): on Workers behind Cloudflare `request.url`
is the full public URL, so origin is the real host. No new finding. Matches D9.

### [CONFIRMED, pre-existing] confirm action has no session guard
The confirm action (auth.confirm.tsx:52-74) mints a session from the POSTed token with no
origin/CSRF check and no dependence on existing cookies — this is the security panel's
MEDIUM (login-CSRF / session-fixation). Verified: nothing in the action reads
`Origin`/`Sec-Fetch-Site` or an existing session. Latent until per-user state ships (D14).
No *new* finding beyond the panel's MEDIUM, but I confirm it is real, not theoretical.

---

## Evidence artifacts
All scripts runnable; copies in the scratchpad:
`srt.mjs` (bypass), `fix.mjs` (both candidate fixes vs attacks+legit), `clear.mjs`
(chunked clearing), plus inline `redirect()` and Radix/auth-js source reads above.
