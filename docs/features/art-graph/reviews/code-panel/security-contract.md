# CODE-PANEL review — security+api-contract (combined) — art-graph

Reviewed `art-impl.diff`, `apps/web/app/lib/art.ts`, `apps/web/app/components/ArtImage.tsx`,
`apps/web/app/routes/scripture.art.tsx`, `apps/web/app/routes/scripture.tsx`,
`scripts/materialize-art-edges.mjs`, `scripts/smoke-art-edges.mjs`,
`scripts/__tests__/art-edges.test.mjs`, and `packages/scripture/src/slug-map.ts`, against plan
amendments 1–10.

## Verified clean, for the record

- **`safeHttpUrl` gates the actual sanitization point (amendment 4/SEC-1/SEC-2), and it's stronger
  than the plan literally asked for.** SEC-1's requested fix was a "render-time allowlist helper
  shared by strip + gallery"; the implementation instead sanitizes once at construction —
  `toArtItem` (`apps/web/app/lib/art.ts:44-56`) runs every `thumb`/`image`/`sourceUrl` through
  `safeHttpUrl` before an `ArtItem` ever exists. That means every downstream consumer inherits
  clean data automatically, including one the plan/panel-1 didn't explicitly enumerate: `PanelBody`
  in `scripture.tsx` (verse-panel art thumbnails, line 839) still does the old
  `href={a.sourceUrl || a.image}` pattern verbatim, but `a` there is the same sanitized `ArtItem`
  array (`verseArt`, filtered from the loader's `art: (artRows ?? []).map(toArtItem)`,
  `scripture.tsx:407,536-548`) — so it is not exploitable despite looking identical to the
  pre-fix strip. See CSC-1 for the residual (non-security) gap this leaves.
- **`ART_PERSON_MAP` ids containing `:` (e.g. `person:moses-1`) have no routing/URL implications.**
  The graph overlay's `GRAPH_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/` (`scripture.tsx:163`)
  already accepts colons, and `graphUrl()` builds the `?graph=` param via `URLSearchParams`
  (`scripture.tsx:506-511`), which percent-encodes `:` automatically — this predates art-graph
  (canon-spine's phase-b `{type}:{id}` namespacing) and the new FEATURES edges don't add a new
  exposure.
- **Delete scope matches the public contract exactly.** `materialize-art-edges.mjs:791-793`:
  `DELETE FROM lumen.edges WHERE collection_id = 'art' AND rel_type IN ('DEPICTS', 'FEATURES')` —
  identical to the plan's stated scope, not broadened to all of `lumen.edges`.
  `scripts/smoke-art-edges.mjs` and `materialize-art-edges.mjs` both use only tagged-template
  (`sql\`...\``) or `tx.json(...)`-bound queries; the one dynamic value ever interpolated into a
  raw string is a hardcoded `'120s'` timeout literal, not user/catalog input — no injection
  surface.
- **Session-mode probe + DSN scrubbing follow the canon-spine precedent correctly.**
  `materialize-art-edges.mjs` rejects port 6543, calls the imported `assertSessionMode(sql)` before
  any write, and routes every caught error through the imported `scrub()` before logging
  (`:747-750, 822-824`); `smoke-art-edges.mjs` does the same for its read-only connection.
- **SEC-4 (collection visibility) is implemented as panel-2 required:** `UPDATE lumen.collections
  SET public = true WHERE id = 'art'` runs inside the same transaction as the edge
  delete/insert (`materialize-art-edges.mjs:790`), matching the "explicit, not schema-default"
  precedent from `ingest-openbible-refs.mjs`.
- **`ArtItem.fame` is nullable and `pickArtStack` sorts nulls-last (amendment 7/API-1)** — matches
  the interface and the gallery's SQL-side `ORDER BY (metadata->>'fame')::numeric DESC NULLS LAST`
  in the pre-existing `getChapterArt` (`packages/scripture/src/queries.ts:151-158`, unchanged by
  this diff), so the loader doesn't need to (and doesn't) re-sort.
- **`ArtImage` is a real shared export (amendment 7/API-5)**, not three copies — used identically by
  `ChapterArtStack`, the gallery route, and `PanelBody`.

## Findings

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| CSC-1 | Low | `apps/web/app/routes/scripture.tsx:839` (`PanelBody`) | `<a href={a.sourceUrl \|\| a.image}>` renders unconditionally; if both sanitize to `""` it becomes `href=""` (unexpected same-page nav), unlike the gallery's `href ? <a> : <div>` fallback. | Reuse the gallery's conditional pattern: skip the wrapping `<a>` (or use `safeHttpUrl` truthiness) when neither field yields a URL. |
| CSC-2 | Medium | `packages/scripture/src/__tests__/slug-map.test.ts:87-91` | Amendment 7 calls for an "exhaustive membership test" for `RELATIONSHIP_TYPES`; the existing test only asserts `TEACHES`, `CROSS_REF`, and `length > 5` — `DEPICTS` (or any future addition) can silently regress untested. | Add `expect(RELATIONSHIP_TYPES).toContain('DEPICTS')`, or assert the full array equals the expected literal list. |
| CSC-3 | Medium | `scripts/materialize-art-edges.mjs:120,779-781` (`buildArtEdges` + `main`) | `skipped[]` mixes ref-bound skips with `FEATURES`/person-missing skips, but the 2%-cap denominator `totalRefs` only counts `refs.length` — mismatched scope vs amendment 5's ref-only cap, and mislabels the `art_edges_skipped_refs` count. | Track person-missing skips in a separate array/counter, excluded from the ref skip-ratio and logged under its own event or field. |
| CSC-4 | Low | `scripts/materialize-art-edges.mjs:666-676` (`put()` merge) | Range union only fires when both the existing and incoming edge already have a `range_start`; a single-verse cite (`range_start: null`) merged with a later overlapping multi-verse ref for the same verse never picks up the range metadata. | In `put()`, also union when exactly one side has `range_start` (treat the null side as a single-point range at that verse) instead of requiring both truthy. |
