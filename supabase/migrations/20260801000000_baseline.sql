-- Baseline schema for the lumen local stack.
-- Generated from production by scripts/dump-schema.mjs — do not hand-edit;
-- regenerate instead so local can never silently drift from prod.
-- Excludes: auth/storage/realtime/vault (Supabase provisions those itself).

-- ── extensions ─────────────────────────────────────────────
create extension if not exists "pg_trgm" with schema extensions;
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "unaccent" with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- ── schema + roles ─────────────────────────────────────────
create schema if not exists lumen;
-- the app's SELECT-only production credential; recreated locally so GRANTs below resolve
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'lumen_read') then
    create role lumen_read login password 'lumen_read';
  end if;
end $$;

-- ── tables ─────────────────────────────────────────────────
create table if not exists lumen.books (
  id text not null,
  volume_id text not null,
  name text not null,
  abbrev text,
  sort_order integer not null
);
create table if not exists lumen.chapters (
  id text not null,
  book_id text not null,
  number integer not null
);
create table if not exists lumen.collections (
  id text not null,
  name text not null,
  description text,
  tier text not null,
  category text not null,
  provenance text not null,
  license text not null,
  storage text not null,
  owner_id uuid,
  public boolean default true not null,
  toggleable boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists lumen.edges (
  from_id text not null,
  to_id text not null,
  rel_type text not null,
  collection_id text not null,
  metadata jsonb default '{}'::jsonb not null,
  source text,
  created_at timestamp with time zone default now() not null
);
create table if not exists lumen.entities (
  id text not null,
  entity_type text not null,
  name text not null,
  description text,
  metadata jsonb default '{}'::jsonb,
  source text,
  collection_id text,
  search_vector tsvector
);
create table if not exists lumen.entity_degree (
  entity_id text not null,
  degree integer not null
);
create table if not exists lumen.kjv_variants (
  variant text not null,
  modern text not null
);
create table if not exists lumen.migration_state (
  key text not null,
  value jsonb not null,
  at timestamp with time zone default now() not null
);
create table if not exists lumen.note_anchors (
  note_id uuid not null,
  owner_id uuid default auth.uid() not null,
  kind text not null,
  ref_id text not null,
  created_at timestamp with time zone default now() not null
);
create table if not exists lumen.notes (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  body_md text default ''::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone,
  search tsvector generated always as (to_tsvector('english'::regconfig, COALESCE(body_md, ''::text))) stored,
  title_line text generated always as ("left"(split_part(body_md, '
'::text, 1), 120)) stored
);
create table if not exists lumen.roadmap_features (
  id text not null,
  title text not null,
  detail text,
  state text default 'proposed'::text not null,
  sort_order integer,
  created_at timestamp with time zone default now() not null,
  started_at timestamp with time zone,
  shipped_at timestamp with time zone
);
create table if not exists lumen.roadmap_votes (
  feature_id text not null,
  voter_id uuid not null,
  count integer default 1 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table if not exists lumen.roles (
  slug text not null,
  label text not null,
  entitlements text[] default '{}'::text[] not null,
  created_at timestamp with time zone default now() not null
);
create table if not exists lumen.search_index (
  kind text not null,
  ref_id text not null,
  collection_id text,
  title text not null,
  tsv tsvector not null,
  payload jsonb default '{}'::jsonb not null
);
create table if not exists lumen.strongs_lexicon (
  strongs_no text not null,
  lang text not null,
  translit text,
  gloss text,
  definition text,
  original text
);
create table if not exists lumen.transcripts (
  episode_id text not null,
  seq integer not null,
  t_start_s numeric(9,3) not null,
  t_end_s numeric(9,3),
  speaker text,
  text text not null,
  search_vector tsvector generated always as (to_tsvector('english'::regconfig, text)) stored
);
create table if not exists lumen.user_roles (
  user_id uuid not null,
  role_slug text not null,
  granted_at timestamp with time zone default now() not null,
  granted_by uuid
);
create table if not exists lumen.verses (
  id text not null,
  verse_number integer not null,
  text text not null,
  reference text not null,
  search_vector tsvector,
  chapter_id text not null
);
create table if not exists lumen.volumes (
  id text not null,
  name text not null,
  abbrev text,
  tradition text not null,
  source text,
  sort_order integer not null
);
create table if not exists lumen.word_tags (
  word_id text not null,
  strongs text[] not null,
  morph text
);
create table if not exists lumen.words (
  id text not null,
  verse_id text not null,
  position integer not null,
  surface text not null,
  normalized text not null,
  char_start integer not null,
  char_end integer not null
);

-- ── constraints ────────────────────────────────────────────
alter table lumen.books add constraint books_pkey PRIMARY KEY (id);
alter table lumen.books add constraint books_volume_id_sort_order_key UNIQUE (volume_id, sort_order);
alter table lumen.chapters add constraint chapters_book_id_number_key UNIQUE (book_id, number);
alter table lumen.chapters add constraint chapters_number_check CHECK ((number > 0));
alter table lumen.chapters add constraint chapters_pkey PRIMARY KEY (id);
alter table lumen.collections add constraint collections_pkey PRIMARY KEY (id);
alter table lumen.entities add constraint entities_pkey PRIMARY KEY (id);
alter table lumen.entity_degree add constraint entity_degree_degree_check CHECK ((degree >= 0));
alter table lumen.entity_degree add constraint entity_degree_pkey PRIMARY KEY (entity_id);
alter table lumen.kjv_variants add constraint kjv_variants_check CHECK (((modern <> ''::text) AND (modern <> variant)));
alter table lumen.kjv_variants add constraint kjv_variants_pkey PRIMARY KEY (variant);
alter table lumen.kjv_variants add constraint kjv_variants_variant_check CHECK (((variant = lower(variant)) AND (variant <> ''::text)));
alter table lumen.migration_state add constraint migration_state_pkey PRIMARY KEY (key);
alter table lumen.note_anchors add constraint note_anchors_kind_check CHECK ((kind = ANY (ARRAY['verse'::text, 'chapter'::text, 'entity'::text, 'transcript'::text])));
alter table lumen.note_anchors add constraint note_anchors_pkey PRIMARY KEY (note_id, kind, ref_id);
alter table lumen.note_anchors add constraint note_anchors_ref_id_check CHECK ((char_length(ref_id) <= 128));
alter table lumen.notes add constraint notes_body_size CHECK ((octet_length(body_md) <= 65536));
alter table lumen.notes add constraint notes_id_owner_uniq UNIQUE (id, owner_id);
alter table lumen.notes add constraint notes_pkey PRIMARY KEY (id);
alter table lumen.roadmap_features add constraint roadmap_detail_len CHECK ((char_length(detail) <= 500));
alter table lumen.roadmap_features add constraint roadmap_features_pkey PRIMARY KEY (id);
alter table lumen.roadmap_features add constraint roadmap_features_state_check CHECK ((state = ANY (ARRAY['proposed'::text, 'planned'::text, 'building'::text, 'shipped'::text, 'declined'::text])));
alter table lumen.roadmap_features add constraint roadmap_id_shape CHECK ((id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text));
alter table lumen.roadmap_features add constraint roadmap_title_len CHECK ((char_length(title) <= 120));
alter table lumen.roadmap_votes add constraint roadmap_votes_count_cap CHECK (((count >= 1) AND (count <= 3)));
alter table lumen.roadmap_votes add constraint roadmap_votes_pkey PRIMARY KEY (feature_id, voter_id);
alter table lumen.roles add constraint roles_pkey PRIMARY KEY (slug);
alter table lumen.search_index add constraint search_index_pkey PRIMARY KEY (kind, ref_id);
alter table lumen.strongs_lexicon add constraint strongs_lexicon_pkey PRIMARY KEY (strongs_no);
alter table lumen.transcripts add constraint transcripts_pkey PRIMARY KEY (episode_id, seq);
alter table lumen.user_roles add constraint user_roles_pkey PRIMARY KEY (user_id, role_slug);
alter table lumen.verses add constraint verses_pkey PRIMARY KEY (id);
alter table lumen.volumes add constraint volumes_pkey PRIMARY KEY (id);
alter table lumen.volumes add constraint volumes_tradition_sort_order_key UNIQUE (tradition, sort_order);
alter table lumen.word_tags add constraint word_tags_pkey PRIMARY KEY (word_id);
alter table lumen.words add constraint words_pkey PRIMARY KEY (id);
alter table lumen.words add constraint words_position_check CHECK (("position" > 0));
alter table lumen.words add constraint words_verse_id_position_key UNIQUE (verse_id, "position");
alter table lumen.books add constraint books_volume_id_fkey FOREIGN KEY (volume_id) REFERENCES lumen.volumes(id);
alter table lumen.chapters add constraint chapters_book_id_fkey FOREIGN KEY (book_id) REFERENCES lumen.books(id);
alter table lumen.edges add constraint edges_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES lumen.collections(id);
alter table lumen.entities add constraint entities_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES lumen.collections(id);
alter table lumen.note_anchors add constraint note_anchors_note_owner_fk FOREIGN KEY (note_id, owner_id) REFERENCES lumen.notes(id, owner_id) ON DELETE CASCADE;
alter table lumen.notes add constraint notes_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table lumen.roadmap_votes add constraint roadmap_votes_feature_id_fkey FOREIGN KEY (feature_id) REFERENCES lumen.roadmap_features(id) ON DELETE CASCADE;
alter table lumen.search_index add constraint search_index_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES lumen.collections(id);
alter table lumen.transcripts add constraint transcripts_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES lumen.entities(id) ON DELETE CASCADE;
alter table lumen.user_roles add constraint user_roles_role_slug_fkey FOREIGN KEY (role_slug) REFERENCES lumen.roles(slug) ON DELETE CASCADE;
alter table lumen.verses add constraint verses_chapter_fk FOREIGN KEY (chapter_id) REFERENCES lumen.chapters(id);
alter table lumen.word_tags add constraint word_tags_word_id_fkey FOREIGN KEY (word_id) REFERENCES lumen.words(id) ON DELETE CASCADE;
alter table lumen.words add constraint words_verse_id_fkey FOREIGN KEY (verse_id) REFERENCES lumen.verses(id);

-- ── views ──────────────────────────────────────────────────
create or replace view lumen.app_users with (security_invoker=false) as
SELECT id,
    COALESCE(email, ''::character varying) AS email,
    raw_user_meta_data ->> 'name'::text AS display_name,
    raw_user_meta_data ->> 'full_name'::text AS full_name,
    COALESCE(created_at, '1970-01-01 00:00:00+00'::timestamp with time zone) AS created_at,
    COALESCE(last_sign_in_at, '1970-01-01 00:00:00+00'::timestamp with time zone) AS last_sign_in_at,
    email_confirmed_at IS NOT NULL AS is_confirmed,
    banned_until IS NOT NULL AND banned_until > now() AS is_banned,
    COALESCE(is_anonymous, false) AS is_anonymous,
    deleted_at IS NOT NULL AS is_deleted
   FROM auth.users u;

create or replace view lumen.nodes as
SELECT volumes.id,
    'volume'::text AS kind,
    volumes.name
   FROM lumen.volumes
UNION ALL
 SELECT books.id,
    'book'::text AS kind,
    books.name
   FROM lumen.books
UNION ALL
 SELECT chapters.id,
    'chapter'::text AS kind,
    chapters.id AS name
   FROM lumen.chapters
UNION ALL
 SELECT verses.id,
    'verse'::text AS kind,
    verses.reference AS name
   FROM lumen.verses
UNION ALL
 SELECT words.id,
    'word'::text AS kind,
    words.surface AS name
   FROM lumen.words
UNION ALL
 SELECT entities.id,
    entities.entity_type AS kind,
    entities.name
   FROM lumen.entities;

-- ── indexes ────────────────────────────────────────────────
CREATE INDEX idx_chapters_book ON lumen.chapters USING btree (book_id, number);
CREATE INDEX idx_edges_collection ON lumen.edges USING btree (collection_id);
CREATE INDEX idx_edges_from ON lumen.edges USING btree (from_id);
CREATE INDEX idx_edges_from_rel ON lumen.edges USING btree (from_id, rel_type);
CREATE UNIQUE INDEX idx_edges_phaseb_unique ON lumen.edges USING btree (from_id, to_id, rel_type) WHERE (collection_id = 'phase-b'::text);
CREATE INDEX idx_edges_rel_type ON lumen.edges USING btree (rel_type);
CREATE INDEX idx_edges_to ON lumen.edges USING btree (to_id);
CREATE INDEX idx_edges_to_rel ON lumen.edges USING btree (to_id, rel_type);
CREATE UNIQUE INDEX idx_edges_unshaken_unique ON lumen.edges USING btree (from_id, to_id, rel_type) WHERE (collection_id = 'unshaken'::text);
CREATE INDEX idx_entities_collection ON lumen.entities USING btree (collection_id);
CREATE INDEX idx_entities_name_trgm ON lumen.entities USING gin (name gin_trgm_ops);
CREATE INDEX idx_entities_search ON lumen.entities USING gin (search_vector);
CREATE INDEX idx_entities_type ON lumen.entities USING btree (entity_type);
CREATE INDEX idx_entities_type_id ON lumen.entities USING btree (entity_type, id);
CREATE INDEX idx_note_anchors_owner_ref ON lumen.note_anchors USING btree (owner_id, kind, ref_id);
CREATE INDEX idx_notes_owner_recent ON lumen.notes USING btree (owner_id, updated_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX idx_notes_search ON lumen.notes USING gin (search) WHERE (deleted_at IS NULL);
CREATE INDEX roadmap_votes_feature_idx ON lumen.roadmap_votes USING btree (feature_id);
CREATE INDEX idx_search_coll ON lumen.search_index USING btree (collection_id);
CREATE INDEX idx_search_title_trgm ON lumen.search_index USING gin (title gin_trgm_ops);
CREATE INDEX idx_search_tsv ON lumen.search_index USING gin (tsv);
CREATE INDEX idx_transcripts_search ON lumen.transcripts USING gin (search_vector);
CREATE INDEX idx_verses_chapter_id ON lumen.verses USING btree (chapter_id, verse_number);
CREATE INDEX idx_verses_reference ON lumen.verses USING btree (reference);
CREATE INDEX idx_verses_search ON lumen.verses USING gin (search_vector);
CREATE INDEX idx_word_tags_strongs ON lumen.word_tags USING gin (strongs);
CREATE INDEX idx_words_normalized ON lumen.words USING btree (normalized);

-- ── functions ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lumen.create_note_with_anchors(p_body_md text, p_anchors jsonb DEFAULT '[]'::jsonb)
 RETURNS lumen.notes
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_note lumen.notes;
BEGIN
  INSERT INTO lumen.notes (body_md) VALUES (p_body_md) RETURNING * INTO v_note;
  INSERT INTO lumen.note_anchors (note_id, owner_id, kind, ref_id)
  SELECT v_note.id, v_note.owner_id, a.value->>'kind', a.value->>'ref_id'
  FROM jsonb_array_elements(coalesce(p_anchors, '[]'::jsonb)) AS a
  ON CONFLICT DO NOTHING;
  RETURN v_note;
END
$function$
;

CREATE OR REPLACE FUNCTION lumen.kjv_delta(t text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT coalesce(string_agg(v.modern, ' '), '')
  FROM regexp_split_to_table(lower(coalesce(t, '')), '[^a-z]+') AS w(word)
  JOIN lumen.kjv_variants v ON v.variant = w.word
$function$
;

CREATE OR REPLACE FUNCTION lumen.roadmap_stamp_state()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
	IF NEW.state = 'building' AND NEW.started_at IS NULL THEN NEW.started_at := now(); END IF;
	IF NEW.state = 'shipped' AND NEW.shipped_at IS NULL THEN NEW.shipped_at := now(); END IF;
	RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION lumen.roadmap_unvote(p_feature_id text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE new_count int;
BEGIN
	UPDATE lumen.roadmap_votes
	SET count = count - 1, updated_at = now()
	WHERE feature_id = p_feature_id AND voter_id = (SELECT auth.uid()) AND count > 1
	RETURNING count INTO new_count;
	IF new_count IS NULL THEN
		DELETE FROM lumen.roadmap_votes
		WHERE feature_id = p_feature_id AND voter_id = (SELECT auth.uid());
		new_count := 0;
	END IF;
	RETURN new_count;
END $function$
;

CREATE OR REPLACE FUNCTION lumen.roadmap_vote(p_feature_id text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE new_count int;
BEGIN
	INSERT INTO lumen.roadmap_votes (feature_id, voter_id, count)
	VALUES (p_feature_id, (SELECT auth.uid()), 1)
	ON CONFLICT (feature_id, voter_id)
	DO UPDATE SET count = LEAST(lumen.roadmap_votes.count + 1, 3), updated_at = now()
	RETURNING count INTO new_count;
	RETURN new_count;
END $function$
;

CREATE OR REPLACE FUNCTION lumen.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$function$
;

CREATE OR REPLACE FUNCTION lumen.soft_delete_note(p_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE lumen.notes SET deleted_at = now()
  WHERE id = p_id
    AND owner_id = auth.uid()
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$function$
;

CREATE OR REPLACE FUNCTION lumen.update_entity_search_vector()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.search_vector := setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A')
                    || setweight(to_tsvector('english',
                         coalesce(NEW.description, '') || ' ' || lumen.kjv_delta(NEW.description)), 'B');
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION lumen.update_verse_search_vector()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.text, ''))
                    || to_tsvector('english', lumen.kjv_delta(NEW.text));
  RETURN NEW;
END;
$function$
;

-- ── triggers ───────────────────────────────────────────────
CREATE TRIGGER trg_entities_search_vector BEFORE INSERT OR UPDATE OF name, description ON lumen.entities FOR EACH ROW EXECUTE FUNCTION lumen.update_entity_search_vector();
CREATE TRIGGER notes_set_updated_at BEFORE UPDATE ON lumen.notes FOR EACH ROW EXECUTE FUNCTION lumen.set_updated_at();
CREATE TRIGGER roadmap_stamp_state BEFORE INSERT OR UPDATE ON lumen.roadmap_features FOR EACH ROW EXECUTE FUNCTION lumen.roadmap_stamp_state();
CREATE TRIGGER trg_verses_search_vector BEFORE INSERT OR UPDATE OF text ON lumen.verses FOR EACH ROW EXECUTE FUNCTION lumen.update_verse_search_vector();

-- ── row level security ─────────────────────────────────────
alter table lumen.books enable row level security;
alter table lumen.chapters enable row level security;
alter table lumen.collections enable row level security;
alter table lumen.edges enable row level security;
alter table lumen.entities enable row level security;
alter table lumen.note_anchors enable row level security;
alter table lumen.notes enable row level security;
alter table lumen.roadmap_features enable row level security;
alter table lumen.roadmap_votes enable row level security;
alter table lumen.strongs_lexicon enable row level security;
alter table lumen.verses enable row level security;
alter table lumen.volumes enable row level security;
alter table lumen.word_tags enable row level security;
alter table lumen.words enable row level security;

create policy "books_read" on lumen.books
  as permissive for select to public
  using (true);
create policy "chapters_read" on lumen.chapters
  as permissive for select to public
  using (true);
create policy "collections_public_read" on lumen.collections
  as permissive for select to public
  using (true);
create policy "edges_public_read" on lumen.edges
  as permissive for select to public
  using (true);
create policy "entities_public_read" on lumen.entities
  as permissive for select to public
  using (true);
create policy "note_anchors_delete" on lumen.note_anchors
  as permissive for delete to authenticated
  using ((owner_id = ( SELECT auth.uid() AS uid)));
create policy "note_anchors_insert" on lumen.note_anchors
  as permissive for insert to authenticated
  with check ((owner_id = ( SELECT auth.uid() AS uid)));
create policy "note_anchors_select" on lumen.note_anchors
  as permissive for select to authenticated
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM lumen.notes n
  WHERE ((n.id = note_anchors.note_id) AND (n.deleted_at IS NULL))))));
create policy "notes_delete" on lumen.notes
  as permissive for delete to authenticated
  using ((owner_id = ( SELECT auth.uid() AS uid)));
create policy "notes_insert" on lumen.notes
  as permissive for insert to authenticated
  with check ((owner_id = ( SELECT auth.uid() AS uid)));
create policy "notes_select" on lumen.notes
  as permissive for select to authenticated
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (deleted_at IS NULL)));
create policy "notes_update" on lumen.notes
  as permissive for update to authenticated
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (deleted_at IS NULL)))
  with check ((owner_id = ( SELECT auth.uid() AS uid)));
create policy "roadmap_features_select" on lumen.roadmap_features
  as permissive for select to anon, authenticated, lumen_read
  using (true);
create policy "roadmap_votes_delete" on lumen.roadmap_votes
  as permissive for delete to authenticated
  using ((voter_id = ( SELECT auth.uid() AS uid)));
create policy "roadmap_votes_insert" on lumen.roadmap_votes
  as permissive for insert to authenticated
  with check ((voter_id = ( SELECT auth.uid() AS uid)));
create policy "roadmap_votes_read_server" on lumen.roadmap_votes
  as permissive for select to lumen_read
  using (true);
create policy "roadmap_votes_select" on lumen.roadmap_votes
  as permissive for select to authenticated
  using ((voter_id = ( SELECT auth.uid() AS uid)));
create policy "roadmap_votes_update" on lumen.roadmap_votes
  as permissive for update to authenticated
  using ((voter_id = ( SELECT auth.uid() AS uid)))
  with check ((voter_id = ( SELECT auth.uid() AS uid)));
create policy "strongs_lexicon_read" on lumen.strongs_lexicon
  as permissive for select to public
  using (true);
create policy "verses_public_read" on lumen.verses
  as permissive for select to public
  using (true);
create policy "volumes_read" on lumen.volumes
  as permissive for select to public
  using (true);
create policy "word_tags_read" on lumen.word_tags
  as permissive for select to public
  using (true);
create policy "words_read" on lumen.words
  as permissive for select to public
  using (true);

-- ── grants ─────────────────────────────────────────────────
grant usage on schema lumen to anon, authenticated, service_role, lumen_read;
grant select on lumen.app_users to lumen_read;
grant select on lumen.books to lumen_read;
grant select on lumen.chapters to lumen_read;
grant select on lumen.collections to lumen_read;
grant select on lumen.edges to lumen_read;
grant select on lumen.entities to lumen_read;
grant select on lumen.entity_degree to lumen_read;
grant select on lumen.kjv_variants to lumen_read;
grant select on lumen.migration_state to lumen_read;
grant select on lumen.nodes to lumen_read;
grant delete, select on lumen.note_anchors to authenticated;
grant select on lumen.notes to authenticated;
grant select on lumen.roadmap_features to anon;
grant select on lumen.roadmap_features to authenticated;
grant select on lumen.roadmap_features to lumen_read;
grant delete, insert, select, update on lumen.roadmap_votes to authenticated;
grant select on lumen.roadmap_votes to lumen_read;
grant select on lumen.roles to lumen_read;
grant select on lumen.search_index to lumen_read;
grant select on lumen.strongs_lexicon to lumen_read;
grant select on lumen.transcripts to lumen_read;
grant select on lumen.user_roles to lumen_read;
grant select on lumen.verses to lumen_read;
grant select on lumen.volumes to lumen_read;
grant select on lumen.word_tags to lumen_read;
grant select on lumen.words to lumen_read;

grant insert (note_id, owner_id, kind, ref_id) on lumen.note_anchors to authenticated;
grant insert (body_md) on lumen.notes to authenticated;
grant update (body_md, deleted_at) on lumen.notes to authenticated;

grant execute on function lumen.create_note_with_anchors(p_body_md text, p_anchors jsonb) to authenticated;
grant execute on function lumen.roadmap_unvote(p_feature_id text) to authenticated;
grant execute on function lumen.roadmap_vote(p_feature_id text) to authenticated;
grant execute on function lumen.soft_delete_note(p_id uuid) to authenticated;
