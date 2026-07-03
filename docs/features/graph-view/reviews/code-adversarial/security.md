# Adversarial review — security.md (code-panel)

Verified against `apps/web/app/routes/scripture.tsx`,
`apps/web/app/lib/cache.server.ts`,
`packages/scripture/src/graph/get-neighborhood.ts`,
`scripts/backfill-neo4j-collections.mjs`, and (for CSEC-5) the vendored
`postgres` driver's `src/errors.js`/`src/index.js`. Precedence:
material > risky > out-of-scope > noise.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| CSEC-1 | material | Confirmed: unauth `?graph=` (70-char × 128-len keyspace) drives KV `put` per miss; free-tier write quota (1,000/day) is trivially exhausted, not "generous." |
| CSEC-2 | risky | Confirmed missing `LIMIT` on count subquery; real, but exploitability needs attacker-known hub ids and likely-small personal-graph scale bounds actual cost. |
| CSEC-3 | noise | Collision is structurally impossible today: `depth` is a compile-time `1\|2\|3` single digit, `collKey` is server-derived not attacker input, key is never re-parsed. |
| CSEC-4 | noise | Confirmed `entityId` is bound-param only, no `dangerouslySetInnerHTML` (per panel's own clean-list). Wider charset has no demonstrated exploit path — pure hygiene. |
| CSEC-5 | risky | Real scrub asymmetry vs. Neo4j path, but verified `postgres.js`/Node `URL`/`decodeURIComponent` never place the DSN in `.message` on reachable failure paths. |
| CSEC-6 | material | Confirmed already fixed: working tree has 0 NUL bytes (was 2 at HEAD); fix is uncommitted, so `git diff HEAD` still reports binary — commit it to close. |
| CSEC-7 | noise | Confirmed `pendingGraph.id` only reaches React-escaped text and `URLSearchParams.set` (auto-encoded); real fetch always re-validates via the server loader's `GRAPH_ID_RE`. |

## Stance

CSEC-1 is the only finding with a verified, trivially-triggerable, unauthenticated blast radius: the free-tier KV write budget (1,000/day, not "generous") is dwarfed by the combinatorial `?graph=` keyspace, so it stays material even though `cachedJson` fails open and the app degrades rather than crashes. CSEC-2 and CSEC-5 are legitimate code-quality/defense-in-depth gaps — real inconsistencies worth a small fix — but neither has a demonstrated exploit path today (CSEC-2 needs attacker-known hub ids against a probably-small graph; CSEC-5's supposed leak is blocked by the postgres driver's own error-message hygiene, verified directly in `src/errors.js`). CSEC-3, CSEC-4, and CSEC-7 are downgraded to noise on direct verification: each rests on an invariant (single-digit `depth` type, bound Cypher params, React auto-escaping + `URLSearchParams` encoding + server-side re-validation) that already holds structurally, not coincidentally. CSEC-6 is confirmed fixed in the working tree (0 NUL bytes vs. 2 at HEAD) but tagged material per instruction since the fix is uncommitted and the repository's committed history still carries the binary-diff problem until that lands.
