-- Enrichment review overlay (docs/design/media-collections.md B-scope,
-- Abram 2026-07-18; approved for build 2026-08-19).
--
-- The governing invariant: A PIPELINE RE-RUN MUST NEVER WIPE A HUMAN'S
-- REVIEW DECISION. Extraction rebuilds edges wholesale — load-extraction
-- DELETEs every `${collection}-extraction` edge for an episode and
-- re-INSERTs it — so a decision stored in the edge's own metadata would
-- survive exactly until the next ingest. This table is the source of
-- truth; the loader MATERIALIZES its verdict back into the edge jsonb so
-- read paths stay join-free and re-extraction re-applies it automatically.
--
-- Identity is the mention, not the edge: one timestamped claim inside
-- metadata.mentions[]. The edge half of the key is exactly the four
-- columns of idx_edges_unique (lumen.edges has no primary key), plus the
-- utterance seq that locates the claim inside the episode.
--
-- Access follows the highlights precedent (20260802000000_highlights.sql):
-- the DATABASE enforces the path rather than discipline. lumen_read — the
-- app's SELECT-only production credential — gets NOTHING here, so the
-- review page cannot accidentally read decisions over Hyperdrive, whose
-- ~60s read cache is what made a roadmap vote read back as zero on
-- 2026-08-01. Admin reads and writes ride the caller's own PostgREST
-- client under the RLS policy below; the pipeline connects as admin.

create table if not exists lumen.enrichment_reviews (
	from_id       text not null,
	to_id         text not null,
	rel_type      text not null,
	collection_id text not null,
	mention_seq   integer not null,
	status        text not null,
	reviewer      uuid references auth.users(id) on delete set null,
	note          text,
	reviewed_at   timestamptz not null default now(),
	constraint enrichment_reviews_pkey
		primary key (from_id, to_id, rel_type, collection_id, mention_seq),
	-- mirrors roadmap_features_state_check, the house enum idiom.
	-- 'pending' is storable so a NOTE can exist without a verdict — Abram
	-- flags a claim for the next tuning round without having to accept or
	-- reject it first. Absence of a row still means untouched.
	constraint enrichment_reviews_status_check
		check (status in ('accepted', 'rejected', 'pending')),
	constraint enrichment_reviews_collection_id_fkey
		foreign key (collection_id) references lumen.collections(id)
);

-- The backlog is ABSENCE, never rows: a queue that stored a row per
-- unreviewed mention (~8k for Unshaken alone, more every ingest) would
-- drift the moment extraction produced a new claim. Absence cannot drift.
-- A stored 'pending' means something narrower and deliberate — "noted,
-- not yet decided".

-- note: Abram's feedback on a claim, read when tuning the next extraction
-- round. It rides the decision, so it survives re-ingest for the same
-- reason the decision does.

-- the queue's own access pattern: everything a collection has decided
create index if not exists idx_enrichment_reviews_collection
	on lumen.enrichment_reviews (collection_id, status);
-- the materializer's pattern: one episode's decisions, during load
create index if not exists idx_enrichment_reviews_from
	on lumen.enrichment_reviews (from_id);

-- The entitlement check runs INSIDE the policy, so it executes as the
-- calling role — and `authenticated` holds no grant on lumen.user_roles or
-- lumen.roles, which made the policy's own subquery see nothing and deny
-- every read (caught by e2e before this shipped: the write landed and the
-- reload showed it pending). A SECURITY DEFINER function is the house
-- answer to exactly this (lumen.roadmap_vote is the precedent) — it lets
-- the check see the grant tables without granting the client anything.
create or replace function lumen.has_entitlement(key text)
returns boolean
language sql
stable
security definer
-- pinned: a SECURITY DEFINER function without a fixed search_path is
-- resolvable by whatever the caller puts in front of it
set search_path = pg_catalog, lumen
as $$
	select exists (
		select 1
		from lumen.user_roles ur
		join lumen.roles r on r.slug = ur.role_slug
		where ur.user_id = (select auth.uid())
			and key = any(r.entitlements)
	);
$$;
revoke all on function lumen.has_entitlement(text) from public;
grant execute on function lumen.has_entitlement(text) to authenticated;

alter table lumen.enrichment_reviews enable row level security;

-- One policy, entitlement-checked. Deliberately NOT role-slug-checked:
-- entitlements are the app's gate (requireEntitlement / admin.collections),
-- and a second, differently-shaped notion of "admin" in SQL is how the two
-- drift apart.
drop policy if exists enrichment_reviews_admin_all on lumen.enrichment_reviews;
create policy enrichment_reviews_admin_all on lumen.enrichment_reviews
	for all
	to authenticated
	using (lumen.has_entitlement('admin.collections'))
	with check (lumen.has_entitlement('admin.collections'));

grant select, insert, update, delete on lumen.enrichment_reviews to authenticated;
-- and explicitly NOT to lumen_read: see the header.
revoke all on lumen.enrichment_reviews from lumen_read;
