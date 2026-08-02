/**
 * search-ui harness — keyset cursor, LIVE DB (F1, F5, F15, F16 core).
 * RED-FIRST: `after`/`nextCursor`/cursor codecs do not exist in search.ts yet —
 * every pin below fails on a missing export or missing behavior, never on a
 * test bug. Runs as lumen_read like search-harness.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { SearchOptions } from '../search';
import { FULL_CORPUS, lumenReadDsn } from './support/dsn';

/** RED-FIRST: `after` lands in SearchOptions with the implementation; the
 * intersection keeps these call sites compiling on both sides of that edit. */
type CursorOptions = SearchOptions & { after?: string };

let client: ReturnType<typeof postgres>;
let db: any;

beforeAll(async () => {
	// CU-2: same DSN the sibling search-harness.test.ts uses
	const { dsn, ssl } = lumenReadDsn();
	client = postgres(dsn, { max: 1, prepare: false, ssl });
	db = drizzle(client);
	const who = await client`select current_user`;
	expect(who[0].current_user).toBe('lumen_read');
});

afterAll(async () => {
	await client.end({ timeout: 5 });
});

/**
 * INDEPENDENT no-gap oracle (Δ PU-3/BRRU-1): a raw SQL fetch via the postgres
 * client — NOT a searchAll refetch, whose clampLimit caps limitPerGroup at 25
 * and would make the "big page" comparison a tautology (the exact bug this
 * replaces). Reproduces the shipped scriptureLeg's inner ordering
 * (search.ts): both arms are tier 3; verses sub=0, jst readings sub=1
 * (collection-gated); ORDER BY (tier, sub, score DESC, id). `id COLLATE "C"`
 * pins the code-unit tiebreak sortResults applies in JS — probed 2026-07-21:
 * "C" and the DB default collation order these windows identically live, so
 * the collation clause is a pin of intent, not a live divergence.
 */
async function scriptureOracle(
	q: string,
	visible: string[],
	limit: number,
): Promise<Array<{ id: string; sub: number }>> {
	const rows = await client`
		SELECT id, sub FROM (
			SELECT v.id, 3 AS tier, 0 AS sub,
				ts_rank('{0.1,0.2,0.4,1.0}'::float4[], v.search_vector,
					websearch_to_tsquery('english', ${q}), 1)::float8 AS score
			FROM lumen.verses v
			WHERE v.search_vector @@ websearch_to_tsquery('english', ${q})
			UNION ALL
			SELECT e.id, 3, 1,
				ts_rank('{0.1,0.2,0.4,1.0}'::float4[], e.search_vector,
					websearch_to_tsquery('english', ${q}), 1)::float8
			FROM lumen.entities e
			WHERE e.entity_type = 'jst_reading'
				AND e.collection_id = ANY(string_to_array(NULLIF(${visible.join(',')}, ''), ','))
				AND e.search_vector @@ websearch_to_tsquery('english', ${q})
		) u
		ORDER BY u.tier, u.sub, u.score DESC, u.id COLLATE "C"
		LIMIT ${limit}`;
	return rows.map((r: any) => ({ id: r.id as string, sub: Number(r.sub) }));
}

/**
 * INDEPENDENT no-gap oracle for the episodes leg (B1/B30). Reproduces
 * episodesLeg's inner (search.ts) and its ORDER BY (tier, sub, score DESC, id)
 * with the id tiebreak pinned to `COLLATE "C"` — the code-unit order sortResults
 * applies in JS and the cursor is minted against. Unlike the verse corpus,
 * episode/moment ref_ids are MIXED-CASE (`unshaken-<YouTubeId>#<t>`), so "C" and
 * the DB default (en_US.UTF-8) diverge inside score ties: this is exactly where
 * B1 lives, so this oracle is a real divergence, not a pin-of-intent.
 */
async function episodesOracle(q: string, visible: string[], limit: number): Promise<string[]> {
	const prefix = q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
	const rows = await client`
		SELECT id FROM (
			SELECT si.ref_id AS id,
				CASE WHEN si.kind = 'episode' AND lower(si.title) = lower(${q}) THEN 1
				     WHEN si.kind = 'episode' AND (si.title ILIKE ${prefix} ESCAPE '\\'
				       OR (char_length(${q}) <= 100
				           AND extensions.word_similarity(${q}, si.title) >= 0.45)) THEN 2
				     ELSE 3 END AS tier,
				CASE WHEN si.kind = 'episode' THEN 0 ELSE 1 END AS sub,
				GREATEST(
					ts_rank('{0.1,0.2,0.4,1.0}'::float4[], si.tsv,
						websearch_to_tsquery('english', ${q}), 1),
					CASE WHEN si.kind = 'episode' AND char_length(${q}) <= 100
					       AND extensions.word_similarity(${q}, si.title) >= 0.45
					     THEN extensions.word_similarity(${q}, si.title) ELSE 0 END
				)::float8 AS score
			FROM lumen.search_index si
			WHERE si.kind IN ('episode', 'moment')
				AND si.collection_id = ANY(string_to_array(NULLIF(${visible.join(',')}, ''), ','))
				AND (si.tsv @@ websearch_to_tsquery('english', ${q})
					OR (si.kind = 'episode' AND (lower(si.title) = lower(${q})
						OR si.title ILIKE ${prefix} ESCAPE '\\'
						OR (char_length(${q}) <= 100
							AND extensions.word_similarity(${q}, si.title) >= 0.45))))
		) u
		ORDER BY u.tier, u.sub, u.score DESC, u.id COLLATE "C"
		LIMIT ${limit}`;
	return rows.map((r: any) => r.id as string);
}

describe.skipIf(!FULL_CORPUS)('F1/F5/F15 — keyset continuity on the live verse corpus', () => {
	it('page 2 continues exactly after page 1: no dup, no gap, order preserved (independent raw-SQL oracle)', async () => {
		// RED: searchAll has no `after`; groups have no `nextCursor`.
		const { searchAll } = await import('../search');
		const opts: CursorOptions = {
			q: 'faith', visibleCollections: ['phase-b'], scope: ['scripture'], limitPerGroup: 25,
		};
		const p1 = await searchAll(db, opts);
		const g1 = p1.groups[0] as any;
		expect(g1.results).toHaveLength(25);
		expect(g1.nextCursor, 'full page must mint a nextCursor').toBeTruthy();

		const p2Opts: CursorOptions = { ...opts, after: g1.nextCursor };
		const p2 = await searchAll(db, p2Opts);
		const g2 = p2.groups[0] as any;
		const ids1 = g1.results.map((r: any) => r.id);
		const ids2 = g2.results.map((r: any) => r.id);
		expect(ids2, 'faith has 810+ verse hits — page 2 is full too').toHaveLength(25);
		expect(new Set([...ids1, ...ids2]).size).toBe(50); // no dup

		// Δ PU-3/BRRU-1: no-gap against the INDEPENDENT oracle — page1 ++ page2
		// must equal the leg ordering's first 50 EXACTLY. Live (2026-07-21) the
		// page-1 cut lands inside a 10-way score tie (oracle rows 22–27 all score
		// 0.0235178302973509) and the 50-cut inside another (0.021654799580574),
		// so a dropped/duplicated tie member or any reordering fails here — this
		// also proves the cursor's id tiebreak carries across the request gap.
		const oracle = await scriptureOracle('faith', ['phase-b'], 50);
		expect(oracle).toHaveLength(50);
		expect([...ids1, ...ids2]).toEqual(oracle.map((r) => r.id));
	});

	it('F15: pages cross the sub boundary (verses → jst) with no gap and no dup', async () => {
		// Probe-picked q (live, 2026-07-21): 'firmament' with visibleCollections
		// ['jst'] matches 28 verses (sub=0) + 14 jst readings (sub=1) = 42 rows.
		// Page 1 = 25 verses; page 2 = the last 3 verses + all 14 jst — the sub
		// transition sits inside page 2. ALL 14 jst rows outscore the page-1 cut
		// score (0.014311145991087 at gen-1-20; max jst = 0.0779162421822548) —
		// the exact CU-1 panel class where a sub-less (tier, score, id) cursor
		// live-provably drops the whole sub=1 partition. The cut row also splits
		// a score tie (gen-1-20 / moses-2-20, identical score), so the id
		// tiebreak is exercised AT the boundary as well.
		const { searchAll } = await import('../search');
		const opts: CursorOptions = {
			q: 'firmament', visibleCollections: ['jst'], scope: ['scripture'], limitPerGroup: 25,
		};
		const p1 = await searchAll(db, opts);
		const g1 = p1.groups[0] as any;
		expect(g1.results).toHaveLength(25);
		expect(g1.results.every((r: any) => r.type === 'verse'), 'page 1 is all verses').toBe(true);
		expect(g1.nextCursor, 'full page must mint a nextCursor').toBeTruthy();

		const p2Opts: CursorOptions = { ...opts, after: g1.nextCursor };
		const p2 = await searchAll(db, p2Opts);
		const g2 = p2.groups[0] as any;
		// 3 remaining verses, then all 14 jst — exactly one sub transition.
		expect(g2.results.map((r: any) => (r.type === 'jst' ? 1 : 0))).toEqual([
			0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
		]);
		expect(g2.nextCursor, 'exhausted page must not mint a cursor').toBeUndefined();

		const ids = [...g1.results, ...g2.results].map((r: any) => r.id);
		expect(new Set(ids).size).toBe(42); // no dup
		const oracle = await scriptureOracle('firmament', ['jst'], 50);
		expect(oracle.filter((r) => r.sub === 1), 'probe still holds: 14 jst rows').toHaveLength(14);
		expect(ids).toEqual(oracle.map((r) => r.id)); // no gap — independent oracle
	});

	it('exhaustion: a page shorter than the limit has no nextCursor', async () => {
		const { searchAll } = await import('../search');
		// Fixture repaired 2026-07-21: the original 'melchizedek' claim of 22
		// verse hits was stale — websearch_to_tsquery matches 28 verses live, so
		// the page FILLS at limit 25 and the pin was red for the wrong reason.
		// 'lucifer' has 3 verse hits live (probed via the leg's exact FTS
		// predicate; its 1 jst reading is gated out under ['phase-b']).
		const res = await searchAll(db, {
			q: 'lucifer', visibleCollections: ['phase-b'], scope: ['scripture'], limitPerGroup: 25,
		});
		const g = res.groups[0] as any;
		expect(g.results.length).toBeGreaterThan(0);
		expect(g.results.length).toBeLessThan(25);
		expect(g.nextCursor).toBeUndefined();
	});

	it('cursor codec round-trips a REAL tied score bit-exactly; opaque base64url', async () => {
		// Δ CU-5: live 10-way score ties make the id tiebreak precision-dependent
		// — the cursor must carry the float64 EXACTLY, not a truncated decimal.
		// Live tied set (probed 2026-07-21): q='faith' verses 2-cor-5-7, dc-34-11
		// and dc-46-19 all rank at exactly 0.0303963553160429 (3-way tie).
		// Re-verify the tie live so the pin can never go stale silently.
		const TIED_SCORE = 0.0303963553160429;
		const tied = await client`
			SELECT id FROM lumen.verses v
			WHERE v.search_vector @@ websearch_to_tsquery('english', 'faith')
				AND ts_rank('{0.1,0.2,0.4,1.0}'::float4[], v.search_vector,
					websearch_to_tsquery('english', 'faith'), 1)::float8 = ${TIED_SCORE}
			ORDER BY id`;
		expect(tied.map((r: any) => r.id)).toContain('2-cor-5-7');
		expect(tied.length, 'live score tie still holds').toBeGreaterThanOrEqual(2);

		// RED: cursor codec exports do not exist yet.
		const { encodeSearchCursor, decodeSearchCursor } = (await import('../search')) as any;
		const c = encodeSearchCursor({
			q: 'faith', scope: 'scripture', tier: 3, sub: 0, score: TIED_SCORE, id: '2-cor-5-7',
		});
		expect(c).toMatch(/^[A-Za-z0-9_-]+$/); // opaque base64url
		const decoded = decodeSearchCursor(c, { q: 'faith', scope: 'scripture' });
		expect(decoded).toMatchObject({ tier: 3, sub: 0, id: '2-cor-5-7' });
		// Bit-exact float64 (Object.is: also catches a -0/0 mangle) — tier/id
		// alone would pass with a codec that rounds the score.
		expect(
			Object.is(decoded.score, TIED_SCORE),
			`score must round-trip bit-exactly; got ${decoded?.score}`,
		).toBe(true);
	});
});

describe.skipIf(!FULL_CORPUS)('F16 — cursor visibility re-gate (SU-1/SU-2)', () => {
	it('a cursor minted under wider visibility silently re-gates when replayed narrower', async () => {
		const { searchAll } = await import('../search');
		// 'Halverson' matches 11 unshaken transcript rows live (probed
		// 2026-07-21: 11 moments, 0 episodes) — limitPerGroup 5 leaves a full
		// page, so a cursor must be minted.
		const opts: CursorOptions = {
			q: 'Halverson', visibleCollections: ['unshaken'], scope: ['episodes'], limitPerGroup: 5,
		};
		const p1 = await searchAll(db, opts);
		const g1 = p1.groups[0] as any;
		expect(g1.results).toHaveLength(5);
		// Guard: pre-implementation this pin goes red HERE on the missing
		// nextCursor instead of crashing searchAll with `after: undefined`.
		expect(g1.nextCursor, 'full page must mint a nextCursor').toBeTruthy();

		// Same q, same scope — only visibility narrows. Visibility is re-derived
		// per request, NEVER trusted from cursor state: the replay must return
		// zero rows, silently — no throw, no distinct error code that would
		// disclose "there was something here" (SU-1 fail-closed doctrine).
		const p2Opts: CursorOptions = { ...opts, visibleCollections: [], after: g1.nextCursor };
		const p2 = await searchAll(db, p2Opts);
		const g2 = p2.groups[0] as any;
		expect(g2.results, 'hidden rows must not leak through a replayed cursor').toHaveLength(0);
		expect(
			(p2.meta.perGroup as any).episodes?.error,
			'silent re-gate — a narrowed replay is not an error',
		).toBeUndefined();
		expect(g2.nextCursor, 'an empty page never mints a cursor').toBeUndefined();
	});
});

describe.skipIf(!FULL_CORPUS)('B1/B30 — episodes-leg keyset continuity across a collation-divergent score tie', () => {
	it('page 2 continues exactly after page 1 with mixed-case ref_ids: no dup, no gap (independent C-order oracle)', async () => {
		// B30 fixture (live 2026-07-22, prod-reproduced): q=israel scope=episodes
		// limit=8 has 848 matching rows, and page 1 fills EXACTLY at a 3-way score
		// tie (score_bits 3f8fbc6c40000000):
		//   unshaken-O3SiM9Yi940#144, unshaken-ki0bTvQsaCo#1536, unshaken-ki0bTvQsaCo#356.
		// The JS/code-unit tiebreak sorts O3Si… ('O'=0x4f) before ki0b… ('k'=0x6b),
		// so mintNextCursor mints from JS-last = ki0bTvQsaCo#356. But the shipped leg
		// ORDER BY / keysetAfter compare id in en_US.UTF-8, where ki0b… < O3Si…
		// (case-insensitive k<o) — so `id > ki0bTvQsaCo#356` RE-ADMITS all three tie
		// members on page 2. RED before COLLATE "C" (page1∩page2 = those 3 ids),
		// GREEN after (SQL id order == the JS/C order the cursor is minted against).
		const { searchAll } = await import('../search');
		const opts: CursorOptions = {
			q: 'israel', visibleCollections: ['unshaken'], scope: ['episodes'], limitPerGroup: 8,
		};
		const p1 = await searchAll(db, opts);
		const g1 = p1.groups[0] as any;
		expect(g1.results).toHaveLength(8);
		expect(g1.nextCursor, 'full page must mint a nextCursor').toBeTruthy();

		const p2 = await searchAll(db, { ...opts, after: g1.nextCursor });
		const g2 = p2.groups[0] as any;
		const ids1 = g1.results.map((r: any) => r.id);
		const ids2 = g2.results.map((r: any) => r.id);
		expect(ids2.length, '848 hits — page 2 is full too').toBe(8);

		// The B1 discriminator: no row may appear on both pages.
		expect(
			new Set([...ids1, ...ids2]).size,
			'no episode/moment row served on both pages',
		).toBe(ids1.length + ids2.length);

		// No-gap against the INDEPENDENT C-order oracle: page1 ++ page2 must equal
		// the leg ordering's first 16 EXACTLY (proves the id tiebreak carries the
		// mixed-case tie across the request gap, no reorder, no drop).
		const oracle = await episodesOracle('israel', ['unshaken'], ids1.length + ids2.length);
		expect(oracle).toHaveLength(16);
		expect([...ids1, ...ids2]).toEqual(oracle);
	});
});

describe.skipIf(!FULL_CORPUS)('B20 — decodeSearchCursor rejects non-finite score bits', () => {
	it('a tampered cursor with NaN/±Infinity score → cursor_invalid, never accepted', async () => {
		const { encodeSearchCursor, decodeSearchCursor, SearchCursorError } = (await import(
			'../search'
		)) as any;
		const bind = { q: 'faith', scope: 'scripture' as const };
		// Mint a real cursor to inherit its (q, scope) hash + structure, then swap
		// only the 16-hex score field for non-finite IEEE-754 bit patterns. encode
		// never writes these (ts_rank scores are always finite), so rejecting them
		// costs zero legitimate cursors while closing the F3/self-loop gap (B20):
		// PG sorts NaN as greatest, so `score < NaN` re-admits page 1 forever.
		const real = encodeSearchCursor({ ...bind, tier: 3, sub: 0, score: 0.25, id: '1-ne-3-7' });
		const parts = Buffer.from(real, 'base64url').toString('utf8').split('|');
		const tamper = (scoreHex: string) => {
			const p = [...parts];
			p[4] = scoreHex;
			return Buffer.from(p.join('|'), 'utf8').toString('base64url');
		};
		for (const [label, bits] of [
			['NaN', '7ff8000000000000'],
			['+Infinity', '7ff0000000000000'],
			['-Infinity', 'fff0000000000000'],
		] as const) {
			let thrown: unknown;
			try {
				decodeSearchCursor(tamper(bits), bind);
			} catch (e) {
				thrown = e;
			}
			expect(thrown, `${label} score cursor must be rejected`).toBeInstanceOf(SearchCursorError);
			expect((thrown as any).code, `${label} → cursor_invalid`).toBe('cursor_invalid');
		}
		// Guard the guard: a finite score still round-trips (no false positive).
		expect(decodeSearchCursor(real, bind).score).toBe(0.25);
	});
});

describe.skipIf(!FULL_CORPUS)('B11 — words leg payload carries render-ready original script (translit/original/lang/dir)', () => {
	it('Hebrew (rtl) and Greek (ltr) strongs rows ship separate script fields, not a split title', async () => {
		// The page must render the original script with a correct lang/dir instead
		// of string-splitting `title` ("be.rit בְּרִית") — 354 multi-word titles
		// break that split. The DB payload already holds translit/original/lang;
		// the leg previously shipped only strongs_no. RED: original/lang/dir absent.
		const { searchAll } = await import('../search');
		// Source of truth from the live DB payload — compare original/translit
		// against the stored bytes so niqqud/diacritic Unicode normalization can't
		// make a hardcoded file literal spuriously diverge. lang/dir are derived.
		const src = await client`
			SELECT ref_id, payload FROM lumen.search_index
			WHERE kind = 'strongs' AND ref_id IN ('H1285', 'G2787')`;
		const srcOf = (id: string) => src.find((r: any) => r.ref_id === id)!.payload as any;

		const wordsPayload = async (q: string, id: string) =>
			(
				(
					await searchAll(db, {
						q, visibleCollections: ['strongs'], scope: ['words'], limitPerGroup: 5,
					})
				).groups[0] as any
			).results.find((r: any) => r.id === id)?.payload;

		const heb = await wordsPayload('H1285', 'H1285');
		expect(heb, 'H1285 (berit, Hebrew) present').toBeTruthy();
		expect(heb.strongs_no).toBe('H1285');
		expect(heb.translit).toBe(srcOf('H1285').translit);
		expect(heb.original).toBe(srcOf('H1285').original); // בְּרִית
		expect(heb.lang, 'Hebrew → BCP-47 he').toBe('he');
		expect(heb.dir, 'Hebrew is right-to-left').toBe('rtl');

		const grk = await wordsPayload('G2787', 'G2787');
		expect(grk, 'G2787 (kibotos, Greek) present').toBeTruthy();
		expect(grk.strongs_no).toBe('G2787');
		expect(grk.translit).toBe(srcOf('G2787').translit);
		expect(grk.original).toBe(srcOf('G2787').original); // κιβωτός
		expect(grk.lang, 'Greek → BCP-47 grc').toBe('grc');
		expect(grk.dir, 'Greek is left-to-right').toBe('ltr');
	});
});

describe.skipIf(!FULL_CORPUS)('B12 — book/volume reference lead headlines the canonical DB name, not the raw input', () => {
	it('bare book/volume references resolve display from lumen.books / lumen.volumes', async () => {
		// The 2xl reference lead parroted the raw-cased input ("moses"/"MOSES"/"pgp"),
		// while chapter/verse already use the DB-proper name. RED before: display is
		// parsed.raw; GREEN after: display is the canonical name.
		const { searchAll } = await import('../search');
		const cases: Array<[string, string]> = [
			['moses', 'Moses'],
			['MOSES', 'Moses'],
			['pgp', 'Pearl of Great Price'],
			['d&c', 'Doctrine and Covenants'],
		];
		for (const [q, expected] of cases) {
			const res = await searchAll(db, {
				q, visibleCollections: ['phase-b'], scope: ['scripture'],
			});
			expect(res.reference?.found, `${q} resolves a reference`).toBe(true);
			expect(res.reference?.display, `${q} → canonical display`).toBe(expected);
		}
	});
});
