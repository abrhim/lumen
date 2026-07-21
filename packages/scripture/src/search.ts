import { sql } from 'drizzle-orm';
import type { Db } from './types';
import { parseReference, buildVerseId } from './slug-map';

/**
 * Typed federated search (search-endpoint plan v2, decision 1–7).
 *
 * Groups are returned separately — no cross-group score blending. Every
 * non-canon source row is collection-gated via `visibleCollections` (the
 * caller derives it; authorization state never lives in this layer). Canon
 * verses are always visible by design.
 *
 * Execution: one combined UNION ALL statement (single round trip — statements
 * on one connection serialize, PER-3); on failure, a per-group fallback with
 * error isolation (a failed group degrades to empty results + meta.error,
 * never a throw — COR-1/H17).
 *
 * postgres.js trap (API-6): jsonb/numeric can arrive as strings — every row
 * passes through coerceRow() before leaving this module.
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
}

export interface SearchResult {
	type: ResultType;
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
	ms: number;
	hits: number;
	error?: string;
}

export interface SearchMeta {
	perGroup: Record<string, SearchGroupMeta>;
	totalMs: number;
	mode: 'combined' | 'fallback' | 'none';
}

export interface SearchResponse {
	query: string;
	reference: SearchReference | null;
	groups: SearchGroup[];
	meta: SearchMeta;
}

const HEADLINE_OPTS = 'StartSel=⟪, StopSel=⟫, MaxFragments=1, MaxWords=18';
const WEIGHTS = '{0.1,0.2,0.4,1.0}';
const TRGM_MIN = 0.45;

/** Literal semantics for user text inside ILIKE patterns (SEC-5/kedrec). */
export function escapeLike(s: string): string {
	return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

/** Drizzle expands JS arrays into tuples — pass sets as one param via
 * string_to_array. Ids never contain commas; empty set → NULL → fail-closed. */
function anyOf(values: string[]) {
	return sql`string_to_array(NULLIF(${values.join(',')}, ''), ',')`;
}

function clampLimit(n: number | undefined): number {
	if (n === undefined || Number.isNaN(n)) return 8;
	return Math.max(1, Math.min(25, Math.floor(n)));
}

/* ─── Reference short-circuit (decision 4 / COR-6) ─── */

async function resolveSearchReference(
	db: Db,
	q: string,
): Promise<{ reference: SearchReference | null; shortCircuit: boolean }> {
	const parsed = parseReference(q);
	if (parsed.level === 'unknown') return { reference: null, shortCircuit: false };

	if (parsed.level === 'volume' || parsed.level === 'book') {
		// Bare names ("john") are real content words: reference AND full FTS.
		return {
			reference: {
				level: parsed.level,
				book_id: parsed.bookId,
				display: parsed.raw,
				found: true,
			},
			shortCircuit: false,
		};
	}

	if (parsed.level === 'chapter') {
		const rows = (await db.execute(
			sql`SELECT b.name FROM lumen.chapters c
			    JOIN lumen.books b ON b.id = c.book_id
			    WHERE c.book_id = ${parsed.bookId} AND c.number = ${parsed.chapter} LIMIT 1`,
		)) as Array<{ name: string }>;
		if (rows.length === 0) return { reference: null, shortCircuit: false };
		return {
			reference: {
				level: 'chapter',
				book_id: parsed.bookId,
				chapter: parsed.chapter,
				display: `${rows[0].name} ${parsed.chapter}`,
				found: true,
			},
			shortCircuit: true,
		};
	}

	// verse level
	const verseId = buildVerseId(parsed.bookId!, parsed.chapter!, parsed.verse!);
	const rows = (await db.execute(
		sql`SELECT id, reference FROM lumen.verses WHERE id = ${verseId} LIMIT 1`,
	)) as Array<{ id: string; reference: string }>;
	if (rows.length === 0) return { reference: null, shortCircuit: false };
	return {
		reference: {
			level: 'verse',
			book_id: parsed.bookId,
			chapter: parsed.chapter,
			verse: parsed.verse,
			verse_id: rows[0].id,
			display: rows[0].reference,
			found: true,
		},
		shortCircuit: true,
	};
}

/* ─── Per-group SQL legs ─── */

type Leg = { key: GroupKey; query: ReturnType<typeof sql> };

/** Guard for historically double-encoded jsonb metadata (A2 latent-bug class). */
const META = sql`CASE WHEN jsonb_typeof(e.metadata) = 'string'
	THEN (e.metadata #>> '{}')::jsonb ELSE coalesce(e.metadata, '{}'::jsonb) END`;

function tsq(q: string) {
	return sql`websearch_to_tsquery('english', ${q})`;
}

function scriptureLeg(q: string, visible: string[], limit: number): ReturnType<typeof sql> {
	return sql`
	SELECT 'scripture' AS grp, s.type, s.id, s.title,
	  CASE WHEN s.snip_src = '' THEN NULL
	       ELSE ts_headline('english', s.snip_src, ${tsq(q)}, ${HEADLINE_OPTS}) END AS snippet,
	  s.tier, s.score, s.payload
	FROM (
	  SELECT * FROM (
	    SELECT 'verse' AS type, v.id, v.reference AS title, v.text AS snip_src,
	      3 AS tier, 0 AS sub,
	      ts_rank(${WEIGHTS}::float4[], v.search_vector, ${tsq(q)}, 1)::float8 AS score,
	      jsonb_build_object('verse_id', v.id) AS payload
	    FROM lumen.verses v
	    WHERE v.search_vector @@ ${tsq(q)}
	    UNION ALL
	    SELECT 'jst', e.id, e.name, coalesce(e.description, ''),
	      3, 1,
	      ts_rank(${WEIGHTS}::float4[], e.search_vector, ${tsq(q)}, 1)::float8,
	      jsonb_build_object('verse_id', ${META} ->> 'verse_id', 'variant', 'jst')
	    FROM lumen.entities e
	    WHERE e.entity_type = 'jst_reading'
	      AND e.collection_id = ANY(${anyOf(visible)})
	      AND e.search_vector @@ ${tsq(q)}
	  ) u
	  ORDER BY u.tier, u.sub, u.score DESC, u.id
	  LIMIT ${limit}
	) s`;
}

function entityLeg(
	key: GroupKey,
	types: string[],
	q: string,
	visible: string[],
	limit: number,
): ReturnType<typeof sql> {
	const prefix = escapeLike(q) + '%';
	return sql`
	SELECT ${key} AS grp, s.type, s.id, s.title,
	  CASE WHEN s.snip_src = '' THEN NULL
	       ELSE ts_headline('english', s.snip_src, ${tsq(q)}, ${HEADLINE_OPTS}) END AS snippet,
	  s.tier, s.score, s.payload
	FROM (
	  SELECT
	    CASE e.entity_type
	      WHEN 'naves_topic' THEN 'topic'
	      WHEN 'chapter_summary' THEN 'summary'
	      ELSE e.entity_type END AS type,
	    e.id, e.name AS title, coalesce(e.description, '') AS snip_src,
	    CASE WHEN lower(e.name) = lower(${q}) THEN 1
	         WHEN e.name ILIKE ${prefix} ESCAPE '\\'
	           OR (${q} OPERATOR(extensions.%) e.name
	               AND extensions.word_similarity(${q}, e.name) >= ${TRGM_MIN}) THEN 2
	         ELSE 3 END AS tier,
	    0 AS sub,
	    ((1 + ln(1 + coalesce(d.degree, 0)))
	      * GREATEST(
	          ts_rank(${WEIGHTS}::float4[], e.search_vector, ${tsq(q)}, 1),
	          CASE WHEN ${q} OPERATOR(extensions.%) e.name
	               THEN extensions.word_similarity(${q}, e.name) ELSE 0 END
	        ))::float8 AS score,
	    CASE WHEN e.entity_type = 'chapter_summary'
	      THEN jsonb_build_object(
	        'book_id', regexp_replace(e.id, '^summary-(.*)-[0-9]+$', '\\1'),
	        'chapter', (regexp_replace(e.id, '^.*-([0-9]+)$', '\\1'))::int)
	      ELSE '{}'::jsonb END AS payload
	  FROM lumen.entities e
	  LEFT JOIN lumen.entity_degree d ON d.entity_id = e.id
	  WHERE e.entity_type = ANY(${anyOf(types)})
	    AND e.collection_id = ANY(${anyOf(visible)})
	    AND (lower(e.name) = lower(${q})
	      OR e.name ILIKE ${prefix} ESCAPE '\\'
	      OR (${q} OPERATOR(extensions.%) e.name
	          AND extensions.word_similarity(${q}, e.name) >= ${TRGM_MIN})
	      OR e.search_vector @@ ${tsq(q)})
	  ORDER BY tier, sub, score DESC, id
	  LIMIT ${limit}
	) s`;
}

function episodesLeg(q: string, visible: string[], limit: number): ReturnType<typeof sql> {
	const prefix = escapeLike(q) + '%';
	return sql`
	SELECT 'episodes' AS grp, s.type, s.id, s.title,
	  CASE WHEN s.snip_src = '' THEN NULL
	       ELSE ts_headline('english', s.snip_src, ${tsq(q)}, ${HEADLINE_OPTS}) END AS snippet,
	  s.tier, s.score, s.payload
	FROM (
	  SELECT si.kind AS type, si.ref_id AS id, si.title,
	    CASE WHEN si.kind = 'moment' THEN coalesce(si.payload ->> 'text', '') ELSE si.title END AS snip_src,
	    CASE WHEN si.kind = 'episode' AND lower(si.title) = lower(${q}) THEN 1
	         WHEN si.kind = 'episode' AND (si.title ILIKE ${prefix} ESCAPE '\\'
	           OR (${q} OPERATOR(extensions.%) si.title
	               AND extensions.word_similarity(${q}, si.title) >= ${TRGM_MIN})) THEN 2
	         ELSE 3 END AS tier,
	    CASE WHEN si.kind = 'episode' THEN 0 ELSE 1 END AS sub,
	    GREATEST(
	      ts_rank(${WEIGHTS}::float4[], si.tsv, ${tsq(q)}, 1),
	      CASE WHEN si.kind = 'episode' AND ${q} OPERATOR(extensions.%) si.title
	           THEN extensions.word_similarity(${q}, si.title) ELSE 0 END
	    )::float8 AS score,
	    (si.payload - 'text' - 'seq_start' - 'seq_end') AS payload
	  FROM lumen.search_index si
	  WHERE si.kind IN ('episode', 'moment')
	    AND si.collection_id = ANY(${anyOf(visible)})
	    AND (si.tsv @@ ${tsq(q)}
	      OR (si.kind = 'episode' AND (lower(si.title) = lower(${q})
	        OR si.title ILIKE ${prefix} ESCAPE '\\')))
	  ORDER BY tier, sub, score DESC, id
	  LIMIT ${limit}
	) s`;
}

function artLeg(q: string, visible: string[], limit: number): ReturnType<typeof sql> {
	const prefix = escapeLike(q) + '%';
	return sql`
	SELECT 'art' AS grp, s.type, s.id, s.title,
	  NULL::text AS snippet,
	  s.tier, s.score, s.payload
	FROM (
	  SELECT 'artwork' AS type, si.ref_id AS id, si.title,
	    CASE WHEN lower(si.title) = lower(${q}) THEN 1
	         WHEN si.title ILIKE ${prefix} ESCAPE '\\' THEN 2
	         ELSE 3 END AS tier,
	    0 AS sub,
	    ((1 + coalesce((si.payload ->> 'fame')::float8, 0) / 100)
	      * ts_rank(${WEIGHTS}::float4[], si.tsv, ${tsq(q)}, 1))::float8 AS score,
	    (si.payload - 'fame') AS payload
	  FROM lumen.search_index si
	  WHERE si.kind = 'artwork'
	    AND si.collection_id = ANY(${anyOf(visible)})
	    AND (si.tsv @@ ${tsq(q)}
	      OR lower(si.title) = lower(${q})
	      OR si.title ILIKE ${prefix} ESCAPE '\\')
	  ORDER BY tier, sub, score DESC, id
	  LIMIT ${limit}
	) s`;
}

function wordsLeg(q: string, visible: string[], limit: number): ReturnType<typeof sql> {
	return sql`
	SELECT 'words' AS grp, s.type, s.id, s.title,
	  CASE WHEN s.snip_src = '' THEN NULL
	       ELSE ts_headline('english', s.snip_src, ${tsq(q)}, ${HEADLINE_OPTS}) END AS snippet,
	  s.tier, s.score, s.payload
	FROM (
	  SELECT 'strongs' AS type, si.ref_id AS id, si.title,
	    coalesce(si.payload ->> 'gloss', '') AS snip_src,
	    CASE WHEN upper(${q}) = si.ref_id
	           OR lower(extensions.unaccent(coalesce(si.payload ->> 'translit', ''))) = lower(${q})
	         THEN 1 ELSE 3 END AS tier,
	    0 AS sub,
	    ts_rank(${WEIGHTS}::float4[], si.tsv, ${tsq(q)}, 1)::float8 AS score,
	    si.payload AS payload
	  FROM lumen.search_index si
	  WHERE si.kind = 'strongs'
	    AND si.collection_id = ANY(${anyOf(visible)})
	    AND (si.tsv @@ ${tsq(q)} OR upper(${q}) = si.ref_id)
	  ORDER BY tier, sub, score DESC, id
	  LIMIT ${limit}
	) s`;
}

function buildLegs(scope: GroupKey[], q: string, visible: string[], limit: number): Leg[] {
	const legs: Leg[] = [];
	for (const key of scope) {
		if (key === 'scripture') legs.push({ key, query: scriptureLeg(q, visible, limit) });
		else if (key === 'people') legs.push({ key, query: entityLeg('people', ['person'], q, visible, limit) });
		else if (key === 'places') legs.push({ key, query: entityLeg('places', ['place'], q, visible, limit) });
		else if (key === 'topics')
			legs.push({
				key,
				query: entityLeg(
					'topics',
					['naves_topic', 'principle', 'symbol', 'event', 'era', 'chapter_summary'],
					q,
					visible,
					limit,
				),
			});
		else if (key === 'episodes') legs.push({ key, query: episodesLeg(q, visible, limit) });
		else if (key === 'art') legs.push({ key, query: artLeg(q, visible, limit) });
		else if (key === 'words') legs.push({ key, query: wordsLeg(q, visible, limit) });
	}
	return legs;
}

/* ─── Row post-processing ─── */

interface RawRow {
	grp: string;
	type: string;
	id: string;
	title: string;
	snippet: string | null;
	tier: number | string;
	score: number | string;
	payload: unknown;
}

function coerceRow(r: RawRow): SearchResult {
	let payload: Record<string, unknown> =
		typeof r.payload === 'string' ? JSON.parse(r.payload) : ((r.payload ?? {}) as Record<string, unknown>);
	for (const k of ['t_start_s', 't_end_s', 'chapter', 'year']) {
		if (payload[k] !== undefined && payload[k] !== null) payload[k] = Number(payload[k]);
	}
	return {
		type: r.type as ResultType,
		id: r.id,
		title: r.title,
		snippet: r.snippet ?? undefined,
		tier: Number(r.tier),
		score: Number(r.score),
		payload,
	};
}

/** Deterministic within-group order: tier, jst-after-canon, score desc, id (COR-4/REL-5). */
function sortResults(results: SearchResult[]): SearchResult[] {
	return results.sort((a, b) => {
		if (a.tier !== b.tier) return a.tier - b.tier;
		const aSub = a.type === 'jst' || a.type === 'moment' ? 1 : 0;
		const bSub = b.type === 'jst' || b.type === 'moment' ? 1 : 0;
		if (aSub !== bSub) return aSub - bSub;
		if (a.score !== b.score) return b.score - a.score;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
}

/* ─── searchAll ─── */

export async function searchAll(db: Db, opts: SearchOptions): Promise<SearchResponse> {
	const t0 = Date.now();
	const q = (opts.q ?? '').trim().slice(0, 200);
	const limit = clampLimit(opts.limitPerGroup);
	const scope: GroupKey[] = opts.scope?.length ? opts.scope : [...GROUP_KEYS];
	const visible = opts.visibleCollections ?? [];

	const groups: SearchGroup[] = scope.map((key) => ({ key, results: [] }));
	const meta: SearchMeta = { perGroup: {}, totalMs: 0, mode: 'none' };
	const byKey = new Map(groups.map((g) => [g.key, g]));

	let reference: SearchReference | null = null;
	if (q.length >= 2) {
		const ref = await resolveSearchReference(db, q);
		reference = ref.reference;
		if (ref.shortCircuit) {
			// Resolvable chapter/verse reference: navigation, not FTS (decision 4).
			for (const key of scope) meta.perGroup[key] = { ms: 0, hits: 0 };
			meta.totalMs = Date.now() - t0;
			return { query: q, reference, groups, meta };
		}
	}

	const legs = buildLegs(scope, q, visible, limit);

	// Primary: one combined statement, one round trip (PER-3).
	try {
		let combined = sql`SELECT * FROM ((${legs[0].query})`;
		for (let i = 1; i < legs.length; i++) {
			combined = sql`${combined} UNION ALL (${legs[i].query})`;
		}
		combined = sql`${combined}) AS federated`;
		const rows = (await db.execute(combined)) as RawRow[];
		const ms = Date.now() - t0;
		for (const row of rows) {
			byKey.get(row.grp as GroupKey)?.results.push(coerceRow(row));
		}
		for (const g of groups) {
			sortResults(g.results);
			meta.perGroup[g.key] = { ms, hits: g.results.length };
		}
		meta.mode = 'combined';
		meta.totalMs = ms;
		return { query: q, reference, groups, meta };
	} catch {
		// Fall through to isolated per-group execution (COR-1/H17).
	}

	const settled = await Promise.allSettled(
		legs.map(async (leg) => {
			const s = Date.now();
			const rows = (await db.execute(leg.query)) as RawRow[];
			return { key: leg.key, rows, ms: Date.now() - s };
		}),
	);
	for (let i = 0; i < settled.length; i++) {
		const key = legs[i].key;
		const g = byKey.get(key)!;
		const outcome = settled[i];
		if (outcome.status === 'fulfilled') {
			g.results = sortResults(outcome.value.rows.map(coerceRow));
			meta.perGroup[key] = { ms: outcome.value.ms, hits: g.results.length };
		} else {
			meta.perGroup[key] = {
				ms: 0,
				hits: 0,
				error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
			};
		}
	}
	meta.mode = 'fallback';
	meta.totalMs = Date.now() - t0;
	return { query: q, reference, groups, meta };
}
