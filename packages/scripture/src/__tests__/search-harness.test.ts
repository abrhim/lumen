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
	it('H5: typo melchisedek finds Melchizedek via the production % + word_similarity predicate', async () => {
		// Production form (plan amendment 1): the % operator is index-served at
		// its default threshold; extensions.word_similarity >= 0.45 refines.
		// (SET LOCAL is unusable through Db.execute — single-statement autocommit.)
		const r = await rows(sql`
			SELECT id FROM lumen.entities
			WHERE entity_type = 'person'
			  AND 'melchisedek' OPERATOR(extensions.%) name
			  AND extensions.word_similarity('melchisedek', name) >= 0.45
			ORDER BY extensions.word_similarity('melchisedek', name) DESC, id LIMIT 3`);
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

	it('groups arrive in GROUP_KEYS order on a LIVE unscoped search (decision 5 MUST, B1)', async () => {
		const { searchAll, GROUP_KEYS } = await loadSearch();
		const res = await searchAll(db, { q: 'faith', visibleCollections: ALL_PUBLIC });
		expect(res.groups.map((g: any) => g.key)).toEqual([...GROUP_KEYS]);
	});

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
		// Value pin (amended): 'z%' isolates ILIKE-injection — trgm similarity
		// can't reach any name from 'z', FTS has no 'z' lexeme, so ONLY an
		// unescaped ILIKE 'z%' prefix could return the many Z-names.
		const esc = await searchAll(db, { q: 'z%', visibleCollections: ALL_PUBLIC });
		const people = esc.groups.find((g: any) => g.key === 'people');
		expect(people?.results ?? []).toHaveLength(0);
	});

	it('H10: exact name outranks mentions; duplicate-name pages are deterministic (COR-4)', async () => {
		const { searchAll } = await loadSearch();
		const res = await searchAll(db, { q: 'melchizedek', visibleCollections: ALL_PUBLIC });
		// The PER-3 primary path must actually be the path taken (TESC-1): a broken
		// combined statement would otherwise silently fall back and stay green.
		expect(res.meta.mode).toBe('combined');
		expect(res.meta.combinedError).toBeUndefined();
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
		expect(verse.reference?.found).toBe(true);
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
		const res = await searchAll(db, { q: 'faith', visibleCollections: ALL_PUBLIC });
		const ms = performance.now() - t0;
		// eslint-disable-next-line no-console
		console.log(`H12 latency: ${Math.round(ms)}ms`);
		expect(ms).toBeLessThan(1500);
		expect(res.meta.mode).toBe('combined');
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
		expect(res.meta.mode).toBe('combined');
		expect(res.meta.combinedError).toBeUndefined();
		// Combined mode is one statement — per-group ms is unknowable there and
		// must be null, never the whole-statement elapsed (PER-5/OBS-6).
		for (const [key, m] of Object.entries(res.meta.perGroup)) {
			expect(m.ms, `${key} ms in combined mode`).toBeNull();
		}
	});

	it('H13b: per-kind payload contract — allowlisted keys, coerced numerics (decision 5)', async () => {
		const { searchAll } = await loadSearch();

		const faith = await searchAll(db, { q: 'faith', visibleCollections: ALL_PUBLIC });
		const verse = faith.groups
			.find((g: any) => g.key === 'scripture')!
			.results.find((r: any) => r.type === 'verse');
		expect(verse, 'faith returns a verse').toBeTruthy();
		expect(typeof verse!.payload.verse_id).toBe('string');
		const moment = faith.groups
			.find((g: any) => g.key === 'episodes')!
			.results.find((r: any) => r.type === 'moment');
		expect(moment, 'faith returns a moment').toBeTruthy();
		expect(typeof moment!.payload.episode_id).toBe('string');
		expect(typeof moment!.payload.t_start_s).toBe('number');
		expect(typeof moment!.payload.t_end_s).toBe('number');

		const jst = await searchAll(db, { q: 'JST Genesis', visibleCollections: ALL_PUBLIC });
		const jstRow = jst.groups
			.find((g: any) => g.key === 'scripture')!
			.results.find((r: any) => r.type === 'jst');
		expect(jstRow, 'JST Genesis returns a jst reading').toBeTruthy();
		expect(typeof jstRow!.payload.verse_id).toBe('string');
		expect(jstRow!.payload.variant).toBe('jst');

		const art = await searchAll(db, { q: 'pentecost', visibleCollections: ALL_PUBLIC, scope: ['art'] });
		const artwork = art.groups.find((g: any) => g.key === 'art')!.results[0];
		expect(artwork, 'pentecost returns artwork').toBeTruthy();
		expect(artwork.type).toBe('artwork');
		// Exactly the decision-5 contract — passthrough would ship future
		// projection fields to clients automatically (SEC allowlist).
		expect(Object.keys(artwork.payload).sort()).toEqual(['refs', 'thumbnail_url']);
		expect(typeof artwork.payload.thumbnail_url).toBe('string');
		expect(Array.isArray(artwork.payload.refs)).toBe(true);

		const words = await searchAll(db, { q: 'agape', visibleCollections: ALL_PUBLIC, scope: ['words'] });
		const strongs = words.groups
			.find((g: any) => g.key === 'words')!
			.results.find((r: any) => r.id === 'G26');
		expect(strongs, 'agape returns G26').toBeTruthy();
		expect(strongs!.type).toBe('strongs');
		expect(Object.keys(strongs!.payload)).toEqual(['strongs_no']);
		expect(typeof strongs!.payload.strongs_no).toBe('string');
	});

	it('H17: a failing group degrades to empty results + meta.error — never a throw (COR-1)', async () => {
		const { searchAll, GROUP_RESULT_TYPES } = await loadSearch();
		let poisoned = 0;
		const wrapped = {
			// Brittle-but-deliberate coupling: drizzle serializes raw SQL chunks,
			// so statement text is greppable through JSON.stringify.
			execute: async (q: any) => {
				const text = JSON.stringify(q);
				if (text.includes('entity_degree')) {
					poisoned++;
					// Real elapsed time so the degraded meta must carry it (OBS-5).
					await new Promise((r) => setTimeout(r, 25));
					throw new Error('simulated: relation lumen.entity_degree does not exist');
				}
				return db.execute(q);
			},
		};
		const res = await searchAll(wrapped, { q: 'melchizedek', visibleCollections: ALL_PUBLIC });
		expect(poisoned, 'the poison actually fired').toBeGreaterThan(0);
		expect(res).toHaveProperty('groups');
		// The combined statement was poisoned too: fallback mode, reason captured (OBS-2).
		expect(res.meta.mode).toBe('fallback');
		expect(res.meta.combinedError).toContain('simulated');
		// Poisoned groups: empty WITH error AND real elapsed ms (OBS-5).
		for (const key of ['people', 'places', 'topics']) {
			const m = res.meta.perGroup[key];
			expect(m.hits, `${key} hits`).toBe(0);
			expect(m.error, `${key} error`).toBeTruthy();
			expect(m.ms, `${key} degraded ms is real elapsed`).toBeGreaterThanOrEqual(20);
			expect(res.groups.find((g: any) => g.key === key)?.results).toHaveLength(0);
		}
		// Survivors: populated AND positionally intact — no fallback contamination.
		const scripture = res.groups.find((g: any) => g.key === 'scripture');
		expect((scripture?.results ?? []).length, 'unaffected groups still return').toBeGreaterThan(0);
		for (const key of ['episodes', 'art', 'words'] as const) {
			const g = res.groups.find((x: any) => x.key === key)!;
			expect(g.results.length, `${key} survives a sibling poisoning`).toBeGreaterThan(0);
			for (const r of g.results) {
				expect(GROUP_RESULT_TYPES[key], `${key} carries only its own types`).toContain(r.type);
			}
			expect(res.meta.perGroup[key].error).toBeUndefined();
			expect(typeof res.meta.perGroup[key].ms, `${key} fallback ms is measured`).toBe('number');
		}
	});

	it('H17b: fuzzy episode-title recall — leviticas reaches the Leviticus episode (decision 2 tier-2)', async () => {
		const { searchAll } = await loadSearch();
		// word_similarity('leviticas', title)=0.6999 ≥ 0.45; FTS, prefix and exact
		// all miss — only the trgm tier can serve this (CORC-3 live case).
		const res = await searchAll(db, { q: 'leviticas', visibleCollections: ALL_PUBLIC, scope: ['episodes'] });
		const eps = res.groups.find((g: any) => g.key === 'episodes')?.results ?? [];
		expect(eps.map((r: any) => r.id)).toContain('unshaken-yAQlljeet-0');
		const hit = eps.find((r: any) => r.id === 'unshaken-yAQlljeet-0')!;
		expect(hit.type).toBe('episode');
		expect(hit.tier).toBe(2);
	});

	it('H19: a poisoned payload row degrades its own group, never the search (decision 7)', async () => {
		const { searchAll } = await loadSearch();
		// Combined mode: real statement, words rows corrupted in flight.
		const combinedPoison = {
			execute: async (q: any) => {
				const rows = (await db.execute(q)) as any[];
				return rows.map((r) => (r?.grp === 'words' ? { ...r, payload: '{not-json' } : r));
			},
		};
		const a = await searchAll(combinedPoison, { q: 'agape', visibleCollections: ALL_PUBLIC });
		expect(a.meta.mode).toBe('combined');
		expect(a.groups.find((g: any) => g.key === 'words')?.results).toHaveLength(0);
		expect(a.meta.perGroup.words.hits).toBe(0);
		expect(a.meta.perGroup.words.error, 'poisoned group surfaces in meta').toBeTruthy();

		// Fallback mode: combined fails, the words leg serves a non-JSON payload.
		const badRow = {
			grp: 'words', type: 'strongs', id: 'G0', title: 'poisoned',
			snippet: null, tier: 1, score: 1, payload: '{not-json',
		};
		const fallbackPoison = {
			execute: async (q: any) => {
				const text = JSON.stringify(q);
				const isWords = text.includes(`'words' AS grp`);
				if (isWords && text.includes(`'scripture' AS grp`)) throw new Error('simulated combined failure');
				if (isWords) return [badRow];
				return db.execute(q);
			},
		};
		const b = await searchAll(fallbackPoison, { q: 'faith', visibleCollections: ALL_PUBLIC });
		expect(b.meta.mode).toBe('fallback');
		expect(b.meta.combinedError).toContain('simulated');
		expect(b.groups.find((g: any) => g.key === 'words')?.results).toHaveLength(0);
		expect(b.meta.perGroup.words.error, 'poisoned group surfaces in meta').toBeTruthy();
		expect(
			(b.groups.find((g: any) => g.key === 'scripture')?.results ?? []).length,
			'siblings unaffected by the poisoned row',
		).toBeGreaterThan(0);
	});

	it('H20: delta-only matches still carry ⟪⟫ snippet markers (API-1; believe→believeth class)', async () => {
		const { searchAll } = await loadSearch();
		// 'swore' reaches verses ONLY via kjv_delta (KJV spells it 'sware'; 86
		// verses live) — the flagship Gap-1 path must still highlight (APIC-3).
		const res = await searchAll(db, { q: 'swore', visibleCollections: ALL_PUBLIC, scope: ['scripture'] });
		const results = res.groups.find((g: any) => g.key === 'scripture')?.results ?? [];
		expect(results.length, 'delta recall').toBeGreaterThan(0);
		const withSnippet = results.filter((r: any) => r.snippet);
		expect(withSnippet.length).toBeGreaterThan(0);
		for (const r of withSnippet) {
			expect(r.snippet, `${r.id} delta match must highlight`).toContain('⟪');
		}
		// Control: modern-text matches keep their markers.
		const ctl = await searchAll(db, { q: 'faith', visibleCollections: ALL_PUBLIC, scope: ['scripture'] });
		expect(ctl.groups[0].results[0]?.snippet).toContain('⟪');
	});
});
