# Panel-1 aggregate — personal-notes (plan stage)

Aggregated from nine role reviews in `docs/features/personal-notes/reviews/panel-1/`
(security, correctness, api-contract, data-integrity, ux, accessibility,
performance, observability, blast-radius). Deduplicated by underlying issue;
severities preserved as assigned (max of merged, disagreements noted inline).
Order: severity desc, then convergence desc.

## Canonical findings

### CF-1: `notes` in GROUP_KEYS leaks the feature into every signed-out surface — F2 broken by design, and the red harness pins the wrong side
- **Severity:** Critical (BLAST-1/BLAST-2 critical; APIC-1 high; COR-8/SEC-7 med — severity disagreement noted)
- **Category:** api-contract
- **raised_by:** [SEC-7, COR-8, APIC-1, BLAST-1, BLAST-2]
- **Original IDs:** SEC-7, COR-8, APIC-1, BLAST-1, BLAST-2

**Claim.** GROUP_KEYS is the canon engine's live dispatch table, not a display list: `searchAll` defaults `scope = [...GROUP_KEYS]` (search.ts:679) and materializes one group per key (:690); `parseScope` validates against it and its `scope_unknown` 400 body enumerates it (search-request.server.ts:36,40); the /search page renders scope pills and computes `adaptiveLimit` from it (search.tsx:237, :648, :1104, :1284); `GROUP_LABELS: Record<GroupKey, string>` forces a compile-time "Notes" label. Adding `notes` therefore: (a) puts `{"key":"notes","results":[]}` at position 0 of every **signed-out** `/api/search` response — a bytes change and a feature-existence leak; (b) flips signed-out `scope=notes` from 400 to a degraded 200 (buildLegs has no notes branch — `legs[0].query` TypeError → caught → `combinedError` garbage-but-200, per BLAST-1; or silent skip, per SEC-7 — either way unpinned); (c) changes the signed-out `scope_unknown` error bytes; (d) shifts signed-out result density (7→8 groups in adaptiveLimit); (e) renders a signed-out "Notes" section/pill that can never fill. Worst: the committed red harness **pins** `GROUP_KEYS[0] === 'notes'` (notes-harness.test.ts:8) while the merge harness pins signed-out canon groups returned by reference untouched (notes-search-merge.test.ts:23-24) — the two tests contradict each other at the design level, and satisfying the first fires the F2 violation in prod (BLAST-2). Cursors minted for scope `notes` also become valid anonymous inputs on the lumen_read path (SEC-7).

**Proposed fix.** Notes is a ROUTE-LAYER group key, not an engine key. GROUP_KEYS stays frozen as the seven canon keys (the signed-out/SQL-engine contract); add `NOTES_GROUP_KEY = 'notes'`, `'note'` to ResultType, and a widened response-order constant (`SEARCH_RESPONSE_KEYS = [NOTES_GROUP_KEY, ...GROUP_KEYS]`) with `SearchGroup.key` typed over the union (BLAST-1; equivalently SEC-7/APIC-1's `CANON_GROUP_KEYS` split). searchAll throws-or-filters on non-canon keys so `notes` is structurally unreachable in the lumen_read leg builder. `parseScope` keeps today's vocabulary and error message verbatim for signed-out; the pill list renders from a session-aware group list. The route layer runs the PostgREST notes leg signed-in only and merges notes-first. Rewrite notes-harness.test.ts's first describe to pin the inverse invariant (GROUP_KEYS = seven canon keys, frozen); keep api-search.test.ts:38's hardcoded seven-key literal as the tripwire. Amend the ratified MUST wording: "signed-out: GROUP_KEYS order, byte-compatible; signed-in: optional notes group first."

### CF-2: F3 "byte-identity round-trip" is unachievable — prosemirror-markdown normalizes, and the harness's own fixtures sit in the normalized-away classes
- **Severity:** Critical
- **Category:** correctness
- **raised_by:** [COR-1]
- **Original IDs:** COR-1

**Claim.** `serializeNoteDoc(parseNoteMarkdown(md)) === md` cannot hold for arbitrary human-authored markdown: the default serializer emits `*` bullets (fixtures use `-`), no trailing newline (every fixture ends in `\n`), and escapes `[`/`]`/`` ` ``/`*`/`\`/`_` (the "literal text survives" test expects unescaped `![alt]`, which a correct serializer will never produce). Setext→ATX, `_em_`→`*em*`, hard-break and ordered-marker normalization are also reachable via paste. The harness will fail against a correct implementation.

**Proposed fix.** Replace byte-round-trip with a **canonical-form invariant**: define `C(md) = serialize(parse(md))` with a house-configured serializer (`-` bullets, `*` emphasis, ATX headings, trailing `\n`); pin (a) idempotency `C(C(md)) === C(md)`, (b) every save path stores `C` (all stored bodies canonical from birth), (c) no dirty on no-op open→close. Rewrite ROUND_TRIP_FIXTURES in canonical form; add a canonicalization-mapping table for non-canonical inputs; the literal-text test asserts semantic preservation, not substring containment.

### CF-3: The constrained-schema PM parser throws (not degrades) on out-of-schema markdown-it tokens — crash class on the save/open path
- **Severity:** Critical
- **Category:** correctness
- **raised_by:** [COR-2]
- **Original IDs:** COR-2

**Claim.** prosemirror-markdown's MarkdownParser throws on any token with no handler. The constrained schema (no code, hr, image, plain link) leaves commonmark-default tokens unhandled: `code_inline`, `code_block` (four-space indent — trivially reachable by paste), `fence`, `hr`, `link`, autolinks, `image`. A pasted backtick or indented line crashes parse → the note fails to open or save. The harness's literal-text test covers only image + raw HTML.

**Proposed fix.** The editor's markdown-it instance must `disable()` every rule outside the constrained set so out-of-schema constructs tokenize as plain text — the same whitelist D4 mandates for the renderer, via **one shared markdown-it configuration** for both parsers (drift between them means a body that renders fine crashes the editor). Extend the literal-text fixture table with `` `code` ``, indented lines, fences, `---`, `[a](b)`, `<https://x>`; assert parse never throws and text is preserved.

### CF-4: The route-layer notes leg has no failure/degradation/observability contract — a failed leg silently degrades, corrupts obs, or 500s the whole search
- **Severity:** High
- **Category:** obs
- **raised_by:** [OBS-1, PERF-3, COR-9, APIC-10, BLAST-9]
- **Original IDs:** OBS-1, PERF-3 (items 1–2, 5), COR-9 (failure half), APIC-10 (items 1–4), BLAST-9

**Claim.** D3 merges the notes leg outside `searchAll`, but the entire search obs contract keys off `result.meta.perGroup`: a notes-leg PostgREST failure emits no `search_group_degraded`, notes hits never reach `search_executed.groups`, and `zeroResult` is corrupted (canon-empty + notes-failed logs `zeroResult: true`) — OBS-1. User-facing, a degraded leg is indistinguishable from "you have no matching notes," which for personal notes reads as data loss. The plan also never says whether the leg is serialized or parallel (serialized adds a full PostgREST RT against the 500ms p95 budget — PERF-3), what happens when it fails (a 500 of the personal leg would take down the canon groups D3 deliberately isolated — COR-9), whether it runs on the reference short-circuit, or that empty-notes-group-dropped means clients can't distinguish "no hits" from "signed-out" (APIC-10). BLAST-9 adds: three existing pins (api-search.test.ts:38, search-harness.test.ts:202-205, search.loader.test.ts:80) must keep passing untouched — any red among them during implementation is a design violation.

**Proposed fix.** Pin in the plan: `Promise.all([searchAll, user ? notesLeg : null])` in api.search.tsx and the /search loader (no data dependency — session resolves before both); `abortSignal(400)` budget; on timeout/error the notes group degrades (present-but-empty with a degraded signal signed-in, or dropped — decide one; OBS-1 argues present+`degraded:true` with UI "Your notes are unavailable right now" since absence is semantically loaded) and canon groups are untouched; `logEvent("search_group_degraded", {key:"notes", message-or-code, ms})` reusing the existing event name, with `logSearchExecuted` extended (e.g. `extraGroups`) so `zeroResult` stays clean and `groups.notes` appears; the leg skips when searchAll short-circuits on a reference; ordering inside the group = `updated_at desc` (PostgREST can't ORDER BY ts_rank without an RPC — name-and-defer the rank RPC). Add F13: "notes leg degraded" with a vitest that aborts the mocked PostgREST call and asserts canon payload intact + one log line + `zeroResult === false`; signed-out asserts the key absent from response and logs.

### CF-5: Chapter-loader anchors fetch — placement, budget, degraded path, and the retired session-free invariant are all unspecified on the app's hottest route
- **Severity:** High
- **Category:** perf
- **raised_by:** [PERF-1, PERF-2, OBS-3, BLAST-3]
- **Original IDs:** PERF-1, PERF-2, OBS-3, BLAST-3 (items 1–2)

**Claim.** D5 says "one call, signed-in only" and nothing else. The scripture loader is session-free on its hot path by documented design (scripture.tsx:597-600); D5 adds a session read + PostgREST RT to every signed-in chapter load. Unnamed at plan time, this ships either as an unguarded `await` (a PostgREST misconfig/PGRST106/half-deploy 500s the reader for signed-in users only — the worst asymmetry) or a bare try/catch (dot silently missing, zero signal) — OBS-3. A naive serialization after the loader's single `Promise.all` adds ~30–100ms to signed-in chapter TTFB (PERF-1). The existing CPERF-6 query-count pins can't see the call (it's PostgREST-side, not `db.execute`), so a duplicated or signed-out fetch passes silently, and the PERF-4 verse-click loader re-run multiplies it (PERF-2). D5's "merge into verseSignals as 5th kind" also interleaves with the in-place media-gate mutation of the same object (BLAST-3.2). **Placement disagreement to resolve:** PERF-1 says the leg joins the existing `Promise.all` (getSessionUser is memoized/local-verify, so added wall-clock ≈ 0); BLAST-3 says keep it OUT of the critical `Promise.all` (different failure domain, don't extend the canon window) and return a separate additive loader field rather than mutating verseSignals.

**Proposed fix.** Pin in D5: the fetch is degraded-as-value — self-contained session→PostgREST chain with a hard abort budget (~750ms), failure → null anchors + `logEvent("note_anchors_degraded", {name, message, book, chapter})` — never a throw, never streamed (the dot SSRs with the chapter); privacy line: no userId, no verse list in the event. Signed-out cost stays zero via the `hasAuthCookie` short-circuit (the F2 mechanism, stated). Resolve the placement disagreement (in vs. out of the parallel window) and the shape question (5th verseSignals kind vs. separate additive `noteAnchors` field) at the gate. Amend CPERF-6: mock notes.server, `fetchChapterAnchors` ×1 signed-in / ×0 signed-out, `db.execute` stays 3 with an updated comment; record that the anchors leg belongs to the chapter-level segment when the PERF-4 nested-route split lands; rewrite (don't delete) the :598-600 invariant comment and document the expired-token inline-refresh regression.

### CF-6: Exposing schema `lumen` to PostgREST is schema-wide — `app_users` (definer view over auth.users), RLS-less tables, and `USING (true)` policies are one careless GRANT from public
- **Severity:** High
- **Category:** security
- **raised_by:** [SEC-1, BLAST-5, DATA-8]
- **Original IDs:** SEC-1, BLAST-5, DATA-8 (exposure half)

**Claim.** The write path requires adding `lumen` to Supabase's exposed schemas — exposure is per-schema (~18 tables, not 2). The schema was designed for a SELECT-only direct-DSN consumer: `lumen.app_users` is a postgres-owned `security_invoker = false` view over `auth.users` (email, name, last_sign_in, banned state — RLS cannot save a definer view); `roles`/`user_roles`/`transcripts`/`search_index`/others have RLS disabled entirely (a broad grant = total access; `GRANT ALL` copy-paste = self-service admin-entitlement escalation via `user_roles`); `lumen.collections` has `USING (true)` RLS while the Unshaken kill switch (`public=false`) is app-layer only — a grant to `authenticated` re-opens killed collections PostgREST-direct. Functions in an exposed schema become `/rpc/` candidates with EXECUTE granted to PUBLIC by default. Today this is latently safe (zero grants to anon/authenticated exist), but the moment someone "fixes" a PostgREST permission error with `GRANT SELECT ON ALL TABLES IN SCHEMA lumen TO authenticated`, the kill switch is decorative. The exposure step itself is a dashboard/Management-API config change — not SQL, not version-controlled, and silently divergeable between environments (DATA-8).

**Proposed fix.** The migration treats exposure as the dangerous half: `GRANT USAGE ON SCHEMA lumen TO authenticated` (nothing to anon); table-scoped CRUD grants on exactly the two notes tables and never anything else; explicit idempotent `REVOKE ALL ON lumen.app_users, lumen.user_roles, lumen.roles, lumen.migration_state FROM authenticated, anon`; `ALTER DEFAULT PRIVILEGES IN SCHEMA lumen REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`. Extend the smoke script into a negative-space sweep: `authenticated`/`anon` hold zero grants on every `lumen` relation except the two notes tables (query `role_table_grants` for the whole schema; probe `collections`/`user_roles`/`transcripts` by name as an authenticated PostgREST client expecting permission-denied). Document the exposure step as a manual per-environment gate item on the deploy checklist, with smoke-notes-rls as the drift detector (PGRST106 ⇒ exposure missing).

### CF-7: `?scope=notes` semantics are unspecified — and the naive route implementation (strip notes → searchAll with `[]`) returns ALL canon groups
- **Severity:** High
- **Category:** api-contract
- **raised_by:** [APIC-2, SEC-7, COR-8]
- **Original IDs:** APIC-2, SEC-7 (scope-definition half), COR-8 (item 1)

**Claim.** The plan says nothing about `scope=notes`. Three candidate behaviors (400 / empty group / route-side) and one trap: if the route strips `notes` from the parsed scope before calling searchAll, `scope=notes` alone yields `canonScope = []`, and searchAll treats an empty array as "no scope" → searches all seven canon groups (search.ts:679 — `opts.scope?.length` is falsy for `[]`). A signed-in user asking for only their notes gets scripture/people/places back. Signed-out `scope=notes` behavior must also be defined and pinned (SEC-7 recommends indistinguishable-from-no-notes; APIC-2 and COR-8's option (a) recommend keeping today's 400 verbatim so signed-out never learns the group exists — disagreement to ratify).

**Proposed fix.** Ratify the rule: signed-out `scope` containing `notes` → 400 `scope_unknown` with today's message verbatim (canon-only vocabulary; no feature-existence leak). Signed-in: route splits `scope → (canonScope, wantsNotes)`; if canonScope is empty, skip searchAll entirely and synthesize `{query, reference: null, groups: []}` before merging — never call searchAll with `[]`; document that reference resolution is forfeited on a notes-only scope. `/search` page loader follows the identical rule. Pin all three paths in the route harness.

### CF-8: Notes × cursor contract is unspecified — a full notes page either lies about being the end or mints a cursor that always 400s
- **Severity:** High (APIC-3 med-high; PERF-3 high; COR-9 med — max taken)
- **Category:** api-contract
- **raised_by:** [APIC-3, COR-9, PERF-3]
- **Original IDs:** APIC-3, COR-9 (cursor half), PERF-3 (item 3)

**Claim.** `SearchGroup.nextCursor` is contractually present when a page is full; cursors are keyset over `(tier, sub, score_bits, id)` minted inside searchAll's leg SQL and validated per (q, scope) before session work. The notes leg lives outside searchAll and PostgREST textSearch exposes no ts_rank/score_bits/keyset ORDER BY — so a full notes page either sets no cursor (silent truncation presented as end-of-set) or mints one that `decodeSearchCursor` kills (`cursor_invalid`) before the leg is consulted, or `after&scope=notes` passes the single-group gate and reaches a leg that cannot consume it. B1/B2 are the record of what under-specified cursor edges cost last time.

**Proposed fix.** Ratify: v1 notes group **never mints `nextCursor`** (absence = end of set per F5 semantics; at single-digit DAU a 25-cap page is the whole corpus; the group links to /notes for the full set — zero client changes since the append loop never engages without a cursor). `after` present AND scope includes `notes` → defined 400 (`cursor_scope`, message generalized), checked in the existing before-session block. Do NOT thread notes through `encodeSearchCursor`. Harness: a full notes page has no nextCursor; `scope=notes&after=x` → 400.

### CF-9: D3's "no grant to lumen_read" is defeated by an existing ALTER DEFAULT PRIVILEGES rule — the notes tables auto-grant SELECT at CREATE
- **Severity:** High
- **Category:** security
- **raised_by:** [SEC-2, DATA-1]
- **Original IDs:** SEC-2, DATA-1

**Claim.** `scripts/setup-readonly-role.sql:16` runs `ALTER DEFAULT PRIVILEGES IN SCHEMA lumen GRANT SELECT ON TABLES TO lumen_read`, attached to the admin role migrate-notes.mjs will connect as — so `CREATE TABLE lumen.notes` auto-grants SELECT to lumen_read the moment it runs. D3's headline ("leakage structurally impossible") ships false by default; "don't write a GRANT" ≠ "no grant exists." The smoke D3 probe would catch it post-migration but only when `ADMIN_DATABASE_URL` is set — it "skips with a warning" otherwise, so a green run proves nothing — and the migration as planned ships red on its own assertion, with the time-pressure fix likely being a weakened probe rather than a revoked grant.

**Proposed fix.** migrate-notes.mjs must, after CREATE: `REVOKE ALL ON lumen.notes, lumen.note_anchors FROM lumen_read;` (and from `anon`) with a comment naming setup-readonly-role.sql:16 as the reason; amend D3's wording from "no grant" to "explicit REVOKE (default privileges auto-grant)". Declare every notes RLS policy `TO authenticated` as a second structural wall (auth.uid() is NULL on the direct DSN anyway). Add a migration invariant (house `lumen_read_select_only` style): zero rows in `role_table_grants` for lumen_read/anon on both tables, exact CRUD set for authenticated. Extend the smoke D3 probe to check `pg_default_acl` and make it hard-fail (not skip) when ADMIN_DATABASE_URL is absent.

### CF-10: Soft-delete has no enforcement mechanism — live anchors resurrect deleted notes (ghost dots), and update-after-soft-delete silently "saves" to a tombstone
- **Severity:** High
- **Category:** data-loss
- **raised_by:** [COR-4, DATA-3]
- **Original IDs:** COR-4, DATA-3

**Claim.** D2 puts `deleted_at` on notes only; anchors cascade on hard delete, not soft. D5's plain anchors query returns anchors of soft-deleted notes — the margin dot and rail keep showing a note that 404s on click, violating F8 as specified. F8 is pinned only at the vitest mock layer ("getNote filters deleted_at" — assumed via mock, the exact mock-only-loader failure the plan's own Learnings warn about); nothing at the database layer enforces it, and every read path (index, note page, chapter anchors, search leg) plus every future surface (backlinks, Desk, graph) must independently remember the filter. Interleaving hole: tab 1 has the editor open, tab 2 soft-deletes, tab 1 saves — an unguarded `UPDATE WHERE id = X` succeeds against the tombstone; the user sees "saved," every read 404s, and a future restore silently resurfaces the post-delete edit.

**Proposed fix.** Enforce at RLS, the layer every path shares (DATA-3): notes SELECT policy `owner_id = (select auth.uid()) AND deleted_at IS NULL`; note_anchors SELECT policy adds `EXISTS (SELECT 1 FROM lumen.notes n WHERE n.id = note_id AND n.deleted_at IS NULL)` — kills the ghost-dot path for free (COR-4's alternative: inner-join embed or `live_note_anchors` view — the RLS variant covers all consumers). Every UPDATE (body and soft-delete itself) takes `WHERE deleted_at IS NULL`; 0 rows → 404/409, never "saved"; the soft-delete action must not chain `.select()` (the now-invisible row returns 0 rows — write and pin accordingly). The search leg carries the filter explicitly (pinned). Document: no trash/restore in v1. Smoke probes: A soft-deletes via the app's statement shape → A's own SELECT of note AND anchors returns 0 rows via PostgREST; an update attempt affects 0 rows.

### CF-11: `note_anchors` can be forged onto another user's note — FK checks bypass RLS; denormalized owner_id can drift
- **Severity:** High (DATA-2 high; SEC-4 med — disagreement noted)
- **Category:** security
- **raised_by:** [SEC-4, DATA-2]
- **Original IDs:** SEC-4, DATA-2

**Claim.** Postgres validates FKs as table owner, bypassing RLS. User B can insert `{note_id: <A's note>, owner_id: B, kind, ref_id}` — B's own WITH CHECK passes and the FK existence check succeeds against a note B cannot SELECT. Results: rows where `anchor.owner_id ≠ note.owner_id` (B's anchors decorating A's note lifecycle, cascade-deleted by A's actions, invisible and undeletable by B's victim); a note-existence oracle (FK violation vs success on guessed uuids — impractical with uuid4 but real if ids ever leak into URLs/logs); and any future join trusting anchor.owner_id crosses tenants.

**Proposed fix.** Make ownership agreement structural, no trigger needed: `ALTER TABLE lumen.notes ADD CONSTRAINT notes_id_owner_uniq UNIQUE (id, owner_id)`; declare the anchor FK as composite `FOREIGN KEY (note_id, owner_id) REFERENCES lumen.notes (id, owner_id) ON DELETE CASCADE`. A forged cross-owner anchor now fails the FK itself; drift is impossible by construction; cascade unchanged. Add the smoke probe: B inserts an anchor with note_id = A's note → rejected.

### CF-12: The insert posture "reuses" a SearchModal that cannot do the job — it is the first implementation of the §5 combobox contract, smuggled in as reuse
- **Severity:** High
- **Category:** a11y
- **raised_by:** [UX-2, A11Y-1]
- **Original IDs:** UX-2, A11Y-1

**Claim.** The shipped SearchModal is one input whose only outcome is `navigate('/search?q=…')` — no result rows, no listbox, no `role="combobox"`, no `aria-activedescendant`, no status region, no destination index (grep: zero combobox/listbox/activedescendant occurrences in apps/web). "Picks a destination" is precisely the part it lacks. What insert posture requires is the palette's §5 anatomy — combobox ARIA contract, destination-index rows, roving highlight, Enter-selects — scoped down: net-new palette work under the word "reuse," and exactly what cut-line 2 would cut. Shipping without it means the product's first picker lands below the AA floor.

**Proposed fix.** Rename the plan line: "insert-posture **palette** (new; shares SearchModal's shell/input styling; destination rows net-new, built to the §5 ARIA contract)" and cost it honestly against cut-line 2. Insert-mode deltas specified: activating an option inserts-and-closes (announcement "Inserted link to Alma 32:21," never "Navigating"); option accessible names carry type ("Rameumptom — place"); the `[[` autocomplete is the SAME contract hosted on the contenteditable (PM element carries aria-expanded/aria-controls/aria-haspopup/aria-activedescendant while DOM focus stays in the editor) — one implementation, three doors, one ARIA implementation. Data source client-side only for v1 (parseReference + the destination source mechanism 2 needs anyway; no /api/search leg — keeps it out of D3's blast radius). Foot line changes verb: `Enter to insert · Esc back to writing`. Add F-new: axe + manual SR pass in both postures. If the scope is too rich, cut Cmd+J and let `[[` carry v1 (see CF-38).

### CF-13: Focus-return-to-editor with PM selection intact is unspecified — the repo's worst recurring bug class (B-U1/B5/B9/B21), now with a selection to lose
- **Severity:** High
- **Category:** a11y
- **raised_by:** [A11Y-2, UX-2]
- **Original IDs:** A11Y-2, UX-2 (Esc/selection-restore bullet)

**Claim.** The insert posture's invoker is a selection inside a contenteditable, not a button. Radix's default close-focus restores the DOM element, not the PM selection; the shipped pointer-open pattern (openedByPointer → blur to body, the B-U1/B21 fix) is actively wrong here — a pointer-opened insert that blurs to body strands the user outside their note. "Selection becomes label" means the selection must survive the modal's focus theft, and the insert transaction must apply at the stored selection, not `document.activeElement`. A dropped selection silently corrupts the label feature.

**Proposed fix.** Pin: (1) capture `view.state.selection` (+ doc version) on open; (2) on ANY close — insert, Esc, backdrop — `view.focus()` + dispatch selection restore (mapped through interim steps); (3) the pointer-blur exception explicitly does not apply in insert posture; (4) the inserted-link transaction is built from the stored selection. Playwright: Cmd+J with a mid-word cursor → Esc → type one char → char lands at the stored position (byte-exact doc assertion); same for insert-then-type.

### CF-14: The escape registry doesn't exist in code, and this feature stacks four escapables — each will hand-roll Esc unless the plan enumerates them
- **Severity:** High
- **Category:** a11y
- **raised_by:** [A11Y-3, UX-2]
- **Original IDs:** A11Y-3, UX-2 (Esc-semantics bullet)

**Claim.** Doctrine 6 mandates one LIFO escape registry; grep finds no implementation (its birth is assigned to the unbuilt palette stroke). Personal-notes stacks up to four escapables in the reader (suggestion popup → insert modal → note-compose surface → rail) and the plan never enumerates them. Specific hazard: the `[[` popup must consume Esc in the PM keymap (returning true) before Radix or any global listener, or one Esc closes popup+modal together. And Esc must never eat a chapter: with a note surface open on /scripture it closes the innermost note thing only, never deselects the verse.

**Proposed fix.** Plan gains an "Escape registry" subsection: personal-notes either builds the registry (first client) or declares a hard dependency on the palette landing first — decided at the gate. Enumerate entries with focus-return targets: `[[` popup → editor (typed `[[` remains); insert modal → editor, cursor restored (CF-13); rail note-compose → invoking verse control; delete-confirm → its trigger; rail → invoking verse control; registry empty → Esc inert. On /notes/:id with a clean editor Esc is inert. Playwright: stacked-escapables chain unwinds LIFO, one press per layer, final press inert and URL unchanged.

### CF-15: F10's bundle-isolation claim has no mechanism and the lazy boundary is intra-route, not route-level — RR7 splitting alone puts ProseMirror on the note READING path
- **Severity:** High
- **Category:** perf
- **raised_by:** [PERF-4, PERF-5]
- **Original IDs:** PERF-4, PERF-5

**Claim.** The editor chunk is ~90–105 kB gz with markdown-it in it (the MarkdownParser wraps markdown-it; only the serializer is dependency-free). F10 "asserted" names no mechanism — the build emits no `.vite/manifest.json` at all (verified), so there is nothing to assert against; B18 (18.5 kB dead chunk found only by human inspection, then deferred) is the precedent at 5x the size. And D7 says "route-level lazy chunk," but RR7 splits per route module: `/notes/:id` is read+edit in one route, so a static import loads PM to *read* a note, violating the plan's own goal.

**Proposed fix.** Accept markdown-it in the lazy chunk for v1 (record the server-parse alternative as a known cut). The four edges: `notes.$id.tsx`/`notes.tsx`/`scripture.tsx`/`media.tsx`/SearchModal have zero static imports from `app/components/editor/*`; edit mode mounts via `React.lazy` behind explicit intent, client-only post-hydration; the Cmd+J glue lives INSIDE the editor chunk and imports SearchModal, never the reverse; reader capture is a fetcher action only (no editor chunk on the chapter route). Mechanism: set `build.manifest: true`; a post-build test computes the static-imports transitive closure from root/scripture/search/notes/notes.$id and asserts no reached key matches `/prosemirror|markdown-it|components\/editor/`, with a **positive control** (the editor chunk exists under dynamicImports — otherwise a renamed directory greens the test forever) and skip-with-failure when the manifest is absent; Playwright: read mode makes zero network requests to the editor chunk's manifest-resolved file, edit mode loads it.

### CF-16: The 5th dot doesn't fit the just-shipped geometry — mobile stack budget is ~23px for four kinds, five runs ~30px; desktop clears the 56px gutter by 1px
- **Severity:** High (BLAST-3 high; UX-7 med — disagreement noted)
- **Category:** ux
- **raised_by:** [BLAST-3, UX-7]
- **Original IDs:** BLAST-3 (item 3), UX-7 (stack-fit + register spec)

**Claim.** The dot cluster was re-geometried for four kinds within the last week (18ccb6d, ed752d1, 1d0cb0c): desktop 5 dots = 45px + 10px offset = 55px against a 56px gutter; mobile 5-kind vertical stack ≈ 30px against §6a.2's stated ~23px one-line-row budget — likely overflow. scripture.tsx:970-996 renders both clusters from hardcoded four-signal conditionals. Separately, the "Your notes" register itself is unspecified: position among the five shipped registers, §7.1 label mark (needs a sixth 13px lucide icon), row anatomy, and dot-slot policy. **Placement disagreement:** UX-7/A11Y-4 say the note dot leads (first slot / stable position); BLAST-3 offers desktop-only or replace-not-append on mobile as v1 fallbacks.

**Proposed fix.** This is a design decision, not a code detail: re-open §6a.2's budget with Abram before scripture.tsx is opened. UX-7's concrete proposal: register first (above art — the personal layer leads; extends, not reopens, the shipped ruling — flag at gate); label `Your notes`, lucide NotebookPen 13px/1.75 currentColor; rows = CrossRefRow idiom (serif 14.5px derived title, 11px gloss, whole row a door, `bg-dot-note` dot); if the 5-stack clips on mobile, the note dot takes the first slot and the stack clamps at four visible — never a scrollbar, never a "+1". Harness: one Playwright iOS-profile screenshot assertion on a max-signal verse row (CDP emulation per house memory, not window-size crops).

### CF-17: Anchor-grammar collisions are real in live data — alias-shaped and canonical-shaped person ids (`helaman-2`, `jeremiah-3`, `joel-4`) make shape-only classification wrong
- **Severity:** High
- **Category:** correctness
- **raised_by:** [COR-3]
- **Original IDs:** COR-3

**Claim.** Live-DB probes (2026-07-30): person ids `helaman-1/2`, `mormon-1`, `jeremiah-1…8`, `joshua-1…5`, `obadiah-1…12`, etc. are alias-parseable as chapters (`helaman-2` → hel-2 via BOOK_SLUGS); `jeremiah-3` is simultaneously a real chapter under the alias parse and a live person id — irresolvably ambiguous if the grammar accepts aliases. Persons `joel-4…11` exist while `joel` IS the canonical book slug and Joel has 3 chapters — shape-only classification (which the harness pins via "alma-32-9999 stays verse") misclassifies eight live entities and 400s legitimate anchors at the F7 boundary.

**Proposed fix.** Pin the `resolveAnchorRef` contract: canonical slugs only (book segments validate against BOOK_SLUGS *values*, never the alias table — aliasing stays on the human-input side); ship per-book chapter counts and reject `<book>-<n>` where n exceeds the count so `joel-4` falls through to the entity namespace (with both rules the live collision set is exactly zero, verified); documented precedence scripture → entity → transcript → null; namespace reservation in the ingest script and stress-test-data.mjs so the guarantee is monitored. Narrow the harness's chapter-shape stance (verse shape may stay shape-valid; chapter shape cannot).

### CF-18: Transcript anchors on `(episode_id, seq)` are not durable — moment seqs are documented response-scoped and the M3 re-window is already queued; anchor by `t_start_s`
- **Severity:** High
- **Category:** correctness
- **raised_by:** [COR-5]
- **Original IDs:** COR-5

**Claim.** The harness pins `episode#144` — exactly the moment-id format the codebase documents as non-durable ("RESPONSE-SCOPED, NOT durable — every re-run re-windows and re-keys; deep-link via episode_id + t_start_s", search-endpoint APIC-6), and the M3 re-window of 178 oversize moments is pending and will fire during this feature's lifetime. Even segment seqs (lumen.transcripts PK) re-number on re-transcription; nothing in the grammar can distinguish a segment seq from a moment seq_start, so a capture wired from search would persist a forbidden moment id and the grammar would bless it. Silent anchor drift on personal notes.

**Proposed fix.** Anchor transcript refs by `episode_id` + `t_start_s` (grammar `episode@123.4`, or ref_id = episode_id plus a nullable `t_start_s numeric` column); resolution at read time = segment containing/nearest-below t, surviving re-windowing and re-ingestion. Update the harness fixture and have `resolveAnchorRef` **reject** the `#seq` shape outright so a moment id can never be persisted by accident.

### CF-19: The compose flow is undefined and the plan's own bundle invariant already decides it — the rail captures, the route composes
- **Severity:** High
- **Category:** ux
- **raised_by:** [UX-1]
- **Original IDs:** UX-1

**Claim.** Mechanism 3 names two verbs with no flow: does "Add to note" navigate away from the reading (doctrine-2 violation as experienced) or embed an editor in the rail — which D7/F10 structurally forbid (editor chunk pinned absent from the scripture route's client graph), and which the mobile 75dvh Sheet + iOS keyboard make a non-starter anyway. The doctrine and the bundle rule converge on one shape.

**Proposed fix (adoptable verbatim).** Capture is a rail act, composition is a route act; the rail hosts two verbs and a confirmation line, never an editor. (1) `Add to note`: action appends `[[ref|label]]` + anchor row to the last-touched note without navigation; the register prints a one-line gloss confirmation (*Added to "…" — open ·*) that doubles as the undo window — no toast. (2) `New note`: navigates to `/notes/:id` with the anchor prefilled; Back returns to `/scripture/alma/32?verse=21` (pin the return-trip URL in e2e). (3) No last-touched note → "Add to note" degrades to "New note" (one verb prints; registers never print dead controls). (4) Mobile: same verbs in the verse Sheet; append keeps the sheet up; "New note" navigates; back restores `?verse=`. Append-in-place is first, visually and in DOM order.

### CF-20: Discovery hole — the print-nothing rule suppresses the feature's only door; a zero-notes user never smells it, and empty /notes is undefined
- **Severity:** High
- **Category:** ux
- **raised_by:** [UX-3]
- **Original IDs:** UX-3

**Claim.** Registers print nothing when empty; a signed-in zero-notes user therefore never sees a "Your notes" register; the Desk register is out of scope, the palette/floor unbuilt, signage banned. The feature is undiscoverable by exactly the user it must convert. Separately `/notes` with zero notes is a page, and a page cannot print nothing.

**Proposed fix.** Rule the distinction explicitly in the plan: the print-nothing law governs content rows; capture **verbs** are affordances and print whenever signed-in + verse selected, even at zero notes — they are the scent. Empty `/notes` speaks once in type (serif italic title-plate line + one plain text door `Begin a note`; no empty-state card). Hold the §6a.4 first-run whisper in reserve rather than shipping it.

### CF-21: The note dot is aria-hidden and color-only — invisible to screen readers and colorblind users, on the one dot that is personal data with an action behind it
- **Severity:** High
- **Category:** a11y
- **raised_by:** [A11Y-4]
- **Original IDs:** A11Y-4

**Claim.** Both dot surfaces are `aria-hidden` (scripture.tsx:972, :988) and the §6a.1 non-color carrier is a binary "has depth" signal ratified for canonical hints. The 5th dot breaks the premise: "you wrote a note here" is the user's own data with a distinct action (open MY note); an SR user can never find their own notes in the chapter, and a colorblind user cannot tell the note dot from teaches/mentions at 4px (WCAG 1.4.1). D5 inherits aria-hidden by default.

**Proposed fix.** Two carriers: (a) SR parity — noted verses append a visually-hidden `", your note"` suffix to the verse link's accessible name; register label is a real `<h3>` with rows carrying `bg-dot-note` dots as the color legend; (b) non-color kind carrier — the note dot takes a distinct FORM (hollow ring, 2px stroke) reading "yours vs canon" at 4–5px, plus stable position. Playwright/axe: accessible-name assertion on a noted verse; no 1.4.1/contrast regression on the new token in all themes.

### CF-22: No runtime canary on the round-trip invariant — a real note that fails round-trip is silent data corruption of personal writing until the user notices
- **Severity:** High
- **Category:** obs
- **raised_by:** [OBS-2]
- **Original IDs:** OBS-2 (mechanism complements CF-2's canonical-form redefinition)

**Claim.** F3 pins fixtures only; the corpus that matters is real users' notes, and the plan has no mechanism to learn a real body fails round-trip until whitespace/list nesting is silently rewritten. The save action is exactly where a runtime check is nearly free (client already holds both loaded markdown and PM doc).

**Proposed fix.** On editor load the client compares `serialize(parse(loaded_md))` to `loaded_md`; on mismatch, the next save POST carries `roundtrip_ok: false` (never blocks the save); the action logs `note_roundtrip_violation {note_id, body_sha256_16, len_stored, len_reserialized, first_diff_offset}` — hash only, never the body. Do not run PM server-side for this. Unit test: the event fires with exactly the whitelisted fields, body absent from the logged object.

### CF-23: No kill switch — previewless deploys + public prod need an off switch before it's needed
- **Severity:** High
- **Category:** blast-radius
- **raised_by:** [BLAST-4]
- **Original IDs:** BLAST-4

**Claim.** The plan has no mechanism to turn notes off short of a revert deploy. House precedent is DB-flag kill switches, but notes has no collection row to flip, and the entitlements system has no granted-to-all-by-default machinery — gating on an entitlement means building auto-grant-on-signup or silently 404ing every user.

**Proposed fix.** Two layers: (1) `NOTES_ENABLED` Workers env var (default "1"), one `notesEnabled(env)` helper checked at exactly four gates — /notes loaders+actions (404), the scripture-loader anchor fetch, the search-route notes leg, the media capture affordance — every gate failing toward pre-feature behavior so "off" is provably the shipped signed-out shape; (2) `wrangler rollback` stays safe because the schema is additive — write that as a constraint (no v1 change may alter existing tables). Safety floor to note: owner-only RLS + no-lumen_read-grant mean a broken feature can only corrupt its author's own notes. Harness: `NOTES_ENABLED=0` reproduces the F2 signed-out shape for signed-in users across all four gates.

### CF-24: No `owner_id → auth.users` FK is specified — the smoke script assumes a cascade that doesn't exist; account deletion strands personal religious notes forever
- **Severity:** Med-High (DATA-4 med-high; SEC-5 med)
- **Category:** data-loss
- **raised_by:** [SEC-5, DATA-4]
- **Original IDs:** SEC-5, DATA-4

**Claim.** D2 lists `owner_id` with no REFERENCES clause. The smoke script's header claims "deletes both users at the end (their notes cascade)" but no schema line creates that cascade, and the script hard-deletes the note before deleting the users so the cascade is never observed. Without the FK: every smoke run can leak orphan rows into the live DB, and real account deletion orphans the user's entire body of personal notes, owned by a uuid that no longer resolves — the worst lifecycle outcome for this data class. The smoke insert also supplies no owner_id, so the column needs a default to pass NOT NULL.

**Proposed fix.** Pin in D2: `owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE` on notes (anchors cascade via the CF-11 composite FK; same NOT NULL + default on note_anchors.owner_id). Migration invariant: both FKs exist with `confdeltype = 'c'`. Smoke assertion after cleanup: service-role SELECT finds zero rows owned by the deleted users.

### CF-25: Note create is two non-transactional PostgREST writes — the anchor leg can fail after the note exists, with no recovery story on the flagship capture flow
- **Severity:** Med-High
- **Category:** correctness
- **raised_by:** [COR-6]
- **Original IDs:** COR-6

**Claim.** Create = insert notes, then insert note_anchors — two sequential PostgREST calls with no client-side transaction. If the second fails, the note exists unanchored: visible in /notes and search but not on the verse the user captured from — precisely the flow where the anchor IS the point. Whole-action retry duplicates the note; anchor-only retry hits PK conflict if the first insert landed.

**Proposed fix.** Pick one and record it: preferred — a SECURITY INVOKER SQL function `lumen.create_note_with_anchors(body_md, anchors jsonb)` via PostgREST RPC (one transaction, RLS still applies); or compensating delete + client-generated note uuid so retried create upserts. Either way anchor inserts use `Prefer: resolution=ignore-duplicates` so double-capture is idempotent, and owner_id is set server-side from the session, never from the form. Harness: routes test for "anchor insert fails → error AND no orphan note remains."

### CF-26: No CRUD events — under LWW, a lost write is permanently unexplainable
- **Severity:** Med-High
- **Category:** obs
- **raised_by:** [OBS-4]
- **Original IDs:** OBS-4

**Claim.** The plan defines create/update(LWW)/soft-delete actions and zero events. LWW makes silent overwrites possible by design; when a user reports "half my note vanished," a log stream with no write events offers nothing, while a `prev_updated_at` regression is the LWW-clobber signature. Soft-delete is the only destructive action and the future purge/restore path depends on knowing when it happened.

**Proposed fix.** Three events in notes.server.ts, ids-and-sizes only: `note_created {note_id, body_len, anchor_count, anchor_kinds}`, `note_updated {note_id, body_len, prev_updated_at, new_updated_at, anchor_count}`, `note_softdeleted {note_id}`. Privacy: never body_md, never title/first-line, never anchor ref_ids, omit owner_id (note-write logs must never become a per-user devotional-activity timeline — deliberate divergence from search's admin-only userId). Harness: object-key whitelist assertions per event.

### CF-27: The `note` SearchResult payload, derived title, and snippet are unspecified — raw markdown/wikilink syntax leaks into search UI, the ResultType union edit is missing, and /notes/:id 500s on non-uuid ids
- **Severity:** Medium (APIC-5 med; COR-11 low-med; PERF-8 low-med; SEC-10 low)
- **Category:** api-contract
- **raised_by:** [APIC-5, COR-11, SEC-10, PERF-8]
- **Original IDs:** APIC-5, COR-11, SEC-10, PERF-8

**Claim.** `'note'` is not in the ResultType union (the harness fails typecheck as written) and nothing specifies what a note result carries. The snippet contract is "plain text with ⟪⟫ markers — never HTML" (API-1), but the notes leg is PostgREST (no ts_headline on a plain select) — a route-computed snippet leaks raw `[[ref|label]]`/`**`/`#` and is the F6 XSS surface at the producer side. The title derives from a first line that can be empty, a bare wikilink, or a heading — nondeterministic/ugly, and it travels in the payload. PERF-8: the /notes index must not markdown-render N notes per request (title + plain-text excerpt suffice; reject a stored-HTML column — dual-write invariant + persisted XSS surface). SEC-10 adds: a non-uuid `:id` flows into `.eq("id", ...)` → PG 22P02 → 500 where F8 says 404; the rail and search rows render derived titles with nothing pinning plain-text output.

**Proposed fix.** Spec in the plan: `type:'note'`; `id` = note uuid (durable); title = first non-empty line rendered to plain text (markdown stripped, wikilinks → label, ~80-char cap, fallback "Untitled note"); snippet = plain-text projection with the same stripper, ⟪⟫ optional, never HTML; tier/score synthesized (recency); `payload: {updated_at, anchors: [{kind, ref_id}]}` capped. One stripping function, unit-tested with hostile fixtures (HTML, wikilink-first-line, 300-char line), shared by index, rail, and search leg — full markdown render only on /notes/:id. Add `'note'` to ResultType beside the GROUP_RESULT_TYPES edit; the leg's SELECT projects a bounded string, not full bodies. Validate uuid shape in loader/action before any query → 404 (same status as absent — no shape-vs-existence oracle).

### CF-28: The reference input rule's editor semantics are unspecified — firing boundary, ranges, abbreviation periods, undo re-fire loop, mechanism collisions, and zero SR perception
- **Severity:** Medium
- **Category:** correctness
- **raised_by:** [COR-10, UX-4, UX-8, A11Y-5]
- **Original IDs:** COR-10, UX-4, UX-8, A11Y-5

**Claim.** Plan says typing "Alma 32:21" auto-links "via the shipped parseReference" — but `parseReference("1 ne. 3:7")` returns `unknown` (nothing strips the period; the plan's own F4 fixture fails against the shipped function). Unspecified: firing boundary ("Alma 32:2" links before "…21" is finished), ranges ("Alma 32:21-23" → mangled "[[…]]-23"), and the chapter-form false-positive class ("I told John 3 times", "she acts 2 ways" — the fixtures cover only verse-shaped noise, making F4's zero-false-positive goal unreachable). The undo re-fire loop is the feature's most rage-inducing failure: after undoInputRule reverts, the next boundary char re-matches and re-links — the user can never keep the plain text (COR-10, UX-4). Mechanism collisions (UX-8): the rule must not fire inside an active `[[` autocomplete span or inside a wikilink label; paste-over-selection needs a defined label rule. And both auto-transformations are silent to screen readers (A11Y-5) — a SR user cannot perceive their text became a link, nor that a false positive fired.

**Proposed fix.** Specify the plugin contract in the plan: boundary char required (space/punct/Enter, maximal-munch digits); range policy decided (link start verse w/ full-range label, or don't fire on `-digit`); period-normalization on the book token (detector *wraps* parseReference); undo suppression memory (Backspace = undoInputRule; after undo the same run never re-links while typed through — transaction-meta guard if needed); input rules inert inside autocomplete spans and wikilink nodes; paste-over-selection keeps the selection as label (shared with mechanism 5); chapter-form requires capitalized scripture-unique book names or suggestion-acceptance. The link's arrival is signaled typographically (dotted typed-link idiom) AND via the ONE polite status region (D9 pattern): "Linked to Alma 32:21 — Backspace to undo" / "Pasted as link — …". Harness: PM EditorState dispatch tests in jsdom or named e2e (not vibes); F4 grows the recovery sequence, collision fixtures, common-word chapter fixtures, and per-fixture announcement assertions (true ref → announcement, non-ref → silence).

### CF-29: The action contract is half-decided — intent enum, the `/notes/new` magic segment, and explicit-save vs autosave (with its debounce and failure-visibility consequences) need ruling
- **Severity:** Medium
- **Category:** api-contract
- **raised_by:** [APIC-6, OBS-8, PERF-6]
- **Original IDs:** APIC-6, OBS-8, PERF-6

**Claim.** "Actions: create / update (LWW) / soft-delete" plus "returns fresh updated_at" is the entire contract. The harness quietly mints `/notes/new` as a magic id segment (GET must render the editor, not 404 through getNote; the id parser must exclude it) without the plan stating it. Autosave vs explicit save is undecided and it IS a contract decision: it determines fetcher-JSON vs redirect-after-POST (APIC-6), the save-failure visibility story — a failed action nobody reads `fetcher.data` from is silent, the B7/B3 lesson verbatim, and a failed save of a personal note is the highest-stakes user-facing failure in the feature (OBS-8) — and the write cadence (unpinned, it drifts to save-per-keystroke with an HTTP RT each, plus anchor delete+reinsert churn per tick — PERF-6).

**Proposed fix.** Ratify: intent enum `create | update | delete` (unknown → 400, value-pinned); `/notes/new` is the create surface (GET renders empty editor; POST → 302 to `/notes/:id` with session headers); update/delete are fetcher-posted JSON (`{updated_at}` / `{ok:true}`) with session headers, no redirect; 400 validation before any write; 404 for absent/deleted/other-owner (RLS makes them indistinguishable; matches the admin.users house rule); v1 = explicit save (autosave deferred — one decision line), or if autosave, ≥3s idle debounce + blur/navigate flush, anchors diffed not rewritten. Save state is one of saved/saving/failed-with-retry driven by fetcher state; a failed save keeps the dirty buffer and never navigates silently. Add F13: save failure → visible failed state, buffer preserved, `note_write_failed` logged, with an offline-emulation Playwright flow.

### CF-30: migrate-notes.mjs has no discipline/event/rollback contract — the one place the house has a ratified word-for-word standard
- **Severity:** Medium
- **Category:** blast-radius
- **raised_by:** [DATA-8, OBS-9, BLAST-7]
- **Original IDs:** DATA-8 (discipline half), OBS-9, BLAST-7

**Claim.** The plan names the script but not its contract. House idiom is established (migrate-search-extensions/user-roles/media-collections): dry-run default with COMMIT=1 gate, prechecks, one-transaction DDL, JSON-line events (`migration_applied`/`invariant_check`/…), negative grant checks, exit 0/1/2, scrubSecrets, session-mode DSN assertion, rollback recipe. No rollback stance exists either: BLAST-7 — the migration must be idempotent and purely additive (which is what keeps `wrangler rollback` always-safe); `DROP TABLE` is legitimate only while the only rows are smoke rows; the window closes at the first real user note, after which it's roll-forward-only (dropping the tables is user-data destruction).

**Proposed fix.** One plan sentence binding migrate-notes.mjs to migrate-media-collections.mjs conventions verbatim, with named invariants: RLS enabled+forced on both tables, per-command policy set present, lumen_read/anon grant count = 0 (the CF-9 revoke), authenticated exact-shape, composite FK present, generated-column stemming probe, updated_at trigger fires — exit 2 on violation. Header carries the rollback recipe + deployment-order line (migration before web deploy). Write the additive-only constraint and the drop-window-closes-at-first-real-note posture into the plan; adopt jointly with Q3 soft-delete.

### CF-31: Session-rotation Set-Cookie propagation across five new header-bearing outcomes is unpinned — the exact B4 failure class, now on a write path
- **Severity:** Medium
- **Category:** correctness
- **raised_by:** [SEC-6, APIC-8]
- **Original IDs:** SEC-6, APIC-8

**Claim.** Every new touchpoint reads the session and can mint rotation cookies that MUST ride the response (a dropped rotation commit permanently kills the session — D5 doctrine): index loader, note loader, create redirect, update JSON, delete JSON, plus the chapter-loader anchor fetch and the search notes leg. B4 was precisely this (loader returned a plain object, static headers, session silently killed) and shipped despite review. The risk is worse on actions: a bare `redirect(\`/notes/${id}\`)` carries no commit headers. The routes harness mocks getSessionUser with bare Headers and asserts nothing about response headers on any path.

**Proposed fix.** Plan rule: every notes loader/action outcome — 200 JSON, 302, 400, 404, 500 — returns via `data(..., {headers: session.headers})` / `redirect(..., {headers})`, mirroring api.search.tsx's headers-reachable-in-catch shape. Harness: seed the mocked session with a sentinel Set-Cookie and assert it on (a) the signed-in index loader, (b) the create redirect, (c) the 400 validation path.

### CF-32: `body_md` is unbounded — the generated tsvector turns a huge paste into an opaque PostgREST 500 mid-save (data loss from the user's seat)
- **Severity:** Medium (DATA-7 med; SEC-8 low)
- **Category:** data-loss
- **raised_by:** [SEC-8, DATA-7]
- **Original IDs:** SEC-8, DATA-7

**Claim.** Nothing bounds body size. tsvector has hard engine limits (~1MB, 16383 positions); a large paste makes the GENERATED column fail at INSERT/UPDATE — an opaque 500 instead of a 400, surfacing as a failed save. PostgREST writes bypass every editor constraint, `renderNoteHtml` runs unbounded input on Workers CPU limits, and storage is unmetered. One CHECK now vs a data migration later.

**Proposed fix.** `CHECK (octet_length(body_md) <= N)` in the DDL (SEC-8 proposes 64 KiB; DATA-7 proposes 256 KB — pick one at the gate, both far above real notes and below the tsvector cliff), mirrored as a friendly 400 in the action before PostgREST is hit. Harness: oversized body → 400 with nothing written; smoke probe that an over-limit PostgREST-direct insert is rejected by the DB, not just the app.

### CF-33: tsvector/tsquery config unpinned — a column/query config mismatch fails silently as "notes search barely matches," and the supabase-js default tsquery type 500s on hostile `q`
- **Severity:** Medium (DATA-6 med; SEC-9 low)
- **Category:** correctness
- **raised_by:** [SEC-9, DATA-6]
- **Original IDs:** SEC-9, DATA-6

**Claim.** A GENERATED tsvector requires the explicit two-arg form, so a config must be chosen; the entire existing stack is `'english'` on both sides. Built with `'simple'` (or defaulted), stems don't align and matches silently evaporate. Separately, `.textSearch()` without `type` uses plain `to_tsquery`, where `q = "a & (b"` is a syntax error → the notes leg 500s on inputs the canon legs (websearch_to_tsquery, never-throws) handle fine — an unpinned error-surface divergence between the two engines on the same q.

**Proposed fix.** Pin in D2: `search tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(body_md,''))) STORED`; pin the call shape in D3: `textSearch('search', q, {config: 'english', type: 'websearch'})`. Migration invariant plus a functional stemming smoke probe (insert "believeth", match "believe" with the app's exact query shape in the deployed environment). Fixtures for `"a & (b"`, `"!"`, `"' OR 1=1 --"` asserting the leg returns empty/normal, never throws. Accepted quirk on record: raw markdown incl. ref slugs is indexed — slugs searchable is acceptable v1.

### CF-34: Deploy sequencing — DB → Supabase config → worker, with the middle step invisible to git
- **Severity:** Medium
- **Category:** blast-radius
- **raised_by:** [BLAST-6, DATA-8]
- **Original IDs:** BLAST-6, DATA-8 (env-drift half)

**Claim.** Three artifacts ship: migration, an exposed-schemas config change (dashboard/Management API — not SQL, not version-controlled), and the worker. Only one safe order exists. Worker-first: /notes 500s (tolerable) but the reader + search notes legs fail on every signed-in request — which is why CF-5's degrade path and CF-1's route-layer merge are non-negotiable: with them the worst half-deployed state is "notes quietly absent"; without them it's "the reader 500s for signed-in users." Missing-config (steps 1+3 without 2) yields PGRST106 on every call — same degrade path must absorb it.

**Proposed fix.** Deploy checklist in the plan: (1) migrate + smoke-notes-rls green (with ADMIN_DATABASE_URL set), (2) exposed-schemas change + curl probe of PostgREST lumen.notes as a test user, (3) worker deploy, (4) post-deploy signed-out /api/search byte-diff against a pre-deploy capture. Harness: half-deploy assertion — with tables absent or PGRST106, reader chapter load and signed-in search return 200 with notes quietly absent (point the degrade paths at a failing mock).

### CF-35: Formatting has no visible or touch affordance — keyboard-shortcut-only bold/italic on a WYSIWYG editor, and F12's own mobile smoke is unexecutable as specced
- **Severity:** Medium
- **Category:** ux
- **raised_by:** [UX-6, A11Y-8]
- **Original IDs:** UX-6, A11Y-8

**Claim.** The editor ships input rules + keymap and nothing visible. A Docs-user who selects text and sees nothing concludes the editor is broken — the most predictable support moment in the feature (UX-6). On a phone there is no Cmd+B; iOS's callout fires execCommand which raw PM doesn't wire; a touch or switch-access user can type but never bold, head, or list — and F12's "type, bold, insert link, save" on iOS pins a flow the plan doesn't build (A11Y-8). Voice-control and on-screen-keyboard users need visible labeled controls on desktop too.

**Proposed fix.** Decide at the gate, silence is not an option: UX-6's shape — keyboard-only v1 with a one-line typographic legend at the note foot (`⌘B bold · ⌘I italic · # heading · …`, the legend *shows* the marks; earned-quiet after ~3 formats) plus a device-verified iOS-callout→PM-marks path via beforeinput; A11Y-8's shape — a quiet words-not-icons control row (real `<button>`s, `aria-pressed`, 44px targets). If the callout check fails and no control row ships, v1 mobile is explicitly text-and-links and F12 is reworded ("type, insert link, save") — said out loud at the gate, not discovered in support.

### CF-36: `deleted_at` retention is uncontracted — "purge later" fossilizes into infinite trash of deleted personal spiritual notes, inconsistent with the hard account-deletion cascade
- **Severity:** Medium (DATA-10: low v1 / med as it ages; SEC-5 rider)
- **Category:** data-loss
- **raised_by:** [DATA-10, SEC-5]
- **Original IDs:** DATA-10, SEC-5 (retention rider)

**Claim.** Soft-delete with "purge job later" and no pinned semantics means later surfaces grow assumptions (trash? restore? analytics?) that make a purge contract a breaking conversation. "Deleted" personal notes retained indefinitely is a quiet trust liability, deleted rows stay in the generated tsvector, and the system ships two inconsistent deletion strengths (soft rows forever vs hard cascade on account deletion). Silence is not a decision.

**Proposed fix.** Amend Q3's default to carry the contract: deleted_at is a purge deadline, not an archive — rows purgeable once `deleted_at < now() - interval '30 days'`, no v1 job required. Put that sentence in a `COMMENT ON COLUMN` in the migration DDL and in the delete-confirmation copy. Costs nothing now; prevents fossilization.

### CF-37: D6 as written cannot detect the stale-write clobber it names — "returns fresh updated_at" is decorative without a client base-echo compare
- **Severity:** Medium
- **Category:** correctness
- **raised_by:** [COR-7]
- **Original IDs:** COR-7

**Claim.** Two tabs: tab 1 loads at T1, tab 2 saves (T2), tab 1 saves — plain LWW silently destroys tab 2's write. Returning fresh updated_at only tells each tab about its own write; detection requires the client to send the base it edited from and the server to compare. As specified, D6's timestamp answers nothing Q7 asks.

**Proposed fix.** Keep LWW as the resolution policy but make staleness visible, nearly free on PostgREST: the action sends the base timestamp and the update runs `WHERE id = :id AND deleted_at IS NULL AND updated_at = :base` (single statement, race-free); 0 rows → 409 with the current row ("note changed elsewhere — reload" is enough UX at this scale). If Abram rules pure clobber-LWW instead, amend D6 to drop the detection implication and book the data-loss window as accepted risk. Either ruling needs CF-10's `deleted_at IS NULL` guard so LWW never resurrects tombstones. Harness: two-tab stale write → 409, no write.

### CF-38: RLS policy shape unspecified — UPDATE without WITH CHECK lets an owner reassign owner_id, planting a note in another user's notebook
- **Severity:** Medium
- **Category:** security
- **raised_by:** [SEC-3]
- **Original IDs:** SEC-3

**Claim.** "RLS `owner_id = auth.uid()` on both tables, all operations" is compatible with a single `FOR ALL USING (...)` policy — exactly the wrong shape: USING filters which rows you may touch, not what they may become. A can `UPDATE SET owner_id = B` on A's own note; without WITH CHECK the row transfers into B's notebook — a harassment vector (unwanted content indistinguishable from B's own notes) and an integrity break against the denormalized anchor owner_id. The smoke script tests INSERT forging but never UPDATE reassignment.

**Proposed fix.** Pin four explicit policies per table, all `TO authenticated`: SELECT USING; INSERT WITH CHECK; UPDATE USING + WITH CHECK; DELETE USING — each on `owner_id = auth.uid()` (SELECT additionally carries the CF-10 deleted_at clause; write `(select auth.uid())` per the Supabase initplan idiom). `owner_id NOT NULL DEFAULT auth.uid()`. Smoke probe: A attempts `SET owner_id = B` on A's own note → 0 rows/error.

### CF-39: The plan names zero indexes — its own three queries need exactly four objects
- **Severity:** Medium
- **Category:** perf
- **raised_by:** [DATA-5]
- **Original IDs:** DATA-5

**Claim.** D2 defines PKs only, against three known queries: /notes listing (owner, recency), chapter anchors (owner, kind, ref_id IN), search leg (tsvector over live notes). House style is explicit named indexes in the DDL. The GIN index otherwise carries soft-deleted rows forever (the generated tsvector is still computed and indexed on tombstones — pure bloat).

**Proposed fix.** Exactly four objects, no more: `idx_notes_owner_recent (owner_id, updated_at DESC) WHERE deleted_at IS NULL`; `idx_notes_search USING gin (search) WHERE deleted_at IS NULL` (partial — and the eligibility reason the queries must carry the predicate); `idx_note_anchors_owner_ref (owner_id, kind, ref_id)`; the CF-11 `UNIQUE (id, owner_id)`. Record the deliberate omissions (no standalone owner_id index; no note_id index — PK prefix) in a DDL comment, user-roles style.

### CF-40: F2's "byte-compatible" claim is not testable as written — restate as a structural pin plus a live smoke diff
- **Severity:** Medium
- **Category:** api-contract
- **raised_by:** [APIC-4]
- **Original IDs:** APIC-4 (converts CF-1 from review opinion into a red test)

**Claim.** There is no pre-feature byte oracle in the repo; live snippet/score content churns with ingest re-runs; and the `scope_unknown` 400 body will change bytes unless the message is explicitly frozen. A claim the harness can't fail is not a contract. (Note: `meta` is already stripped from the public body, so notes needs no public meta acknowledgment.)

**Proposed fix.** Two testable pins: (1) structural — signed-out route response contains no notes group key and no new top-level fields, `scope_unknown`'s exact message value-pinned frozen; (2) live smoke — committed captures of today's signed-out `/api/search` JSON for 3–4 fixed queries (one reference short-circuit, one unscoped, one single-scope+cursor), byte-compared post-deploy. Amend F2's wording accordingly.

### CF-41: Signed-out gate is a new house pattern (redirect vs 404-concealment) and /login can't return the user — decide and wire `next`
- **Severity:** Medium
- **Category:** api-contract
- **raised_by:** [APIC-7]
- **Original IDs:** APIC-7

**Claim.** The harness pins 302 → /login for signed-out /notes*, but the only shipped gated surface (admin.users) uses 404 existence-concealment — this is the repo's first redirect-gated route and should be a stated decision. Two gaps: /login has no `next`/returnTo support (hard-redirects `/` on success), so a signed-out user following a note link loses the destination; and the redirect must carry session.headers (anonymous-session rotation can occur on the gate read).

**Proposed fix.** One plan line ratifying the divergence ("notes = redirect gate; notes' existence is public"). Redirect to `/login?next=<path>` (same-origin path only, validated per the auth.confirm doctrine), teach login.tsx to honor it, throw the redirect with session.headers. Extend the harness's `^\/login` match to assert `next`.

### CF-42: `[[ref|label]]` is a persisted public grammar with two unspecified edges — label escaping (`|`, `]]`) and entity-slug renames orphaning stored refs
- **Severity:** Medium
- **Category:** api-contract
- **raised_by:** [APIC-9]
- **Original IDs:** APIC-9

**Claim.** Nothing defines serialization when a label contains `|` or `]]` (pasted verse text easily contains `|`; Cmd+J uses the selection as label) — the round-trip is ambiguous on exactly the inputs users will produce. And entity ids do migrate: migrate-entity-rename.mjs rewrites entities/edges but treats search_index.ref_id as informational; stored note_anchors.ref_id and in-body wikilinks would dangle after a rename — fail-closed rendering makes it safe but silently rots user links.

**Proposed fix.** (a) Define the grammar once in notes-refs.ts (`ref = [a-z0-9-]+(#\d+)?` — or `@t` per CF-18): `|` and `]]` forbidden in labels, serializer strips/escapes, insert paths sanitize the selection; both as F3 fixtures. (b) Amend the rename runbook: migrate-entity-rename.mjs gains note_anchors.ref_id UPDATE + body wikilink rewrite steps under the admin DSN; until implemented, a header note that notes refs are a known rename consumer.

### CF-43: On a phone, insert posture has zero doors — declare `[[` the universal door and cut "selection affordance" from the plan's language
- **Severity:** Medium
- **Category:** ux
- **raised_by:** [UX-5]
- **Original IDs:** UX-5

**Claim.** Doctrine 11 requires key/click/touch doors. Cmd+J is desktop-only; the plan's third trigger, "selection affordance," is never specified; the floor isn't built and a floating selection bubble over PM is the banned toolbar in a trench coat. No honest touch door exists as written.

**Proposed fix.** `[[` is the universal door: typing it opens the same suggestion surface (inline popup desktop, docked-above-keyboard mobile via the B13 visualViewport pattern); Cmd+J is a desktop accelerator onto the same engine; "selection affordance" is cut unless named concretely. The honest v1 sentence: "three triggers: `[[` (all widths), Cmd+J (desktop accelerator), reader capture." F12's mobile smoke walks the `[[` door, not Cmd+J.

### CF-44: Q6 mobile compose rests on one pattern covering one of ~nine known failure surfaces — pin the device checklist, including the floor/keyboard standoff
- **Severity:** Medium
- **Category:** ux
- **raised_by:** [UX-9]
- **Original IDs:** UX-9

**Claim.** "Existing visualViewport patterns" was built for a Sheet, not a page-level editor. PM-in-mobile-Safari with the keyboard up is a known swamp; each unchecked item has sunk a real editor: caret-above-keyboard at document bottom, iOS callout formatting, `[[` docking + smart-punctuation mangling, paste-menu conversion, shake/three-finger undo → PM history, URL-bar bounce, save reachability, and the future floor vs keyboard+accessory (doctrine 3's unforgivable outcome by another name).

**Proposed fix.** Pin the nine-item checklist into Q6's acceptance verbatim (UX-9 items 1–9), including: notes routes declare their floor behavior now (one line) so the floor feature never reopens it; a lowercase "alma 32:21" F4 fixture (autocapitalize-off keyboards); F12 walks the `[[` door on the iOS Playwright profile AND once on a physical device per the §6 precedent.

### CF-45: Editor region semantics + heading-hierarchy collision — an unlabeled contenteditable, and note h1s breaking the page outline
- **Severity:** Medium
- **Category:** a11y
- **raised_by:** [A11Y-6]
- **Original IDs:** A11Y-6

**Claim.** PM renders a bare contenteditable; without `role="textbox"` + `aria-multiline="true"` + an accessible name, SR users land in an unlabeled editable region. The schema allows h1–h3 and Q4 derives the title from the first line: /notes/:id renders a second h1 (or the same text twice as h1), breaking the outline on read view and index (WCAG 1.3.1; trips axe heading rules in the planned e2e).

**Proposed fix.** Renderer demotion rule in D4: schema heading N → DOM h(N+1); the page h1 is the derived title; a first-line heading's duplicate body rendering is suppressed (title consumes it). The editor element gets role/aria-multiline/aria-labelledby (or `aria-label="Note"`). Add the demotion rule to the renderer fixture corpus, and a first-line-heading case to the F3 corpus so demotion and round-trip are pinned against each other.

### CF-46: Wikilink read-view rendering — link purpose and non-color affordance; unresolvable refs must not retain link semantics
- **Severity:** Medium
- **Category:** a11y
- **raised_by:** [A11Y-7]
- **Original IDs:** A11Y-7

**Claim.** Labels like "the seed" name nothing (2.4.4 — surrounding prose is user-written); wikilinks distinguished by color alone fail 1.4.1 for the body's only interactive elements; F5's fallback must not imply link semantics.

**Proposed fix.** Renderer emits `<a aria-label="{label} — {resolved destination}">` when label ≠ destination name (label-in-name holds), destination resolved from the slug map; visual affordance = the house dotted underline, never color alone; unresolvable refs render as `<span>` with no role and no link styling. Renderer fixtures assert all three shapes.

### CF-47: Soft-delete confirm — dialog pattern and post-delete focus destination unspecified (B5/B9 class)
- **Severity:** Medium
- **Category:** a11y
- **raised_by:** [A11Y-9]
- **Original IDs:** A11Y-9

**Claim.** Q3 ships soft-delete with no confirm spec. Two focus hazards: an inline-swap confirm strands focus when the trigger unmounts; after confirm, navigation to /notes drops focus to `<body>` (the exact B5 dead state) with no SR confirmation the note is gone.

**Proposed fix.** House Radix AlertDialog (focus lands on Cancel; Esc = cancel via the CF-14 registry entry); after confirm, focus moves to the /notes page h1 (`tabIndex={-1}` + `.focus()`, the B5 fix idiom) with the status region announcing "Note deleted"; delete/save buttons take the B-U1 `e.detail` pointer-blur guard. Playwright: focus assertions on both paths.

### CF-48: Reduced-motion pins for every new appear/recede — motion-safe variants, never motion-reduce overrides (B14's specificity defeat)
- **Severity:** Medium
- **Category:** a11y
- **raised_by:** [A11Y-10]
- **Original IDs:** A11Y-10

**Claim.** New animated moments: register arrival, post-save dot, modal/sheet entrance, `[[` popup, save-state transitions. B14's lesson is mechanical: `motion-reduce:animate-none` loses on specificity to shadcn's `data-open:animate-in`; the working pattern is `motion-safe:` prefixing, as Connections already does.

**Proposed fix.** Plan pins "all new appear/recede uses motion-safe: variants" as a review-checklist line; the dot and register reuse the Connections classes verbatim. Playwright: one spec with `reducedMotion: 'reduce'` asserting no computed entrance animation on the modal and register.

### CF-49: PostgREST error taxonomy undefined — RLS rejection, 0-rows, constraint violation, and network failure are four different bugs that will log identically or not at all
- **Severity:** Medium
- **Category:** obs
- **raised_by:** [OBS-5]
- **Original IDs:** OBS-5

**Claim.** Under RLS an UPDATE/DELETE on an invisible row returns success-with-0-rows (no error object); WITH CHECK violations return 42501; validation is a 4xx; pool/network is a thrown fetch error. F7 says "→ 400 / RLS reject" but never how these are distinguished in logs — the implementation will bubble `error.message` strings at best.

**Proposed fix.** notes.server.ts owns a classifier and one event: `note_write_failed {op, note_id?, cause, pg_code?, message}` with `cause ∈ rls_denied | not_found_or_forbidden | constraint | validation | network`; 0-rows → `not_found_or_forbidden` and a client 404 (deliberately indistinguishable to the client, investigable in logs). Validation 400s stay unlogged per the ratified posture, with one exception: `note_anchor_invalid_ref {kind, ref_id}` IS logged — an invalid ref from the autocomplete means client/slug-map drift, a bug not user garbage. Unit tests per cause branch.

### CF-50: A renderer throw on a stored body falls into the root ErrorBoundary — the user's own note becomes permanently unopenable and unfixable, with zero signal
- **Severity:** Medium
- **Category:** obs
- **raised_by:** [OBS-6]
- **Original IDs:** OBS-6

**Claim.** notes-render.server.ts runs in loaders for /notes/:id, the rail, and search snippets. A markdown-it throw on a stored body lands in the root ErrorBoundary, which logs nothing and shows "Oops!" — the user can't reach the editor through the crashed read view, and the operator gets no signal.

**Proposed fix.** notes-render.server.ts never throws: catch → `logEvent("note_render_failed", {note_id, body_len, message})` → return escaped plaintext (`<pre>` of the raw markdown — displaying the user's own body on their own page is fine; logging it is not; verify markdown-it messages can't embed source, else log `error.name`). The editor route must not share the render path so the note stays editable. Harness: pathological-markdown fixture asserting non-throw + escaped fallback + event + no unescaped HTML.

### CF-51: PM lazy-chunk client exceptions vanish — no window.onerror, no editor boundary, and the failure mode is user text loss
- **Severity:** Medium
- **Category:** obs
- **raised_by:** [OBS-7]
- **Original IDs:** OBS-7

**Claim.** The app has no client→server error reporting; the PM editor is about to be the most exception-prone client code in the app (contenteditable + input rules + paste + a portal), and an exception mid-edit strands unsaved personal writing as a white region with nothing in any log.

**Proposed fix.** (1) An editor-scoped React error boundary whose fallback shows the last-known markdown in a readonly `<textarea>` (data-loss containment first) plus reload. (2) One beacon: boundary (and cheap dispatchTransaction try/catch) POSTs to a tiny resource route → `logEvent("editor_client_error", {message, stack_head, note_id?, ua})` — never doc content or selection. If the beacon is cut, the boundary is the floor and the plan must say the editor error rate is deliberately unobserved. Component test: throw inside the mount → fallback shows markdown, beacon payload contains no body text.

### CF-52: Chapter-anchors fetch is unbounded — select a projection with a LIMIT; never note bodies
- **Severity:** Low-Med
- **Category:** perf
- **raised_by:** [PERF-7]
- **Original IDs:** PERF-7

**Claim.** A user with hundreds of anchors on one chapter returns them all, and an embed naming `notes.*` ships bodies too. Dots need per-verse presence; the rail needs a handful of titles.

**Proposed fix.** Select only `(note_id, kind, ref_id, updated_at)`, `order updated_at desc, limit 200`; dot merge dedupes to a boolean per verse; the rail renders ≤ ~20 with "See all →". One fixture test at the limit.

### CF-53: No updated_at house pattern exists to reuse — write one generic trigger; and note_anchors should be immutable (no UPDATE grant or policy at all)
- **Severity:** Low-Med
- **Category:** security
- **raised_by:** [DATA-9]
- **Original IDs:** DATA-9

**Claim.** No updated_at trigger exists anywhere (collections drifts on update, tolerated); the feature must introduce the pattern, not reuse it. Anchor rows are pure identity + owner — an "update" is semantically delete+insert; granting UPDATE on anchors is pure attack/bug surface.

**Proposed fix.** One generic `lumen.set_updated_at()` function + a notes-only BEFORE UPDATE trigger; no trigger, no updated_at column, no UPDATE grant, no UPDATE policy on note_anchors — record the omission as deliberate (D6 reads notes.updated_at only).

### CF-54: Stale-ref deploys can silently revert the reader work this feature sits on
- **Severity:** Low-Med
- **Category:** blast-radius
- **raised_by:** [BLAST-8]
- **Original IDs:** BLAST-8

**Claim.** This feature edits scripture.tsx, which took four geometry-sensitive commits in the last week, while origin/main is frozen and deploys are previewless. A deploy cut from a stale worktree/branch re-ships the selection-box and rail bugs with no preview to catch it — and stale parallel trees are a live phenomenon in this repo, not a hypothetical.

**Proposed fix.** The memorialized pre-deploy `git log HEAD..main` divergence check graduates to a mandatory line in this feature's deploy checklist, asserted empty before `wrangler deploy`; rebase the notes branch onto local main before any deploy touching scripture.tsx.

### CF-55: ⌘K/⌘J collide with editor muscle memory — ⌘K is "insert link" in every editor the user knows, and here it steals focus into global search
- **Severity:** Low
- **Category:** a11y
- **raised_by:** [A11Y-11]
- **Original IDs:** A11Y-11

**Claim.** SU-6 makes ⌘K open the search modal everywhere including editable fields; mid-note ⌘K yanks the user into navigation, losing editor focus by design. ⌘J must reach preventDefault before the browser (Firefox downloads) and before PM's keymap.

**Proposed fix.** Cheapest coherent rule: inside the note editor, ⌘K also opens the insert posture (outside, it stays global search) — muscle memory becomes a feature. If rejected, document the collision and assert ⌘J's preventDefault ordering. Either way the decision belongs in the plan, not the diff.

### CF-56: Server-side markdown-it adds ~100 kB min to the Worker bundle — noise; accept
- **Severity:** Low
- **Category:** perf
- **raised_by:** [PERF-9]
- **Original IDs:** PERF-9

**Claim.** notes-render.server.ts puts markdown-it in the Worker bundle. Against Workers' limits and cold-start profile this is noise; recorded so the number is on file.

**Proposed fix.** None — accept. Not the first thing to cut if the bundle ever nears a limit.

---

## Open-question inputs

### Q1 — Playwright e2e layer
- **security:** yes — include security flows: signed-out /notes and known-note-URL redirects with no content flash; signed-in B navigating to A's note URL → 404 (only e2e covers the loader/HTML path).
- **correctness:** yes — the PM plugin behaviors (undo re-fire, firing boundary, inside-wikilink guard) are exactly what vitest cannot see; add PM dispatch tests in jsdom or assign those cases to e2e by name, not vibe.
- **accessibility:** yes, emphatically — this feature is the reason; names six specs: focus-return-after-insert, esc-chain (never eats a chapter), axe pass on /notes + /notes/:id + reader-with-register in both themes, noted-verse accessible name, delete-confirm focus, reduced-motion.
- **blast-radius:** yes — the highest-value spec is the cheapest: a signed-out sweep (reader, /search, /api/search) asserting zero notes surface, run against the built worker.
- **ux / observability:** (no explicit Q1 line; both contributed named e2e flows via harness gaps — capture round-trip with reading continuity, append-undo, Esc ladder, zero-state, five-dot screenshot, offline save-failure.)

### Q2 — transcript anchoring
- **correctness:** yes, only with the COR-5 amendment — anchor by (episode_id, t_start_s), never `#seq`; shipping #seq plants anchors the queued M3 re-window silently invalidates, worse than cutting the capture UI.
- **ux:** yes, keep with cut-line 1 — same capture vocabulary ("Add to note") everywhere; if the UI cuts, the anchor kind shipping anyway is right (paste conversion of a `?t=` URL is the interim door).

### Q3 — soft vs hard delete
- **security:** soft, conditional on SEC-5 — auth.users FK cascade specified, every read filters deleted_at, retention decision recorded (silence is not a decision).
- **correctness:** soft, conditional on COR-4 — anchors filtered through note liveness, all updates guarded `deleted_at IS NULL`; without those, soft-delete is the source of two leak/resurrection bugs.
- **api-contract:** soft — it's what makes 404-for-deleted (F8) and no-409 LWW (Q7) coherent.
- **data-integrity:** soft with three load-bearing riders — filter enforced at RLS not app code; anchors invisible via the EXISTS clause; 30-day purge deadline pinned in a column comment now, job deferred; accept no trash/restore in v1 and the delete action cannot `.select()` its own result.
- **accessibility:** soft — makes a post-delete "Undo" affordance nearly free later.
- **observability:** soft — `note_softdeleted` is the breadcrumb the purge job and any restore request depend on; the purge job follows migration-script event conventions.
- **blast-radius:** soft — it is also the rollback posture (BLAST-7); adopt both as one decision.

### Q4 — derived title
- **security:** fine, conditional on SEC-10 — derived by a dedicated stripped-plain-text helper with hostile fixtures, never by rendering markdown.
- **correctness:** agreed, but pin the derivation function — "first line" is not yet a definition (empty/link-only/heading cases).
- **api-contract:** support with the APIC-5 amendment — derivation is markdown-stripping and contract-pinned, because the title travels in the search payload.
- **data-integrity:** no objection — but the search leg must not ship full bodies to derive titles; project a bounded string.
- **ux:** yes, with the fallback pinned — first line empty/link-only → "Untitled note" in muted italic; title re-derives on every save.
- **accessibility:** acceptable with the A11Y-6 demotion rule and the empty-first-line fallback name so index links never have empty accessible names.

### Q5 — markdown-it
- **security:** yes — with config pinned in a test, not just set: html:false, linkify off, validateLink (or internal-path allowlist), rule whitelist enumerated so an upgrade enabling a new default rule turns a test red.
- **correctness:** yes — with one shared markdown-it rule configuration for the PM parser and the renderer; two independently-whitelisted parsers of the same bodies is a drift generator.
- **performance:** agree — the client needs markdown-it only for md→doc parse; keep it in the lazy chunk; server-side parse-to-doc-JSON is the recorded fallback.

### Q6 — mobile compose
- **security:** no security delta beyond the same action/session rules (SEC-6).
- **correctness:** no objection; F12 carries it.
- **ux:** yes-basic, gated on the UX-9 nine-item device checklist — with the explicit fallback that if the iOS-callout check fails, v1 mobile is text-and-links, said out loud.
- **accessibility:** only coherent if A11Y-8 is resolved — "basic" must still include a touch door to formatting or an explicit cut of it.
- **observability:** yes moves the editor boundary + beacon (OBS-7) from nice-to-have toward necessary — the beacon is the only way to hear about real-device-only input quirks.

### Q7 — LWW
- **security:** acceptable at this scale — single-user-per-account data; fresh updated_at leaks nothing.
- **correctness:** accept LWW as resolution, add the one-statement conditional update for detection (COR-7); as drafted D6 names a detection mechanism that cannot detect.
- **api-contract:** support; record the consequence — the fresh updated_at return is the entire concurrency API; no ETag/If-Match in v1.
- **data-integrity:** compatible with the trigger — but the action must read fresh updated_at via RETURNING on non-delete updates (DATA-3's SELECT policy hides the soft-deleted row).
- **performance:** agree, but D6 is incomplete without the autosave cadence — adopt PERF-6 (≥3s debounce + blur flush, anchors diffed not churned) as part of the same decision.
- **observability:** acceptable only with the prev/new updated_at pair logged (OBS-4) — that pair makes an eventual optimistic-lock decision evidence-based.

### New questions proposed for the gate
- **api-contract:** `scope=notes` rule (signed-out 400 frozen message; signed-in notes-only skips searchAll — APIC-2); save model (explicit v1; intents; create=302, update/delete=JSON — APIC-6).
- **performance:** D3 addendum — notes group ordering + pagination (recency, no cursor; rank-RPC named-and-deferred); D5 addendum — anchors leg placement + budget (parallel-window, 750ms abort, degraded-as-value, not streamed).
- **observability:** save posture (explicit vs autosave) decided at the gate — it gates editor UX, e2e flow design, and failure visibility.
- **blast-radius:** ratify the layer split ("GROUP_KEYS frozen; signed-in response order = [notes, …GROUP_KEYS]", superseding the plan's "notes added to GROUP_KEYS" line); adopt NOTES_ENABLED kill switch + additive-schema constraint; Abram ruling on the 5th dot's mobile geometry before scripture.tsx is opened.
- **ux:** re-cost cut-line 2 after UX-2 — Cmd+J is not a reuse, it is a mini-palette; if it survives, build it as the §5 palette's seed (escape registry included); if too rich, cut it and let `[[` carry v1.
- **accessibility:** escape registry — build here (first client) or declare a hard dependency on the palette stroke; choose at the gate (A11Y-3).

---

## Harness gaps (union, deduplicated)

Smoke / DB layer (scripts/smoke-notes-rls.mjs + migration invariants):
1. UPDATE owner_id reassignment probe — A sets owner_id=B on A's own note → 0 rows/error (WITH CHECK). [security]
2. Cross-note anchor forge — B inserts an anchor with note_id = A's note → rejected (composite FK). [security, correctness, data-integrity]
3. Anon PostgREST probe (no-session client → permission denied) AND remove the smoke script's `?? SUPABASE_SERVICE_ROLE_KEY` fallback — hard-require the publishable key. [security, correctness]
4. Negative grants sweep — authenticated/anon hold zero grants on every lumen relation except the two notes tables (app_users, user_roles, collections, transcripts by name); lumen_read holds none on the notes tables including via pg_default_acl. [security, data-integrity, blast-radius]
5. D3 probe must hard-fail (not skip-with-warning) when ADMIN_DATABASE_URL is unset; also a migration invariant so the migration refuses to conclude leaky. [data-integrity, observability]
6. auth-user deletion cascade — after cleanup, service-role SELECT finds zero rows owned by the deleted users. [security, data-integrity]
7. Deleted-invisibility at the PostgREST layer — A soft-deletes; A's own SELECT of the note AND its anchors returns 0 rows; an update attempt affects 0 rows. [security, correctness, data-integrity]
8. Constraint probes — invalid kind CHECK rejection; duplicate (note_id, kind, ref_id) PK → clean 409/400 at the action layer; oversized body_md → DB rejection + app 400 with nothing written. [data-integrity, security]
9. Stemming/config functional probe — inflected-form insert matched via the app's exact websearch/english call shape in the deployed environment. [data-integrity]

Search contract layer:
10. Signed-out pins — searchAll output contains no notes key; buildLegs-reachable scope rejects notes; signed-out /api/search body contains no notes group; scope=notes signed-out behaves as ratified (message value-pinned). [security, correctness, api-contract, blast-radius]
11. F2 byte-level fixtures — committed pre-feature signed-out /api/search captures (3–4 fixed queries incl. reference short-circuit and single-scope+cursor), replayed post-implementation with exact string equality. [blast-radius, api-contract]
12. Rewrite notes-harness.test.ts — it currently pins GROUP_KEYS[0]==='notes', the design the panel rejects; keep api-search.test.ts:38's hardcoded seven-key literal as the tripwire. [blast-radius]
13. Cursor × notes — `after` + scope containing notes → 400; a full notes page mints no nextCursor. [api-contract, correctness, performance]
14. Merge degradation — throwing/aborted notes leg → 200, canon groups byte-intact, notes group degraded per contract, one `search_group_degraded {key:"notes"}`, zeroResult unpolluted; signed-out key absent from response and logs. [observability, performance, correctness, api-contract]
15. mergeNotesGroup duplicate-key guard — canonGroups already containing a notes key → pinned behavior. [api-contract]
16. Soft-deleted notes filtered from the search leg — no test currently queries the leg with a deleted note in place. [security, correctness]
17. Snippet/title XSS-at-the-producer — hostile bodies (`<script>`, `](javascript:...)`, `[[ref|<img onerror>]]`, ARIA-bearing payloads `[[ref|<span aria-hidden>…]]`) through the notes leg → emitted title/snippet plain text. [api-contract, security, accessibility]
18. Hostile tsquery inputs on the notes leg (`"a & (b"`, `"!"`, `"' OR 1=1 --"`) → empty/normal, never throws. [security]

Routes / loader layer:
19. Set-Cookie sentinel propagation — asserted on the signed-in index loader, the create redirect, and the 400 path (harness currently builds Headers and drops them). [security, api-contract]
20. F2 "chapter loader makes zero notes calls" — no assertion exists anywhere; amend CPERF-6: fetchChapterAnchors ×1 signed-in / ×0 signed-out, db.execute stays 3 with updated comment. [correctness, performance]
21. Anchors-degraded loader pin — mocked anchors timeout/throw → chapter 200, no note signal, no throw, one `note_anchors_degraded` (mirrors the neo4j_degraded test). [performance, observability, blast-radius]
22. Partial-failure create — anchor insert fails → error response AND no orphan note remains. [correctness]
23. LWW conditional update — base-echo mismatch → 409, no write (if CF-37's fix is adopted). [correctness]
24. /notes/new GET — loader renders the editor for id="new" rather than 404ing through getNote. [api-contract]
25. Non-uuid :id → 404, not 500. [security]
26. Kill-switch test — NOTES_ENABLED=0 reproduces the F2 signed-out shape for signed-in users across all four gates. [blast-radius]
27. Half-deploy assertion — tables absent / PGRST106 → reader and signed-in search return 200 with notes quietly absent. [blast-radius]

Editor / markdown layer:
28. Round-trip fixtures rewritten in canonical form + idempotency (C∘C=C) + canonicalization-mapping tables; label-escaping fixtures (`|`, `]]`); a first-line-heading a11y case pinning demotion against round-trip. [correctness, api-contract, accessibility]
29. Out-of-schema token fixtures — backticks, indented code, fences, `---`, `[a](b)`, autolinks → parse never throws, text preserved. [correctness]
30. Alias/count collision fixtures for resolveAnchorRef — helaman-2 → person, jeremiah-3 → person, joel-4 → person; narrow the chapter-shape stance. [correctness]
31. Auto-link recovery loop — type ref → link → Backspace → plain text → keep typing → still plain text; separately ⌘Z; per-fixture announcement assertions (true ref → announcement, non-ref → silence). [ux, correctness, accessibility]
32. Mechanism-collision fixtures — reference rule inert inside `[[` spans and wikilink labels; paste-over-selection keeps selection as label. [ux, correctness]
33. jsdom combobox-contract pin — aria-activedescendant tracks highlight; stable option ids under appends (don't leave it all to Playwright). [accessibility]
34. Runtime round-trip canary — roundtrip_ok:false save emits the hash-only event; whitelisted fields only, body absent. [observability]
35. Render-failure fallback — pathological markdown through the real render fn: non-throw, escaped plaintext, event, no unescaped HTML. [observability]
36. Editor client-error boundary — throw inside PM mount → fallback shows markdown, beacon payload contains no body text. [observability]
37. Log privacy lint — grep-based vitest over notes logEvent call sites asserting no body_md/body:/snippet/ref_ids (allowlist note_anchor_invalid_ref), or key-set whitelist spies. [observability]
38. Debounce/autosave wiring assertion + anchors-diffed-not-churned (if autosave is ruled). [performance]
39. Anchor LIMIT fixture at the cap. [performance]

Bundle layer:
40. F10 mechanism — build.manifest:true; post-build closure test from root/scripture/search/notes/notes.$id asserting no prosemirror/markdown-it/editor module reached, with a positive control (editor chunk exists under dynamicImports) and skip-with-failure when the manifest is absent; Playwright read-mode zero-network assertion on the manifest-resolved chunk file. [performance]

E2E flows (Playwright, the ~6+ slots):
41. Capture round-trip with reading continuity — select verse → Add to note → wikilink+anchor land, reader URL unchanged, confirmation printed → open → back restores `?verse=` (desktop rail + mobile sheet). [ux]
42. Append-undo — capture → undo → body byte-identical, anchor gone. [ux]
43. Insert-posture Esc ladder / esc-chain — LIFO unwind, focus+selection restored, final Esc inert, never eats a chapter; focus-return-after-insert with byte-exact cursor assertion. [ux, accessibility]
44. Zero-state — signed-in zero notes: rail prints capture verbs, no register rows; /notes prints the empty line + door; signed-out prints neither. [ux]
45. Five-dot stack visual regression — max-signal verse row, iOS profile via CDP emulation (house memory: not window-size crops). [ux, blast-radius]
46. Delete-confirm focus — cancel returns to trigger; confirm lands on /notes h1 with announcement. [accessibility]
47. axe pass (install @axe-core/playwright — no automated a11y runner exists in the repo today) on /notes, /notes/:id read+edit, reader with register, light+dark. [accessibility]
48. Reduced-motion spec — no entrance animation on modal/register under reducedMotion:'reduce'. [accessibility]
49. Noted-verse accessible name contains "your note"; register `<h3>` present. [accessibility]
50. Save-failure flow — offline/500 during save → visible failed state, buffer preserved, note_write_failed logged. [observability]
51. Signed-out sweep against the built worker — reader chapter, /search, /api/search: zero notes surface. [blast-radius, security]
52. Legend earned-quiet — prints attended, quiets after third format, Guided pins it. [ux]
53. Mobile F12 walks the `[[` door (not Cmd+J), iOS Playwright profile + once on a physical device. [ux]

---

## Counts

**Findings per role (raw):**

| Role | Findings |
|---|---|
| security | 10 (SEC-1..10) |
| correctness | 11 (COR-1..11) |
| api-contract | 10 (APIC-1..10) |
| data-integrity | 10 (DATA-1..10) |
| ux | 9 (UX-1..9) |
| accessibility | 11 (A11Y-1..11) |
| performance | 9 (PERF-1..9) |
| observability | 9 (OBS-1..9) |
| blast-radius | 9 (BLAST-1..9) |
| **Total raw** | **88** |

**Canonical total: 56** (25 canonical findings merged 2+ original findings; 31 stand alone).

**Convergence stats:**
- 24 canonical findings were raised by 2+ distinct roles (25 merged 2+ findings; CF-15 merged two findings from one role, PERF-4+PERF-5).
- 10 canonical findings were raised by 3+ distinct roles: CF-1 (4 roles / 5 findings), CF-4 (5 roles / 5 findings), CF-5 (3 roles / 4 findings), CF-6 (3), CF-7 (3), CF-8 (3), CF-27 (4 roles / 4 findings), CF-28 (3 roles / 4 findings), CF-29 (3), CF-30 (3).
- Highest convergence: **CF-4 notes-leg degradation/obs contract** (5 roles: obs, perf, correctness, api-contract, blast-radius) and **CF-1 GROUP_KEYS signed-out leak** (4 roles, 5 findings, 2× critical).
- By severity: Critical 3 · High 20 · Med-High 3 · Medium 25 · Low-Med 3 · Low 2.
- Severity disagreements preserved inline: CF-1 (critical/high/med), CF-11 (high/med), CF-16 (high/med), CF-27 (med/low-med/low), CF-32 (med/low), CF-33 (med/low), CF-36 (med-aging/low). Design disagreements flagged for the gate: CF-5 (anchors fetch in vs. out of the loader's Promise.all; verseSignals 5th kind vs. separate additive field), CF-7 (signed-out scope=notes 400 vs. empty-indistinguishable), CF-16 (note dot first slot vs. desktop-only/replace on mobile), CF-32 (64 KiB vs. 256 KB cap).
