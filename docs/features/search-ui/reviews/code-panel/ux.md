# Code-panel review — UX (search-ui, implemented)

Reviewed range: `f352bae..46d888d` (deployed worker fd093ed4). Line anchors are 46d888d
(working tree has one post-range commit, 4f86b95 — A10 syntax help + B-U3 clear button —
out of scope; note B-U3 already covers the native `type="search"` cancel-✕ mode, so it is
not re-reported here). Plan decisions ledger honored; "Out (deliberate)" untouched.

Bug-fix verification:
- **B-U1 holds** — pointer-aware `onCloseAutoFocus` + blur on both Dialog and Sheet roots
  (SearchModal.tsx:112-118, 133-139). Residual instances of the same MODE found on the
  page's own buttons → UC-4.
- **B-U2 holds** — live `GET /search?q=moses` renders the reference lead AND all 7 group
  `<h2>`s (8+ each); "press Enter again" hint correctly absent on book level, present on
  verse level. The new lead surface has a copy wart (raw-input headline) → UC-6, and a
  live-typing Enter-count wart → UC-8.

| ID | Sev | Where | Problem | Fix |
|----|-----|-------|---------|-----|
| UC-1 | high | search.tsx:579-601, 750-751, 1029-1031 | Single-scope appended pages (`extra`) survive live query edits: old-query rows merge under new live results; exhausted old cursor renders false "That's everything."; live old-cursor replay → 400 `cursor_mismatch` → UC-2 crash takes the whole page to ErrorBoundary. | Reset `extra`/`pendingCursorRef` whenever the displayed query changes (in `onInputChange`/`setLive`), not only on navigation commit; derive `currentCursor` from the live group's `nextCursor`. |
| UC-2 | med | search.tsx:591-601 (586-589) | `pageFetcher` effect dereferences `d.groups` on `{error,code}` 400/500 bodies — TypeError → route ErrorBoundary replaces the entire page for a background pagination hiccup; `liveFetcher` errors are silently swallowed (stale results + stale count, no feedback). | Shape-guard fetcher data (`Array.isArray(d.groups)`); on pagination error re-show the More button with a quiet inline note; surface live-fetch failure in the status line. |
| UC-3 | med | search.tsx:626-637, 732-743 (no branch in 898-1038) | `view === "pending"` has no render branch: typing past qMin from bare `/search` blanks the invitation/"Keep typing…" into a void; the plan's "skeleton only after 300 ms" never shipped, and the 300 ms timer starts at fetch, after the 350 ms debounce (≥650 ms of nothing). | Add a quiet pending render (dim previous content or a minimal skeleton) and start the slow-timer at the keystroke so it covers the debounce window. |
| UC-4 | med | search.tsx:845-869, 873-882, 1017-1025 | B-U1 mode residual: scope toggles / "Show all" / "More" retain focus after a pointer click (Chrome); Space-to-scroll re-activates them — silently re-including the group just excluded, or double-paginating. Toggles also have no `focus-visible` style. | Apply the B-U1 pointer-aware pattern: blur after pointer-initiated commits (shared helper); add `focus-visible` ring so intentional keyboard focus stays legible. |
| UC-5 | med | search.tsx:474-494 | Words rows split `title` on the last space; 354 / 20,734 live strongs titles are multi-word ("ou mē οὐ μή", "aleph α, Αλφ") — script fragments render inside the Latin name at 15 px and only the tail gets the 19 px original-script treatment. | Carry translit/original as separate payload fields from the words leg (search_index payload already holds `translit`) instead of string-splitting the title. |
| UC-6 | med | packages/scripture/src/search.ts:291; search.tsx:936-967 | Book/volume reference lead headlines the user's RAW input: live q=moses renders "moses →" in font-display 2xl (`display: parsed.raw`), while verse/chapter leads show DB-proper "1 Nephi 3:7". The B-U2 surface parrots casing ("MOSES", "d&c"). | Resolve the display name from `lumen.books.name` (as chapter level already does) or title-case via the slug map before rendering the lead. |
| UC-7 | med | SearchModal.tsx:106-125; ui/sheet.tsx:63 | First house Sheet containing a text input: Radix's deferred open-autofocus is outside the tap's user-activation, so iOS Safari likely won't raise the keyboard (second tap needed); the `fixed bottom-0` sheet has no visualViewport/keyboard-avoidance handling. Not device-verified — mechanism-level. | Device-verify on iOS; if confirmed, `onOpenAutoFocus` preventDefault + synchronous focus, and visualViewport padding so the input clears the keyboard. |
| UC-8 | low | search.tsx:662-666, 955-958 | After live-typing a verse reference, the hint reads "press Enter again to go" but the `trimmed === q` guard means the first Enter only re-commits the URL (looks like a no-op); the reader opens on the second. | When the live view is already a resolved reference, let Enter navigate straight to `displayReferenceHref` (or reword the hint on the live path). |
| UC-9 | low | SearchModal.tsx:66-73 | Modal Enter under 2 chars is a silent no-op — no keep-typing feedback; the page has a designed keepTyping state, the modal has none. | Show a quiet "Keep typing…" line in the modal, or navigate to `/search` which renders the designed state. |
| UC-10 | low | search.tsx:800, 983-1004 | `<h2>` spans `max-w-4xl` while rows cap at `max-w-prose`: on desktop the "More in X →" pill (ml-auto) floats ~270 px right of the text column, visually detached from its group. Narrow widths are fine (worst-case header ≈264 px < 320 px viewports). | Confirm against the approved mockup; if unintended, cap the section header at `max-w-prose` so the pill hugs the column. |

## Evidence

**UC-1/UC-2 chain (code-level, 46d888d):**
- `extra` cleared ONLY in the `[location.key, q]` effect (search.tsx:579-584). `onInputChange` clears live state but never `extra`.
- With `scope=scripture` + one More click (`extra` set), typing a new query → `display = live` (:619) but `mergedSingle = dedupeMoments(baseGroup.results, extra.results)` (:750) merges the OLD query's page-2 rows under the NEW query's header (id-keyed dedupe cannot remove them).
- `currentCursor = extra ? extra.nextCursor : baseGroup?.nextCursor` (:751): stale-exhausted → `"That's everything."` under a truncated new query (:1029-1031); stale-present → sentinel/More fetches `q=NEW&after=OLD_CURSOR` → api.search.tsx:88 `decodeSearchCursor` qhash mismatch → 400 `{error, code:"cursor_mismatch"}` (returned, not thrown → fetcher.data). Effect at :591-601 runs `d.groups.find(...)` on that body → TypeError in useEffect → nearest ErrorBoundary = the search route's — the whole page (input included) is replaced by "Search failed — nothing wrong with your query". Same crash shape for any legit 500 during pagination.

**UC-3:** `view` union includes `"pending"` (:626-637) but render branches at :898-1038 cover only empty/keepTyping/zero/reference/results — `grep -n pending` shows no JSX branch; `busy` (:733-734) excludes the 350 ms debounce window, so `busySlow` ("Searching…", the only pending signal, in the 20 px status line) can appear no earlier than debounce+300 ms. No skeleton markup exists anywhere in the file.

**UC-4:** toggle/Show-all/More are `<button>`s with no blur-after-pointer handling (:845-869, :873-882, :1017-1025); commits re-run the loader on the SAME route so React reuses the DOM node and focus survives navigation — the exact B-U1 mechanism (Chrome focuses buttons on click). Toggle className has hover styles only, no `focus-visible:`.

**UC-5 (live DB probe, lumen_read, connection closed after):**
```
SELECT title FROM lumen.search_index WHERE kind='strongs' AND title LIKE '% % %' LIMIT 12
→ "ou mē οὐ μή", "aleph α, Αλφ", "beth β, Βηθ", "gimel γ, Γιμαλ", "daleth δ, Δελθ", ...
SELECT count(*) FILTER (WHERE title LIKE '% % %') AS multi,
       count(*) FILTER (WHERE title NOT LIKE '% %') AS nospace, count(*) AS total
FROM lumen.search_index WHERE kind='strongs'
→ { multi: 354, nospace: 0, total: 20734 }
```
`title.split(" ")` with last-word-as-original mis-renders all 354 (e.g. "ou mē οὐ μή" → name "ou mē οὐ" / orig "μή"). "aleph" is an eminently typeable query. The words leg's payload already reads `si.payload ->> 'translit'` (search.ts:595) but ships only `strongs_no` (:599).

**UC-6 + B-U2 verification (live prod, GET only):**
```
GET /search?q=moses →
  REF BLOCK: ...<a ... href="/scripture/moses">moses<!-- --> ...→...</a>
  h2 count: 7 (Scripture/People/Places/Topics/Episodes/Art/Words, each "8+", each with More pill)
  'press Enter again' hint: absent  ✓ (gated to true short-circuits)
GET /search?q=1%20nephi%203%3A7 →
  REF BLOCK: href="/scripture/1-ne/3?verse=7">1 Nephi 3:7 ... "press Enter again to go." present
  h2 count: 0; status region: "Reference — 1 Nephi 3:7"  ✓
```
`/scripture/:book` route exists (routes.ts:5) so the book-level link is valid; the wart is purely the raw-cased headline (`display: parsed.raw`, search.ts:291) vs the DB-resolved verse display.

**UC-7:** SheetContent renders its close button AFTER children (ui/sheet.tsx:70-82), so Radix's first-tabbable autofocus does land on the input — the open/focus sequence, however, runs from React state effects, outside the tap's user-activation window (WebKit keyboard-raise rule). AppMenu's Sheet is links-only; no house precedent exists for an input inside the Sheet. Flagged mechanism-level, needs one on-device pass.

**Hint-on-touch (verified clean):** `hidden pointer-fine:block` (:824), Tailwind 4.1.17 (`pointer-fine` variant native in v4.1); ↑↓ segment gated on `hasRows` (:826-832). Δ UU-7 holds.

**Narrow-width header math (UC-10):** worst pill "More in episodes →" ≈ 121 px + icon 17 + label ≈ 78 + count 18 + gaps 30 ≈ 264 px vs 272 px available at 320 px viewport — no overflow; the desktop detachment (896 px header vs ~620 px prose column) is the only alignment concern.
