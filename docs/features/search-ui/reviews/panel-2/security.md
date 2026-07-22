# PANEL-2 / ADVERSARIAL — security meta-review of panel-1/security.md

Scope: search-ui PLAN (pre-implementation, harness red-first). Tagging every panel-1 row.
Tie-break precedence: material > risky > out-of-scope > noise.

## Stance

More signal than noise, but with real over-reach. The panel correctly targets
harness *completeness* on the two genuinely net-new attack surfaces this feature
adds — a client-suppliable cursor token (SU-1) and a public rendering surface
(SU-4, SU-5) — where the plan commits to a safe pattern but under-pins it. Two
findings, however, warn against unsafe patterns the harness/codec already
*structurally precludes* (SU-2: DB-free decode by signature; SU-3: injection
refuted by the file's drizzle-parameter discipline), and one (SU-6) proposes a
"fix" that would regress the plan's explicit `⌘K`-app-wide design while
preventing nothing.

## Tags

| ID | Tag | Rationale |
|----|-----|-----------|
| SU-1 | material | The live keyset test (search-cursor-harness.test.ts:30-56) exercises continuity only on the canon-dominated `scripture` group; the fully collection-gated legs (`entityLeg`/`episodes`/`art`/`words`) and the cross-visibility replay case (admin-minted cursor replayed by an anon session) are unpinned. The *leak itself is defended by construction* — the cursor payload (`v1\|qhash\|tier\|score\|id`, plan:26) excludes visibility and `visibleCollections` is re-derived fresh per request (api.search.tsx:92-100) — but on a client-suppliable token a "cursor cannot widen the collection set, no 500" negative test is a legitimate, non-regressive security assertion the plan lacks, and the guidance to place the keyset predicate *inside* the gated per-leg WHERE (not as an outer wrapper) is load-bearing for both the gate and pagination. |
| SU-2 | noise | The oracle SU-2 warns about is structurally precluded: `decodeSearchCursor(cursor, {q, scope})` takes no `db` handle (search-cursor-harness.test.ts:73), and every validation code (`cursor_scope`/`invalid`/`mismatch`) is produced by pure comparison — the F2-F4 tests pass with a mocked `searchAll` and an empty-db mock (api-search-cursor.test.ts:57-98). The plan defines exactly three cursor codes plus passthrough; there is no fourth "references-nothing-visible" response for an attacker to distinguish, so the differential-response oracle cannot exist without inventing a code the plan doesn't have. Asking to "state decode must be stateless" documents an invariant already true by signature — no shipped-quality change. |
| SU-3 | noise | Injection is refuted by the file's discipline: search.ts binds every user/DB string as a drizzle parameter (`${q}`, `${anyOf(...)}` — 136-144, 296-327), so a decoded cursor `id` reaches a keyset `>` comparison as a bound param, not spliced SQL — charset is irrelevant to safety. `escapeLike` is ILIKE-*wildcard* escaping (needed for `%`/`_` in LIKE), not applicable to a `>` comparison; the analogy is misplaced. F3 already rejects a 500-char and garbage `after` as `cursor_invalid` (api-search-cursor.test.ts:71-81). Real ids (verse ids, `episode_id#seq`, Strong's G/H codes) are pipe-free; a client-forged `id` with `\|` is either preserved by a bounded split or rejected — no security impact. The `after` length-cap ask is minor and overlaps deferred abuse-hardening (plan:28). |
| SU-4 | material | The private/no-store header is asserted only on the `?q=faith` happy path (search.loader.test.ts:55-58); the empty-state (69-73), thrown-400 (91-93), and reference-short-circuit (112-122) branches carry no header assertion, and there is no 500-branch assertion at all — yet the plan commits the header to "every response" (plan:21; search-endpoint decision 5:49, "200/400/500"). Even where the currently-missing branches are session-invariant, this is a real harness-completeness gap on a defense-in-depth header for a session-varying public surface behind Cloudflare edge caching; pinning it on all exit paths is cheap and non-regressive. |
| SU-5 | material | F12 (search.loader.test.ts:96-109) tests the *parser* (`parseMarks` → typed segments) but nothing tests the *renderer*. Snippets are plain-text-never-HTML by DB contract (search.ts:76; decision 5:46) and React auto-escapes children, so a plan-following port is safe — but nothing structurally precludes reassembling segments into an HTML string, and the binding mockup (`build-mockup.py` esc()/marks(), quotes-incomplete escaper + `innerHTML`) demonstrates exactly the unsafe technique. A net-new "renderer never uses `dangerouslySetInnerHTML` for snippet/title" assertion is a legitimate anti-XSS lock-in on a public surface. Parallel to SU-4: locks in a safe pattern the plan under-pins. |
| SU-6 | risky | The suggested fix (extend the "focused input suppresses global hotkeys" guard to cover `⌘K`) regresses the plan's explicit design: `⌘K` is intended app-wide (plan:24, "hotkeys app-wide"; F9:55, "open anywhere"), matching command-palette convention (Slack/Linear open `⌘K` from inside inputs). Suppressing it would break a deliberate feature while preventing nothing — a modifier chord cannot be typed literally, and the finding's own probe confirms the app is passwordless with no sensitive field to protect. The `/`-only guard is correct precisely because `/` is a literal typeable character and `⌘K` is not. Fix is net-negative. |

## Notes on residuals not raised (not scored — context for synthesis)

- The cursor format `v1|qhash|tier|score|id` omits `sub`, but the within-group
  sort key is `(tier, sub, score DESC, id)` (search.ts:271,328,369). For
  multi-`sub` single-scope groups (`scripture`: verse=0/jst=1; `episodes`:
  episode=0/moment=1) a keyset boundary on `sub` is possible — a *correctness*
  concern, outside this security lens, and not what SU-1 raised.
