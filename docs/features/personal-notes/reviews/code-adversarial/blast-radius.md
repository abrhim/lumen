# Panel-2 adversarial — blast-radius lane

- **Lane:** blast-radius (panel-1 findings BR-1..BR-8)
- **Date:** 2026-07-30
- **Tagger role:** PANEL-2 ADVERSARIAL, blast-radius lane
- **Method:** every cited file/line re-read against the claim (scripture.tsx
  loader + loadChapterNoteAnchors, root.tsx, auth.server.ts, api.search.tsx,
  search.tsx, search-obs.server.ts, search-request.server.ts,
  packages/scripture/src/search.ts, notes-enabled.ts + all four gate sites,
  migrate-notes.mjs GRANTS_SQL, smoke-notes-rls.mjs sweep,
  admin-users.server.ts / entitlements.server.ts consumers, wrangler.json).

## Tags

| ID | CP | Tag | Rationale (evidence-based) |
|---|---|---|---|
| BR-1 | CP-8 | material | Verified in full, adversarially and it holds. The loader returns a bare object at scripture.tsx:693-719 — no `data(payload, {headers})` — while auth.server.ts:106 says rotated cookies "MUST" be attached by the caller. `grep shouldRevalidate` across root.tsx/scripture.tsx: zero hits; under RR 7.9.6 defaults the root loader does NOT re-run on a chapter→chapter client nav (child param change only, no search delta, no action), so the in-code "rides the root loader's headers" comment (scripture.tsx:327) is false on exactly the hot path — the finding correctly refutes the recorded acceptance's own justification. The alias-301 path (:577-583) self-carries headers for this precise bug class, so the proposed fix mirrors an existing house pattern, not new coupling. Regression reaches all signed-in reading, not just notes users. |
| BR-2 | CP-15 | material | Verified: notesOnly ⇒ `extractNotesScope` yields null canonRaw ⇒ `parseScope(null)` ⇒ `scope` undefined; synthetic `{groups: [], perGroup: {}, mode: "none"}` (api.search.tsx:171-176, search.tsx:329-334) flows into `logSearchExecuted`, where `scope ?? null` → null and `!degraded && after===undefined && [].every(...) && !reference` → `zeroResult: true` (search-obs.server.ts:51,59-63) — even with notes hits present in `extraGroups`. Directly pollutes the denominator A4 pinned as unpolluted. Fix is a one-line gate (`mode !== "none"`) plus a marker field — proportionate, no coupling. |
| BR-3 | CP-47 | noise | The verification itself is correct — I confirmed the deferred 400 attaches headers (api.search.tsx:141) and reproduces `badRequest`'s `{error, code}` key order through the same `json` helper, so bodies are byte-identical and the committed replay oracle passes. But the finding's only actionable output is "record the header delta" against a header-level diff that does not exist in the harness; the sharper content in CP-47 (search.tsx:279 early session read outside the try's 500 contract) came from API-CONTRACT-8, not this finding. A verified-clean observation with a speculative doc rider: noise. |
| BR-4 | CP-73 | noise | Verified: search.ts:684-695 is an identity filter for every canon input, `[]` still widens via `?.length` falsy → `[...GROUP_KEYS]`, and both consumers (api.search.tsx:190, search.tsx:345) canon-validate and skip searchAll on notesOnly — the early return is dead from all real callers, as claimed. Proposed fix is an optional comment on a path that panel-1 itself concedes is unreachable. Checked-clean restated; no shipped-quality change. |
| BR-5 | — (Verified clean) | noise | Spot-verified the load-bearing claims: `GROUP_LABELS`/`GROUP_ICONS` are indexed only from `included`/`GROUP_KEYS`-derived keys (search.tsx:1206, 1420-1425 — `included.map`), `TYPE_ICONS` was widened WITH the `note` entry (:427-442), and `GROUP_RESULT_TYPES` has no non-test app consumer (repo grep: zero hits). Correct and valuable as an audit record, but it proposes nothing and changes nothing shipped — the definitionally honest tag for a checked-clean lane. |
| BR-6 | — (Verified clean) | noise | Verified all four gates: notes.tsx:28 / notes.$id.tsx:65,143 throw 404 before any auth work; scripture.tsx:335 short-circuits before `hasAuthCookie`; api.search.tsx:139-142 + search.tsx:314-320 replay the frozen 400 / skip the leg; media.tsx:224 ANDs `notesEnabled` into `canCapture`; wrangler.json:29 carries the var. Off = pre-feature holds as claimed. Checked-clean confirmation of an A16 pin — no change to ship. |
| BR-7 | CP-21 | material | The concession half verifies (admin-users.server.ts and entitlements.server.ts read the revoked tables via `context.db`/lumen_read only — grants to authenticated/anon were never load-bearing), and so does the defect half: smoke-notes-rls.mjs:186-189 filters `grantee IN ('authenticated','anon')`, so a PUBLIC-grantee table grant is invisible to the negative-space invariant while `GRANT USAGE` (migrate-notes.mjs:199) would activate it through PostgREST. A security invariant that structurally cannot see one grantee class is a real gap even with today's live probe at zero; the fix is one filter literal plus one conventions line — cheap, no coupling. The lane's honest low-severity framing ("hardening, not exposure") is exactly right and does not make it noise. |
| BR-8 | — (Verified clean) | noise | The interleaving hunt matches the code: deferred path skips limit/cursor reads (api.search.tsx:88, 101), `scope=notes,bogus` falls through re-`parseScope` to the identical bytes, and `mergeNotesGroup(g, null)` returns canon by reference. Both footnotes are accurate context (shared dev/prod Supabase project; origin/main is the ref tracking deployed prod), but neither changes code or harness — the divergence-check footnote is worth one line in the deploy checklist and should ride to retro learnings, which is precisely what the noise→retro pipeline does. |

## Carve-out downgrade suggestions

None. BR-1 is the lane's only high-severity finding; as filed its category is
"session-integrity / regression outside feature" (CP-8: "blast-radius /
session-integrity"), so it does not literally sit in the
security/data-loss/correctness carve-out set — but no downgrade is suggested
either way: it verified end-to-end and is tagged material on merit.

## Overall stance

Mostly signal — this is the strongest kind of panel-1 lane: two findings that
survive full adversarial re-verification against the code (BR-1 even refutes
the in-code comment that recorded the regression as accepted, which is exactly
what a blast-radius lane exists to do), one cheap real hardening gap (BR-7),
and five noise tags that are concessions of verified cleanliness rather than
criticism. The checked-clean lanes (BR-5/6/8) are enumerated with citations
precise enough to re-audit in minutes, which is what made this review cheap;
their noise tags reflect the taxonomy ("no change to shipped quality"), not
low quality.
