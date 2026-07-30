# Correctness review — personal-notes (plan stage, panel-1)

Reviewer lens: correctness gaps, edge cases, partial failures, idempotency.
Scale honored: single-digit DAU, Workers, Supabase. Human-ruled constraints
(PM, markdown storage, single engine, GROUP_KEYS design, B18) not re-litigated.
Live-DB probes were run against the dev database to ground the anchor-grammar
findings in real ids, not hypotheticals.

---

### COR-1: F3 "byte-identity" is falsified by prosemirror-markdown's serializer for at least three fixture classes already in the harness

**Severity: critical (invariant as stated is unachievable; harness will fail against a correct implementation)**

**Claim.** `serializeNoteDoc(parseNoteMarkdown(md)) === md` cannot hold for
arbitrary human-authored markdown. prosemirror-markdown's parse→serialize is a
*normalizing* pipeline, and the harness's own fixtures
(apps/web/app/lib/__tests__/notes-markdown.test.ts:8-21) sit in the
normalized-away classes:

1. **Bullet delimiter.** `defaultMarkdownSerializer` renders bullet lists with
   `(node.attrs.bullet || "*") + " "`, and the default parser token spec does
   not capture the source bullet char into attrs. Fixtures "bullet list" and
   "nested list" use `-` → serialize as `*`. Bytes differ.
2. **Trailing newline.** The serializer joins blocks with `\n\n` and emits no
   trailing newline. Every fixture ends in `\n` → every fixture fails on the
   last byte, including "plain paragraph".
3. **Escape normalization.** The text serializer escapes `[`, `]`, `` ` ``,
   `*`, `\`, `_` (and line-leading `#`/`-`/ordinals). The "literal text
   survives" test (notes-markdown.test.ts:30-37) expects
   `out.toContain("![alt]")`; a correct constrained serializer emits
   `!\[alt\](…)`. The assertion tests for the one output a correct
   implementation will not produce.
   
   Additional known-normalizing classes not in fixtures but reachable via
   paste/import: setext→ATX headings, `_em_`→`*em*` (serializer em delim is
   `*`), two-space hard breaks→backslash breaks, `1)` ordered markers→`1.`,
   loose→tight list spacing decisions.

**Evidence.** prosemirror-markdown `MarkdownSerializer` defaults (bullet_list
delim, em/strong delims, esc(), no trailing NL) — stable across 1.x; fixture
bytes at notes-markdown.test.ts:13-14 (`-` bullets), :10 (`\n` suffix), :34-36
(`![alt]` containment).

**Proposed fix.** Amend the plan: replace "parse→serialize byte-round-trip"
with a **canonical-form invariant**, which is both achievable and gives the
same reversibility guarantee:

- Define canonical form `C(md) = serialize(parse(md))` with a house-configured
  serializer (choose: `-` bullets, `*` emphasis, ATX headings, trailing `\n`
  appended by `serializeNoteDoc`).
- Pinned invariants: (a) **idempotency / fixed point** —
  `C(C(md)) === C(md)` over the corpus; (b) **editor writes are canonical** —
  every save path stores `C`; since v1 bodies are only ever produced by the
  editor, all stored bodies are canonical from birth; (c) **no dirty on
  no-op** — open→close without edits produces no byte change (this is the
  user-facing meaning of "what was typed is what is stored").
- Rewrite ROUND_TRIP_FIXTURES in canonical form (they then genuinely assert
  byte-identity), and add a second table of non-canonical inputs asserting
  `C(md)` maps to the expected canonical bytes and stays there.
- The literal-text test should assert **semantic preservation**
  (`C(C(md)) === C(md)` and the rendered text content equals the source text),
  not substring containment of unescaped source.

---

### COR-2: the constrained-schema parser will throw (not degrade) on out-of-schema markdown-it tokens — code spans, indented code, fences, hr, links, autolinks

**Severity: critical (crash class on the save/open path; harness only covers image + html)**

**Claim.** prosemirror-markdown's `MarkdownParser` throws
`Token type '…' not supported by Markdown parser` when the markdown-it stream
contains a token with no handler. The constrained schema (plan §Scope: no code,
no hr, no image, no plain link mark) leaves these commonmark-default tokens
unhandled: `code_inline` (backticks), `code_block` (**four-space indented
text** — trivially reachable by paste), `fence`, `hr` (`---`), `link`
(`[a](b)` and `<http://…>` autolinks), `image`. A user pasting text with an
indented line or a backtick crashes parse → the note fails to open or save,
depending on where parse runs. The harness's "survive as literal text" test
covers only image + raw HTML (notes-markdown.test.ts:30-37).

**Evidence.** Plan §Scope constrained construct list (plan.md:39-41); D4
whitelists the *renderer* rules but the plan says nothing about disabling the
same rules on the *editor parse* side; MarkdownParser's throw-on-unhandled
behavior is its documented contract.

**Proposed fix.** Plan amendment: the editor's markdown-it instance must
`disable()` every rule outside the constrained set (`code`, `fence`, `hr`,
`image`, `link`, `autolink`, `backticks`, `html_block`, `html_inline`, …) so
out-of-schema constructs tokenize as plain text — the same whitelist D4
already mandates for the renderer. Use **one shared markdown-it
configuration** for both the PM parser and notes-render.server (they are two
parsers of the same grammar; if their rule sets drift, a body that renders
fine can crash the editor or vice versa). Harness: extend the literal-text
fixture table with `` `code` ``, four-space-indented lines, ` ```fence `,
`---`, `[a](b)`, `<https://x>`; assert parse does not throw and text content
is preserved.

---

### COR-3: anchor-grammar collisions are real in live data — `resolveAnchorRef` must be canonical-slug-only AND chapter-count-aware, or it misclassifies existing entities

**Severity: high (deterministic-contract hole with concrete live collisions)**

**Claim.** Probed the dev DB (lumen.entities, PK on id, ids are one global
namespace). Two collision classes exist **today**:

1. **Alias-shaped person ids.** `parseReference` accepts full book names as
   hyphenated slugs (`helaman-2` → chapter hel-2 via BOOK_SLUGS
   'helaman'→'hel', slug-map.ts:118-139). But these are live **person** ids:
   `helaman-1`, `helaman-2`, `mormon-1`, `matthew-1`, `isaiah-1/2`,
   `jeremiah-1…8`, `joshua-1…5`, `obadiah-1…12`, `zechariah-1…16`,
   `daniel-1/2`, `abraham-1`, `esther-1`, `ezekiel-1`, `nehemiah-1/2`,
   `philemon-1`, `habakkuk-1`, `haggai-1`, `malachi-1` (live query,
   2026-07-30). `jeremiah-3` is simultaneously a real chapter (Jeremiah has
   52) under the alias parse and a real person id — **irresolvably ambiguous
   if the grammar accepts aliases**.
2. **Canonical-shaped person ids.** Persons `joel-4` … `joel-11` exist, and
   `joel` IS the canonical book slug. Shape-only classification (which the
   harness pins: notes-harness.test.ts:54-57, "alma-32-9999 stays verse")
   classifies `joel-4` as chapter Joel 4 — but Joel has 3 chapters; `joel-4`
   is a person. A shape-only grammar makes those eight entities unlinkable and
   400s legitimate anchors at the F7 boundary.

Chapter entity ids themselves use canonical slugs (`alma-32`, `1-ne-1`,
`acts-9` — verified), so canonical chapter refs and chapter *entities*
coincide by construction; that pair is not a conflict.

**Proposed fix.** Pin the `resolveAnchorRef` contract in the plan:

- **Canonical slugs only.** The anchor/link grammar validates book segments
  against the canonical id set (values of BOOK_SLUGS), never the alias table.
  `helaman-2` fails the scripture shape → falls through to entity lookup →
  person. `[[` autocomplete and the input rule always *emit* canonical refs
  (the input rule maps "Helaman 2" → `hel-2` via parseReference, which is
  fine — aliasing on the human-input side, canonical-only in the stored
  grammar).
- **Chapter-count guard.** Ship the per-book chapter counts in the package
  (86 books, static) and reject `<book>-<n>` where n exceeds the book's
  chapter count, so `joel-4` falls through to the entity namespace. With
  canonical-only + count-guard, the live collision set is exactly zero
  (verified by query).
- **Precedence documented:** scripture shape (canonical, count-valid) wins;
  otherwise entity id; otherwise `episode#…` transcript shape; otherwise null.
- **Namespace reservation going forward:** entity ingestion must never mint
  ids matching `^<canonical-book>-\d+(-\d+)?$` within valid chapter/verse
  ranges — add that check to the ingest script and to stress-test-data.mjs so
  the guarantee is monitored, not assumed.
- Note the harness's verse-shape stance must be narrowed too: `alma-32-9999`
  can stay shape-valid (verse existence is DB truth, fine), but the
  **chapter** shape cannot be validated by shape alone (see joel-4).

---

### COR-4: soft-delete leaves live `note_anchors` rows — the dot, rail, and anchor fetch will resurrect deleted notes; and update-after-soft-delete semantics are undefined

**Severity: high (F8 asserts the outcome but the plan has no mechanism that produces it)**

**Claim.** D2 puts `deleted_at` on `notes` only; anchors cascade on **hard**
delete (FK), not soft delete. D5's chapter-loader fetch is "the user's anchors
for the chapter via PostgREST (one call)" — a plain anchors query returns
anchors of soft-deleted notes, so the margin dot and rail register keep
showing a note that 404s on click. F8 ("absent from /notes, rail, search")
asserts the behavior, but no test pins the *anchor* path
(notes.routes.test.ts:81-89 only pins `getNote` → null → 404), and the plan
never states how the anchor query excludes deleted notes.

Second interleaving hole in the same area: tab 1 has the editor open, tab 2
soft-deletes, tab 1 saves. If the update statement is `UPDATE … WHERE id = X`
(no `deleted_at IS NULL` filter), the save succeeds against a tombstoned row —
the user sees "saved", every read surface 404s, and if restore ever ships the
post-delete edit silently resurfaces. LWW (D6) does not cover delete/edit
races.

**Proposed fix.** Plan amendments: (a) the anchor fetch joins/filters on the
parent note's liveness — PostgREST inner-join embed
(`note_anchors?select=*,notes!inner(id)&notes.deleted_at=is.null`) or a
`live_note_anchors` view; (b) every UPDATE (body and soft-delete itself) takes
`WHERE deleted_at IS NULL`; 0 rows updated → 404/409 to the client, never
"saved"; (c) the notes search leg filters `deleted_at IS NULL` (F8 names
search, the D3 textSearch call must carry the filter — pin it). Harness: add a
smoke-notes-rls step — A creates note+anchor, soft-deletes via the app's
statement shape, then asserts the anchor fetch returns zero rows and an update
attempt affects zero rows.

---

### COR-5: transcript anchors on `(episode_id, seq)` are not durable — moment seqs are documented response-scoped, and segment seqs die on re-transcription; anchor by `t_start_s`

**Severity: high (silent anchor drift; an M3 re-window is already queued)**

**Claim.** The harness pins `resolveAnchorRef("unshaken-O3SiM9Yi940#144")` →
`{kind:"transcript", ref:"…#144"}` (notes-harness.test.ts:41-44). That
`episode#number` shape is **exactly the moment-id format** the codebase
documents as non-durable: "moment ids (`ref_id = episode_id||'#'||seq_start`)
are RESPONSE-SCOPED, NOT durable — every re-run re-windows and re-keys them;
deep-link via payload `episode_id` + `t_start_s`" (search-endpoint plan.md:101,
APIC-6; search-types.ts:63-67; and retro.md:8 records the **M3 re-window of
178 oversize moments is pending** — it will fire during this feature's
lifetime). The shipped UI already treats `(episode_id, t_start_s)` as the only
durable moment identity (`dedupeMoments`, search.tsx:171-174).

Even if capture reads the media page's transcript *segments*
(`lumen.transcripts` PK (episode_id, seq), migrate-media-collections.mjs:16-25)
rather than search moments: (a) nothing in the ref grammar can distinguish a
segment seq from a moment seq_start, so a capture wired from a search result
would persist a forbidden moment id and the grammar would bless it; (b)
segment seq itself re-numbers on any re-transcription/correction pass —
timestamps survive re-segmentation, ordinals don't.

**Proposed fix.** Anchor transcript refs by **`episode_id` + `t_start_s`**
(e.g. ref grammar `episode@123.4`, or keep ref_id = episode_id and store
`t_start_s numeric` in a nullable column on note_anchors). Resolution to a
segment at read time = "segment containing / nearest below t", which survives
both re-windowing and re-ingestion. Update the harness fixture accordingly,
and have `resolveAnchorRef` **reject** the `#seq` shape outright so a
moment-id can never be persisted by accident (that is the fail-closed posture
the rest of the grammar already takes).

---

### COR-6: note create is two non-transactional PostgREST writes — the anchor leg can fail after the note exists, and the plan has no recovery story

**Severity: medium-high (partial-failure hole on the flagship capture flow)**

**Claim.** D1/D2: create = insert into `lumen.notes`, then insert into
`lumen.note_anchors` — two sequential PostgREST calls under the user JWT.
PostgREST offers no cross-table transaction from the client. If the second
call fails (network blip, validation race, RLS mishap on the denormalized
`owner_id`), the note exists **unanchored**: it shows in /notes and search but
not on the verse the user captured from — precisely the reader-capture flow
("Add to note", Linking §3) where the anchor IS the point. Retry of the whole
action creates a duplicate note (create is not idempotent); retry of just the
anchor hits PK `(note_id, kind, ref_id)` conflict if the first insert actually
landed.

**Proposed fix (pick one, record in plan):**
- **Preferred:** a `SECURITY INVOKER` SQL function
  `lumen.create_note_with_anchors(body_md text, anchors jsonb)` called via
  PostgREST RPC — one transaction, RLS still applies (invoker), atomicity for
  free. Same shape works for "append link + add anchor".
- Or: compensating delete — on anchor failure the action best-effort
  hard-deletes the fresh note and returns the error (user retries whole
  capture); plus client-generated note uuid so a retried create upserts
  instead of duplicating.
- Either way: anchor inserts use `ON CONFLICT DO NOTHING` (PostgREST
  `Prefer: resolution=ignore-duplicates`) so double-capture of the same verse
  onto the same note is idempotent, and the action must state which side sets
  `owner_id` (server-side from the session, never trusted from the form).
Harness: routes test for "anchor insert rejected → response is an error AND
no orphan note remains" (mock the second call to fail).

---

### COR-7: D6 as written cannot *detect* the stale-write clobber it names — "returns fresh updated_at" changes nothing without a client base-echo compare

**Severity: medium (accepted-risk decision resting on a mechanism that doesn't do what it implies)**

**Claim.** Two tabs: tab 1 loads (updated_at=T1), tab 2 saves (T2), tab 1
saves — under plain LWW tab 1's write silently destroys tab 2's. Returning
fresh `updated_at` from the action only tells each tab about **its own**
write; detection requires the client to send the `updated_at` it based its
edit on and the server to compare. As specified, D6's returned timestamp is
decorative for the concurrency question Q7 raises.

**Proposed fix.** Keep LWW as the *resolution* policy but make staleness
*visible*, nearly for free on PostgREST: the action sends the base timestamp
and the update runs `…WHERE id = :id AND deleted_at IS NULL AND updated_at =
:base` (single statement, race-free). 0 rows → 409 with the current row; v1 UX
can be as blunt as "note changed elsewhere — reload" (single-digit DAU, same
human in two tabs). If Abram rules for pure clobber-LWW instead, amend D6 to
drop the implication that returning updated_at detects anything, and add the
deliberate data-loss window to the plan's accepted risks. Either ruling also
needs the COR-4(b) `deleted_at IS NULL` guard — LWW must not resurrect
tombstones.

---

### COR-8: adding `notes` to GROUP_KEYS changes the **signed-out** contract F2 claims is untouched — scope validation, error bodies, and the /search scope chips all move

**Severity: medium (F2 "byte-compatible" is falsified on three paths the harness doesn't pin)**

**Claim.** F2/§Public contract promise signed-out `/api/search` responses
"byte-compatible with pre-feature shape". But GROUP_KEYS is the validation
source and a client-visible enum:

1. `parseScope` accepts any member of GROUP_KEYS
   (search-request.server.ts:36). Today `scope=notes` → 400 `scope_unknown`;
   post-change a **signed-out** request gets 200 (searchAll builds zero legs
   for an unknown key, buildLegs search.ts:556-585 — empty groups). A 400→200
   flip is a contract change.
2. The `scope_unknown` error message enumerates GROUP_KEYS
   (search-request.server.ts:40) — signed-out 400 bodies change bytes.
3. `/search` renders the scope-filter chips from GROUP_KEYS
   (search.tsx:1104) — signed-out users see a "notes" chip for a group they
   can never populate. (`adaptiveLimit` survives: 7→8 groups both land in the
   ≥5 bucket, search.tsx:76-81 — checked.)

**Proposed fix.** Decide and pin: either (a) `notes` is a *session-gated*
group key — parseScope gains a signed-in-only set, signed-out `scope=notes`
keeps 400ing (message unchanged), chips filter to session-visible groups; or
(b) accept the widened enum and re-scope F2's byte-compat claim to "signed-out
200 responses for previously-valid requests". (a) is more honest to F2 as
written. Whichever wins, api-search tests must pin signed-out `scope=notes`
explicitly — today no harness file covers it.

---

### COR-9: the notes leg's pagination story is absent — a full notes page either lies about being the end or mints a cursor the route will always 400

**Severity: medium (plan silent exactly where the cursor contract is strict)**

**Claim.** `SearchGroup.nextCursor` is contractually present when a page is
full (search-types.ts:80-83). Keyset cursors are minted/validated per
(q, scope) by the canon engine; `after` requires scope == exactly one group
and `decodeSearchCursor` runs **before** session work (api.search.tsx:73-95).
The notes leg lives outside searchAll (D3), so: if the notes group returns
`limitPerGroup` rows and sets no `nextCursor`, clients read "end of set" and
notes are silently truncated at limit (max 25); if it *does* mint one,
`scope=notes&after=…` dies in `decodeSearchCursor` with `cursor_invalid`
before the notes leg is ever consulted. Also unstated: what happens when the
notes leg itself fails (PostgREST error/JWT expiry) — a search that 500s
because the *personal* leg died would degrade the canon groups that D3
deliberately isolated.

**Proposed fix.** Pin in the plan: v1 notes group is **uncursored** — it never
mints `nextCursor`, is documented as capped at limit (fine at this scale; the
group links to /notes for the full set), and `after` + `scope=notes` returns a
defined 400 (`cursor_scope` or `cursor_invalid` — choose and test). Notes-leg
failure degrades: catch, log, return canon groups without the notes group
(mirror the per-leg degradation doctrine; add `meta.perGroup.notes.error` if
meta plumbing allows). Harness: extend notes-search-merge tests with a
throwing notes leg → canon groups intact; api-search test for
`scope=notes&after=x`.

---

### COR-10: the reference input rule's *editor* semantics are unspecified and partly contradict the "shipped parseReference" premise — firing boundary, ranges, abbreviation periods, undo re-fire, wikilink context

**Severity: medium (the harness tests a pure detector; every listed hole lives in the PM plugin the harness never touches)**

**Claim.** Plan Linking §1 says typing "Alma 32:21" auto-links "via the
shipped client-side parseReference". Five holes:

1. **Abbreviations don't actually parse.** `parseReference("1 ne. 3:7")` →
   `unknown` — BOOK_SLUGS has "1 ne" but nothing strips the period
   (slug-map.ts:141-158: `bookName` "1 ne." misses the map). The plan's own F4
   fixture "1 Ne. 3:7" (plan.md:130) fails against the shipped function. The
   detector must normalize trailing periods on the book token (and the plan
   should say the detector *wraps* parseReference rather than equals it).
2. **Firing boundary / premature link.** A PM input rule fires as text is
   typed; if the pattern can match on a digit, "Alma 32:2" links before the
   user finishes "…21". The rule must require a non-ref boundary char
   (space/punct/Enter) to complete, and the digits must be maximal-munch.
3. **Ranges.** "Alma 32:21-23": if the rule consumes "Alma 32:21" and leaves
   "-23", the note reads "[[…|Alma 32:21]]-23" — mangled. v1 should either
   parse the range (anchor/link the start verse, label the full range) or
   explicitly not fire when the boundary char is `-` followed by a digit.
   Decide; both are fine, silence isn't.
4. **Undo re-fire loop.** PM input rules match against the text before the
   cursor on each input. After `undoInputRule` (Backspace) reverts the link to
   plain text, the very next boundary character the user types re-matches the
   same text and re-links — the user cannot keep "Alma 32:21" as plain text.
   Needs a suppress-after-undo guard (e.g. plugin state remembering the
   reverted range until the text there changes).
5. **Context guards.** The rule must not fire inside an existing wikilink's
   label (typing a ref as a label would nest a link) — guard on
   `$from.parent.type` / marks. Same guard for the `[[` autocomplete rule.

Additionally, the **chapter-form false-positive class** is wider than the
fixtures: bare "Book N" linking with common-word book names — "I told John 3
times", "she acts 2 ways", "the numbers 5 and 6", "his job 4 days a week" —
none are in the fixture list (notes-markdown.test.ts:52-61 covers only
verse-shaped noise). Propose: verse-form (colon present) links liberally;
chapter-form requires a capitalized book token and restricts to
scripture-unique names (Alma, Nephi, Moroni, Deuteronomy…) or requires the
user to accept a suggestion rather than auto-linking. Zero-false-positive is
the pinned goal (F4) — bare-chapter auto-link on "John/Acts/Job/Numbers" makes
it unreachable.

**Proposed fix.** Specify the plugin contract in the plan (boundary char,
range policy, undo suppression, context guards, chapter-form policy,
period-normalization) and add the fixtures above. The pure-detector harness
stays, but the plugin behaviors need PM EditorState dispatch tests (jsdom) or
must be explicitly assigned to the Playwright layer (F12 currently only
covers "type, bold, insert link, save").

---

### COR-11: notes group results — title derivation and snippet contract are undefined; raw wikilink syntax will leak into search UI

**Severity: low-medium (contract drift against API-1)**

**Claim.** Q4 derives titles from "first line", but the first line can be
empty, a bare wikilink (`[[alma-32-21]]`), or a heading with markdown
syntax — undefined derivation makes the search result title
nondeterministic/ugly. Snippets: the canon contract is "plain text with ⟪⟫
highlight markers — never HTML" (search-types.ts:70). The notes leg comes from
PostgREST textSearch over `body_md`; whatever snippet the route layer builds
will contain raw `[[ref|label]]`, `**`, `#` unless stripped. The tsvector also
tokenizes ref slugs ("alma", "32"), so searching "alma" matches notes that
merely *link* Alma — acceptable, but worth a deliberate sentence in the plan
(strip wikilink targets from the tsvector source expression if not).

**Proposed fix.** Pin in the plan: title = first non-empty line of `body_md`
with markdown/wikilink syntax stripped (label kept), truncated (~80 chars,
consistent with entity titles), fallback "Untitled note"; snippet = plain-text
projection of body (same stripper) with ⟪⟫ markers added route-side or via
ts_headline over a stripped source. One stripping function, unit-tested, used
by both. Add fixtures: body starting with a wikilink, with a heading, empty
first line.

---

## Open-question input

- **Q1 (Playwright): yes** — and note COR-10's plugin behaviors (undo re-fire,
  firing boundary, inside-wikilink guard) are exactly the interaction bugs the
  vitest harness cannot see; either add PM dispatch tests in jsdom or assign
  those cases to the e2e layer by name, not vibe.
- **Q2 (transcript anchoring): yes, but only with the COR-5 amendment** —
  anchor by `(episode_id, t_start_s)`, never `#seq`. Shipping `#seq` v1 plants
  anchors that the already-queued M3 re-window (and any re-transcription)
  silently invalidates; that's worse than cutting the capture UI.
- **Q3 (soft-delete): soft, agreed** — conditional on COR-4: anchors filtered
  through note liveness, and all updates guarded `deleted_at IS NULL`.
  Without those, soft-delete is the source of two leak/resurrection bugs.
- **Q4 (derived title): derived, agreed** — but pin the derivation function
  (COR-11); "first line" is not yet a definition.
- **Q5 (markdown-it): yes** — with the requirement that the renderer and the
  PM parser share one markdown-it rule configuration (COR-2). Two
  independently-whitelisted parsers of the same bodies is a drift generator.
- **Q6 (mobile compose):** no correctness objection; F12 already carries it.
- **Q7 (LWW): accept LWW as resolution, add the one-statement conditional
  update for detection (COR-7).** As drafted, D6 names a detection mechanism
  that cannot detect; either add the base-echo compare or strike the claim and
  book the data-loss window as accepted risk.

## Harness gaps

1. **Round-trip fixtures are non-canonical** — `-` bullets, trailing `\n`,
   `![alt]` containment guarantee failure against a correct serializer
   (COR-1). Rewrite in canonical form; add idempotency (`C∘C = C`) and
   canonicalization-mapping tables.
2. **No out-of-schema-token fixtures for parse crash class** — backticks,
   indented code, fences, `---`, `[a](b)`, autolinks (COR-2). Currently only
   image + raw HTML.
3. **No alias/count collision fixtures for `resolveAnchorRef`** —
   `helaman-2` → entity(person), `jeremiah-3` → entity(person, despite being
   a real chapter number under the alias), `joel-4` → entity(person, despite
   canonical slug shape) (COR-3). The existing `alma-32-9999` fixture pins
   shape-tolerance in exactly the spot where chapter-shape tolerance is wrong.
4. **F2's "chapter loader makes zero notes calls" has no assertion anywhere**
   — scripture.loader.test.ts is untouched by the harness; add a signed-out
   loader test asserting no notes fetch and no `note` kind in verseSignals.
5. **Soft-delete × anchors unprobed** — no test that the anchor fetch excludes
   anchors of soft-deleted notes, and no test that update-after-soft-delete
   affects 0 rows (COR-4). Add to smoke-notes-rls (it already owns the live
   PostgREST truth) per the "pin integration points" learning.
6. **Notes search leg `deleted_at` filter unpinned** (F8 names search;
   nothing asserts the textSearch query carries the filter).
7. **Merge degradation unpinned** — notes-search-merge.test has no
   throwing-notes-leg case (canon groups must survive, COR-9); api-search
   tests have no signed-out `scope=notes` case and no `scope=notes&after=…`
   case (COR-8/COR-9).
8. **Partial-failure create unprobed** — no routes test for "anchor insert
   fails → error + no orphan note" (COR-6).
9. **smoke-notes-rls weaknesses:** (a) user clients fall back to the
   SERVICE_ROLE key when `SUPABASE_PUBLISHABLE_KEY` is unset
   (smoke-notes-rls.mjs:53) — the probe should hard-require the publishable
   key; a service-key apikey with a broken session turns several checks into
   noise. (b) B forging an *anchor* onto A's note (insert into note_anchors
   with A's note_id) is unprobed — it's the FK+RLS interaction most likely to
   be misconfigured, since anchor RLS rides a denormalized owner_id. (c) B
   updating A's anchors is unprobed.
10. **LWW conditional update unpinned** — if COR-7's fix is adopted, add the
    two-tab stale-write case to the routes tests (base-echo mismatch → 409,
    no write).
