# Security review — graph-view implementation

Scope: `packages/scripture/src/graph/get-neighborhood.ts`, `explore-graph.ts`,
`apps/web/app/routes/scripture.tsx` (loadGraph/GRAPH_ID_RE/clampDepth),
`scripts/backfill-neo4j-collections.mjs`, `apps/web/app/components/graph/*`.

**What checked out clean (no finding filed):** every Cypher node group in
`getNeighborhood`'s per-layer and edge subqueries carries a label constraint
(`centerUnion`/`nodeUnion`); the count subquery (SEC-3) reuses the identical
labeled `body` string as the collect subquery; `entityId`/`collections`
travel as bound params (`$id`/`$collections`) so `'`/`&` in `GRAPH_ID_RE`
create no Cypher-injection path; `relTypes`/`nodeTypes` are allowlist-checked
before being joined into the query text; `perDepthCap`/`totalCap` are
server-clamped (`clampCap`, get-neighborhood.ts:70-76); `explore-graph.ts`'s
depth-1 branch was rewritten with fresh label constraints, not copied
unlabeled; entity names render only as React text/attribute children (no
`dangerouslySetInnerHTML` anywhere under `components/graph` or
`scripture.tsx`) so entity-name XSS via SVG `<text>` or chip buttons is not
reachable.

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| CSEC-1 | High | `apps/web/app/routes/scripture.tsx:84-123` (`loadGraph`), `apps/web/app/lib/cache.server.ts:41-51` | `?graph=<anything>` matching `GRAPH_ID_RE` (~70 chars × 128 len) is cached 7 days incl. `found:false` results — unbounded junk keys drive KV write-amplification / cost DoS, no rate limit. | Rate-limit or cap distinct-key writes per IP; don't cache `found:false` (or cache it briefly, keyed/negative-TTL, not 7 days). |
| CSEC-2 | Medium | `packages/scripture/src/graph/get-neighborhood.ts:158-160` (count `CALL` block) | The per-layer `total` count subquery has no `LIMIT`; cost scales with real node degree, not `perDepthCap`/`totalCap`. Depth-3 requests against genuine hubs, replayed with rotating `entityId` to dodge the cache (CSEC-1), sustain Neo4j load. | Cap the count subquery too (e.g. `count(...) ` over a `LIMIT`-bounded match, or reuse the collected/limited set size + "at least N more" flag). |
| CSEC-3 | Low | `apps/web/app/routes/scripture.tsx:75,94` (`GRAPH_ID_RE`, cache key) | Cache key joins `entityId:depth:collKey` with raw `:`, and `GRAPH_ID_RE` allows `:` inside `entityId` — collision-freedom today rests on `depth` always rendering as one digit, not on real escaping (plan's SEC-5 "delimiter-safe" claim only covers `collections`). | Percent-/JSON-encode each component (or hash the tuple) before joining instead of relying on positional invariants. |
| CSEC-4 | Low | `apps/web/app/routes/scripture.tsx:75` | `GRAPH_ID_RE` permits `'`, `&`, space — unneeded since real entity ids are alnum/hyphen/colon (`scripts/backfill-neo4j-collections.mjs` namespacing) and the param is bound anyway; needless charset breadth adds review surface. | Narrow the regex to the actual id grammar (`[A-Za-z0-9:._-]{1,128}`) as defense-in-depth. |
| CSEC-5 | Medium | `scripts/backfill-neo4j-collections.mjs:95,127,260-263` | Only the Neo4j error path scrubs credentials (line 112 comment, SEC-10); `cfg.pgUrl` (DSN incl. password, from `HYPERDRIVE`) feeds `postgres()` directly, and any Postgres failure surfaces via the generic `catch (err) { log('backfill_fatal', {message: String(err.message)}) }` with no verified scrub. | Wrap Postgres calls the same way `neo4jQuery` wraps Neo4j: catch and rethrow a message stripped of the DSN before it reaches `log()`. |
| CSEC-6 | Medium | `scripts/backfill-neo4j-collections.mjs:59` | The new script contains two literal NUL (`0x00`) bytes as a key delimiter, which makes git treat the file as binary (diff shows "Binary files … differ") — the credentialed backfill script's actual content is invisible to normal diff-based review tooling. | Replace NUL delimiters with a printable separator (e.g. `` is still risky — use `JSON.stringify([from,to,rel_type])`); re-commit as text so future changes stay diff-reviewable. |
| CSEC-7 | Low | `apps/web/app/routes/scripture.tsx:318-323` (`pendingGraph`) | Optimistic client state reads `graph` off the pending navigation URL (`p.get("graph")`) without re-running `GRAPH_ID_RE`, unlike the loader's `graphId`; only feeds React-escaped text/dialog props today, but it's an unvalidated value flowing further than the server contract intends. | Validate `g` against the same `GRAPH_ID_RE` used server-side before assigning `pendingGraph.id`. |
