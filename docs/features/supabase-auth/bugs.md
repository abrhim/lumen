# supabase-auth — bug filter (step 11)

Filter per references/bug-filter.md: confirmed-bug / preference / out-of-scope. Every finding below was independently verified by code-adversarial-A with executed evidence (no refutations); journeys-B ruled none blocks ship but the fixes are cheap and real.

## Confirmed bugs → FIX now

| id | sev | finding | fix | repro test |
|---|---|---|---|---|
| B1 | CRITICAL | `safeReturnTo` backslash open redirect — `/\evil.com` passes the guard; browsers resolve `Location: /\evil.com` to `https://evil.com/`. | Replace char-guard with resolve-and-compare-origin (adversarial-A proved the panel's "minimal" regex fix rejects legit hyphen paths — do NOT use it). | yes — extend D7 test with backslash/CR/encoded vectors |
| B2 | HIGH | Radix `DropdownMenuItem` sign-out is a no-op the moment the exit animation is removed (Presence unmounts the `<Form>` synchronously when animationName=none). Works today only by animation accident. | `onSelect={(e) => e.preventDefault()}` on the Sign out item — menu stays open through the POST; revalidation nulls user → chip unmounts. | n/a (Radix behavior; covered by not regressing the menu markup) |
| B3 | HIGH | Resend cooldown never re-arms after the first send (`sentAt.current === email` blocks reset) → 60s guard fires once, then unlimited resends against the ~2/hr mailer. | Drop the ref; re-arm on `[sent, actionData]` identity (RR returns fresh actionData per submit — verified). | yes — logic test on the effect trigger |
| B4 | MED | `/auth/confirm` action verifies a body `token_hash` with no CSRF check → cross-site auto-POST session fixation (latent; nothing gated yet per D14). | `Sec-Fetch-Site` guard (403 if cross-site) + `Origin`-compare fallback; both present on workerd. | yes — cross-site header → 403 |
| B5 | MED | `--destructive` defined only in base `:root`, never per-theme → error text ~3.5:1 in `ink` (fails AA). | Add error-text token per theme, or use an existing AA-passing token for the error copy. | n/a (visual) |
| B6 | LOW | `getSessionUser` runs `getAuthImpl()` before the try; `createServerClient` throws synchronously on empty env → every page 500s (breaks D5 never-throw). | Move construction inside try; catch builds a fresh `new Headers()` (commitHeaders undefined if construction threw). | yes — throwing factory → null, not throw |

## Preference / defer (not fixing in this feature)

- Home-only sign-in affordance (J7): ACCEPT for v1 — nothing gated; revisit at first gated feature. [D10/D14]
- Interstitial protects nothing until token_hash template edit (J1b): known, documented [D3/D13b]; not a code bug.
- Site-URL-unmet opaque failure (J2): deploy-checklist copy, not code. [D13a]
- login-CSRF only "matters" once per-user state exists — fixing B4 now anyway (cheap, correct).
- Sec-Fetch-Site vs Origin, autofocus on interstitial, aria-invalid/describedby, 429-drops-success-state: minor polish; folding the high-value subset into the fix commit, listing the rest in retro.

## Out of scope
- Double concurrent refresh (root + child loader same nav): safe under gotrue 10s reuse window; not fixing.
- RR7 header-drop on redirect short-circuit: invariant holds by convention in THIS app (redirects self-carry headers; logout is a resource route). Add a guard COMMENT + doc note, no code change.
