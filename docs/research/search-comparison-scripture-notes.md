# Lumen search vs Scripture Notes search — head-to-head

Written 2026-07-21, companion to [scripture-notes-competitor-deep-dive.md](scripture-notes-competitor-deep-dive.md).
"Lumen" here = `/api/search` as deployed to prod today (worker 57ce5669) plus the
approved search-ui feature currently in the panel pipeline. "SN" = Scripture Notes
per the deep-dive (their `/search-cheat-sheet/`, version history, and the
*Interpreter* review).

## 1. Retrieval mechanics — Lumen wins outright

| Capability | Scripture Notes | Lumen |
|---|---|---|
| Word forms | `*` wildcard only — no stemming. Their own docs teach `Just* -"just" -"justice"` to reach *justified* | English stemmer: `believes/believing/believed` collapse automatically |
| Archaic KJV vocabulary | User's problem: `believ*` to catch `believeth`; `shew`≠`show`, `sware`≠`swore` | 435-entry curated delta index: `believe` finds `believeth`, `show` finds `shew`, `swore` finds `sware` — **and highlights the archaic form in the snippet** |
| Typos | Nothing — `melchisedek` misses | Trigram tier: `melchisedek` → Melchizedek at rank 1 |
| Phrases | `"exact phrase"` (literal) | `"exact phrase"` via websearch syntax, plus cross-caption phrase matching in transcripts (windowed moments exist precisely because captions broke phrases) |
| Boolean | AND / OR / `-`NOT / `( )` grouping — the headline feature | Same operators via `websearch_to_tsquery` (implicit AND, OR, `-`, quotes) — table stakes, not the product |
| Ranking | None visible — concordance ordering; "best search" praise is about *coverage*, not relevance | Tiered (exact > prefix/fuzzy > full-text), field-weighted ts_rank, graph-degree boost (Jerusalem outranks obscure names at equal text match), JST demoted below canon, deterministic total order |
| Reference input | N/A — separate navigation | `1 nephi 3:7` short-circuits to a resolved reference before any search runs |
| Proximity / semantic | Absent; Daniel AI chat (Pro, $) is the only non-literal path, with latency complaints | Semantic deliberately out of scope (pgvector is the parked follow-on); Lumen's non-literal path is the MCP server — Claude over the whole graph, a different league than a bolted-on chat pane |

The *Interpreter* line — SN "definitely has the best search functionality" — was
written about a field where nobody stems. Mechanically, `/api/search` outclasses
their engine on every retrieval axis they document.

## 2. Corpus coverage — different bets, honest split

**Lumen indexes what SN cannot see:**
- 66k graph entities — people, places, topics, principles, symbols, events, eras — as first-class results with degree-ranked relevance
- 1,582 chapter summaries
- Strong's lexicon with accent folding (`agape` → ἀγάπη/agapē) — SN links *out* to Blue Letter Bible; Lumen returns the lexeme as a result
- Artwork (scene/character/theme metadata) — no analogue anywhere in SN
- Timestamped transcript moments (4,000 windows) that deep-link into the second of the episode — their Come Follow Me podcast integration is playback-only, not searchable

**SN indexes what Lumen doesn't (yet):**
- 56 years of General Conference — their strongest corpus card ("every talk citing this verse", 20k promises/8k warnings, term trends). Real, valuable, and we have nothing comparable today. Note: Lumen's DISCUSSES edges already support "every episode moment citing this verse" — the same *shape* of feature over our transcript corpus, listed in the deep-dive as an idea worth stealing.
- Footnotes of the 2013 edition
- **The user's own notes and collections** — searchable personal corpus, compounding over years. This is their real moat and it is a *notes* moat, not a search moat. Maps to Lumen's future personal-notes feature (`collections.owner_id` + reserved tiers already exist).
- Extended library behind Pro (Apocrypha, Jasher, etc.)

## 3. Search experience — opposite philosophies

| | Scripture Notes | Lumen (search-ui, in flight) |
|---|---|---|
| Interaction | Type query → run → operate on results with mouse; no keyboard shortcuts documented anywhere | `/` or `⌘K` from any page, results as you type (~250 ms measured prod p50: 242 ms), `↑↓`/Enter to open, URL-shareable searches |
| Presentation | Research workspace: panes, checkboxes, controls | A page in the reader: Fraunces/Newsreader typography, grouped results, match-term underlines, four paper themes |
| Faceting | Pre-filter books/volumes before searching | Post-hoc scope toggles (click a group to exclude it; one click to isolate), adaptive density, infinite scroll within a single group |
| Mobile | Their #1 complaint since launch day; sub-1.0 app, no iPad | Responsive-first, same page everywhere |
| Account | Cloud account required for everything | Anonymous search over public collections, sub-second, no signup |
| Price | Search free, but the workflow it feeds (collections) is Pro $4.95/mo | Free |

Their retention model is *education over simplicity* (48-technique email course to
survive the learning curve). Lumen's bet is the reverse: the light user lands in a
readable page and never sees a workspace.

## 4. Where SN genuinely beats today's Lumen — the honest column

1. **Search → cull → collect → synthesize.** Results can be pruned in place, saved
   as a named Collection Note, and annotated per verse. Search is the *start of a
   durable artifact*. Lumen search terminates in navigation. This is the entire
   personal-notes roadmap, deliberately not this feature.
2. **General Conference corpus** (above).
3. **Results in context** — expanding any hit with prev/next verses inline is a
   genuinely good affordance; Lumen's equivalent is clicking through to the reader.
4. **Search your own notes** — requires notes to exist first.

None of these are search-engine gaps; all four are corpus or workflow gaps, and
three of the four converge on the same future feature.

## 5. Bottom line

- **Retrieval:** Lumen is a generation ahead — stemming + KJV-delta + typo
  tolerance + ranking vs a literal concordance whose power users memorize wildcard
  idioms.
- **Corpus:** split decision — Lumen's graph/art/transcript/lexicon breadth vs
  SN's General Conference + personal-notes depth.
- **Experience:** Lumen's reader-first, keyboard-first, anonymous, mobile-sound
  page attacks exactly the churn log documented in their app-store reviews.
- **Moat:** theirs is the collection workflow, not the search. When Lumen ships
  personal notes, the last durable advantage in their column is General
  Conference — worth a corpus decision of its own someday.
