import { sql } from 'drizzle-orm';
import type { Db } from './types';
import { parseReference, buildVerseId } from './slug-map';

// Db-free public shapes live in the leaf so client code can import GROUP_KEYS /
// result types without dragging drizzle onto the /search hydration path (B18).
// Re-exported here so the barrel surface and every existing consumer are
// unchanged; imported below for this module's own use.
export * from './search-types';
import { GROUP_KEYS } from './search-types';
import type {
	GroupKey,
	ResultType,
	SearchOptions,
	SearchResult,
	SearchGroup,
	SearchReference,
	SearchGroupMeta,
	SearchMeta,
	SearchResponse,
} from './search-types';

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

/* ─── Keyset cursor codec (search-ui plan, cursor bullet) ─── */

/**
 * Opaque cursor: base64url of `v1|qhash|tier|sub|score|id`. `sub` is part of
 * the shipped ORDER BY (the jst/moment demotion key) — a 3-column cursor
 * live-provably drops the whole sub=1 partition (Δ CU-1). `score` travels as
 * raw float64 bits, never a decimal rendering: live 10-way score ties make the
 * id tiebreak precision-dependent (Δ CU-5). The 8-char hash binds the cursor
 * to (q, scope) — binding, not integrity (Q1): a tampered position field can
 * only re-paginate a result set the caller already sees, because visibility is
 * re-derived per request and NEVER carried here (Δ SU-1/F16). Decode is pure
 * comparison math, never a DB lookup (Δ SU-2).
 */
export interface SearchCursor {
	tier: number;
	sub: number;
	score: number;
	id: string;
}

export type SearchCursorErrorCode = 'cursor_invalid' | 'cursor_mismatch';

/** Typed decode failure so the route can map `code` to its stable 400
 * (`cursor_invalid` = malformed, `cursor_mismatch` = minted for another
 * (q, scope)). The raw cursor never appears in the message (F3). */
export class SearchCursorError extends Error {
	constructor(readonly code: SearchCursorErrorCode) {
		super(code === 'cursor_invalid' ? 'malformed cursor' : 'cursor was minted for another search');
		this.name = 'SearchCursorError';
	}
}

const CURSOR_VERSION = 'v1';

/** FNV-1a 32-bit over scope␀q → 8 hex chars. */
function cursorHash(q: string, scope: string): string {
	let h = 0x811c9dc5;
	const s = scope + '\u0000' + q;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

function scoreToHex(score: number): string {
	const view = new DataView(new ArrayBuffer(8));
	view.setFloat64(0, score);
	let out = '';
	for (let i = 0; i < 8; i++) out += view.getUint8(i).toString(16).padStart(2, '0');
	return out;
}

function scoreFromHex(hex: string): number {
	const view = new DataView(new ArrayBuffer(8));
	for (let i = 0; i < 8; i++) view.setUint8(i, parseInt(hex.slice(i * 2, i * 2 + 2), 16));
	return view.getFloat64(0);
}

function b64urlEncode(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(raw: string): string {
	const bin = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
	const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

export function encodeSearchCursor(input: {
	q: string;
	scope: GroupKey;
	tier: number;
	sub?: number;
	score: number;
	id: string;
}): string {
	return b64urlEncode(
		[
			CURSOR_VERSION,
			cursorHash(input.q, input.scope),
			String(input.tier),
			String(input.sub ?? 0),
			scoreToHex(input.score),
			input.id,
		].join('|'),
	);
}

export function decodeSearchCursor(
	cursor: string,
	bind: { q: string; scope: GroupKey },
): SearchCursor {
	let text: string;
	try {
		text = b64urlDecode(cursor);
	} catch {
		throw new SearchCursorError('cursor_invalid');
	}
	const parts = text.split('|');
	if (parts.length < 6 || parts[0] !== CURSOR_VERSION) throw new SearchCursorError('cursor_invalid');
	const [, hash, tierRaw, subRaw, scoreHex] = parts;
	const id = parts.slice(5).join('|');
	if (
		!/^[0-9a-f]{8}$/.test(hash) ||
		!/^\d+$/.test(tierRaw) ||
		!/^\d+$/.test(subRaw) ||
		!/^[0-9a-f]{16}$/.test(scoreHex) ||
		id === ''
	) {
		throw new SearchCursorError('cursor_invalid');
	}
	if (hash !== cursorHash(bind.q, bind.scope)) throw new SearchCursorError('cursor_mismatch');
	// encode only ever writes finite ts_rank bits; NaN/±Infinity is tampering.
	// PG sorts NaN as greatest, so `score < NaN` re-admits page 1 in a self-loop
	// (B20/F3) — reject non-finite here so a forged cursor can never repeat page 1.
	const score = scoreFromHex(scoreHex);
	if (!Number.isFinite(score)) throw new SearchCursorError('cursor_invalid');
	return { tier: Number(tierRaw), sub: Number(subRaw), score, id };
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
		// The reference lead headlines `display`, so resolve the canonical DB name
		// ("Moses", "Pearl of Great Price") rather than parroting the raw-cased
		// input — chapter/verse already resolve their display from the DB (B12).
		const rows =
			parsed.level === 'volume'
				? ((await db.execute(
						sql`SELECT name FROM lumen.volumes WHERE id = ${parsed.volumeId} LIMIT 1`,
					)) as Array<{ name: string }>)
				: ((await db.execute(
						sql`SELECT name FROM lumen.books WHERE id = ${parsed.bookId} LIMIT 1`,
					)) as Array<{ name: string }>);
		return {
			reference: {
				level: parsed.level,
				book_id: parsed.bookId,
				display: rows[0]?.name ?? parsed.raw,
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

/** Strictly-after under the leg ORDER BY (tier, sub, score DESC, id COLLATE "C"):
 * the comparison flips on score because it sorts descending; id ties break in
 * `COLLATE "C"` (byte/code-unit order) to MATCH the JS tiebreak sortResults
 * applies and mintNextCursor mints against. The DB default en_US.UTF-8 orders
 * mixed-case ref_ids (episode/moment YouTube ids) differently from JS code
 * units, so without this the JS-minted cursor lands en_US-below the SQL page
 * boundary and page 2 re-serves the tie members (B1). */
function keysetAfter(c: SearchCursor) {
	return sql`(tier > ${c.tier} OR (tier = ${c.tier} AND (sub > ${c.sub}
	    OR (sub = ${c.sub} AND (score < ${c.score} OR (score = ${c.score} AND id COLLATE "C" > ${c.id}))))))`;
}

/** Order-and-limit tail for every leg. tier/sub/score are computed
 * expressions, so a cursor's keyset WHERE cannot sit beside the gates — it
 * wraps them (the planner flattens the subquery and pushes the predicate into
 * each arm with the expressions substituted; EXPLAIN-verified no plan
 * regression, the FTS bitmap arms still drive). The collection gates stay
 * INSIDE `inner`, so visibility always comes from this request's
 * visibleCollections, never from cursor state (Δ SU-1/F16). */
function paged(
	inner: ReturnType<typeof sql>,
	limit: number,
	after: SearchCursor | undefined,
): ReturnType<typeof sql> {
	// Both branches wrap `inner` in a subquery so `id COLLATE "C"` binds to the
	// projected `id` alias, not the base table: COLLATE forces expression
	// evaluation (not a bare output-name reference), and the bare-table legs
	// (episodes/art/words select `si.ref_id AS id` over search_index, which has
	// no `id` column) would otherwise error "column id does not exist".
	if (after === undefined)
		return sql`SELECT * FROM (${inner}) u
	  ORDER BY tier, sub, score DESC, id COLLATE "C"
	  LIMIT ${limit}`;
	return sql`SELECT * FROM (${inner}) u
	  WHERE ${keysetAfter(after)}
	  ORDER BY tier, sub, score DESC, id COLLATE "C"
	  LIMIT ${limit}`;
}

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

function scriptureLeg(
	q: string,
	visible: string[],
	limit: number,
	after?: SearchCursor,
): ReturnType<typeof sql> {
	const inner = sql`SELECT * FROM (
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
	  ) u`;
	return sql`
	SELECT 'scripture' AS grp, s.type, s.id, s.title,
	  CASE WHEN s.snip_src = '' THEN NULL
	       ELSE ts_headline('english', s.snip_src, ${scriptureHeadlineTsq(q)}, ${HEADLINE_OPTS}) END AS snippet,
	  s.tier, s.score, s.payload,
	  encode(float8send(s.score), 'hex') AS score_bits
	FROM (
	  ${paged(inner, limit, after)}
	) s`;
}

function entityLeg(
	key: GroupKey,
	types: string[],
	q: string,
	visible: string[],
	limit: number,
	after?: SearchCursor,
): ReturnType<typeof sql> {
	const prefix = escapeLike(q) + '%';
	const inner = sql`SELECT
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
	      OR e.search_vector @@ ${tsq(q)})`;
	return sql`
	SELECT ${key} AS grp, s.type, s.id, s.title,
	  CASE WHEN s.snip_src = '' THEN NULL
	       ELSE ts_headline('english', s.snip_src, ${tsq(q)}, ${HEADLINE_OPTS}) END AS snippet,
	  s.tier, s.score, s.payload,
	  encode(float8send(s.score), 'hex') AS score_bits
	FROM (
	  ${paged(inner, limit, after)}
	) s`;
}

function episodesLeg(
	q: string,
	visible: string[],
	limit: number,
	after?: SearchCursor,
): ReturnType<typeof sql> {
	const prefix = escapeLike(q) + '%';
	const inner = sql`SELECT si.kind AS type, si.ref_id AS id, si.title,
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
	            AND extensions.word_similarity(${q}, si.title) >= ${TRGM_MIN}))))`;
	return sql`
	SELECT 'episodes' AS grp, s.type, s.id, s.title,
	  CASE WHEN s.snip_src = '' THEN NULL
	       ELSE ts_headline('english', s.snip_src, ${tsq(q)}, ${HEADLINE_OPTS}) END AS snippet,
	  s.tier, s.score, s.payload,
	  encode(float8send(s.score), 'hex') AS score_bits
	FROM (
	  ${paged(inner, limit, after)}
	) s`;
}

function artLeg(
	q: string,
	visible: string[],
	limit: number,
	after?: SearchCursor,
): ReturnType<typeof sql> {
	const prefix = escapeLike(q) + '%';
	const inner = sql`SELECT 'artwork' AS type, si.ref_id AS id, si.title,
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
	              AND extensions.word_similarity(${q}, si.title) >= ${TRGM_MIN}))))`;
	return sql`
	SELECT 'art' AS grp, s.type, s.id, s.title,
	  NULL::text AS snippet,
	  s.tier, s.score, s.payload,
	  encode(float8send(s.score), 'hex') AS score_bits
	FROM (
	  ${paged(inner, limit, after)}
	) s`;
}

function wordsLeg(
	q: string,
	visible: string[],
	limit: number,
	after?: SearchCursor,
): ReturnType<typeof sql> {
	const inner = sql`SELECT 'strongs' AS type, si.ref_id AS id, si.title,
	    coalesce(si.payload ->> 'gloss', '') AS snip_src,
	    CASE WHEN upper(${q}) = si.ref_id
	           OR lower(extensions.unaccent(coalesce(si.payload ->> 'translit', ''))) = lower(${q})
	         THEN 1 ELSE 3 END AS tier,
	    0 AS sub,
	    ts_rank(${WEIGHTS}::float4[], si.tsv, ${tsq(q)}, 1)::float8 AS score,
	    jsonb_build_object(
	      'strongs_no', si.payload -> 'strongs_no',
	      'translit', si.payload -> 'translit',
	      'original', si.payload -> 'original',
	      'lang', CASE WHEN si.payload ->> 'lang' = 'hebrew' THEN 'he' ELSE 'grc' END,
	      'dir', CASE WHEN si.payload ->> 'lang' = 'hebrew' THEN 'rtl' ELSE 'ltr' END
	    ) AS payload
	  FROM lumen.search_index si
	  WHERE si.kind = 'strongs'
	    AND si.collection_id = ANY(${anyOf(visible)})
	    AND (si.tsv @@ ${tsq(q)} OR upper(${q}) = si.ref_id)`;
	return sql`
	SELECT 'words' AS grp, s.type, s.id, s.title,
	  CASE WHEN s.snip_src = '' THEN NULL
	       ELSE ts_headline('english', s.snip_src, ${tsq(q)}, ${HEADLINE_OPTS}) END AS snippet,
	  s.tier, s.score, s.payload,
	  encode(float8send(s.score), 'hex') AS score_bits
	FROM (
	  ${paged(inner, limit, after)}
	) s`;
}

function buildLegs(
	scope: GroupKey[],
	q: string,
	visible: string[],
	limit: number,
	after?: SearchCursor,
): Leg[] {
	const legs: Leg[] = [];
	for (const key of scope) {
		if (key === 'scripture') legs.push({ key, query: scriptureLeg(q, visible, limit, after) });
		else if (key === 'people') legs.push({ key, query: entityLeg('people', ['person'], q, visible, limit, after) });
		else if (key === 'places') legs.push({ key, query: entityLeg('places', ['place'], q, visible, limit, after) });
		else if (key === 'topics')
			legs.push({
				key,
				query: entityLeg(
					'topics',
					['naves_topic', 'principle', 'symbol', 'event', 'era', 'chapter_summary'],
					q,
					visible,
					limit,
					after,
				),
			});
		else if (key === 'episodes') legs.push({ key, query: episodesLeg(q, visible, limit, after) });
		else if (key === 'art') legs.push({ key, query: artLeg(q, visible, limit, after) });
		else if (key === 'words') legs.push({ key, query: wordsLeg(q, visible, limit, after) });
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
	/** Exact IEEE-754 bits of score (`float8send` hex): the pooled path runs
	 * extra_float_digits=0, so the textual `score` is a 15-digit ROUNDING —
	 * comparing it back against the column live-provably re-admits page-1 rows
	 * (probed 2026-07-21: gen-1-20 true bits 3f8d4f2980000000 vs its rounded
	 * text). Cursors and ordering must come from these bits. */
	score_bits?: string;
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
		// Bit-exact from float8send when the statement provides it (all legs do);
		// the textual fallback only serves injected fallback-mode test rows.
		score:
			typeof r.score_bits === 'string' && /^[0-9a-f]{16}$/.test(r.score_bits)
				? scoreFromHex(r.score_bits)
				: Number(r.score),
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

/** The demotion key each leg computes as `sub` — one derivation shared by the
 * sort and cursor minting so SQL sub and JS sub can never drift. */
function subOf(type: ResultType): 0 | 1 {
	return type === 'jst' || type === 'moment' ? 1 : 0;
}

/** Deterministic within-group order: tier, jst-after-canon, score desc, id (COR-4/REL-5). */
function sortResults(results: SearchResult[]): SearchResult[] {
	return results.sort((a, b) => {
		if (a.tier !== b.tier) return a.tier - b.tier;
		const aSub = subOf(a.type);
		const bSub = subOf(b.type);
		if (aSub !== bSub) return aSub - bSub;
		if (a.score !== b.score) return b.score - a.score;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
}

/** F5/Δ UU-1: a full page — and ONLY a full page — mints the continuation
 * cursor from its last row's sort key. Short and empty pages are the end of
 * the set; degraded groups arrive here empty and mint nothing. */
function mintNextCursor(g: SearchGroup & { key: GroupKey }, q: string, limit: number): void {
	if (g.results.length !== limit) return;
	const last = g.results[g.results.length - 1];
	g.nextCursor = encodeSearchCursor({
		q,
		scope: g.key,
		tier: last.tier,
		sub: subOf(last.type),
		score: last.score,
		id: last.id,
	});
}

/* ─── searchAll ─── */

export async function searchAll(db: Db, opts: SearchOptions): Promise<SearchResponse> {
	const t0 = Date.now();
	const q = (opts.q ?? '').trim().slice(0, 200);
	const limit = clampLimit(opts.limitPerGroup);
	// personal-notes A1 (CF-1): the engine only ever dispatches canon keys.
	// Non-canon keys (`notes` or anything else smuggled past the types) are
	// structurally filtered so buildLegs can never see them; a scope that
	// filters to empty stays empty — widening [] back to all groups is the
	// CF-7 trap (a notes-only scope must be handled at the route layer).
	const requestedScope = opts.scope?.length
		? opts.scope.filter((k): k is GroupKey => (GROUP_KEYS as readonly string[]).includes(k))
		: null;
	if (opts.scope?.length && requestedScope!.length === 0) {
		return {
			query: q,
			reference: null,
			groups: [],
			meta: { perGroup: {}, totalMs: Date.now() - t0, mode: 'none' },
		};
	}
	const scope: GroupKey[] = requestedScope ?? [...GROUP_KEYS];
	const visible = opts.visibleCollections ?? [];

	// Continuation only ever composes with a single leg (the route 400s
	// cursor_scope on any other shape). Typed decode errors propagate — the
	// caller maps them to cursor_invalid / cursor_mismatch.
	const after =
		opts.after !== undefined && scope.length === 1
			? decodeSearchCursor(opts.after, { q, scope: scope[0] })
			: undefined;

	const groups: Array<SearchGroup & { key: GroupKey }> = scope.map((key) => ({
		key,
		results: [],
	}));
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

	const legs = buildLegs(scope, q, visible, limit, after);

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
				mintNextCursor(g, q, limit);
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
			mintNextCursor(g, q, limit);
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
