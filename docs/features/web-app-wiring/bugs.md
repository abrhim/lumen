# Bugs — web-app-wiring

Post-implementation ledger. The original scope (SSR reader, plan.md) shipped at
bc0b7f3; the feature then evolved post-gate (user-directed) into the streaming
interactive panel. Code-stage review ran as an 8-angle finder pass with
per-candidate verification (2026-07-03) rather than the standard code-panel —
noted in retro §4.

## Confirmed bugs

| # | Bug | Severity | Provenance | Status |
|---|---|---|---|---|
| 1 | Mobile Sheet portals to `<body>`; `lg:hidden` wrapper can't contain it — modal drawer opened on desktop, overlay blocked the page | high | user-report | fixed |
| 2 | D&C unreachable: `parseReference('dc')` returns volume (id collision), chapter route 404s | high | user-report | fixed |
| 3 | D&C missing from home: single-book volume can never have a book entity (shared id namespace), `getAllBooks` returned nothing for it | high | user-report | fixed |
| 4 | Streamed connections promise rejects client-side (RR turbo-stream aborts at 4950ms < Neo4j 5000ms budget; navigations cancel deferred data) and `<Await>` had no errorElement → whole chapter replaced by error page | high | code-review-finder | fixed |
| 5 | Parallel same-direction CROSS_REF edges (confirmed in prod: `1-cor-1-27→ether-12-27` ×2) → duplicate React keys + duplicate cards | med | code-review-finder | fixed |
| 6 | `location.state.scrollTo` persists on history entries → back/forward replays smooth scroll; chapter-scroll effect fought POP restoration | med | code-review-finder | fixed |
| 7 | `verseIdToTarget` bare regex emitted 404 links for unroutable graph ids (`od-1-2`) | med | code-review-finder | fixed |
| 8 | Optimistic ?verse parse drifted from loader grammar (no membership check) → phantom-panel flicker on stale links | low | code-review-finder | fixed |
| 9 | `getAllBooks` NOT EXISTS heuristic (first fix attempt) silently breaks when Official Declarations ingest under volume `dc` — ingest map already contains `'Official Declaration': 'od'` | high | code-review-finder | fixed (pre-merge, caught in same review) |
| 10 | `getBooksByVolume` has the same latent `od` short-circuit: an `od` book entity hides the D&C book from MCP volume listings | med | code-review-finder | deferred (data-contingent; apply UNION treatment when OD content ingests) |
| 11 | "Chapter N+1 →" renders unconditionally; last chapter of every book links to a 404 | low | code-review-finder | deferred (needs chapter_count plumbed; pre-existing since UX-3) |
| 12 | Mobile panel is hydration-dependent (rail CSS-hidden below lg, sheet is client-mounted portal) — no-JS/pre-hydration mobile loads can't reach connections | low | code-review-finder | deferred (accepted trade-off of client-interactivity direction) |

## Not bugs (design feedback resolved in same pass)

- Brown left-border selection treatment (flattened mock heat-bar into a border) — restyled per mock.
- Raw source slugs in UI (`lds-doc-project`) — humanized label map.
- Cross-ref cards were dead ends — made navigable (introduced bug #7, then fixed).

## Provenance histogram

```
user-report:          3   (#1 #2 #3)
code-review-finder:   9   (#4–#12)
harness:              0
panel (plan-stage):   0   (post-gate evolution never went back through panels)
```
