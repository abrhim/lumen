# Scripture Notes (scripturenotes.com) — competitor deep dive

Researched 2026-07-21 (two-agent sweep: product docs + community/reviews), in the run-up to
Lumen's search UI feature. `/api/search` shipped to prod the same day; this document exists to
inform what the UI (and the eventual personal-notes feature) should copy, beat, or avoid.

---

## 1. Product overview

- **What:** web-first LDS scripture study platform built around the 2013 LDS edition
  (licensed from the Church), combining Boolean search, verse-anchored notes, and a
  multi-pane research workspace.
- **Who:** Oak Norton, operating as Living Tree Software, LLC (Kaysville, UT).
- **Origin:** ~2001 frustration with a DOS-era study tool that lost its search power on
  Windows; ~2003 personal ColdFusion + MS Access build used privately for 15+ years;
  public launch ~Dec 2019/Jan 2020.
- **Taglines:** "Get More Revelation in Less Time" · "10X Your Study With a Personal
  Research Assistant" · "Your Own Scripture Research Assistant."
- **Positioning:** explicitly *not* a Gospel Library replacement — "meant to be a primary
  platform for superior studying and searching the scriptures."
- **Endorsers/distribution:** Dr. Brent Top (retired BYU Dean of Religious Education),
  Bryce Dunford, Greg Matsen; sponsor-driven distribution via Ward Radio, CWIC Show,
  FIRM Foundation / Book of Mormon Evidence conferences. Affiliate program
  (`?via=` links) seeds most "organic" mentions.

## 2. Platforms & scale

| Surface | State |
|---|---|
| Web app (app.scripturenotes.com) | Primary, full-featured |
| iOS / Android | Deliberately sub-1.0 (v0.99.65, June 2025), single-pane, reduced; no native iPad app |
| Desktop app | None; browser plugin "planned" |
| Offline / local-only | Not available; cloud account required |

Scale signals: Apple App Store **4.2/5 on 57 ratings**; Google Play **1,000+ downloads**;
company-solicited Trustindex widget 5.0/5 (182 reviews, 178 five-star — marketing-adjacent).
Thin organic Reddit footprint (largest thread = founder's own 2020 launch post, 31 upvotes).
A niche desktop-web product with a passionate small user base.

## 3. Pricing

| | Free | Pro |
|---|---|---|
| Price | $0 | **$4.95/mo or $49.95/yr** (web); $5.99/mo iOS IAP |
| Includes | 2013 LDS library, basic verse notes, verse markup, search, **read-only** collection notes, resource links | + **create** collection notes, Apocrypha & extended library, **Daniel AI**, content sharing |

14-day Pro trial (credit card up front — a recurring resentment in 1-star reviews). No
lifetime or family plans. Framing: "We are not charging for the scriptures. We are charging
for an interface into the scriptures." **The free tier gates the core workflow** (you can
search but not save curated collections).

## 4. The note-taking model

Two layers, both verse-anchored:

1. **Verse notes** — a note field on *every verse*; auto-save; the same note follows the
   verse into every context (reading pane, search results, collections). Chapter view can
   show/hide all notes inline.
2. **Collection Notes (CNs)** — the flagship: a named, ordered, unlimited verse list with a
   **master note** at top for synthesis ("like creating a scripture chain but better";
   effectively a personal Topical Guide entry). Each member verse keeps its own note field.

Verse entry paths: "Create CN" button atop search results (converts curated results into a
collection); drag-and-drop; bulk checkbox move; in-collection up/down triangles append
prev/next verse for context. Custom verse ordering (2023). Hierarchical colon tags
("Jesus Christ:Symbols of"). Gospel Library note import (July 2023). Export = HTML report
buttons / printable reports; sharing = private + public collection-note sharing (2023),
verse-note sharing (2025).

## 5. Search functionality (detail)

### Operators (from /search-cheat-sheet/)
- Implicit/explicit `AND` (`Eye Single`, `Eye +Single`, `Eye AND Single`)
- `OR`, `-`/NOT ("word to the right of the minus must not be present")
- `*` wildcard — the **only** word-forms mechanism (no stemming): `striv*` → striving
- `( )` grouping: `wait* AND (Lord OR God)`
- `"exact phrase"` (quotes make stopwords literal)
- Composed idiom from their own docs: `Just* -"just" -"justice"` → justify/justified/justification
- Quirk: hyphenated names searched without hyphen (`Lehi Nephi`)
- **Absent:** proximity/NEAR, field syntax, ranking, stemming, typo tolerance, semantic

### Scopes & result manipulation (the actual differentiators)
- Search **footnotes**, **your verse notes**, **your collection notes** — not just canon
- Prefilter books/volumes before searching
- Expand any hit with prev/next verses inline ("results in context")
- **Delete irrelevant hits** from the result set (curation-in-place)
- **Save the curated result set as a Collection Note** — the search→collection pipeline that
  defines the product
- Annotate/mark up verses directly inside search results

### General Conference engine
Boolean search over 56 years of talks; database of "20,000 promises and 8,000 warnings";
**search by scripture reference → every talk citing that verse**; term-trend analysis over
time; speaker language comparison; side-by-side conference + scripture results.

## 6. Workspace & study tools

- Unlimited side-by-side panes; "**rabbit hole mode**" — every tangent opens a new pane so
  the original place persists; notes sync across panes/tabs; panel pinning on 2026 roadmap.
- One-click per-verse tools: Webster's 1828, Strong's via Blue Letter Bible, 29 translations
  via Bible Hub, BYU LDS Citation Index, full JST, Topical Guide bulk-pull (2021),
  Google-Maps-integrated Bible/D&C maps (2023), Come Follow Me podcast integration.
- **Daniel AI** (Apr 2024, Pro): chat beside every verse/paragraph; canon + apocrypha +
  conference corpus; the only non-literal retrieval path; self-disclaims accuracy. 2026
  roadmap: chat saving within projects.
- Gamified: Verse Vault (spaced-repetition memorization + familiarity quizzes, 2025),
  Time Skimmer game (2023), badges planned 2026.
- Extended library (Pro): JST, Gileadi Isaiah, 15-book Apocrypha, Enoch/Jasher/Jubilees,
  Pistis Sophia, Quran, Tao Te Ching, Lectures on Faith, Talmage, Farrar, etc.
- **No keyboard-shortcut documentation anywhere** — mouse/drag-centric UI.

## 7. Reception

### The one rigorous independent review
Trevor Holyoak, *Interpreter: A Journal of Latter-day Saint Faith and Scholarship* vol. 36:
"ScriptureNotes is a valuable tool for serious, in-depth scripture study, and it definitely
has **the best search functionality**" — but "if you often mark or underline as you read,
you'll need to use Gospel Library." Also flags the learning curve, non-intuitive UI, and
cloud-only data concerns.

### Praise themes (with representative quotes)
- **Search** — #1 cited strength ("a concordance for every single word in all the scriptures")
- **Daniel AI** — "answers in the form of scriptures… within seconds"
- **Multi-pane comparison** — "in a league of its own for side by side text comparison"
- **Integrated resources** — 1828 Webster's / Strong's / Citation Index one click away
- **Behavior change** — "for the first time in my life, I'm not just reading the scriptures,
  I'm studying them!"; "increased my engagement 100-fold"; "makes it hard to stop studying"

### Criticism themes
- **Mobile/iPad is the biggest complaint** (crashes mid-lesson, no iPad app, "Not for
  phone only… I regret my trial") — dates back to launch day
- **Billing/trial resentment** — recurring 1-star theme (card-up-front trial, hard to cancel,
  "feels a little deceptive")
- **Learning curve** — "Simpler is better. I find it too complicated"
- **AI latency** — "waiting minutes for anything to even come up"
- **Cloud lock-in** — HTML-only export; long-term data-portability worries
- **Positioning** — *Interpreter* notes "controversial figures" among recommended resources;
  distribution concentrated in one ideological podcast ecosystem

## 8. How hardcore researchers use it

The canonical loop, described identically by tutorials and reviewers:

> **search → cull → collect → synthesize**
> Boolean query → expand hits into context → delete noise → save survivors as a Collection
> Note → annotate each verse → write the master summary → tag into a hierarchy.

Around that core: multi-pane research trails (the pane chain *is* the research log);
original-language digging via Strong's/1828; conference-corpus mining (every talk citing a
verse; promises/warnings); teacher/creator output (S&I teachers, podcast hosts, lesson
writers exporting HTML/PDF reports). The compounding asset is a **personal commentary corpus
built over years** that resurfaces automatically wherever a verse appears.

## 9. How light users use it (mostly: they churn)

The 1–3 star app-store corpus is a churn log: phone-only readers, a Sunday School teacher
whose app crashed twice in one lesson, complexity bounces, billing anger. No
highlighting/marking system comparable to Gospel Library's; several reviewers say outright
they went back to the Church app. The counter-pattern: light users who complete the
onboarding email course (48 techniques, 6 tutorials, webinars) sometimes convert to
enthusiasts — retention is driven by education, not product simplicity. Come Follow Me
families are conspicuously absent from the review corpus.

## 10. Comparisons users make

| vs | Verdict in the wild |
|---|---|
| Gospel Library | SN wins search/notes/research panes; GL wins marking, price, mobile polish, breadth of Church content |
| ScripturePlus | ScripturePlus for daily reading + commentary; SN for research (*Interpreter*) |
| Obsidian/Notion/Evernote | No head-to-head found; treated as different categories |
| Logos/e-Sword | No substantive comparisons found |

## 11. Implications for Lumen

**Retrieval: Lumen already wins mechanically.** `/api/search` has stemming, KJV-variant
handling (`believeth` just works — SN needs `believ*`), trigram typo tolerance, ranked
tiers, reference short-circuit, and corpora SN doesn't index (art, timestamped transcript
moments, graph entities). SN's search is literal concordance retrieval; its only non-literal
path is a bolted-on AI chat.

**The loop: SN has what Lumen lacks.** Their entire retention story is that search results
can be pruned, kept, named, and annotated — search as the *start of a durable artifact*,
not a lookup. That maps directly onto Lumen's future personal-notes feature (auth's intended
first consumer; `collections.owner_id` + reserved `personal`/`community` tiers already
exist). The searcher journey to steal: **search → cull → collect → synthesize**.

**Their failure modes are Lumen's opening:**
- Research-workspace-first UX repels light users → Lumen's reader-first progressive-depth
  design (margin dots → verse panel → graph) is the opposite bet; keep it that way.
- Mobile is an afterthought → Lumen is responsive-first.
- Free tier gates the core workflow → decide deliberately where Lumen's free/paid line goes,
  if ever.
- No backlinks/graph between notes; coarse public/private sharing; no keyboard workflow;
  HTML-only export.

**Feature ideas worth noting** (not commitments): search-by-reference over the transcript
corpus ("every episode moment citing this verse" — Lumen already has the DISCUSSES edges);
result curation before saving; conference-style corpus analytics later.

## 12. Sources

Product: [scripturenotes.com](https://scripturenotes.com/) · [/about-us](https://scripturenotes.com/about-us/) ·
[/pricing](https://scripturenotes.com/pricing/) · [/faq](https://scripturenotes.com/faq/) ·
[/search-cheat-sheet](https://scripturenotes.com/search-cheat-sheet/) ·
[/faq/compare-to-gospel-library](https://scripturenotes.com/faq/compare-to-gospel-library/) ·
[/version-history](https://scripturenotes.com/version-history/) ·
[/library](https://scripturenotes.com/library/) ·
[Daniel AI announcement](https://scripturenotes.com/introducing-daniel-your-scripture-notes-ai-research-assistant/) ·
[GC search engine](https://scripturenotes.com/the-amazing-new-general-conference-search-engine/) ·
[CN tutorial](https://scripturenotes.com/tutorial-1-how-to-use-collection-notes-in-scripture-notes/) ·
[how-to-study method](https://scripturenotes.com/how-to-study-the-scriptures/)

Community: [Interpreter review (full)](https://interpreterfoundation.org/journal/feast-upon-the-words-of-christ) ·
[Interpreter abstract](https://scholarsarchive.byu.edu/interpreter/vol36/iss1/13) ·
[Apple App Store](https://apps.apple.com/us/app/scripture-notes/id1611795202) ·
[Google Play](https://play.google.com/store/apps/details?id=com.snrnappmobile2&hl=en_US) ·
[LDS365 2020](https://lds365.com/2020/01/07/scripture-notes-advanced-lds-scripture-journaling/) ·
[LDS365 2021 (TG)](https://lds365.com/2021/01/05/scripture-notes-advanced-lds-scripture-journaling-now-includes-the-topical-guide/) ·
[Tree of Life Mothering review](https://treeoflifemothering.com/2021/11/06/best-study-tool-for-the-scriptures-scripturenotes/) ·
[Scriptorium Blogorium review](https://scriptoriumblogorium.blogspot.com/2020/02/review-scripturenotes-web-application.html) ·
[r/lds launch thread](https://www.reddit.com/r/lds/comments/eiduit/powerful_new_lds_scripture_study_app_released/) ·
[Trustindex widget](https://www.trustindex.io/reviews/scripturenotes.com) ·
[FIRM conference talk](https://streaming.bookofmormonevidence.org/videos/virtual-expos-2021/oak-norton-10x-your-scripture-study/) ·
[Latter-day Disciples ep. 58](https://latterdaydisciples.com/episode-58/) ·
[LDS Living (sponsored)](https://www.ldsliving.com/sponsored-get-more-out-of-the-scriptures-in-less-time-with-scripturenotes-com/s/10885)

Method notes: Reddit searched via Pullpush archive (thin footprint is a finding, not a search
failure); no independent third-party YouTube reviews exist; Trustindex ratings are
company-solicited; one pricing discrepancy (Daniel free vs Pro) resolved in favor of the
pricing page.
