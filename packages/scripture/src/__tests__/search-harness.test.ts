import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

// Harness (search-endpoint, step 3; amended at step 6 synthesis — see plan.md
// ## Decisions). Runs read-only against LIVE prod as lumen_read ONLY (SEC-6:
// no admin fallback — the SELECT-only credential is the write backstop and the
// grants probe). Fixtures are live-picked and pinned; hostile inputs carried
// per the user-roles lesson. H14/H18 live in apps/web api-search.test.ts.
//
// Visibility note (SEC-1/COR-9 resolution): ALL 8 collections including
// unshaken are public=true in prod by deliberate decision (2026-07-21 launch).
// H8 tests the *mechanism* with synthetic visibleCollections lists.

const here = dirname(fileURLToPath(import.meta.url));

function loadDsn(): string {
	const txt = readFileSync(resolve(here, '../../../../apps/web/.env'), 'utf8');
	const m = txt.match(/^CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=(.+)$/m);
	if (!m) throw new Error('search-harness: lumen_read DSN not found in apps/web/.env');
	return m[1].trim();
}

let client: ReturnType<typeof postgres>;
let db: { execute(q: unknown): Promise<any> };

beforeAll(async () => {
	client = postgres(loadDsn(), { prepare: false, ssl: 'require', max: 1 });
	const d = drizzle(client);
	db = { execute: (q: unknown) => d.execute(q as any) };
	const who = await client`select current_user`;
	// SEC-6: the harness must exercise the app role's actual grants.
	expect(who[0].current_user).toMatch(/^lumen_read/);
});

afterAll(async () => {
	await client.end({ timeout: 5 });
});

const rows = async (q: any) => (await db.execute(q)) as any[];

const ALL_PUBLIC = ['canon', 'jst', 'naves', 'openbible', 'phase-b', 'strongs', 'art', 'unshaken'];
const NO_UNSHAKEN = ALL_PUBLIC.filter((c) => c !== 'unshaken');
const NO_JST = ALL_PUBLIC.filter((c) => c !== 'jst');

describe('M2 — KJV delta-index (verses + entities)', () => {
	it('H1: modern query matches archaic verse — believe → John 3:16 (believeth)', async () => {
		const r = await rows(sql`
			SELECT id FROM lumen.verses
			WHERE search_vector @@ plainto_tsquery('english', 'believe') AND id = 'john-3-16'`);
		expect(r).toHaveLength(1);
	});

	it('H2: superset floors — verses AND entities keep pre-change match sets (Ring-2)', async () => {
		// Floors pinned live 2026-07-21 pre-M2: believeth=59, spake=782, faith=810,
		// entities shepherd=233, jerusalem=1686.
		const r = await rows(sql`SELECT
			(SELECT count(*)::int FROM lumen.verses WHERE search_vector @@ plainto_tsquery('english','believeth')) AS believeth,
			(SELECT count(*)::int FROM lumen.verses WHERE search_vector @@ plainto_tsquery('english','spake')) AS spake,
			(SELECT count(*)::int FROM lumen.verses WHERE search_vector @@ plainto_tsquery('english','faith')) AS faith,
			(SELECT count(*)::int FROM lumen.entities WHERE search_vector @@ plainto_tsquery('english','shepherd')) AS shepherd,
			(SELECT count(*)::int FROM lumen.entities WHERE search_vector @@ plainto_tsquery('english','jerusalem')) AS jerusalem`);
		expect(r[0].believeth).toBeGreaterThanOrEqual(59);
		expect(r[0].spake).toBeGreaterThanOrEqual(782);
		expect(r[0].faith).toBeGreaterThanOrEqual(810);
		expect(r[0].shepherd).toBeGreaterThanOrEqual(233);
		expect(r[0].jerusalem).toBeGreaterThanOrEqual(1686);
		const j = await rows(sql`
			SELECT id FROM lumen.verses
			WHERE search_vector @@ plainto_tsquery('english', 'believeth') AND id = 'john-3-16'`);
		expect(j).toHaveLength(1);
	});

	it('H3: irregular + orthographic classes — spoke→spake verse; show reaches shew verses', async () => {
		const r = await rows(sql`
			SELECT id FROM lumen.verses
			WHERE search_vector @@ plainto_tsquery('english', 'spoke') AND id = '1-chr-15-16'`);
		expect(r).toHaveLength(1);
		// shew=358 / show=175 were disjoint pre-M2; post-M2 'show' must reach shew verses.
		const s = await rows(sql`
			SELECT count(*)::int AS n FROM lumen.verses
			WHERE search_vector @@ plainto_tsquery('english', 'show')`);
		expect(s[0].n).toBeGreaterThanOrEqual(358 + 175);
	});

	it('H16: kjv_delta is empty on modern text; pinned pairs map to intended lexemes', async () => {
		const ident = await rows(
			sql`SELECT lumen.kjv_delta('For God so loved the world that whoever believes') AS t`,
		);
		expect(ident[0].t.trim()).toBe('');
		// Base-form targets (REL-1): target lexeme must equal the modern QUERY lexeme.
		const pins: Array<[string, string]> = [
			['believeth', 'believ'],
			['spake', 'spoke'],
			['loveth', 'love'],
			['crieth', 'cri'],
			['sware', 'swore'],
			['goeth', 'go'],
			['shew', 'show'],
		];
		for (const [variant, lexeme] of pins) {
			const r = await rows(
				sql`SELECT to_tsvector('english', lumen.kjv_delta(${variant})) @@ to_tsquery('english', ${lexeme}) AS hit`,
			);
			expect(r[0].hit, `${variant} should map to lexeme ${lexeme}`).toBe(true);
		}
	});
});

describe('M1 — trgm fuzzy tier (production predicate form, PER-1/PER-8)', () => {
	it('H5: typo melchisedek finds Melchizedek via the <% operator at threshold 0.45', async () => {
		// Production form: SET LOCAL threshold + index-servable operator, schema-qualified
		// (lumen_read search_path lacks the extensions schema).
		const r = await client.begin(async (tx) => {
			await tx`SELECT set_config('pg_trgm.word_similarity_threshold', '0.45', true)`;
			return tx`
				SELECT id FROM lumen.entities
				WHERE entity_type = 'person' AND 'melchisedek' OPERATOR(extensions.<%) name
				ORDER BY extensions.word_similarity('melchisedek', name) DESC, id LIMIT 3`;
		});
		expect(r.map((x: any) => x.id)).toContain('melchizedek-1');
	});
});

describe('M3 — transcript moments in search_index', () => {
	it('H4: phrase spanning a caption boundary matches a moment (seq 100/101 of 4pSrikfJ5Yw)', async () => {
		const r = await rows(sql`
			SELECT ref_id FROM lumen.search_index
			WHERE kind = 'moment'
			  AND tsv @@ websearch_to_tsquery('english', '"glorious sequel, the millennial reign"')`);
		expect(r.length).toBeGreaterThanOrEqual(1);
	});

	it('H15: windows form an exact chain over each episode caption sequence (COR-7)', async () => {
		const eps = await rows(sql`
			SELECT episode_id, count(*)::int AS captions, min(seq)::int AS min_seq, max(seq)::int AS max_seq
			FROM lumen.transcripts GROUP BY episode_id`);
		expect(eps.length).toBeGreaterThanOrEqual(10);
		for (const e of eps) {
			const w = await rows(sql`
				SELECT (payload->>'seq_start')::int AS s, (payload->>'seq_end')::int AS e
				FROM lumen.search_index
				WHERE kind = 'moment' AND payload->>'episode_id' = ${e.episode_id}
				ORDER BY (payload->>'seq_start')::int`);
			expect(w.length, `episode ${e.episode_id} has windows`).toBeGreaterThan(0);
			expect(w[0].s, `first window starts at min seq`).toBe(e.min_seq);
			expect(w[w.length - 1].e, `last window ends at max seq`).toBe(e.max_seq);
			for (let i = 1; i < w.length; i++) {
				expect(w[i].s, `chain gap in ${e.episode_id} before window ${i}`).toBe(w[i - 1].e + 1);
			}
		}
	});

	it('H15b: episode payloads repaired — objects with episode_id key, never double-encoded (SEC-8)', async () => {
		const r = await rows(sql`
			SELECT ref_id, jsonb_typeof(payload) AS t,
			       (payload ? 'episode_id')::bool AS has_key
			FROM lumen.search_index WHERE kind = 'episode'`);
		expect(r.length).toBeGreaterThanOrEqual(10);
		for (const row of r) {
			expect(row.t, `${row.ref_id} payload must be an object`).toBe('object');
			expect(row.has_key, `${row.ref_id} payload must carry episode_id`).toBe(true);
		}
	});
});

describe('M4 — projections', () => {
	it('H6: artwork searchable by scene keywords — pentecost → met-471845', async () => {
		const r = await rows(sql`
			SELECT ref_id FROM lumen.search_index
			WHERE kind = 'artwork' AND ref_id = 'art:met-471845'
			  AND tsv @@ websearch_to_tsquery('english', 'pentecost')`);
		expect(r).toHaveLength(1);
	});

	it('H7: strongs projection — agape (unaccented at projection time) → G26; H3068 present', async () => {
		const g = await rows(sql`
			SELECT ref_id FROM lumen.search_index
			WHERE kind = 'strongs' AND tsv @@ websearch_to_tsquery('english', 'agape')`);
		expect(g.map((x: any) => x.ref_id)).toContain('G26');
		const h = await rows(
			sql`SELECT ref_id FROM lumen.search_index WHERE kind = 'strongs' AND ref_id = 'H3068'`,
		);
		expect(h).toHaveLength(1);
	});

	it('H7b: projection rows are always collection-stamped (SEC-7 fail-closed)', async () => {
		const r = await rows(sql`
			SELECT count(*)::int AS n FROM lumen.search_index
			WHERE kind IN ('moment','artwork','strongs') AND collection_id IS NULL`);
		expect(r[0].n).toBe(0);
	});
});

describe('M5 — searchAll contract', () => {
	const loadSearch = () => import('../search');

	it('H8: visibility is a hard filter, fails closed, and gates the JST leg (SEC-3)', async () => {
		const { searchAll } = await loadSearch();
		const hidden = await searchAll(db, { q: 'Halverson', visibleCollections: NO_UNSHAKEN });
		expect(hidden.groups.find((g: any) => g.key === 'episodes')?.results ?? []).toHaveLength(0);

		const shown = await searchAll(db, { q: 'Halverson', visibleCollections: ALL_PUBLIC });
		expect(
			(shown.groups.find((g: any) => g.key === 'episodes')?.results ?? []).length,
		).toBeGreaterThan(0);

		// JST leg: visible → jst-typed results for a JST-distinctive query…
		const jstOn = await searchAll(db, { q: 'JST Genesis', visibleCollections: ALL_PUBLIC });
		const scriptureOn = jstOn.groups.find((g: any) => g.key === 'scripture');
		expect(scriptureOn?.results?.some((r: any) => r.type === 'jst')).toBe(true);
		// …hidden → none, even though the group itself still returns canon.
		const jstOff = await searchAll(db, { q: 'JST Genesis', visibleCollections: NO_JST });
		const scriptureOff = jstOff.groups.find((g: any) => g.key === 'scripture');
		expect(scriptureOff?.results?.every((r: any) => r.type !== 'jst')).toBe(true);

		// Fail-closed: nothing visible → canon verses only, everywhere.
		const closed = await searchAll(db, { q: 'faith', visibleCollections: [] });
		for (const g of closed.groups) {
			if (g.key === 'scripture') {
				expect(g.results.every((r: any) => r.type === 'verse')).toBe(true);
			} else {
				expect(g.results, `group ${g.key} must be empty when nothing is visible`).toHaveLength(0);
			}
		}
	});

	it('H9: hostile inputs — contract shapes, never throw; wildcard metachars are literal (SEC-5)', async () => {
		const { searchAll } = await loadSearch();
		const hostiles = [
			`'; DROP TABLE lumen.verses; --`,
			`faith & hope | !charity`,
			`"unbalanced ( quote`,
			`%_\\%`,
			`__proto__ toString constructor`,
			'x'.repeat(200),
			'אב שלום',
			'😀🔥',
		];
		for (const q of hostiles) {
			const res = await searchAll(db, { q, visibleCollections: ALL_PUBLIC });
			expect(res, `q=${q.slice(0, 20)}`).toHaveProperty('groups');
			expect(Array.isArray(res.groups)).toBe(true);
		}
		// Value pin: '%'/'_' must be literal — 'mel%' has no exact/prefix hit
		// (tier 1–2); only fuzzy tiers may return anything.
		const esc = await searchAll(db, { q: 'mel%', visibleCollections: ALL_PUBLIC });
		const people = esc.groups.find((g: any) => g.key === 'people');
		expect((people?.results ?? []).every((r: any) => r.tier > 2)).toBe(true);
	});

	it('H10: exact name outranks mentions; duplicate-name pages are deterministic (COR-4)', async () => {
		const { searchAll } = await loadSearch();
		const res = await searchAll(db, { q: 'melchizedek', visibleCollections: ALL_PUBLIC });
		expect(res.groups.find((g: any) => g.key === 'people')?.results?.[0]?.id).toBe('melchizedek-1');
		expect(res.groups.find((g: any) => g.key === 'topics')?.results?.[0]?.id).toBe(
			'naves-melchizedek',
		);
		const a = await searchAll(db, { q: 'zechariah', visibleCollections: ALL_PUBLIC });
		const b = await searchAll(db, { q: 'zechariah', visibleCollections: ALL_PUBLIC });
		expect(a.groups.find((g: any) => g.key === 'people')?.results?.map((r: any) => r.id)).toEqual(
			b.groups.find((g: any) => g.key === 'people')?.results?.map((r: any) => r.id),
		);
	});

	it('H11: short-circuit only on RESOLVABLE refs; unresolvable falls through (COR-6)', async () => {
		const { searchAll } = await loadSearch();
		const verse = await searchAll(db, { q: 'alma 32:21', visibleCollections: ALL_PUBLIC });
		expect(verse.reference).not.toBeNull();
		expect(verse.reference.found).toBe(true);
		expect(verse.groups.every((g: any) => g.results.length === 0)).toBe(true);

		const bogus = await searchAll(db, { q: 'john 99', visibleCollections: ALL_PUBLIC });
		expect(bogus.reference).toBeNull();
		expect(bogus.groups.some((g: any) => g.results.length > 0)).toBe(true);

		const book = await searchAll(db, { q: 'john', visibleCollections: ALL_PUBLIC });
		expect(book.reference).not.toBeNull();
		expect(book.groups.some((g: any) => g.results.length > 0)).toBe(true);
	});

	it('H12: federated search latency smoke (laptop→pooler < 1500ms; prod p95 is log-measured)', async () => {
		const { searchAll } = await loadSearch();
		await searchAll(db, { q: 'warmup', visibleCollections: ALL_PUBLIC });
		const t0 = performance.now();
		await searchAll(db, { q: 'faith', visibleCollections: ALL_PUBLIC });
		const ms = performance.now() - t0;
		// eslint-disable-next-line no-console
		console.log(`H12 latency: ${Math.round(ms)}ms`);
		expect(ms).toBeLessThan(1500);
	});

	it('H13: payloads are objects and numerics are numbers across ALL kinds (API-6/SEC-8)', async () => {
		const { searchAll } = await loadSearch();
		const res = await searchAll(db, {
			q: 'millennial reign',
			visibleCollections: ALL_PUBLIC,
		});
		let sawMoment = false;
		for (const g of res.groups) {
			for (const r of g.results) {
				expect(typeof r.payload, `${g.key}/${r.id} payload`).toBe('object');
				expect(typeof r.score, `${g.key}/${r.id} score`).toBe('number');
				if (r.payload?.t_start_s !== undefined) {
					sawMoment = true;
					expect(typeof r.payload.t_start_s).toBe('number');
				}
			}
		}
		expect(sawMoment, 'expected at least one timestamped moment').toBe(true);
	});

	it('H17: a failing group degrades to empty results + meta.error — never a throw (COR-1)', async () => {
		const { searchAll } = await loadSearch();
		let poisoned = 0;
		const wrapped = {
			execute: async (q: any) => {
				const text = JSON.stringify(q);
				if (text.includes('entity_degree')) {
					poisoned++;
					throw new Error('simulated: relation lumen.entity_degree does not exist');
				}
				return db.execute(q);
			},
		};
		const res = await searchAll(wrapped, { q: 'melchizedek', visibleCollections: ALL_PUBLIC });
		expect(poisoned, 'the poison actually fired').toBeGreaterThan(0);
		expect(res).toHaveProperty('groups');
		const scripture = res.groups.find((g: any) => g.key === 'scripture');
		expect((scripture?.results ?? []).length, 'unaffected groups still return').toBeGreaterThan(0);
		expect(
			Object.values(res.meta.perGroup).some((m: any) => m.error),
			'failed group surfaces in meta',
		).toBe(true);
	});
});
