# code-adversarial (aggregated 2026-07-10) — verify, journeys

---
<!-- code-adversarial/verify.md -->
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

---
<!-- code-adversarial/journeys.md -->
# code-adversarial B (step 10) — real-user journey walk (supabase-auth)

Reviewer: FAILURE-MODE / real-user skeptic. Method: traced 7 concrete journeys cookie-by-cookie
against the implemented code (login/auth.confirm/logout/root/home + auth.server.ts, dropdown-menu,
sheet, scripture, app.css). Did NOT re-derive the code-panel's 7 findings; ruled on what they missed
and what actually matters for ship.

**Headline: the two SUSPECTED breaks are NOT breaks.** Journey 1 (first-ever same-device sign-in)
COMPLETES — verified every cookie hop. Journey 5 (reduced-motion) does NOT disable the exit
animation, so the Radix sign-out finding stays *latent*, it does not escalate. The one thing that
will actually bite on first deploy is Journey 2: an opaque browser error with zero in-app signal.

---

## J1 — First-ever same-device sign-in (?code= PKCE) — [CONFIRMED: WORKS]

Traced end to end; the happy path completes. Cookie by cookie:

1. **POST /login** → `signInWithOtp` writes `sb-<ref>-auth-token-code-verifier` via `setAll`;
   `commitHeaders()` rides the `data({sent:true}, {headers})` 200 (action, not redirect → no
   RR7 header-drop). Cookie flags: `Path=/; HttpOnly; SameSite=Lax; Secure(https)`. Set in browser. ✓
2. **Email link** = Supabase `{{ .ConfirmationURL }}` → `/auth/v1/verify` (Supabase origin,
   consumes token) → 302 to `emailRedirectTo` = our `/auth/confirm?code=…`. The final landing is a
   **top-level GET** to our origin → SameSite=Lax cookies ARE sent → the verifier cookie arrives. ✓
3. **GET /auth/confirm** loader → `getSessionUser` → `hasAuthCookie` matches the verifier cookie →
   `getClaims()` → no session → `user:null`, and crucially writes **no removal cookie** (auth-js has
   nothing to remove), so `commitHeaders()` is empty and the verifier **survives untouched**. Renders
   the "Continue to sign in" interstitial. ✓ (I explicitly checked the GET does not clobber the verifier.)
4. **POST /auth/confirm** (same-origin form, Lax cookies incl. verifier sent; httpOnly is irrelevant to
   *sending*) → `exchangeCodeForSession(code)` reads verifier via `getAll`, mints session, `setAll`
   writes `sb-<ref>-auth-token` (+ chunks) and overwrites the verifier → `throw redirect("/", {headers})`. ✓
5. **GET /** → root loader → `hasAuthCookie` true → `getClaims` → user → chip renders. ✓

Path (`/`), host-only domain, and SameSite all match at every hop. **No break.** This is the single
most reassuring result of the walk.

## J1b — Email scanner burns the ?code= link before the interstitial — [CONFIRMED-HARDER of D3]

D3 already documents "pre-edit ?code= links are consumed at Supabase's /verify before our page." Walking
it as a user makes the exposure concrete: with the DEFAULT template (still shipping until the D13b edit),
the one-time token lives at Supabase's `/verify`, which any aggressive email scanner (Gmail image proxy,
Outlook SafeLinks, corporate MTA) hits on delivery — consuming the code **before Abram ever clicks**. He
then lands on our interstitial, POSTs, and `exchangeCodeForSession` returns
`otp_expired`/"already used" → "That link didn't work" on a link he never touched. The interstitial
protects **nothing** until the token_hash template edit ships. Personal Gmail is usually lenient, so
Abram's own first sign-in likely survives; the moment a real reader on a scanned mailbox tries, it can
fail mysteriously. **Ship note: the interstitial's value is contingent on D13b; don't count it as live
scanner-protection until the template is edited.**

## J2 — Site-URL-unmet first deploy — [CONFIRMED-HARDER / ACCEPT] ← practical first-run break

Proven in planning (D13a): the dashboard Site URL is still the default `localhost:3000`; `emailRedirectTo`
silently falls back to it when not allowlisted. What Abram ACTUALLY experiences on the deployed site,
step by step, before he fixes the dashboard:

1. Enters email on `https://lumen.…workers.dev/login` → sees "Check your email." (success, looks fine)
2. Clicks the link → Supabase `/verify` → 302 to **`http://localhost:3000/auth/confirm?code=…`**
3. His browser tries to open localhost:3000 → **"This site can't be reached / connection refused"**
   (or, if a dev server happens to run on :3000, a wrong-project page). The request **never reaches our
   app**, so there is **no in-app signal and no way for the app to detect or warn** — the failure is
   structurally invisible to our code.

The failure is a **mystery, not legible**: nothing in the UI hints at a config problem; the login page
even reported success. This is a known human-gated prerequisite (D13a) and Abram wrote the checklist, so
it's ACCEPTable — but it is the thing most likely to waste real minutes on first run. Only mitigation is
the deploy checklist itself; the app cannot self-heal this. **Recommend the deploy checklist say
verbatim: "until Site URL is set, the first magic link opens localhost and the browser errors — this is
expected, fix the dashboard."**

## J3 — Logout as the first action after 1h token expiry — [CONFIRMED: WORKS]

Logout is a resource route, so the root loader (the only refresh site) does NOT run — correct, we're
tearing down, not refreshing. Traced: `signOut({scope:'local'})` does **no network** (local scope never
calls GoTrue `/logout`), so an expired access token is irrelevant; it's wrapped in try/catch anyway.
Then `clearAuthCookieHeaders(request, commitHeaders())` appends `maxAge:0` Set-Cookie for **every** `sb-*`
cookie present on the request (including chunked `.0/.1`) — **unconditionally**, per D6, independent of
whether signOut cleared anything. The POST carries the expired cookies (Lax, same-origin) so they are all
enumerated and cleared. Redirect to `returnTo` → browser deletes cookies → GET carries no `sb-*` →
root loader `user:null` → chip gone. **No break; the expired-token logout is clean.**

## J4 — Fixed chip cluster over a mobile chapter — [ACCEPT: no real collision]

Cluster is `fixed right-4 top-4 z-40` (16px inset, ~28px tall, so it occupies y≈16–44px on the RIGHT).
Scripture header is `max-w-6xl px-6 py-10`; the eyebrow "Lumen" sits at y≈40px on the **LEFT**, the book
`<h1>` is a row lower. Horizontal axes don't share (cluster right / header content left), vertical
overlap is marginal at the eyebrow's top edge only. The **verse sheet is a BOTTOM sheet** (`data-[side=
bottom] bottom-0 z-50`) with a full-screen **overlay at z-50** — when the sheet is open the overlay
covers the z-40 cluster (chip dims and is non-interactive, which is correct modal behavior, not a visual
collision). The word-study cards render **in-flow** in the verse list (`motion-safe:animate-in`, well
below the header) and the mobile `ChapterArtStack` is `mt-6 lg:hidden` — neither is near top-right.
**No functional overlap with the sheet, the word cards, or the header controls (back/graph live left &
center).** Same placement as home, so no page-specific surprise.

## J5 — Reduced-motion + the sign-out dropdown — [CONFIRMED, does NOT escalate]

The suspected escalation is FALSE. The code-panel's masking theory is right (Radix Presence keeps the
`<Form>` mounted through the ~100ms exit animation, so the click's default submit still has a form owner)
— but reduced-motion does **not** strip that animation:

- `tw-animate-css@1.4.0` ships **no** `prefers-reduced-motion` rule (grepped the installed package —
  zero matches). Its `data-open:animate-in` / `data-closed:animate-out` utilities are NOT
  `motion-safe:`-gated in dropdown-menu.tsx:46.
- app.css's only `@media (prefers-reduced-motion: reduce)` block (app.css:277–283) disables
  **view-transitions only** — it does not touch `animate-out`.

So reduced-motion users get the **same** exit animation, and sign-out remains masked-working for them
too. **Journey 5 stays at the code-panel's severity (latent, not already-broken-for-a-cohort).** It is
still one shadcn bump or one `motion-safe:`-gating polish pass away from silently breaking sign-out for
EVERYONE — apply the code-panel's one-line `onSelect={(e)=>e.preventDefault()}` fix and stop depending on
an animation to hold the form in the DOM. (This is the highest-value latent fix in the feature.)

## J6 — Two devices, same account, local logout — [ACCEPT: correct]

Sign in on phone + desktop; sign out desktop → `signOut({scope:'local'})` clears only the desktop's local
cookies and does **not** revoke the refresh token server-side, so the phone's session and its own refresh
token keep working. Phone stays signed in. No global sign-out surprise; matches D6 exactly. (Tradeoff:
the desktop refresh token isn't server-revoked — accepted in D6, nothing account-scoped to abuse per D14.)

## J7 — No sign-in affordance on a chapter page — [ACCEPT for v1, revisit-when-gated]

A signed-out reader deep-linking to `/scripture/john/3` has **no** sign-in control anywhere on the page.
The only paths back are the "Lumen" eyebrow (→ `/`, scripture.tsx:649) or the back button — then "Sign
in" on the home header: **two taps and non-obvious** (nothing signals sign-in lives on home). Panel-2's
"acceptable because nothing is gated" holds and actually hardens under stress: since D14 gates nothing,
there is literally **zero functional reason** to sign in from a chapter — the missing affordance costs
nothing today. **ACCEPT for v1.** But it's the same latent class as the login-CSRF finding: the first
gated/personalized feature turns this dead-end into a real papercut. Flag for the next auth-touching
feature, don't fix now.

---

## Ship ruling (what actually matters)

| Journey | Verdict | Blocks ship? |
|---|---|---|
| J1 first sign-in happy path | WORKS (traced) | no — reassuring |
| J1b scanner burns ?code= | contingent on D13b template edit | no, but don't claim scanner-safety pre-edit |
| **J2 Site-URL localhost error** | opaque first-run failure, no in-app signal | no (D13a prereq) — **strengthen checklist copy** |
| J3 expired-token logout | WORKS (unconditional clear) | no |
| J4 mobile chip collision | no real collision | no |
| **J5 reduced-motion sign-out** | latent, NOT escalated | no — but apply the 1-line onSelect fix |
| J6 multi-device local logout | correct | no |
| J7 no chapter sign-in affordance | acceptable while nothing gated | no — revisit when gated |

**Nothing found here blocks ship.** The suspected showstoppers (J1, J5) are clean. The real-world
sharp edge is J2's mystery first-run error — cheap to blunt with one checklist sentence. The one latent
fix worth landing before it detonates is the code-panel's `onSelect` preventDefault (J5).
</content>
</invoke>

