# Code panel — engine (correctness + data-integrity + security)

Feature: strongs. Reviewed diff `strongs-impl.diff`, full files
`scripts/ingest-strongs.mjs`, `packages/scripture/src/strongs.ts`,
`scripts/smoke-strongs.mjs`, against plan amendments 1–5 (`docs/features/strongs/plan.md`).
Dry-run stats cited by the task (738,569 tags, 93.5% coverage, 219 skips /
0.70%) reflect the CURRENT code — CE-1 below is a silent-correctness bug the
dry-run numbers cannot surface (it never touches tag count or coverage).

## Verified NOT bugs (traps 1, 2, 3, 4, 5, 7-partial, 8)

- **Trap 1 (nested `<w>`):** confirmed empirically against the vendored
  `data/strongs/kjvfull.xml` — 357,343 `<w …>` matches via the exact parser
  regex, **zero** contain a nested `<w ` in their captured inner text. Not
  live. It IS structurally fragile (a true nested `<w>` would truncate at the
  inner `</w>`, silently merging the inner word's text into the outer span
  under the outer's lemma and dropping trailing text) — see CE-3.
- **Trap 2 (cross-span join):** the join rule (`ingest-strongs.mjs:~185-192`)
  only fires within one span's token list. A compound word split across two
  DIFFERENT spans ("can"|"not") fails `tokensMatch` and returns `{ok:false}`
  — the whole verse is skipped and counted, never partial-guessed. Correctly
  folds into the bounded 219/0.70% skip bucket, not silently wrong.
- **Trap 3 (SPELLING_EQUIV direction):** both call sites in
  `alignSpansToWords` (`ingest-strongs.mjs:169`, `:178`) pass `(sourceToken,
  ourWord)` — consistent with the table's KJV2006→ours direction. No reversed
  call found.
- **Trap 4 (verse milestones):** verified against the real file: 31,102
  `osisID` opens, 31,102 `eID` closes, zero duplicate osisIDs, and for every
  match the literal text immediately after the captured span's `<verse
  eID="` equals that verse's own osisID (checked programmatically, 0
  mismatches). Not live. The regex still never validates the eID value
  against the sID's osisID in code — a source update introducing an
  out-of-order or missing eID would silently merge two verses' spans with no
  error. Documented as fragility, not filed as its own CE given zero
  evidence of it occurring and the 1% skip cap as a partial backstop.
- **Trap 5 (GROUP BY array, strongs_no source):** `GROUP BY` on `text[]`
  is legal (arrays have an equality operator). `getWordTags`
  (`packages/scripture/src/strongs.ts:24`) emits `'strongs_no', s.no` (the
  unnest value), not `l.strongs_no` — confirmed correct per FM-10: a missing
  lexicon row still returns the number with null translit/gloss/definition.
- **Trap 7 (header guard):** `parseLexiconLine` rejects TBESH's real header
  row (`eStrong#\tdStrong\t...`) because `normalizeStrongs("eStrong#")`
  fails the `[HGhg]` prefix match, independent of the `cols.length < 8`
  guard. H/G number spaces are disjoint (no cross-file collision found).
- **Trap 8 (param regex):** `^[HG]\d{1,5}[A-Z]?$` matches every canonical
  form `normalizeStrongs` can produce; verified against real suffixed
  entries (e.g. `H1254A`). No caching headers on `/api/strongs/:no` is fine
  — on-demand fetcher call, not in the critical path.

## Confirmed bugs

| ID | Severity | Where | Problem (≤25 words) | Fix (≤30 words) |
|---|---|---|---|---|
| CE-1 | Critical | `scripts/ingest-strongs.mjs:278` `const lexByNo = new Map(lexRows.map((r) => [r.strongs_no, r]))` | Last-write-wins silently drops 948/9,345 Hebrew + 109/10,847 Greek base entries' correct gloss for numbers with multiple TBESH/TBESG sub-rows. **H430 "God" ships as "(Gibeath)-elohim"; H7225 "beginning" ships as "first: best"; H1 "father" ships as "father of [Gibeon]".** Not caught by smoke test (no gloss assertions) or unit tests. | Use first-occurrence-wins (`if (!lexByNo.has(r.strongs_no)) lexByNo.set(...)`) — verified against real data that the FIRST TBESH/TBESG row per number is always the base sense; later rows are proper-noun/derived sub-entries. |
| CE-2 | High | `apps/web/app/routes/scripture.tsx:1082-1087` `useEffect(() => { if (primary && alsoIn.state === "idle") alsoIn.load(...) }, [tag.word_id])` | Rapidly tapping word A then word B before A's fetch resolves: effect fires for B but `alsoIn.state` is still `"loading"` (from A), so `.load()` for B is skipped. When A's fetch later resolves, A's "Also in" verse list renders under B's WordStudyCard — factually wrong cross-references shown silently, no error/degraded state. | Drop the `alsoIn.state === "idle"` gate — always call `alsoIn.load(...)` on `tag.word_id` change (React Router's fetcher supersedes in-flight loads), or key the fetcher per word. |
| CE-3 | Low | `scripts/ingest-strongs.mjs:67` `const wRe = /<w\s([^>]*?)(?:\/>\|>([\s\S]*?)<\/w>)/g;` | Non-greedy `[\s\S]*?` closes at the FIRST `</w>`; a true nested `<w>` (none exist in the vendored 25MB source today — verified) would merge the inner word's text into the outer span under the outer's lemma and silently drop trailing text, not just skip. | Add a defensive check (inner content contains no unmatched `<w`) that aborts/skips the span rather than truncating silently, or assert span/word counts reconcile per verse. |
| CE-4 | Low | `scripts/ingest-strongs.mjs` DDL block (`CREATE TABLE IF NOT EXISTS lumen.word_tags ... REFERENCES lumen.words(id) ON DELETE CASCADE`) | `IF NOT EXISTS` won't retrofit `ON DELETE CASCADE` (or any future schema change) onto a table created by an earlier script version. Already documented in the file header comment, not enforced in code. | Add a startup check (`information_schema` lookup on the FK's `delete_rule`) that fails loudly if the live constraint doesn't match, instead of relying on the comment. |

## Notes for the reviewer

- CE-1 is the standout finding: it is live in the vendored data (not
  speculative), affects some of the highest-frequency Strong's numbers in
  the corpus (H430 "God" alone appears constantly across the OT), and is
  invisible to every existing check — dry-run coverage/skip stats, the 9
  passing unit tests in `scripts/__tests__/strongs.test.mjs`, and
  `smoke-strongs.mjs` (which asserts `strongs` array membership and morph
  for its canaries but never asserts gloss/definition content). Recommend
  blocking the live ingest until fixed and re-verified against a wider
  sample of duplicated numbers (948 Hebrew + 109 Greek).
- CE-2 doesn't corrupt data at rest — it's a client-side rendering bug in
  `WordStudyCard` — but it directly undermines the feature's core promise
  (identity of the tapped word) with no error surfaced to the user.
