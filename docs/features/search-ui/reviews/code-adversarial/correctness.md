# Code-adversarial — correctness (search-ui)

Adversarial meta-review of code-panel/correctness.md. Diff f352bae..HEAD (c1bf07b) on
feature/search-ui; LIVE worker probed GET-only, DB untouched (dup reproduced from the API
response alone). Reviewed commit was 46d888d/fd093ed4; HEAD adds only A10 syntax-help + a
main merge — none of these findings are fixed by the later commits (re-verified live where
observable). Every row tagged; no source modified.

| ID | Tag | Rationale |
|----|-----|-----------|
| CC-1 | material | Reproduced LIVE on current worker: `q=israel&scope=episodes&limit=8` serves `unshaken-O3SiM9Yi940#144` on BOTH page 1 and page 2. `mintNextCursor` reads `sortResults` JS code-unit order (last = `ki0bTvQsaCo#356`, cursor `…\|unshaken-ki0bTvQsaCo#356`) while `keysetAfter` `id > ` and leg `ORDER BY … id` run the column's en_US collation (O3Si > ki0b, case-insensitive o>k) → served tie member re-admitted. F1 "no duplicate" violated on the shipped API; harness passes only because verse ids are collation-neutral. |
| CC-2 | material | Code-traced at HEAD: `onInputChange` (:615-629) never resets `extra`; the commit-discard effect keys on `[location.key, q]` (:596), neither of which live-typing changes. So on a single-scope page with appended pages, `mergedSingle` (:765) merges old-q pages under new-q base and `currentCursor` (:766) prefers stale `extra.nextCursor` → More fetches new q + old-q cursor → deterministic `cursor_mismatch`. Real, visible defect. |
| CC-3 | material | Reset effect (:591-596) nulls `live`/`extra` but not `pendingCursorRef.current`; an in-flight More landing after an Enter-commit (same scope, new q) passes the `:605` gate and `setExtra` appends old-q rows to the new page. Author's own guard was meant to discard commit-crossing results; it's incomplete. |
| CC-4 | material | LIVE-confirmed `/api/search.data?q=x` turbo-stream encodes `{error,code}` as DATA (returned, not thrown), so `fetcher.data.groups` is undefined; `pageFetcher` effect `d.groups.find` (:607) is unguarded → synchronous TypeError in a useEffect → route ErrorBoundary swaps the page, input lost. Deterministically reachable via CC-2/CC-3; OU-3 accepts server-log signal, not a self-inflicted full-page crash. Fix (Array.isArray guard) is regression-free. |
| CC-5 | material | LIVE: `q=pgp` → `reference.found` volume + all 7 groups empty; `/search?q=pgp` SSR shows "Nothing in the library matches" with 0 Reference blocks (grep-verified). Render gate `view==="reference" \|\| (view==="results" && displayReference)` (:1011) drops the reference when zero hits force `view==="zero"`. Residual B-U2 mode (reference suppressed) — house fix-the-mode rule → material. |
| CC-6 | material | `onInputChange` gates only `< qMin`, never `> Q_MAX` (search-request.server Q_MAX=200), and the `d.query` guard (:600) silently discards any error body. A >200-char live query (400 q_length) or a transient live-fetch failure, when `display` is null, leaves `view==="pending"`: blank body, empty status, no feedback. Verified 400 shape live; low severity but a real behavioral gap, not on any deferred list. |
| CC-7 | material | Verified: episode ref_ids are mixed-case (`O3Si…` vs `ki0b…` flip between en_US and JS code-unit) while verse ids are collation-neutral — F1/F15 pin only the scripture leg, so the exact legs where CC-1 lives are unpinned. In-scope harness deliverable (drift harness-hash covers it); concrete red-today fixture proposed. Distinct from CC-1, not a restatement. |

## Stance

I confirm all 7 correctness findings as **material** — 0 downgrades. This is a strong,
evidence-backed panel and skepticism did not dislodge any row. The three highest-impact
claims were reproduced LIVE on the current worker (CC-1 duplicate across the page boundary;
CC-4 error-as-DATA turbo-stream shape; CC-5 reference lead suppressed in the zero state);
CC-2/CC-3/CC-6 were traced in HEAD's source and turn on state that provably survives the
paths they name (`extra` across live-typing, `pendingCursorRef` across a commit, the
`d.query`/`d.groups` guards). CC-7 is the in-scope harness counterpart to CC-1 and is
independently actionable, not a restatement.

CC-1 is the headline: F1's ratified "no duplicate, no gap" contract is broken on the
deployed API for every leg with mixed-case ref_ids (episodes/art/words) — the JS-minted
cursor and the SQL en_US keyset disagree inside score ties. The web UI's `dedupeMoments`
masks it; raw API / Ring-2 consumers see the dup. None of these are blessed deviations:
the plan's cursor bullet never addresses collation, OU-3 defers client telemetry (not a
license to crash the page), and the B-U2 fix left the zero-hits branch (CC-5) uncovered.
