# Plan — web-app-wiring

## Tier
**standard** — risk axes tripped: public surface (new user-visible routes), behavior change (net-new stack wiring). Justification: new public routes + net-new behavior >100 lines, but no auth/schema/billing; migration plan behind it already survived a 6-agent review.

## Goal
Prove the full production stack inside the RR7 Cloudflare Workers app: Postgres via Hyperdrive (Drizzle), Neo4j via HTTP, with caching, graceful degradation, and security headers — ending in a browsable scripture reader route.

## Scope
- In:
  - Module-scoped lazy postgres singleton with `{ prepare: false }` (Hyperdrive requirement), wrapped in Drizzle
  - Per-request Neo4j client factory from `@lumen/neo4j-http`
  - Extended `AppLoadContext`: `{ cloudflare, db, neo4j, cache }`
  - `GET /` — volume + book list from PG entities
  - `GET /scripture/:book/:chapter` — verse list + AI chapter summary from PG; `?verse=N` adds a cross-references panel from Neo4j
  - KV-backed cache for Neo4j reads (7-day TTL; scripture graph is immutable between ingests); cache failures fall through to live query
  - Graceful degradation: Neo4j failure → 200 render with `graphDegraded: true`, verses still shown
  - Security headers on all responses (nosniff, frame-deny, HSTS, referrer-policy)
  - Reference validation via `parseReference` from `@lumen/scripture`; unknown book/chapter → 404
- Out:
  - Auth (Phase 4), search UI, study modes, word-level data, styling polish beyond readable Tailwind, deploy/CI (Phase 5), MCP server, KV caching of PG reads

## Files touched
- apps/web/workers/app.ts (edit — context assembly, security headers, singleton)
- apps/web/app/lib/db.server.ts (new — postgres/Drizzle singleton)
- apps/web/app/lib/neo4j.server.ts (new — client factory)
- apps/web/app/lib/cache.server.ts (new — KV cache wrapper, swallow-errors semantics)
- apps/web/app/routes.ts (edit — add scripture route)
- apps/web/app/routes/home.tsx (edit — volumes/books from loader)
- apps/web/app/routes/scripture.tsx (new — chapter reader + cross-ref panel)
- apps/web/wrangler.json (edit — KV binding `CACHE`)
- apps/web/app/lib/__tests__/ + apps/web/app/routes/__tests__/ (new — harness)
- apps/web/package.json, vitest setup (new — test infra)
- apps/web/app/lib/log.server.ts (new — structured log helper [OBS-6])
- packages/scripture/src/queries.ts (edit — add getAllBooks single-query variant [PERF-1])
- packages/neo4j-http/src/client.ts + types.ts (edit — configurable timeoutMs [COR-7])
- scripts/setup-readonly-role.sql (new — lumen_read role [SEC-1])

## Public contract (post-synthesis)
- `GET /` → 200 HTML: volumes (ordered by sort_order) with their books, each book links to chapter 1. Loader = 2 queries total (getVolumeList + new getAllBooks), grouped in JS [PERF-1]
- `GET /scripture/:book/:chapter` → 200 HTML: `<h1>` chapter reference, `<main>` landmark, AI summary (if present), ordered verse list (id, verse_number, text, **reference** [API-4]); each verse links to `?verse=N`; **prev/next chapter links** [UX-3]
- Non-canonical book slug (e.g. `1ne`) → **301 redirect** to canonical URL, query preserved [API-1]; cache keys always built from canonical bookId via buildVerseId [API-8, COR-3]
- `GET /scripture/:book/:chapter?verse=N` → cross-references panel (labeled `<section>` [UX-6]) with reference, snippet, direction, source, and a **close link** back to the chapter URL [UX-2]
- Unknown book / non-numeric chapter / chapter with no verses → 404, cause differentiated in Response body + structured log [API-5]; 404 boundary links to `/` [UX-10]
- Invalid `?verse` → chapter renders without panel (no error)
- Neo4j unavailable → 200, `graphDegraded: true`, scoped "graph features unavailable" copy; error logged structured (name, code) before swallow [OBS-1, OBS-10]
- KV cache: key `xrefs:v1:{verseId}`, 7-day TTL [COR-4]; failures logged one line and fall through to live query [OBS-2]
- PG unavailable → error boundary (500); singleton init failures logged once then re-thrown [OBS-7]
- All responses (including thrown 404s) carry security headers via a wrap of the single requestHandler return [COR-5]
- Structured logging via shared `log.server.ts` helper emitting single-line JSON [OBS-6]
- Neo4j interactive timeout 5s (neo4j-http gains configurable `timeoutMs`, default stays 20s) [COR-7/PERF-3]
- DB access via scoped read-only role `lumen_read` (Hyperdrive config updated); superuser reserved for migrations [SEC-1]

## Failure modes (must each have a harness assertion)
1. Unknown book slug (`/scripture/narnia/1`) → 404
2. Non-numeric chapter (`/scripture/1-ne/abc`) → 404
3. Valid book, out-of-range chapter (`/scripture/1-ne/99`) → 404 (no verses)
4. Neo4j throws (timeout/auth/network) with `?verse=` present → loader returns `graphDegraded: true`, verses intact, no throw, structured console.error emitted
5. KV `get` or `put` throws → cross-refs still served from live Neo4j (cache never breaks a request)
6. Invalid `?verse=` (non-numeric, ≤ 0) → treated as absent
7. Cache hit → Neo4j client NOT called; cache key starts `xrefs:v1:`
8. postgres client constructed exactly once across sequential requests and with `prepare: false`; init-failure retried next call
9. Neo4j client constructed with `LM` layer prefix and env-provided credentials per request
10. Non-canonical book slug → 301 with canonical Location, query string preserved
11. Loader data verses[] includes `reference` per verse

## Accepted limitations (documented, no code)
- Thundering herd on concurrent first-time cache miss (duplicate Neo4j calls) — COR-6
- No PG-read caching this phase (Hyperdrive edge caching covers) — PERF-2/4
- Scroll position on ?verse= SSR reload — UX-1 (verse anchors `id="v{N}"` ship with links regardless)

## Harness scope
**behavior** — harness-first required. Vitest in apps/web (new infra). Loader-level tests with fully mocked context (db, neo4j, cache) per kedrec learning — mock every data path; error-path assertion count ≥ happy-path count per shared-infra-packages learning.

## Prior learnings surfaced (step 2 requirement)
- kedrec: mock the database layer in harnesses — bugs live in unmocked data paths.
- kedrec: Zod/min-max bounds for values interpolated into query syntax — applies to `?verse` and `:chapter` parsing before they reach queries.
- shared-infra-packages: error-path assertions must match happy-path coverage.
- multi-kb-mcp: partial-failure handling (Neo4j down, KV down) is implementation scope, not deferred.
- lumen-lambda-deploy: init-error pattern — catch→store→re-throw for singleton construction failures so retry is possible on next request.

## Open questions (for human gate)
- Q1 — KV namespace: create now via wrangler (binding `CACHE`)? Proposed default: yes, created during implement step.
- Q2 — Home page volume ordering: by `metadata.sort_order`. Proposed default: yes.
- Q3 — Cross-ref panel is `?verse=N` (SSR, no client JS state). Proposed default: yes — simplest proof; verse-detail route deferred.
- Q4 — HSTS on localhost dev may be annoying; gate headers on `request.url` scheme? Proposed default: always set; localhost over http ignores HSTS anyway.

## Drift baseline (filled at end of step 6)
- plan-hash: e244a58b27bd6e5f8809e4c452aa3bdb32ea0462bf109993d97e126c1f366134
- harness-hash: b4c880851d7f78c7dd25b941ffa55dd4cc669db95a176de76e5c063377a180aa

## Decisions

Resolution labels per adversarial synthesis (tie-break: human > panel-2 > panel-1; safety carve-out applied to COR-1, SEC-1).

| ID | Resolution | Note |
|---|---|---|
| SEC-1 | incorporated | Create scoped read-only role `lumen_read`; Hyperdrive uses it, superuser reserved for migrations. Safety carve-out. |
| SEC-2 | rejected-with-rationale | Secret is gitignored/untracked; rotation is an explicit Phase 5 item. Pre-commit tooling out of scope. |
| SEC-3 | rejected-with-rationale | CSP deferred — read-only surface, React escaping, no third-party scripts yet. Revisit at Phase 4 (auth pages). |
| SEC-4 | dropped-as-noise | No dangerouslySetInnerHTML in repo; React default escaping already holds. |
| SEC-5 | rejected-with-rationale | Covered by COR-3 (buildVerseId from validated parts) + COR-4 (versioned prefix). |
| SEC-6 | deferred-out-of-scope | exploreGraph unreachable from this feature; add trusted-input comment when graph explorer ships. |
| SEC-7 | deferred-out-of-scope | Accepted by design (public repo, public vars); ops hardening is Phase 5. |
| SEC-8 | dropped-as-noise | Loader returns boolean only; RR7 boundaries don't leak stacks by default. |
| SEC-9 | rejected-with-rationale | Satisfied by COR-4's `xrefs:v1:` prefix. |
| SEC-10 | dropped-as-noise | Parameterized queries; Workers limits bound request size. |
| COR-1 | incorporated | KV namespace created + bound during implement; context assembly tolerates absent binding (cache optional). Safety carve-out. |
| COR-2 | incorporated | Assign singleton synchronously before any await; no async gap between check and set. |
| COR-3 | incorporated | buildVerseId() used everywhere; no inline ID construction. |
| COR-4 | incorporated | Cache key `xrefs:v1:{verseId}`; bump version on shape changes. |
| COR-5 | incorporated | Security headers applied by wrapping the single requestHandler return (covers thrown 404s). |
| COR-6 | rejected-with-rationale | Thundering herd accepted at current traffic; documented limitation. |
| COR-7 | incorporated | neo4j-http gains configurable timeoutMs (default 20s); web app passes 5s interactive budget. |
| COR-8 | dropped-as-noise | Argues against unwritten code; single parse path will be used. |
| COR-9 | rejected-with-rationale | Hyperdrive upstream pooling absorbs dead connections; liveness check duplicates its job. |
| COR-10 | dropped-as-noise | Generic Neo4j-throws test already covers config-error path. |
| PERF-1 | incorporated | New single-query getAllBooks(db); home loader = 2 queries total (volumes + books), grouped in JS. |
| PERF-2 | rejected-with-rationale | PG-read caching deliberately out of scope this phase; Hyperdrive edge-caches non-mutating queries. |
| PERF-3 | incorporated | Same fix as COR-7 (5s interactive timeout). |
| PERF-4 | rejected-with-rationale | Same scope decision as PERF-2. |
| PERF-5 | dropped-as-noise | Speculative; Workers fetch reuses origin connections. |
| PERF-6 | dropped-as-noise | Self-admitted accepted risk at near-zero traffic. |
| PERF-7 | dropped-as-noise | Duplicate of PERF-1 root cause; proposed fix self-contradicted. |
| PERF-8 | dropped-as-noise | Premise falsified — harness already asserts single transform. |
| PERF-9 | dropped-as-noise | Self-admitted no-code-change observation. |
| PERF-10 | deferred-out-of-scope | Keepalive cron explicitly deferred by user; Phase 5 ops. |
| OBS-1 | incorporated | Structured console.error in Neo4j catch (event, error name, bookId, chapter). |
| OBS-2 | incorporated | One structured log line in KV catch (op, key). |
| OBS-3 | dropped-as-noise | Duplicate of OBS-1. |
| OBS-4 | rejected-with-rationale | KV exposes hit/miss metrics natively; no new contract field. |
| OBS-5 | rejected-with-rationale | Timers are Phase 5; Workers trace view covers today. |
| OBS-6 | incorporated | Shared log.server.ts helper emitting single-line JSON, used by all catch sites. |
| OBS-7 | incorporated | Log singleton construction failure once at catch site before re-throw. |
| OBS-8 | rejected-with-rationale | graphDegraded copy is the diagnostic; env-conditional markers exceed need. |
| OBS-9 | deferred-out-of-scope | Phase 5 synthetic-check candidate. |
| OBS-10 | incorporated | Log error.name (Neo4jAuthError vs Neo4jQueryError) at OBS-1 site — fields already exist. |
| UX-1 | rejected-with-rationale | Scroll behavior inherent to approved SSR design; verse anchors (id="v{N}") ship anyway via UX-2/3 links. |
| UX-2 | incorporated | Cross-ref panel gets a close link back to the chapter URL. |
| UX-3 | incorporated | Prev/next chapter links (from chapter entity metadata / verses query). |
| UX-4 | rejected-with-rationale | Scoped inline copy retained as guidance; exact placement is design-pass territory. |
| UX-5 | deferred-out-of-scope | Real anchors by construction; focus styling belongs to design pass. |
| UX-6 | incorporated | h1 = chapter reference, main landmark, cross-refs in labeled section. |
| UX-7 | deferred-out-of-scope | Width constraint to design pass ("readable Tailwind" liberty stands). |
| UX-8 | dropped-as-noise | Self-flagged non-blocking. |
| UX-9 | rejected-with-rationale | Plain-text source label is the natural default rendering of the field. |
| UX-10 | incorporated | 404 boundary links back to /. |
| API-1 | incorporated | Non-canonical book slugs 301 to canonical URL (query string preserved). |
| API-2 | incorporated → human gate | /scripture + ?verse kept as proposed default; PRD is pre-migration artifact — final call at gate (Q-A). |
| API-3 | dropped-as-noise | Already resolved by plan Q3. |
| API-4 | incorporated | verses[] gains reference field (query already selects it). |
| API-5 | incorporated | 404 causes differentiated in thrown Response body + structured log. |
| API-6 | dropped-as-noise | Out-of-range ?verse follows the documented invalid-param contract. |
| API-7 | dropped-as-noise | No CDN cache layer exists in this architecture. |
| API-8 | incorporated | Cache key built from canonical bookId post-redirect (rides on API-1). |
| API-9 | dropped-as-noise | Speculative; home links use bookId by construction. |
| API-10 | dropped-as-noise | Same false premise as API-7. |

### Panel-2 dissent rates
security 7/10, correctness 5/10, performance 8/10, observability 5/10, ux 6/10, api-contract 5/10 — aggregate 60% (healthy skepticism, well above the 20% rubber-stamp floor).
