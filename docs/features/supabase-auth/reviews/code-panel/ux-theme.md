# Code-panel review — UX / Theme / A11y (step 9)

Reviewer role: UX + theme + a11y, reviewing the implemented UI against plan D10 and panel-1/ux-theme.md. Files read in full: login.tsx, auth.confirm.tsx, root.tsx, home.tsx, app.css, ui/dropdown-menu.tsx, ui/select.tsx (via grep), ui/button.tsx (via grep), Emil SKILL.md.

## Token audit (checklist item 1)

Every color/utility class used in the four new/changed files was grepped against `apps/web/app/app.css`:

| Class | Resolves via | Status |
|---|---|---|
| `text-faint` | `--color-faint: var(--t-faint)` (app.css:15) | OK, all 4 themes |
| `text-ink` | `--color-ink` (app.css:14) | OK, all 4 themes |
| `border-rule2` | `--color-rule2` (app.css:17) | OK, all 4 themes |
| `bg-panel2` | `--color-panel2` (app.css:12) | OK, all 4 themes |
| `bg-surface` | `--color-surface` (app.css:13) | OK, all 4 themes |
| `bg-primary` / `text-primary-foreground` | `--color-primary(-foreground)` (app.css:210-211) | OK — defined in base :root AND overridden per theme (92-93, 133-134, 174-175) |
| `text-muted-foreground` | app.css:206 | OK, per theme |
| `text-destructive` | `--color-destructive: var(--destructive)` (app.css:203) | **EXISTS but single-valued — see MED finding below** |
| `font-ui` / `font-display` / `font-reading` | app.css:24-26 | OK |
| `motion-safe:animate-in fade-in` | tw-animate-css (app.css:2) | OK |

**Verdict: no unresolved classes — nothing renders unstyled.** One token gap: `--destructive` is declared only in the base `:root` block (app.css:242) and none of the three `[data-theme]` blocks override it.

House convention for error text: there is no prior route-level error text in the app (grep for `text-destructive`/`role="alert"` hits only ui/badge.tsx, ui/button.tsx, ui/select.tsx, ui/dropdown-menu.tsx variants). login.tsx is setting the convention; `text-destructive` is the right choice — fix the token, not the class.

---

### [HIGH] Resend cooldown never restarts after the first resend — the 60s guard only works once

`apps/web/app/routes/login.tsx:61-67`

```tsx
const sentAt = useRef<string | null>(null);
useEffect(() => {
    if (sent && sentAt.current !== actionData.email) {
        sentAt.current = actionData.email;
        setCooldown(RESEND_SECONDS);
    }
}, [sent, actionData]);
```

Trace: first send → `sentAt.current = email`, cooldown 60. Cooldown reaches 0, button enables. User clicks "Resend the link" → new actionData arrives with the **same email** → `sentAt.current !== actionData.email` is false → cooldown is never reset → the button re-enables instantly. From the second send onward there is **no cooldown at all** — the user can hammer a mailer that sends ~2 emails/hour, the exact failure D10's guard exists to prevent.

**Fix** — drop the email comparison; key on actionData identity (React Router returns a new object per action result, stable between submissions):

```tsx
useEffect(() => {
    if (sent) setCooldown(RESEND_SECONDS);
}, [actionData]);
```

Delete `sentAt` entirely. (The interval effect at :68-72 with dep `[cooldown > 0]` is correct — transitions false→true→false create/clear one interval — though the boolean dep will annoy lint; fine to leave.)

---

### [HIGH] Sign-out submit inside the Radix menu works only by animation accident — add `onSelect` preventDefault

`apps/web/app/routes/root.tsx` (root.tsx:140-151), `apps/web/app/components/ui/dropdown-menu.tsx:46`

The classic bug is real here, but currently masked. Sequence on clicking "Sign out":

1. Click dispatches; Radix `MenuItem`'s select handler runs and closes the menu (keyboard Enter/Space is the same path — Radix preventDefaults and calls `.click()` on the item).
2. React 19 flushes the close synchronously at the end of the dispatch.
3. Only **after** dispatch completes does the browser run the click's default action — submitting the `<Form>`. If the button/form have left the DOM by then, the submit is a **silent no-op** (a removed submit button has no form owner).

Why it works today: `DropdownMenuContent` has exit animations (`data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95`, dropdown-menu.tsx:46), so Radix's Presence keeps the content subtree mounted through the close (~100ms) — the form is still in the DOM when the default action fires, React Router's submit handler runs, and the POST navigates. Remove or shorten that animation (or a future shadcn update changes it) and sign-out silently stops working. Note these `animate-out` utilities are not `motion-safe:`-gated, so reduced-motion doesn't currently strip them — but that's the kind of polish fix that would detonate this.

**Fix** (canonical Radix pattern, one line):

```tsx
<DropdownMenuItem asChild onSelect={(event) => event.preventDefault()}>
    <button type="submit" className="w-full cursor-pointer">
        Sign out
    </button>
</DropdownMenuItem>
```

The menu stays open during the brief POST; the logout redirect/revalidation nulls `user`, `AccountChip` returns null, and menu + trigger unmount together. `DropdownMenuItem` forwards props to the Radix primitive (dropdown-menu.tsx:61-82), so `onSelect` passes through.

---

### [MED] `--destructive` is not themed — error text fails contrast in `ink` (~3.5:1) and is borderline in parchment/linen

`apps/web/app/app.css:242`; consumed at `apps/web/app/routes/login.tsx:131`

`--destructive: oklch(0.577 0.245 27.325)` (Tailwind red-600, ~#dc2626) is defined once in base `:root` and inherited by all four themes. Approximate contrast of red-600 against each theme's `--background`:

- **ink** `#17181c`: ~3.5:1 — **fails AA for 14px text** (needs 4.5:1)
- parchment `#f3ede1`: ~4.2:1 — marginal fail
- linen `#f3f6f7`: ~4.3:1 — marginal
- paper `#fafaf7`: ~4.9:1 — passes

This is the one thing in the new UI that visibly breaks in `ink`: the login error line renders as dim dark-red on near-black. Also note the ui components' `dark:` destructive variants (button.tsx, badge.tsx, select.tsx) are dead code in this app — the dark variant is `.dark *` (app.css:5) but themes switch via `data-theme="ink"`, so nothing ever compensates.

**Fix** — add `--destructive` to each theme block, matching each theme's temperature:

```css
:root[data-theme="parchment"] { --destructive: #b3402c; }  /* warm brick, ~5.4:1 on #f3ede1 */
:root[data-theme="linen"]     { --destructive: #b03a3a; }  /* ~5.2:1 on #f3f6f7 */
:root[data-theme="ink"]       { --destructive: #e88a80; }  /* muted salmon, ~7:1 on #17181c, matches --graph-event register */
```

(Exact hexes are suggestions in each theme's palette register; anything ≥4.5:1 on the theme background works. Keep base :root as-is for paper.)

---

### [MED] Email input and account chip drop the house focus treatment — 1px border-color change only

`apps/web/app/routes/login.tsx:128`, `apps/web/app/root.tsx:131`

Both set `outline-none` and rely solely on `focus-visible:border-primary`. Every other focusable in this app uses the ring recipe — button.tsx:8, select.tsx:45, badge.tsx:8 all carry `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50` — and panel-1 spec'd exactly that for both the input and the chip. A 1px border swap (paper: #d4d5cd → #2f3a56) is thin at any contrast and is the weakest focus indicator in the app; it also makes ThemeSelect (ring) and the chip (no ring) visibly inconsistent as adjacent siblings.

**Fix** — on the input (login.tsx:128) and the chip trigger (root.tsx:131), replace `focus-visible:border-primary` with:

```
focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
```

`--ring` is themed (blue/gold/teal/gold) so the accent appears exactly on keyboard focus, per panel-1's chip rationale. The two raw `<button>`s in login.tsx (:99, :134) and the two button-styled Links in auth.confirm.tsx don't set `outline-none`, so they keep the UA focus outline — acceptable, but adding the same ring classes there makes focus consistent for ~40 characters each.

---

### [MED] Home "Sign in" link target is 32px tall, not 44px

`apps/web/app/routes/home.tsx:70`

`-m-2 p-2` on `text-xs` = 16px line-height + 8px×2 padding = **32px** computed target. The trick is right, the inset is too small.

**Fix** (keeps the baseline alignment — flex `items-baseline` aligns text baselines regardless of the symmetric negative margin, and the transparent padding paints into the header's whitespace):

```
-mx-2 -my-3.5 px-2 py-3.5
```

16 + 14×2 = 44px. Width is already comfortable. Baseline with the "Lumen" eyebrow verified fine: both are in the `flex items-baseline justify-between` row (home.tsx:61) and padding does not move the first baseline used for alignment.

---

### [MED] A failed resend (429) throws the user out of the success state back to the bare form

`apps/web/app/routes/login.tsx:33-47` + `:87-111`

Resend posts the same action; on rate-limit the action returns `{ sent: false, error }` → `sent` flips false → the entire "Check your email" block unmounts and the email form reappears with the error in the slot. But the **previous link is still valid** (a failed resend supersedes nothing) — the user just lost the "check your email / only the newest works" context and is staring at an input inviting a third send.

**Fix** — mark the resend and keep the success frame on resend failure:

1. Add `<input type="hidden" name="intent" value="resend" />` to the resend Form (login.tsx:97).
2. In the action's error branch: `const resend = form.get("intent") === "resend"; return data({ sent: resend, email, error: ... }, { headers })` — sent stays true for a failed resend.
3. In the success block, render the error in a reserved slot under the resend button (inside the existing `aria-live="polite"` div, so it announces):
   `<p className="mt-2 min-h-6 font-ui text-sm text-destructive">{actionData.error ?? ""}</p>`

---

### [LOW] Rate-limit error copy wraps to two lines — the min-h-6 slot shifts the submit button anyway

`apps/web/app/routes/login.tsx:42,131`

"The mailer only sends about two emails an hour and it's at its limit. Try again a little later." is ~95 chars; at `max-w-md` minus `px-6` (~400px) in 14px Archivo it wraps to two lines (~40px) against a 24px reserved slot — the button drops ~16px exactly when D10 promised zero CLS. The validation error and generic error fit one line.

**Fix**: tighten to one line — `"Email limit reached — about two an hour. Try again later."` — or accept the shift for the rare 429 and note it. (Tone stays honest per D10; panel-2 already cut the anthropomorphic version, and "the mailer... it's at its limit" is fine.)

---

### [LOW] Resend success is silent for screen readers

`apps/web/app/routes/login.tsx:86-109`

The `aria-live="polite"` container is correctly pre-mounted (the div renders unconditionally; content is `{sent ? ... : null}` inside it — checklist item 2 verified). But a successful resend produces byte-identical content — no mutation, no announcement. Sighted users get the cooldown restart (once the HIGH fix lands); SR users get nothing.

**Fix**: derive a resend count or timestamp from the action (`ts: Date.now()` in the payload) and render `{isResend && <span className="sr-only">Link sent again.</span>}` inside the live region.

Also confirmed for the record: the error path is a separate always-mounted `<p role="alert">` (login.tsx:131) whose text swaps from `""` to the message — `role="alert"` is an implicit assertive live region and the node pre-exists, so error announcements work. The success/error split across two live regions is the right pattern; no change needed there.

---

### [LOW] Email input missing `aria-invalid` / `aria-describedby`

`apps/web/app/routes/login.tsx:119-133`

Panel-1's field spec wired `aria-invalid={!!error}` + `aria-describedby="email-error"`. The implementation relies on `role="alert"` alone — announcement works, but a SR user tabbing back to the field gets no "invalid" state and no association with the message.

**Fix**: `id="email-error"` on the error `<p>`; on the input: `aria-invalid={Boolean(actionData?.error && !sent) || undefined} aria-describedby={actionData?.error ? "email-error" : undefined}`.

---

### [LOW] Chip menu: email truncates at ~120px, no title fallback; Sign out row is 28px tall

`apps/web/app/root.tsx:135-150`, `apps/web/app/components/ui/dropdown-menu.tsx:46`

`DropdownMenuContent` sets `w-(--radix-dropdown-menu-trigger-width) min-w-32` — the trigger is a 28px disc, so the menu clamps to exactly 128px and the `max-w-56` on the label never engages; any email over ~18 chars truncates with no way to read it (panel-1 asked for `title={email}`). The Sign out item is stock `py-1` ≈ 28px tall — panel-1 asked for ~40px on touch.

**Fix**: on `DropdownMenuContent` add `min-w-48` to the className (root.tsx:135); add `title={email}` to the `DropdownMenuLabel` (root.tsx:136); add `py-2` to the Sign out `DropdownMenuItem` (root.tsx:146).

---

### [LOW] Interstitial: "One tap to confirm it's you." + no initial focus on the primary action

`apps/web/app/routes/auth.confirm.tsx:113-127`

- Copy: "One tap" assumes touch and is the chattiest line in the flow; on desktop it's a click. Suggest **"Confirm below to finish signing in."** — same brevity, device-neutral, matches the app's plain editorial register. (All other strings across the three routes pass the tone check: "That link didn't work", "You're already signed in", "Continue reading", the expired/wrong-browser explanations, and the login privacy line are honest and calm; the panel-2-cut "catching its breath" copy is confirmed gone.)
- Focus (checklist item 5 position): **add `autoFocus` to the "Continue to sign in" button.** This is a fresh document load onto a single-purpose page whose content fits above the fold — there is no scroll-jack and no reduced-motion concern; the user arrived from an email with exactly one thing to do, and Enter-to-continue is the whole keyboard flow. The page `<title>` ("Sign in — Lumen") gives SR users context before focus lands. Do not autofocus on the `already`/`error` branches (those are reading states, and the error branch's action is a Link).

---

### [NOTE] Adjacent 44px hit areas overlap by 8px at the cluster seam — acceptable, recorded

`apps/web/app/root.tsx:131` + `:71`: chip and ThemeSelect both use `after:-inset-2` with `gap-2` between them, so their expanded hit boxes meet/overlap in the 8px gap (later sibling wins hit-testing there). Effective exclusive target is ~40px each at the seam. Within tolerance for two 28px visual controls; widen to `gap-3` only if mis-taps are ever observed. No change requested.

---

## D10 compliance summary (checklist item 2)

- Input `h-11` + `text-base` + `autoComplete="email"` + `autoCapitalize="none"`: **pass** (login.tsx:119-128)
- Reserved `min-h-6` error slot: **pass** structurally; see LOW re: two-line 429 copy
- Pre-mounted aria-live: **pass** — container is unconditional, success conditional inside it; error path uses a separate pre-mounted `role="alert"` — correct
- Success replaces form, shows email + "open it in this browser" + newest-email warning + privacy line: **pass**
- 60s resend guard: **fails after first resend** (HIGH #1)
- Chip left of ThemeSelect, `size-7` visual + 44px hit area, ThemeSelect target fixed in passing: **pass** (root.tsx:160-163, :71)
- Email as `DropdownMenuLabel`, sign-out via POST with returnTo: **pass** (root.tsx:136-151), but see HIGH #2 (select-close race) and LOW (truncation/row height)
- Home-only sign-in invitation, static in header: **pass** (home.tsx:67-74), but target is 32px (MED)

## Ink-theme sweep (checklist item 8)

`bg-primary` #a9bcf0 / `text-primary-foreground` #17181c: strong contrast, passes. Chip `bg-panel2` #26282e + `border-rule2` #43464e on #17181c: quiet but legible, matches panel-1's projection. `shadow-sm` is invisible in ink — harmless. The one real ink break is `text-destructive` (MED above).
