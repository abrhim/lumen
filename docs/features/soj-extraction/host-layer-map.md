# Host layer (phase 3) — conventions map

Generated 2026-08-18 by recon over entity/edge/search/node conventions.

## 1. lumen.entities conventions for person rows

- Table (baseline.sql:58-67): id text PK, entity_type NOT NULL, name NOT NULL,
  description, metadata jsonb default {}, source, collection_id FK →
  lumen.collections, search_vector tsvector.
- **search_vector is TRIGGER-maintained** (trg_entities_search_vector BEFORE
  INSERT/UPDATE OF name, description): setweight(name,'A') ||
  setweight(description+kjv_delta,'B'). Safe to omit on insert.
- Live person id formats (seed.sql:10031-10056): bare disambiguated slugs —
  `jesus-christ`, `moses-1`, `jacob-patriarch-1`. Id regex contract:
  migrate-entity-rename.mjs:53 → /^[a-z0-9][a-z0-9:-]*$/.
- Person metadata in use: {role, time_period, significance, disambiguation}.
- Canonical upsert shape: backfill-phase-b.ts:321-330 (8-column list,
  ON CONFLICT (id) DO UPDATE guarded by collection); batch idiom:
  ingest-art-catalog.mjs:99-112 (jsonb_to_recordset).

## 2. rel_type + source vocabularies

- Graph traversal allowlist — packages/scripture/src/graph/get-neighborhood.ts:24-28
  GRAPH_REL_TYPES includes FEATURES and APPEARS_IN. Anything not listed is
  invisible to ?graph=1.
- UI label map — node.tsx:55-68 REL_LABELS includes FEATURES. Unknown types
  fall through humanize() (lowercase with spaces; incoming suffixed ←).
- Extraction mapping — extract-lib.mjs:431-438 REL_BY_KIND:
  verse|chapter→DISCUSSES, person|place|event→MENTIONS, principle→TEACHES.
- source strings (complete): lds-doc-project, strongs, naves, 1867-jst,
  anthropic-batch (ALL phase-b entities+edges), openbible, learnofchrist,
  `${collection_id}-youtube`, `${collection_id}-extraction`. metadata.source
  is a SEPARATE namespace ('title'|'extraction'|'ai-generated'|...).
- idx_edges_unique (from,to,rel,collection). edges have NO PK/FK — deletes
  manual, orphans possible.

## 3. node.tsx render gates (the traps)

- "In scripture": to_id=id AND source='anthropic-batch' joined to verses.
- "In {collection}" (episode/quote section): source = collection_id||'-extraction'
  ONLY, and jb(metadata).mentions has NO null guard (node.tsx:165-166) — an
  edge matching the source without mentions[] 500s the page.
- "Connections": (from_id=id OR to_id=id) AND source='anthropic-batch' — a
  curated host edge with any other source renders NOTHING unless the :100
  predicate is widened.
- collectionGroups payload (:200-206): {id,name,total,quotes[],lensEpisode};
  quotes are 6 evenly-sampled mentions with 3-row transcript windows; section
  skipped when total===0; per-collection canViewCollection gate.
- HONEST path for host episodes: add a fifth query (episode→person edges by
  rel_type, joined to content_item entities) + a new "Episodes" section —
  avoids the mentions landmine entirely.
- Routing: routes.ts:35 ":type/:id"; TYPE_SLUGS person→people duplicated in
  node.tsx:29-36, media.tsx:33-40, search.tsx:476-483.
- media.tsx margin rail only selects MENTIONS/TEACHES with source=-extraction —
  host edges won't appear there without a change.

## 4. Person searchability

- NO search_index row involved: people are searched live off lumen.entities
  via entityLeg (search.ts:371-427). WHERE entity_type=ANY AND
  collection_id=ANY(visible) AND (ILIKE|trigram|tsv).
- **collection_id NULL = unsearchable.** Host persons must sit in a public
  collection (their show collection works).
- Ranking boosted by lumen.entity_degree (full-refresh projection,
  migrate-search-projections.mjs:70-71); missing row = degree 0, no error.

## 5. Script precedent to imitate

- **materialize-art-edges.mjs is the template**: curated exported constant
  with selection rationale; PURE exported builder (buildArtEdges) unit-tested
  incl. an ids-exist-in-snapshot test; runner with --dry-run (DRY_RUN_ROLLBACK
  in sql.begin), session-mode assert (rejects :6543), one transaction, scoped
  DELETE before INSERT, in-tx orphan invariant, migration_state ledger upsert,
  structured log lines.
- entity-renames escrow pattern (migrate-entity-rename.mjs) for careful
  mutations; smoke-*.mjs post-verification convention.
- New collections must ALSO register in apps/web/app/lib/collection-display.ts
  or render nowhere (fail-closed).
- Neo4j has no mirror path for hand-added entities — hosts degrade in ?graph=1
  by design (openbible/art precedent).
- seed.sql/baseline are GENERATED — never hand-add rows there.
