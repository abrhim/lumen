# Code panel — surface (strongs)

UX + a11y + observability + api-contract, reviewed against plan.md amendments
6–7 and `reviews/panel-2/tagger-b.md` resolutions, on the live diff
(`apps/web/app/routes/scripture.tsx` `WordStudyVerse`/`WordStudyCard`,
`apps/web/app/lib/word-study.ts`, `apps/web/app/routes/api.strongs.tsx`).

## Verified clean (no row needed)
- Roving tabindex mechanics: `move()` clamps correctly and
  `document.getElementById('ws-'+word_id)` resolves — ids are unique because
  `PanelBody`/`WordStudyVerse` render exactly once at a time (desktop rail
  and mobile `Sheet` are mutually exclusive on `isMobile`).
- `wordtags_degraded` fields (`name`, `message`, `book`, `chapter`, `verse`,
  `elapsedMs`) match `crossref_degraded`/`graph_degraded` exactly — house
  parity holds.
- Active-word selection uses `bg-sel text-ink` (not
  `text-muted-foreground`) — `--t-ink`/`--t-sel` pairs are the same
  foreground/background pairing used for `--t-panel`, verified sufficient
  contrast in all 4 themes (paper/parchment/linen/ink).
- Q3 (phrase behavior): `alignSpansToWords` tags every phrase member with
  the identical `strongs[]`, so `getWordTags`'s per-word JOIN yields
  identical `entries` for every member — tapping any member shows the same
  card content, matching the plan default.
- Toggle discoverability: the "Word study" button is unconditionally
  visible (not hover-gated) whenever `hasTags`, satisfying UA-1/UA-2.

## Findings

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| CS-1 | High | `WordStudyCard` `useEffect` (`scripture.tsx`) | `alsoIn.state === "idle"` guard skips `.load()` on rapid taps; stale "also in" verses from the prior word render under the new word's card. | Drop the idle guard — call `alsoIn.load()` unconditionally on `tag.word_id` change; fetcher auto-supersedes in-flight loads. |
| CS-2 | Medium | `WordStudyVerse` toggle/Done + verse-change reset | Toggling study on/off, hitting Done, or switching verse while active unmounts the focused button with no focus target set — focus drops to `<body>`. | On activate, focus first `ws-` word; on deactivate/Done/verse-change, return focus to the "Word study" toggle button. |
| CS-3 | Medium | Tagged-word `<button>` classes (`-mx-0.5 -my-1 px-0.5 py-1`) | Adjacent tagged words' padded hit areas each reach ~2px into the shared space glyph (~3–4px at 14px italic); taps near the boundary can hit the wrong word. | Reduce horizontal hit-area expansion, or add a small untappable buffer so adjacent expanded boxes can't touch. |
| CS-4 | Medium | `WordStudyCard`'s `aria-live="polite"` wrapper | One live region covers both the immediate lexicon entries and the later-arriving "Also in" list, so each tap can fire two separate SR announcements. | Move `aria-live` onto just the "Also in" paragraph; leave the immediately-available entries in a static (non-live) container. |
| CS-5 | Low | `WordStudyVerse` `hasTags` gate | `wordTags.degraded` collapses to the same silent absence as "verse has no tags" — no UI signal, unlike `crossRefs`'s `DegradedNotice` on failure. | Render a small "word study unavailable" note when `wordTags?.degraded`, distinct from the tags-genuinely-empty case. |
| CS-6 | Low | `scripture.loader.test.ts:198` (CPERF-6) | The query-count guard only exercises the no-verse-selected chapter view (word-tags short-circuits to `Promise.resolve(null)`); the verse-selected + Bible-book branch that adds the real 7th query is unasserted. | Add a CPERF-6 case for a Bible verse selected, asserting the bounded round-trip count with `getWordTags` participating. |
| CS-7 | Low | `packages/scripture/src/__tests__/strongs-queries.test.ts` | Amendment 3 (PO-3) pins `getWordTags` to `GROUP BY` + `json_agg` one-row-per-word, but the test still only checks `LEFT JOIN`/`strongs_lexicon`/`char_start` substrings. | Add assertions for `GROUP BY` and `json_agg` in the captured SQL to pin the one-row-per-word invariant. |
| CS-8 | Low | `api.strongs.tsx` `strongs_lookup_degraded` | Event omits `elapsedMs`, present on every sibling `*_degraded` event (`wordtags_degraded`, `crossref_degraded`, `graph_degraded`, `art_gallery_degraded`). | Track `startedAt` and add `elapsedMs` to the logged payload for house parity. |

## Summary
8 findings: 1 High (CS-1, a real cross-word data-mix bug), 3 Medium
(CS-2 focus loss, CS-3 hit-area overlap, CS-4 double SR announcements),
4 Low (CS-5 degraded-state silence, CS-6/CS-7 test-coverage gaps on
amendments the plan already claims as "incorporated"/"pinned", CS-8 event
field parity).
