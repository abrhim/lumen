-- Indexes matching packages/scripture/src/schema.ts (Drizzle names, so
-- drizzle-kit sees the DB as in sync). Ingestion scripts create tables
-- without indexes; run this after bulk loads.

-- verses
-- idx_verses_chapter/idx_verses_volume index the pre-canon-spine transition
-- columns (book_id, chapter_number, volume_id); P4 of the spine migration
-- drops those columns and the indexes with them.
CREATE INDEX IF NOT EXISTS idx_verses_chapter ON lumen.verses (book_id, chapter_number, verse_number);
CREATE INDEX IF NOT EXISTS idx_verses_chapter_id ON lumen.verses (chapter_id, verse_number);
CREATE INDEX IF NOT EXISTS idx_verses_reference ON lumen.verses (reference);
CREATE INDEX IF NOT EXISTS idx_verses_volume ON lumen.verses (volume_id);
CREATE INDEX IF NOT EXISTS idx_verses_search ON lumen.verses USING gin (search_vector);

-- words
-- (verse_id, position) is already indexed by the table's UNIQUE constraint;
-- idx_words_normalized is created by ingest-words.mjs after the bulk load,
-- listed here only so this file stays the full index inventory.
CREATE INDEX IF NOT EXISTS idx_words_normalized ON lumen.words (normalized);

-- entities
CREATE INDEX IF NOT EXISTS idx_entities_type ON lumen.entities (entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_type_id ON lumen.entities (entity_type, id);
CREATE INDEX IF NOT EXISTS idx_entities_collection ON lumen.entities (collection_id);
CREATE INDEX IF NOT EXISTS idx_entities_search ON lumen.entities USING gin (search_vector);

-- edges
CREATE INDEX IF NOT EXISTS idx_edges_from ON lumen.edges (from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON lumen.edges (to_id);
CREATE INDEX IF NOT EXISTS idx_edges_rel_type ON lumen.edges (rel_type);
CREATE INDEX IF NOT EXISTS idx_edges_from_rel ON lumen.edges (from_id, rel_type);
-- incoming mirror of idx_edges_from_rel (cross-ref "referenced by" lookups);
-- also created by ingest-openbible-refs.mjs post-bulk-load
CREATE INDEX IF NOT EXISTS idx_edges_to_rel ON lumen.edges (to_id, rel_type);
CREATE INDEX IF NOT EXISTS idx_edges_collection ON lumen.edges (collection_id);
