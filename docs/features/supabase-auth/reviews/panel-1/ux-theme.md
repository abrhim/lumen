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
