# Panel-2 adversarial — SECURITY lane (personal-notes, step 9)

- **Lane:** security (panel-1 findings SEC-1..SEC-10)
- **Date:** 2026-07-30
- **Tagger role:** PANEL-2 ADVERSARIAL, security lane
- **Method:** every finding re-verified against the cited files/lines before
  tagging (not taken on trust). Key claims independently reproduced:
  `grep` for `Cache-Control`/`headers()` in both notes routes; `grep next`
  across login.tsx + auth.confirm.tsx (zero consumers); the literal `true`
  at smoke-notes-rls.mjs:185; the 15-entry `INVARIANTS` array vs plan.md's
  "14/14"; NUL bytes at NoteEditor.tsx:94/215 + `git diff --stat` showing
  `Bin 0 -> 28816 bytes`; the sequential per-row delete loop in
  `syncNoteAnchors`; the absent size guard in the `append` case; the absent
  origin check in `lumenUrlToRef`; the string-built `.or()` filter; the
  `create_rpc_present_and_invoker` invariant pinning only `NOT prosecdef`.

## Tags

| ID | CP | Tag | Rationale (evidence-based) |
|---|---|---|---|
| SEC-1 | CP-5 | material | Verified: neither notes route exports `headers()` and no loader exit or `loginRedirect` sets `Cache-Control`; only the action `json()` helper (notes.$id.tsx:54) does. The house invariant is real and uniform (search.tsx:230/396, api.search.tsx:38/239, book.tsx:34, scripture.tsx:582) and was skipped on exactly the personal-data route family. Fix mirrors the existing pattern — cheap, no new coupling. |
| SEC-2 | CP-21 | material | Verified: `GRANT USAGE ON SCHEMA lumen TO authenticated` (migrate-notes.mjs:199); the three pre-existing functions exist (migrate-search-kjv.mjs:26/38/46); the `ALTER DEFAULT PRIVILEGES` at :208 is forward-only; explicit revokes name only this migration's functions; and both the invariant (:265-270) and the smoke sweep (:186-191) query `role_table_grants` — tables/views only, structurally blind to `pg_proc.proacl`. The finding honestly sizes today's impact as low; the defect is the control gap, and the one-line blanket REVOKE + `has_function_privilege` invariant is proportionate. |
| SEC-3 | CP-20 | material | Verified verbatim: smoke-notes-rls.mjs:185 passes the literal `true` as the assertion argument — the queried `pg_default_acl` rows go only into the discarded detail string, so the check cannot fail for any DB state yet counts toward "PASS 19/19". The default ACL from setup-readonly-role.sql:16 is indeed never revoked in GRANTS_SQL (only the FUNCTIONS default-priv is), so the next `CREATE TABLE lumen.*` re-grants the app's shared search credential — the D3 hole reopened with no tripwire. (The check's own name admits "informational", which mitigates intent but not the inflated count.) |
| SEC-4 | CP-16 | material | Verified: `readAnchors`/`validateAnchorRefs`/`create_note_with_anchors(p_anchors)` are all unbounded; `collectBodyRefs` appends every unique body wikilink on every autosave (NoteEditor.tsx save()); `syncNoteAnchors` deletes one row per sequential PostgREST round trip (notes.server.ts:287-296). The Workers subrequest ceiling and the pool-cap-15 incident history are documented repo facts. The 1,000-delete worst case requires an already-large anchor set, but partial-sync-on-failure and pool pressure bite at moderate N, and data-integrity independently converged (DATA-3). Cap + batch is the right-sized fix. |
| SEC-5 | CP-6 | material | Verified: both notes routes mint `?next=`; `grep -n next` in login.tsx returns nothing and auth.confirm.tsx:75/81 hard-redirect to `/` — the A18-ratified contract is genuinely half-built (this ENFORCES a settled decision, not relitigates it). The open-redirect half is correct browser behavior (`//evil.com` and `/\evil.com` defeat a bare leading-slash check) and pre-empts the naive fix; the `safeNext` shape + rejected fixtures is sound. |
| SEC-6 | CP-19 | material | Verified: `sanitizeWikilinkLabel` is exactly `label.replace(/[[\]|]/g, "").trim()` (markdown.ts:165-167) — newlines survive — and the `append` case splices the wire-supplied label into `line` (notes.$id.tsx:250-251) with no `NOTE_BODY_MAX_BYTES` check anywhere in that path (confirmed absent between `getNote` and `updateNote`). Self-inflicted scope is honestly conceded (hence low), but the sanitizer's own documented guarantee is broken and the 500-instead-of-400 is a real contract defect; the one-line regex fix is safe. |
| SEC-7 | CP-43 | material | Verified: `git diff --stat` reports `Bin 0 -> 28816 bytes`, `file` says `data`, and NUL bytes sit at lines 94 and 215 (two each). The largest and most security-relevant client file in the feature genuinely produced no reviewable diff, no blame, no textual merge. Content-level all-clear is credible (the lane read all 830 lines), but the control failure is real and the fix (`\0` escapes + `.gitattributes`) is trivial and prevents recurrence. |
| SEC-8 | CP-48 | out-of-scope | Verified: the `.or()` filter is string-built (notes.server.ts:172-174). But the finding itself concedes it is "not a live vulnerability": the sole caller passes `parseReference` output + a `^\d+$`-matched chapter, and RLS confines any restructured predicate to the caller's own rows in every future where `notesClient` (user JWT) is the client — worst case is wrong results for the user themself, not leakage. The concern is valid only for hypothetical future callers of the seam; that is future-hardening work, not a defect in what ships. |
| SEC-9 | CP-18 | material | Verified: `lumenUrlToRef` (NoteEditor.tsx:220-243) inspects only `pathname`/`searchParams` — no origin check exists — and the bare two-segment entity branch converts any host's `/x/<entity-slug>` URL. `handlePaste` consumes the paste, so the user's external URL is destroyed and replaced by an unrelated internal link. Fail-safe direction honestly conceded (no XSS/redirect), but it deviates from the spec's own "pasted **Lumen** URL" wording and correctness independently rated it medium (CORRECTNESS-8). One-line origin gate. |
| SEC-10 | CP-49 | material | Verified all three items: `create_rpc_present_and_invoker` (migrate-notes.mjs:310-315) pins only `NOT p.prosecdef` while its soft-delete sibling pins EXECUTE state; no invariant anywhere checks `proconfig` for `search_path` (grep: only the two DDL occurrences at :151/:172) — a `CREATE OR REPLACE` dropping the clause on the BYPASSRLS-owned DEFINER function passes everything; and the `INVARIANTS` array has 15 entries against plan.md's recorded "applied, 14/14" — either one invariant never ran against prod or the record is stale, and it must be resolved before the deploy checklist executes. All three fixes are a few lines of SQL. |

## Carve-out downgrade suggestions

One, logged for retro only (the finding survives regardless):

- **SEC-1 (high → medium).** The exposure is browser disk cache /
  back-forward on shared devices plus a future-edge-rule hazard — the finding
  itself concedes "not a live leak today" (no Cache-Everything rule; no
  heuristic freshening without validators). API-CONTRACT-2 independently
  sized the identical issue medium. Counterweight: the repo's own doctrine
  (scripture.tsx:582, SECURITY-3) treats the Set-Cookie-replay class as
  security-mandatory, so high is defensible under house conventions — this
  is a sizing note, not a dispute of the defect.

## Overall stance

Mostly signal — unusually so. Every checkable claim in this lane reproduced
exactly at the cited lines, including the two easiest to overstate (the
hardcoded-`true` smoke assertion and the 14-vs-15 invariant count), and the
lane consistently sized its own exposure honestly downward (SEC-1 "not a live
leak today", SEC-8 "not a live vulnerability", SEC-9 "fail-safe direction")
rather than inflating. The six explicit clean-lane declarations (XSS,
byte-freeze, RLS app code, DEFINER body, header propagation, e2e secrets) are
themselves evidence of real verification work, not vibes. Nine of ten
findings tag material; the one exception (SEC-8) is the lane's own admitted
defense-in-depth item, correctly filed as future seam-hardening.
