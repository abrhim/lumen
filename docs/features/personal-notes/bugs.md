# Bugs — personal-notes (step 11 bug filter)

Classified 2026-07-30 from `code-panel.md` (CP-1..73) under
`references/bug-filter.md`, honoring `code-adversarial.md` final tags
(61 material / 2 risky / 3 out-of-scope / 7 noise) and the meta red flags.
`state/corrections.md` contains no overrides. Settled human rulings
(G1/G5/G6, A18, A6/CF-36, PG-level tombstone invisibility + DEFINER
soft-delete, harness-revision 1) are treated as law — every confirmed bug
below *enforces* a ruling or fixes implementation; none challenges one.

Bucket rules applied: ≥2-reviewer convergence (post-dedup) → confirmed;
severity high/critical or tagged security/data-loss/correctness or touching
authn/authz/RLS/migration → never demoted (carve-out); genuinely
polish-judgment materials at single-digit-DAU scale → preference (the meta's
ux-leniency flag applied: CP-66/67/68 cut to preference).

One promotion against a panel-2 tag, recorded openly: **CP-50** was tagged
out-of-scope, but it contradicts ratified A13 ("staleness → 409 + current
row") — the bug-filter's contract rule makes that confirmed-bug, and the meta
itself flagged the tag as the panel's most contestable (red flag 6). Promoted
to B46 (low) with the one-line fix.

Step-12 rule in force: every confirmed bug of severity **med or higher gets a
failing repro test first** (marked REPRO). For harness-integrity items the
"repro" is the probe/invariant/negative-control itself, which must FAIL
against current code/config before the fix (marked REPRO=probe).

---

## Confirmed bugs

56 CPs in 53 work items, severity desc. Source/raised_by per item; full
claims and fix detail live in `code-panel.md` — lines here are the queue,
not the spec.

### Critical

#### B1: Autosave state-machine rework (the CP-1 cluster)
- Severity: critical · Categories: data-loss, autosave · REPRO
- Source: CP-1 (CORRECTNESS-1/2/12, UX-3, UX-14, PERFORMANCE-3) · Raised_by: [correctness, ux, performance]
- Five composing defects in `app/components/editor/NoteEditor.tsx`: in-flight
  success clears dirty over newer keystrokes; the debounce is not idle-based
  (inert ref in deps); failed saves never retry despite the copy; ⌘S/flush are
  silent no-ops mid-flight; /notes/new has no idle autosave at all. Violates
  ratified G5 "buffer never lost".
- Fix: the coherent five-part rework in CP-1 (pendingRef snapshot,
  imperative timer in dispatchTransaction, queuedRef, explicit retry,
  create-on-idle for /notes/new).
- Repro tests: type-during-in-flight-save must not mark clean; forced-500
  then type must retry.
- **Rider — CP-30 (risky, per meta ruling):** full-doc serialization per
  keystroke is a real but sub-millisecond defect whose panel-proposed fix
  (plumbing `viewRef` into the A19 crash boundary) risks the
  crash-preservation guarantee. SAFER FIX, designed here per the risky rule:
  implement only the debounce half — hang the serialization off B1(b)'s new
  imperative timer, keep `latestMdRef` as the boundary's sole source, do NOT
  touch `EditorBoundary.latestMarkdown()`. Free inside B1's rework; do not
  fix any other way.

#### B2: Note surface typography CSS (headings/lists/wikilinks flat)
- Severity: critical · Categories: ux · REPRO
- Source: CP-2 (UX-1) · Raised_by: [ux]
- No `.note-body`/`.note-editor`/`.note-wikilink[-dead]` styles exist and
  ProseMirror base css is never imported — A14 wikilink treatment and F5
  dead-ref styling unimplemented, editor feedback for the A17 legend's own
  constructs invisible. Carve-out: critical severity, never demotable.
- Fix per CP-2 (shared typography block per house style — see
  avoid-AI-UX-patterns memory, steal from reader). Repro: e2e computed-style
  probe (dotted underline on `.note-wikilink`) that fails today.

### High

#### B3: Write-path cluster — post-commit anchor failures + the 409 wedge
- Severity: high · Categories: correctness, atomicity, data-loss · REPRO
- Source: CP-3 (CORRECTNESS-5, API-CONTRACT-5, DATA-2, OBSERVABILITY-4) +
  CP-4 (CORRECTNESS-3, UX-7) · Raised_by: [correctness, api-contract,
  data-integrity, observability, ux] — CP-3 is the panel's highest-convergence
  finding (4 lanes)
- CP-3: body commits, anchor sync throws → false 500, stale baseRef,
  self-inflicted 409 loop, duplicate append on retry; inverse path silently
  drops the whole anchor diff with `ok: true`. CP-4: client ignores the 409's
  `current` payload → editor permanently wedged, Retry guaranteed to fail,
  offered exit destroys the buffer. One work item: both live in the
  update/append action ↔ NoteEditor result-effect seam and the fixes must
  agree on the 409/`updated_at` adoption protocol.
- Fix per CP-3 (isolated anchor-sync try → 200 + `anchors_synced: false`) and
  CP-4 (adopt `current.updated_at` as new base, Keep-mine/Take-theirs,
  suppress Retry on stale, beforeunload guard).
- Repro tests: anchor-sync failure returns 200 + fresh updated_at; 409 →
  next save succeeds (base re-adopted); append retry does not duplicate.

#### B4: `Cache-Control: private, no-store` missing on both notes routes
- Severity: high · Categories: security, response hygiene · REPRO
- Source: CP-5 (SEC-1, API-CONTRACT-2) · Raised_by: [security, api-contract]
- The two most private surfaces skip the documented house header invariant
  (B17/OC-4); `loginRedirect` 302s can carry rotated Set-Cookie uncached-
  directive-free. Carve-out-protected; severity stays high (the tagger's
  high→med sizing note is logged for retro, not acted on).
- Fix per CP-5 (shared `withNoStore`, `headers()` exports, decide
  scripture.tsx explicitly). Repro: route tests asserting the header on
  200/302/404 — fail today.

#### B5: `login?next=` minted but never consumed; consumer must be open-redirect-safe
- Severity: high · Categories: api-contract, authn · REPRO
- Source: CP-6 (API-CONTRACT-1, SEC-5, API-CONTRACT-10 half) · Raised_by:
  [api-contract, security]
- Ratified A18 contract is half-built (deep-linked note lands on `/` after
  login); the naive consumer is a phishing-grade open redirect
  (`//evil.com`, `/\evil.com`). Enforces A18, does not reopen it.
- Fix per CP-6 (`safeNext()`, thread through login + auth.confirm). Repro:
  rejected-fixture tests + full round-trip test — fail today.

#### B6: Size guard measures raw bytes, stores canonical bytes; `append` unguarded
- Severity: high · Categories: correctness, validation ordering · REPRO
- Source: CP-7 (CORRECTNESS-4, API-CONTRACT-4) · Raised_by: [correctness,
  api-contract]
- Canonicalization can 2× the bytes → DDL CHECK trips as an opaque 500 on
  deterministic client input; append can never 400. Also closes CP-19's
  oversized-label 500 (B18 covers the newline half).
- Fix per CP-7. Repro: 60,000×`*` update → 400 not 500 — fails today.

#### B7: Scripture loader mints session rotations it cannot commit (silent sign-out)
- Severity: high · Categories: blast-radius, session-integrity · REPRO (best-effort)
- Source: CP-8 (BR-1) · Raised_by: [blast-radius] — single lane, but
  carve-out (session/authn) and the tagger independently refuted the
  in-code comment
- Chapter→chapter nav with an expired token rotates the refresh token
  server-side and drops the Set-Cookie → token-family revocation → silent
  sign-out of ALL signed-in reading.
- Fix per CP-8 (return headers via `data(payload, {headers})`, or the
  no-refresh raw-token alternative). Repro: unit test that
  `loadChapterNoteAnchors` headers reach the loader response (full aged-token
  e2e is out of harness reach — record that in the test).
- Note: co-resolve the CP-71 preference rider (unbounded session read in the
  same function) while this file is open — see Preferences.

#### B8: DEFINER `soft_delete_note` never adversarially probed; smoke skips the app's real create shape
- Severity: high · Categories: data-integrity, test-gap · REPRO=probe
- Source: CP-9 (DATA-1) + CP-54 (DATA-7) · Raised_by: [data-integrity]
- The hand-written WHERE that IS the security wall (post harness-revision 1)
  has no cross-user or anon probe; creation is probed via raw inserts the app
  never uses, leaving the RPC's atomicity/owner-default/double-delete
  behavior untested. Enforces the ratified DEFINER design by pinning it.
- Fix: the ~10-line probes from CP-9 + CP-54 in `smoke-notes-rls.mjs`.
  The probes are the repro (they must be demonstrably absent today; each
  must fail if its guarantee is broken).

#### B9: Bundle oracle has a demonstrated false negative (shared split chunks)
- Severity: high · Categories: perf, test-gap · REPRO=probe
- Source: CP-10 (PERFORMANCE-1) · Raised_by: [performance] — verified by
  experiment
- `check-notes-bundle.mjs` passed while a probe import shipped 63 KB gz of
  editor deps into search.tsx's static closure.
- Fix per CP-10 (module-granular manifest, or content-scan stopgap). Repro:
  the documented probe-import negative control must FAIL the script.

#### B10: `[[` popup combobox ARIA wired to a non-focused wrapper div
- Severity: high · Categories: a11y · REPRO
- Source: CP-11 (A11Y-1) + CP-62 (A11Y-8, folds in at zero cost per panel-2)
  · Raised_by: [accessibility]
- `aria-activedescendant`/`aria-expanded` on a role-less ancestor are inert —
  the A10 combobox contract is programmatically absent in the `[[` posture.
  CP-62 adds `aria-autocomplete="list"` + listbox name in the same edit.
- Fix per CP-11/CP-62 (attributes on `view.dom` via PM `attributes`).
  Repro: axe/e2e scan with the popup open (also unlocks B36) — fails today.

#### B11: Popup anchored to editor foot, not caret — off-screen in tall notes
- Severity: high · Categories: ux · REPRO
- Source: CP-12 (UX-2) · Raised_by: [ux]
- The universal insert door (A9) appears broken in any note taller than the
  viewport. Fix per CP-12 (`coordsAtPos` + flip). Repro: e2e typing `[[`
  at the top of a tall note asserts the listbox intersects the viewport.

#### B12: Search notes rows outside the roving tab-stop system; SR status says "0 results"
- Severity: high · Categories: ux, keyboard-access · REPRO
- Source: CP-13 (UX-4) · Raised_by: [ux] — all three sub-claims re-derived
  by panel-2
- Notes-only matches leave every row tabIndex −1 and announce "0 results"
  with rows on screen. Fix per CP-13. Repro: keyboard-nav e2e + statusText
  assertion — fail today.

#### B13: `note_write_failed` logs free-text `message` beyond the pinned shape
- Severity: high · Categories: obs, privacy · REPRO
- Source: CP-14 (OBSERVABILITY-1) · Raised_by: [observability]
- PG/PostgREST messages can embed ref_ids and user values outside the A13
  allowlist. **Preserve panel-2's net-new vector (meta flag 9): a
  client-supplied `base_updated_at` → PG 22P02 echoes the raw client string
  into the log — this is the repro fixture.** Also drop the off-shape
  `prev/new_updated_at` fields from `note_updated`.
- Fix per CP-14 (drop `message`; cause + pg_code suffice). Repro: the 22P02
  fixture asserting no client bytes reach the event.

### Medium

#### B14: Notes-only searches pollute zeroResult with `scope: null`
- Severity: med · Categories: obs, metric purity · REPRO
- Source: CP-15 (OBSERVABILITY-3, BR-2, API-CONTRACT-9b) · Raised_by:
  [observability, blast-radius, api-contract] — 3-lane convergence
- Violates A4's "zeroResult unpolluted" pin in the direction it didn't cover.
  Fix per CP-15 (gate on `meta.mode !== "none"` + explicit notes-only marker).

#### B15: Anchor writes unbounded and serialized; append replace-set deletes concurrent anchors
- Severity: med · Categories: data-integrity, perf, resource exhaustion · REPRO
- Source: CP-16 (SEC-4, DATA-3, PERFORMANCE-6/7) · Raised_by: [security,
  data-integrity, performance] — 3-lane convergence
- No anchor cap anywhere; per-row DELETE round-trips against the pool cap
  (documented incident class); delete-first ordering loses anchors mid-loop;
  capture is a 5-round-trip chain. Fix per CP-16 (MAX_ANCHORS=128 →
  400 `too_many_anchors`; idempotent single-row append upsert + targeted
  undo delete; batched deletes). Repro: over-cap body → 400; append does
  not delete a concurrently-added anchor.
- Interaction (panel-noted): the direct-upsert append fix makes CP-55's
  tombstone WITH CHECK gap more relevant — apply CP-55's one-line policy
  mirror (`AND deleted_at IS NULL` EXISTS clause) as part of THIS item even
  though CP-55 itself is noise-refuted standalone.

#### B16: Global Escape handler's async import makes `preventDefault` a structural no-op
- Severity: med · Categories: a11y, correctness · REPRO
- Source: CP-17 (CORRECTNESS-9, A11Y-2) · Raised_by: [correctness,
  accessibility]
- Doctrine 6's "innermost layer only" holds by luck, not construction.
  Fix per CP-17 (static import, synchronous pop). Repro: unit test that
  Escape with a registered layer is consumed same-tick.

#### B17: `lumenUrlToRef` never checks origin — foreign URLs silently become wikilinks
- Severity: med · Categories: correctness, input validation · REPRO
- Source: CP-18 (CORRECTNESS-8, SEC-9) · Raised_by: [correctness, security]
- `https://en.wikipedia.org/wiki/faith` → `[[faith]]`, pasted text destroyed.
  Fix per CP-18 (origin gate + entity-branch tightening). Repro: fixtures
  for foreign-origin URLs returning null.

#### B18: `sanitizeWikilinkLabel` passes newlines — labelled append bakes garbage, undo impossible
- Severity: med · Categories: correctness, markdown boundary · REPRO
- Source: CP-19 (CORRECTNESS-6, SEC-6) · Raised_by: [correctness, security]
- The sanitizer's documented re-tokenize guarantee is false for `\n`/`\r`.
  (Oversized-label half already closed by B6.) Fix per CP-19 (whitespace
  collapse + length cap). Repro: the dirty-label fixture set from CP-19.

#### B19: `lumen_read` default-privilege auto-grant never neutralized; CF-9 smoke check is hardcoded `true`
- Severity: med · Categories: security, harness integrity · REPRO=probe
- Source: CP-20 (SEC-3, DATA-6) · Raised_by: [security, data-integrity] —
  hardcoded-`true` byte-verified by both lanes
- Next `CREATE TABLE lumen.*` silently re-opens the D3 hole; the assertion
  guarding it cannot fail and launders the PASS count. Fix per CP-20
  (default-priv REVOKE + make the check real + grep for other
  `check(..., true, ...)`). The now-real check is the repro.

#### B20: Schema USAGE exposes pre-existing lumen RPCs via PUBLIC EXECUTE; sweep blind to functions and PUBLIC grantee
- Severity: med · Categories: security, privilege exposure · REPRO=probe
- Source: CP-21 (SEC-2, BR-7) · Raised_by: [security, blast-radius]
- Fix per CP-21 (REVOKE EXECUTE sweep + `has_function_privilege` invariant +
  `'PUBLIC'` in the sweep filter + conventions line). The new invariant is
  the repro.

#### B21: "Note deleted" live region mounts pre-populated — most SRs never speak it
- Severity: med · Categories: a11y, live-region · REPRO (best-effort)
- Source: CP-22 (A11Y-4, UX-11) · Raised_by: [accessibility, ux]
- Fix per CP-22 (mount empty, set in effect, clear history state). Repro:
  e2e asserting the region is empty on first paint and populated after —
  the mutation-ordering half of the guarantee; full SR behavior is
  best-effort by nature (record in the test).

#### B22: Full-body projection — /notes ships up to 12.8 MB to derive bounded titles/snippets
- Severity: med · Categories: perf, query projection · REPRO
- Source: CP-23 (PERFORMANCE-2/5) · Raised_by: [performance] — panel-2
  double-risky OVERRULED to material by meta (flag 3); split resolution
  honored
- **Scope per the meta's split ruling: the no-schema-change half only** —
  drop `body_md` from the `listNotes` read (derive from `title_line` + a
  bounded select), and trim the search leg's row transfer where possible
  without DDL. **The generated `snippet_source` column half is REJECTED,
  recorded verbatim per the meta: the tagger's title-derivation-divergence
  objection stands (a second derivation surface can drift from
  `deriveNoteTitle`/`deriveNoteSnippet`); revisit only with a
  divergence-proof design.** Repro: unit test pinning the list-read
  projection excludes `body_md`.

#### B23: notes.$id action runs `getSessionUser` + kill-switch outside its try
- Severity: med · Categories: api-contract, error shape · REPRO
- Source: CP-24 (API-CONTRACT-3) · Raised_by: [api-contract]
- A pool failure during autosave escapes the A13 JSON contract and swaps the
  page out from under the buffer — on the documented incident class.
  Fix per CP-24 (mirror api.search.tsx). Repro: mocked session-throw →
  JSON 500, not an ErrorBoundary swap.

#### B24: Chapter-anchor failures double-emit on every 750 ms timeout
- Severity: med · Categories: obs, emission count · REPRO
- Source: CP-25 (OBSERVABILITY-2) · Raised_by: [observability]
- Violates A5's one-event pin and inflates the write-failure signal.
  Fix per CP-25 (throw raw; loader owns the single emission — also removes
  the hot half of noise-tagged CP-59). Repro: forced-abort test asserting
  exactly one event.

#### B25: Non-NoteWriteError throws in the action are unlogged 500s
- Severity: med · Categories: obs, silent failure · REPRO
- Source: CP-26 (OBSERVABILITY-5) · Raised_by: [observability]
- Fix per CP-26 (catch-all logs `cause: "unknown"`, name only — no message,
  per B13). Repro: injected non-classified throw asserts one event.

#### B26: Write-failure classifier drift — dead "validation" cause, auth misfiled as "network", stray 2200N
- Severity: med · Categories: obs, taxonomy · REPRO
- Source: CP-27 (OBSERVABILITY-6) · Raised_by: [observability] — panel-2
  overreach note honored: `anchor_invalid` DOES emit; scope is the surviving
  ⅔ of claim (a) plus (b)/(c)
- Fix per CP-27. Repro: PGRST301 fixture classifies as auth/rls_denied,
  not network.

#### B27: Table-wide INSERT/UPDATE grants allow timestamp/tombstone tampering on own rows
- Severity: med · Categories: data-integrity, grants · REPRO=probe
- Source: CP-28 (DATA-4) · Raised_by: [data-integrity] — fix verified safe
  for app code by panel-2
- Fix per CP-28 (column-scoped grants + column_privileges invariant).
  The extended invariant + a born-dead-INSERT probe are the repro.

#### B28: Four-object index pin and `title_line` contract exist only in comments
- Severity: med · Categories: data-integrity, drift · REPRO=probe
- Source: CP-29 (DATA-5) · Raised_by: [data-integrity]
- Fix per CP-29 (two new invariants). The invariants are the repro.

#### B29: `[[` span never deactivates forward — kills auto-link for the session
- Severity: med · Categories: correctness, plugin state · REPRO
- Source: CP-31 (CORRECTNESS-7) · Raised_by: [correctness]
- Fix per CP-31. Repro: type complete `[[ref]]` by hand, then a canon
  reference — must still auto-link.

#### B30: Create branch sends only the prefill anchor — typed wikilinks yield no anchor rows
- Severity: med · Categories: correctness, anchor derivation · REPRO
- Source: CP-32 (CORRECTNESS-10) · Raised_by: [correctness]
- Violates A13's "body wikilinks become anchor rows"; CP-1 makes the
  self-heal unreliable. Fix per CP-32 (union `collectBodyRefs`). Repro:
  create-with-typed-wikilink asserts anchor rows.

#### B31: Reference detector swallows leading punctuation into span and label
- Severity: med · Categories: correctness, detector · REPRO
- Source: CP-33 (CORRECTNESS-11) · Raised_by: [correctness]
- Fix per CP-33. Repro: the `"...Alma 32:21"` / `"&Alma 32:21"` fixtures.

#### B32: Degraded notes leg invisible when canon is empty — zero view lies
- Severity: med · Categories: ux, degraded state · REPRO
- Source: CP-34 (UX-5) · Raised_by: [ux] — enforcement of ratified A4, not
  relitigation
- Fix per CP-34. Repro: degraded-leg + empty-canon render test asserting
  the one-liner.

#### B33: Delete dialog makes the 30-day purge promise the plan withheld
- Severity: med · Categories: ux, doctrine · REPRO
- Source: CP-35 (UX-6) · Raised_by: [ux] — enforcement of ratified A6/CF-36;
  the statement is currently false in both directions
- Fix: cut the sentence per CP-35. Repro: delete-confirm spec asserts the
  purge sentence is absent (trivial, but pins the doctrine).

#### B34: "Add to note" dead-ends forever once the last-touched note is deleted
- Severity: med · Categories: ux, dead state · REPRO
- Source: CP-37 (UX-9) · Raised_by: [ux]
- The core capture loop silently degrades permanently with copy diagnosing a
  transient failure. Fix per CP-37 (clear `lumen:last-note` on
  `not_found`, honest copy). Repro: delete-then-capture e2e asserts recovery
  to the New-note door.

#### B35: Failed editor-chunk load blows away a healthy read view
- Severity: med · Categories: ux, failure affordance · REPRO
- Source: CP-38 (UX-10) · Raised_by: [ux]
- Fix per CP-38 (error boundary around the Suspense with retry). Repro:
  simulated chunk rejection keeps the read view mounted.

#### B36: Listbox empty state is an invalid child of `role=listbox`
- Severity: med · Categories: a11y, aria · REPRO
- Source: CP-39 (A11Y-3) · Raised_by: [accessibility] — WCAG 1.3.1 /
  axe aria-required-children
- Fix per CP-39. Repro: rides B10's popup-open axe scan.

#### B37: Capture verbs drop focus to body on append/undo
- Severity: med · Categories: a11y, focus · REPRO
- Source: CP-40 (A11Y-5) · Raised_by: [accessibility] — the documented B5
  class this same file defends elsewhere
- Fix per CP-40 (symmetric focus handoff). Repro: e2e focus assertion after
  append and after undo.

#### B38: Editor "Done" exit drops focus to body
- Severity: med · Categories: a11y, focus · REPRO
- Source: CP-41 (A11Y-6) · Raised_by: [accessibility]
- Fix per CP-41 (focus the h1 that already carries `tabIndex={-1}`). Repro:
  e2e focus assertion on close.

#### B39: New `+ note` media door ships sub-contrast under the pre-existing exclusion; /media unscanned
- Severity: med · Categories: a11y, contrast, test gap · REPRO
- Source: CP-42 (A11Y-9) · Raised_by: [accessibility] — panel-2 discounted
  the rhetorical overreach; substantive claims verified. Pre-existing
  `.text-faint` debt itself NOT relitigated.
- Fix per CP-42 (`text-muted-foreground` + /media axe scan). Repro: the new
  scan.

### Low

#### B40: `NoteEditor.tsx` contains raw NUL bytes — git treats the feature's largest file as binary
- Severity: low · Categories: review integrity, hygiene
- Source: CP-43 (SEC-7, UX-12, a11y out-of-lane) · Raised_by: [security, ux,
  accessibility] — 3-lane convergence, byte-scanned by all three
- Fix per CP-43 (`\0` escapes, `.gitattributes`, optional lint).
  Control failure, not content (security read all 830 lines). Fix FIRST in
  step 13 so every subsequent editor diff is reviewable.

#### B41: `?anchor=` prefill drops invalid refs without the drift event
- Severity: low · Categories: obs, validation consistency
- Source: CP-44 (API-CONTRACT-7, OBSERVABILITY-8) · Raised_by: [api-contract,
  observability] — confirmed by the ≥2-reviewer rule
- Fix per CP-44 (one allowlisted log line in the loader's null branch).

#### B42: `extraGroups` claims notes hits on the reference short-circuit path
- Severity: low · Categories: obs, log truthfulness
- Source: CP-45 (OBSERVABILITY-10, API-CONTRACT-9a) · Raised_by:
  [observability, api-contract] — ≥2-reviewer rule
- Fix per CP-45 (`skipped: true` marker or omit, matching the response).

#### B43: F8 soft-delete unit test passes for the wrong reason
- Severity: low · Categories: harness quality
- Source: CP-46 (CORRECTNESS-16, API-CONTRACT-10 half) · Raised_by:
  [correctness, api-contract] — ≥2-reviewer rule
- Fix per CP-46 (valid UUID + assert `getNote` consulted).

#### B44: search.tsx early session read sits outside its own 500 contract
- Severity: low · Categories: api-contract, byte-freeze edge
- Source: CP-47, scoped to the API-CONTRACT-8 half per the meta's CP-level
  tie-break (flag 2) · Raised_by: [api-contract]
- Fix per CP-47 (try/catch + `logSearchFailed` + 500-with-headers). The
  BR-3 halves route to Deferred (header-delta plan note, healthy-path
  byte-freeze scope note).

#### B45: RPC invariant gaps + the 14-vs-15 invariant-count discrepancy
- Severity: low · Categories: harness integrity · **Blocks the deploy checklist**
- Source: CP-49 (SEC-10) · Raised_by: [security] — carve-out (RLS/migration
  adjacency), not demotable
- Fix per CP-49 (EXECUTE-revoke + `search_path=''` invariants on both
  functions; re-run COMMIT=1 and record the true count). Resolve BEFORE the
  A16 deploy checklist executes.

#### B46: append/append_undo stale 409s omit the `current` row A13 pins
- Severity: low · Categories: api-contract, asymmetry
- Source: CP-50 (API-CONTRACT-6) · Raised_by: [api-contract] — PROMOTED from
  out-of-scope (see header; bug-filter contract rule + meta flag 6)
- Fix: attach `current` (getNote already in hand on most paths), restoring
  one shape per A13. If Abram prefers the plan-note route instead, record
  the narrower capture-intent shape in A13 and close without code.

#### B47: Insert paths don't sanitize labels — editor shows text storage silently mutates
- Severity: low · Categories: correctness, markdown boundary — carve-out
  (correctness), not demotable
- Source: CP-52 (CORRECTNESS-14) · Raised_by: [correctness]
- Fix per CP-52 (sanitize at both insert sites).

#### B48: Suggestion `highlight` not reset on equal-length list change — Enter inserts the wrong destination
- Severity: low · Categories: correctness, popup commit — carve-out
  (correctness), not demotable
- Source: CP-53 (CORRECTNESS-15) · Raised_by: [correctness] — **preserve
  panel-2's strengthening (meta flag 9): the `slice(0, 6)` cap makes
  equal-length lists routine; that construction is the fixture**
- Fix per CP-53 (reset on list identity).

#### B49: Round-trip canary re-fires on failed saves and hashes the wrong body
- Severity: low · Categories: obs, event quality
- Source: CP-60 (OBSERVABILITY-9) · Raised_by: [observability] — contradicts
  A19's "reports once"
- Fix per CP-60 (clear after first carrying submit; hash `initialBody` or
  drop the hash).

#### B50: Identical auto-link announcements never re-announce
- Severity: low · Categories: a11y, live region
- Source: CP-61 (A11Y-7) · Raised_by: [accessibility]
- Fix per CP-61 (timeout-clear or zero-width-space alternation).

#### B51: ⌘K popup has no outside-click dismissal — stuck `aria-expanded`, surprise selection jump
- Severity: low · Categories: a11y, interaction
- Source: CP-64 (A11Y-11) · Raised_by: [accessibility] — meta flag 7 honored
- Fix: pointerdown-outside listener running the SAME close path as the
  registry entry — **restore-on-every-close, exactly as A10 ratifies**. The
  panel's proposed keyboard-only-restore carve-out is NOT adopted (it
  conflicts with A10's wording); if pointer-close restore proves jarring in
  use, that is a gate question for Abram, not a silent code decision —
  flagged in Deferred.

#### B52: Media `+ note` door is hover-revealed — invisible on touch
- Severity: low · Categories: ux, mobile
- Source: CP-69 (UX-17) · Raised_by: [ux] — Q6 mobile is in scope and mobile
  is the recorded competitor gap, so this is a functional hole, not polish
- Fix per CP-69 (coarse-pointer reveal, hover on fine).

#### B53: `/search?scope=notes` renders a ghost state that claims a full-library search
- Severity: low · Categories: ux, dead state
- Source: CP-70 (UX-18) · Raised_by: [ux] — tagger explicitly considered and
  rejected out-of-scope; the contract is public per A4
- Fix per CP-70 (echo notes-only in loaderData + honest scope line, or
  normalize the URL).

#### B54: Chromium keystroke-reveal scrolls tall notes to their foot (filed + fixed step 13)
- Severity: high · Categories: ux, editor, upstream-browser · Filed 2026-07-30
  during step-13 integration; root-caused and fixed same day.
- Symptom: in a note taller than the viewport, the page smooth-scrolls toward
  the editor's foot during/after typing — the "chaotic jumps" that polluted
  B11/B50/B51 spec runs.
- Forensics (full trail in step-13 work): no JS caller — every scroll API
  trapped (scrollIntoView, scrollTo/By/scroll, scrollTop setter, focus), all
  silent. Reproduces at the pre-feature baseline (24ca795 worktree).
  Content-independent: bare `z` (1 keystroke) scrolls fully to the document
  bottom; every candidate product trigger (popup mount, imperative combobox
  ARIA, role flip, `place()`, `setPopup`, `[[` activation dispatch,
  `overflow-anchor`) was bisected OUT — the scroll survives with all of them
  suppressed. Shape: Chromium starts a native eased reveal of the focused
  taller-than-viewport contenteditable on a keystroke; subsequent keystrokes
  cancel the running animation partway (hence the chaotic partial offsets:
  1 char → full bottom, 2 chars → ~1600px, sustained typing → near zero).
- Fix: caret-keeper guard in `NoteEditor.tsx` — on keydown with a VISIBLE
  caret, record `scrollY`; any page displacement > 160px within 700ms snaps
  back (`behavior: "instant"`). Genuine reveals (caret off-screen) and
  line-height nudges pass through. `overflow-anchor: none` on `html` kept
  as a separate stabilizer (CSS scroll anchoring compounded typing jitter).
- Verified: 5-scenario matrix (1 char / 2 chars / `[[` / `[[a` / paren
  control, delay 0 and 40ms) all pinned ≤48px; full fixes-editor suite 7/7.

---

## Preferences (may fix if cheap during step 13, else retro learnings)

Real observations, judgment-call quality improvements at single-digit-DAU
scale — not defects. The meta's ux-leniency flag (CP-66/67/68 named as first
cuts) is applied here.

- **CP-36** (med, ux) — capture-note titles render as raw slugs
  ("alma-32-21") instead of display labels; notes-derive's doc comment is
  also stale. Functional and readable; the labeled-prefill fix
  (`[[ref|Alma 32:21]]`) is worthwhile polish for the capture loop and cheap
  if B34/B52 already have the files open. Fix the false doc comment either
  way.
- **CP-65** (low, a11y) — save-state span announces every autosave cycle;
  loud failure is mandated, routine success is a design call. Cheap
  conditional `aria-live` if touched during B1.
- **CP-66** (low, ux) — legend suppressed forever under localStorage-throw
  (init fallback 3 vs the catch comment's stated intent) + hardcoded ⌘ on
  all platforms. Meta: weakest ux material tag.
- **CP-67** (low, ux) — brand-new empty note reports "Saved". One-line
  render guard; naturally rides B1's status-line work if cheap.
- **CP-68** (low, ux) — "Backspace to undo" copy is false for paste
  conversions. Either wording fix or plugin-state registration; judgment
  call.
- **CP-71** (low, perf) — unbounded session read ahead of the anchors leg's
  750 ms abort. Panel-2: accept-and-record is sufficient. Co-resolve with
  B7 while `loadChapterNoteAnchors` is open (one comment line minimum, the
  Promise.race variant optional).

---

## Deferred / follow-up (out-of-scope + audit record)

### Out-of-scope findings, each with the concrete home the meta demanded (flag 6)

- **CP-48** (low, security) — string-concatenated `.or()` filter in
  `getChapterNoteAnchors`; unreachable from any present caller. Home: file a
  follow-up issue "validate bookId/chapter at the notes.server.ts seam" +
  retro recommendation; fixture noted in CP-48 when picked up.
- **CP-58** (low, test hygiene) — smoke user cleanup can strand throwaway
  auth users (and e2e `createE2eUser` shares the gap). Home: fix "whenever
  the file is next touched" — B8 and B19 both touch `smoke-notes-rls.mjs`,
  so fold the try/finally + `Promise.allSettled` in there if convenient;
  otherwise retro backlog.

### Risky — rejected-with-rationale (NOT dropped-as-noise, per meta flag 4)

- **CP-57** (low, data-integrity) — the dormant `notes_delete` policy arms a
  future copy-pasted `GRANT DELETE`, reaching tombstones in the purge
  window. Both proposed fixes are rejected: dropping the policy breaks the
  pinned `notes_policy_set_is_four_per_command` invariant and relitigates
  ratified A6; editing an applied migration's policy for a threat gated
  behind a grant that is itself absence-pinned is churn without exposure.
  SAFER PATH ON RECORD: if/when a purge or hard-delete feature is built (the
  ratified trash/restore consequence), add `AND deleted_at IS NULL` to the
  USING clause in that migration and update the invariant in the same
  commit. Until then the absent-grant pin is the wall. → retro learnings +
  a one-line comment next to the policy in migrate-notes.mjs is the only
  present-day action.

### Audit record — BR-5/6/8 verified-clean entries (meta flag 5: routed here, not to noise)

- **BR-5** — type-widening consumer audit: every `Record<GroupKey, …>`
  indexer enumerated; no consumer breaks. Clean.
- **BR-6** — kill switch: NOTES_ENABLED=0 provably equals pre-feature at all
  four gates; `wrangler rollback` drops the var harmlessly. Clean.
  **Deploy-relevant: cite this verification in the A16 deploy checklist.**
- **BR-8** — signed-out byte-freeze interleaving hunt: clean; footnotes are
  deploy-relevant (grants already live under the pre-feature worker; the
  mandatory divergence check must run against origin/main, not stale local
  main — see also the gh-push memory: origin/main is frozen, backup refs
  only).
- Taxonomy gap (no "clean" tag forced these into noise) → retro protocol
  improvement item.

### Plan-note riders

- **CP-47/BR-3 halves:** record in plan.md that F2's byte-freeze is
  healthy-path-only under session-pool failure, and log the two observable
  header deltas next to the byte captures so a future header-level diff
  doesn't read as drift.
- **CP-5 scripture rider:** decide `Cache-Control` for signed-in
  scripture.tsx chapter responses (now carrying `noteAnchors` +
  `title_line`) — decide-or-record inside B4.
- **B51/CP-64 restore semantics:** if pointer-close selection-restore feels
  wrong in use, it is an A10 gate question for Abram.
- **B46/CP-50 alternative:** if the plan-note route is chosen over attaching
  `current`, amend A13's note accordingly.

---

## Dispositions (noise — one line each)

- **CP-51** — refuted/compliant: append canonicalization is A2-compliant; deliverable reduces to correcting the "byte-identical restore" comment (ride any B3/B6 edit of the append path).
- **CP-55** — refuted standalone (CAS blocks today's path; ms-scale, self-inflicted, purge-cascaded) — but its one-line WITH CHECK mirror is adopted inside B15, whose upsert fix widens the window.
- **CP-56** — refuted: `append_undo` 409s on base mismatch before touching anchors; the CAS the finding didn't credit structurally blocks the desync.
- **CP-59** — `op` field already disambiguates read/write; the one high-frequency offender is removed by B24; full event split not warranted.
- **CP-63** — escape-registry comment drift only; semantics sound; fix the prose if the file is touched (B16 touches its consumer, not the registry).
- **CP-72** — informational by its own declaration; bundle weight within the recorded A2/CF-56 acceptance → one line in state/learnings.md so the next server-side markdown consumer reuses the module.
- **CP-73** — checked-clean: searchAll early return is a dead structural backstop; optional one-line comment.

---

## Counts

| Bucket | CPs | Notes |
|---|---:|---|
| Confirmed bugs | **56** | 53 work items B1-B53; 55 material + CP-50 promoted |
| Preference | **6** | CP-36, CP-65, CP-66, CP-67, CP-68, CP-71 |
| Risky (recorded, safer path designed) | **2** | CP-30 (rider on B1), CP-57 (rejected-with-rationale, Deferred) |
| Out-of-scope / deferred | **2** | CP-48, CP-58 (+ BR-5/6/8 audit records, non-CP) |
| Noise dispositions | **7** | CP-51, 55, 56, 59, 63, 72, 73 |
| **Total** | **73** | |

- Needs-investigation: 0 — panel-2 verification (85% material, every
  high-severity claim independently re-derived) left no ambiguous facts to
  reproduce at this step.
- Repro-test load for step 12: **39 work items at severity ≥ med** (B1-B39),
  of which 6 are REPRO=probe (the probe/invariant is both repro and fix:
  B8, B9, B19, B20, B27, B28). B40-B53 (low) need no repro test per the
  skill; several carry cheap fixtures anyway (B48's slice(0,6) fixture is
  mandated by meta flag 9).
- Both panel-2 net-new contributions preserved (meta flag 9): the CP-14
  22P02 `base_updated_at` echo vector is B13's repro fixture; the CP-53
  `slice(0, 6)` proof is B48's fixture.
- Carve-out compliance: no high/critical or security/data-loss/correctness
  finding was bucketed below confirmed-bug. The single logged downgrade
  suggestion (CP-5 high→med sizing) was not acted on.
- Sequencing notes for step 13: B40 (NUL bytes) first — makes every later
  editor diff reviewable; B45 blocks the deploy checklist; B1+B2 are the
  criticals; B3 before any append-path work; B15 carries CP-55's policy
  line; B7 carries CP-71's comment.

## Provenance histogram (coarse, for retro — refine per-item at step 14)

Attributed by earliest-gate rule at work-item granularity. Most items are
implementation defects surfaced by panel-1 at step 9 — the pipeline working
as designed — so they file under "emergent".

| Origin | Count | Basis |
|---|---:|---|
| Should have been caught by plan | 0 | no confirmed bug traces to a wrong/missing plan invariant |
| Should have been caught by harness | 9 | B1, B2 (green suites structurally blind: no concurrent-typing test, no computed-style probe), B8, B9, B19, B28, B43, B45 (test-gap/oracle/invariant defects), B5 (harness pinned A18 emission only, never consumption) |
| Should have been caught by panel-1 | 0 | — |
| Should have been caught by panel-2 | 0 | no confirmed bug was noise/risky-suppressed (meta tie-breaks prevented CP-23/CP-47; recorded) |
| Genuinely emergent / implementation | 44 | remaining work items |
