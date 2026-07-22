/**
 * Db-free leaf for the federated-search public shapes (B18).
 *
 * `search.ts` carries `drizzle-orm` (the SQL legs + `searchAll`), so any client
 * module that pulls `GROUP_KEYS`/result types out of it drags an ~18.5 kB gzip
 * dead drizzle chunk onto the `/search` hydration path. These declarations have
 * zero drizzle dependency, so a client that imports them from this leaf subpath
 * (`@lumen/scripture/search-types`) reaches a module graph with no drizzle at
 * all. `search.ts` re-exports everything here, so the barrel surface and every
 * existing consumer are unchanged.
 */

export const GROUP_KEYS = [
	'scripture',
	'people',
	'places',
	'topics',
	'episodes',
	'art',
	'words',
] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export type ResultType =
	| 'verse'
	| 'jst'
	| 'person'
	| 'place'
	| 'topic'
	| 'principle'
	| 'symbol'
	| 'event'
	| 'era'
	| 'summary'
	| 'episode'
	| 'moment'
	| 'artwork'
	| 'strongs';

/** Which result types each group may contain (API-4: two enums, exported). */
export const GROUP_RESULT_TYPES: Record<GroupKey, ResultType[]> = {
	scripture: ['verse', 'jst'],
	people: ['person'],
	places: ['place'],
	topics: ['topic', 'principle', 'symbol', 'event', 'era', 'summary'],
	episodes: ['episode', 'moment'],
	art: ['artwork'],
	words: ['strongs'],
};

export interface SearchOptions {
	q: string;
	visibleCollections: string[];
	scope?: GroupKey[];
	limitPerGroup?: number;
	/** Opaque keyset cursor from a prior page's `nextCursor`. Honored only when
	 * `scope` is exactly one group (the route 400s `cursor_scope` otherwise). */
	after?: string;
}

export interface SearchResult {
	type: ResultType;
	/**
	 * Durable for verse/entity/episode/artwork/strongs. MOMENT ids are
	 * RESPONSE-SCOPED (re-keyed on every M3 re-window) — never persist, cache,
	 * or deep-link one; deep-link via payload episode_id + t_start_s (APIC-6).
	 */
	id: string;
	title: string;
	/** Plain text with ⟪⟫ highlight markers — never HTML (API-1). */
	snippet?: string;
	tier: number;
	score: number;
	payload: Record<string, unknown>;
}

export interface SearchGroup {
	key: GroupKey;
	results: SearchResult[];
	/** Present ONLY when this page is full (`results.length === limitPerGroup`)
	 * — a short or empty page is the end of the set (F5). */
	nextCursor?: string;
}

/** Parse + existence only — never embedded verse arrays (API-2). */
export interface SearchReference {
	level: 'volume' | 'book' | 'chapter' | 'verse';
	book_id?: string;
	chapter?: number;
	verse?: number;
	verse_id?: string;
	display: string;
	found: boolean;
}

export interface SearchGroupMeta {
	/** Wall-clock leg ms. Only measurable in fallback mode (one statement per
	 * group); in combined mode a single statement serves every group, so this
	 * is null and meta.totalMs is the authoritative latency (PER-5/OBS-4). */
	ms: number | null;
	hits: number;
	error?: string;
}

export interface SearchMeta {
	perGroup: Record<string, SearchGroupMeta>;
	totalMs: number;
	mode: 'combined' | 'fallback' | 'none';
	/** Why the combined statement failed, when mode === 'fallback' — without it
	 * a combined-only failure class degrades every request silently (OBS-2). */
	combinedError?: string;
}

export interface SearchResponse {
	query: string;
	reference: SearchReference | null;
	groups: SearchGroup[];
	meta: SearchMeta;
}
