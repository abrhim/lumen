import {
	pgTable,
	pgSchema,
	text,
	integer,
	boolean,
	timestamp,
	jsonb,
	index,
	uniqueIndex,
	customType,
	uuid,
	numeric,
	primaryKey,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
	dataType() {
		return "tsvector";
	},
});

export const lumen = pgSchema("lumen");

// ─── Verses ────────────────────────────────────────────────────

export const verses = lumen.table(
	"verses",
	{
		id: text("id").primaryKey(),
		volumeId: text("volume_id").notNull(),
		bookId: text("book_id").notNull(),
		chapterNumber: integer("chapter_number").notNull(),
		verseNumber: integer("verse_number").notNull(),
		text: text("text").notNull(),
		reference: text("reference").notNull(),
		searchVector: tsvector("search_vector"),
	},
	(t) => [
		index("idx_verses_chapter").on(t.bookId, t.chapterNumber, t.verseNumber),
		index("idx_verses_reference").on(t.reference),
		index("idx_verses_volume").on(t.volumeId),
		index("idx_verses_search").using("gin", t.searchVector),
	],
);

// ─── Words ─────────────────────────────────────────────────────

export const words = lumen.table(
	"words",
	{
		id: text("id").primaryKey(),
		verseId: text("verse_id")
			.notNull()
			.references(() => verses.id),
		position: integer("position").notNull(),
		surfaceForm: text("surface_form").notNull(),
		normalized: text("normalized").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => [
		index("idx_words_verse_position").on(t.verseId, t.position),
		index("idx_words_normalized").on(t.normalized),
	],
);

// ─── Collections ───────────────────────────────────────────────

export const collections = lumen.table("collections", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	description: text("description"),
	tier: text("tier").notNull(),
	category: text("category").notNull(),
	provenance: text("provenance").notNull(),
	license: text("license").notNull(),
	storage: text("storage").notNull(),
	ownerId: uuid("owner_id"),
	public: boolean("public").default(true).notNull(),
	toggleable: boolean("toggleable").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Entities ──────────────────────────────────────────────────

export const entities = lumen.table(
	"entities",
	{
		id: text("id").primaryKey(),
		entityType: text("entity_type").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		metadata: jsonb("metadata"),
		source: text("source"),
		collectionId: text("collection_id").references(() => collections.id),
		searchVector: tsvector("search_vector"),
	},
	(t) => [
		index("idx_entities_type").on(t.entityType),
		index("idx_entities_type_id").on(t.entityType, t.id),
		index("idx_entities_collection").on(t.collectionId),
		index("idx_entities_search").using("gin", t.searchVector),
	],
);

// ─── Edges ─────────────────────────────────────────────────────

export const edges = lumen.table(
	"edges",
	{
		fromId: text("from_id").notNull(),
		toId: text("to_id").notNull(),
		relType: text("rel_type").notNull(),
		collectionId: text("collection_id")
			.notNull()
			.references(() => collections.id),
		metadata: jsonb("metadata").default({}).notNull(),
		source: text("source"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => [
		index("idx_edges_from").on(t.fromId),
		index("idx_edges_to").on(t.toId),
		index("idx_edges_rel_type").on(t.relType),
		index("idx_edges_from_rel").on(t.fromId, t.relType),
		index("idx_edges_collection").on(t.collectionId),
	],
);

// ─── Transcripts (media substrate — media-collections §rules-2) ──
// DDL applied by scripts/migrate-media-collections.mjs; search_vector is a
// GENERATED column there (drizzle def is read-shape only). NOTE (COR-5):
// postgres.js returns numeric as STRING — Number()-coerce t_start_s/t_end_s
// at every read site.

export const transcripts = lumen.table(
	"transcripts",
	{
		episodeId: text("episode_id")
			.notNull()
			.references(() => entities.id, { onDelete: "cascade" }),
		seq: integer("seq").notNull(),
		tStartS: numeric("t_start_s", { precision: 9, scale: 3 }).notNull(),
		tEndS: numeric("t_end_s", { precision: 9, scale: 3 }),
		speaker: text("speaker"),
		text: text("text").notNull(),
		searchVector: tsvector("search_vector"),
	},
	(t) => [
		primaryKey({ columns: [t.episodeId, t.seq] }),
		index("idx_transcripts_search").using("gin", t.searchVector),
	],
);

// ─── Search index (per-collection weighted projections — §rules-6) ──

export const searchIndex = lumen.table(
	"search_index",
	{
		kind: text("kind").notNull(),
		refId: text("ref_id").notNull(),
		collectionId: text("collection_id").references(() => collections.id),
		title: text("title").notNull(),
		tsv: tsvector("tsv").notNull(),
		payload: jsonb("payload").default({}).notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.kind, t.refId] }),
		index("idx_search_tsv").using("gin", t.tsv),
		index("idx_search_coll").on(t.collectionId),
	],
);
