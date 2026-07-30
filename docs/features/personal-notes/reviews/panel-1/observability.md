# Observability review — personal-notes (panel-1, plan-stage)

Reviewer lens: single-digit DAU, Workers console logs (no APM), house pattern =
`logEvent` JSON lines + `<surface>_degraded` on fallback paths + terminal JSON
events for scripts. Governing tension for THIS feature: note bodies are
personal religious reflections — the logs must stay debuggable while never
carrying `body_md`, snippets, or anchor-derivable reading habits beyond what a
specific failure needs.

Headline: **the plan has no observability section at all.** search-endpoint
made obs a numbered decision (plan decision 10) and shipped a dedicated module
(`apps/web/app/lib/search-obs.server.ts`); this plan — a larger feature with a
privacy constraint search never had — names zero events. Every finding below
is a hole that decision-10 discipline would have caught at plan time.

---

### OBS-1: The route-layer notes merge is invisible to the entire search obs pipeline — a failed notes leg logs nothing and silently degrades to canon-only results

**Severity: High**

**Claim.** D3 merges the notes leg "at the api.search route layer" — i.e.
*outside* `searchAll`. But the whole search obs contract keys off
`result.meta.perGroup`: `logSearchExecuted` (search-obs.server.ts:34-41)
iterates `meta.perGroup` to emit per-group hits, `search_group_degraded`, and
the `degraded` flag that guards `zeroResult`. A notes group spliced in at the
route layer never appears in `perGroup`, so as planned:

1. A notes-leg PostgREST failure emits **no** `search_group_degraded` — the
   exact silent-swallow the search-ui B7 retro exists to prevent.
2. Notes hits are absent from `search_executed.groups` — the relevance loop
   (decision-10's stated purpose) is blind to the feature's own group.
3. `zeroResult` is corrupted: a signed-in search where canon groups are empty
   and the notes leg *failed* logs `zeroResult: true`, polluting the OU-1
   denominator that OBS-2/Δ OU-1 in search-obs.server.ts fought to keep clean.
4. The **user-facing** contract is worse: the client response is
   `{query, reference, groups}` with `meta` stripped (search.tsx B10,
   api.search.tsx:132-136), so a degraded notes leg produces canon-only
   results indistinguishable from "you have no matching notes." For personal
   notes that reads as data loss.

**Evidence.** plan.md D3 ("merged at api.search route layer");
search-obs.server.ts:34-41 (perGroup is the only degraded source);
api.search.tsx:130 (logSearchExecuted consumes `result` from `searchAll`
before any merge could annotate it); search-ui retro lesson cited in plan
§Learnings ("interaction bugs must not ride the human-tester layer") and B7
history in search.tsx:662-672 (error bodies get explicit inline UI, never
silence).

**Proposed fix.** Define the degraded contract in the plan:

- The merge site wraps the notes leg in its own try/catch and synthesizes a
  perGroup-shaped record before logging: on failure, call
  `logEvent("search_group_degraded", { key: "notes", message, ms })` (reuse
  the existing event name — the dashboard filter already exists) and pass a
  degraded flag into the `logSearchExecuted` context so `zeroResult` stays
  false and `groups.notes` is present (0 hits + degraded), not absent.
  Cheapest shape: extend `SearchLogContext` with an optional
  `extraGroups: Record<string, {ms:number|null, hits:number, error?:string}>`
  merged into the loop — keeps search-obs.server.ts the single owner.
- The response carries the signal signed-in only: notes group present with
  `results: []` and `degraded: true` (or a top-level `degradedGroups:
  ["notes"]`). Signed-out responses never contain it, so F2 byte-compat holds.
- UI renders the notes section with "Your notes are unavailable right now" —
  degradation-as-absence (the scripture.tsx signals pattern) is wrong here
  because absence is semantically loaded ("no notes match").
- **Log fields allowed:** `key`, `message` (PostgREST error message — verify
  it cannot echo the tsquery; if it can, log error `code` only), `ms`. Never
  hits' content, never note ids.

**Harness pin.** Vitest on the merge site: notes client rejects → response is
200, notes group present+degraded, `search_group_degraded {key:"notes"}`
emitted once, `search_executed.zeroResult === false`. Signed-out: notes key
absent from both response and log fields (extends F2/F9).

---

### OBS-2: The round-trip invariant is pinned only on fixtures — no runtime canary on real notes, which is the single highest-value event this feature can emit

**Severity: High**

**Claim.** F3 pins `serialize(parse(md)) === md` over a fixture corpus. The
human-ruled constraint says round-trip is *the* invariant that keeps the
editor choice reversible — but fixtures only cover the markdown shapes the
panel imagined. The corpus that matters is real users' notes, and the plan has
no mechanism to learn that a real note fails round-trip until the user
notices their whitespace/list nesting silently rewritten (lossy save = silent
data corruption of personal writing).

**Evidence.** plan.md §Human-ruled constraints ("parse→serialize
byte-round-trip is a pinned invariant"), F3 (fixtures only), §Learnings ("Pin
INTEGRATION points, not helpers — round-trip pinned at the save action") —
the save action is exactly where a runtime check is nearly free, since the
client already holds both the loaded markdown and the PM doc.

**Proposed fix.** Add a runtime canary, logged as a structured event with a
hash, never the body:

- On editor load, client computes `serialize(parse(loaded_md))` and compares
  to `loaded_md` (both already in memory; one extra serialize). On mismatch it
  includes `roundtrip_ok: false` in the next save POST (never blocks the
  save — the user's edit wins).
- The action logs
  `logEvent("note_roundtrip_violation", { note_id, body_sha256_16, len_stored, len_reserialized, first_diff_offset })`.
  The hash lets the operator confirm which stored revision diverged (Abram can
  ask the affected user — single-digit DAU — or reproduce from the DB with
  admin access) without the body ever entering Workers Logs.
- Do **not** run PM server-side for this: it would drag prosemirror-model into
  the worker bundle for a check the client performs for free.

**Harness pin.** Unit test on the action: `roundtrip_ok:false` payload →
event emitted with exactly the whitelisted fields (assert `body_md` /
`body` absent from the logged object). Plus F3 stays as-is for the corpus.

---

### OBS-3: Chapter-loader anchor fetch has no degraded path named — one PostgREST hiccup either 500s the reader or silently drops the 5th dot with no log

**Severity: High**

**Claim.** D5 adds a per-user PostgREST call to the chapter loader — the
app's hottest loader, which currently survives *every* auxiliary failure via
the degradation-as-absence pattern (`wordtags_degraded`, `crossref_degraded`,
`mediarefs_degraded`, `verse_signals_degraded`, `art_gallery_degraded`,
`neo4j_degraded` — scripture.tsx:110-549). The plan neither states that the
anchors fetch follows this pattern nor names its event. Unnamed at plan time,
this is exactly the path that ships as an unguarded `await` (500s the chapter
for signed-in users only — the worst possible asymmetry) or as a bare
try/catch (dot silently missing, zero signal).

**Evidence.** plan.md D5 (one call, signed-in only — no failure mode);
scripture.tsx:296-303 (`verse_signals_degraded` — the exact template: catch,
log `{name, message, book, chapter}`, return null); F-list has no anchors-
degraded entry (F2/F5/F7 cover other anchor concerns).

**Proposed fix.** State in D5: anchors fetch is wrapped, on failure
`logEvent("note_anchors_degraded", { name, message, book, chapter })` and the
loader returns the chapter with the notes signal absent (dots and rail render
without the 5th kind — degradation-as-absence is correct for *signals*; the
rail register may show a quiet "notes unavailable" line, UI panel's call).
**Privacy line:** do NOT log `userId` and do NOT log which verses have
anchors — `book`+`chapter` are already in the request URL, so the event adds
no new reading-habit information; a user-id would turn a degraded event into
a per-user reading log.

**Harness pin.** Loader test: notes client throws → chapter 200, signals
shape identical to signed-out minus nothing else, one `note_anchors_degraded`
event. (Extends F2's "zero notes calls signed-out" with "failed notes call
never breaks the chapter signed-in".)

---

### OBS-4: No CRUD events — under D6 last-write-wins, a lost write is permanently unexplainable

**Severity: Medium-High**

**Claim.** The plan defines create/update(LWW)/soft-delete actions and no
events for any of them. LWW makes silent overwrites *by design* possible (two
tabs, phone+desktop). When a user reports "half my note vanished," a log
stream with no write events offers nothing; with minimal write events the
operator can see the interleaving (`prev_updated_at` regression is the LWW-
clobber signature). Soft-delete similarly needs a breadcrumb — it is the only
destructive action and the restore path (Q3 purge-later) depends on knowing
when deletion happened.

**Evidence.** plan.md D6 ("last-write-wins v1; action returns fresh
updated_at"), Q7; §Failure modes have no runtime-visibility entries for
writes; house precedent: every consequential mutation surface logs
(search_executed for reads; migration scripts log every apply).

**Proposed fix.** Three events in notes.server.ts, ids-and-sizes only:

- `note_created  { note_id, body_len, anchor_count, anchor_kinds }`
- `note_updated  { note_id, body_len, prev_updated_at, new_updated_at, anchor_count }`
- `note_softdeleted { note_id }`

**Privacy line-items:** never `body_md`, never a title/first-line, never
anchor `ref_id`s (which verse a user annotates is a reading habit; `kind`
counts are enough for debugging shape issues). `owner_id`: omit — at
single-digit DAU the operator can correlate by time + note_id via admin SQL
when a user reports a problem; keeping user ids out of note-write events
means the log stream never becomes a per-user devotional-activity timeline.
(Deliberate divergence from search's admin-only `userId` field: search logs
already carry `q`, notes events should carry strictly less.)

**Harness pin.** Action tests assert each event fires with exactly these
fields (object-key whitelist assertion, see OBS-9).

---

### OBS-5: PostgREST error taxonomy undefined — RLS rejection, "0 rows", constraint violation, and network failure are four different bugs that will log identically (or not at all)

**Severity: Medium**

**Claim.** Under RLS, an UPDATE/DELETE against a row you can't see returns
**success with 0 rows** — no error object (smoke-notes-rls.mjs:87-101 already
relies on this). A WITH CHECK violation returns an error with a PG code
(42501); a bad anchor ref is a 4xx from validation; pool exhaustion (a
documented incident, api.search.tsx:98-100) is a thrown fetch/network error.
The plan's F7 says "→ 400 / RLS reject" but never says how these are
distinguished *in logs*, which means the implementation will bubble
`error.message` strings at best.

**Evidence.** smoke-notes-rls.mjs F1 assertions (0-row semantics);
api.search.tsx:97-140 (house pattern: classify inside the try, one
structured failure event with a repro-sufficient context);
plan.md F7 (harness-only, no runtime event).

**Proposed fix.** notes.server.ts owns a small classifier and one failure
event: `logEvent("note_write_failed", { op: "create"|"update"|"softdelete"|"anchor", note_id?, cause, pg_code?, message })`
with `cause ∈ rls_denied | not_found_or_forbidden | constraint | validation | network`:

- 0 rows on update/delete → `not_found_or_forbidden`, route returns 404 (the
  two cases are deliberately indistinguishable to the *client* — don't leak
  existence — but the log records which id was attempted so a real RLS
  misconfiguration is investigable).
- PG error codes 42501/23xxx map to `rls_denied`/`constraint`.
- Validation 400s (F7 bad kind, malformed body) follow decision-10's ratified
  posture: **unlogged** — with one exception: `note_anchor_invalid_ref
  { kind, ref_id }` *is* logged, because an invalid ref from the `[[`
  autocomplete or reference input rule means the client destination-index and
  packages/scripture slug-map have drifted — a bug, not user garbage. The
  failed `ref_id` is the minimum needed to fix that drift (allowed under the
  privacy line: it never joined a note, and the event carries no note_id).

**Harness pin.** Unit tests per cause branch; smoke-notes-rls already covers
the underlying PostgREST behaviors the classifier depends on.

---

### OBS-6: Note render failures fall into the root ErrorBoundary — one pathological note makes itself permanently unopenable with no event

**Severity: Medium**

**Claim.** notes-render.server.ts (D4, markdown-it) runs in loaders for
/notes/:id, the rail register, and search snippets. A renderer throw on a
stored body (markdown-it custom-rule edge, pathological nesting) currently
has one destination: the root ErrorBoundary (root.tsx:106-140), which logs
**nothing** (no logEvent anywhere in it) and shows "Oops!". The user's own
note becomes a page they can never open *or fix* (they can't reach the
editor through the crashed read view), and the operator gets zero signal.

**Evidence.** root.tsx:106-140 (render-only ErrorBoundary, no logging);
plan.md D4 has fail-closed for *unresolvable refs* but nothing for renderer
exceptions; F5/F6 cover content classes, not renderer crashes.

**Proposed fix.** notes-render.server.ts never throws: catch →
`logEvent("note_render_failed", { note_id, body_len, message })` → return
escaped plaintext (`<pre>` of the raw markdown, HTML-escaped — the body is
already the user's own content on their own page, so *displaying* it is fine;
*logging* it is not). The editor route must not share the render path, so the
note stays editable. **Fields:** note_id, body_len, error message only —
verify markdown-it error messages can't embed source text; if they can, log
`error.name` + a fixed string.

**Harness pin.** Fixture of hostile/pathological markdown through the real
render function: asserts non-throw, escaped-plaintext fallback, event
emitted, and (F6 tie-in) no unescaped HTML in the fallback.

---

### OBS-7: PM lazy-chunk client exceptions vanish — no window.onerror, no editor boundary, and the failure mode is user text loss

**Severity: Medium**

**Claim.** The app has no client→server error reporting of any kind: root.tsx
has no `window.onerror`/`unhandledrejection` hook, and the only client
boundary is the search-chrome one (root.tsx:79-90), which swallows silently
by design. The PM editor is about to become the most exception-prone client
code in the app (contenteditable + input rules + paste conversion + a
palette portal), and an exception mid-edit doesn't just break UI — it can
strand unsaved personal writing. Today that failure would be: white editor
region, nothing in any log, nothing the user can screenshot-explain.

**Evidence.** root.tsx (grep: only class boundary is SearchChromeBoundary;
zero onerror listeners); plan.md D7/F12 treat the editor chunk as a bundling
and e2e concern only; §Learnings' own headline is "interaction bugs must not
ride the human-tester layer again."

**Proposed fix.** Two pieces, both small:

1. **Editor-scoped React error boundary** around the PM mount whose fallback
   (a) shows the last-known markdown in a plain readonly `<textarea>` so the
   user can copy their text out (data-loss containment first), (b) offers
   reload.
2. **One beacon**: the boundary (and a PM `dispatchTransaction` try/catch if
   cheap) POSTs to a tiny resource route that calls
   `logEvent("editor_client_error", { message, stack_head, note_id?, ua })` —
   `stack_head` = first ~3 frames. **Never the doc content, never the
   selection.** At single-digit DAU a full telemetry pipeline is noise; one
   action route + one event is proportionate and reuses house logging.

If the panel judges the beacon route too much for v1, the boundary alone is
the floor — but then the plan must say the editor error rate is deliberately
unobserved, so the retro can hold that decision accountable.

**Harness pin.** Component test: throw inside the PM mount → fallback shows
the markdown, beacon fired (fetch mocked), payload contains no body text
(assert the doc string absent from the serialized request).

---

### OBS-8: Save posture (explicit vs autosave) is unspecified, so save-failure visibility is unspecified — the one failure the user absolutely must see

**Severity: Medium**

**Claim.** The plan defines actions and LWW but never says whether the editor
saves explicitly (button/Cmd+S) or autosaves (debounced). That ambiguity has
an obs consequence: a failed save of a personal note is the highest-stakes
user-facing failure in the feature, and the plan currently guarantees neither
a UI signal nor an event. With RR fetchers, a failed action that nobody reads
`fetcher.data` from is silent — the search-ui B7/B3 lesson verbatim
(search.tsx:662-672 exists because of it).

**Evidence.** plan.md D6 ("action returns fresh updated_at" implies a save
round-trip exists, posture unstated); no F-item covers save failure; house
precedent for the fix: search.tsx liveError/pageError explicit error states.

**Proposed fix.** Whatever the posture:

- Server event is OBS-5's `note_write_failed` (one event, `op` field —
  don't mint a separate autosave event name).
- Client contract (UI panel owns the rendering, obs owns the requirement):
  save state must be one of saved / saving / **failed-with-retry**, driven by
  `fetcher.state` + shape-guarded `fetcher.data`; a failed save keeps the
  dirty buffer and never navigates away silently. If autosave: failures also
  mark the document visibly dirty (no toast-and-forget).
- Add to F-list: "F13 save failure: action 500/network during save →
  visible failed state, buffer preserved, `note_write_failed` logged" — with
  a Playwright flow (offline emulation) among the ~6 e2e flows.

---

### OBS-9: Script conventions: migrate-notes.mjs has no stated event contract (smoke-notes-rls.mjs already conforms)

**Severity: Low**

**Claim.** search-endpoint plan decision 10 bound scripts to
migrate-media-collections.mjs conventions **verbatim**: `COMMIT=1` apply-gate
(dry-run default), JSON terminal events (`migration_applied` /
`migration_dry_run_ok` / `invariant_check` per invariant / `migration_done`),
exit 2 on invariant violation, `scrubSecrets` on all error output. This plan
lists migrate-notes.mjs with its DDL contents but no event/exit contract —
the one place the house has a ratified word-for-word standard.

**Evidence.** docs/features/search-endpoint/plan.md:54 (decision 10);
scripts/migrate-media-collections.mjs:95-145 (the reference implementation);
scripts/smoke-notes-rls.mjs (already written, red-first — ✓/✗ checks,
terminal `smoke-notes-rls: PASS|FAIL (n)`, exit 0/1, matches
smoke-canon-spine.mjs house style; no changes needed, though its user
fixtures use `@example.invalid` emails and service-role cleanup — good).

**Proposed fix.** One sentence in the plan: "migrate-notes.mjs follows
migrate-media-collections.mjs conventions verbatim (COMMIT=1 gate, JSON
events, `invariant_check` per invariant — suggested invariants: RLS enabled
on both tables, all four policies present, lumen_read grant count = 0,
trigger exists, tsvector column generated — exit 2 on violation,
scrubSecrets)." The D3 no-grant check exists in smoke-notes-rls but must ALSO
be a migration invariant so the migration itself refuses to conclude in a
leaky state.

---

## Privacy line-items (the whitelist, per event)

| Event | Allowed fields | Explicitly forbidden |
|---|---|---|
| `note_created` | note_id, body_len, anchor_count, anchor_kinds | body_md, first line/title, ref_ids, owner_id |
| `note_updated` | note_id, body_len, prev_updated_at, new_updated_at, anchor_count | same |
| `note_softdeleted` | note_id | same |
| `note_write_failed` | op, note_id?, cause, pg_code?, message | body_md, ref_ids (except below) |
| `note_anchor_invalid_ref` | kind, ref_id (failed ref only) | note_id, body |
| `note_roundtrip_violation` | note_id, body_sha256_16, len_stored, len_reserialized, first_diff_offset | body_md, any diff excerpt |
| `note_anchors_degraded` | name, message, book, chapter | userId, verse list, anchor refs |
| `search_group_degraded` (key=notes) | key, message-or-code, ms | q-derived snippet, hits content |
| `note_render_failed` | note_id, body_len, message (or name if message can echo source) | body_md, rendered HTML |
| `editor_client_error` | message, stack_head, note_id?, ua | doc content, selection text |

Standing rule for the plan text: **no notes event ever logs body content,
note titles/first lines, or the set of refs a note anchors to; user ids stay
out of note-write events entirely.** `search_executed` continues to log `q`
per house standard — that predates this feature and is a search-surface
decision, not a notes one.

---

## Open-question input

- **Q3 (soft-delete — default yes):** supports it from the obs side, with the
  addendum that `note_softdeleted` (OBS-4) is the breadcrumb the future purge
  job and any "restore my note" request will depend on. Purge job, when it
  comes, follows migration-script event conventions (`invariant_check` on
  "nothing younger than N days purged").
- **Q6 (mobile compose — default yes):** mobile Safari is where PM
  contenteditable bugs live; if Q6 is yes, OBS-7's editor boundary + beacon
  moves from nice-to-have toward necessary, since F12's Playwright iOS
  profile won't catch real-device-only input quirks — the beacon is the only
  way to hear about them.
- **Q7 (LWW — default yes):** acceptable v1 *only with* OBS-4's
  `prev_updated_at`/`new_updated_at` pair logged; that pair is what makes an
  eventual optimistic-lock decision evidence-based (count observed
  regressions in prod logs) instead of vibes-based.
- **New question for the gate (save posture):** explicit save vs autosave is
  unstated in the plan (OBS-8) and it gates editor UX, e2e flow design, and
  the failure-visibility contract. Should be decided at the gate, not
  discovered during implementation.

## Harness gaps

1. **Merged-search degraded contract (OBS-1)** — no F-item covers "notes leg
   fails → 200, degraded signal in response + `search_group_degraded`
   emitted + `zeroResult` unpolluted." Extend F9 or add F13.
2. **Anchors-degraded loader pin (OBS-3)** — F2 pins the signed-out zero-call
   case; nothing pins "signed-in anchors fetch fails → chapter still 200 +
   `note_anchors_degraded`." Template exists (verse_signals_degraded tests, if
   any; otherwise this is the first pin of that pattern — worth doing).
3. **Runtime round-trip canary (OBS-2)** — F3 is fixtures-only; add the
   action-level test that a `roundtrip_ok:false` save emits the hash-only
   event.
4. **Log privacy lint** — cheap and high-leverage: a vitest that greps
   `apps/web/app/lib/notes*.server.ts`, `apps/web/app/routes/notes*.tsx`, and
   the editor beacon route for `logEvent(` calls and asserts no call's
   argument text contains `body_md`, `body:`, `snippet`, or `ref_ids` (allow-
   list `note_anchor_invalid_ref` for `ref_id`). Belt-and-braces variant:
   unit tests spy on console.error and assert emitted objects' key sets equal
   the whitelist table above. Either is an afternoon; the grep version never
   rots because it fails loud on new logEvent call sites.
5. **Render-failure fallback (OBS-6)** — F5/F6 cover content, not renderer
   throws; add the pathological-markdown fixture asserting non-throw +
   plaintext fallback + event.
6. **Save-failure e2e (OBS-8)** — none of the ~6 proposed Playwright flows is
   named; one slot should be the offline/500 save with visible failed state
   and preserved buffer.
