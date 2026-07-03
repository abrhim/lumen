# Plan — graph-view

## Tier
**large** — risk axes tripped: public surface (new user-visible UI flow + `?graph`/`?depth` URL contract), behavior change (net-new product behavior), cross-system blast radius (new export in `packages/scripture` shared by web + MCP), data migration (Neo4j edge/node property backfill — always-escalate axis). Justification: new UI subsystem + shared-package contract + graph-store migration, ≥300 lines net-new.

## Goal
An Obsidian-style local graph view for any Lumen entity (verse, principle, person, place, symbol, topic; later words), opened as a near-fullscreen overlay from the reading surface, URL-driven (`?graph=<entityId>&depth=N`), with user-pickable depth — built on a single collection-aware neighborhood query contract that the verse panel and future collection-scoped surfaces will also consume.

## Prior learnings surfaced (step-2 requirement)

| Source | Learning | Application here |
|---|---|---|
| web-app-wiring retro | Mock-only loader tests hid every data-shape bug; add real-data smoke assertions | Harness includes a live-Neo4j smoke script asserting caps/truncation on a known hub verse |
| web-app-wiring retro | Portals escape CSS-hidden wrappers; mount-gate with matchMedia | Overlay is mount-gated on URL param, not CSS-hidden; fullscreen overlay portal reviewed for the same trap |
| web-app-wiring retro | Streamed deferred promises: degraded-as-value + budget < RR's 4950ms abort + Await errorElement | `getNeighborhood` loader promise follows the identical pattern (4.5s Neo4j budget already in place) |
| kedrec retro | Zod min/max for values interpolated into non-parameterizable query syntax (depth ranges, type arrays) | Depth is interpolated into `[*1..N]` — hard Zod bound int 1–3; relTypes/nodeTypes validated against allowlists before touching Cypher |
| shared-infra-packages retro | Error-path assertions must match happy-path coverage | Every failure mode below has a named harness assertion |
| multi-kb-mcp retro | Partial-failure handling is implementation scope, not deferred | Backfill partial-completion + missing-collection_id edges are in-scope behaviors |

## Scope

- **In:**
  1. **Neo4j collection backfill** — `scripts/backfill-neo4j-collections.mjs`: stamps `collection_id` onto every LM-layer edge and node, sourced from Postgres `lumen.edges.collection_id` / `lumen.entities.collection_id`. Idempotent (re-runnable after ingests), batched, `--dry-run` mode, reports stamped/missing counts.
  2. **Shared query contract** — `getNeighborhood(neo4j, entityId, opts)` in `packages/scripture/src/graph/get-neighborhood.ts`. Opts: `{ depth: 1|2|3, collections?: string[], relTypes?: string[], nodeTypes?: string[], perDepthCap?, totalCap? }`. Returns `{ found, center, nodes[], edges[], truncated: { shown, total } }`. Nodes carry `{ id, name, labels, collection_id }`; edges `{ from, to, rel_type, collection_id }`. Validation: depth Zod-bounded 1–3 (interpolated), relTypes/nodeTypes checked against `RELATIONSHIP_TYPES` / entity-type allowlists (never raw into Cypher), collections passed as a Cypher parameter. Traversal constrained to LM-layer labels — the Neo4j instance is shared with other knowledge bases (KB_*, DS_*) and an unlabeled `MATCH (n {id})` is a cross-tenant leak vector.
  3. **Web overlay** — `?graph=<entityId>&depth=N` on the scripture route. Loader streams the neighborhood as a deferred promise (degraded-as-value, KV-cached `graph:v1:<id>:<depth>:<collections-hash>`). Near-fullscreen overlay (`inset-4`-ish), `React.lazy`-loaded chunk. **d3-force default layout** (Obsidian-style: drag nodes, zoom/pan, hover dims non-neighbors), radial layout as deterministic fallback and the `prefers-reduced-motion` default. Depth picker (1–3, segmented). Entity-type legend with client-side visibility toggles. Node click recenters (`?graph=<clicked>` pushed — browser history is the trail). Verse nodes get "Read →" jumping to `/scripture/:book/:chapter?verse=N`. Esc / backdrop / ✕ strips the params. Dialog semantics + focus trap.
  4. **Entry points** — button beside the reference in the verse panel (rail + mobile sheet); principle/people chips in the panel open the graph centered on that entity; chapter header button centers on the chapter node.
  5. **Entity breadth** — all LM content types (Verse, Principle, Person, Place, Symbol, Topic/NaveTopic, Era, Event) and semantic rel types incl. previously unsurfaced `PARALLELS`, `EXTENDS`, `CONTRASTS`, `TYPIFIES`, `HAS_SYMBOL`, `SETTING_OF`. Structural containment (`IN_CHAPTER`/`IN_BOOK`/`IN_VOLUME`, `USES_WORD`) excluded from the default set.
  6. **Collections: contract only** — `collections` filter parameter plumbed end-to-end, defaulting to all-public collections. No toggle UI, no persistence (that's the collections feature).
- **Out:**
  - Collection toggle UI, per-user preference persistence, auth-scoped filtering.
  - Migrating the verse panel onto `getNeighborhood` (follow-up feature).
  - Word/Strong's node surfaces; global whole-corpus graph; graph on non-scripture routes.

## Files touched
- `scripts/backfill-neo4j-collections.mjs` (new)
- `packages/scripture/src/graph/get-neighborhood.ts` (new), `graph/index.ts` (edit: export)
- `packages/scripture/src/__tests__/graph.test.ts` (edit: harness)
- `apps/web/app/routes/scripture.tsx` (edit: params, loader promise, entry buttons, overlay mount)
- `apps/web/app/components/graph/` (new: `GraphOverlay.tsx`, `ForceLayout.tsx`, `RadialLayout.tsx`, lazy index)
- `apps/web/app/routes/__tests__/scripture.graph.loader.test.ts` (new: harness)
- `packages/scripture/src/graph/explore-graph.ts` (edit: LM-label hardening, API-1)
- `apps/web/package.json` (edit: `d3-force`, `d3-zoom`, `d3-selection`, `d3-drag`)
- `scripts/__tests__/backfill-neo4j-collections.test.mjs` or equivalent dry-run assertion (new)

## Public contract
- `GET /scripture/:book/:chapter?graph=<entityId>&depth=<1|2|3>` → chapter renders normally; overlay mounts with streamed neighborhood. Invalid/unknown entityId → overlay "not found" state (chapter unaffected, no 404 page). Invalid depth → clamped to 1–3.
- `packages/scripture` exports: `getNeighborhood`, `NeighborhoodResult`, `NeighborhoodOpts`.
- `node scripts/backfill-neo4j-collections.mjs [--dry-run]` — idempotent; prints `{edges: stamped/skipped/missing, nodes: …}`.
- Overlay a11y: `role="dialog"`, labelled by entity name, Esc closes, focus trapped and restored.

## Failure modes (must each have a harness assertion)
1. Neo4j down/slow → neighborhood promise resolves `{degraded: true}` (never rejects); overlay shows degraded notice; chapter unaffected.
2. Hub entity at depth 3 (e.g. `1-ne-3-7`, `obedience`) → per-depth and total caps enforced; `truncated.shown < truncated.total` reported accurately.
3. Unknown entity id → `{found: false}`; overlay not-found state; no throw.
4. Depth outside 1–3 (`0`, `4`, `abc`, `-1`) → clamped/rejected before any Cypher interpolation (Zod int bound).
5. relTypes/nodeTypes not in the allowlist → rejected; no caller-supplied string ever interpolated into Cypher.
6. Edge/node missing `collection_id` (pre-backfill drift) → included by default (fail-open for base data), counted and logged.
7. KV round-trip: cached JSON re-parse preserves the full result shape.
8. Cross-tenant isolation: a neighborhood query from an LM node returns only LM-layer nodes — never KB_*/DS_* labels (shared Neo4j instance).
9. Backfill idempotency: second run stamps 0 new properties, exits 0.

## Harness scope
**behavior** — harness-first **required**. Vitest in `packages/scripture` (query construction via mocked client capturing Cypher: label constraints, allowlist rejection, caps, param passing) + `apps/web` loader tests (param clamping, promise shape, cache key, degraded) + a live-data smoke script (hub caps + cross-tenant isolation) runnable against real Neo4j.

## Open questions (for human gate)
- Q1 — Backfill stamps **edges + nodes** (nodes needed for node-level collection filtering when user collections land)? Proposed default: yes, both.
- Q2 — Post-backfill edges still missing `collection_id`: include (fail-open, treat as canon) or exclude (fail-closed)? Proposed default: include + log count.
- Q3 — Who runs the prod backfill? Proposed default: I run `--dry-run`, report counts, then run for real — after this gate.
- Q4 — Caps: default depth 1; per-depth node cap 75; total cap 400. Proposed default: yes (tunable constants).
- Q5 — Recenter pushes history (back = trail) vs replace? Proposed default: push.
- Q6 — d3 micro-packages (`d3-force`/`d3-zoom`/`d3-selection`/`d3-drag`, ~35kb lazy chunk) vs hand-rolled physics? Proposed default: d3 micro-packages.

## Plan amendments (post-panel synthesis)

Material findings folded into the design. Grouped:

**Query engine (`getNeighborhood`)**
- Traversal is bounded *in Cypher at every depth*, not post-fetch: iterative per-layer expansion (or APOC `apoc.path.expandConfig`/`subgraphAll` — confirmed available on Aura) with per-layer `LIMIT`; depth-1 gets a `LIMIT` too [SEC-7, PERF-1]. Harness asserts caps appear in the captured Cypher [PERF-2].
- Every hop is label-constrained: `ALL(x IN nodes(path) WHERE <LM-label check>)`, not just endpoints; depth-1 branch written fresh with labels (never copied from `exploreGraph`); the `total` count subquery carries identical label+collection constraints [SEC-1, SEC-2, SEC-3].
- Result includes **all edges among visited nodes** (sibling↔sibling), not just tree edges to center — required for an honest Obsidian-style graph [COR-3].
- Edge dedupe contract: exact-duplicate same-direction edges collapse; reciprocal A→B/B→A pairs collapse to one rendered link; `truncated.{shown,total}` defined as **node** counts post-dedupe, edges reported separately [COR-1, COR-9].
- `perDepthCap`/`totalCap` are server-clamped to hard ceilings (Zod), never caller-controlled beyond them [SEC-8].
- Caller resolves collections: the web loader (or MCP server) resolves the public-collection id list from Postgres and passes explicit ids; `getNeighborhood` takes the list or `undefined` (= no filter). No db handle inside the graph function [COR-2].
- Node shape gains a display label: verse nodes derive a `reference`-style label (Postgres `name` is null for verses) [PERF-6 substance].
- **`exploreGraph` hardened in this feature**: same LM-label constraints applied — it is a live MCP tool with the identical cross-tenant vector (safety carve-out) [API-1].

**Caching**
- KV key: `graph:v1:<entityId>:<depth>:<sorted-collections-joined>` — canonicalized (sorted, delimiter-safe) [SEC-5]; 7-day TTL constant like `CONNECTIONS_TTL_SECONDS` [PERF-5]; key version bumps to `graph:v2:` as part of the backfill PR so pre-backfill entries can't serve stale collection data [COR-5].

**Backfill (`backfill-neo4j-collections.mjs`)**
- Join accounts for the phase-b id namespacing: match Neo4j id directly, fall back to `metadata->>'neo4j_id'` / stripped `{type}:` prefix [DATA-2].
- Parallel-edge ambiguity: when (from,to,rel_type) matches multiple Neo4j relationships, stamp deterministically and log an `ambiguous_parallel_edge` count — never silently double-stamp from distinct PG rows [DATA-1].
- `--verify` mode: compares every LM edge's Neo4j `collection_id` against a fresh Postgres read and reports mismatches (safety carve-out: DATA-7 survives its panel-2 `risky` tag — high-severity data-integrity) [DATA-7].
- All ids bound via `UNWIND $rows` parameters; credentials never logged [SEC-9, SEC-10].
- CLI contract: exit 0 clean, non-zero on connection/partial failure; `--dry-run` prints the same report shape as a live run [API-7].
- Per-run summary logging: batch counts, stamped/skipped/missing/orphan tallies, once per run (not per graph request) [OBS-2-lite, OBS-3].

**Web/UX**
- `?graph` and `?verse` are mutually exclusive on mobile: opening the graph closes the verse sheet (one dialog, one Esc target) [UX-1, COR-6].
- Depth control disables + current graph dims (not blanks) while a new depth loads [UX-3].
- Truncation line near the depth control whenever `shown < total` ("Showing 50 of 213 connections") [UX-4].
- Recenterable nodes get a persistent affordance (ring), not hover-only [UX-5].
- Empty-neighborhood copy distinct from not-found and degraded [UX-7].
- Plain-language legend labels for new types ("Topic", "Time period", "Symbol") [UX-8].
- Depth changes seed the new simulation from prior node positions; only new nodes animate in [UX-9].
- Focus returns to the invoking control (ref captured on open) [UX-10, A11Y-3].
- `shouldRevalidate`: chapter data skips refetch when only `graph`/`depth` change [PERF-4].
- Simulation ticks run off-React (refs/canvas commit, not per-tick setState) [PERF-3]; node-count threshold falls back to radial independent of motion preference [PERF-7]; radial layout ships as its own lazy chunk [PERF-8].

**Accessibility**
- A structured **list view** of the same neighborhood data (nodes grouped by type, links navigable) ships inside the overlay — the screen-reader/keyboard equivalent and a usable alternate view [A11Y-2].
- Overlay built on the existing Radix Dialog primitives (focus trap/Esc/restore for free) [A11Y-3].
- Depth/layout toggles use `role="radiogroup"`/`aria-checked` [A11Y-4].
- Polite `aria-live` announcements for load-complete, truncation, degraded, not-found [A11Y-8].
- Node palette contrast-checked against `--paper` (incl. dimmed opacities) before ship [A11Y-9].

**Observability**
- `logEvent` on: degraded graph fetch (entityId, depth, collections, error, elapsedMs — extends the `neo4j_degraded` convention) [OBS-1]; truncation stats per resolution [OBS-5]; `graph_not_found` mirroring `scripture_404` [OBS-7]. Cache path reuses `cachedJson` unchanged [OBS-10]. Overlay wrapped in an error boundary (no new reporting infra) [OBS-6 partial].

## Decisions

Panel-2 dissent rate: **(43 material + 19 risky) / 76 = 0.816.** One safety carve-out exercised: DATA-7 (high, data-integrity) survives its `risky` tag per the carve-out rule; panel-2's downgrade argument is logged for retro.

| ID | Resolution | Note |
|---|---|---|
| SEC-1 | incorporated | Per-hop label constraint; FM-8 harness strengthened |
| SEC-2 | incorporated | Depth-1 written fresh, labeled; explicit depth-1 isolation test |
| SEC-3 | incorporated | Count subquery constrained identically |
| SEC-4 | dropped-as-noise | relTypes are allowlist-checked pre-Cypher; no interpolation path exists |
| SEC-5 | incorporated | Canonicalized sorted collections in cache key (API-5 duplicate) |
| SEC-6 | deferred-out-of-scope | Ownership checks land with the collections feature |
| SEC-7 | incorporated | Cypher LIMIT at every depth incl. 1 |
| SEC-8 | incorporated | Server-side Zod ceilings on caps |
| SEC-9 | incorporated | UNWIND bound params in backfill |
| SEC-10 | incorporated | Credential scrubbing in backfill output |
| COR-1 | incorporated | Edge dedupe contract + fixtures |
| COR-2 | incorporated | Caller-resolved collections list |
| COR-3 | incorporated | Sibling-edge collection in query |
| COR-4 | rejected-with-rationale | "Postgres entities.id is a global PK; cross-type collisions structurally near-impossible upstream; proposed constraint outweighs actual risk" |
| COR-5 | incorporated | Cache version bump with backfill PR |
| COR-6 | incorporated | Duplicate of UX-1 (mutual exclusion) |
| COR-7 | rejected-with-rationale | "Await discards stale results; abort-signal threading touches shared neo4j-http client across all consumers — disproportionate" (recenter uses router navigate — trivially specified) |
| COR-8 | incorporated | Interrupted-backfill failure mode + assertion added |
| COR-9 | dropped-as-noise | Resolved by COR-1's count definition |
| PERF-1 | incorporated | Per-layer bounded traversal |
| PERF-2 | incorporated | Harness asserts Cypher-level caps |
| PERF-3 | incorporated | Off-React simulation ticks |
| PERF-4 | incorporated | shouldRevalidate for graph/depth params |
| PERF-5 | incorporated | Explicit 7-day TTL |
| PERF-6 | deferred-out-of-scope | Perf-lens n/a; substance folded into node-label spec (verse `reference` labels) |
| PERF-7 | incorporated | Node-count layout threshold |
| PERF-8 | incorporated | Radial split chunk |
| PERF-9 | deferred-out-of-scope | Collection-list cardinality is a collections-feature concern |
| API-1 | incorporated | exploreGraph hardened this feature (safety carve-out class) |
| API-2 | rejected-with-rationale | "Doc-only fix; no consumer conflates the three shapes" — divergence noted as intentional in code comment |
| API-3 | dropped-as-noise | Depth clamp vs verse-absent serve different UI semantics |
| API-4 | rejected-with-rationale | "No injection risk (bound param); robustness gap only" — cheap charset bound added opportunistically if free |
| API-5 | rejected-with-rationale | Duplicate of SEC-5 (incorporated there) |
| API-6 | dropped-as-noise | Calling-convention preference |
| API-7 | incorporated | Backfill exit codes + dry-run contract |
| API-8 | dropped-as-noise | Harness already locks the nesting; prose copy optional |
| API-9 | rejected-with-rationale | "Covered by COR-2's caller-resolution spec; explicit default-collections loader assertion folded into that work" |
| API-10 | dropped-as-noise | Filename corrected in plan (done) |
| DATA-1 | incorporated | Parallel-edge deterministic stamping + logged ambiguity |
| DATA-2 | incorporated | neo4j_id/namespace-aware join |
| DATA-3 | rejected-with-rationale | "All current edges are phase-b; filtering not yet granular — doc-only. UI must not imply per-source filtering it can't deliver" (noted in plan) |
| DATA-4 | rejected-with-rationale | "Needs concurrent-script timing; self-heals on idempotent re-run" — operational constraint documented: don't run concurrently with phase-b backfill |
| DATA-5 | rejected-with-rationale | "No NULL collection_id rows exist today; forward-looking" — backfill skips-and-counts NULLs anyway (one line) |
| DATA-6 | rejected-with-rationale | "Undirected matches sometimes intentional in this codebase" — backfill join is directed by construction via PG from/to |
| DATA-7 | **incorporated (safety carve-out)** | High/data-integrity survives `risky` tag; `--verify` mode added. Panel-2 downgrade logged |
| DATA-8 | rejected-with-rationale | "Logging gap, not data loss; orphan count (not full report) ships via OBS-3" |
| DATA-9 | deferred-out-of-scope | Dual-write reconciliation belongs to collections feature; noted there |
| UX-1 | incorporated | Graph closes verse sheet on mobile |
| UX-2 | rejected-with-rationale | "Prescribes exact visuals ahead of design pass" — a loading state ships (aria-busy skeleton), treatment left to design |
| UX-3 | incorporated | Depth control in-flight state |
| UX-4 | incorporated | Truncation copy near depth control |
| UX-5 | incorporated | Persistent recenter affordance |
| UX-6 | dropped-as-noise | Re-derives open Q5 |
| UX-7 | incorporated | Empty-neighborhood copy |
| UX-8 | incorporated | Plain-language legend labels |
| UX-9 | incorporated | Position-seeded depth transitions |
| UX-10 | incorporated | Invoker-ref focus restore |
| A11Y-1 | deferred-out-of-scope | Spatial keyboard graph traversal is research-grade; A11Y-2's list covers access |
| A11Y-2 | incorporated | List view of neighborhood in overlay |
| A11Y-3 | incorporated | Radix Dialog base |
| A11Y-4 | incorporated | radiogroup semantics on toggles |
| A11Y-5 | rejected-with-rationale | "Per-type glyphs at 13–26px need real design work; legend text partially mitigates" — revisit at design pass |
| A11Y-6 | rejected-with-rationale | "26px already clears WCAG 2.5.8 AA (24px)" — invisible hit-slop added opportunistically (cheap) |
| A11Y-7 | deferred-out-of-scope | Keyboard pan/zoom duplicated by list view |
| A11Y-8 | incorporated | aria-live announcements |
| A11Y-9 | incorporated | Palette contrast check |
| OBS-1 | incorporated | Degraded log event with graph dimensions |
| OBS-2 | rejected-with-rationale | "Idempotent rerun covers crash recovery; persisted-file audit trail disproportionate for one manual run" — per-run summary retained |
| OBS-3 | incorporated | Missing-collection_id counted once per backfill run, silent at request time |
| OBS-4 | rejected-with-rationale | "Premature; kv_cache_error already logs full key on failure" |
| OBS-5 | incorporated | Truncation stats logged per resolution |
| OBS-6 | rejected-with-rationale | "sendBeacon reporting = new client-error infra beyond scope" — error boundary ships, reporting deferred |
| OBS-7 | incorporated | graph_not_found event |
| OBS-8 | dropped-as-noise | Enterprise threat framing; validation already neutralizes |
| OBS-9 | rejected-with-rationale | "Sole-developer script; timestamp + dryRun flag suffice" (both retained) |
| OBS-10 | incorporated | cachedJson reused unchanged |

## Drift baseline (filled at end of step 6)
- plan-hash: d0def7e1168f38a8 (sha256/16 of plan.md at synthesis, pre-hash-stamp)
- harness-hash: 27639124f5cb7277 (sha256/16; amended post-synthesis: PERF-2, SEC-2, COR-1, API-1 assertions)
