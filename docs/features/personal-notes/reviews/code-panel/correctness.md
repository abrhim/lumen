# CORRECTNESS — personal-notes code panel (step 9)

Lane: markdown boundary (`markdown.ts`), reference detector (`reference-rule.ts`),
ProseMirror plugins in `NoteEditor.tsx`, `append`/`append_undo` byte-restore in
`routes/notes.$id.tsx`, LWW conditional update in `notes.server.ts`,
`syncNoteAnchors` diff.

Method: read the implementation, then ran two throwaway vitest probe files
against the real `canonicalizeNoteMarkdown` / `findCanonReferences` (≈120 inputs;
probes deleted after the run). Empirical results are quoted where they carry a
finding.

---

## CORRECTNESS-1: edits made while a save is in flight are marked clean and silently lost

**Severity:** critical
**Category:** data loss / autosave ordering
**File:** `apps/web/app/components/editor/NoteEditor.tsx:347-352, 496-505, 550-564, 567-578`

**Claim.** `save()` snapshots the body once (`const body = currentMarkdown()`,
:349) and sets `savingRef.current = true`. The result effect (:567-578) clears
dirty *unconditionally* on any successful response:

```ts
if (d.updated_at) { baseRef.current = d.updated_at; canaryRef.current = null;
                    dirtyRef.current = false; setDirty(false); }
```

It never compares what came back to what the buffer now holds. Sequence:

1. t0 — autosave fires, snapshot `B1`, `savingRef = true`.
2. t0+120ms — user types; `dispatchTransaction` sets `dirtyRef.current = true`,
   `latestMdRef.current = B2`. (`setDirty(true)` is a no-op — already true.)
3. t0+300ms — the `B1` response lands; effect sets `dirtyRef.current = false`,
   `setDirty(false)`. UI reads **"Saved"**.

`B2` is now unsaved with `dirtyRef === false`. The blur / `visibilitychange` /
unmount flush (:551-552) is gated on `dirtyRef.current`, so closing the tab or
backgrounding the app at this point discards `B2` with no signal. Recovery only
happens if the user types again (which re-sets `dirtyRef`) *and* a later timer
fires — see CORRECTNESS-2, which removes that second half.

This directly violates G5's "buffer never lost" (plan.md:314-321). The green
harness does not cover it: no test exercises a keystroke concurrent with an
in-flight fetcher.

**Proposed fix.** Capture the snapshot on the request and only clear dirty when
the buffer still equals it:

```ts
const pendingRef = useRef<string | null>(null);
// in save(): pendingRef.current = body;
// in the result effect:
if (d.updated_at) {
  baseRef.current = d.updated_at;
  canaryRef.current = null;
  if (currentMarkdown() === pendingRef.current) { dirtyRef.current = false; setDirty(false); }
  else saveRef.current();          // coalesce the edits made during the flight
  pendingRef.current = null;
}
```

Same treatment for the early-return at :348: instead of dropping a concurrent
`save()` on the floor, set a `queuedRef` flag and re-fire in the result effect
(this also fixes ⌘S and the visibility flush being silently no-ops mid-save).

---

## CORRECTNESS-2: the autosave debounce is not idle-based, and "retrying on next change" never retries

**Severity:** high
**Category:** autosave debounce / state
**File:** `apps/web/app/components/editor/NoteEditor.tsx:543-547, 500-505, 779-781`

**Claim.**

```ts
useEffect(() => {
  if (!dirty || noteId === null) return;
  const t = setTimeout(() => saveRef.current(), 3000);
  return () => clearTimeout(t);
}, [dirty, latestMdRef.current, noteId]);
```

`latestMdRef` is a **ref**; its `.current` is only sampled when a render happens
for some other reason. The only render trigger on keystroke is
`setDirty(true)` (:502) — and once `dirty` is already `true`, React bails out of
the re-render, so the effect's dependency array is never re-evaluated. Two
consequences:

- **The timer is not reset by subsequent keystrokes.** The save fires 3s after
  the *first* keystroke of a dirty run, mid-sentence, not after 3s of idle. G5
  specifies "≥3s idle debounce" (plan.md:314-315).
- **After a failed save there is no retry.** On failure the result effect leaves
  `dirty === true` and no timer pending; the next keystroke is again a no-op
  `setDirty(true)`, so the effect never re-runs and no new timer is scheduled.
  The status line claims *"Save failed — edits kept, retrying on next change"*
  (:780) — it does not retry. Only the explicit Retry button or a
  blur/visibility flush recovers. That is exactly the OBS-8 "silent autosave
  failure" outcome A13 was written to prevent.

Falsification: instrument `save()` and type continuously for 10s — you will see
saves at ~3s intervals rather than one save 3s after typing stops; then force a
500 from the action and keep typing — no further request is issued.

**Proposed fix.** Drive the debounce off state that actually changes, and
schedule an explicit retry:

```ts
const [rev, setRev] = useState(0);
// dispatchTransaction, on tr.docChanged: setRev(r => r + 1)
useEffect(() => {
  if (!dirtyRef.current || noteId === null) return;
  const t = setTimeout(() => saveRef.current(), 3000);
  return () => clearTimeout(t);
}, [rev, noteId, saveFailedAt]);   // saveFailedAt bumped by the result effect on failure
```

and drop `latestMdRef.current` from any dependency array (it is never a valid
dep).

---

## CORRECTNESS-3: a 409 permanently wedges the editor — the base is never re-adopted and the buffer has no exit

**Severity:** high
**Category:** LWW / conflict recovery
**File:** `apps/web/app/routes/notes.$id.tsx:223-233`, `NoteEditor.tsx:567-578, 672, 776-778`

**Claim.** The action returns the full current row on conflict
(`current: { body_md, updated_at }`, :228) but the client ignores it: the result
effect only acts on `d.updated_at` (top-level), which a 409 body does not carry.
`baseRef.current` therefore stays at the stale value, so *every* subsequent save
from that editor 409s forever. The UI shows "Changed elsewhere — reload to
merge" (:777) with no merge affordance, no `beforeunload` guard, and no copy-out
path (the `EditorBoundary` textarea only appears on a render crash). A user who
keeps typing after a 409 and then navigates away loses everything typed since.

This is reachable by a single user without concurrent devices: the reader's
`append` capture (`routes/notes.$id.tsx:240-289`) writes to the same row and
bumps `updated_at`. Capture a verse into the last-touched note from a second
tab while the editor is open in the first → the editor is wedged.

**Proposed fix.** On a 409, either (a) if the local buffer is unchanged from
`initialBody`, adopt `current.body_md` + `current.updated_at` and reload the
view silently; or (b) if the buffer diverges, keep the buffer, adopt
`current.updated_at` as the new base so the *next* save wins (this is what
"LWW" in A13 actually asks for), and surface the incoming version in a
read-only panel. Minimum viable: adopt `d.current.updated_at` into `baseRef` and
render `d.current.body_md` in a copy-out textarea. Also add a `beforeunload`
guard while `dirtyRef.current` is true and the last save failed.

---

## CORRECTNESS-4: the body-size guard measures the pre-canonical body; canonicalization can double it and trip the DDL CHECK as a 500

**Severity:** high
**Category:** validation ordering
**File:** `apps/web/app/routes/notes.$id.tsx:162-164, 182-184, 189`; `scripts/migrate-notes.mjs:46`

**Claim.** Both `create` and `update` validate `rawBody`:

```ts
if (new TextEncoder().encode(rawBody).byteLength > NOTE_BODY_MAX_BYTES) → 400
...
const canonical = canonicalizeNoteMarkdown(rawBody);   // stored value
```

but store `canonical`, and the DDL wall is
`CHECK (octet_length(body_md) <= 65536)` on the **stored** value. The serializer
backslash-escapes `` ` * \ ~ [ ] `` , so C(md) can be **2× the input**. Measured:

| input (1001 bytes) | canonical |
|---|---|
| `"*" × 1000` | 2001 |
| `"[" × 1000` | 2001 |
| realistic prose with `[x]`, `*`, backticks | +12% |

A 40 KB body of bracket-heavy text passes the 400 guard and then fails the
Postgres CHECK → `23514` → `classifyWriteError` → `constraint` →
`NoteWriteError` → route catch (:353-357) → **500 "The note could not be
saved"**, an opaque failure with no path forward, on a body the user cannot
shrink by any visible amount.

Additionally `append` (:240-289) has **no** size guard at all — appending to a
note at the limit is always a 500 rather than a friendly refusal.

**Proposed fix.** Canonicalize first, measure the canonical bytes, and 400 with
`note_too_large`:

```ts
const canonical = canonicalizeNoteMarkdown(rawBody);
if (new TextEncoder().encode(canonical).byteLength > NOTE_BODY_MAX_BYTES)
  return json({ error: "Note is too large", code: "note_too_large" }, 400, headers);
```

Apply the same check in `create` and in `append` (on the post-append canonical
body). Keep a raw-body pre-check as a cheap early-out for absurd payloads.

---

## CORRECTNESS-5: an anchor-sync failure after a successful body update wedges the editor's base

**Severity:** high
**Category:** write ordering / partial failure
**File:** `apps/web/app/routes/notes.$id.tsx:213-221, 353-357`; `notes.server.ts:275-308`

**Claim.** In the `update` intent the body update lands first, then:

```ts
if (result.ok) {
  if (form.get("sync_anchors") === "1") { ... await syncNoteAnchors(...); }
  return json({ ok: true, updated_at: result.note.updated_at }, 200, headers);
}
```

`syncNoteAnchors` calls `failWrite` on any PostgREST error, which throws
`NoteWriteError`. That throw escapes past the already-successful update into the
route's blanket catch → **500**. The client therefore never receives the new
`updated_at`, `baseRef` stays stale, and `updated_at` in the DB has moved →
every subsequent save from that editor 409s (CORRECTNESS-3's wedge, now
self-inflicted by a transient anchor write).

`syncNoteAnchors` is also non-atomic (N delete round-trips then one upsert,
:287-307), so a mid-loop failure leaves the anchor set partially applied while
the body is committed.

The same shape exists in `append` (:259-276): a `syncNoteAnchors` throw after a
successful body update returns 500 while the line *is* appended — the user
retries the capture and gets a duplicate line.

**Proposed fix.** Wrap the post-update anchor sync in its own try/catch, log
`note_anchor_sync_failed`, and still return `{ ok: true, updated_at }` (anchors
are derived state and self-heal on the next save):

```ts
if (form.get("sync_anchors") === "1") {
  const anchors = readAnchors(form);
  if (anchors.ok) {
    try { await syncNoteAnchors(request, env, params.id, anchors.anchors); }
    catch { logEvent("note_anchor_sync_failed", { note_id: params.id }); }
  }
}
```

Longer term, move the diff into a SECURITY INVOKER RPC alongside the update, as
`create_note_with_anchors` already does.

---

## CORRECTNESS-6: `sanitizeWikilinkLabel` does not strip newlines, so a labelled append destroys the link and makes the undo impossible

**Severity:** medium
**Category:** markdown boundary / label grammar
**File:** `apps/web/app/components/editor/markdown.ts:165-167`; `routes/notes.$id.tsx:250-258, 310-317`

**Claim.** The doc comment pins the contract: "`|`, `[`, `]` can never survive
into a stored label — the serialized form must re-tokenize to the same node."
The implementation is `label.replace(/[[\]|]/g, "").trim()`, which leaves `\n`
and `\r` intact, and the tokenizer explicitly rejects inner text containing a
newline (`notes-markdown-config.ts:45`). Measured:

```
sanitizeWikilinkLabel("a\nb")                     → "a\nb"
canonicalizeNoteMarkdown("x [[gen-1|a\nb]] y\n")  → "x \\[\\[gen-1|a\nb\\]\\] y\n"
```

The `append` intent takes `label` straight from the form (:250) and builds
`[[ref|label]]`. With a newline in the label the canonicalized body contains
escaped literal `\[\[…\]\]` junk instead of a link, **and** `append_undo`'s
byte-restore (:311-314) no longer matches — `body.endsWith("\n" + line + "\n")`
is false, so `prev === null` → 409 "Note changed since capture". The user is
left with permanent literal garbage in the note that undo cannot remove.

Not reachable from today's capture rail (`scripture.tsx:1481` passes
`verseRef`), but `append` is an authenticated form endpoint that accepts
arbitrary `label` values, and the sanitizer is the *documented* guarantee.

**Proposed fix.** Make the sanitizer enforce the contract it claims:

```ts
export function sanitizeWikilinkLabel(label: string): string {
  return label.replace(/[[\]|]/g, "").replace(/\s+/g, " ").trim();
}
```

Add a fixture asserting `C("x [[gen-1|" + dirty + "]] y\n")` still contains a
wikilink for `dirty ∈ { "a\nb", "a\r\nb", "a\tb", "a|b", "a]]b" }`.

---

## CORRECTNESS-7: the `[[` autocomplete span never deactivates on `]]` or on the caret moving past it — which silently disables the reference auto-link

**Severity:** medium
**Category:** ProseMirror plugin state
**File:** `apps/web/app/components/editor/NoteEditor.tsx:180-185, 93`

**Claim.** The comment says "deactivate when the caret leaves the span **or
`]]` closes it**", but the code only handles the backwards case:

```ts
if (next.from !== null && !next.insertPosture) {
  const head = tr.selection.head;
  if (head < next.from + 2) next = { ...next, from: null };
}
```

There is no `]]` check and no forward/cross-block bound. So typing a complete
`[[alma-32-21]]` by hand, or typing `[[` and then clicking into a later
paragraph, leaves `from !== null` indefinitely. Because the auto-link plugin is
gated on exactly that (`if (autocompleteKey.getState(state)?.from !== null)
return null;`, :93), **the reference auto-link stays dead for the rest of the
editing session** — the user types "Alma 32:21 " and nothing links, with no
explanation. The stray popup also stays mounted.

(Escape does clear it, via the registry — but only because Escape happens to be
pressed; see CORRECTNESS-9 for why that path is itself unreliable.)

**Proposed fix.** In `apply`, close the span when the caret leaves it in either
direction, when the doc text between `from` and `head` contains `]]`, or when
`head` leaves the block:

```ts
if (next.from !== null && !next.insertPosture) {
  const head = tr.selection.head;
  const $from = tr.doc.resolve(next.from);
  const closed = head >= next.from + 2 &&
    tr.doc.textBetween(next.from + 2, head, " ", " ").includes("]]");
  if (head < next.from + 2 || head > $from.end() || closed) next = { ...next, from: null };
}
```

---

## CORRECTNESS-8: `lumenUrlToRef` never checks the host — pasting an unrelated URL silently becomes a wikilink

**Severity:** medium
**Category:** paste conversion / false positive
**File:** `apps/web/app/components/editor/NoteEditor.tsx:220-243, 480-495`

**Claim.** The function is named `lumenUrlToRef` and the header comment says
"paste conversion of **Lumen** URLs", but it parses `new URL(raw.trim())` and
inspects only the path. The last branch is the dangerous one:

```ts
if (segs.length === 2 && resolveAnchorRef(segs[1])?.kind === "entity") return segs[1];
```

Any two-segment URL whose last segment matches `ENTITY_SHAPE` converts. Pasting
`https://github.com/anthropics/claude` replaces the pasted text with
`[[claude]]` — a link to a Lumen entity that has nothing to do with the source.
`https://en.wikipedia.org/wiki/faith` → `[[faith]]`. `handlePaste` returns
`true`, so the original URL text is destroyed and only Ctrl-Z recovers it.
The `/scripture/*` and `/media/*` branches are equally host-blind.

**Proposed fix.** Gate on same-origin (plus explicitly allowed production
hostnames) before any path inspection:

```ts
const url = new URL(raw.trim());
if (typeof location !== "undefined" && url.origin !== location.origin) return null;
```

and drop or tighten the bare two-segment entity branch (require a known entity
route prefix such as `/people/`, `/places/`, `/topics/` rather than "any
two-segment path").

---

## CORRECTNESS-9: the global Escape handler dynamically imports `escape-registry`, so `preventDefault()` is a no-op

**Severity:** medium
**Category:** popup close path
**File:** `apps/web/app/components/editor/NoteEditor.tsx:610-619` (vs. the static import at :35)

**Claim.**

```ts
const onKey = (e: KeyboardEvent) => {
  if (e.key !== "Escape") return;
  import("~/lib/escape-registry").then(({ popEscape }) => {
    if (popEscape()) e.preventDefault();
  });
};
```

The dynamic import resolves in a microtask *after* the event has finished
dispatching, so `e.preventDefault()` cannot affect the event and any other
Escape listener (Radix's `AlertDialog`, browser-level handlers) has already run.
The registry is already **statically imported** on line 35 (`pushEscape`), so
the dynamic import buys nothing — no bundle isolation, no lazy win. The close
itself still happens, one tick late, which is also why the popup close is
racy against a same-tick re-render.

**Proposed fix.** Import `popEscape` statically alongside `pushEscape` and call
it synchronously:

```ts
import { popEscape, pushEscape } from "~/lib/escape-registry";
...
const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape" && popEscape()) { e.preventDefault(); e.stopPropagation(); }
};
```

---

## CORRECTNESS-10: wikilinks typed into a brand-new note produce no anchor rows

**Severity:** medium
**Category:** anchor derivation
**File:** `apps/web/app/components/editor/NoteEditor.tsx:351-358` vs. `:360-366`

**Claim.** The `update` branch of `save()` sends every body wikilink as an
anchor (`for (const ref of collectBodyRefs(body)) form.append("anchor", ref);`
plus `sync_anchors=1`). The `create` branch sends **only** `prefillAnchor`:

```ts
if (noteId === null) {
  form.set("intent", "create");
  form.set("body_md", body);
  if (prefillAnchor) form.append("anchor", prefillAnchor);
  ...
}
```

So a note composed from scratch containing `[[alma-32-21]]`, `[[gen-1]]` etc. is
created with zero anchor rows. A13 states body wikilinks become anchor rows.
It self-heals only if the user stays on the page long enough for the post-
redirect autosave to land (and CORRECTNESS-2 makes that timing less reliable
than intended); leaving immediately after Save leaves the note permanently
unanchored — no reader dot (A15), no rail entry (A5).

**Proposed fix.** Union the two sources in the create branch:

```ts
const refs = new Set(collectBodyRefs(body));
if (prefillAnchor) refs.add(prefillAnchor);
for (const ref of refs) form.append("anchor", ref);
```

`createNote` already inserts anchors transactionally via
`create_note_with_anchors`, so this costs nothing extra.

---

## CORRECTNESS-11: the detector swallows leading punctuation into the matched span and the link label

**Severity:** medium
**Category:** reference detector false positive (span, not ref)
**File:** `apps/web/app/components/editor/reference-rule.ts:97, 105-112`

**Claim.** The book-span guard `/^[A-Za-z0-9&.\s]+$/` admits `.` so that
abbreviations (`1 Ne.`) normalize, but the tokenizer is `\S+`, so any leading
periods are part of the same token and become part of the match. Measured:

```
findCanonReferences("...Alma 32:21") → [{ ref: "alma-32-21", text: "...Alma 32:21", index: 0 }]
```

`makeAutoLinkPlugin` uses `match.index`/`match.length` verbatim to replace the
span and uses `match.text` as the wikilink **label** (:118-119). So typing an
ellipsis-led quotation `…​...Alma 32:21 ` swallows the ellipsis into the link and
labels the link `"...Alma 32:21"`. This contradicts the file's own F4 posture
("a false positive mangles the user's sentence"). Bracketed and quoted forms are
correctly rejected because `(`, `"`, `“` are outside the class — only `.` and
`&` leak.

**Proposed fix.** Trim leading non-alphanumerics off the first book token before
computing `start`:

```ts
const lead = /^[^A-Za-z0-9]+/.exec(bookToks[0].text);
const start = bookToks[0].start + (lead ? lead[0].length : 0);
```

and re-derive `bookSpan` from the trimmed text. Add fixtures for `"...Alma
32:21"`, `"..Alma 32:21"`, `"&Alma 32:21"`.

---

## CORRECTNESS-12: `⌘S` and the visibility/blur flush are silent no-ops during an in-flight save

**Severity:** medium
**Category:** autosave flush ordering
**File:** `apps/web/app/components/editor/NoteEditor.tsx:348, 420-423, 550-553`

**Claim.** `save()` opens with `if (savingRef.current) return;`. A13 says "⌘S
forces an immediate flush" and "flush on blur/navigation/visibilitychange"
(plan.md:317-318). Because both go through `save()`, pressing ⌘S — or
backgrounding the tab — while any save is in flight does nothing at all, with no
UI change and no queued follow-up. Combined with CORRECTNESS-1 (dirty cleared on
the in-flight response) this is the concrete mobile data-loss path: type,
autosave fires, keep typing, switch apps → nothing is flushed and the buffer is
marked clean.

**Proposed fix.** Replace the early return with a coalescing flag:

```ts
if (savingRef.current) { queuedRef.current = true; return; }
// result effect, after clearing savingRef:
if (queuedRef.current) { queuedRef.current = false; saveRef.current(); }
```

---

## CORRECTNESS-13: `append` silently rewrites the whole stored body, so `append_undo`'s "byte-identical restore" is not

**Severity:** low
**Category:** append/undo semantics
**File:** `apps/web/app/routes/notes.$id.tsx:254-258, 291-317`

**Claim.** `append` canonicalizes the *entire* concatenated body, not just the
appended line. For a body that is already canonical this is a no-op — but the
A19 round-trip canary exists precisely because stored bodies may not be
(migrated rows, `migrate-notes.mjs`, older writers). Measured on a non-canonical
body:

```
body "* star bullet\n" + line "[[alma-32-21]]"
  → stored "- star bullet\n\n[[alma-32-21]]\n"
```

The user captured a verse and the bullet marker changed. `append_undo` then
restores `"- star bullet\n"`, not the original `"* star bullet\n"` — contrary to
the comment "strip the exact appended paragraph (byte-identical restore)". The
divergence is cosmetic under the A2 invariant but the comment overstates the
guarantee, and the canary can no longer detect the drift it was meant to catch
(the body has been silently normalized by a non-editor writer).

**Proposed fix.** Either (a) log `note_body_canonicalized_on_append` when
`C(body) !== body` so the canary still sees it, or (b) append without
re-canonicalizing the prefix:

```ts
const suffix = note.body_md === "" ? `${line}\n` : `\n${line}\n`;
const body = note.body_md + canonicalizeNoteMarkdown(suffix).replace(/^/, "");
```
(a) is cheaper and preserves the invariant; pick one and correct the comment.

---

## CORRECTNESS-14: insert-path labels are not sanitized, so the label the user sees is not the label that is stored

**Severity:** low
**Category:** markdown boundary
**File:** `apps/web/app/components/editor/NoteEditor.tsx:486-491, 645-651`

**Claim.** `markdown.ts:163-164` asserts "Insert paths sanitize with this too."
They do not. `handlePaste` uses the raw selection as the label
(`const label = selText.trim() !== "" ? selText : null;`), and
`commitSuggestion` uses `ac.storedSelection.text` unmodified. Sanitization only
happens at serialize time in `writeWikilink`. Consequence: select the text
`a|b`, press ⌘K, insert — the editor renders the link as `a|b`, the save stores
`[[ref|ab]]`, and after reload the label reads `ab`. Silent, unexplained
mutation of the user's own text.

**Proposed fix.** Call `sanitizeWikilinkLabel` at both insert sites before
`noteSchema.nodes.wikilink.create({ ref, label })`, and drop back to `null` when
the result is empty, so the doc and the stored form agree.

---

## CORRECTNESS-15: `highlight` is not reset when the suggestion list changes but its length does not

**Severity:** low
**Category:** popup commit path
**File:** `apps/web/app/components/editor/NoteEditor.tsx:625`

**Claim.** `useEffect(() => setHighlight(0), [suggestions.length])`. Typing
`alma-3` and then editing to `mosiah-3` can yield lists of identical length with
completely different destinations while `highlight` stays at, say, index 2.
Enter then inserts a link to a destination the user never highlighted for the
current query. `suggestionsRef.current` is updated during render, so the PM
keymap commits the *new* list at the *old* index.

**Proposed fix.** Key the reset on list identity rather than length:

```ts
const sigKey = suggestions.map((s) => s.ref).join(" ");
useEffect(() => setHighlight(0), [sigKey]);
```

---

## CORRECTNESS-16: the F8 "soft-deleted note 404s" test passes for the wrong reason

**Severity:** low
**Category:** harness gap
**File:** `apps/web/app/routes/__tests__/notes.routes.test.ts:111-119`

**Claim.** The test calls `noteLoader(makeArgs("/notes/dead-note"))` and asserts
a 404. `"dead-note"` fails `UUID_RE` at `notes.$id.tsx:76` and 404s *before*
`getNote` is ever consulted, so the mocked `getNote → null` is never exercised.
The assertion is satisfied by CORRECTNESS-agnostic path validation, not by the
soft-delete behaviour the test names. It would still pass if `getNote` returned
a live tombstoned row.

**Proposed fix.** Use a syntactically valid UUID and assert `getNote` was
actually called:

```ts
const id = "11111111-2222-3333-4444-555555555555";
await expect(noteLoader(makeArgs(`/notes/${id}`))).rejects.toMatchObject({ status: 404 });
expect(getNote).toHaveBeenCalledWith(expect.anything(), expect.anything(), id);
```

---

## Lane results that came back clean

Recorded so the empty parts of the lane are visible:

- **C idempotency.** ~55 adversarial inputs (tables, fences, indented code,
  hard breaks, `\r`, bidi controls, empty/whitespace-only wikilinks, refs
  containing a single `]`, deep headings, `10.`-start ordered lists, escaped
  emphasis, snake_case, stray `[[` / `]]` / `|`): `C(C(x)) === C(x)` held for
  every one. The escape-rule/serializer-escaping pairing is sound.
- **Auto-link span arithmetic.** `textBetween(0, $head.parentOffset, " ", " ")`
  substitutes exactly one character per atom, so wikilink atoms keep the offset
  mapping honest; the `plain` guard via `nodesBetween` correctly refuses to fire
  across an existing atom; the Backspace-undo `textBetween(after, after + 1)`
  is short-circuited behind the position check and cannot range past the doc.
- **`updateNote` conditional-update shape.** `.eq("updated_at", base)
  .is("deleted_at", null)` with a `getNote` fallback correctly distinguishes
  409 (visible, stale base) from 404 (gone/tombstoned/foreign). The `+00:00`
  offset in the echoed timestamp is percent-encoded by `URLSearchParams` inside
  postgrest-js, so the round-trip is exact; the unconditional
  `NEW.updated_at := now()` trigger guarantees the base always advances.
- **`syncNoteAnchors` diff.** The `${kind} ${ref}` composite key cannot collide
  (neither `SLUG_SHAPE` nor `TRANSCRIPT_SHAPE` admits a space, kinds are a
  closed set); delete-missing + `ignoreDuplicates` upsert is correct against the
  immutable-anchor model. The only defect is the failure mode (CORRECTNESS-5),
  not the diff.
- **`append_undo` byte-restore.** Verified against 11 body/line shapes
  (empty body, heading-led, list-led, blockquote-led, labelled line, body with
  an existing wikilink, non-canonical body, repeated identical line): the
  `\n${line}\n` suffix match and `slice(0, -(line.length + 2))` restore the
  exact prefix in every case except the newline-label case already filed as
  CORRECTNESS-6.
- **Detector false positives.** 52 probe strings. The chapter-form allowlist +
  capitalization gate + per-book chapter bounds behaved as specified:
  `"I told John 3 times"`, `"she acts 2 ways"`, `"psalms 23"` (lowercase),
  `"Alma 64:1"`, `"Revelation 23:1"`, `"Alma 0:1"`, `"Alma 32:0"`,
  `"Alma32:21"`, `"1 Ne 3:7's promise"`, `"Mosiah 3:19-20"`,
  `"Mosiah 3:19–20"` (en dash), `"D&C 121:7-9"` all correctly returned no
  match. `"D&C 89"`, `"words of mormon 1:1"`, `"1 corinthians 13"`,
  `"3 Nephi 11:11"` all matched correctly. Only CORRECTNESS-11's leading-`.`
  span leak surfaced. Note (not filed as a defect — matches the documented
  `notes-refs.ts` posture): out-of-range **verse** numbers still link
  (`"Alma 32:210"` → `alma-32-210`), since only chapter counts are bounded.
- **Base-echo adoption after create-redirect.** `useEffect(... if
  (initialUpdatedAt && !baseRef.current) baseRef.current = initialUpdatedAt)`
  is correct: `/notes/new` and `/notes/:id` are the same route module, so the
  component and the `[]`-dep PM view survive the redirect, `baseRef` starts
  `null`, and the first non-null `initialUpdatedAt` is adopted exactly once.

---

## Summary

Critical 1 · High 4 · Medium 7 · Low 4 — 16 findings.

The severe cluster is all one system: **the autosave state machine**
(CORRECTNESS-1, -2, -3, -5, -12). Individually each is a race; together they
compose into "the editor reports Saved while holding unsaved bytes, stops
retrying, and can be permanently wedged by a routine reader capture". The
markdown boundary itself is in good shape — C is genuinely idempotent across
every adversarial input probed, and the detector's zero-false-positive posture
holds except for one leading-punctuation span leak.
