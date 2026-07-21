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

const HEADLINE_OPTS = 'StartSel=⟪, StopSel=⟫, MaxFragments=1, MaxWords=18';
const WEIGHTS = '{0.1,0.2,0.4,1.0}';
const TRGM_MIN = 0.45;
/** Name-match arms (prefix ILIKE + trgm) are skipped for q longer than this:
 * a 100+ char q cannot exact/prefix-match any entity name (max 80 live) or
 * fuzzy-clear TRGM_MIN, but its ~2x-per-char trigram set makes the GIN arms
 * scan-heavy (measured ~400ms/leg at 178 chars — PER p95 guard). The planner
 * const-folds char_length(q) per statement, so short queries keep BitmapOr.
 * FTS still serves long queries in full. */
const NAME_ARM_Q_MAX = 100;

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

/** FTS input is token-capped: an OR-of-common-words query at the 200-char q
 * limit rank-scans ~50k verse rows (measured 2.5x the 500ms p95 budget); terms
 * past this bound only widen the rank set. Tier-1/2 name matching and the
 * strongs ref_id arm still see the full q. */
const TSQ_MAX_TOKENS = 12;

function tsqInput(q: string): string {
	const tokens = q.split(/\s+/);
	return tokens.length <= TSQ_MAX_TOKENS ? q : tokens.slice(0, TSQ_MAX_TOKENS).join(' ');
}

function tsq(q: string) {
	return sql`websearch_to_tsquery('english', ${tsqInput(q)})`;
}

/** Headline tsquery for the scripture leg: verses matched only via kjv_delta
 * (believe→believeth, the Gap-1 class) must still carry ⟪⟫ markers, so OR in
 * the archaic variants whose modern form the query reaches. Uncorrelated
 * scalar subquery — the planner evaluates it once per statement. */
function scriptureHeadlineTsq(q: string) {
	return sql`(SELECT coalesce(
	    ${tsq(q)} || to_tsquery('english', string_agg(kv.variant, ' | ')),
	    ${tsq(q)})
	  FROM lumen.kjv_variants kv
	  WHERE to_tsvector('english', kv.modern) @@ ${tsq(q)})`;
}

function scriptureLeg(q: string, visible: string[], limit: number): ReturnType<typeof sql> {
	return sql`
	SELECT 'scripture' AS grp, s.type, s.id, s.title,
	  CASE WHEN s.snip_src = '' THEN NULL
	       ELSE ts_headline('english', s.snip_src, ${scriptureHeadlineTsq(q)}, ${HEADLINE_OPTS}) END AS snippet,
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
	    CASE WHEN char_length(${q}) <= ${NAME_ARM_Q_MAX}
	           AND lower(e.name) = lower(${q}) THEN 1
	         WHEN char_length(${q}) <= ${NAME_ARM_Q_MAX}
	           AND (e.name ILIKE ${prefix} ESCAPE '\\'
	             OR (${q} OPERATOR(extensions.%) e.name
	                 AND extensions.word_similarity(${q}, e.name) >= ${TRGM_MIN})) THEN 2
	         ELSE 3 END AS tier,
	    0 AS sub,
	    ((1 + ln(1 + coalesce(d.degree, 0)))
	      * GREATEST(
	          ts_rank(${WEIGHTS}::float4[], e.search_vector, ${tsq(q)}, 1),
	          CASE WHEN char_length(${q}) <= ${NAME_ARM_Q_MAX}
	                 AND ${q} OPERATOR(extensions.%) e.name
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
	    /* No lower(name)= arm here: the escaped prefix-ILIKE subsumes it, and a
	       non-indexable arm blocks BitmapOr — the A1 GIN prefilter (PER). The
	       tier CASE above still ranks exact matches first. */
	    AND ((char_length(${q}) <= ${NAME_ARM_Q_MAX}
	        AND (e.name ILIKE ${prefix} ESCAPE '\\'
	          OR (${q} OPERATOR(extensions.%) e.name
	              AND extensions.word_similarity(${q}, e.name) >= ${TRGM_MIN})))
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
	           OR (char_length(${q}) <= ${NAME_ARM_Q_MAX}
	               AND extensions.word_similarity(${q}, si.title) >= ${TRGM_MIN})) THEN 2
	         ELSE 3 END AS tier,
	    CASE WHEN si.kind = 'episode' THEN 0 ELSE 1 END AS sub,
	    GREATEST(
	      ts_rank(${WEIGHTS}::float4[], si.tsv, ${tsq(q)}, 1),
	      CASE WHEN si.kind = 'episode' AND char_length(${q}) <= ${NAME_ARM_Q_MAX}
	             AND extensions.word_similarity(${q}, si.title) >= ${TRGM_MIN}
	           THEN extensions.word_similarity(${q}, si.title) ELSE 0 END
	    )::float8 AS score,
	    (si.payload - 'text' - 'seq_start' - 'seq_end') AS payload
	  FROM lumen.search_index si
	  WHERE si.kind IN ('episode', 'moment')
	    AND si.collection_id = ANY(${anyOf(visible)})
	    /* Fuzzy titles use bare word_similarity, NOT the % operator: episode
	       titles are long, so full-string % similarity can never clear its
	       threshold (dead-predicate class — CORC-3). Safe without the trgm
	       index: the arm is anchored to kind='episode', which the pkey bitmap
	       arm serves (rows = episode count, EXPLAIN-verified BitmapOr). */
	    AND (si.tsv @@ ${tsq(q)}
	      OR (si.kind = 'episode' AND (lower(si.title) = lower(${q})
	        OR si.title ILIKE ${prefix} ESCAPE '\\'
	        OR (char_length(${q}) <= ${NAME_ARM_Q_MAX}
	            AND extensions.word_similarity(${q}, si.title) >= ${TRGM_MIN}))))
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
	    CASE WHEN char_length(${q}) <= ${NAME_ARM_Q_MAX}
	           AND lower(si.title) = lower(${q}) THEN 1
	         WHEN char_length(${q}) <= ${NAME_ARM_Q_MAX}
	           AND (si.title ILIKE ${prefix} ESCAPE '\\'
	             OR (${q} OPERATOR(extensions.%) si.title
	                 AND extensions.word_similarity(${q}, si.title) >= ${TRGM_MIN})) THEN 2
	         ELSE 3 END AS tier,
	    0 AS sub,
	    ((1 + coalesce((si.payload ->> 'fame')::float8, 0) / 100)
	      * GREATEST(
	          ts_rank(${WEIGHTS}::float4[], si.tsv, ${tsq(q)}, 1),
	          CASE WHEN char_length(${q}) <= ${NAME_ARM_Q_MAX}
	                 AND ${q} OPERATOR(extensions.%) si.title
	               THEN extensions.word_similarity(${q}, si.title) ELSE 0 END
	        ))::float8 AS score,
	    jsonb_build_object('refs', si.payload -> 'refs',
	      'thumbnail_url', si.payload -> 'thumbnail_url') AS payload
	  FROM lumen.search_index si
	  WHERE si.kind = 'artwork'
	    AND si.collection_id = ANY(${anyOf(visible)})
	    /* No lower(title)= arm (prefix-ILIKE subsumes it; keeps BitmapOr — PER);
	       art titles are name-like, so the A1 %+word_similarity trgm form
	       applies, served by idx_search_title_trgm (CORC-3). */
	    AND (si.tsv @@ ${tsq(q)}
	      OR (char_length(${q}) <= ${NAME_ARM_Q_MAX}
	        AND (si.title ILIKE ${prefix} ESCAPE '\\'
	          OR (${q} OPERATOR(extensions.%) si.title
	              AND extensions.word_similarity(${q}, si.title) >= ${TRGM_MIN}))))
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
	    jsonb_build_object('strongs_no', si.payload -> 'strongs_no') AS payload
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

/** Rejection wrapper so a failed leg still reports real elapsed ms — degraded
 * timeouts must be distinguishable from instant failures (OBS-5). */
class LegFailure extends Error {
	constructor(
		message: string,
		readonly ms: number,
	) {
		super(message);
	}
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
	let combinedRows: RawRow[] | null = null;
	try {
		let combined = sql`SELECT * FROM ((${legs[0].query})`;
		for (let i = 1; i < legs.length; i++) {
			combined = sql`${combined} UNION ALL (${legs[i].query})`;
		}
		combined = sql`${combined}) AS federated`;
		combinedRows = (await db.execute(combined)) as RawRow[];
	} catch (err) {
		// Fall through to isolated per-group execution (COR-1/H17), keeping the
		// reason: a combined-only failure class would otherwise double-execute
		// every request with the cause recorded nowhere (OBS-2).
		meta.combinedError = err instanceof Error ? err.message : String(err);
	}

	if (combinedRows !== null) {
		const rawByKey = new Map<GroupKey, RawRow[]>();
		for (const g of groups) rawByKey.set(g.key, []);
		for (const row of combinedRows) rawByKey.get(row.grp as GroupKey)?.push(row);
		for (const g of groups) {
			try {
				g.results = sortResults(rawByKey.get(g.key)!.map(coerceRow));
				meta.perGroup[g.key] = { ms: null, hits: g.results.length };
			} catch (err) {
				// One poisoned row degrades its own group, never the search (decision 7).
				g.results = [];
				meta.perGroup[g.key] = {
					ms: null,
					hits: 0,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		}
		meta.mode = 'combined';
		meta.totalMs = Date.now() - t0;
		return { query: q, reference, groups, meta };
	}

	const settled = await Promise.allSettled(
		legs.map(async (leg) => {
			const s = Date.now();
			try {
				// Coercion inside the guard: a poisoned row degrades its own
				// group (decision 7), not the whole search.
				const rows = (await db.execute(leg.query)) as RawRow[];
				return { results: sortResults(rows.map(coerceRow)), ms: Date.now() - s };
			} catch (err) {
				throw new LegFailure(err instanceof Error ? err.message : String(err), Date.now() - s);
			}
		}),
	);
	for (let i = 0; i < settled.length; i++) {
		const key = legs[i].key;
		const g = byKey.get(key)!;
		const outcome = settled[i];
		if (outcome.status === 'fulfilled') {
			g.results = outcome.value.results;
			meta.perGroup[key] = { ms: outcome.value.ms, hits: g.results.length };
		} else {
			const reason: unknown = outcome.reason;
			meta.perGroup[key] = {
				ms: reason instanceof LegFailure ? reason.ms : 0,
				hits: 0,
				error: reason instanceof Error ? reason.message : String(reason),
			};
		}
	}
	meta.mode = 'fallback';
	meta.totalMs = Date.now() - t0;
	return { query: q, reference, groups, meta };
}
