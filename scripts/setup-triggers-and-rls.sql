-- Search vector triggers (auto-populate on INSERT/UPDATE)

CREATE OR REPLACE FUNCTION lumen.update_verse_search_vector() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', NEW.text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_verses_search_vector ON lumen.verses;
CREATE TRIGGER trg_verses_search_vector
  BEFORE INSERT OR UPDATE OF text ON lumen.verses
  FOR EACH ROW EXECUTE FUNCTION lumen.update_verse_search_vector();

CREATE OR REPLACE FUNCTION lumen.update_entity_search_vector() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', NEW.name || ' ' || coalesce(NEW.description, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_entities_search_vector ON lumen.entities;
CREATE TRIGGER trg_entities_search_vector
  BEFORE INSERT OR UPDATE OF name, description ON lumen.entities
  FOR EACH ROW EXECUTE FUNCTION lumen.update_entity_search_vector();

-- RLS: public read on all scripture tables

ALTER TABLE lumen.verses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS verses_public_read ON lumen.verses;
CREATE POLICY verses_public_read ON lumen.verses FOR SELECT USING (true);

ALTER TABLE lumen.entities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entities_public_read ON lumen.entities;
CREATE POLICY entities_public_read ON lumen.entities FOR SELECT USING (true);

ALTER TABLE lumen.edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS edges_public_read ON lumen.edges;
CREATE POLICY edges_public_read ON lumen.edges FOR SELECT USING (true);

ALTER TABLE lumen.collections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS collections_public_read ON lumen.collections;
CREATE POLICY collections_public_read ON lumen.collections FOR SELECT USING (true);

ALTER TABLE lumen.words ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS words_public_read ON lumen.words;
CREATE POLICY words_public_read ON lumen.words FOR SELECT USING (true);
