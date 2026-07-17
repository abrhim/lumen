// Runner (unshaken-ingest A1) — the orchestration SHELL over tested cores.
//   node --import tsx scripts/ingest-podcast/index.mjs --show=unshaken
//     [--stage=discover|fetch|transcribe|load] [--episode=<videoId>]
//     [--dry-run] [--refresh]
// Concurrency (Amendment 1 + B8): rest FETCHES run concurrently with the
// probe chain; the probe must COMPLETE transcription before other
// transcriptions start (REL-3 gate); loads run inside the chain pool (≤pool
// concurrent — documented in plan amendment 3). Stage-scoped runs never
// cascade into earlier paid stages (B7): missing prerequisites fail with an
// actionable error. Skip-if-VALID resumability (H10). The runner OWNS a
// per-invocation log file (B1) — invoke it bare, no tee. Exit 0 ok, 1 fatal,
// 2 partial.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

import { UNSHAKEN } from './shows/unshaken.mjs';
import {
	scrubSecrets,
	childEnv,
	runPool,
	makeScrubber,
	writeArtifactAtomic,
	makeRunLogPath,
	summarizeResults,
} from './util.mjs';
import { parseArgs, checkEpisodeArg } from './cli.mjs';
import { filterEpisodes, isValidEpisodesArtifact, enrichEpisode } from './discover.mjs';
import { bestAudioArgs, assertDownloadedId, isValidAudioArtifact } from './fetch.mjs';
import { buildDeepgramRequest, validateUtterances, utterancesToRows } from './transcribe.mjs';
import { parseTitle, anchorsForBlock } from './parse-title.mjs';
import { buildLoadPlan } from './load.mjs';

const pExecFile = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOWS = { unshaken: UNSHAKEN };

// B1/B9: runner-owned sink + timestamps on every event.
let logSink = null;
function log(event, data = {}) {
	const line = JSON.stringify({ event, at: Date.now(), ...data });
	console.log(line);
	logSink?.write(`${line}\n`);
}
function fatal(err, context, scrub = scrubSecrets) {
	const line = JSON.stringify({
		event: 'fatal',
		at: Date.now(),
		context,
		error: scrub(err?.message ?? String(err)),
	});
	console.error(line);
	// R3: flush the sink before exiting — a synchronous exit loses the whole
	// log file (reproduced 30/30 in fix-verification). Bounded fallback timer
	// so a stuck stream can never hang the exit.
	if (logSink) {
		logSink.write(`${line}\n`);
		const t = setTimeout(() => process.exit(1), 500);
		t.unref?.();
		logSink.end(() => process.exit(1));
	} else {
		process.exit(1);
	}
}

// ── stage: discover ─────────────────────────────────────────────────────────

async function discover(show, dir, { dryRun, refresh }) {
	const artifact = join(dir, 'episodes.json');
	if (!refresh && existsSync(artifact)) {
		// R1: a truncated manifest must fall through to refetch, not wedge
		// every future run behind an uncaught parse throw
		let cached = null;
		try {
			cached = JSON.parse(readFileSync(artifact, 'utf8'));
		} catch {
			log('discover_stale', { reason: 'artifact_corrupt' });
		}
		if (cached && isValidEpisodesArtifact(cached, show)) {
			log('discover_skip', { reason: 'valid_artifact', episodes: cached.episodes.length });
			return cached.episodes;
		}
		if (cached) log('discover_stale', { reason: 'artifact_invalid' });
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
		// R1: same atomicity as the transcribe artifact
		writeArtifactAtomic(artifact, JSON.stringify({ episodes }, null, 1), {
			writeFileSync,
			renameSync,
		});
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

function audioPathFor(ep, dir) {
	return join(dir, `${ep.id}.m4a`);
}
function transcriptPathFor(ep, dir) {
	return join(dir, `${ep.id}.deepgram.json`);
}

async function fetchEpisode(ep, dir, { dryRun }) {
	const out = audioPathFor(ep, dir);
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

async function transcribeEpisode(ep, dir, show, keyterms, apiKey, { dryRun }, scrub) {
	const artifact = transcriptPathFor(ep, dir);
	const audioPath = audioPathFor(ep, dir);
	if (existsSync(artifact)) {
		try {
			const cached = JSON.parse(readFileSync(artifact, 'utf8'));
			validateUtterances(cached, { durationS: ep.durationS, tailToleranceS: show.tailToleranceS });
			log('transcribe_skip', { episode: ep.id, reason: 'valid_artifact' });
			return cached;
		} catch (err) {
			log('transcribe_stale', { episode: ep.id, reason: scrub(err.message) });
		}
	}
	const req = buildDeepgramRequest({ apiKey, keyterms });
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
		throw new Error(`Deepgram ${res.status}: ${scrub(body.slice(0, 300))}`);
	}
	const dg = await res.json();
	validateUtterances(dg, { durationS: ep.durationS, tailToleranceS: show.tailToleranceS });
	// B5: atomic — a concurrent reader/runner never sees a truncated artifact
	writeArtifactAtomic(artifact, JSON.stringify(dg), { writeFileSync, renameSync });
	const billed = dg?.metadata?.duration ?? null;
	log('transcribe_done', { episode: ep.id, utterances: dg.results.utterances.length, billed_seconds: billed });
	return dg;
}

// ── stage: load (one episode) ───────────────────────────────────────────────

async function loadEpisode(sql, ep, dg, show, lookup, { dryRun }) {
	// B10: ONE parse at load time feeds anchors AND stored metadata/search —
	// discover-time fields are never trusted here.
	const parsed = parseTitle(ep.title);
	const chapterIds = anchorsForBlock(parsed.spans, lookup);
	const rows = utterancesToRows(dg, `${show.id}-${ep.id}`);
	const plan = buildLoadPlan(
		{ videoId: ep.id, title: ep.title, subtitle: parsed.subtitle, spans: parsed.spans, uploadDate: ep.uploadDate, durationS: ep.durationS },
		rows, chapterIds, show,
	);
	if (dryRun) {
		log('load_dry_run', { episode: ep.id, ...plan.summary });
		return plan.summary;
	}
	await sql.begin(async (tx) => {
		await tx.unsafe("SET LOCAL statement_timeout = '60s'");
		await tx.unsafe("SET LOCAL idle_in_transaction_session_timeout = '60s'");
		for (const s of plan.statements) {
			const values = s.values.map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
			await tx.unsafe(s.text, values);
		}
	});
	log('load_done', { episode: ep.id, ...plan.summary });
	return plan.summary;
}

// ── B7: stage prerequisites — scoped runs never cascade into paid stages ────

function assertStagePrereqs(stage, episodes, dir) {
	if (stage === 'transcribe') {
		const missing = episodes.filter((ep) => !isValidAudioArtifact(audioPathFor(ep, dir), stat));
		if (missing.length) {
			throw new Error(`--stage=transcribe: ${missing.length} episode(s) missing audio (run --stage=fetch first): ${missing.map((e) => e.id).join(', ')}`);
		}
	}
	if (stage === 'load') {
		const missing = episodes.filter((ep) => !existsSync(transcriptPathFor(ep, dir)));
		if (missing.length) {
			throw new Error(`--stage=load: ${missing.length} episode(s) missing transcripts (run --stage=transcribe first): ${missing.map((e) => e.id).join(', ')}`);
		}
	}
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		fatal(err, 'args');
	}
	const show = SHOWS[opts.show];
	if (!show) fatal(new Error(`unknown show ${opts.show}`), 'args');
	const dir = join(ROOT, 'data', 'podcasts', show.id);
	mkdirSync(dir, { recursive: true });
	// B1: runner-owned per-invocation log — no tee, no shared file
	const logPath = makeRunLogPath(dir, { now: Date.now(), pid: process.pid });
	logSink = createWriteStream(logPath, { flags: 'a' });
	log('run_start', { log: logPath, argv: process.argv.slice(2) });

	const require = createRequire(import.meta.url);
	const postgres = require('postgres');
	const envText = readFileSync(join(ROOT, '.env'), 'utf8');
	const dsn = envText.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
	if (!dsn) fatal(new Error('DATABASE_URL not found in root .env'), 'env');
	const apiKey = envText.match(/^DEEPGRAM_API_KEY=(.+)$/m)?.[1]?.trim();
	if (!apiKey) fatal(new Error('DEEPGRAM_API_KEY not found in root .env'), 'env');
	// B4: every in-run scrub carries the live key explicitly
	const scrub = makeScrubber(apiKey);
	const sql = postgres(dsn, { prepare: false, max: 2 });

	try {
		let episodes = await discover(show, dir, opts);
		if (opts.episode) {
			checkEpisodeArg(opts.episode, episodes);
			episodes = episodes.filter((e) => e.id === opts.episode);
		}
		if (opts.stage === 'discover') return finish(0);
		assertStagePrereqs(opts.stage, episodes, dir);

		const bookRows = await sql`SELECT id, name FROM lumen.books`;
		const chapterRows = await sql`SELECT book_id, count(*)::int AS n FROM lumen.chapters GROUP BY book_id`;
		const lookup = {
			bookIdByName: Object.fromEntries(bookRows.map((b) => [b.name, b.id])),
			chapterCount: Object.fromEntries(chapterRows.map((c) => [c.book_id, Number(c.n)])),
		};
		const keytermRows = await sql`
      SELECT e.name FROM lumen.entities e
      JOIN lumen.edges ed ON ed.from_id = e.id OR ed.to_id = e.id
      WHERE e.entity_type IN ('person','place')
      GROUP BY e.name ORDER BY count(*) DESC LIMIT ${show.keytermMax}`;
		const keyterms = keytermRows.map((r) => r.name);
		log('keyterms_ready', { count: keyterms.length });

		const byDuration = [...episodes].sort((a, b) => (b.durationS ?? 0) - (a.durationS ?? 0));
		const probe = byDuration[0];
		const rest = episodes.filter((e) => e.id !== probe.id);
		const results = { ok: [], failed: [] };
		let billedSum = 0;

		const transcribeAndLoad = async (ep) => {
			const dg = await transcribeEpisode(ep, dir, show, keyterms, apiKey, opts, scrub);
			if (dg?.metadata?.duration) billedSum += Number(dg.metadata.duration);
			if (opts.stage === 'transcribe' || dg === null) return;
			await loadEpisode(sql, ep, dg, show, lookup, opts);
		};

		// B8: rest FETCHES start immediately, concurrent with the probe chain;
		// the REL-3 gate only serializes TRANSCRIPTION behind the probe.
		log('probe_start', { episode: probe.id, duration_s: probe.durationS });
		const restFetches = runPool(
			rest.map((ep) => async () => {
				await fetchEpisode(ep, dir, opts);
				return ep;
			}),
			show.pools.fetch,
		);

		let probeFailed = false;
		try {
			await fetchEpisode(probe, dir, opts);
			if (opts.stage !== 'fetch') await transcribeAndLoad(probe);
			results.ok.push(probe.id);
		} catch (err) {
			probeFailed = true;
			results.failed.push(probe.id);
			log('episode_failed', { episode: probe.id, error: scrub(err.message) });
		}

		const fetchResults = await restFetches;
		const fetched = [];
		for (const [i, r] of fetchResults.entries()) {
			if (r.ok) fetched.push(r.value);
			else {
				results.failed.push(rest[i].id);
				log('episode_failed', { episode: rest[i].id, stage: 'fetch', error: scrub(r.error.message) });
			}
		}
		log('fetch_stage_done', { ...summarizeResults(fetchResults), probe_included: !probeFailed });

		if (probeFailed && !opts.dryRun && opts.stage !== 'fetch') {
			log('probe_failed_abort', { note: 'REL-3: upload mechanics unproven; aborting before batch transcription' });
			return finish(2);
		}

		if (opts.stage !== 'fetch') {
			const chainResults = await runPool(
				fetched.map((ep) => async () => {
					await transcribeAndLoad(ep);
					return ep.id;
				}),
				show.pools.transcribe,
			);
			for (const [i, r] of chainResults.entries()) {
				if (r.ok) results.ok.push(r.value);
				else {
					results.failed.push(fetched[i].id);
					log('episode_failed', { episode: fetched[i].id, error: scrub(r.error.message) });
				}
			}
			log('transcribe_load_stage_done', {
				...summarizeResults(chainResults),
				billed_seconds_sum: Math.round(billedSum * 1000) / 1000,
			});
		}

		log('run_done', { ok: results.ok.length, failed: results.failed.length, dry_run: opts.dryRun });
		return finish(results.failed.length > 0 ? 2 : 0);
	} catch (err) {
		const line = JSON.stringify({ event: 'fatal', at: Date.now(), error: scrub(err?.message ?? String(err)) });
		console.error(line);
		logSink?.write(`${line}\n`);
		return finish(1);
	}

	async function finish(code) {
		await sql.end();
		await new Promise((r) => logSink.end(r));
		process.exit(code);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
