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
