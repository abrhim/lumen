# Code-adversarial review — UX (search-ui, implemented)

Adversarial pass over `reviews/code-panel/ux.md` (UC-1…UC-10). Every row read at
`file:line`; DB claims re-probed LIVE as `lumen_read` (connection closed);
framework/state claims traced in the working tree. Plan `## Decisions` +
`## Plan amendments` (A1–A11) honored; "Out (deliberate)" untouched.

| ID | Tag | Rationale |
|----|-----|-----------|
| UC-1 | material | Verified: `onInputChange` (search.tsx:615-629) never resets `extra`/`pendingCursorRef`; only the `[location.key,q]` effect (:591-596) does. Single-scope + a live query edit merges the OLD query's `extra.results` under the NEW live group (:764-765) and derives `currentCursor` from the stale `extra.nextCursor` (:766) → stale rows + `cursor_mismatch` feed. Real correctness defect. |
| UC-2 | material | Verified: pageFetcher effect (:603-613) calls `d.groups.find(...)` with no shape guard. api.search.tsx RETURNS (never throws) `{error,code}` for 400/500 (:40-42,132-139), so `fetcher.data` is that body → `undefined.find` TypeError in an effect → route ErrorBoundary replaces the whole page on any pagination hiccup. `liveFetcher` effect (:598-601) drops error bodies via `d.query===liveQRef.current` → silent stale. Distinct defect from UC-1; fix (Array.isArray guard) is strictly safer, not risky. |
| UC-3 | material | Verified: `view` union includes `"pending"` (:638-649) but no `pending` render branch exists among :973-1113 (empty/keepTyping/zero/reference/results only). `busy` (:745-746) is false during the 350 ms debounce because `liveFetcher.load` is inside the `setTimeout` (:625-628), so `busySlow` (:751-758) can't fire before debounce+300 ms. Bare-page first search blanks to a void; plan's Scope-In "skeleton only after 300 ms" never shipped. |
| UC-4 | material | Verified residual of B-U1 MODE (not the fixed modal-trigger instance): scope toggles (:920-944), Show-all (:950-956), More (:1093-1100) are plain `<button>`s with no blur-after-pointer handling; `commitScope`→`commitNavigate`→`navigate` re-runs the loader on the SAME route, React reuses the keyed `<li>/<button>` DOM node, focus survives → Space re-toggles (silently re-includes the just-excluded group). Toggle className (:926-930) has zero `focus-visible:`. Per house rule, residual-of-fixed-mode = material. |
| UC-5 | material | DB-probed (lumen_read, closed): `search_index` kind=strongs → multi=354, nospace=0, total=20734. Title format is `{translit} {original-script}`; `payload->>'translit'` exists but `wordsLeg` ships only `strongs_no` (search.ts:599). `title.split(" ")` last-word-as-orig (search.tsx:477-479) mis-renders all 354 — e.g. `"aleph α, Αλφ"`→name `"aleph α,"` (Greek in the 15px Latin span), `"[ki al] ken [כִּי עַל] כֵּן"`→orig only `"כֵּן"`. "aleph" is a typeable query. |
| UC-6 | material | Verified: book/volume reference sets `display: parsed.raw` (search.ts:291); `parseReference` returns `raw = input.trim()` with original casing (slug-map.ts:105), while chapter uses `books.name` (:310) and verse uses `verses.reference` (:330). The 2xl font-display lead (search.tsx:1022/1038) renders raw "moses"/"MOSES" vs DB-proper "1 Nephi 3:7" — a real casing inconsistency on the prominent B-U2 lead surface. |
| UC-7 | material | Mechanism sound and unrefuted: Radix moves open-focus in a deferred effect (ui/sheet.tsx), outside the tap's user-activation window — WebKit only raises the soft keyboard on synchronous in-gesture focus, so the first input-in-Sheet in the house (AppMenu's Sheet is links-only) likely needs a second tap; `fixed bottom-0` has no visualViewport handling. Honestly flagged mechanism-level; I cannot device-verify, so per house rule it stays material — a real degraded primary mobile entry. |
| UC-8 | material | Verified: on the live-typed reference path `view==="reference"` renders "press Enter again to go" (:1030-1034), but `onSubmit`'s `trimmed===q` guard (:674) is false pre-commit, so the first Enter re-commits the URL (:678) — visually a no-op since the live lead already shows — and only the second Enter opens the reader. Hint contradicts behavior; real (low) wart. |
| UC-9 | noise | Verified: modal `onSubmit` returns silently for `trimmed.length < MODAL_Q_MIN` (SearchModal.tsx:69). The plan/component frame the modal as "minimal on purpose — one input" (SearchModal.tsx:18-24; plan.md:24) with a persistent "Enter to search · Esc to close" hint; a sub-2-char Enter doing nothing is acceptable minimal behavior, and the page's designed keepTyping state is a deliberately different surface. Design-preference nit, not a defect. |
| UC-10 | noise | Verified: `<main>` and every `<h2>`/`<header>` carry `max-w-4xl` + `border-b` (:815,816,1058) while rows cap at `max-w-prose` (:1080) — a self-consistent editorial pattern (full-width section rules, reading-width content). The `ml-auto` pill anchors to the section rule's right end, a defensible "see-all →" placement. Specialist hedges "confirm against the approved mockup"; unconfirmed style/alignment on a consistent pattern = noise. |

## Stance

Strong panel. 8 of 10 findings are material and survive adversarial verification —
including a genuinely dangerous chain: UC-1 (stale `extra` across live query edits)
feeding UC-2 (unguarded `d.groups.find` on a returned error body → full-page
ErrorBoundary for a background pagination error). Both are real, code-verified, and
their fixes are strictly safer (no risky tag warranted anywhere in this set). UC-5 is
DB-confirmed at the byte level (354/20,734 multi-word strongs titles; `translit`
already in-payload but unshipped) — the highest-signal find. UC-3 (missing `pending`
branch + debounce-blind slow-timer) and UC-4 (residual B-U1 focus-retention on the
page's own buttons, per the explicit residual-vs-fixed house rule) are clean. UC-6
(raw-cased book/volume lead) and UC-8 (hint/behavior mismatch on the live reference
path) are smaller but real. UC-7 is honestly scoped as mechanism-level; the WebKit
focus-in-gesture rule is well-established and I cannot device-refute it, so it stays
material.

The two downgrades are the panel's weakest rows: UC-9 argues the deliberately-minimal
modal should mimic the page's keepTyping state (contradicts the plan's "input only"
framing; silent sub-min Enter is fine), and UC-10 is an unconfirmed alignment
preference on a layout pattern the page applies consistently. Both are noise, not
defects. Dissent rate 2/10 = 0.20; no material/correctness finding killed, no
safety carve-out triggered.
