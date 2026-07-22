# Panel-2 / blast-radius-rollback — adversarial review of Panel-1

Stance: mostly SIGNAL on the top three, noise on the bottom three. BRRU-1/2/3 each
catch a real, verifiable gap that a harness-first feature should pin and currently
doesn't — the F1 continuity oracle is a tautology, and the new `/search` route + global
modal both deviate from this app's own error-isolation convention. BRRU-4/5/6 are
accurate observations whose only in-scope resolution is a doc note (or, for BRRU-4, a
KV-gate that would be over-engineering for a solo-dev beta whose additive API co-reverts
harmlessly). Verified against the live files, not just the finding text.

| ID | Tag | Rationale |
|---|---|---|
| BRRU-1 | material | Confirmed in-file: `big` re-uses p1's exact params and `clampLimit` (search.ts:146-149) caps at 25, so `big.ids === ids1` is true by construction. F1's "no gap" guarantee is never exercised; a `>`/`>=` or lossy-score cursor bug at a tie boundary ships green. Codec test (line 71-75) also omits score from its assertion. |
| BRRU-2 | material | 8 content routes (book/scripture/media/node/word/scripture.art/admin.users/collections) each export their own `ErrorBoundary`; a route-level boundary renders in the Outlet slot and preserves root's `<AppMenu/>`. search.tsx (plan files-touched) has none, so the pinned bad-scope throw (search.loader.test.ts:91-93) bubbles to root and wipes AppMenu+orb — a deviation from the app's own convention, not a novel ask. Fix is low-risk and doesn't touch the pinned test. |
| BRRU-3 | material | Global orb+modal mounts inside root's `App` (root.tsx:74-83) with no route boundary beneath it; RR7 catches an App render throw at root's ErrorBoundary, replacing chrome on every route. The plan's own Tier line names this exact axis ("global modal mount … error-boundary blast radius"). Isolation wrapper + induced-throw test is a cheap, in-scope robustness addition. Boundary only catches render throws (not the effect/handler crashes the finding also lists), but render throws are real and severe. |
| BRRU-4 | noise | Verified: wrangler.json has a `CACHE` KV binding but no feature flag; premise holds. But the `/api/search` `after`/`nextCursor` addition is additive/optional, so a full-worker redeploy that co-reverts it is harmless — there is no real independent-rollback need. Fix is a doc note (noise) or a KV-gate on the global render path (unwarranted infra near the deferred abuse-hardening line). |
| BRRU-5 | noise | Verified: `@lumen/scripture` is `private:true`; the only `searchAll` importers are `api.search.tsx` + the definition (no MCP in repo). Optional `after`/`nextCursor` are additive, so the change is safe regardless of Ring-2 linkage; the finding only asks for one clarifying Prior-learnings line — doesn't change shipped quality. |
| BRRU-6 | noise | Finding self-admits mechanically safe. Verified: api.search.tsx:92-107 recomputes `visibleCollections` fresh per request; the keyset predicate `(tier,score,id) > cursor` against a shrunk visible set returns a correct subset — no dup, no gap, just fewer rows. Kill-switch flips mid-session are rare deliberate acts; an optional test at most. |

## Notes on disagreements with the specialist

- **BRRU-2/BRRU-3 understated their own strongest evidence.** The finding says "no
  existing isolation pattern to inherit" (true only for *class-component* boundaries
  around the modal). For the `/search` route itself, the pattern very much exists: 8
  route-level `ErrorBoundary` exports. That makes BRRU-2 stronger than written — search.tsx
  would be the lone content route without one.
- **BRRU-4's "Phase B precedent" framing is loose.** The `public=false` kill switch is a
  DATA/content toggle; Phase B *code* also rolls back via worker redeploy. So there's no
  code-level flag-flip precedent being violated. This is what pushes it to noise rather
  than material.
- **BRRU-4 factual correction (not fatal):** a `CACHE` KV binding already exists
  (wrangler.json:17-21), so the finding's "no KV" phrasing is imprecise — but no *flag*
  var exists, so the operative claim survives.
