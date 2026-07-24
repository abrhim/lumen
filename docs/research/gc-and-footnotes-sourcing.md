# How Scripture Notes has General Conference + LDS footnotes — and Lumen's lawful paths

Researched 2026-07-21 via a 5-agent workflow (4 parallel researchers + adversarial
fact-checker re-fetching every load-bearing source). Verification verdicts are folded in
below; the one MISREAD the checker caught (the public-domain boundary) is corrected here.
Not legal advice.

---

## 1. The headline answers

**Scriptures + footnotes (the 2013 apparatus): licensed.** Scripture Notes' FAQ has said
continuously since before launch (Wayback 2019-08-25 → live today): "we licensed our
content directly from the LDS church… In other words, we won't have a copyright issue."
Homepage: "the 2013 edition of the gospel library scriptures licensed from the Church."
The license is what covers the parts that are actually IRI-copyrighted — footnotes,
Topical Guide, Bible Dictionary, chapter headings, JST excerpts (bare KJV and pre-1929
LDS scripture text is public domain). No terms, fee, or counterparty document is public;
their ToS carries the classic Church-required non-endorsement disclaimer and no
"used by permission of Intellectual Reserve" attribution. All self-reported — no IRI-side
confirmation exists.

**General Conference: NOT licensed — by their own on-camera admission.** Oak Norton,
launch video for the GC search engine (May 2026, YouTube PeUjKbZD0xM, transcript
verified twice): *"the church does not license their conference talks to be put in other
programs at this time. So, we're not putting their content in the app. We're just giving
you the ability to search those talks."* Their FAQ agrees: *"The church has not yet
licensed any non-church owned entity this content."*

**What they built instead:** full-text ingestion server-side (Norton: "we've been able to
scrape together over 20,000 promises from the last 56 years") powering a search **index**
— snippets, per-talk stats, promises/warnings databases, trend analysis, verse-citation
lookup — with **deep links to churchofjesuschrist.org for the full talk**. Full text is
never displayed in-app. This is a fair-use-shaped compliance posture, not a permission.

**The "56 years" boundary is source availability, not a license window.** The Church's
own online GC archive runs 1971→present; 1971–2026 inclusive = 56 years at their May
2026 launch. (Verified against the archive page.)

## 2. The Church's IP regime (all quotes verified against fetched primary sources)

- **Intellectual Reserve, Inc. (IRI)** holds all Church IP. Permission flows only through
  the Correlation Intellectual Property Division (First Presidency delegation, letter of
  14 Nov 2014, quoted in IRI's third-party guidelines PDF PD80015646).
- **The portal:** permissions.churchofjesuschrist.org — "request a simple license" there;
  Church Account required (non-members allowed); ~45-day reply, "requests involving
  considerable quantities of material may take longer." Criteria: respectful, no
  confidential info, harmony with teachings, no implied endorsement, and offerings must
  not "focus on, nor attempt to replace, official Church curricula, programs, or
  activities." "For those using Church copyrighted materials in any commercial context,
  the payment of royalties should be expected."
- **Terms of Use** (churchofjesuschrist.org/legal/terms): the use grant is *personal,
  noncommercial* only. Two clauses matter independently of copyright:
  - Entity bar: "Any other use… **including any use by organizations or legal
    entities**, is not permitted without our prior written permission" — commerciality-
    irrelevant; a free app run by an entity is still covered.
  - Anti-scraping: agree not to "use any robot, spider, or other automatic device… to
    access this site for any purpose, including… monitoring or **copying any of the
    material**" without prior written consent. robots.txt *allows* crawling
    /study/general-conference (and the official sitemap enumerates **5,611 talk URLs,
    1971–2026**) — but robots-compliant ≠ ToU-permitted.
- **No public API, ever.** Confirmed across archived Church tech-forum threads ("the
  Church doesn't provide any public APIs"), the Open Scripture API's own FAQ ("Nope"),
  and a PyPI package removed at the request of the Church's IP Division.
- **Precedents:** Scripture Notes (2013 edition, *commercial* product — so IRI does
  license paid third parties); ScripturePlus / Book of Mormon Central ("The Church…
  granted a license… in 2016," free app); BYU's Scripture Citation Index serves full talk
  text 1942→present and is promoted by Church Newsroom (blessing inferred, arrangement
  undocumented). No forum thread reports the outcome of a GC-talk license request.

## 3. Copyright status of GC content by era (verifier-corrected)

| Era | Status | Basis |
|---|---|---|
| Journal of Discourses 1851–1886 | **Public domain** | Term expired |
| Conference Report 1897–1930 | **Public domain** | Term expired (95-yr line = pre-1931 as of 2026); HathiTrust `pd` codes corroborate |
| 1931–1963 | **PD, strongest-documented** | (a) published with **no copyright notice** (verified in the Church's own archive.org scans: 1942, 1950, 1956 …) — 1909 Act forfeiture; (b) **never renewed** — zero "Conference Report" hits in the complete NYPL CCE renewals dataset + UPenn periodical census |
| Apr 1956–Oct 1963 caveat | Residual-claim vector | The same talks ran in **Improvement Era**, whose issues Mar 1954 + Feb 1956–Dec 1963 **were renewed** by the Corporation of the President (verified renewal records, e.g. RE162854). The no-notice Conference Report forfeiture argument is strong but untested |
| 1964–**Oct 1971** | **PD (no notice)** | Verified no-notice volumes: 1964sa, 1970a, 1971a, 1971sa. **Verifier correction:** notices begin with the **April 1972** Conference Report ("©1972 Corporation of the President… All Rights Reserved" — the original researcher's "first notice Oct 1974" was an OCR-grep false negative). 1971 itself is gray pending Ensign-notice verification |
| Apr 1972–1977 | **Protected** | Valid notice; renewal automatic under the 1992 Act. **Do not treat 1972–1974 as PD** |
| 1978–present | **Protected** | Presumptive; IRI asserts ownership; no notice/renewal defects available |

Ownership: no speaker ever renewed a talk; the Church renewed works as
proprietor/work-for-hire (PWH/PCW codes in the renewal records). Negotiate with IRI, not
speakers.

Telling institutional echo: Church-owned BYU's scriptures.byu.edu hosts **full text for
exactly 1851–1886 and 1942–1970** — and stops at 1970, right where the era map turns.
Meanwhile the Church itself uploaded complete downloadable Conference Report scans to
archive.org (contributor: Church History Library) with a blanket IRI metadata stamp —
which has no legal effect on expired/forfeited copyrights but signals posture.

## 4. Existing datasets and scrapers (none are a legal basis)

- **qhspencer/lds-data-analysis** — most honest: ships downloaders only, no text ("talks
  are presumed to be copyrighted"). Best *method* reference: churchofjesuschrist.org talk
  pages embed **base64 JSON with structured paragraphs + footnotes** — no HTML parsing
  needed.
- **lukejoneslj/GeneralConferenceScraper** — Apache-2.0 (code only); scrapes 1971→ incl.
  **footnotes**; adds topic/emotion labels.
- **bryanwhiting/generalconference** (R) — **bundles actual talk text** 1971–Apr 2021
  under an MIT label that cannot cover IRI's content. A hazard, not an asset.
- **HuggingFace zorbalee/generalconference_talks** — 3,540 rows, 2000–2024 only, "MIT,"
  same problem. No other GC dataset on HF; none found on Kaggle.
- **Davies corpus** (lds-general-conference.org, 11,175 talks 1851–2021, 25.4M words) —
  a **search interface, not a dataset**: "We are using the talks… under 'Fair Use'…
  providing access only through the web interface. We cannot redistribute any of the
  10,000 talks in full-text format… no exceptions — to anyone, at any time, or for any
  reason." KWIC snippets only, rate-limited, lawyer-vetted (two internet-copyright
  lawyers). The strongest primary statement of the whole space's legal posture.
- **BYU SCI** (scriptures.byu.edu) — undocumented AJAX endpoint `content/talks_ajax/{id}`
  returns full structured talk HTML back to 1942. Useful for **PD-era (pre-Oct-1971)
  text in clean HTML**; for modern talks it just relocates the unlicensed-redistribution
  problem. The citation-index *linkage data* is BYU's own work product — separately
  askable.

## 5. Lumen's options, ranked

1. **Public-domain corpus, today, no permission needed:** Journal of Discourses
   1851–1886 + Conference Reports 1897–Oct 1971 (cleanest through Apr 1956; 1956–1963
   strong with the Improvement Era caveat; 1964–Oct 1971 strong no-notice). Sources: the
   Church's own archive.org scans (OCR text included) or BYU `talks_ajax` for clean HTML
   1942–1970. Real corpus depth — prophetic teaching across 120 years — with zero
   licensing exposure on the era map above (excluding the gray zones if desired).
2. **The snippet-index + deep-link pattern for 1971+** (the Scripture Notes / Davies
   model): ingest for indexing only; expose search hits as short snippets, stats, and
   derived factual data (citations, trends); deep-link to churchofjesuschrist.org for
   reading (linking is expressly contemplated by the ToU). Two caveats: *acquisition* by
   robot still trips the ToU anti-scraping clause (Scripture Notes' behavior is market
   practice, not permission), and fair use is a defense, not a grant.
3. **Ask IRI** via permissions.churchofjesuschrist.org: free-app framing, ~45+ days,
   disclaimers and no-endorsement conditions expected, royalties if Lumen ever charges.
   Precedent for scripture-edition licenses is solid (Scripture Notes commercial,
   ScripturePlus free); **GC talks are the one category reportedly never licensed to any
   non-Church entity** — set expectations, and propose the snippet model as fallback in
   the same request. Contact: permissions@ChurchofJesusChrist.org / IP Office
   cor-intellectualproperty@ChurchofJesusChrist.org.
4. **Canonical footnotes/TG/BD** (the other half of the question): same IRI license
   route as Scripture Notes and ScripturePlus took. Note Lumen already sidesteps this —
   OpenBible cross-references + curated collections replace the IRI footnote apparatus,
   and public-domain scripture text exports exist (bencrowder.net, scriptures.nephi.org —
   minus chapter headers/BD, which are IRI's).

## 6. Fact-check ledger (adversarial verify pass)

- **MISREAD (corrected above):** "no notice through Apr 1974 → first notice Oct 1974."
  Re-fetch showed notices from **Apr 1972** (OCR double-spacing defeated the original
  grep). PD-no-notice ceiling = **October 1971 conference**; acting on the wrong boundary
  would have meant infringing validly noticed 1972–1974 works.
- **CONFIRMED:** Conference Report never renewed (0 hits, complete NYPL CCE dataset);
  Improvement Era renewals 1954–1963 real; ToU anti-scraping + entity clauses verbatim;
  Norton's on-camera "does not license their conference talks" quote; SN FAQ quotes
  (with staleness caveat: FAQ dateModified 2025-03-13 — the May-2026 video is the current
  statement and agrees); IRI guidelines + permissions-portal language; ScripturePlus 2016
  license statement; Davies fair-use posture; bryanwhiting repo bundling text
  (hazard); the 56-years arithmetic.

## 7. Sources (primary, fetched)

IRI guidelines PDF PD80015646 · churchofjesuschrist.org/legal/terms · permissions
portal · Liahona masthead (© IRI, "incidental, noncommercial church or home use") ·
scripturenotes.com (FAQ + Wayback 2019/2026, homepage, GC-engine announcement, ToS,
compare page) · launch video PeUjKbZD0xM transcript (yt-dlp, fetched twice) · r/lds
launch thread (pullpush) · lds-general-conference.org copyright + texts pages ·
scriptureplus.org/about · Church Newsroom on BYU SCI · archive.org Conference Report
scans + metadata (Church History Library uploads) · NYPL/cce-renewals full dataset ·
UPenn periodical-renewal census · HathiTrust bib API · official sitemap index (5,611 GC
URLs) · robots.txt · GitHub: qhspencer, lukejoneslj, johnmwood, bryanwhiting · HF
zorbalee dataset card · openscriptureapi.org · scriptures.nephi.org · archived Church
tech-forum threads t=30587/t=39793.

Unverifiable/unreached: Stanford renewal DB (bot-blocked; NYPL+UPenn cover the ground),
Ensign 1971–1977 notices (no scans found — this is the 1971 gray zone), whether Scripture
Notes quietly obtained a GC license in 2026 (their public statements say no), BYU SCI's
arrangement with the Church, live talk-page © footer (client-side rendered).
