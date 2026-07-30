# Panel-2 adversarial — UX lane (personal-notes, step 9)

- **Lane:** ux (panel-1 findings UX-1..UX-18)
- **Date:** 2026-07-30
- **Tagger role:** PANEL-2 ADVERSARIAL reviewer for ux
- **Method:** every finding re-verified against the cited files directly
  (NoteEditor.tsx read in full via Read — the NUL bytes make grep-based
  verification unreliable; byte-scan run for UX-12; repo-wide CSS grep for
  UX-1; view/roving logic in search.tsx re-derived from source, not from
  the finding's paraphrase).

| ID | CP | Tag | Rationale |
|----|----|-----|-----------|
| UX-1 | CP-2 | material | Verified: repo-wide grep finds `.note-body`/`.note-editor`/`.note-wikilink`/`.note-wikilink-dead` only at emit sites (notes-render.server.ts:84,89; notes.$id.tsx:481; NoteEditor.tsx:478); app.css's sole notes addition is `--t-dot-note`; no ProseMirror css import anywhere. One precision the finding undersells in its own favor: the emit sites carry Tailwind utilities, so BODY text is styled — but headings/lists/blockquotes/wikilinks are flat under preflight exactly as claimed, and A14's dotted underline is unimplemented. Concede at critical. |
| UX-2 | CP-12 | material | Verified: popup renders `absolute z-10 mt-1` inside a `relative` wrapper placed AFTER the mountRef div (NoteEditor.tsx:691-693) — anchored to the editor's foot, no `coordsAtPos`, no collision handling. In a tall note the A9 universal insert door opens off-screen. The proposed fix is standard PM practice, not overreach. |
| UX-3 | CP-1 | material | Verified: `if (!dirty || noteId === null) return;` (NoteEditor.tsx:544) disables the idle debounce on /notes/new, against G5's explicit "autosave REQUIRED" ruling — while the file's own header comment claims G5 compliance. The create-redirect continuation (326-328, notes.$id.tsx redirect at :174) makes the idle-fired create safe as the finding says. Composes into CP-1. |
| UX-4 | CP-13 | material | Verified including the subtle part: `view` computes from ALL `display.groups` (search.tsx:862-866) so notes-only matches DO yield `view === "results"` — but `renderedKeys`/`firstRowKey` iterate only canon `included` (1051-1063), so `activeRowKey` is null, every row gets tabIndex −1, and `totalShown`/`statusText` (canon-only, 1042/1068) announce "0 results" over visible note rows. All three sub-claims (a)(b)(c) hold in source. |
| UX-5 | CP-34 | material | Verified: notes section (including its degraded one-liner, search.tsx:1367-1399) is gated on `view === "results"`; a degraded leg returns `results: []`, so canon-empty + degraded → `view === "zero"` → plain "Nothing in the library matches" with no notes-unavailable line. This is the precise misread A4/CF-4 was ruled to prevent — doctrine defect, not preference. |
| UX-6 | CP-35 | material | Verified: notes.$id.tsx:444-445 prints "Deleted notes may be purged after 30 days." A6/CF-36 ruled COMMENT-only, "no user-facing promise, no v1 job" — the copy contradicts a settled decision and is false in both directions (no job; no restore path). Fix is deleting one sentence. |
| UX-7 | CP-4 | material | Verified: `failed` (NoteEditor.tsx:669-671) is true for `code === "stale"` (409 body has code + current, no top-level updated_at — notes.$id.tsx:223-233), so Retry prints (785) and resubmits the unchanged `baseRef` → guaranteed loop; the result effect reads only `d.updated_at`, ignoring `current`. The finding's own fallback ("either one alone would beat reload") pre-empts a heavy-fix objection. |
| UX-8 | CP-36 | material | Verified end-to-end: prefill is label-less `[[${prefillAnchor}]]` (NoteEditor.tsx:383); editor toDOM shows `label ?? ref` (markdown.ts:105); renderer's visible text is `label ?? ref` with `displayRef` only in aria-label (notes-render.server.ts:76-89); `stripNoteMarkdownLine` keeps the ref (notes-derive.ts:27) so the title IS the slug and the "Untitled note" doc comment (notes-derive.ts:46-47) is false as claimed. Inverted polish confirmed. |
| UX-9 | CP-37 | material | Verified: `lumen:last-note` is written only in notes.$id.tsx:383 and read in scripture.tsx:1417 — grep confirms no removal anywhere. `failed` in the rail treats every non-ok identically (scripture.tsx:1431) and append 404s on a soft-deleted note (notes.$id.tsx:252-253), so "try again" diagnoses a permanent 404 as transient, forever. Core capture loop degrades exactly as claimed. |
| UX-10 | CP-38 | material | Verified: `lazy(() => import(...))` at notes.$id.tsx:362 wrapped only in `<Suspense>` (392-411); EditorBoundary is the chunk's default-export wrapper so it cannot catch its own chunk's load rejection; the route exports no ErrorBoundary, so the rejection reaches the root boundary and replaces a healthy read view. The fix (one small boundary) is proportionate. |
| UX-11 | CP-22 | material | Verified: notes.tsx:71-73 renders the aria-live region with "Note deleted" as initial content on a fresh navigation. Live regions announce mutations, not mount-time content — the CF-47 announcement half is best-effort at most. Low severity is right, but the fix is trivial and the contract half is currently inert; not noise. |
| UX-12 | CP-43 | material | Verified by byte-scan: exactly 4 NULs, at lines 94 and 215 inside the `textBetween` separator literals; `git diff --stat` renders `Bin 0 -> 28816 bytes`. The demonstrated consequence is severe for a hygiene item — the feature's largest file was invisible to every diff-based review including this panel's. Escape-sequence fix is byte-identical. |
| UX-13 | CP-66 | material | Verified: init catch returns 3 (NoteEditor.tsx:311-313) while bumpFmt's catch comment documents the opposite intent ("legend just stays", :336) — an internal contradiction, i.e. a bug, not preference; ⌘ is hardcoded at :750 and :797. Storage-denied environments are rarer than the finding implies, but the fallback direction is simply wrong against A17 and the fix is one character plus a platform test. |
| UX-14 | CP-1 | material | Verified against React semantics, not vibes: `setDirty(true)` and `setPopup(null)` bail on identical values, so continuous typing produces no re-renders; `latestMdRef.current` in the deps array (NoteEditor.tsx:547) is inert; the timer armed by the first keystroke fires mid-composition, and unrelated renders reset it arbitrarily. Panel-1's low severity undersold it — this composes into CP-1's critical cluster. |
| UX-15 | CP-67 | material | Verified: on /notes/new pre-keystroke, `dirty` false / fetcher idle / data undefined → the ternary (NoteEditor.tsx:775-783) renders "Saved" with nothing persisted. Not mere copy nit: combined with UX-3 (no create autosave), "Saved" invites closing the tab on an unpersisted draft. Print-nothing fix matches house doctrine. |
| UX-16 | CP-68 | material | Verified: handlePaste announces "Pasted as link — Backspace to undo" (NoteEditor.tsx:493) but never sets `autoLinkKey` state, so the Backspace handler (:127-131) returns false and base Backspace atom-deletes without restoring the URL. The promise is heard only by SR users (sr-only region) and is false for them. Either proposed fix is one line; concede at low. |
| UX-17 | CP-69 | material | Verified: the door is `opacity-0 … group-hover:opacity-100 focus-visible:opacity-100` (media.tsx:531) with no coarse-pointer handling. iOS's first-tap-hover quirk is a partial accidental mitigation but not discoverability; Q6 puts mobile in scope and mobile is the recorded competitor gap. `pointer-coarse:` exists in Tailwind v4 — cheap, correct fix. |
| UX-18 | CP-70 | material | Verified: notes-only parsing leaves `scope = rest.value` → `base.scope` null (search.tsx:243-262), and the client defaults `included` to all GROUP_KEYS (:729), so all pills light and the status claims "0 results" for a full-library search that never ran. Considered out-of-scope (pill deliberately unshipped) but rejected the tag: the SERVER behavior for `scope=notes` is shipped and A4-public; the client rendering of shipped behavior lies today. Material at low severity. |

## Carve-out downgrade suggestions

None. No UX-lane finding carries the severity-high + security/data-loss/
correctness combination in its own right (UX-3 and UX-14 reach the carve-out
class only via the CP-1 correctness cluster, whose severity I endorse rather
than contest).

## Overall stance

Mostly — almost entirely — signal. All 18 findings verified against source,
including the three I probed hardest for overreach (UX-4's roving/view
interplay, UX-14's React-bailout mechanics, UX-18's scope plumbing), and the
lane's opening compliance concessions show calibration rather than
indiscriminate flagging. The one recurring softness is severity inflation in
neither direction but UNDER-statement: UX-14 (tagged low) is a load-bearing
member of the critical CP-1 cluster. No finding relitigates a settled
decision; several (UX-5, UX-6) are enforcement OF settled decisions.
