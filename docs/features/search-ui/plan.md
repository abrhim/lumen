# Plan — search-ui

## Tier
**large** — risk axes tripped: public surface (new `/search` route + global modal + additive `/api/search` cursor contract), behavior change (net-new user-facing flow), cross-system blast radius (`searchAll` signature addition in `@lumen/scripture`, Ring-2-consumed package), ≥300 lines net-new. Justification: contract change on a shipped public endpoint plus a new primary UI surface.

## Goal
Give the deployed `/api/search` its first consumer: a `/search` page in the reader's own typographic language (per the approved interactive proposal), reachable from a global modal + hotkeys, with scope faceting (click-to-exclude), adaptive per-group density, and single-scope keyset pagination.

## Prior-learnings surfaced (step-2 REQUIRED reading — carried into Panel-1 brief)
- **A6 (search-endpoint plan): moment ids are RESPONSE-SCOPED** — UI must deep-link moments via `payload.episode_id + t_start_s`, NEVER `result.id`. A UI that keys React lists on moment id across pagination appends must tolerate re-keys.
- **tsc -b false-greens on stale cache** — all verification gates use `tsc -b --force`.
- **Harness-origin bugs are the top provenance class (2 features running)** — endpoint/route mocks must be `satisfies`-typed against real response types so drift breaks typecheck; pin `meta.mode`.
- **CPERF-6 lesson (open on media):** loaders must pin their query counts — the `/search` loader gets a bounded-query harness assertion from day one.
- **Version-bumped keys need same-commit test pins** — cursor format version byte gets a pinned decode test.
- **Fix the MODE not the example; fatal-without-return class sweeps** — carried to step 13.
- **Dev-server PG pool leak** — e2e smokes kill ALL listeners after.
- **Competitor (Scripture Notes deep-dive, 2026-07-21):** their researcher loop (search → cull → collect → synthesize) is the future personal-notes journey, NOT this feature; their failure mode is research-tool-first UX that bounces light users. This page stays reader-first: typographic results, zero workspace chrome. The scope-exclude gesture is the only "cull" affordance we ship now.

## Scope
- **In:**
  - `/search` route (SSR: loader calls `searchAll` directly on the worker; URL-driven `?q&scope`; `Cache-Control: private, no-store` — session-varying, house SECURITY-3).
  - Result renderers for all 7 groups per the approved mockup: Fraunces sentence-case section headers with per-type stroke icons, reader-idiom rows, transcript-idiom moments (timestamp deep-links), `⟪⟫` → selbar-underline marks, art thumbnails, words with original script.
  - Reference short-circuit block; zero state; skeleton only after 300 ms.
  - Global entry: search orb beside AppMenu; `/` and `⌘K` hotkeys app-wide; minimal modal (input only, Enter → navigate `/search?q=`, Escape closes; on `/search` itself hotkeys focus the inline input, never stack the modal).
  - Faceting: scope-line click = toggle-exclude (struck+faint rendering, URL `?scope=` persistence); a **floor of ≥1 included group** — the last group cannot be excluded (Δ CU-3/ACU-2: exclude-all yields `scope=` which 400s); restore-all affordance appears when ≥2 excluded (Δ UU-3 spirit, kept minimal); "More in X →" pill = isolate to that group, shown only when the group is truncated (`results.length === limitPerGroup` / `nextCursor` present — Δ UU-1); adaptive `limit`: 5–7 groups→8, 3–4→12, 2→18, 1→25.
  - Single-scope keyset pagination: optional `after` cursor on `/api/search` + `searchAll` — opaque base64url of **`v1|qhash|tier|sub|score|id`** (Δ CU-1/ACU-1/PU-1: `sub` is part of the shipped ORDER BY — the jst/moment demotion key; a 3-column cursor live-provably drops the whole sub=1 partition). `score` encodes **bit-exact float64** (Δ CU-5: live 10-way score ties make the tiebreak precision-dependent). `after` param length-capped at validation (Δ SU-3); decode is pure comparison math, never a DB lookup (Δ SU-2 doctrine); keyset predicate composes INSIDE each leg's collection-gated WHERE, visibility re-derived per request never from cursor state (Δ SU-1). Valid only when `scope` is exactly one group (else 400 `cursor_scope`); garbage/tampered → 400 `cursor_invalid` (raw value never echoed); q/scope mismatch → 400 `cursor_mismatch`; group gains `nextCursor` only when the page is full (Δ UU-1). Pagination fetches always carry an explicit `limit=` re-derived from adaptive density (Δ CU-7). Appended pages client-dedupe moments on `(episode_id, t_start_s)` — M3 re-windows re-key moment ids as a recurring class (Δ CU-4). Infinite scroll via sentinel + an explicit "More" button fallback (reduced-motion / keyboard / no-JS-observer path).
  - Input model (Δ CU-8/UU-4/OU-2): the `/search` inline input **live-updates via a debounced (350 ms) `useFetcher` to `/api/search`**; Enter, scope clicks, and More/pagination **commit URL navigations** (SSR path). Each surface logs its own requests once — fetcher hits log via the API route, navigations via the page loader's shared helper (Δ OU-6). In-flight fetcher results are discarded on navigation commit. Sub-`Q_MIN` input shows a quiet "keep typing" state and issues no request — the loader shares the API's q validation (Δ UU-9; the shared-validator refactor per CU-6).
  - Empty `/search` (no q) is a designed state, not a dead end (Δ UU-2): Newsreader prose invitation + a handful of static starting-point queries; pinned in harness, distinct from the zero-results state.
  - Mobile (Δ UU-5/UU-6/UU-7): the modal mount-gates to the house bottom-Sheet idiom under `isMobile`; scope-line toggles get the AppMenu `after:-inset` 44 px touch pattern; the hotkey hint is hidden on touch viewports and the `↑↓` portion appears only once rows exist.
  - Accessibility (Δ AU-1..AU-6): mark underline meets ≥3:1 contrast on all four themes (raise alpha/solid per-theme values, contrast-checked pins); keyboard selection is real roving focus (`row.focus()`, `tabindex=-1`), not CSS-only aria-current; SearchModal builds on the house Radix Dialog with focus-trap + return-focus pinned and `motion-safe:` animation variants; ONE small status live-region (house D9 idiom) announces counts/append deltas — the result list itself is never aria-live; scope toggles are `button[aria-pressed]` with visually-hidden state text.
  - Rendering safety (Δ SU-5): `parseMarks` segments map to JSX children only — `dangerouslySetInnerHTML` is banned in the results renderer and a render-level test asserts marker glyphs never appear as markup.
  - Failure isolation (Δ BRRU-2/BRRU-3): `routes/search.tsx` exports its own `ErrorBoundary` (recovers inline, chrome survives); the orb+modal mount in root is wrapped in a local boundary degrading to "just the orb".
  - Observability (Δ OU-1): `search_executed` gains `after`-depth (`page` or `hasCursor`) so pagination continuations are excluded from zero-result denominators; cursor-rejection 400s stay unlogged per ratified decision 10 (OU-5 rejected).
  - Keyboard nav: `↑↓` row selection (reader `bg-sel` idiom), Enter opens, selection survives pagination appends.
- **Out (deliberate, do not review against):** recent-searches / history, search analytics UI, semantic search, rate limiting / abuse hardening, MCP server changes, in-episode transcript search, admin surfaces, changes to ranking/snippets, the caps-tracked "Lumen · Search" kicker question (parked by human), dropping the per-row type word (parked).

## Files touched
- `packages/scripture/src/search.ts` (edit — cursor encode/decode + keyset predicate on single-group path; `nextCursor` in group meta)
- `packages/scripture/src/__tests__/search-harness.test.ts` (edit — cursor pins, live)
- `apps/web/app/routes/api.search.tsx` (edit — `after` param validation + passthrough, new 400 codes)
- `apps/web/app/routes/__tests__/api-search.test.ts` (edit)
- `apps/web/app/routes/search.tsx` (new — page: loader + renderers)
- `apps/web/app/routes/__tests__/search.loader.test.ts` (new)
- `apps/web/app/components/SearchModal.tsx` (new) + `apps/web/app/components/search-hotkeys.tsx` or root.tsx wiring (edit)
- `apps/web/app/routes.ts` (edit — `search` above the `:type/:id` catch-all, own line)
- `apps/web/app/root.tsx` (edit — orb next to AppMenu, modal mount)

## Public contract
- `GET /search?q&scope` — HTML, private/no-store.
- `GET /api/search` gains optional `after` (single-scope only). New stable error codes: `cursor_scope`, `cursor_invalid`, `cursor_mismatch`. Group object gains optional `nextCursor` (additive; absent on last page).
- `searchAll(opts)` gains optional `after`; `SearchGroup` gains optional `nextCursor`. Additive for Ring-2.

## Failure modes (each gets a harness assertion)
- F1 cursor page-2 continues exactly after page-1 under `(tier, score DESC, id)` — no duplicate, no gap (live DB, verse group, common word).
- F2 `after` with 0 or 2+ scope groups → 400 `cursor_scope`.
- F3 garbage / truncated / bit-flipped cursor → 400 `cursor_invalid`, never 500, never echoed raw.
- F4 cursor minted for different q (or scope) → 400 `cursor_mismatch`.
- F5 last page yields no `nextCursor`; empty page never yields one.
- F6 `/search` loader SSRs groups (no client fetch for first paint), sets private/no-store, bounded query count (CPERF-guard), logs `search_executed` exactly once per request (no double-log with the API route).
- F7 scope exclusion round-trips the URL and survives a subsequent query edit.
- F8 adaptive limit mapping pinned (7→8, 4→12, 2→18, 1→25).
- F9 modal: `/` and `⌘K` open anywhere; Enter navigates with URL-encoded q; Escape closes; typing `/` inside any input does NOT hijack; on `/search` hotkeys focus inline input, no modal.
- F10 moment rows deep-link via payload (`media/:id?t=`), never `result.id`; React keys tolerate id churn on append.
- F11 keyboard selection survives a pagination append (no reset to top, no double-selection).
- F12 `⟪⟫` markers never render literally (parse to styled `<mark>`; unbalanced markers degrade to plain text).
- F13 reference short-circuit renders the reference block, no groups, second Enter navigates to reader.
- F14 route registration stays above `:type/:id` (pin from user-roles precedent).
- F15 cursor crosses a `sub` boundary without gap or dup (live: q whose page-1 fills with sub=0 while sub=1 rows outscore the boundary — the CU-1 probe class); F1's no-gap oracle is an INDEPENDENT raw-SQL fetch, not a searchAll refetch (Δ PU-3/BRRU-1).
- F16 cursor minted under wider visibility, replayed under narrower → silently re-gated, zero hidden-row leak, no distinct error (Δ SU-1/SU-2).
- F17 `Cache-Control: private, no-store` asserted on EVERY loader exit branch — success, empty, reference, thrown 400/500 (Δ SU-4).
- F18 CPERF guard exercises the ENTITLED session path (real getEntitlements + admin SELECT flow), not only mocked-anonymous (Δ PU-2/ACU-4).
- F19 empty `/search` renders the designed empty state; sub-Q_MIN input issues no search (Δ UU-2/UU-9).
- F20 pagination fetch URLs carry explicit `limit=` matching adaptive density (Δ CU-7); appended moments dedupe on `(episode_id, t_start_s)` (Δ CU-4).
- F21 mark renderer emits JSX text only — no `dangerouslySetInnerHTML`, marker glyphs never in markup (Δ SU-5); mark contrast ≥3:1 pinned per theme (Δ AU-1).
- F22 modal focus-trap + return-focus-on-close; roving `row.focus()` selection; single status live-region (Δ AU-2/3/4).

## Harness scope
**behavior** — harness-first **required**. Red baseline logged to `harness-initial.log` before implementation.

## Open questions (for human gate)
- Q1 cursor binding — bind to `(q, scope)` via 8-char hash inside the cursor; mismatch → 400 `cursor_mismatch`. Proposed default: yes.
- Q2 infinite scroll mechanism — IntersectionObserver sentinel + visible "More" button fallback (also serves keyboard/reduced-motion). Proposed default: both.
- Q3 modal scope memory — modal always opens scope-clean (excludes are page state, not app state). Proposed default: yes.
- Q4 `/search` loader — call `searchAll` directly (no HTTP self-call), sharing the API's validation + OBS logging helpers. Proposed default: direct.
- Q5 group order under exclusion — always GROUP_KEYS order, excluded groups struck in place (not removed from the line). Proposed default: yes.
- Q6 (Δ panel: 4-role convergence) input model — debounced (350 ms) live fetcher to `/api/search` while typing; Enter/facet/More commit URL navigations; sub-2-char input = quiet "keep typing", no request. Proposed default: yes.
- Q7 (Δ UU-2) empty `/search` content — prose invitation + static starting-point queries (no history, no personalization). Proposed default: yes.
- Q8 (Δ UU-5) mobile modal — bottom Sheet under `isMobile`, identical input semantics. Proposed default: yes.

## Decisions (synthesis ledger — every panel-1 finding; tie-break human > panel-2 > panel-1)

**security**: SU-1 incorporated (F16 + gated-WHERE doctrine in cursor bullet). SU-2 incorporated-as-doctrine (pure decode documented; panel-2's "structurally precluded" is true only if the doctrine holds — cheap to state). SU-3 dropped-as-noise (drizzle parameterization verified at search.ts:136-144; length cap kept anyway). SU-4 incorporated (F17). SU-5 incorporated (F21, JSX-only renderer). SU-6 rejected-with-rationale (panel-2 risky: suppressing ⌘K in inputs regresses the app-wide palette design and prevents nothing in a passwordless app; only bare `/` is input-suppressed).
**correctness**: CU-1 incorporated (cursor gains `sub`; F15). CU-2 incorporated (harness DSN fixed same-day, red-for-right-reason verified). CU-3 incorporated (floor-of-1). CU-4 incorporated (client dedupe on `(episode_id,t_start_s)`; version-stamp variant rejected — no durable moments-build id exists to stamp against). CU-5 incorporated (bit-exact float64 score; codec round-trip asserts score from a real tied pair). CU-6 dropped-as-noise per panel-2 but the shared-validator refactor ships via UU-9. CU-7 incorporated (F20). CU-8 dropped-as-noise (RR navigation serialization precludes the race) — but the input-model ambiguity it flagged is real and resolved via Q6.
**api-contract**: ACU-1 incorporated (=CU-1). ACU-2 incorporated (=CU-3). ACU-3 incorporated (harness casts → `satisfies`, drift guarantee restored). ACU-4 incorporated (=PU-2, F18). ACU-5 dropped-as-noise (isolate-pill restarts scope-fresh by construction; mechanism mis-described). ACU-6 dropped-as-noise (tier already large; doc wording only). ACU-7 dropped-as-noise (cursors are API-surface-only; premise contradicted by harness). ACU-8 dropped-as-noise (hash is impl detail; contract pinned by F4).
**performance**: PU-1 incorporated (=CU-1; the live dropped-partition proof). PU-2 incorporated (F18). PU-3 incorporated (F15 independent oracle; fix's literal 50 replaced with raw-SQL oracle since clampLimit caps searchAll at 25). PU-4 dropped-as-noise (flat ~110 ms/page cost documented here: acceptable at <1k req/day; keyset chosen for determinism, not seek cost). PU-5 dropped-as-noise (repo precedent: only the d3 stack is lazy; a small modal mounts eager like AppMenu). PU-6 dropped-as-noise (no measured jank; deep-scroll is the researcher tail; revisit only if telemetry says so).
**ux**: UU-1 incorporated (truncation-gated More; single CTA — the top pill; bottom link dropped, superseding the earlier keep-both reading of the human's "also"… flagged at gate). UU-2 incorporated (Q7 + F19). UU-3 dropped-as-noise (plan already specified treatment + F7; restore-all kept as minimal addition). UU-4 incorporated (Q6). UU-5 incorporated (Q8, Sheet on mobile). UU-6 incorporated (44 px touch targets). UU-7 incorporated (hint hidden on touch; ↑↓ portion only with rows). UU-8 dropped-as-noise (F5 + harness already pin exhaustion; quiet end-copy included in zero-cost). UU-9 incorporated (shared q validation; "keep typing" state).
**accessibility**: AU-1 incorporated (≥3:1 pinned per theme — reproduced failing ratios 1.85–2.67:1). AU-2 incorporated (real roving focus, F22). AU-3 incorporated (Radix Dialog base, F22). AU-4 incorporated (single D9 status region). AU-5 incorporated (motion-safe variants). AU-6 incorporated (aria-pressed toggles). AU-7 dropped-as-noise (AppMenu precedent already ships aria-label; convention followed implicitly, now explicit anyway in F22's spirit). AU-8 dropped-as-noise (h2 heading-nav suffices). AU-9 dropped-as-noise (F9 + mockup already preventDefault; wording tightened at implementation).
**observability**: OU-1 incorporated (after-depth field; zeroResult excludes continuations). OU-2 incorporated (=Q6). OU-3 deferred-out-of-scope (client telemetry is cross-cutting infra; gap accepted in writing HERE — the modal/pagination failure signal is the ErrorBoundary + server 4xx/5xx logs). OU-4 deferred-out-of-scope (facet-interaction analytics belongs with the notes-feature research loop). OU-5 rejected-with-rationale (validation 400s deliberately unlogged per ratified decision 10; cursor version-bump observability comes from F3's stable `cursor_invalid` + prod 4xx rate). OU-6 incorporated (shared OBS helper; degraded/failed pins on the page loader).
**blast-radius-rollback**: BRRU-1 incorporated (=PU-3/F15). BRRU-2 incorporated (route ErrorBoundary). BRRU-3 incorporated (local boundary around orb+modal). BRRU-4 dropped-as-noise (additive API + full-redeploy rollback documented; no flag). BRRU-5 dropped-as-noise (verified: `@lumen/scripture` private, zero external importers — Ring-2 line now reads verified-isolated). BRRU-6 dropped-as-noise (visibility recomputed fresh per request; post-kill-switch cursor shrink is correct fail-closed behavior, noted as intended).

Panel-2 dissent rate: 0.40 (35 material / 20 noise / 1 risky / 2 out-of-scope of 58). No high-severity security/correctness finding was killed — safety carve-out untriggered. Tier re-check (step-4 exit): stays **large**.

## Drift baseline (filled at end of step 6)
- plan-hash: 570d988433781b6b (sha256/16 of plan.md pre-stamp)
- harness-hash: 88a65abaed97b8fc (sha256/16 of search.loader.test.ts + api-search-cursor.test.ts + search-cursor-harness.test.ts, concatenated in that order)
