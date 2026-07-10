# Panel-2 adversarial review — Product, Scope & UX-failure

Reviewer: ADVERSARIAL REVIEWER B (product / scope / UX-failure skeptic).
Lens: attack over-engineering, under-engineering, and product reality in the plan + Panel-1.
Standing facts: **0 users in auth today**, single-operator app (abram@soar.com), Cloudflare Workers,
`lumen_read` is SELECT-only and cannot read `auth.users` (hence the SECURITY DEFINER bridge).

---

## Thesis (highest-impact position)

**[CUT] The durable asset is the roles/entitlements SUBSTRATE + the auth→lumen SECURITY DEFINER
bridge. The admin TABLE is a disposable consumer, and Panel-1 has gold-plated it for a table that
holds exactly one row (Abram) and will for months.** Ship the substrate at full fidelity; ship the
table as the *minimum honest read-only list*. Everything Panel-1 built to make infinite-scroll +
keyset + filter-races correct is machinery for a problem this app does not have and will not have
this year. Build the mechanism like it matters (it gates every future feature); build the screen
like what it is (a debug view only the operator sees).

**Minimum shippable admin-users view (this week, still honest):**
1. `route("admin/users")` with `requireEntitlement(auth,"admin.users")` as the **first statement** →
   `throw data(null,{status:404})`. *This is the whole security boundary and it stays.*
2. Loader: `SELECT … FROM lumen.app_users LEFT JOIN user_roles(agg) ORDER BY created_at DESC LIMIT 200`.
   No cursor. No count query. One SELECT.
3. Render an **inline** semantic `<table>` (email · name · role badges · joined · last-seen),
   non-interactive rows. Optional: a client-side filter box that narrows the ≤200 already-loaded
   rows in JS — no server round trip, no debounce, no URL sync, no live region.
4. Admin link in the existing `AccountChip`, gated on a JWT entitlement claim (Panel-1 platform-data's
   O2 answer — keep it, it's the cheap one).

That is honest up to a few hundred users. When the table actually crosses ~200 rows, the fast-follow
adds pagination (keyset, exactly as platform-data spec'd — the design is good, just premature).

---

## 1. The full data-table apparatus — [CUT]

Panel-1 spec'd, for a 1-row table: two hand-rolled primitives (`ui/input` + `ui/table`), keyset
cursor encode/decode/validate, an `IntersectionObserver` sentinel, an **epoch race-guard** for
filter-vs-in-flight-cursor collisions, debounced URL-synced server search, two `aria-live` regions,
a mobile PII card-collapse, and a virtualization deferral analysis. **Every one of these exists to
make progressive loading of thousands of rows correct.** There are zero rows but Abram's.

Drop from v1, list to fast-follow:
- **keyset cursor + `IntersectionObserver` + infinite scroll** — no data to scroll.
- **the epoch race-guard** — it exists *only* because infinite-scroll can race a filter change.
  Cut the infinite scroll and this entire class of bug (and its test H4/H5-adjacent wiring) evaporates.
- **the second `aria-live` region** ("Loaded 25 more, 75 shown") — nothing appends.
- **server-side debounced URL-synced `?q=` search + removable filter chips** — client-side filter over
  ≤200 rows is a `.filter()`. URL-synced shareable search on a single-operator hidden route is state
  ceremony for an audience of one.
- **`ui/input.tsx` + `ui/table.tsx` as reusable PRIMITIVES** — see §7. One consumer ⇒ inline it.

Keep: the 404 gate, the loader SELECT, a plain table, role badges. That's the honest core.

## 2. Substrate vs screen — is the mechanism under-designed? — [CONFIRMED-HARDER] + [NEW]

The DB shape generalizes fine: `roles.entitlements text[]`, `user_roles` M2M, `requireEntitlement`
string check. A second role slots in with one seed row. Good.

**But the substrate is proven at N=1 in every dimension** — one role (`admin`), one entitlement
(`admin.users`), one consumer (the admin route). We are shipping a *generic* mechanism whose
generality is exercised exactly once. The single thing that actually validates extensibility is
harness **H1** (multi-role entitlement union / unknown-slug contributes nothing) — that test is the
real deliverable of this feature and must not be cut. Keep it; it's worth more than the table.

**[NEW] Dual source of truth for entitlements.** Panel-1 platform-data's (correct) O2 fix stamps
`app_metadata.entitlements` into the JWT so the menu link needs no round trip. That means grants now
live in **two** places: `lumen.user_roles` (authoritative, read by the loader) **and** the JWT claim
(the hint). `grant-role.mjs` must dual-write both, and **revocation is stale until token refresh** —
a revoked admin keeps a link that then 404s (acceptable, fail-closed), but a plan that says "granting
is a single upsert" is now understating the write. Fold into the script's contract: grant/revoke
touches user_roles **and** the auth `app_metadata`; document the staleness window. This is a real
substrate wrinkle the plan hasn't absorbed.

**[NEW] No validation that an entitlement key is real.** `entitlements text[]` is free text; a typo
(`admin.user`) silently grants nothing and fails closed with no signal. Minor at N=1, but a
CHECK/enum or a known-keys constant is a cheap guardrail worth a line.

## 3. End-to-end testability — [ESCALATE]

**The feature is NOT live-verifiable today.** The chain is blocked at the root:
`0 users → nobody can complete sign-in (the Supabase auth-dashboard prereqs from the last feature are
still unset, per plan probe line 9) → Abram cannot obtain a real session → cannot grant himself admin
against a real auth.users id → cannot open the gated screen as an admin in a browser.`

So `/verify` will be hollow: the only things provable now are (a) the DI-mocked harness
(entitlements flattening, 404-before-query, cursor/search unit logic) and (b) manually seeding a fake
`auth.users` row via the admin DSN to exercise the view + query shape. **The actual gated admin
surface cannot be driven end-to-end until the auth prereqs land.** This dependency must be stated in
the plan explicitly, and the feature's "done" bar must acknowledge it ships **unverified in-browser**.
Escalating because a large-tier auth-adjacent feature whose live path is blocked behind an unfinished
prerequisite is exactly the kind of thing that gets marked SHIPPED and then breaks on first real login.
Cutting the table apparatus (§1) also *shrinks the unverifiable surface* — fewer moving parts we can't
actually watch work.

## 4. Infinite scroll on an admin tool — [CUT]

Respecting that Abram asked for it: this reads as a **default preference, not a need**. Emil is right
for the wrong-sounding reason — infinite scroll harms findability and back-button behavior, but the
real point is there is **nothing to scroll**. The honest minimum is "show all (LIMIT 200), type to
filter." Plain, greppable, back-button-correct, zero cursor machinery. Panel-1's auto-loading
"Load-more-button" is a genuinely good design — for the problem we'll have at ~1k users, not the one
we have at 1. Position: **cut it from v1**, keep platform-data's keyset spec on the shelf verbatim for
the fast-follow that adds pagination when the row count earns it. Do not build numbered/offset
pagination either — nothing to paginate.

## 5. PII / privacy — [NEW], real but not a v1 gap

The obligation (privacy policy / data-handling for real people's emails) is triggered by **collecting**
PII, not by building an internal single-operator viewer — so building the admin list does not by itself
create a new duty. An **audit trail of admin views** (who looked at the user list) is premature at
single-operator: it would log Abram looking at Abram. Correctly deferred. **But flag for the roadmap:**
the day a *second human* can be granted admin, an admin viewing everyone's PII wants a view-log, and a
public app collecting emails wants a stated retention/deletion story. Not a v1 hole; a dated future
obligation the plan should name so it isn't forgotten.

## 6. Scope cuts that will bite — mostly [ACCEPT], one [CONFIRMED-HARDER]

- **No per-user detail page (row → nothing):** [ACCEPT]. Panel-1 already made rows non-interactive —
  correct; a 56px target that goes nowhere is worse than an inert row. Deferred rightly.
- **No in-app grant/revoke (SSH+script forever):** [CONFIRMED-HARDER]. This is the cut that bites
  *soonest* — the first time Abram wants to make a real user (a helper) admin, he's on his laptop
  running a script. Fine for a solo operator today; a genuine future hole, not a v1 one. Name it.
- **No way to see who's admin except the roles column:** [ACCEPT]. The roles column *is* the answer;
  at 1 user it's trivial. (Note: if §1 also cuts the role filter, "who's admin" becomes a scan — still
  fine at this scale.) Non-issue for v1.

None of the three is a v1 hole. All correctly deferred; in-app grant is the one to schedule next.

## 7. Panel-1 over-build to cut this week — [CUT]

- **Two new UI primitives.** [CUT the primitive framing.] `ui/input.tsx` and `ui/table.tsx` as
  reusable, exported components is YAGNI at one consumer. Inline the `<input>` and `<table>` in
  `admin.users.tsx`. Extract to `ui/` later *when a second route needs them* — that's when you'll know
  the right API. Building the primitive first is designing an abstraction from a sample size of one.
- **Mobile PII card-collapse.** [CUT for v1.] The operator is on a desktop; `overflow-x-auto` is
  acceptable for an audience of one. Defer the card layout to whenever a non-operator uses the screen
  on a phone (which is also when in-app grant and audit-log arrive — bundle them).
- **Virtualization deferral analysis.** [ACCEPT the conclusion, note the ceremony.] Panel-1's answer
  (skip windowing) is correct; the multi-paragraph justification is more analysis than a 0-user
  decision needed. Keep the one-line tripwire comment, drop the essay.
- **Two `aria-live` regions.** [CUT one.] With no infinite scroll there is nothing to announce on
  append; keep at most the single result-count `role="status"` (and even that is optional over a
  static ≤200-row list). Accessibility of a hidden operator-only route should be right-sized, not
  maximal.

---

## What survives at full fidelity (do NOT cut)

- `lumen.roles` / `lumen.user_roles` / `lumen.app_users` SECURITY DEFINER bridge (the substrate).
- `requireEntitlement` + 404-not-403 gate as the loader's first statement (the real boundary).
- `grant-role.mjs` — **expanded** to dual-write user_roles + JWT `app_metadata`, dry-run capable.
- Harness **H1/H2** (entitlement union; fail-CLOSED on degraded roles-load) — the feature's actual proof.
- The JWT-claim O2 answer from platform-data (cheap Admin-link gating, no per-nav round trip).

Everything else in Panel-1 is a well-designed solution to a load problem that arrives, at the earliest,
next year — and should be lifted verbatim from these reviews when it does.
