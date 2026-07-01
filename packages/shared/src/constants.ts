export const ENTITY_TYPES = [
	"volume",
	"book",
	"chapter",
	"chapter_summary",
	"principle",
	"person",
	"place",
	"symbol",
	"event",
	"strongs_word",
	"naves_topic",
	"jst_reading",
	"cfm_week",
	"content_source",
	"content_item",
	"content_segment",
	"content_book",
	"content_chapter",
	"content_section",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const COLLECTION_TIERS = ["canon", "app", "community", "personal"] as const;
export type CollectionTier = (typeof COLLECTION_TIERS)[number];

export const COLLECTION_CATEGORIES = [
	"scripture",
	"reference",
	"commentary",
	"hymns",
	"formatting",
	"personal",
] as const;
export type CollectionCategory = (typeof COLLECTION_CATEGORIES)[number];

export const EDGE_TYPES = [
	"TEACHES",
	"MENTIONS",
	"CROSS_REF",
	"HAS_SYMBOL",
	"LOCATED_AT",
	"TYPIFIES",
	"FULFILLED_BY",
	"PARENT_OF",
	"RELATED_TO",
	"IN_CHAPTER",
	"IN_BOOK",
	"IN_VOLUME",
	"HAS_SUMMARY",
	"HAS_JST",
	"USES_WORD",
	"HAS_LEMMA",
	"ROOT_OF",
	"REFERENCES",
	"MAPS_TO",
	"ASSIGNS",
	"EMPHASIZES",
	"QUOTES",
	"PART_OF",
	"FROM_SOURCE",
	"ANCHORED_TO",
	"DISCUSSES",
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];
