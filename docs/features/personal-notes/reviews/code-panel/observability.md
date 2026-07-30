# Code-panel — OBSERVABILITY (personal-notes, step 9)

Lane: event vocabulary vs the A13/CF-26/CF-49 pins; privacy shape at every
logEvent call site; classifier taxonomy vs real PostgREST errors; exactly-one
emission on degraded paths; extraGroups/zeroResult purity; silent-failure
holes. All line numbers verified against the working tree on
feature/personal-notes. Note: no vitest/e2e/smoke file asserts on any event
emission, so nothing below contradicts a green harness — the event layer is
untested (consistent with the adopted harness-gap backlog).

## OBSERVABILITY-1: note_write_failed logs a `message` field beyond the pinned {op, cause, pg_code?} shape — and PG/PostgREST messages can embed values

Severity: high
Category: privacy / event-shape pin violation
File: apps/web/app/lib/notes.server.ts:88–96

Claim: A13 pins `note_write_failed {op, cause, pg_code?}` and the module's
own header (notes.server.ts:31–34) says "ids and sizes only … never
anchor ref_ids (allowlisted exception: note_anchor_invalid_ref)". `failWrite`
additionally logs `message: (error.message ?? "").slice(0, 200)`. PG error
messages embed user-supplied values in known cases: 22P02 renders
`invalid input syntax for type X: "<the value>"`, enum violations echo the
offending literal, and PostgREST filter-parse failures echo the filter
string — which in `getChapterNoteAnchors` (notes.server.ts:172–174)
contains ref_ids. So a non-allowlisted event can carry ref-bearing content;
falsify by forcing a 22P02 through any write path and inspecting the log
line. (Bodies are unlikely to appear — the realistic leak class is refs/ids
— but the pin's allowlist is explicit.) Secondary instance, same class,
much lower weight: `note_updated` logs `prev_updated_at`/`new_updated_at`
(notes.server.ts:258–263), which are neither ids nor sizes; harmless
content, but also outside the pinned field set.

Proposed fix: drop `message` from `note_write_failed` (cause + pg_code is
the pinned diagnostic surface; pg_code alone reproduces the PG error class),
or reduce it to `pg_code`-keyed static text. If a free-text field is truly
wanted, allowlist it per-cause and strip anything matching the ref grammar.

## OBSERVABILITY-2: chapter-anchor failure double-emits — note_write_failed + note_anchors_degraded for one failure, on every 750ms timeout

Severity: med
Category: degraded-path emission count
File: apps/web/app/lib/notes.server.ts:179; apps/web/app/routes/scripture.tsx:359–369

Claim: `getChapterNoteAnchors` routes its error through `failWrite`
(notes.server.ts:179), which logs `note_write_failed {op:"chapter_anchors"}`
and throws; the loader wrapper's catch (scripture.tsx:359) then logs
`note_anchors_degraded`. Every failure — including every ordinary 750ms
abort (postgrest-js converts the AbortError into an error return with
`code:""` → cause `"network"`) — produces TWO events. A5 pins one event
(`note_anchors_degraded`) for this degraded path, and A13's
`note_write_failed` is a write-path event; a slow chapter load inflating
the write-failure count corrupts the exact signal the classifier exists to
keep clean. Falsify: point the loader at an unreachable PostgREST and count
event lines per request.

Proposed fix: `getChapterNoteAnchors` should throw raw (no `failWrite`)
and let the loader's catch own the single `note_anchors_degraded` emission
— it is the only caller and is already never-throw.

## OBSERVABILITY-3: every signed-in notes-only search logs zeroResult:true — extraGroups keeps zeroResult clean in one direction only

Severity: med
Category: metric purity (OU-1 / CF-4 "zeroResult unpolluted")
File: apps/web/app/lib/search-obs.server.ts:59–63; apps/web/app/routes/api.search.tsx:167–176; apps/web/app/routes/search.tsx:327–334

Claim: on the notes-only scope both surfaces synthesize
`{groups: [], meta: {perGroup: {}, totalMs: 0, mode: "none"}}` and pass it
to `logSearchExecuted`. There `degraded=false` (perGroup empty), `after`
undefined, `groups.every(empty)`=true, `reference` null → `zeroResult:
true` on EVERY notes-only search, even one whose extraGroups shows
`notes: {hits: 8}`. The A4 pin ("extraGroups … zeroResult unpolluted")
holds for unscoped/mixed searches but inverts on notes-only: a search the
canon engine never ran counts as a canon relevance failure in the OU-1
denominator unless every consumer remembers to filter `mode:"none"` — a
mode value that did not exist before this feature. Falsify: run
`?q=x&scope=notes` signed-in with matching notes and read the event.

Proposed fix: in `logSearchExecuted`, gate zeroResult on the engine having
run — e.g. `result.meta.mode !== "none"` (or
`Object.keys(result.meta.perGroup).length > 0`) — one line, keeps the
field a pure canon-engine signal in both directions.

## OBSERVABILITY-4: update with invalid anchors returns ok:true and silently skips the whole anchor sync — the only signal is a context-free note_anchor_invalid_ref

Severity: med
Category: silent partial failure
File: apps/web/app/routes/notes.$id.tsx:215–220, 125–139

Claim: in the `update` intent, when `sync_anchors=1` and `readAnchors`
fails, the code logs `note_anchor_invalid_ref` and then falls through to
`return json({ ok: true, … })` — the body saved but the ENTIRE anchor diff
(including the valid refs) was dropped, and the autosaving client is told
everything succeeded. Contrast `create`, which 400s on the same condition
(line 166–168). Because `note_anchor_invalid_ref` logs only
`{ref_id}` (its comment calls the condition "client/slug-map drift — a
bug"), the operator sees a floating ref with no op, no note_id, and no way
to know anchor rows are silently diverging from wikilinks on a specific
note, save after save. Falsify: PATCH an update with one malformed
`anchor` field; observe 200 ok:true and unchanged anchor rows.

Proposed fix: keep the body save, but (a) add `{op:"update", note_id}` to
the event at this call site (ids are allowlisted), and (b) surface the
partial failure in the response (e.g. `{ok:true, anchors_synced:false}`)
or sync the valid subset instead of dropping all.

## OBSERVABILITY-5: the action's catch-all assumes every throw was classified by the data layer — a non-NoteWriteError exception is an unlogged 500

Severity: med
Category: silent-failure hole
File: apps/web/app/routes/notes.$id.tsx:353–357

Claim: the catch comment says "classified + logged at the data layer
(note_write_failed)", but the try block also runs code that is not the
data layer: `canonicalizeNoteMarkdown` (lines 171, 189, 256 — the A3
"parse never throws" pin covers markdown-it, not the prosemirror-side
serializer config), `crypto.subtle.digest` (line 194), and
`deriveNoteTitle` (line 281). Any throw from these returns the generic
500 with zero log lines — exactly the silent-500 class in a personal-data
write path, on a Workers runtime where stdout is the only signal. Falsify:
make `canonicalizeNoteMarkdown` throw for one input and grep the log.

Proposed fix: in the catch, `if (!(err instanceof NoteWriteError))
logEvent("note_write_failed", { op: intent, cause: "unknown" })` (name
only, no message per OBSERVABILITY-1) before returning the 500.

## OBSERVABILITY-6: classifier drift vs real PostgREST errors — "validation" is unreachable, auth failures read as "network", and 2200N is a stray code

Severity: med
Category: cause taxonomy (CF-49)
File: apps/web/app/lib/notes.server.ts:55–86; apps/web/app/routes/notes.$id.tsx:162–167, 182–188

Claim: (a) `NoteWriteCause` includes `"validation"` but
`classifyWriteError` can never return it and nothing else constructs
`NoteWriteError` — the pinned cause is dead vocabulary, and the route's
actual validation failures (`note_too_large`, `anchor_invalid`,
`base_required` 400s) emit no event at all. A client bug that persistently
produces oversized autosaves — a permanently failing autosave, the A13
"worst outcome" class from the user's side — is invisible to the operator.
(b) PostgREST auth-layer errors (PGRST301 JWT expired, PGRST302) fall to
the `code !== ""` catch-all → `"network"`, misfiling the single most
plausible field failure (session expiry mid-autosave; the module's own
header at lines 25–29 documents the token-expiry window) under the least
actionable cause. (c) `"2200N"` (invalid_xml_content) at line 80 is
unreachable for this schema — likely a typo'd class-22 code; harmless but
evidence the constraint list wasn't derived from the actual DDL
(22001/22P02/23xxx are the real ones).

Proposed fix: emit `note_write_failed {op, cause:"validation"}` from the
route's three validation 400s (or delete the dead cause); map `PGRST3\d\d`
to `rls_denied` (or a new `auth` cause if the ledger permits); drop 2200N.

## OBSERVABILITY-7: note_write_failed fires for pure reads (op: list/get/anchors/chapter_anchors)

Severity: low
Category: event-name truthfulness
File: apps/web/app/lib/notes.server.ts:120, 135, 149, 179

Claim: `listNotes`, `getNote`, `getNoteAnchors`, `getChapterNoteAnchors`
all route errors through `failWrite`, so a failed SELECT logs
`note_write_failed` — the A13 event whose name and cause taxonomy describe
writes. A read outage (e.g. pool exhaustion, a documented incident class
here) inflates the write-failure signal. Falsify: break `listNotes` and
read the emitted event name.

Proposed fix: split a `note_read_failed` event (same classifier) or rename
the shared emitter's event per op class; keep the write ops on the pinned
name. (Overlaps OBSERVABILITY-2's fix for chapter_anchors.)

## OBSERVABILITY-8: the /notes/new anchor prefill drops invalid refs with no note_anchor_invalid_ref — the one insert path without drift detection

Severity: low
Category: silent-failure hole
File: apps/web/app/routes/notes.$id.tsx:70–73

Claim: the loader resolves `?anchor=` and silently nulls it on grammar
failure — no event — while every POST path logs
`note_anchor_invalid_ref` on the same condition, whose stated purpose is
catching "client/slug-map drift" from our own link builders. The main
producers of this URL are our own capture affordances (media.tsx builds
`episode@t` links; scripture rail builds verse refs), so a drift bug there
degrades every capture from a surface to an unanchored blank editor with
zero signal. Falsify: visit `/notes/new?anchor=not#valid` and grep the log.

Proposed fix: log `note_anchor_invalid_ref { ref_id: anchorParam.slice(0,160) }`
in the loader's null branch — one line, already-allowlisted event.

## OBSERVABILITY-9: note_roundtrip_violation re-fires on every failed/409 save, and the hash is of the wrong body

Severity: low
Category: event quality vs the A19 "reports once" pin
File: apps/web/app/components/editor/NoteEditor.tsx:367–373, 572–577; apps/web/app/routes/notes.$id.tsx:192–207

Claim: the canary is cleared only when a save succeeds
(`canaryRef.current = null` behind `d.updated_at`, NoteEditor.tsx:572–574);
a 409/500/validation-400 leaves it set, so each retry re-sends
`roundtrip_ok=false` and the server logs another violation — "reports
once" holds only on the happy path. Also, the server hashes `canonical`
(the CURRENT buffer at save time, notes.$id.tsx:194–196) while
`len_stored`/`len_reserialized`/`first_diff_offset` describe the LOADED
body — the hash cannot be correlated with the mismatch the other three
fields report, halving the event's forensic value. Falsify: open a
mismatching note, force one 409, save again; count events and compare the
hash to sha256(stored body).

Proposed fix: client sends a precomputed hash of `initialBody` (or the
server hashes nothing and trusts lengths+offset); clear the canary after
the FIRST submit that carried it, regardless of outcome.

## OBSERVABILITY-10: extraGroups reports notes hits on the reference short-circuit path, where the group was dropped from the response

Severity: low
Category: log truthfulness (A4)
File: apps/web/app/routes/api.search.tsx:199–221; apps/web/app/routes/search.tsx:348–368

Claim: A4 pins "leg skips on reference short-circuit"; the implementation
runs the leg unconditionally (it cannot know the reference in advance),
drops the group from the merged response on short-circuit, but still logs
`extraGroups.notes.hits` from the discarded group — the event claims the
user was shown notes results they never received. Any funnel joining
extraGroups hits to click-through will undercount systematically on
reference-shaped queries. (Whether the leg should run at all on this path
is a performance-lane question; this finding is only about the log.)
Falsify: search a bare reference ("alma 32") signed-in with matching notes
and compare the event to the response body.

Proposed fix: on the short-circuit branch log
`extraGroups.notes = { hits: 0, degraded: … , skipped: true }` — or omit
extraGroups there, matching the response.

## Verified clean (explicit empty results in-lane)

- Editor error boundary with no beacon: the deliberate recording EXISTS and
  matches — plan.md:373–374 ("client beacon NOT in v1 — editor error rate
  deliberately unobserved (recorded)"), Decisions CF-51
  ("boundary yes, beacon rejected-with-rationale"), and
  NoteEditor.tsx:14 + EditorBoundary (NoteEditor.tsx:247–279, no telemetry,
  buffer-preserving fallback). Implementation conforms to the ruling; no
  finding.
- searchNotesLeg degradation emits exactly ONE `search_group_degraded`
  (notes.server.ts:388–394); notes never enters `meta.perGroup`, so
  search-obs.server.ts:44 cannot double-emit for it. Field shape
  {key, message, ms} matches the canon emission.
- Privacy sweep of `note_created` (id/body_len/anchor_count/anchor_kinds),
  `note_softdeleted` (note_id), `note_render_failed` (body_len + err NAME
  only), `note_anchors_degraded` (name/message/book/chapter — the plan's
  "no userId, no verse list" holds), `note_roundtrip_violation` (note_id,
  16-hex hash, lengths, offset): no bodies, no titles, no snippets, no
  owner_id anywhere; ref_ids only in the allowlisted
  `note_anchor_invalid_ref`. The one exception is the `message` field
  (OBSERVABILITY-1).
- `note_render_failed` fallback emits once and returns escaped plaintext;
  renderNoteHtml is genuinely never-throw at its boundary
  (notes-render.server.ts:93–107).
- Autosave failure loudness (A13): server-side failures log
  `note_write_failed` via the data layer and the client shows the
  persistent failed state + Retry (NoteEditor.tsx:669–672, 779–791);
  transport-level failures that never reach the Worker are covered by the
  client's failed state, and the absence of client telemetry for them is
  inside the recorded CF-51 beacon rejection.

## Summary

critical: 0 · high: 1 (OBSERVABILITY-1) · med: 5 (OBSERVABILITY-2…6) ·
low: 4 (OBSERVABILITY-7…10)
