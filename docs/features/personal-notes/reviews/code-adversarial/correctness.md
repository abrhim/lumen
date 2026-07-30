# Panel-2 adversarial — CORRECTNESS lane

- **Lane:** correctness (panel-1 file: `reviews/code-panel/correctness.md`)
- **Date:** 2026-07-30
- **Tagger role:** PANEL-2 ADVERSARIAL, correctness lane

Method: every finding re-verified against source — `NoteEditor.tsx` (read
directly; the file's literal NUL bytes make git/grep treat it as binary),
`markdown.ts`, `notes-markdown-config.ts`, `reference-rule.ts`,
`routes/notes.$id.tsx`, `notes.server.ts`, `notes-refs.ts`,
`__tests__/notes.routes.test.ts`, `suggest.ts`. Claimed control flow was
traced, not trusted; nuances and one misstatement noted inline.

| ID | CP | Tag | Rationale |
|---|---|---|---|
| CORRECTNESS-1 | CP-1 | material | Verified: `save()` snapshots once (:349), result effect clears `dirtyRef`/`setDirty(false)` unconditionally on any `d.updated_at` (:572-577) with no buffer comparison; flush is gated on `dirtyRef` (:552). Mid-flight keystrokes are marked clean — the claimed loss sequence holds line-for-line. |
| CORRECTNESS-2 | CP-1 | material | Verified: deps `[dirty, latestMdRef.current, noteId]` (:547) — a ref `.current` is inert and `setDirty(true)` bails once dirty, so plain-prose typing never resets the timer; typing after a failed save schedules nothing, so "retrying on next change" is false copy. Nuance conceded but not fatal: keystrokes landed *during* a flight can reset the deps at the idle-render and schedule one retry, and `[[`-span typing re-renders via `setPopup` (idle-ish there) — the claimed sequence (fail, then type) still never retries. |
| CORRECTNESS-3 | CP-4 | material | Verified both halves: the 409 body carries `current` with no top-level `updated_at` (notes.$id.tsx:224-232), and the result effect acts only on `d.updated_at` (:572) — `baseRef` never re-adopts, so every retry replays the stale base. `failed` (:669-671) does not exclude `code === "stale"`, so the Retry button renders into a guaranteed loop. Single-user reachability via a second-tab `append` bumping `updated_at` confirmed against the action. |
| CORRECTNESS-4 | CP-7 | material | Verified ordering: raw body measured (:162, :182), `canonicalizeNoteMarkdown(rawBody)` stored (:171, :189); the `escape` rule is enabled (notes-markdown-config.ts:26) and prosemirror-markdown's default text escaping backslash-escapes specials, so ~2× expansion on bracket/star-heavy input is mechanically sound; A6 pins the CHECK at `octet_length(body_md) <= 65536` on the stored value → 23514 → opaque 500. `append` (:240-289) confirmed to have no size guard at all. |
| CORRECTNESS-5 | CP-3 | material | Verified: `syncNoteAnchors` errors route through `failWrite`, which throws `NoteWriteError` (notes.server.ts:88-97); the update intent awaits it after the committed body update with no local try (notes.$id.tsx:215-219) → blanket catch → 500 with the fresh `updated_at` never delivered → the CORRECTNESS-3 wedge, self-inflicted. Non-atomic per-row delete loop (:287-296) and the append-retry duplicate confirmed. |
| CORRECTNESS-6 | CP-19 | material | Core claim verified: `sanitizeWikilinkLabel` is `replace(/[[\]|]/g, "").trim()` (markdown.ts:166) — `.trim()` strips edges only, inner `\n` survives; the tokenizer rejects inner newlines (notes-markdown-config.ts:45), so the canonicalized body bakes escaped `\[\[…\]\]` junk and `append_undo`'s `endsWith` match fails → unremovable garbage. One misstatement conceded: append does NOT take the label "straight from the form" — it routes through the sanitizer at :250; the defect is the sanitizer's insufficiency, which is exactly what the proposed fix repairs, so the finding stands. |
| CORRECTNESS-7 | CP-31 | material | Verified: the `apply` deactivation handles only `head < next.from + 2` (NoteEditor.tsx:181-184) — no `]]` check, no forward/cross-block bound, despite the comment on :180 claiming both. The auto-link gate on `from !== null` (:93) then stays closed for the rest of the session. Comment and code diverge exactly as claimed. |
| CORRECTNESS-8 | CP-18 | material | Verified: `lumenUrlToRef` (:220-243) never reads `url.origin`/`host`; and `ENTITY_SHAPE` (`/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/`, notes-refs.ts:58) is an open namespace — `resolveAnchorRef("claude")` and `"faith"` resolve as entities, so the github/wikipedia examples are real conversions, and `handlePaste` returning true destroys the pasted text. |
| CORRECTNESS-9 | CP-17 | material | Verified: dynamic `import(...).then(popEscape)` inside the keydown handler (:610-619) resolves in a microtask after dispatch completes — `preventDefault()` is per-spec inert there, and every competing Escape listener has already run; `pushEscape` is statically imported at :35, so the dynamic import buys nothing. A10's innermost-layer-only doctrine cannot hold by construction with an async pop. Fix is trivially safe. |
| CORRECTNESS-10 | CP-32 | material | Verified: create branch sends only `prefillAnchor` (:352-358); update branch sends `collectBodyRefs(body)` (:363-365). A from-scratch note with typed wikilinks creates zero anchor rows against A13's "body wikilinks become anchor rows"; self-heal depends on a post-redirect autosave that CORRECTNESS-1/2 make unreliable. |
| CORRECTNESS-11 | CP-33 | material | Verified from code: tokenizer is `\S+` (reference-rule.ts:61) and the book-span guard `/^[A-Za-z0-9&.\s]+$/` (:97) admits `.`, so `"...Alma"` is one token whose leading dots ride into `start = bookToks[0].start` and into `text.slice(start, end)` — the auto-link plugin then uses `match.index`/`match.text` verbatim as span and label (NoteEditor.tsx:110-118). Contradicts the file's own F4 zero-false-positive posture. |
| CORRECTNESS-12 | CP-1 | material | Verified: `if (savingRef.current) return;` (:348) with no queue; the flush explicitly skips while saving (`!savingRef.current`, :552) and ⌘S routes through the same `save()` (:420-423). Combined with CORRECTNESS-1's unconditional dirty-clear this is the mobile background-switch loss path, as claimed. |
| CORRECTNESS-13 | CP-51 | noise | Behavior verified (append canonicalizes the whole concatenated body, :256-258) but it is A2-COMPLIANT — "every save path stores C" is the ratified invariant, and the undo restores the canonical-equivalent prefix (semantically identical, `*`→`-` cosmetic). The canary argument is overstated: append normalizes with the SAME C the canary uses, so this is repair, not masked drift — a serializer bug would still surface on editor loads. The residual deliverable is a comment correction ("byte-identical" is wrong for non-canonical prefixes) plus an optional log line; that does not change shipped quality. |
| CORRECTNESS-14 | CP-52 | material | Verified: markdown.ts:163-164 asserts "Insert paths sanitize with this too" and neither does — `handlePaste` uses raw `selText` (:487), `commitSuggestion` uses raw `storedSelection.text` (:645-650); sanitization happens only in `writeWikilink` at serialize. Doc shows `a\|b`, storage gets `ab` — silent divergence between what the user sees and what persists. |
| CORRECTNESS-15 | CP-53 | material | Verified and STRENGTHENED: `setHighlight(0)` keys on `[suggestions.length]` (:625), and `suggestDestinations` caps at `slice(0, 6)` (suggest.ts:65) — any two queries each yielding ≥6 candidates produce equal-length lists, so the stale-highlight commit is more reproducible than the finding claimed, not less. One-line identity-keyed fix, no risk. |
| CORRECTNESS-16 | CP-46 | material | Verified: the F8 test uses id `"dead-note"` (notes.routes.test.ts:115), which fails `UUID_RE` at notes.$id.tsx:76 and 404s before `getNote` is consulted — the `getNote → null` mock (:114) is dead weight and the tombstone pin is inert. Textbook "invariant unverified" material per the protocol's own example. |

## Carve-out downgrade suggestions

None. The five carve-out findings (CORRECTNESS-1 critical/data-loss;
CORRECTNESS-2, -3, -4, -5 high/correctness) all verified line-for-line
against the code; no downgrade is warranted for any of them.

## Overall stance

This panel-1 specialist is almost entirely signal: 15 of 16 findings
reproduce exactly from the cited source, several with the mechanism
confirmed at a level the finding itself hedged on (the `slice(0, 6)`
suggestion cap makes CORRECTNESS-15 routine rather than edge-case), and the
lane's self-reported clean results and empirical probe method held up under
re-derivation. The one noise tag (CORRECTNESS-13) is a spec-compliant
behavior dressed as a defect whose deliverable reduces to a comment fix;
the only factual slip found anywhere is CORRECTNESS-6's "straight from the
form" phrasing, which does not affect its verdict.
