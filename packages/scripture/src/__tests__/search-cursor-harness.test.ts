/**
 * search-ui harness — keyset cursor, LIVE DB (F1, F5, F15, F16 core).
 * RED-FIRST: `after`/`nextCursor`/cursor codecs do not exist in search.ts yet —
 * every pin below fails on a missing export or missing behavior, never on a
 * test bug. Runs as lumen_read like search-harness.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SearchOptions } from '../search';

/** RED-FIRST: `after` lands in SearchOptions with the implementation; the
 * intersection keeps these call sites compiling on both sides of that edit. */
type CursorOptions = SearchOptions & { after?: string };

function loadDsn(): string {
	// CU-2: same key the sibling search-harness.test.ts reads — apps/web/.env
	// has no DATABASE_URL, only the Hyperdrive local connection string.
	const env = readFileSync(join(__dirname, '../../../../apps/web/.env'), 'utf8');
	const m = env.match(/^CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=(.+)$/m);
	if (!m) throw new Error('no Hyperdrive DSN in apps/web/.env');
	return m[1].trim();
}

let client: ReturnType<typeof postgres>;
let db: any;

beforeAll(async () => {
	client = postgres(loadDsn(), { max: 1, prepare: false, ssl: 'require' });
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

describe('F1/F5/F15 — keyset continuity on the live verse corpus', () => {
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

describe('F16 — cursor visibility re-gate (SU-1/SU-2)', () => {
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
