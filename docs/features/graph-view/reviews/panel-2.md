# Aggregated panel-2 — graph-view

## accessibility.md

# Panel 2 — Adversarial Review: accessibility (panel-1)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| A11Y-1 | out-of-scope | Real gap, but the specific ask (SVG canvas roving-tabindex + spatial arrow-key neighbor traversal) is the aspirational graph-traversal pattern; A11Y-2's list already gives keyboard/SR users full access. |
| A11Y-2 | material | Cheap: same `getNeighborhood` data, plain markup (list/links), no new interaction model. Also the thing that makes A11Y-1/7 safely deferrable. |
| A11Y-3 | material | Plan already promises "focus trapped and restored"; repo already uses Radix Dialog/Sheet on this exact route. Reusing it is near-zero cost, not aspirational. |
| A11Y-4 | material | `aria-pressed`/`role="radiogroup"` on plain toggle buttons is trivial, ordinary widget hygiene — not graph-specific, no reason to defer. |
| A11Y-5 | risky | Real WCAG 1.4.1 concern, but legible per-type glyphs at 13-26px radius need real design/asset work; legend text is a partial mitigant already. |
| A11Y-6 | risky | WCAG 2.5.8 AA minimum is 24px; 26px diameter already clears it, so citation is overstated — fix (invisible hit-slop) is cheap but not a compliance blocker. |
| A11Y-7 | out-of-scope | Keyboard pan/zoom for a physics canvas is a heavy, novel build; purely a viewport aid duplicated by A11Y-2's non-visual list + recenter action. |
| A11Y-8 | material | Polite `aria-live` for load/truncation/degraded states is standard, cheap, and directly required by the plan's own async/degraded-mode contract. |
| A11Y-9 | material | Cheap: contrast-check a small enumerated palette (incl. 0.55-opacity variants) against `--paper` before ship; concrete WCAG 1.4.11 risk, no new interaction work. |

## Overall stance

Panel-1's dialog-hygiene and data-equivalence findings (A11Y-2, A11Y-3, A11Y-4, A11Y-8, A11Y-9) are cheap, standard, and already implied by the plan's own contract or by primitives already in use elsewhere in this codebase — these are correctly material and shouldn't be negotiated away. The two canvas-interaction findings (A11Y-1, A11Y-7) describe a real gap but prescribe research-grade spatial/physics keyboard controls for a v1 force graph; both are made moot by the cheap SR/keyboard list-equivalent (A11Y-2), so they're out-of-scope rather than blocking. A11Y-5 and A11Y-6 are legitimate but lower-leverage: A11Y-5 needs real design work beyond a v1 patch, and A11Y-6's WCAG citation is technically overstated since 26px already clears the AA target-size minimum — both downgraded to risky rather than dropped.

## api-contract.md

# Panel-2 / api-contract adversarial review — graph-view

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| API-1 | material | Confirmed: `exploreGraph` still unlabeled while plan hardens the identical vector elsewhere; live MCP tool. Safety carve-out overrides scope-creep concern. |
| API-2 | risky | Real 3-way `found` shape drift confirmed by reading all three files, but doc-only fix, no consumer currently conflates the shapes. |
| API-3 | noise | Depth always needs a renderable value (picker); `?verse` legitimately has a null "no selection" state — different domains, not a real inconsistency. |
| API-4 | risky | Confirmed: harness never bounds `entityId`; it flows raw into URL, cache key, param. No injection risk (bound param) but real robustness gap. |
| API-5 | risky | Confirmed: no test asserts collection-array ordering/canonicalization; genuine cache-key duplication risk given central KV-cache design. |
| API-6 | noise | Pure calling-convention preference (opts-object vs positional); zero behavioral or contract impact, bikeshedding. |
| API-7 | material | Backfill exit codes/dry-run-on-failure genuinely unspecified for a script that runs against prod; plan itself flags migrations as always-escalate. |
| API-8 | noise | Verified harness already implements and locks the exact nesting claimed missing; ask is copy-into-prose, not a real gap. |
| API-9 | risky | Confirmed: no test covers omitted `?collections` resolving to defaults end-to-end, violating plan's own "every FM has a harness assertion" claim. |
| API-10 | noise | Confirmed accurate but zero functional impact — one-line plan filename fix, doesn't affect implementation or harness correctness. |

## Overall stance

Verified all ten findings against the actual harness/plan/source files rather than trusting panel-1's prose; nine held up factually, none were fabricated. The one clear must-fix is API-1 — `exploreGraph` shares the exact cross-tenant vector the plan explicitly names as dangerous enough to justify new hardening, and it's live behind a deployed MCP tool, so the safety carve-out makes it material despite living in a sibling function. API-7 earns material because it's an unspecified failure contract for a script that will run against production data. The remaining findings split between genuine but non-blocking contract gaps (API-2/4/5/9, mostly around entityId validation, cache-key canonicalization, and a harness coverage hole panel-1 was right to catch) and low-value nits where the "inconsistency" is either already correctly handled (API-8), justified by differing semantics (API-3), or purely stylistic (API-6, API-10).

## correctness.md

# PANEL-2 / ADVERSARIAL correctness review — graph-view

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| COR-1 | material | Verified: `get-verse-connections.ts` already dedupes CROSS_REF dupes; `get-neighborhood.test.ts` has zero dedup fixtures. d3 will render doubled lines on real data. |
| COR-2 | material | Confirmed `getNeighborhood(client, entityId, opts)` has no db param; "all-public collections" default is under-specified, not literally unimplementable — loader has `context.db` available. |
| COR-3 | material | Confirmed by reading `explore-graph.ts`: depth>1 only returns tree-edges to center via `path_relationships`, never sibling-to-sibling edges. Core to an Obsidian-style graph. |
| COR-4 | risky | Postgres `entities.id` is a single-table global PK (schema.ts:88), so cross-type id collisions are structurally near-impossible upstream; proposed DB-constraint/API fix outweighs the actual risk. |
| COR-5 | material | Confirmed: no cache-purge/version-bump tooling exists anywhere in repo; `graph:v1:` prefix already anticipates versioning, so the fix is proportionate to a real staleness gap. |
| COR-6 | material | Plausible real path: chip click inside mobile verse Sheet adds `?graph=X` while Sheet is open — two Radix dialogs stacking is a real a11y risk, not hypothetical. |
| COR-7 | risky | Recenter-via-`navigate()` is barely a finding; abort-signal wiring is a backend resource-waste issue (React Router's Await already discards stale results), fix touches shared `neo4j-http` client across all consumers. |
| COR-8 | material | Plan's own prior-learnings table commits partial-failure handling in-scope, yet FM list omits it — a genuine internal-consistency gap; fix (one more assertion) is cheap. |
| COR-9 | noise | Derivative of COR-1: the shown/total ambiguity only exists if/once edge dedup lands. Resolving COR-1 properly resolves this; not independently actionable. |

## Overall stance

Panel-1's correctness findings hold up well under code verification — COR-1 and COR-3 are directly confirmed by reading `get-verse-connections.ts` and `explore-graph.ts`, and COR-5's cache-staleness claim is confirmed by the total absence of any purge tooling in the repo. Two findings (COR-4, COR-7) get downgraded to `risky`: COR-4's proposed DB-constraint fix outweighs a risk that's likely already foreclosed by Postgres's single-table global `entities.id` primary key, and COR-7 bundles a trivial spec question with a backend efficiency concern whose fix (threading abort signals through the shared `neo4j-http` client) is disproportionate to its invisible-to-the-user impact. COR-9 is marked `noise` as pure derivative commentary on COR-1 that resolves itself once COR-1 is fixed. No findings are downgraded out of scope — all nine engage directly with plan.md/harness gaps.

## data-integrity.md

# Panel-2 adversarial review — data-integrity (graph-view)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| DATA-1 | material | Verified: no relationship element_id captured anywhere (export-neo4j.mjs edge query, backfill-phase-b.ts). get-verse-connections.ts comment confirms parallel edges exist in prod data. |
| DATA-2 | material | Verified exact at cited lines: `{type}:{id}` namespacing is real, `neo4j_id` only in metadata. Naive join would break silently for every namespaced entity. |
| DATA-3 | risky | Confirmed: Phase A writes zero edges, backfill-phase-b.ts always stamps `collection_id='phase-b'`. Real but fix is doc-only; no toggle UI exposes this yet. |
| DATA-4 | risky | Confirmed no BEGIN/COMMIT around DELETE-then-INSERT in backfill-phase-b.ts. Real gap, but needs concurrent-script timing; self-heals on next idempotent run. |
| DATA-5 | risky | `entities.collection_id` nullable is real (schema.ts), but every current insert path always sets it — no NULL rows exist today; forward-looking gap. |
| DATA-6 | risky | Plan is silent on directionality for the new script, confirmed. But get-verse-connections.ts shows undirected matches are sometimes intentional in this codebase — not absolute. |
| DATA-7 | risky | Plausible but speculative; no concrete code path cited showing the described interrupted-then-rerun divergence. Reads as an audit-tooling nice-to-have, not a proven defect. |
| DATA-8 | risky | Valid, low-severity per specialist's own tag; grounded in the plan's documented Q2 fail-open default. Logging gap, not data loss. |
| DATA-9 | out-of-scope | Concerns reconciliation cadence for a *future* dual-write collections feature, which the plan explicitly defers ("that's the collections feature", Out section). |

## Overall stance

DATA-1 and DATA-2 are confirmed against actual code (export-neo4j.mjs, backfill-phase-b.ts) and one is corroborated by a real comment in shipped code acknowledging parallel edges already exist in production data — these are near-certain-to-occur, silent, high-severity correctness bugs for the planned backfill script and should block or gate implementation. The remaining medium/low findings are all technically accurate against the codebase but describe edge-case, currently-unrealized, or self-correcting scenarios (concurrent runs, still-null-free schema fields, undirected-match ambiguity, observability gaps) — real and worth tracking, but not blocking. DATA-9 is scoped to a feature the plan explicitly defers and doesn't belong to this review.

## observability.md

# Panel 2 — Adversarial review of panel-1 observability findings (graph-view)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| OBS-1 | material | Harness already reuses `neo4j_degraded` for the graph fetch; adding entityId/depth/collections fields is a one-line fix, matches existing `logEvent` convention. |
| OBS-2 | risky | Idempotent rerun already covers crash recovery (rerun-from-scratch is safe); "audit trail" framing and persisted-file requirement are disproportionate for one manual prod run. |
| OBS-3 | material | Real ambiguity: per-request logging on every fail-open edge would be noisy before backfill completes; cheap one-sentence clarification prevents a log-flood landmine. |
| OBS-4 | risky | Cache-key hash debuggability is premature — no collections UI exists yet, and `kv_cache_error` already logs the full key on actual failures. |
| OBS-5 | material | Named failure mode (FM-2); one cheap `logEvent` per graph resolution gives real production truncation visibility at negligible volume/cost for this traffic scale. |
| OBS-6 | risky | Legit crash-visibility gap, but building a `sendBeacon`-to-endpoint pipeline is new client-error infra beyond scope; an error boundary alone (or explicit deferral) suffices. |
| OBS-7 | material | Direct analog to the existing `scripture_404` pattern; cheap, catches a real stale/broken-link maintenance issue in a personal knowledge graph. |
| OBS-8 | noise | "Probing traffic" framing is enterprise threat-modeling for a personal app; Zod bound + allowlist already prevent harm regardless of whether it's logged. |
| OBS-9 | risky | `invokedBy`/audit-trail framing is disproportionate for a script only the sole developer ever runs; timestamp + dryRun flag alone would be sufficient. |
| OBS-10 | material | Cheap, scope-*reducing* confirmation that `cachedJson`/`kv_cache_error` is reused unchanged — prevents a redundant bespoke cache-error path from being built. |

## Overall stance

Panel-1 is well-calibrated where it maps cleanly onto the codebase's existing single-line `logEvent`/console-JSON convention (OBS-1, OBS-3, OBS-5, OBS-7, OBS-10 are cheap, real, and material). But several findings smuggle in enterprise-shaped asks that don't fit a low-traffic, single-developer Cloudflare Worker: audit trails and `invokedBy` actor-tracking for a script only the author runs (OBS-2, OBS-9), premature cache-hash debugging infra for a collections filter with no UI yet (OBS-4), and — most notably — a client-side error-reporting endpoint (OBS-6) when no such infrastructure exists anywhere in the app and building one is a real scope expansion, not a logging tweak. OBS-8's "probing traffic" framing is pure noise here: the Zod/allowlist validation already neutralizes the risk independent of whether rejections are logged.

## performance.md

# Panel 2 — Adversarial review of Panel 1 performance findings: graph-view

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| PERF-1 | material | `explore-graph.ts:86-101` proves the exact anti-pattern in production precedent; APOC Core `apoc.path.expandConfig`/`subgraphAll` confirmed available on Aura; non-APOC fallback fix also offered. |
| PERF-2 | material | Read `get-neighborhood.test.ts` — confirms no assertion on captured Cypher structurally bounding per-hop work; matches project's own "mock-only tests hid data-shape bugs" retro learning. |
| PERF-3 | material | Reference mock (`lumen-study-v11.jsx:594-595`) literally calls `bump(b=>b+1)` per tick — the plan follows this design; fix (refs/canvas, commit on settle) is standard, low-risk. |
| PERF-4 | material | Confirmed: no `shouldRevalidate` anywhere in app code; recenter would re-run `getVersesByChapter`/`getChapterSummary` needlessly. Fix is a well-known, cheap RR pattern. |
| PERF-5 | material | Confirmed: `cachedJson` mandates an explicit `ttlSeconds`; plan never states one for graph entries despite `CONNECTIONS_TTL_SECONDS` precedent for the same "immutable" data. |
| PERF-6 | out-of-scope | Real gap (fixture shows `name: null` for Verse) but it's a display/correctness issue, not a performance concern — belongs to correctness/UX lens, not this one. |
| PERF-7 | material | Legitimate complement to PERF-3: node-count/viewport threshold for layout fallback is cheap and directly protects the low-end-mobile case the plan already cares about. |
| PERF-8 | material | Plan's Q6 wording ("~35kb lazy chunk") implies one bundle for all d3 packages; splitting `RadialLayout` out is a real, low-risk, low-cost win for reduced-motion/mobile paths. |
| PERF-9 | out-of-scope | Speculative "grows over time" claim with no current cardinality data; plan explicitly defers collections toggle/cardinality to a separate follow-up feature. |

**Stance:** Seven of nine findings hold up under scrutiny — several are corroborated directly by reading the actual precedent code (`explore-graph.ts`, the `ForceLayout` reference mock, the harness test files), not just plausible-sounding theory, and none of the proposed fixes are disproportionate or infeasible (APOC Core is confirmed available on Aura, `shouldRevalidate` and off-React tick handling are standard, low-risk patterns). PERF-6 and PERF-9 are the exceptions: PERF-6 is a real bug but not a performance issue (mislabeled lens), and PERF-9 is a speculative, forward-looking concern about a dimension (collections cardinality) the plan explicitly scopes to a later feature. No finding rose to "risky" — every proposed fix is proportionate to the problem it addresses.

## security.md

# Security review — graph-view (PANEL-2 adversarial, evaluating PANEL-1)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| SEC-1 | material | Confirmed: Cypher `[*1..N]` only constrains path endpoints, not intermediate hops. FM-8 regex genuinely passes on any `labels(` occurrence, not per-hop proof. |
| SEC-2 | material | Confirmed: `explore-graph.ts:48-66` depth=1 branch is truly unlabeled `MATCH (n {id})`; plan cites it as reference without forbidding copy-paste reuse. |
| SEC-3 | material | Real gap: FM-2 harness mocks `total` directly, never exercising a real count-subquery WHERE clause, so a leaky unconstrained COUNT would go undetected. |
| SEC-4 | noise | Misreads the guard's purpose — `validateLayerQuery` polices raw node labels only; relTypes are never string-interpolated (bound params, allowlist-checked pre-Cypher per FM-5). No exploitable gap. |
| SEC-5 | material | Valid: naive undelimited join (e.g. concat without separator) can collide across collection sets; cheap fix (sorted, delimited/hashed key) closes it. |
| SEC-6 | out-of-scope | Plan explicitly defers auth-scoped/ownership-checked collections to "the collections feature"; finding itself concedes this is a future blocking dependency, not this feature's scope. |
| SEC-7 | material | Confirmed: existing `explore-graph.ts` depth=1 has no Cypher `LIMIT`; plan's own FM-2 hub example (`obedience`) would hit unbounded `collect()` before app-side truncation. |
| SEC-8 | material | Plan states hard Zod bound for `depth` only; `perDepthCap`/`totalCap` unbounded is a real DoS surface if MCP callers pass opts directly. |
| SEC-9 | material | In-scope (backfill is plan deliverable #1); ids sourced from AI-generated phase-b/anthropic-batch content, unwritten script has no stated param-binding contract yet — cheap fix. |
| SEC-10 | material | In-scope, and codebase precedent (`ingest-phase-a.ts:913` raw `console.error('...', err)`) shows the leak pattern already exists — plausible, trivial-cost fix. |

**Overall stance:** Panel-1's security specialist is mostly signal — SEC-1/SEC-2 correctly identify a real, well-known Cypher gotcha (variable-length path patterns constrain only endpoints, not intermediate hops) and a genuinely weak harness assertion (FM-8's disjunctive regex), both verified directly against `explore-graph.ts` and the test file. Only SEC-4 is noise (conflates the raw-label guard's actual purpose with a relType-injection vector that doesn't exist, since relTypes are bound params, never interpolated) and SEC-6 is correctly out-of-scope per the plan's own deferred-collections boundary. The low-severity backfill-script findings (SEC-9/10) are grounded in real codebase precedent rather than generic boilerplate, so they earned material rather than a knee-jerk downgrade.

## ux.md

# Panel 2 — Adversarial UX review: graph-view

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| UX-1 | material | Confirmed in scripture.tsx: mobile Sheet mounts on `selected !== undefined` independent of `?graph`; graph button lives inside it, no mutual-exclusion exists. |
| UX-2 | risky | Missing graph loading state is real, but fix dictates exact visuals (pulsing center node, ring placeholders, radial gradient) — a design-pass call, not UX's to spec. |
| UX-3 | material | Depth control has no in-flight feedback; disable+dim is a standard interaction pattern (not a visual-design over-reach) and prevents mashing/confusion. |
| UX-4 | material | `truncated:{shown,total}` is a plan contract field with zero defined UI surface anywhere in mock or plan — genuine functional gap, fix stays generic ("e.g."). |
| UX-5 | material | Mock's hover-only recenter cue (CSS ~344-345, JSX ~567) fails touch per emil-design-engineering guidance; fix offers options, doesn't mandate one design. |
| UX-6 | noise | Re-derives Q5 (recenter push default), already an open question the plan tracks for human gate; extending it to the Read jump adds no new decision. |
| UX-7 | material | Failure modes 1-9 cover only technical failures; a legitimate `found:true` + zero-neighbor node has no defined copy — distinct, real, low-cost gap. |
| UX-8 | material | Plan adds Era/Event/Symbol/Topic types absent from mock's `TYPE_LEGEND`; plain-language legend copy is in-scope content work (plan item 5), not visual over-spec. |
| UX-9 | material | ForceLayout re-seeds from scratch each depth change (mock ~581-599) so tracked nodes jump position; seeding from prior `{x,y}` is a correctness fix, not decoration. |
| UX-10 | material | Plan says focus "trapped and restored" but not to what, across 3 real entry points (rail, chip, chapter header); storing an invoker ref is scoped and concrete. |

## Overall stance

Panel-1's findings are grounded in the actual code (scripture.tsx's Sheet mount logic, the mock's ForceLayout re-seed and hover-only CSS) rather than speculative nitpicking, so most hold up as material — UX-1, UX-9, and UX-5 in particular catch concrete bugs the plan doesn't address. UX-2 is downgraded to risky because it prescribes specific visual treatment (exact skeleton imagery) that belongs to the design pass, not this review. UX-6 is noise: it dresses up an extension of the plan's own open question (Q5, still pending human gate) as a new finding rather than surfacing anything the plan hasn't already flagged for resolution.

