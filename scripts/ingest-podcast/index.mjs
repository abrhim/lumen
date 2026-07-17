// Runner (unshaken-ingest A1) — the orchestration SHELL over tested cores.
//   node --import tsx scripts/ingest-podcast/index.mjs --show=unshaken
//     [--stage=discover|fetch|transcribe|load] [--episode=<videoId>]
//     [--dry-run] [--refresh]
// Default: all stages, pipelined per-episode chains with per-resource pools
// (Amendment 1). Skip-if-VALID resumability (H10). Exit 0 ok, 1 fatal,
// 2 partial (some episodes failed — house convention).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

import { UNSHAKEN } from './shows/unshaken.mjs';
import { scrubSecrets, childEnv, assertVideoId, runPool } from './util.mjs';
import { filterEpisodes, isValidEpisodesArtifact, enrichEpisode } from './discover.mjs';
import { bestAudioArgs, assertDownloadedId, isValidAudioArtifact } from './fetch.mjs';
import { buildDeepgramRequest, validateUtterances, utterancesToRows } from './transcribe.mjs';
import { parseTitle, anchorsForBlock } from './parse-title.mjs';
import { buildLoadPlan } from './load.mjs';

const pExecFile = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOWS = { unshaken: UNSHAKEN };

function log(event, data = {}) {
	console.log(JSON.stringify({ event, ...data }));
}
function fatal(err, context) {
	console.error(JSON.stringify({ event: 'fatal', context, error: scrubSecrets(err?.message ?? String(err)) }));
	process.exit(1);
}

function args() {
	const out = { stage: null, episode: null, dryRun: false, refresh: false, show: 'unshaken' };
	for (const a of process.argv.slice(2)) {
		if (a === '--dry-run') out.dryRun = true;
		else if (a === '--refresh') out.refresh = true;
		else if (a.startsWith('--stage=')) out.stage = a.slice(8);
		else if (a.startsWith('--episode=')) out.episode = assertVideoId(a.slice(10));
		else if (a.startsWith('--show=')) out.show = a.slice(7);
		else fatal(new Error(`unknown flag ${a}`), 'args');
	}
	return out;
}

// ── stage: discover ─────────────────────────────────────────────────────────

async function discover(show, dir, { dryRun, refresh }) {
	const artifact = join(dir, 'episodes.json');
	if (!refresh && existsSync(artifact)) {
		const cached = JSON.parse(readFileSync(artifact, 'utf8'));
		if (isValidEpisodesArtifact(cached, show)) {
			log('discover_skip', { reason: 'valid_artifact', episodes: cached.episodes.length });
			return cached.episodes;
		}
		log('discover_stale', { reason: 'artifact_invalid' });
	}
	const { stdout } = await pExecFile(
		'yt-dlp',
		['--flat-playlist', '--print', '%(id)s\t%(duration)s\t%(upload_date)s\t%(title)s',
			'-I', `1:${show.discoverScanLimit}`, show.channelUrl],
		{ env: childEnv(process.env), maxBuffer: 16 * 1024 * 1024 },
	);
	const raw = stdout.trim().split('\n').map((line) => {
		const [id, duration, upload_date, ...title] = line.split('\t');
		return { id, duration: Number(duration) || null, upload_date, title: title.join('\t') };
	});
	const episodes = filterEpisodes(raw, show).map(enrichEpisode);
	if (episodes.length !== show.episodeCount) {
		throw new Error(`discover found ${episodes.length}/${show.episodeCount} episodes in first ${show.discoverScanLimit} uploads`);
	}
	if (dryRun) {
		log('discover_dry_run', { would_write: artifact, episodes: episodes.length });
	} else {
		writeFileSync(artifact, JSON.stringify({ episodes }, null, 1));
		log('discover_done', { total: episodes.length, artifact });
	}
	return episodes;
}

// ── stage: fetch (one episode) ──────────────────────────────────────────────

const stat = (p) => {
	try {
		const s = statSync(p);
		return { exists: true, size: s.size };
	} catch {
		return { exists: false, size: 0 };
	}
};

async function fetchEpisode(ep, dir, { dryRun }) {
	const out = join(dir, `${ep.id}.m4a`);
	if (isValidAudioArtifact(out, stat)) {
		log('fetch_skip', { episode: ep.id, reason: 'valid_artifact' });
		return out;
	}
	if (dryRun) {
		log('fetch_dry_run', { episode: ep.id, would_write: out });
		return out;
	}
	const { stdout } = await pExecFile('yt-dlp', bestAudioArgs(ep.id, out), {
		env: childEnv(process.env),
		maxBuffer: 64 * 1024 * 1024,
	});
	const meta = JSON.parse(stdout.trim().split('\n').at(-1));
	assertDownloadedId(meta, ep.id);
	if (!isValidAudioArtifact(out, stat)) throw new Error(`fetch produced no valid artifact for ${ep.id}`);
	log('fetch_done', { episode: ep.id, bytes: stat(out).size });
	return out;
}

// ── stage: transcribe (one episode) ─────────────────────────────────────────

async function transcribeEpisode(ep, dir, show, keyterms, { dryRun }) {
	const artifact = join(dir, `${ep.id}.deepgram.json`);
	const audioPath = join(dir, `${ep.id}.m4a`);
	if (existsSync(artifact)) {
		try {
			const cached = JSON.parse(readFileSync(artifact, 'utf8'));
			validateUtterances(cached, { durationS: ep.durationS, tailToleranceS: show.tailToleranceS });
			log('transcribe_skip', { episode: ep.id, reason: 'valid_artifact' });
			return cached;
		} catch (err) {
			log('transcribe_stale', { episode: ep.id, reason: scrubSecrets(err.message) });
		}
	}
	const req = buildDeepgramRequest({
		apiKey: process.env.DEEPGRAM_API_KEY,
		keyterms,
	});
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(req.query)) {
		if (Array.isArray(v)) v.forEach((item) => qs.append(k, item));
		else qs.set(k, v);
	}
	if (dryRun) {
		log('transcribe_dry_run', {
			episode: ep.id, url: req.url, query_bytes: qs.toString().length,
			keyterms: req.query.keyterm.length, audio_present: existsSync(audioPath),
		});
		return null;
	}
	const size = stat(audioPath).size;
	log('transcribe_upload_start', { episode: ep.id, bytes: size });
	const res = await fetch(`${req.url}?${qs}`, {
		method: req.method,
		headers: { ...req.headers, 'Content-Length': String(size) },
		body: createReadStream(audioPath),
		duplex: 'half',
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Deepgram ${res.status}: ${scrubSecrets(body.slice(0, 300))}`);
	}
	const dg = await res.json();
	validateUtterances(dg, { durationS: ep.durationS, tailToleranceS: show.tailToleranceS });
	writeFileSync(artifact, JSON.stringify(dg));
	const billed = dg?.metadata?.duration ?? null;
	log('transcribe_done', { episode: ep.id, utterances: dg.results.utterances.length, billed_seconds: billed });
	return dg;
}

// ── stage: load (one episode) ───────────────────────────────────────────────

async function loadEpisode(sql, ep, dg, show, lookup, { dryRun }) {
	const parsed = parseTitle(ep.title);
	const chapterIds = anchorsForBlock(parsed.spans, lookup);
	const rows = utterancesToRows(dg, `${show.id}-${ep.id}`);
	const plan = buildLoadPlan(
		{ videoId: ep.id, title: ep.title, subtitle: ep.subtitle, spans: ep.spans, uploadDate: ep.uploadDate, durationS: ep.durationS },
		rows, chapterIds, show,
	);
	if (dryRun) {
		log('load_dry_run', { episode: ep.id, ...plan.summary });
		return plan.summary;
	}
	await sql.begin(async (tx) => {
		for (const s of plan.statements) {
			const values = s.values.map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
			await tx.unsafe(s.text, values);
		}
	});
	log('load_done', { episode: ep.id, ...plan.summary });
	return plan.summary;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
	const opts = args();
	const show = SHOWS[opts.show];
	if (!show) fatal(new Error(`unknown show ${opts.show}`), 'args');
	const dir = join(ROOT, 'data', 'podcasts', show.id);
	mkdirSync(dir, { recursive: true });

	const require = createRequire(import.meta.url);
	const postgres = require('postgres');
	const dsn = readFileSync(join(ROOT, '.env'), 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
	if (!dsn) fatal(new Error('DATABASE_URL not found in root .env'), 'env');
	const sql = postgres(dsn, { prepare: false, max: 2 });

	try {
		// discover (serial, once)
		let episodes = await discover(show, dir, opts);
		if (opts.episode) episodes = episodes.filter((e) => e.id === opts.episode);
		if (opts.stage === 'discover') return finish(0);

		// live lookups (COR-7): books + chapter counts from the spine
		const bookRows = await sql`SELECT id, name FROM lumen.books`;
		const chapterRows = await sql`SELECT book_id, count(*)::int AS n FROM lumen.chapters GROUP BY book_id`;
		const lookup = {
			bookIdByName: Object.fromEntries(bookRows.map((b) => [b.name, b.id])),
			chapterCount: Object.fromEntries(chapterRows.map((c) => [c.book_id, Number(c.n)])),
		};
		// keyterm pool (Q5): top window persons/places by edge count
		const keytermRows = await sql`
      SELECT e.name FROM lumen.entities e
      JOIN lumen.edges ed ON ed.from_id = e.id OR ed.to_id = e.id
      WHERE e.entity_type IN ('person','place')
      GROUP BY e.name ORDER BY count(*) DESC LIMIT ${show.keytermMax}`;
		const keyterms = keytermRows.map((r) => r.name);
		log('keyterms_ready', { count: keyterms.length });

		// REL-3: largest episode transcribes FIRST as the upload probe
		const byDuration = [...episodes].sort((a, b) => (b.durationS ?? 0) - (a.durationS ?? 0));
		const probe = byDuration[0];

		const results = { ok: [], failed: [] };
		const runChain = async (ep, { skipTranscribe = false } = {}) => {
			await fetchEpisode(ep, dir, opts);
			if (opts.stage === 'fetch') return;
			if (skipTranscribe) return;
			const dg = await transcribeEpisode(ep, dir, show, keyterms, opts);
			if (opts.stage === 'transcribe' || dg === null) return;
			await loadEpisode(sql, ep, dg, show, lookup, opts);
		};

		// probe chain completes its transcription before the rest transcribe;
		// remaining fetches may proceed underneath (fetch pool below).
		log('probe_start', { episode: probe.id, duration_s: probe.durationS });
		try {
			await runChain(probe);
			results.ok.push(probe.id);
		} catch (err) {
			results.failed.push(probe.id);
			log('episode_failed', { episode: probe.id, error: scrubSecrets(err.message) });
			if (!opts.dryRun) {
				log('probe_failed_abort', { note: 'REL-3: upload mechanics unproven; aborting batch' });
				return finish(2);
			}
		}

		const rest = episodes.filter((e) => e.id !== probe.id);
		// pipelined: fetch pool feeds a transcribe pool; loads run serially
		// inside each chain (fast, and pool caps make ordering deterministic-ish)
		const fetchPool = show.pools.fetch;
		const transcribePool = show.pools.transcribe;
		const transcribeQueue = [];
		const fetchResults = await runPool(
			rest.map((ep) => async () => {
				await fetchEpisode(ep, dir, opts);
				if (opts.stage !== 'fetch') transcribeQueue.push(ep);
				return ep.id;
			}),
			fetchPool,
		);
		for (const [i, r] of fetchResults.entries()) {
			if (!r.ok) {
				results.failed.push(rest[i].id);
				log('episode_failed', { episode: rest[i].id, stage: 'fetch', error: scrubSecrets(r.error.message) });
			}
		}
		if (opts.stage !== 'fetch') {
			const chainResults = await runPool(
				transcribeQueue.map((ep) => async () => {
					const dg = await transcribeEpisode(ep, dir, show, keyterms, opts);
					if (opts.stage !== 'transcribe' && dg !== null) {
						await loadEpisode(sql, ep, dg, show, lookup, opts);
					}
					return ep.id;
				}),
				transcribePool,
			);
			for (const [i, r] of chainResults.entries()) {
				if (r.ok) results.ok.push(r.value);
				else {
					results.failed.push(transcribeQueue[i].id);
					log('episode_failed', { episode: transcribeQueue[i].id, error: scrubSecrets(r.error.message) });
				}
			}
		}

		log('run_done', { ok: results.ok.length, failed: results.failed.length, dry_run: opts.dryRun });
		return finish(results.failed.length > 0 ? 2 : 0);
	} catch (err) {
		console.error(JSON.stringify({ event: 'fatal', error: scrubSecrets(err?.message ?? String(err)) }));
		return finish(1);
	}

	async function finish(code) {
		await sql.end();
		process.exit(code);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
