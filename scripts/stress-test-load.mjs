// Load half of the data stress test (design: docs/ops/data-stress-test-design.md,
// as amended by the methodology review). DECLARED SCOPE: closed-loop DB-CAPACITY
// test from this machine — NOT user-path latency (users ride Workers→Hyperdrive).
// Throughput is the primary per-rung metric; percentiles are gated on n≥300.
// READ-ONLY enforced at connection STARTUP (survives pooling), not per-session SET.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const RUNGS = [1, 2, 4, 8, 16];
const RUNG_SECONDS = 45;
const WARMUP_DISCARD_S = 5;
const BREAKER_WINDOW_S = 5;
const PCTL_MIN_N = 300;

function pct(sorted, p) {
	if (!sorted.length) return null;
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export async function runLoad({ ROOT, assertReadOnly, log }) {
	const require = createRequire(import.meta.url);
	const postgres = require('postgres');
	const url = readFileSync(join(ROOT, '.env'), 'utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
	const mkConn = (max) =>
		postgres(url, {
			prepare: false,
			max,
			connection: {
				default_transaction_read_only: 'on', // startup GUC — the rail
				statement_timeout: 30000,
			},
		});

	// ── parameter pools (real ids, uniform-random draws) ──────────────────────
	const ctl = mkConn(1);
	const [{ max_conn }] = await ctl.unsafe(assertReadOnly(`SELECT setting::int AS max_conn FROM pg_settings WHERE name = 'max_connections'`));
	log({ event: 'load_env', max_connections: Number(max_conn), harness_peak: RUNGS.at(-1) + 1 });
	const chapters = (await ctl.unsafe(assertReadOnly(`SELECT id FROM lumen.chapters`))).map((r) => r.id);
	const verses = (await ctl.unsafe(assertReadOnly(`SELECT id FROM lumen.verses TABLESAMPLE SYSTEM (5)`))).map((r) => r.id);
	const entities = (await ctl.unsafe(assertReadOnly(`SELECT DISTINCT from_id AS id FROM lumen.edges WHERE from_id LIKE '%-%' LIMIT 5000`))).map((r) => r.id);
	const episodes = (await ctl.unsafe(assertReadOnly(`SELECT id, (metadata->'media'->>'duration_s')::int dur FROM lumen.entities WHERE entity_type = 'content_item'`)));
	const searchTerms = ['faith', 'Hezekiah', 'covenant', 'Kings', 'repentance', 'Elisha', 'temple', 'Jerusalem', 'Samuel', 'wilderness'];
	const strongsNos = (await ctl.unsafe(assertReadOnly(`SELECT strongs_no FROM lumen.strongs_lexicon TABLESAMPLE SYSTEM (10)`))).map((r) => r.strongs_no);
	const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

	// ── the 7 query classes (app-shaped, parameterized) ───────────────────────
	const CLASSES = {
		chapter_page: () => [
			`SELECT v.id, v.text, w.surface, w.position FROM lumen.verses v
			 LEFT JOIN lumen.words w ON w.verse_id = v.id
			 WHERE v.chapter_id = $1 ORDER BY v.id, w.position`,
			[pick(chapters)],
		],
		verse_lookup: () => [`SELECT id, text FROM lumen.verses WHERE id = $1`, [pick(verses)]],
		entity_page: () => [
			`SELECT e.*,
			   (SELECT json_agg(json_build_object('to', ed.to_id, 'rel', ed.rel_type)) FROM lumen.edges ed WHERE ed.from_id = e.id) AS out_edges,
			   (SELECT json_agg(json_build_object('from', ed.from_id, 'rel', ed.rel_type)) FROM lumen.edges ed WHERE ed.to_id = e.id) AS in_edges
			 FROM lumen.entities e WHERE e.id = $1`,
			[pick(entities)],
		],
		transcript_slice: () => {
			const ep = pick(episodes);
			const start = Math.floor(Math.random() * 3000);
			return [
				`SELECT seq, t_start_s, text FROM lumen.transcripts
				 WHERE episode_id = $1 AND seq BETWEEN $2 AND $3 ORDER BY seq`,
				[ep.id, start, start + 500],
			];
		},
		lens_query: () => [
			`SELECT ed.to_id, ed.rel_type, m.value AS mention FROM lumen.edges ed,
			 LATERAL jsonb_array_elements(ed.metadata->'mentions') m
			 WHERE ed.from_id = $1 AND (m->>'confidence')::numeric >= 0.7
			 ORDER BY (m->>'t')::numeric LIMIT 200`,
			[pick(episodes).id],
		],
		// coverage F4: the app's REAL FTS surfaces are verses/entities GINs
		verse_fts: () => [
			`SELECT id, ts_rank(search_vector, q) r FROM lumen.verses, websearch_to_tsquery('english', $1) q
			 WHERE search_vector @@ q ORDER BY r DESC LIMIT 20`,
			[pick(searchTerms)],
		],
		entity_fts: () => [
			`SELECT id, name, ts_rank(search_vector, q) r FROM lumen.entities, websearch_to_tsquery('english', $1) q
			 WHERE search_vector @@ q ORDER BY r DESC LIMIT 20`,
			[pick(searchTerms)],
		],
		// coverage F3: the strongs GIN containment path (738k word_tags)
		strongs_lookup: () => [
			`SELECT w.verse_id, w.position, w.surface FROM lumen.word_tags wt
			 JOIN lumen.words w ON w.id = wt.word_id
			 WHERE wt.strongs @> ARRAY[$1] LIMIT 100`,
			[pick(strongsNos)],
		],
		episode_search: () => [
			`SELECT kind, ref_id, title, ts_rank(tsv, q) r FROM lumen.search_index, websearch_to_tsquery('english', $1) q
			 WHERE tsv @@ q ORDER BY r DESC LIMIT 20`,
			[pick(searchTerms)],
		],
		two_hop: () => [
			`SELECT e2.to_id, e2.rel_type FROM lumen.edges e1
			 JOIN lumen.edges e2 ON e2.from_id = e1.to_id
			 WHERE e1.from_id = $1 LIMIT 500`,
			[pick(entities)],
		],
	};
	const classNames = Object.keys(CLASSES);

	// ── ladder ────────────────────────────────────────────────────────────────
	const rungResults = [];
	let baseline = null; // per-class p95 at 1 client — breaker calibration
	let aborted = false;

	async function runRung(clients, label, withHolders = false) {
		const pool = mkConn(clients);
		const holders = [];
		if (withHolders) {
			for (let i = 0; i < 2; i += 1) {
				const h = mkConn(1);
				holders.push(h);
				// long-lived REPEATABLE READ snapshot across the rung
				h.begin('read only, isolation level repeatable read', async (tx) => {
					await tx.unsafe(assertReadOnly(`SELECT count(*) FROM lumen.collections`));
					await new Promise((r) => setTimeout(r, RUNG_SECONDS * 1000));
					await tx.unsafe(assertReadOnly(`SELECT count(*) FROM lumen.collections`));
				}).catch((e) => log({ event: 'holder_error', error: e.message.slice(0, 120) }));
			}
		}
		const samples = Object.fromEntries(classNames.map((c) => [c, []]));
		let errors = 0;
		let timeouts = 0;
		let total = 0;
		const started = performance.now();
		const endAt = started + RUNG_SECONDS * 1000;
		const windowStats = [];
		let breakerTrips = 0;

		const client = async () => {
			while (performance.now() < endAt && !aborted) {
				const cls = pick(classNames);
				const [text, params] = CLASSES[cls]();
				const t0 = performance.now();
				try {
					await pool.unsafe(assertReadOnly(text), params);
					const ms = performance.now() - t0;
					if (performance.now() - started > WARMUP_DISCARD_S * 1000) {
						samples[cls].push(ms);
						total += 1;
					}
				} catch (e) {
					errors += 1;
					if (/timeout|canceling statement/i.test(e.message)) timeouts += 1;
				}
			}
		};
		// breaker: 5s windows; error-rate (timeouts included) >5% OR any class
		// p95 > max(10× its baseline, 3000ms) for two consecutive windows
		const breaker = (async () => {
			let consecutive = 0;
			while (performance.now() < endAt && !aborted) {
				await new Promise((r) => setTimeout(r, BREAKER_WINDOW_S * 1000));
				const windowErrRate = total + errors > 0 ? errors / (total + errors) : 0;
				let classBreach = false;
				for (const c of classNames) {
					const s = [...samples[c]].sort((a, b) => a - b);
					const p95 = pct(s, 95);
					const limit = Math.max((baseline?.[c] ?? 300) * 10, 3000);
					if (p95 !== null && s.length >= 20 && p95 > limit) classBreach = true;
				}
				if (windowErrRate > 0.05 || classBreach) {
					consecutive += 1;
					if (consecutive >= 2) {
						aborted = true;
						breakerTrips += 1;
						log({ event: 'breaker_tripped', rung: label, err_rate: +windowErrRate.toFixed(3) });
					}
				} else consecutive = 0;
				windowStats.push({ t: Math.round((performance.now() - started) / 1000), errRate: +windowErrRate.toFixed(3) });
			}
		})();
		await Promise.all([...Array.from({ length: clients }, client), breaker]);
		await pool.end();
		await Promise.all(holders.map((h) => h.end()));

		const perClass = {};
		for (const c of classNames) {
			const s = [...samples[c]].sort((a, b) => a - b);
			perClass[c] = {
				n: s.length,
				p50: +(pct(s, 50) ?? 0).toFixed(1),
				p95: +(pct(s, 95) ?? 0).toFixed(1),
				...(s.length >= PCTL_MIN_N ? { p99: +(pct(s, 99) ?? 0).toFixed(1) } : { p99: null, p99_note: `n<${PCTL_MIN_N}` }),
				max: +(s.at(-1) ?? 0).toFixed(1),
			};
		}
		const rung = {
			label,
			clients,
			seconds: RUNG_SECONDS,
			throughput_qps: +(total / (RUNG_SECONDS - WARMUP_DISCARD_S)).toFixed(1),
			queries: total,
			errors,
			timeouts,
			aborted,
			perClass,
		};
		rungResults.push(rung);
		log({ event: 'rung_done', label, qps: rung.throughput_qps, errors, timeouts });
		return perClass;
	}

	// baseline first (calibrates the breaker), then the ladder ascending, then
	// rung-2 repeated for a variance bound. Holders ride the 8-client rung.
	const base = await runRung(1, 'baseline-1');
	baseline = Object.fromEntries(classNames.map((c) => [c, base[c].p95 || 300]));
	for (const clients of RUNGS.slice(1)) {
		if (aborted) break;
		await runRung(clients, `rung-${clients}`, clients === 8);
	}
	if (!aborted) await runRung(2, 'rung-2-repeat');

	// ── L2 pathological inputs (single client, after the ladder) ──────────────
	const patho = [];
	const pathoCases = [
		['huge_search_string', `SELECT count(*) FROM lumen.search_index WHERE tsv @@ websearch_to_tsquery('english', $1)`, ['x'.repeat(10000)]],
		['tsquery_specials', `SELECT count(*) FROM lumen.search_index WHERE tsv @@ websearch_to_tsquery('english', $1)`, ['!&|:*()<->\'"']],
		['unicode_dashes', `SELECT count(*) FROM lumen.verses WHERE text LIKE $1`, ['%–—−%']],
		['empty_string_search', `SELECT count(*) FROM lumen.search_index WHERE tsv @@ websearch_to_tsquery('english', $1)`, ['']],
		['thousand_id_in_list', `SELECT count(*) FROM lumen.verses WHERE id = ANY($1)`, [verses.slice(0, 1000)]],
		['deep_offset', `SELECT id FROM lumen.words ORDER BY id OFFSET 100000 LIMIT 10`, []],
		['absent_jsonb_path', `SELECT count(*) FROM lumen.edges WHERE metadata->'nope'->>'missing' = 'x'`, []],
	];
	for (const [name, text, params] of pathoCases) {
		const t0 = performance.now();
		let status = 'graceful';
		let note = null;
		try {
			await ctl.unsafe(assertReadOnly(text), params);
		} catch (e) {
			status = /timeout/i.test(e.message) ? 'timeout' : 'graceful-error';
			note = e.message.slice(0, 80);
		}
		const ms = +(performance.now() - t0).toFixed(1);
		patho.push({ name, status: ms > 10000 ? 'slow' : status, ms, note });
		log({ event: 'patho', name, ms, status });
	}
	await ctl.end();
	return { rungs: rungResults, pathological: patho, aborted };
}
