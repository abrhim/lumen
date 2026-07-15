# Bugs — user-roles (step 11 filter)

Source: code-panel (security, correctness, ux-a11y) + code-adversarial (A tagged
security+correctness, B attacked the client). Deduped; the ≥2-reviewer rule
applies post-dedup. Adversarial-A independently reproduced B1/B2/B3 before
reading the panel files. Adversarial-A's one severity correction is honored:
SECURITY-4's *fix* ("redirect before getClaims") is `risky` — it reintroduces
the F3 dropped-rotation bug — so B9 takes CORRECTNESS-7's disposition instead.

## Confirmed bugs

### B1: prototype-chain allow-list bypass (`in` walks the prototype)
- Severity: high
- Categories: security, correctness
- Source: SECURITY-1 + CORRECTNESS-2 (+ adversarial-A material, reproduced)
- Raised_by: [code-panel/security, code-panel/correctness, code-adversarial/A]
- Description: `sort in SORTS`, `statusRaw in STATUSES`, `c.s in SORTS` walk the
  prototype chain. `?sort=toString` → `SORTS["toString"]` = `Object.prototype
  .toString`, `S.col` undefined → `ORDER BY u.undefined DESC` → Postgres 500.
  `?status=constructor` → `WHERE u.function Object(){…} = true`. Admin-gated
  (post-`requireEntitlement`), so it's an admin-triggerable crash not a text
  injection — but it falsifies the stated, unit-"tested" invariant "the
  allow-list is total" (D6).
- Repro test: admin.users.test.ts — `?sort=toString`/`__proto__` → default sort,
  no throw; the totality test gets a prototype key.
- Fix: `Object.hasOwn` at all three sites; guard `const S = SORTS[sort]`.

### B2: keyset cursor loses microseconds → skips/dupes across ties
- Severity: high
- Categories: correctness (keyset-pagination)
- Source: CORRECTNESS-1 (+ adversarial-A material, "strongest finding")
- Raised_by: [code-panel/correctness, code-adversarial/A]
- Description: cursor `k` minted via `new Date(...).toISOString()`; postgres.js
  parses timestamptz to a ms JS Date, but `auth.users.created_at` (via `now()`)
  carries microseconds. Cursor `k` < the boundary row's true value → desc pages
  SKIP every row sharing the boundary timestamp (bulk-created users share one
  `now()` — the exact tie the `(col,id)` keyset exists for); asc pages
  RE-INCLUDE the boundary + ties (dup rows, dup React keys). Violates H4's
  "no dupes, no skips across ties". The H4 test *pinned* the lossy behavior
  (whole-day fixtures + `toISOString` expectation).
- Repro test: micros fixtures (`…123456+00`) with a shared-timestamp tie →
  no skip desc, no dupe asc.
- Fix: project the sort column as full-precision text in the page SELECT
  (`u.created_at::text AS created_at_key`), mint `k` from that string; the
  existing `${k}::timestamptz` bound-param compare parses it losslessly.

### B3: forged/garbage cursor values reach `::timestamptz`/`::uuid` → uncaught 500
- Severity: med
- Categories: security (cursor-robustness), correctness
- Source: SECURITY-2 (+ adversarial-A material, reproduced)
- Raised_by: [code-panel/security, code-adversarial/A]
- Description: `decodeCursor` checks only `typeof k/id === "string"`, so a
  valid-shaped cursor with `k:"x", id:"y"` passes; on the default timestamptz
  sort those feed `'x'::timestamptz`/`'y'::uuid` → cast error → uncaught throw.
  Violates D6 "bad → page-1-never-throws". (The H4b test even asserted the
  garbage cursor decodes non-null.)
- Repro test: valid-shape/invalid-value cursor → page 1, no throw.
- Fix: validate values in `decodeCursor` — ISO-parseable `k` for timestamptz
  sorts, UUID-shaped `id` — return null (→ page 1) on mismatch.

### B4: epoch race-guard defeated by retained `fetcher.data` on an epoch round-trip
- Severity: high
- Categories: correctness (client race)
- Source: CORRECTNESS-3 + ADVB-1
- Raised_by: [code-panel/correctness, code-adversarial/B]
- Description: the guard keys on filter identity, not pagination-session
  identity, and `fetcher.data` persists. Page to N under epoch A → change a
  filter (epoch B) → change back (epoch A, byte-identical): reset effect clears
  the tail, then the append effect re-fires (epoch dep changed), sees the
  retained page-N data with a now-matching epoch, and re-appends it → page 1 + N
  with the middle silently missing; cursor regresses. Two clicks on a sort
  header reproduce it.
- Repro test: pure-logic test of the once-only consumption guard.
- Fix: per-generation request marker (`useRef`) — loadMore sets it before
  `fetcher.load`, reset nulls it, append early-returns when null and nulls it
  after consuming.

### B5: pending-state watches the wrong state machine → SWR spec is dead code
- Severity: high
- Categories: ux, accessibility
- Source: UX-A11Y-1 + ADVB-3
- Raised_by: [code-panel/ux-a11y, code-adversarial/B]
- Description: `loading = fetcher.state !== "idle"` tracks only load-more, but
  search/filter/sort go through `useSubmit` navigations → no "Searching…", no
  `aria-busy`, no dim, no skeletons during the primary path; the `"Searching…"`
  branch is unreachable. Load-more meanwhile marks the whole already-read region
  `aria-busy` and hides the signal behind `motion-safe:`. The incorporated
  admin-ux SWR HIGH (plan D9) shipped in name only.
- Fix: derive search-pending from `useNavigation()`; drive count-bar/aria-busy/
  dim/skeletons from that; un-gate the opacity (state signal, not motion).

### B6: a failed cursor-page fetch nukes the whole admin view via the root boundary
- Severity: high
- Categories: correctness, ux (error-handling)
- Source: UX-A11Y-2 + CORRECTNESS-9 + ADVB-2 (three reviewers)
- Raised_by: [code-panel/ux-a11y, code-panel/correctness, code-adversarial/B]
- Description: the IntersectionObserver auto-fires `fetcher.load`; a transient
  500/network blip (or a mid-session revocation 404) throws, and with no route
  ErrorBoundary (deliberate for D10) it bubbles to root → the whole page (rows,
  filters, scroll) is replaced by "Oops!", no retry, on zero user action.
- Fix: route ErrorBoundary that re-throws `isRouteErrorResponse && 404` to root
  (preserving D10 concealment byte-identically) and renders an inline
  "Couldn't load — retry" tail for other errors.

### B7: grant-role fails OPEN on a `--dry-run` typo
- Severity: med  (safety carve-out: privileged grant path — not downgradable)
- Categories: correctness, security
- Source: CORRECTNESS-6
- Raised_by: [code-panel/correctness]
- Description: `parseArgs` strips every `--*` token and recognizes only exact
  `--dry-run`; `--dryrun`/`--dry_run` silently drop → `dryRun` false → a REAL
  committed grant when a rehearsal was intended. The one silent fail-open in an
  otherwise refuse-loudly script (D5/H6b).
- Repro test: unknown flag → `{error}` / exit 1.
- Fix: reject any `--*` token other than `--dry-run` in `parseArgs`.

### B8: migration re-run silently REVERTS a future-expanded admin entitlement set
- Severity: med  (safety carve-out: authz data, silent-closed — not downgradable)
- Categories: correctness, data-integrity
- Source: ADVA-1
- Raised_by: [code-adversarial/A]
- Description: the seed uses `ON CONFLICT (slug) DO UPDATE SET entitlements =
  EXCLUDED.entitlements`, so a re-run of the "idempotent" migration reverts
  `lumen.roles.admin.entitlements` to today's `['admin.users']`. The day a
  future feature adds a second entitlement to admin, a re-run clobbers it and
  admins silently 404 off the newer surface — the exact silent-closed failure
  D5 exists to prevent — while `admin_role_seeded` asserts the stale list green.
- Fix: make the seed insert-only for entitlements (`ON CONFLICT DO NOTHING`, or
  merge/union), keep the invariant in lockstep, pin the choice with a comment.

### B9: F3 alias 301 + root both refresh the same token in parallel (double-refresh)
- Severity: med
- Categories: security, correctness (auth-seam)
- Source: SECURITY-4 + CORRECTNESS-7  (adversarial-A: SECURITY-4's *fix* is risky)
- Raised_by: [code-panel/security, code-panel/correctness]
- Description: on an alias URL the root loader and the alias loader both run
  `getSessionUser`, each calling `getClaims` with the same refresh token; on an
  expired access token both attempt an inline refresh. Verified BENIGN under
  gotrue's default 10s reuse interval (both get the same new session), FRAGILE
  under config drift (a zeroed reuse interval could revoke). Only the alias's
  rotated cookie rides the 301 (root's dropped by design).
- Disposition (CORRECTNESS-7, not SECURITY-4): do NOT hoist the redirect above
  getClaims — that reintroduces the F3 dropped-rotation bug. Instead document
  the reuse-interval dependency next to the F3 comments, and memoize the session
  read per request so root and route share one getClaims/refresh.

## Needs investigation → resolved inline
- SECURITY-3 (cursor-carrying 301 lacks Cache-Control): confirmed latent
  (Cloudflare won't cache worker responses bearing Set-Cookie by default; 301
  browser caches are per-profile). Cheap defensive fix taken with B9's pass:
  `Cache-Control: private, no-store` on the auth-carrying alias 301s.

## Preference / low — FIXED in the client pass (not repro-gated; node suite can't render)
- CORRECTNESS-8: `displayName` returned "" for anonymous (email is COALESCE'd '')
  → `||` chain. ✅
- CORRECTNESS-4 / ADVB-6: `setQInput(q)` clobbered in-flight typing → sync only
  while the field is unfocused. ✅
- ADVA-2: a filter/sort click within the debounce window dropped the typed query
  → immediate submits carry the live `qInput`. ✅
- UX-A11Y-7 / ADVB-7: `replace:true` everywhere broke Back → `replace:!immediate`. ✅
- UX-A11Y-9: empty-state heading keyed on `q` only → keys on `q`/filters/none. ✅
- UX-A11Y-3: sub-44px touch targets → `after:` overlays on the h-7 selects (−inset-2),
  chip-remove (−inset-3.5), clear-search (−inset-2), header buttons (−inset-y-3). ✅
- UX-A11Y-5 / ADVB-5: `disabled={loading}` stole focus → `aria-disabled` (loadMore
  already guards re-entrancy). ✅  (auto-focus-to-end-on-exhaustion NOT done —
  risked stealing focus on filter-driven cursor changes; left as-is.)
- UX-A11Y-4 / ADVB-9: mobile sort direction unreachable → select value encodes
  `${sort}-${dir}`, six entries. ✅
- UX-A11Y-10: skeleton pulsed under reduced-motion → `motion-reduce:animate-none`
  on the Skeleton primitive (fixes every consumer). ✅
- ADVB-4: rapid filter flips lost updates → `submitParams` bases off the pending
  navigation location. ✅
- ADVB-8: debounce timer survived a POP nav → cleanup keyed on `location.key`. ✅
- CORRECTNESS-5: IO could pair an old cursor with a new filter set mid-commit →
  `loadMore` no-ops while a navigation is pending. ✅

## D10 concealment — reality after live smoke test (D10 over-claimed)
Post-deploy `curl` diff of anon `/admin/users` (404) vs a nonexistent route (404):
the bodies are NOT byte-identical. A matched-but-gated route inherently leaks its
existence in an SSR app via (a) the preloaded `admin.users-*.js` chunk, (b) the
embedded RR route-manifest entry (`routes/admin.users`, hasLoader/hasErrorBoundary),
and (c) the 404 message text (gate: "…could not be found"; RR no-match: "No route
matches URL …"). This is PRE-EXISTING (RR pulls the matched route's module into the
document before the loader throws) — the B6 re-throw still reduced the diff (no root
chrome wrapping the 404) but byte-identical was never reachable here. **Security
boundary is intact: 404, no data, no PII query.** D10's "renders IDENTICALLY to a
nonexistent route" is downgraded to: status + no-data-leak hold; route existence is
observable and accepted as low-severity (the gate, not obscurity, is the boundary).
Retro signal: concealment claims must be smoke-tested against a real deploy.

## Deferred (needs visual iteration; can't be done/verified blind)
- UX-A11Y-6 (med): sticky `<thead>` sits under the fixed top-right chrome (z-40)
  at ≤~1280px, click-blocking the "Last seen" sort button when scrolled. Every
  candidate fix (top-offset the thead, right-inset the table) trades one visual
  artifact for another and needs to be seen at real widths. Tracked as a
  follow-up; the header is still keyboard-operable (Tab reaches it), so this is
  a pointer-occlusion issue at specific widths, not a total loss of function.
- SECURITY-6 (low): `scrub()` redaction is a narrow URL-shape allowlist. No known
  postgres.js emitter for the bare `user:pass@host` shape and the DSN is
  `postgresql://…`; the CR-7 greedy-`@` fix already covers the real path. Left.

## Out-of-scope / rejected
- SECURITY-4's lead fix (redirect-before-getClaims): REJECTED — reintroduces F3.
- SECURITY-6 (scrub redaction is a narrow URL-shape allowlist): speculative, no
  known postgres.js emitter for the bare-`user:pass@host` shape and the DSN is
  `postgresql://…`; capture. (Cheap regex broadening taken anyway, harmless.)

## Fix-verification round (6 adversarial verifiers, one per cluster)
B1, B2, B4 → **fix-holds** (each independently reproduced the original bug, then
confirmed the fix closes it with no regression). Three fixes had a residual the
verifier caught — all now closed:
- **B3 fix-incomplete → fixed.** TIMESTAMPTZ_RE checks digit *shape*, not value
  ranges, so `2026-13-45 00:00:00` (month 13) passed the regex but 500s at the
  `::timestamptz` cast. JS can't validate it (Date.parse both accepts Feb 30 AND
  rejects legit Postgres `+00`/µs forms). Closed with a query-level fallback in
  loadUsersPage scoped to the cast SQLSTATEs (22007/22008/22P02): a cast failure
  on a cursor page degrades to page 1; a real DB fault (e.g. 08006) still
  surfaces (so a fetcher never silently duplicates page 1). +2 tests.
- **B6 fix-broke-something → fixed.** Rendering the 404 markup *inline* left
  root's fixed chrome (`fixed right-4 top-4 z-40` AccountChip/ThemeSelect)
  wrapping the admin 404, while a genuine no-match 404 replaces `<App>` entirely
  — so the two 404 documents were structurally distinguishable (D10 defeated,
  server-observable via curl). Closed: the ErrorBoundary now RE-THROWS a 404 so
  it bubbles to root and replaces `<App>`; only non-404s render the local reload
  UI. **Live post-deploy smoke:** anon `/admin/users` now renders the bare root
  404 with the chrome/AccountChip GONE (leak count 0). The two 404 bodies are
  still not byte-identical (RR echoes the URL in the no-match message and
  preloads this route's module because the path matched) — but neither reveals
  admin state, and the route table already ships in the public client manifest,
  so existence was never concealable; consistent with D10's accepted "the gate
  is the real control." The PII/chrome leak (the real bug) is closed.
- **B7 fix-incomplete → fixed.** The unknown-flag guard only caught `--`-prefixed
  tokens, so `-dry-run` (single dash) and `dry-run`/`dryrun` (no dash) slipped
  through as ignored positionals → real grant. Closed: reject any leading-dash
  token ≠ `--dry-run` AND any extra positional; same guard added to the migration
  script's arg parse. +test cases; verified live.

## Provenance histogram
| Origin | Count | Which |
|---|---|---|
| Should have been caught by plan | 1 | B6 (D10 no-boundary over-extended to background pagination) |
| Should have been caught by harness | 5 | B1, B2, B3, B5, B7 (stated invariants whose tests didn't actually exercise the failing input — B2's test even pinned the bug) |
| Should have been caught by panel-1 | 0 | |
| Should have been caught by panel-2 | 0 | |
| Genuinely emergent / interaction | 3 | B4 (client epoch race), B8 (migration idempotency×future-schema), B9 (F3 fix × parallel loaders) |

Signal: the dominant origin is **harness** — the H3/H4/H4b/H6 tests asserted
shapes but not the adversarial inputs (prototype keys, µs ties, garbage cursor
values, unknown flags), and H4 actively encoded the lossy cursor as expected.
Retro lever: harness fixtures must carry the hostile input, not just the happy
shape — a "the allow-list is total" test that only tries `"evil"` proves nothing.
