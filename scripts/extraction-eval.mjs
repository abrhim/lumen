// Eval checkpoint builder + scorer (unshaken-extraction A2, panel-2 EV-A1..A6).
//   node --import tsx scripts/extraction-eval.mjs --build --round=1
//   node --import tsx scripts/extraction-eval.mjs --score --round=1
// Everything derives DETERMINISTICALLY from (extraction artifacts, round):
// --build writes stripped+shuffled shard packets and NO answer key;
// --score re-runs the same derivation to recompute the key (EV-A2 — the key
// is never persisted where an evaluator could read it).
// Exit 0 ok, 1 fatal, 2 gate-fail/void.
import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { scrubSecrets, writeArtifactAtomic } from './ingest-podcast/util.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'data', 'podcasts', 'unshaken');
const SHOW = 'unshaken';
const EPISODES = JSON.parse(readFileSync(join(DIR, 'episodes.json'), 'utf8')).episodes.map((e) => e.id);

// gate strata (plan §eval, Decisions A5): pass = point ≥ gate AND Wilson LB
// ≥ gate−0.08 AND n ≥ floor. Trap floor: ≥2 missed traps of a stratum VOIDS it.
const STRATA = {
	verseChapter: { kinds: ['verse', 'chapter'], gate: 0.9, nFloor: 30, sampleN: 60 },
	entity: { kinds: ['person', 'place', 'event'], gate: 0.85, nFloor: 30, sampleN: 60 },
	principle: { kinds: ['principle'], gate: 0.8, nFloor: 25, sampleN: 40 },
};
const GOLD_COUNT = 4;

function mulberry32(a) {
	return function rng() {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function wilsonLB(p, n, z = 1.96) {
	if (n === 0) return 0;
	const z2 = z * z;
	return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

function shuffle(arr, rng) {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i -= 1) {
		const j = Math.floor(rng() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function loadArtifacts() {
	const artifacts = new Map();
	for (const id of EPISODES) {
		const p = join(DIR, `${id}.extraction.json`);
		if (!existsSync(p)) throw new Error(`missing extraction artifact for ${id} — run --stage=extract-merge`);
		artifacts.set(id, JSON.parse(readFileSync(p, 'utf8')));
	}
	return artifacts;
}

function transcriptLines(id) {
	return readFileSync(join(DIR, `${id}.transcript.txt`), 'utf8').split('\n');
}

/** The single deterministic derivation both --build and --score run.
 * Returns items WITH trap/gold labeling — build strips before writing. */
export function deriveRound(artifacts, round, { verseExistsByEpisode, blockChaptersByEpisode }) {
	const episodeHashes = Object.fromEntries(
		[...artifacts.entries()].map(([id, a]) => [a.episodeId, a.contentHash]),
	);
	const seedHex = createHash('sha256')
		.update(Object.values(episodeHashes).sort().join('|') + ':round-' + round)
		.digest('hex');
	const rng = mulberry32(parseInt(seedHex.slice(0, 8), 16));

	// flatten mentions with provenance
	const all = [];
	for (const [vid, a] of artifacts.entries()) {
		for (const m of a.mentions) {
			all.push({ ...m, videoId: vid, episodeId: a.episodeId });
		}
	}
	const byKind = new Map();
	for (const m of all) {
		if (!byKind.has(m.kind)) byKind.set(m.kind, []);
		byKind.get(m.kind).push(m);
	}

	// stratum samples (per-episode cap so one 3.6h episode can't dominate)
	const items = [];
	const pickedKeys = new Set();
	const keyOf = (m) => `${m.episodeId}|${m.kind}|${m.target}|${m.seq}`;
	for (const [name, s] of Object.entries(STRATA)) {
		const pool = shuffle(
			s.kinds.flatMap((k) => byKind.get(k) ?? []),
			rng,
		);
		const perEpisode = new Map();
		const cap = Math.ceil((s.sampleN / EPISODES.length) * 2.5);
		let taken = 0;
		for (const m of pool) {
			if (taken >= s.sampleN) break;
			const k = keyOf(m);
			if (pickedKeys.has(k)) continue;
			const epn = perEpisode.get(m.episodeId) ?? 0;
			if (epn >= cap) continue;
			pickedKeys.add(k);
			perEpisode.set(m.episodeId, epn + 1);
			items.push({ ...m, stratum: name, role: 'sample' });
			taken += 1;
		}
	}

	// golds: chapter mentions whose quote contains an explicit "chapter N" —
	// correct by construction (title-anchored timeline evidence)
	const goldPool = shuffle(
		(byKind.get('chapter') ?? []).filter((m) => /\bchapter\s+\w+/i.test(m.quote) && !pickedKeys.has(keyOf(m))),
		rng,
	);
	for (const m of goldPool.slice(0, GOLD_COUNT)) {
		pickedKeys.add(keyOf(m));
		items.push({ ...m, stratum: 'verseChapter', role: 'gold' });
	}

	// traps: target-swapped REAL mentions riding ON TOP of sample n (EV-A2).
	// per-stratum minimum 3 so the per-kind trap floor (A4) is measurable.
	const trapCount = 10 + Math.floor(rng() * 5);
	const perStratumMin = { verseChapter: 3, entity: 3, principle: 3 };
	const trapPlan = [];
	for (const [name, min] of Object.entries(perStratumMin)) for (let i = 0; i < min; i += 1) trapPlan.push(name);
	while (trapPlan.length < trapCount) {
		trapPlan.push(Object.keys(STRATA)[Math.floor(rng() * 3)]);
	}
	for (const stratum of trapPlan) {
		const s = STRATA[stratum];
		const pool = shuffle(
			s.kinds.flatMap((k) => byKind.get(k) ?? []).filter((m) => !pickedKeys.has(keyOf(m))),
			rng,
		);
		let planted = false;
		for (const m of pool) {
			let swapped = null;
			if (m.kind === 'verse') {
				const vnum = Number(m.target.match(/-(\d+)$/)?.[1]);
				const chapter = m.target.replace(/-\d+$/, '');
				const candidates = (blockChaptersByEpisode.get(m.videoId) ?? [])
					.filter((c) => c !== chapter && verseExistsByEpisode.get(m.videoId)?.has(`${c}-${vnum}`));
				if (candidates.length) swapped = `${candidates[Math.floor(rng() * candidates.length)]}-${vnum}`;
			} else if (m.kind === 'chapter') {
				const candidates = (blockChaptersByEpisode.get(m.videoId) ?? []).filter((c) => c !== m.target);
				if (candidates.length) swapped = candidates[Math.floor(rng() * candidates.length)];
			} else {
				const sameKind = (byKind.get(m.kind) ?? []).map((x) => x.target).filter((t) => t !== m.target);
				if (sameKind.length) swapped = sameKind[Math.floor(rng() * sameKind.length)];
			}
			if (!swapped) continue;
			pickedKeys.add(keyOf(m));
			items.push({ ...m, target: swapped, stratum, role: 'trap', originalTarget: m.target });
			planted = true;
			break;
		}
		if (!planted) continue;
	}

	// deterministic ids AFTER the full set exists, then a final shuffle
	const shuffled = shuffle(items, rng);
	shuffled.forEach((it, i) => {
		it.id = `r${round}-i${String(i).padStart(3, '0')}`;
	});
	return { items: shuffled, episodeHashes, seedHex };
}

function buildEvidence(item, ctx) {
	const lines = ctx.transcripts.get(item.videoId);
	const context = lines.slice(Math.max(0, item.seq - 2), item.seq + 3);
	let precedingCue = null;
	for (let i = item.seq; i >= 0 && i > item.seq - 400; i -= 1) {
		if (/\b(chapter|kings|section|samuel|chronicles|joshua|judges)\b/i.test(lines[i] ?? '')) {
			precedingCue = lines[i];
			break;
		}
	}
	const base = { context, precedingCue };
	if (item.kind === 'verse') {
		const vnum = Number(item.target.match(/-(\d+)$/)[1]);
		const claimed = ctx.verseText.get(item.target) ?? null;
		const alternatives = {};
		for (const c of ctx.blockChaptersByEpisode.get(item.videoId) ?? []) {
			const vid = `${c}-${vnum}`;
			if (vid !== item.target && ctx.verseText.has(vid)) alternatives[vid] = ctx.verseText.get(vid);
		}
		return { ...base, claimedVerseText: claimed, sameVerseNumberInOtherChapters: alternatives };
	}
	if (item.kind === 'chapter') {
		return { ...base, blockChapters: ctx.blockChaptersByEpisode.get(item.videoId) ?? [] };
	}
	if (item.kind === 'principle') {
		const e = ctx.entityInfo.get(item.target);
		return {
			...base,
			principleName: e?.name ?? item.target,
			principleDescription: e?.description ?? null,
			rubric: 'The quote must CONTAIN THE TEACHING, not merely the topic word.',
		};
	}
	const e = ctx.entityInfo.get(item.target);
	return {
		...base,
		entityName: e?.name ?? item.target,
		entityDescription: e?.description ?? null,
		episodeRoster: (ctx.rosterByEpisode.get(item.videoId) ?? []).slice(0, 60),
	};
}

async function buildContext(sql, artifacts) {
	const { anchorsForBlock } = await import('./ingest-podcast/parse-title.mjs');
	const episodesMeta = JSON.parse(readFileSync(join(DIR, 'episodes.json'), 'utf8')).episodes;
	const bookRows = await sql`SELECT id, name FROM lumen.books`;
	const chapterRows = await sql`SELECT book_id, count(*)::int AS n FROM lumen.chapters GROUP BY book_id`;
	const lookup = {
		bookIdByName: Object.fromEntries(bookRows.map((b) => [b.name, b.id])),
		chapterCount: Object.fromEntries(chapterRows.map((c) => [c.book_id, Number(c.n)])),
	};
	const blockChaptersByEpisode = new Map();
	for (const ep of episodesMeta) blockChaptersByEpisode.set(ep.id, anchorsForBlock(ep.spans, lookup));
	const allChapters = [...new Set([...blockChaptersByEpisode.values()].flat())];
	const verseRows = await sql`SELECT id, chapter_id, text FROM lumen.verses WHERE chapter_id = ANY(${allChapters})`;
	const verseText = new Map(verseRows.map((v) => [v.id, v.text]));
	const verseExistsByEpisode = new Map();
	for (const [vid, chapters] of blockChaptersByEpisode.entries()) {
		verseExistsByEpisode.set(vid, new Set(verseRows.filter((v) => chapters.includes(v.chapter_id)).map((v) => v.id)));
	}
	const targetIds = [...new Set([...artifacts.values()].flatMap((a) => a.mentions.map((m) => m.target)))];
	const entityRows = await sql`SELECT id, name, description, entity_type FROM lumen.entities WHERE id = ANY(${targetIds})`;
	const entityInfo = new Map(entityRows.map((e) => [e.id, e]));
	const rosterByEpisode = new Map();
	for (const [vid, a] of artifacts.entries()) {
		rosterByEpisode.set(
			vid,
			[...new Set(a.mentions.filter((m) => ['person', 'place', 'event'].includes(m.kind)).map((m) => m.target))].map(
				(id) => entityInfo.get(id)?.name ?? id,
			),
		);
	}
	const transcripts = new Map(EPISODES.map((id) => [id, transcriptLines(id)]));
	return { verseText, verseExistsByEpisode, blockChaptersByEpisode, entityInfo, rosterByEpisode, transcripts };
}

const SHARD_SIZE = 12;

async function build(sql, round) {
	const artifacts = loadArtifacts();
	const ctx = await buildContext(sql, artifacts);
	const derived = deriveRound(artifacts, round, ctx);
	const rng = mulberry32(parseInt(derived.seedHex.slice(8, 16), 16));

	const outDir = join(DIR, 'eval', `round-${round}`);
	mkdirSync(outDir, { recursive: true });

	// shard by stratum, then add ~10% cross-shard duplicates (EV-A3.5)
	const shards = [];
	for (const stratum of Object.keys(STRATA)) {
		const items = derived.items.filter((i) => i.stratum === stratum);
		for (let i = 0; i < items.length; i += SHARD_SIZE) shards.push(items.slice(i, i + SHARD_SIZE));
	}
	for (let i = 0; i < shards.length; i += 1) {
		const other = shards[(i + 1) % shards.length];
		if (other.length) shards[i] = [...shards[i], other[Math.floor(rng() * other.length)]];
	}

	const strip = (it) => ({
		id: it.id,
		kind: it.kind,
		episodeId: it.episodeId,
		seq: it.seq,
		t: it.t,
		quote: it.quote,
		target: it.target,
		confidence: it.confidence,
		evidence: buildEvidence(it, ctx),
	});
	shards.forEach((shard, i) => {
		writeArtifactAtomic(
			join(outDir, `shard-${String(i).padStart(2, '0')}.json`),
			JSON.stringify({ round, shard: i, items: shard.map(strip) }, null, 1),
			{ writeFileSync, renameSync },
		);
	});
	writeArtifactAtomic(
		join(outDir, 'meta.json'),
		JSON.stringify(
			{ round, shards: shards.length, itemsTotal: derived.items.length, episodeHashes: derived.episodeHashes },
			null,
			1,
		),
		{ writeFileSync, renameSync },
	);
	console.log(
		JSON.stringify({ event: 'eval_built', round, shards: shards.length, items: derived.items.length, dir: outDir }),
	);
}

async function score(sql, round) {
	const artifacts = loadArtifacts();
	const ctx = await buildContext(sql, artifacts);
	const derived = deriveRound(artifacts, round, ctx); // recomputed answer key
	const outDir = join(DIR, 'eval', `round-${round}`);
	const meta = JSON.parse(readFileSync(join(outDir, 'meta.json'), 'utf8'));
	if (JSON.stringify(meta.episodeHashes) !== JSON.stringify(derived.episodeHashes)) {
		throw new Error('extraction artifacts changed since --build — stale eval (PW-A6); rebuild the round');
	}

	const verdicts = new Map(); // id → [verdict,...] (duplicates collect)
	for (let i = 0; i < meta.shards; i += 1) {
		const p = join(outDir, `shard-${String(i).padStart(2, '0')}.verdict.json`);
		if (!existsSync(p)) throw new Error(`missing verdict for shard ${i} — run the unshaken-eval workflow`);
		for (const v of JSON.parse(readFileSync(p, 'utf8')).verdicts) {
			if (!verdicts.has(v.id)) verdicts.set(v.id, []);
			verdicts.get(v.id).push(v.verdict);
		}
	}

	const report = { round, strata: {}, traps: {}, golds: { total: 0, rejected: 0 }, duplicates: { pairs: 0, disagreements: 0 }, voided: [] };
	for (const [id, vs] of verdicts.entries()) {
		if (vs.length > 1) {
			report.duplicates.pairs += 1;
			if (new Set(vs).size > 1) report.duplicates.disagreements += 1;
		}
	}
	const verdictOf = (id) => {
		const vs = verdicts.get(id);
		if (!vs?.length) return 'missing';
		// duplicates: any 'wrong' wins (conservative)
		if (vs.includes('wrong')) return 'wrong';
		if (vs.includes('insufficient-evidence')) return 'insufficient-evidence';
		return vs[0];
	};

	for (const [name, s] of Object.entries(STRATA)) {
		const sample = derived.items.filter((i) => i.stratum === name && i.role === 'sample');
		const traps = derived.items.filter((i) => i.stratum === name && i.role === 'trap');
		let correct = 0;
		let wrong = 0;
		let insufficient = 0;
		let missing = 0;
		const perEpisode = {};
		for (const it of sample) {
			const v = verdictOf(it.id);
			perEpisode[it.episodeId] = perEpisode[it.episodeId] ?? { n: 0, correct: 0 };
			perEpisode[it.episodeId].n += 1;
			if (v === 'correct') {
				correct += 1;
				perEpisode[it.episodeId].correct += 1;
			} else if (v === 'wrong') wrong += 1;
			else if (v === 'insufficient-evidence') insufficient += 1;
			else missing += 1;
		}
		const n = sample.length - missing;
		const point = n ? correct / n : 0;
		const lb = wilsonLB(point, n);
		const trapsCaught = traps.filter((t) => verdictOf(t.id) === 'wrong').length;
		const trapsMissed = traps.length - trapsCaught;
		const voided = trapsMissed >= 2;
		if (voided) report.voided.push(name);
		report.traps[name] = { planted: traps.length, caught: trapsCaught, missed: trapsMissed };
		report.strata[name] = {
			n,
			correct,
			wrong,
			insufficient,
			missing,
			point: +point.toFixed(4),
			wilsonLB: +lb.toFixed(4),
			gate: s.gate,
			pass: !voided && point >= s.gate && lb >= s.gate - 0.08 && n >= s.nFloor,
			perEpisode,
		};
	}
	const golds = derived.items.filter((i) => i.role === 'gold');
	report.golds.total = golds.length;
	report.golds.rejected = golds.filter((g) => verdictOf(g.id) === 'wrong').length;
	const evalVoid = report.golds.rejected >= 2;
	if (evalVoid) report.voided.push('ALL(golds-rejected — evaluator over-strict)');

	const passed = !evalVoid && report.voided.length === 0 && Object.values(report.strata).every((s) => s.pass);
	const evalPromptHash = createHash('sha256')
		.update(readFileSync(join(ROOT, 'docs/features/unshaken-extraction/eval-prompt.md')))
		.digest('hex');
	writeArtifactAtomic(join(outDir, 'report.json'), JSON.stringify(report, null, 1), { writeFileSync, renameSync });
	writeArtifactAtomic(
		join(DIR, 'eval-verdict.json'),
		JSON.stringify(
			{ round, passed, strata: Object.fromEntries(Object.entries(report.strata).map(([k, v]) => [k, { point: v.point, wilsonLB: v.wilsonLB, n: v.n, pass: v.pass }])), episodeHashes: derived.episodeHashes, evalPromptHash },
			null,
			1,
		),
		{ writeFileSync, renameSync },
	);
	console.log(JSON.stringify({ event: 'eval_scored', round, passed, voided: report.voided, strata: report.strata && Object.fromEntries(Object.entries(report.strata).map(([k, v]) => [k, `${v.correct}/${v.n} point=${v.point} lb=${v.wilsonLB} pass=${v.pass}`])), traps: report.traps, golds: report.golds, duplicates: report.duplicates }));
	return passed;
}

async function main() {
	const round = Number(process.argv.find((a) => a.startsWith('--round='))?.slice(8) ?? 1);
	const mode = process.argv.includes('--build') ? 'build' : process.argv.includes('--score') ? 'score' : null;
	if (!mode) {
		console.error('usage: extraction-eval.mjs --build|--score --round=N');
		process.exit(1);
	}
	let sql;
	try {
		const url = readFileSync(join(ROOT, '.env'), 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
		if (!url) throw new Error('DATABASE_URL not found in root .env');
		const require = createRequire(import.meta.url);
		sql = require('postgres')(url, { prepare: false, max: 1 });
	} catch (err) {
		console.error('FATAL:', scrubSecrets(err.message));
		process.exit(1);
	}
	try {
		if (mode === 'build') await build(sql, round);
		else {
			const passed = await score(sql, round);
			await sql.end();
			process.exit(passed ? 0 : 2);
		}
		await sql.end();
	} catch (err) {
		console.error('FATAL:', scrubSecrets(err.message));
		await sql.end();
		process.exit(1);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
