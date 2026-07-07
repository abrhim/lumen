# Code-panel — correctness (canon-spine)

Reviewed inline (background agent stalled twice). Empirical check run against
prod (read DSN): **0 of 41,995 verses contain any non-ASCII character**, so the
tokenizer's `[A-Za-z0-9]` class loses nothing on the current corpus — including
zero curly apostrophes (the `’`→`'` normalization is inert but harmless).

Verified clean, no findings: postgres.js `IN ${tx(array)}` idiom in
ingest-words (also verified by migration-safety); chapter id collision under
`ON CONFLICT (id) DO NOTHING` impossible (chapter number is an int, so
`{book}-{n}` is injective per book and UNIQUE(book_id,number) can only collide
when the id also collides); `maxChapter === null` fail-open in scripture.tsx is
the intended degraded state (next-link shown rather than falsely hidden);
consumers of rewritten shapes are compatible — resolve-reference.ts uses only
id/name from getBooksByVolume, home.tsx groups/sorts in JS; VERSE_COLUMNS
aliases keep MCP verse shapes byte-stable and reference/search_vector survive
P4; getPassage row-value comparisons are valid PG with bound params.

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| CCOR-1 | High | queries.ts (getChapterNumbers, getChapterSummary, VERSE_SPINE) + plan.md | Rewritten queries read spine tables and stamped metadata.chapter_id that exist only post-P1; deploying web before the prod migration breaks every scripture route. Hazard documented nowhere. | Add explicit ordering to plan.md and migrate-canon-spine.mjs header: "P1 + summary stamping MUST run in prod before any web deploy of this branch." |
| CCOR-2 | Medium | migrate-canon-spine.mjs parityPairs | Parity checks cover volumes, chapter numbers, and one chapter's verses — but not books: the dc synthetic row, sort_order mapping, and volume membership are never diffed old-vs-new. | Add a fourth pair: old distinct verses.book_id (+entities books) vs new lumen.books ids, key-diffed like the others. |
| CCOR-3 | Low | migrate-canon-spine.mjs badBooks check | Pre-check validates volume_id presence, not validity; a book entity naming a volume outside the 5 aborts the tx via raw FK error instead of a named invariant. | Extend the check: filter books whose metadata.volume_id is not in the volumes id set; report offending ids in the named check. |
| CCOR-4 | Low | queries.ts getAllBooks | `ORDER BY sort_order` alone interleaves volumes and ties are nondeterministic (sort_order unique only per volume). home.tsx re-sorts so no user impact today, but the contract is unstable. | `ORDER BY volume_id, sort_order` for a deterministic, volume-grouped default ordering. |
| CCOR-5 | Low | tokenize.ts TOKEN_RE | `[A-Za-z0-9]` silently drops accented/unicode letters mid-word. Zero impact on current corpus (verified 100% ASCII), but the volumes.tradition column exists precisely to admit future non-English texts. | Note the constraint in the tokenize.ts header; when a non-ASCII corpus lands, extend the class (\p{L}\p{N} with u flag) and add a letter-coverage invariant to ingest-words. |
