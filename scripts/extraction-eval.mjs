// Eval checkpoint builder + scorer (unshaken-extraction A2, panel-2 EV-A1..A6).
//   node --import tsx scripts/extraction-eval.mjs --build --round=1
//   node --import tsx scripts/extraction-eval.mjs --score --round=1
// Everything derives DETERMINISTICALLY from (extraction artifacts, round):
// --build writes stripped+shuffled shard packets and NO answer key;
// --score re-runs the same derivation to recompute the key (EV-A2 — the key
// is never persisted where an evaluator could read it).
// Exit 0 ok, 1 fatal, 2 gate-fail/void.
import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { scrubSecrets, writeArtifactAtomic } from './ingest-podcast/util.mjs';
import { spokenNumberToInt } from './ingest-podcast/extract-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Parameterized by --show (second-show): resolved in main() BEFORE any
// derivation runs; every reader below goes through these. The eval PROMPT
// and its drift baseline stay shared across shows deliberately — the
// evaluator rubric is show-independent, so one hash pin guards all shows.
let DIR = join(ROOT, 'data', 'podcasts', 'unshaken');
let EPISODES = [];

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

	// stratum samples (per-episode cap so one 3.6h episode can't dominate).
	// F17/A5: per-kind sub-floors — kinds with pool ≥ 15 get ≥ 15 items so a
	// thin kind (events) can't hide inside a pooled stratum gate.
	const items = [];
	const pickedKeys = new Set();
	const keyOf = (m) => `${m.episodeId}|${m.kind}|${m.target}|${m.seq}`;
	const poolSizes = {};
	for (const [name, s] of Object.entries(STRATA)) {
		const perEpisode = new Map();
		const cap = Math.ceil((s.sampleN / EPISODES.length) * 2.5);
		let taken = 0;
		const takeFrom = (pool, limit) => {
			for (const m of pool) {
				if (taken >= s.sampleN || limit <= 0) break;
				const k = keyOf(m);
				if (pickedKeys.has(k)) continue;
				const epn = perEpisode.get(m.episodeId) ?? 0;
				if (epn >= cap) continue;
				pickedKeys.add(k);
				perEpisode.set(m.episodeId, epn + 1);
				items.push({ ...m, stratum: name, role: 'sample' });
				taken += 1;
				limit -= 1;
			}
		};
		for (const k of s.kinds) {
			const kindPool = byKind.get(k) ?? [];
			poolSizes[k] = kindPool.length;
			if (s.kinds.length > 1 && kindPool.length >= 15) {
				takeFrom(shuffle(kindPool, rng), 15);
			}
		}
		takeFrom(shuffle(s.kinds.flatMap((k) => byKind.get(k) ?? []), rng), s.sampleN);
	}

	// golds: chapter mentions whose quote SAYS the chapter number the target
	// claims — F6: correct-by-construction requires the number-to-target
	// check, not just the word "chapter" appearing.
	const goldPool = shuffle(
		(byKind.get('chapter') ?? []).filter((m) => {
			if (pickedKeys.has(keyOf(m))) return false;
			const qm = m.quote.match(/\bchapter\s+(\d{1,3}|[a-z]+(?:[ -][a-z]+)?)\b/i);
			if (!qm) return false;
			const spoken = spokenNumberToInt(qm[1]);
			const targetNum = Number(m.target.match(/-(\d+)$/)?.[1]);
			return Number.isInteger(spoken) && spoken === targetNum;
		}),
		rng,
	);
	for (const m of goldPool.slice(0, GOLD_COUNT)) {
		pickedKeys.add(keyOf(m));
		items.push({ ...m, stratum: 'verseChapter', role: 'gold' });
	}

	// traps: target-swapped REAL mentions riding ON TOP of sample n (EV-A2).
	// R-eval-machinery-1: planting quotas are per-KIND — a kind with 0-1
	// traps can never trip the ≥2-missed void floor, making the floor
	// structurally unmeasurable for exactly that kind.
	const kindsWithPool = [...byKind.keys()].filter((k) => (byKind.get(k) ?? []).length >= 10);
	const trapPlan = kindsWithPool.flatMap((k) => [k, k]); // 2 per measurable kind
	const trapCount = Math.max(trapPlan.length, 10 + Math.floor(rng() * 5));
	while (trapPlan.length < trapCount) {
		trapPlan.push(kindsWithPool[Math.floor(rng() * kindsWithPool.length)]);
	}
	const stratumOfKind = (k) =>
		Object.entries(STRATA).find(([, s]) => s.kinds.includes(k))[0];
	for (const kind of trapPlan) {
		const stratum = stratumOfKind(kind);
		const pool = shuffle(
			(byKind.get(kind) ?? []).filter((m) => !pickedKeys.has(keyOf(m))),
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
				// F22: swap within the SAME episode's roster — a cross-episode
				// entity is absent from the packet roster and trivially caught.
				const sameKind = [
					...new Set(
						(byKind.get(m.kind) ?? [])
							.filter((x) => x.videoId === m.videoId)
							.map((x) => x.target),
					),
				].filter((t) => t !== m.target);
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
	// F4: the answer key is recomputed at score time from live DB + spans —
	// hash the key components at build so score can PROVE the derivation
	// reproduced identically instead of silently diverging.
	const keyHash = createHash('sha256')
		.update(
			JSON.stringify(
				shuffled.map((it) => ({ id: it.id, role: it.role, target: it.target, o: it.originalTarget ?? null })),
			),
		)
		.digest('hex');
	return { items: shuffled, episodeHashes, seedHex, keyHash, poolSizes, trapPlanned: trapPlan.length };
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
	for (const ep of episodesMeta) {
		if (ep.spans == null) {
			// no-block (verbatim shows): the chapters the episode actually CITED
			// stand in for the block everywhere downstream — verse traps swap
			// into other cited chapters, chapter traps swap among them, and
			// evidence alternatives come from them. Derivation stays
			// deterministic: cited chapters come from the artifact itself.
			const a = artifacts.get(ep.id);
			const cited = a
				? [...new Set(a.mentions.filter((m) => m.kind === 'chapter').map((m) => m.target))].sort()
				: [];
			blockChaptersByEpisode.set(ep.id, cited);
		} else {
			blockChaptersByEpisode.set(ep.id, anchorsForBlock(ep.spans, lookup));
		}
	}
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
	// F5 + R-eval-machinery-3: purge verdicts AND stale packets/reports — a
	// rebuild with fewer shards leaves colliding-id packets the evaluator
	// workflow could pick up.
	for (const f of readdirSync(outDir)) {
		if (f.endsWith('.verdict.json') || /^shard-\d+\.json$/.test(f) || f === 'report.json') {
			rmSync(join(outDir, f));
		}
	}

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
			{
				round,
				shards: shards.length,
				itemsTotal: derived.items.length,
				episodeHashes: derived.episodeHashes,
				keyHash: derived.keyHash,
				trapPlanned: derived.trapPlanned,
			},
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
	// F4: prove the key recomputed IDENTICALLY — derivation also depends on
	// live DB pools + episodes.json spans, which episodeHashes don't cover.
	// R-eval-machinery-2: an absent baseline must WARN, never silently skip.
	if (!meta.keyHash) {
		console.log(JSON.stringify({ event: 'keyhash_absent_legacy_round', round }));
	} else if (meta.keyHash !== derived.keyHash) {
		throw new Error('answer-key derivation diverged since --build (DB or spans changed) — rebuild the round');
	}
	// F24: the evaluators ran from the hash-pinned prompt file — assert the
	// file still matches the drift baseline before trusting any verdict.
	const baselineHash = readFileSync(join(ROOT, 'docs/features/unshaken-extraction/plan.md'), 'utf8')
		.match(/^- eval-prompt-hash: ([0-9a-f]{64})$/m)?.[1];
	const promptHashNow = createHash('sha256')
		.update(readFileSync(join(ROOT, 'docs/features/unshaken-extraction/eval-prompt.md')))
		.digest('hex');
	if (!baselineHash) {
		// R-eval-machinery-2: a missing stamp disables the drift check — refuse
		throw new Error('eval-prompt-hash stamp not found in plan.md drift baseline — restore it before scoring');
	}
	if (baselineHash !== promptHashNow) {
		throw new Error('eval-prompt.md drifted from the stamped baseline — re-baseline before scoring');
	}

	const VALID_VERDICTS = new Set(['correct', 'wrong', 'insufficient-evidence']);
	const verdicts = new Map(); // id → [{verdict, anchor_ok}...] (duplicates collect)
	let invalidEntries = 0;
	for (let i = 0; i < meta.shards; i += 1) {
		const p = join(outDir, `shard-${String(i).padStart(2, '0')}.verdict.json`);
		if (!existsSync(p)) throw new Error(`missing verdict for shard ${i} — run the unshaken-eval workflow`);
		for (const v of JSON.parse(readFileSync(p, 'utf8')).verdicts ?? []) {
			// F18 + R-eval-machinery-6: schema-validate INCLUDING anchor_ok — a
			// missing field must not silently zero the F20 metric.
			if (!v || typeof v.id !== 'string' || !VALID_VERDICTS.has(v.verdict) || typeof v.anchor_ok !== 'boolean') {
				invalidEntries += 1;
				continue;
			}
			if (!verdicts.has(v.id)) verdicts.set(v.id, []);
			verdicts.get(v.id).push({ verdict: v.verdict, anchor_ok: v.anchor_ok });
		}
	}
	// F18: every derived item must have a valid verdict — a selectively lazy
	// evaluator must fail the scoring run, not inflate precision.
	const unjudged = derived.items.filter((it) => !verdicts.has(it.id));
	if (unjudged.length || invalidEntries) {
		throw new Error(
			`scoring refused: ${unjudged.length} item(s) without valid verdicts, ${invalidEntries} invalid entries — fix the evaluator run`,
		);
	}

	const report = {
		round,
		seedHex: derived.seedHex,
		evaluator: { model: 'claude-fable-5 (session-inherited)', effort: 'high', promptHash: promptHashNow },
		strata: {},
		perKind: {},
		traps: {},
		trapPlanned: meta.trapPlanned ?? null,
		anchorIssues: 0,
		golds: { total: 0, rejected: 0 },
		duplicates: { pairs: 0, disagreements: 0 },
		voided: [],
	};
	for (const vs of verdicts.values()) {
		if (vs.length > 1) {
			report.duplicates.pairs += 1;
			if (new Set(vs.map((v) => v.verdict)).size > 1) report.duplicates.disagreements += 1;
		}
	}
	const verdictOf = (id) => {
		const vs = verdicts.get(id).map((v) => v.verdict);
		if (vs.includes('wrong')) return 'wrong'; // duplicates: conservative
		if (vs.includes('insufficient-evidence')) return 'insufficient-evidence';
		return vs[0];
	};
	// F20: anchor problems tracked as their own count, never precision failures
	for (const it of derived.items) {
		if (verdicts.get(it.id).some((v) => v.anchor_ok === false)) report.anchorIssues += 1;
	}

	for (const [name, s] of Object.entries(STRATA)) {
		const sample = derived.items.filter((i) => i.stratum === name && i.role === 'sample');
		const traps = derived.items.filter((i) => i.stratum === name && i.role === 'trap');
		let correct = 0;
		let wrong = 0;
		let insufficient = 0;
		const perEpisode = {};
		for (const it of sample) {
			const v = verdictOf(it.id);
			perEpisode[it.episodeId] = perEpisode[it.episodeId] ?? { n: 0, correct: 0 };
			perEpisode[it.episodeId].n += 1;
			if (v === 'correct') {
				correct += 1;
				perEpisode[it.episodeId].correct += 1;
			} else if (v === 'wrong') wrong += 1;
			else insufficient += 1;
		}
		const n = sample.length;
		const point = n ? correct / n : 0;
		const lb = wilsonLB(point, n);
		// F17: trap floor per KIND (plan A4) — a stratum-pooled floor lets
		// exactly the principle traps be the missed ones. ≥2 missed traps of
		// any kind voids the CONTAINING stratum.
		let voided = false;
		const trapByKind = {};
		for (const t of traps) {
			trapByKind[t.kind] = trapByKind[t.kind] ?? { planted: 0, caught: 0, missed: 0 };
			trapByKind[t.kind].planted += 1;
			if (verdictOf(t.id) === 'wrong') trapByKind[t.kind].caught += 1;
			else trapByKind[t.kind].missed += 1;
		}
		for (const [kind, tk] of Object.entries(trapByKind)) {
			if (tk.missed >= 2) {
				voided = true;
				report.voided.push(`${name}(kind:${kind} traps)`);
			}
		}
		// F17/A5: per-kind sub-floors — every kind with a mention pool ≥ 15
		// must carry n ≥ 15 in the sample, or the stratum is not evaluable.
		const kindNs = {};
		for (const it of sample) kindNs[it.kind] = (kindNs[it.kind] ?? 0) + 1;
		let subFloorFail = false;
		for (const k of s.kinds) {
			report.perKind[k] = { n: kindNs[k] ?? 0, pool: derived.poolSizes[k] ?? 0 };
			if (s.kinds.length > 1 && (derived.poolSizes[k] ?? 0) >= 15 && (kindNs[k] ?? 0) < 15) {
				subFloorFail = true;
				report.voided.push(`${name}(kind:${k} n=${kindNs[k] ?? 0} < 15 sub-floor)`);
			}
		}
		report.traps[name] = { byKind: trapByKind, planted: traps.length };
		report.strata[name] = {
			n,
			correct,
			wrong,
			insufficient,
			point: +point.toFixed(4),
			wilsonLB: +lb.toFixed(4),
			gate: s.gate,
			pass: !voided && !subFloorFail && point >= s.gate && lb >= s.gate - 0.08 && n >= s.nFloor,
			perEpisode,
		};
	}
	const golds = derived.items.filter((i) => i.role === 'gold');
	report.golds.total = golds.length;
	report.golds.rejected = golds.filter((g) => verdictOf(g.id) === 'wrong').length;
	const evalVoid = report.golds.rejected >= 2;
	if (evalVoid) report.voided.push('ALL(golds-rejected — evaluator over-strict)');

	// F23: silent trap under-fill would weaken the floor without anyone
	// noticing — surface planted-vs-planned in the report and the log.
	const planted = derived.items.filter((i) => i.role === 'trap').length;
	report.trapPlantedActual = planted;
	if (meta.trapPlanned && planted < meta.trapPlanned) {
		console.log(JSON.stringify({ event: 'trap_underfill', planned: meta.trapPlanned, planted }));
	}
	const passed = !evalVoid && report.voided.length === 0 && Object.values(report.strata).every((s) => s.pass);
	const evalPromptHash = promptHashNow;
	writeArtifactAtomic(join(outDir, 'report.json'), JSON.stringify(report, null, 1), { writeFileSync, renameSync });
	writeArtifactAtomic(
		join(DIR, 'eval-verdict.json'),
		JSON.stringify(
			{
				round,
				passed,
				strata: Object.fromEntries(
					Object.entries(report.strata).map(([k, v]) => [k, { point: v.point, wilsonLB: v.wilsonLB, n: v.n, pass: v.pass }]),
				),
				episodeHashes: derived.episodeHashes,
				evalPromptHash,
				seedHex: derived.seedHex,
				evaluator: report.evaluator,
			},
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
	const show = process.argv.find((a) => a.startsWith('--show='))?.slice(7) ?? 'unshaken';
	if (!mode) {
		console.error('usage: extraction-eval.mjs --build|--score --round=N [--show=<id>]');
		process.exit(1);
	}
	if (!/^[a-z0-9-]+$/.test(show)) {
		console.error(`unsafe show id: ${show}`);
		process.exit(1);
	}
	DIR = join(ROOT, 'data', 'podcasts', show);
	EPISODES = JSON.parse(readFileSync(join(DIR, 'episodes.json'), 'utf8')).episodes.map((e) => e.id);
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
