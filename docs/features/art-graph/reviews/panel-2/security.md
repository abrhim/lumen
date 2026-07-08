# Panel-2 adversarial — security (art-graph)

Verified against `apps/web/app/routes/scripture.tsx` (live) and live data
(4,461 artwork entities, `lumen.entities` via read DSN + the
`~/Downloads/art-database-export/artworks.json` export — both checked,
matched).

## Empirical checks run

1. **URL schemes** — every `source_url`, `image_url`, `thumbnail_800_url`
   across all 4,461 artworks (live DB *and* export file, cross-checked) is
   `https:`; 0 non-http(s) values exist today (9 artworks have a null
   `thumbnail_800_url`, no scheme at all — not malicious).
2. **Verse-range bounds** — 768 verse-level refs checked against live
   per-chapter max verse number: 0 exceed their chapter's actual verse
   count.
3. **Chapter-existence** — all refs checked against live `book_id+chapter`
   pairs in `lumen.chapters`: **16 refs across 4 distinct chapters fail**
   (`dan-13` ×11, `dan-14` ×5 — Susanna / Bel-and-the-Dragon, apocryphal
   Daniel additions not in this canon's 12-chapter Daniel). Real, will hit
   on the very first materialize run, not hypothetical.
4. **Collection `public` flag** — live `art` row is `public: true`, but via
   the `collections.public` column's schema **default** (`true`), not an
   explicit set — confirmed `ingest-art-catalog.mjs`'s
   `INSERT INTO lumen.collections (id, name, description, tier, category,
   provenance, license, storage)` omits `public` from the column list.
   Confirmed `ingest-openbible-refs.mjs` (CSEC-5 precedent) *does* set it
   explicitly in both the insert and the `ON CONFLICT ... DO UPDATE`. All 7
   live collections are `public: true` today (all riding the same default).
5. `scripture.tsx` confirmed: `href={a.sourceUrl || a.image}` (lines 805,
   871) and `src={art.thumb ?? art.image}` (line 829) — no scheme
   validation anywhere in the file, nor anywhere else under `apps/web/app`
   (grepped for `isSafeUrl`/`sanitizeUrl`/scheme checks — none exist).
   `rel="noreferrer"` is present on both anchors (no tabnabbing gap).

## Table

| ID | Tag | Rationale (≤ 25 words) | Stance |
|---|---|---|---|
| SEC-1 | material | Confirmed at both href sites; 0 malicious URLs *today* (curated museum sources), but zero code-level defense and gallery deliberately widens exposure 12→100 (~8x, not "triples"). | Concur, high holds — cheap fix, new public route, defense-in-depth for a supply-chain-latent stored-XSS class. |
| SEC-2 | material | Confirmed same unvalidated pattern at `<img src>`; correctly scoped as low (no javascript: execution via img src in modern browsers, but fallback/phishing risk at scale is real). | Concur as stated. |
| SEC-3 | material | Verse-overflow scenario (0/768 today) doesn't exist in current catalog, but empirical scan found a closely-related, guaranteed-live failure: 16 refs cite nonexistent Daniel 13–14 chapters. | Concur, med holds — likely already caught by the harness's `chapterExists` gate (FM-1 test design generalizes to it), but there is still no test proving verse-level bound-checking, which is the actual gap SEC-3 names. |
| SEC-4 | material | Confirmed omission in `ingest-art-catalog.mjs`'s insert vs. `ingest-openbible-refs.mjs`'s explicit precedent; currently harmless only because schema default happens to already be `true`. | Concur, low holds — no live exposure, pure defense-in-depth/consistency; do it because the codebase already established "explicit not default" as policy, not because of a demonstrated breach. |

## Notes for the human gate

- SEC-3's real near-term trigger is the Daniel 13/14 apocrypha refs, not a
  verse-count overflow — the fix should be verified against this concrete
  case (assert `dan-13`/`dan-14` land in `skipped`, not just a synthetic
  'tobit' book-level case) in addition to the bound-check SEC-3 requests.
- SEC-1's "triples exposure" framing is an understatement (100 vs. strip's
  `slice(0, 12)` is ~8.3x); doesn't change the tag, noted for accuracy.
- No new findings surfaced beyond panel-1's four; all four confirmed
  material against live code and live data.
