# Panel 2 / api-contract ADVERSARIAL review — tske-cross-references plan

Verified against `packages/scripture/src/graph/find-cross-references.ts`,
`packages/scripture/src/graph/get-verse-connections.ts`,
`apps/web/app/routes/scripture.tsx`, `apps/web/app/lib/cache.server.ts`, and a
repo-wide grep for `getVerseConnections` / `findCrossReferences` callers.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| API-1 | material | Confirmed: no TS return shape given for `getCrossReferences` despite a stated future-MCP-adoption path. Cheap fix (write the interface), real future-rework risk. |
| API-2 | material | Confirmed by grep: `getVerseConnections`'s only caller is `scripture.tsx:231`; MCP's `find_cross_references` tool maps to the separate `findCrossReferences`. Plan's contract claim is factually wrong. |
| API-3 | noise | Overstated: scope item 3 already says "per-direction limit (default 20)" plainly; Q5 repeats it. No real ambiguity, just a terser restatement at L91. |
| API-4 | risky | Real gap, but plan explicitly routes this decision to "panels to weigh in" — which is this very review round — and the helper has no cross-system consumer, unlike API-1. |
| API-5 | out-of-scope | Asks for a pure volume→collection fn to serve MCP, but MCP adoption is explicitly punted by this plan's own Scope→Out list; nothing today needs a second caller. |
| API-6 | noise | `cachedJson` (`cache.server.ts`) always writes `expirationTtl`, no purge path exists anywhere in this codebase's KV usage — the "one line" the fix asks for restates an established, self-evident invariant. |
| API-7 | noise | Real wording drift (cites/cited-by vs References/Referenced by) but direction mapping is already unambiguous by precedent — current code's `cites`=outgoing/`citedBy`=incoming stays the obvious default. |

## Stance

API-1 and API-2 hold up under verification and stay material: API-2 in particular is a
plain factual error the grep disproves outright (`getVerseConnections` has one caller,
not an MCP one), and correcting it is a one-line fix with real downstream consequence —
if there's no MCP consumer to protect, the field should likely be dropped rather than
kept empty. API-1's missing return shape is real and cheap to fix given the plan itself
anticipates MCP adopting the function later.

API-4 is a genuine gap but downgraded to risky: the plan's own "panels to weigh in" line
is process working as intended (this round), and the helper it flags is internal to the
web panel with no cross-system exposure, unlike API-1. API-5 is downgraded further to
out-of-scope — it's asking the plan to design for an MCP consumer that the plan's own
Scope→Out section explicitly defers to a future feature.

API-3, API-6, and API-7 are downgraded to noise: API-3's "ambiguity" doesn't survive a
plain reading of scope item 3; API-6 asks the plan to restate a TTL-always invariant
that's already structural in `cachedJson` with no purge path anywhere in the codebase;
API-7 is a true wording inconsistency but has zero behavioral stakes given the existing
direction→label precedent in the current component.
