# Panel-2 adversarial — product, scope & failure-mode skeptic

Reviewer: Adversarial B. Inputs: plan.md; panel-1/ux-theme.md; panel-1/security-auth.md (skimmed for product-relevant items); root.tsx; home.tsx; adversarial.md.

**Highest-impact position up front:** the plan's single worst product failure mode is not hollowness, placement, or the mailer — it is a *self-inflicted silent sign-out* from an uncommitted refresh-cookie rotation, which turns "signed in for months" into "signed out at random and Abram learns to distrust the feature." Second-worst: the error page at `/auth/confirm` will show a false failure to its single most common visitor — a user who is already signed in. Both are cheap to fix and neither is currently ranked where it belongs.

---

## P2-B1 [CONFIRMED-HARDER] Hollow-but-shipped is correct — but ship it *honestly* hollow, and give hollowness an expiry date

Position on "why auth at all": **hollow is right.** Auth is infrastructure with a long tail of protocol mechanics (this review stack proves it); decoupling it from its first consumer is correct sequencing for a solo-user app. The tempting 30-minute personalization — "continue where you left off" — is a trap on three counts:

1. It is not 30 minutes. It needs a table, RLS, a write path, and a read path in the chapter loader — four things the plan explicitly cut, and this repo's own retro history says small scope-adds are never small.
2. `localStorage` delivers the same feature *without auth*, on the device the user actually reads on. Shipping it as the auth showcase would demonstrate that auth was unnecessary — the opposite of a proof point.
3. The real auth payoff (cross-device notes/history) deserves its own feature pipeline, not a rider.

**Hardening demanded:**
- Cut panel-1's suggested login-page roadmap copy ("notes and history arrive in coming releases"). Do not promise undated features in product copy. Panel-1 itself offered the cut; take it. The honest line is descriptive, not promissory: "Signing in connects this browser to your Lumen account." Solo user knows why he built it.
- Add one line to plan.md naming the intended first consumer of auth (notes, history, whatever it is) so the retro can check whether hollow-v1 was scaffolding or dead weight. Hollow with a named successor is a plan; hollow forever is clutter in the corner of a reading app.

## P2-B2 [REFUTED] My own deep-link attack on home-only sign-in fails — panel-1's placement verdict stands

Attack attempted: readers deep-link to `/scripture/john/3` and never visit home, so a home-only invitation is undiscoverable. The attack dies on the plan's own scope: **v1 gates nothing, so a signed-out deep-linker loses nothing and needs no invitation.** Discoverability of sign-in only matters at the moment something is gated — and at that moment *the gate itself* is the affordance (a "sign in to keep notes" prompt at the point of value), which is strictly better than ambient chrome. Meanwhile `/login` stays directly addressable for the one user who knows it exists.

Panel-1's asymmetry (chip everywhere, invitation home-only) is confirmed as-is. Tagging panel-1's finding 1: **material**. Do not re-litigate placement at synthesis.

## P2-B3 [ESCALATE] The 2/hr mailer fuse will be blown by the deployment verification itself — budget the emails or the ship-day demo poisons

Security panel verified the built-in mailer at **2 emails/hour project-wide** (not per-address, and localhost shares the fuse — same project). Now count ship-day sends: (1) verify the token_hash template edit, (2) verify the `?code=` fallback, (3) Abram's real first sign-in, (4) the retry after the typo'd/spam-foldered first attempt. That is 2 hours of wall-clock waiting minimum, discovered *during* the demo, which reads as "the feature is broken" — the exact poisoning the question posits.

Position: staying on the built-in mailer is **fine for a solo user in steady state** (one sign-in per device per ~forever, per P2-B4), but the plan must:
1. Add an explicit **email budget to the deployment-verification checklist**: which sends happen in which hour, in what order (template-edit path first — it's the primary). This is a sequencing note, zero code.
2. Fix the copy honesty: panel-1's "limited to a few per hour" overstates it. Honest copy: "Sign-in email is limited to about two per hour — check spam for the earlier link before resending."
3. If Abram controls DNS for a real domain, custom SMTP (Resend free tier) is ~20 minutes and deletes this entire class — worth asking him once at ship-report time rather than declaring "later." If he doesn't, the built-in mailer plus the budgeted checklist is the correct v1.

Also a product co-sign on the security panel's POST interstitial: scanner GETs that burn one-time tokens force resends, and resends burn the 2/hr fuse. The interstitial is not just anti-scanner hygiene; **it protects the only two emails you get per hour.** Tag on that panel-1/security finding: **material**.

## P2-B4 [CONFIRMED-HARDER] Session lifetime: Abram stays signed in for months *by default* — the only way to lose that is the plan's own plumbing. Upgrade the "low" finding

Trace of the actual settings: Supabase refresh tokens have **no absolute expiry by default**; inactivity timeout defaults to **off**; time-boxed sessions default to **off**; `@supabase/ssr` force-sets cookie `maxAge` to **400 days**; access token lives 1h and refreshes on the next server-side auth read. Net: a phone that opens Lumen once a month stays signed in indefinitely. The feature as specced does NOT sign Abram out weekly. Good.

The threat is entirely self-inflicted: **refresh-token rotation.** When the root loader refreshes an expired access token, supabase-js rotates the refresh token and writes new cookies via `setAll`. If any code path triggers that rotation and **drops the Set-Cookie commit**, the browser keeps the *old* refresh token — revoked once the 10s reuse window closes — and the next visit is a silent hard sign-out with no error anywhere. This is the security panel's last finding, filed at **severity: low**. From the product seat it is the difference between "auth I forget about" (success) and "auth that randomly logs me out" (the feature's death for its one user). 

**Escalation:** upgrade to high at synthesis. Concretely: (a) v1 rule — *exactly one* auth read site (root loader), enforced by convention comment, so there is exactly one commit point to get right; (b) new harness case **H6**: request carrying an expired access token + valid refresh token → mocked refresh fires → response headers contain the rotated `sb-*` Set-Cookie pair. H1–H5 all test the cold paths; the refresh path is the one that runs every hour for the rest of the app's life and no harness case covers it.

## P2-B5 [CUT] Multi-tab sync is gold-plating — do not build it

Scenario: tab A parked on "check your email," link opened in tab B. Tab A's chrome is stale. Consequences in v1: **cosmetic only** — nothing is gated, so a stale "Sign in" affordance misleads no one about capability, and any document load (or visiting home) corrects it. BroadcastChannel/`onAuthStateChange` machinery would also fight the app's architecture: httpOnly cookies + zero browser client means there is no client-side auth state to broadcast *from* — you'd be building an event bus to carry a boolean that a page refresh delivers for free.

Cut entirely. The already-specced success copy ("the link signs you in on this device / in this browser") makes tab A self-explaining: the user got what they came for and closes it. If anyone ever demands more, the ceiling is 3 lines — `revalidate()` on `visibilitychange` scoped to the login route — and even that is not v1.

## P2-B6 [NEW] The `/auth/confirm` error page's most common visitor is *already signed in* — the page must branch on session before showing failure

With the security panel's POST interstitial adopted, walk the common reuse path: user clicks the emailed link, signs in successfully, then hits it again (mail-app double-tap, scanner echo the user retries, curious re-paste). Token is consumed → `verifyOtp` fails → plan shows "That link didn't work." **False.** Everything worked; the user is holding a valid session *right now*, and we are telling them sign-in failed. For a solo user this is literally the most likely error-page impression they will ever form.

Fix (small): before rendering failure, the confirm route checks for an existing session (the root loader's `getUser` result is already in hand, or one local `getClaims`). If present: "**You're already signed in.** [Continue to Lumen →]" — no failure framing at all. Only a session-less failure gets the recovery copy. Add a harness case: used-token + valid session cookie → already-signed-in UI, not error UI.

**And an [ESCALATE] rider — the two panels' copy recommendations conflict and synthesis must reconcile them:** panel-1's error copy ("links only open in the browser that requested them") was written for a PKCE-primary world. The security panel then made `token_hash` the primary path via the template edit — and `token_hash` links work fine cross-browser and cross-device. If synthesis adopts both verbatim, the shipped copy tells `token_hash` failures a false story about browsers. Resolution: branch the copy — `?code=` failure keeps the browser/device explanation; `token_hash` failure says only "expired or already used" + resend CTA (and per the security panel, never distinguish used/expired/invalid beyond that).

## P2-B7 [REFUTED] No account page, no email-change, no delete-account is the right v1 — there is no legal or product forcing function

For a personal app whose sole user is its operator, holding exactly one email address: GDPR/CCPA machinery (export, deletion self-service) has no live obligation to a data subject who owns the database. Email-change for the one user is a dashboard operation. A privacy *page* is process theater at this scale. The cuts stand as-is.

One line of hygiene worth keeping (not a page): on the login form, `font-ui text-[13px] text-muted-foreground` — "Your email is used only to send this sign-in link." Costs nothing, and it is the true statement a second household member would want the day one exists.

## P2-B8 [CUT] Panel-1 ceremony audit — three cuts, two keeps

Panel-1 is high-signal overall (its placement verdict, live-region gotcha, and error-copy upgrade are all real). But for a solo-user v1, trim:

- **CUT: "Use a different email" prefilled return micro-flow.** It's a state machine (success→form transition with field prefill and fetcher reset) serving a typo case the success screen already exposes by showing the address. A plain link back to the form (empty is fine) covers it. Panel-1's own justification is the prominent email display — keep that, cut the choreography.
- **CUT: the per-theme chip QA burden.** Panel-1's four-theme hex audit is *done* — it's in the review. Ship the specced `bg-panel2 border-rule2 text-ink` recipe and do not schedule a per-theme visual QA matrix as implementation work. Spot-check ink (the only dark theme) and move on.
- **CUT: the visibilitychange-countdown deliberation.** Panel-1 spent a paragraph deciding not to freeze the countdown. Correct outcome; zero implementation content. Drop from synthesis.
- **KEEP: the 60s disabled resend countdown.** I tried to cut it as ceremony and failed: with a 2-email/hour project fuse (P2-B3), a disabled resend button is the cheapest guard on the scarcest resource in the whole feature. ~10 lines. Keep.
- **KEEP: the aria-live pre-mounted container gotcha.** That one genuinely will be missed in implementation; it is the kind of finding panels exist for.

Also from the plan itself, not panel-1: the both-shapes confirm handler stays (security panel made it load-bearing), and the never-throw + degrade-event pattern on `getUser` is house style, not gold-plating — no cut.

---

## Tag roll-up for synthesis

| ID | Tag | One-line position |
|----|-----|-------------------|
| P2-B1 | CONFIRMED-HARDER | Hollow v1 correct; cut roadmap-promise copy; name the successor feature in plan.md. |
| P2-B2 | REFUTED (attack) | Deep-link objection fails; panel-1 home-only placement stands — material, adopt as-is. |
| P2-B3 | ESCALATE | 2/hr fuse: add email budget to deploy checklist; fix copy to "about two per hour"; ask Abram once about SMTP domain. |
| P2-B4 | CONFIRMED-HARDER | Sessions last months by default; uncommitted rotation commit is the real sign-out risk — upgrade security-panel "low" to high; add H6 refresh-path harness case. |
| P2-B5 | CUT | Multi-tab sync: gold-plating, architecturally homeless (no browser client). Do not build. |
| P2-B6 | NEW + ESCALATE | Confirm error page must branch on existing session ("You're already signed in"); reconcile panel-1 PKCE copy with token_hash-primary world. |
| P2-B7 | REFUTED (pressure) | No account/email-change/delete needed now; add one privacy sentence on the login form, no page. |
| P2-B8 | CUT | Cut "use a different email" micro-flow, per-theme QA matrix, countdown deliberation; keep 60s resend guard + aria-live gotcha. |

**Overall stance on panel-1 (ux-theme):** mostly signal. Its central verdict (chip everywhere, invitation nowhere the reader is reading) survives adversarial pressure and should be adopted verbatim; its excesses are decorative micro-flows, not wrong calls. The gap neither panel-1 document owns is cross-document: their error-copy and template-edit recommendations contradict each other (P2-B6), and the refresh-commit finding is mis-ranked low (P2-B4). Those two reconciliations are the synthesis work that matters.
