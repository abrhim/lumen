# Panel-2 adversarial — API-CONTRACT lane

- **Lane:** api-contract (panel-1 findings API-CONTRACT-1..10)
- **Date:** 2026-07-30
- **Tagger role:** PANEL-2 ADVERSARIAL, api-contract lane
- **Method:** every finding re-verified against the cited source (login.tsx,
  auth.confirm.tsx, notes.tsx, notes.$id.tsx, notes.server.ts, api.search.tsx,
  search.tsx, search-request.server.ts, components/editor/markdown.ts,
  notes.routes.test.ts) and against plan.md A1–A19 / gate rulings. Tags per
  references/adversarial.md; tie-break material > risky > out-of-scope > noise.

| ID | CP | Tag | Rationale (evidence-based) |
|---|---|---|---|
| API-CONTRACT-1 | CP-6 | material | Verified: login.tsx signed-in bounce is `redirect("/")` (:12), `emailRedirectTo` is a bare `${origin}/auth/confirm` (:31), auth.confirm.tsx redirects `"/"` on both verify paths (:75, :81); zero `next` reads in either file. A18's return leg does not exist despite the pipeline-status marker claiming "login next=" landed; the only pin (notes.routes.test.ts:107) asserts emission bytes only. Concede in full. |
| API-CONTRACT-2 | CP-5 | material | Verified: neither notes route exports `headers()`; loader `data(...)` responses and the `loginRedirect` 302 carry session headers with no Cache-Control (notes.tsx:21-42, notes.$id.tsx:46-102); the `json()` helper covers action JSON only. The B17 doctrine premise is real — api.search.tsx:238-240's own comment says `.data` responses take headers from the export, and search.tsx has both `withNoStore` and a `headers()` export (:228-232, :394-398). Minor overreach: "heuristically cacheable" overstates (no Last-Modified → most browsers compute no heuristic freshness), but bfcache/disk retention and the skipped house invariant stand regardless. |
| API-CONTRACT-3 | CP-24 | material | Verified: `getSessionUser` at notes.$id.tsx:144 and the kill-switch throw at :143 sit outside the try opening at :155; the route exports no ErrorBoundary; api.search.tsx:123-128 explicitly documents pool exhaustion as the reason its session read is inside its try. Fix is a straight mirror of the sibling pattern (headers-if-available), not new machinery — not risky. |
| API-CONTRACT-4 | CP-7 | material | Verified end to end: raw-byte 400 at :162/:182, canonical body stored at :171/:189/:208, append canonicalizes at :256 with no size check anywhere in the intent. Expansion mechanism confirmed in prosemirror-markdown@1.13.5 dist/index.js:822 — `esc()` backslash-escapes `` ` * \ ~ [ ] _ `` (text nodes serialize via `state.text` with escape on, markdown.ts:204-206), so metachar-heavy bodies double; sub-cap raw input can trip the DDL CHECK → 23514 → catch → 500 on deterministic client input. |
| API-CONTRACT-5 | CP-3 | material | Verified: in update (:208→:218), append (:259→:269-275), append_undo (:318→:326-335) the body commits before `getNoteAnchors`/`syncNoteAnchors`, both of which throw via `failWrite` (notes.server.ts:282-306); any throw lands in the blanket catch (:353-357) → 500 "could not be saved" after a committed write, and the stale baseRef then self-409s. The 200 + `anchors_synced:false` fix is proportionate (anchors are derived state, self-heal on next full save) — not risky. |
| API-CONTRACT-6 | CP-50 | out-of-scope | Shape asymmetry verified (:266, :308, :316, :324 return `{error, code:"stale"}` with no `current`; update attaches it at :223-233). But the finding over-extends A13: the ratified pin (plan.md A13) ties "409 + current row" to the LWW base-echo *update*; append/append_undo are sanctioned additive intents whose stale exits are preflight checks, and the route's own contract comment (:39) scopes the pin to update. No present consumer reads `current` even on update (CP-4); the only injured party is a future capture-intent consumer. Valid concern, future work — the plan-note alternative the finding itself offers is retro material. |
| API-CONTRACT-7 | CP-44 | material | Verified: loader :69-73 nulls an unresolvable `?anchor=` with no event, while readAnchors (:133) and append (:247) log `note_anchor_invalid_ref` on the same class of input, under a doctrine comment (:131-132) that declares invalid refs from own insert paths to be drift, not garbage. The prefill is populated by exactly those capture doors. One-line, already-allowlisted event; concede. |
| API-CONTRACT-8 | CP-47 | material | Verified: search.tsx:279 calls `getSessionUser` in the invalid-q + deferred branch outside the try that opens at :309 and owns the `logSearchFailed` + 500-with-headers contract (:383-388), while the hoist comment (:305-306) claims to "mirror api.search.tsx" — which keeps its session read inside its try (:131-134). That half is a real code defect. The api.search half (400→500 under pool failure post-deferral) is honestly framed as an accepted consequence to record; the composite still materially tightens the loader's own documented contract. |
| API-CONTRACT-9 | CP-45, CP-15 | material | Both items verified. (a) `extraGroups` is emitted whenever `notesGroup` exists, with no shortCircuit gate, on both surfaces (api.search.tsx:207-221, search.tsx:355-368) while the merge drops the group (:205/:351) — the log claims a group the response omits. (b) notes-only: `extractNotesScope` returns `canonRaw: null` (search-request.server.ts:50-52) → `parseScope(null)` → `scope` undefined at both log sites → notes-only searches recorded as unscoped, plus the synthesized `mode:"none"` shape feeds zeroResult — enforcing A4's "zeroResult unpolluted" pin, not relitigating it. One-line fixes. |
| API-CONTRACT-10 | CP-46, CP-6 | material | Verified: the F8 test's id `"dead-note"` (notes.routes.test.ts:115) fails UUID_RE, so the loader 404s at notes.$id.tsx:76-78 before the mocked `getNote → null` (:114) is ever consulted — the pin passes on path validation, not tombstone filtering, and would stay green if tombstones leaked from the mock. This is the protocol's canonical material shape: an invariant claimed covered but unverified. The A18 half duplicates API-CONTRACT-1's harness gap; keyed to CP-6. |

## Carve-out downgrade suggestions

None. The lane's one high-severity finding (API-CONTRACT-1, CP-6) verifies
in full and I tag it material — no downgrade suggested. (Strictly its
panel-1 category, `contract-not-implemented`, is outside the
security/data-loss/correctness carve-out set anyway; the merged CP-6 carries
SEC-5's security half, which I also do not contest — the open-redirect
hazard of the naive fix is real: `//evil` and `/\evil` survive a bare
leading-slash check.)

## Overall stance

Mostly signal — unusually so. Nine of ten findings survived line-level
re-verification, including the mechanism-level claims I set out to refute
(the prosemirror-markdown `esc()` byte expansion, the B17 headers-export
doctrine, `extractNotesScope`'s undefined-scope logging), and the lane's
"Verified clean" section shows the specialist did genuine refutation work
rather than volume-padding. The one tag withheld (API-CONTRACT-6) is an
over-extension of A13's update-scoped pin onto sanctioned additive intents
with no present consumer; everything else is a real contract defect with a
proportionate fix.
