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
import { STICK_OF_JOSEPH } from './shows/stick-of-joseph.mjs';
import {
	collectionForEpisode,
	episodeCollectionMap,
	expectedEpisodeCount,
	isExplicitShow,
	titleParseMode,
} from './show-shape.mjs';
import { runExtractCode, runExtractMerge } from './extract.mjs';
import {
	EXISTING_EDGES_SQL,
	buildExtractionLoadPlan,
	checkLoadGate,
	executeExtractionLoadPlan,
} from './load-extraction.mjs';
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
import { filterEpisodes, isValidEpisodesArtifact, enrichEpisode, enrichExplicitEpisode } from './discover.mjs';
import { bestAudioArgs, assertDownloadedId, isValidAudioArtifact } from './fetch.mjs';
import { buildDeepgramRequest, validateUtterances, utterancesToRows } from './transcribe.mjs';
import { parseTitle, anchorsForBlock } from './parse-title.mjs';
import { buildLoadPlan } from './load.mjs';

const pExecFile = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOWS = { unshaken: UNSHAKEN, 'stick-of-joseph': STICK_OF_JOSEPH };

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
	const PRINT_FMT = '%(id)s\t%(duration)s\t%(upload_date)s\t%(title)s';
	let episodes;
	if (isExplicitShow(show)) {
		// Explicit mode (second-show): the config enumerates canonical IDs, so
		// discovery is a per-id metadata LOOKUP, not a channel scan — which is
		// also what sidesteps the channel's retitled ad-free duplicate uploads.
		const byId = episodeCollectionMap(show);
		const fetchMeta = [...byId.entries()].map(([videoId, collection]) => async () => {
			const { stdout } = await pExecFile(
				'yt-dlp',
				['--skip-download', '--print', PRINT_FMT, `https://www.youtube.com/watch?v=${videoId}`],
				{ env: childEnv(process.env), maxBuffer: 1024 * 1024 },
			);
			const [id, duration, upload_date, ...title] = stdout.trim().split('\n').at(-1).split('\t');
			if (id !== videoId) throw new Error(`metadata id mismatch: asked ${videoId}, got ${id}`);
			return enrichExplicitEpisode(
				{ id, duration: Number(duration) || null, upload_date, title: title.join('\t') },
				collection.id,
			);
		});
		const results = await runPool(fetchMeta, 4);
		const failed = results.filter((r) => !r.ok);
		if (failed.length) {
			throw new Error(`discover could not resolve ${failed.length} listed episode id(s): ${failed.map((r) => scrubSecrets(r.error.message)).join('; ').slice(0, 400)}`);
		}
		episodes = results.map((r) => r.value);
	} else {
		const { stdout } = await pExecFile(
			'yt-dlp',
			['--flat-playlist', '--print', PRINT_FMT,
				'-I', `1:${show.discoverScanLimit}`, show.channelUrl],
			{ env: childEnv(process.env), maxBuffer: 16 * 1024 * 1024 },
		);
		const raw = stdout.trim().split('\n').map((line) => {
			const [id, duration, upload_date, ...title] = line.split('\t');
			return { id, duration: Number(duration) || null, upload_date, title: title.join('\t') };
		});
		episodes = filterEpisodes(raw, show).map(enrichEpisode);
	}
	if (episodes.length !== expectedEpisodeCount(show)) {
		throw new Error(`discover found ${episodes.length}/${expectedEpisodeCount(show)} episodes`);
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
function transcriptPathFor(ep, dir, show) {
	// per-show engine (second-show 2026-08-18): SoJ artifacts come from the
	// Modal WhisperX batch via whisperx-convert.mjs; renaming Unshaken's
	// .deepgram.json cache would force a full paid re-transcribe on the
	// next weekly run, so the filename stays engine-specific instead
	const ext = show?.transcriptEngine === 'whisperx' ? 'whisperx' : 'deepgram';
	return join(dir, `${ep.id}.${ext}.json`);
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
	const artifact = transcriptPathFor(ep, dir, show);
	const audioPath = audioPathFor(ep, dir);
	// whisperx shows: the engine runs externally (Modal batch, then
	// whisperx-convert.mjs). This stage only ADMITS the artifact — it must
	// never fall through to a Deepgram request.
	if (show.transcriptEngine === 'whisperx') {
		if (!existsSync(artifact)) {
			throw new Error(
				`missing ${artifact} — run: modal run scripts/ingest-podcast/whisperx_modal.py --episodes ${ep.id}, then node scripts/ingest-podcast/whisperx-convert.mjs ${dir} ${ep.id} ${ep.durationS ?? ''}`,
			);
		}
		const cached = JSON.parse(readFileSync(artifact, 'utf8'));
		if (Boolean(cached.__params?.diarize) !== Boolean(show.diarize)) {
			throw new Error(`params drift: artifact diarize=${Boolean(cached.__params?.diarize)}, show wants ${Boolean(show.diarize)}`);
		}
		validateUtterances(cached, { durationS: ep.durationS, tailToleranceS: show.tailToleranceS });
		log('transcribe_skip', { episode: ep.id, reason: 'whisperx_artifact' });
		return cached;
	}
	// Params fingerprint (second-show): skip-if-valid previously ignored HOW
	// the transcript was made, so flipping diarize on would silently reuse a
	// non-diarized artifact. Old artifacts carry no __params — treated as
	// diarize:false, which is exactly what they are.
	const wantDiarize = Boolean(show.diarize);
	if (existsSync(artifact)) {
		try {
			const cached = JSON.parse(readFileSync(artifact, 'utf8'));
			if (Boolean(cached.__params?.diarize) !== wantDiarize) {
				throw new Error(`params drift: artifact diarize=${Boolean(cached.__params?.diarize)}, show wants ${wantDiarize}`);
			}
			validateUtterances(cached, { durationS: ep.durationS, tailToleranceS: show.tailToleranceS });
			log('transcribe_skip', { episode: ep.id, reason: 'valid_artifact' });
			return cached;
		} catch (err) {
			log('transcribe_stale', { episode: ep.id, reason: scrub(err.message) });
		}
	}
	const req = buildDeepgramRequest({ apiKey, keyterms, diarize: wantDiarize });
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
	// additive fingerprint — consumers read dg.results and never see this
	dg.__params = { diarize: wantDiarize, model: 'nova-3', keyterms: keyterms.length };
	// B5: atomic — a concurrent reader/runner never sees a truncated artifact
	writeArtifactAtomic(artifact, JSON.stringify(dg), { writeFileSync, renameSync });
	const billed = dg?.metadata?.duration ?? null;
	log('transcribe_done', { episode: ep.id, utterances: dg.results.utterances.length, billed_seconds: billed });
	return dg;
}

// ── stage: load (one episode) ───────────────────────────────────────────────

async function loadEpisode(sql, ep, dg, show, lookup, { dryRun }) {
	// B10: ONE parse at load time feeds anchors AND stored metadata/search —
	// discover-time fields are never trusted here. Verbatim shows branch
	// BEFORE parseTitle: their titles are not CFM grammar and parse to null,
	// and null.spans was the second-show review's blocker #7.
	const verbatim = titleParseMode(show) === 'verbatim';
	const parsed = verbatim ? { subtitle: null, spans: null } : parseTitle(ep.title);
	if (!verbatim && !parsed) throw new Error(`unparseable CFM title at load: ${JSON.stringify(ep.title)}`);
	const chapterIds = parsed.spans ? anchorsForBlock(parsed.spans, lookup) : [];
	const rows = utterancesToRows(dg, `${show.id}-${ep.id}`);
	const plan = buildLoadPlan(
		{ videoId: ep.id, title: ep.title, subtitle: parsed.subtitle, spans: parsed.spans, uploadDate: ep.uploadDate, durationS: ep.durationS, collectionId: ep.collectionId },
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
			// F1 class: values pass RAW. Pre-stringifying made postgres.js
			// JSON-encode the string AGAIN → jsonb string scalars in prod
			// (repaired by repair-metadata-encoding.mjs; probed 2026-07-18:
			// raw object → 'object', pre-stringified → 'string').
			await tx.unsafe(s.text, s.values);
		}
	});
	log('load_done', { episode: ep.id, ...plan.summary });
	return plan.summary;
}

// ── B7: stage prerequisites — scoped runs never cascade into paid stages ────

function assertStagePrereqs(stage, episodes, dir, show) {
	if (stage === 'transcribe') {
		const missing = episodes.filter((ep) => !isValidAudioArtifact(audioPathFor(ep, dir), stat));
		if (missing.length) {
			throw new Error(`--stage=transcribe: ${missing.length} episode(s) missing audio (run --stage=fetch first): ${missing.map((e) => e.id).join(', ')}`);
		}
	}
	if (stage === 'load') {
		const missing = episodes.filter((ep) => !existsSync(transcriptPathFor(ep, dir, show)));
		if (missing.length) {
			throw new Error(`--stage=load: ${missing.length} episode(s) missing transcripts (run --stage=transcribe first): ${missing.map((e) => e.id).join(', ')}`);
		}
	}
	if (stage === 'extract-code' || stage === 'extract-merge') {
		const missing = episodes.filter((ep) => !existsSync(transcriptPathFor(ep, dir, show)));
		if (missing.length) {
			throw new Error(`--stage=${stage}: ${missing.length} episode(s) missing deepgram artifacts: ${missing.map((e) => e.id).join(', ')}`);
		}
	}
	if (stage === 'load-extraction') {
		const missing = episodes.filter((ep) => !existsSync(join(dir, `${ep.id}.extraction.json`)));
		if (missing.length) {
			throw new Error(`--stage=load-extraction: ${missing.length} episode(s) missing extraction artifacts (run --stage=extract-merge first): ${missing.map((e) => e.id).join(', ')}`);
		}
	}
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
	// R-runner-gates-1: fatal() schedules exit via the log-flush callback and
	// RETURNS — every gate needs its own `return` or execution falls through
	// on the event-loop race (the F1 class, swept across ALL call sites).
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		fatal(err, 'args');
		return;
	}
	const show = SHOWS[opts.show];
	if (!show) {
		fatal(new Error(`unknown show ${opts.show}`), 'args');
		return;
	}
	const dir = join(ROOT, 'data', 'podcasts', show.id);
	mkdirSync(dir, { recursive: true });
	// B1: runner-owned per-invocation log — no tee, no shared file
	const logPath = makeRunLogPath(dir, { now: Date.now(), pid: process.pid });
	logSink = createWriteStream(logPath, { flags: 'a' });
	log('run_start', { log: logPath, argv: process.argv.slice(2) });

	const require = createRequire(import.meta.url);
	const postgres = require('postgres');
	const envText = readFileSync(join(ROOT, '.env'), 'utf8');
	// INGEST_DATABASE_URL overrides the .env DSN so a load can be pointed at
	// the LOCAL stack explicitly — the .env value is the production admin
	// credential, and "which database am I about to write 58 episodes into"
	// must never be implicit (second-show fleet, 2026-08-18)
	const dsn = process.env.INGEST_DATABASE_URL?.trim()
		|| envText.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
	if (!dsn) {
		fatal(new Error('DATABASE_URL not found in root .env'), 'env');
		return;
	}
	const apiKey = envText.match(/^DEEPGRAM_API_KEY=(.+)$/m)?.[1]?.trim();
	if (!apiKey && show.transcriptEngine !== 'whisperx') {
		fatal(new Error('DEEPGRAM_API_KEY not found in root .env'), 'env');
		return;
	}
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
		assertStagePrereqs(opts.stage, episodes, dir, show);

		const bookRows = await sql`SELECT id, name FROM lumen.books`;
		const chapterRows = await sql`SELECT book_id, count(*)::int AS n FROM lumen.chapters GROUP BY book_id`;
		const lookup = {
			bookIdByName: Object.fromEntries(bookRows.map((b) => [b.name, b.id])),
			chapterCount: Object.fromEntries(chapterRows.map((c) => [c.book_id, Number(c.n)])),
		};
		// ── A2 stages: deterministic extraction + gated load; no fetch/probe
		// machinery, no external calls. Judgment happens in Claude Code
		// workflows BETWEEN these stages, coupled through artifacts. ──
		if (['extract-code', 'extract-merge', 'load-extraction'].includes(opts.stage)) {
			const bookRows = await sql`SELECT id, name FROM lumen.books`;
			const stageOpts = { ...opts, showId: show.id, bookRows, transcriptEngine: show.transcriptEngine, modernNames: show.modernNames };
			const rollup = { ok: [], failed: [] };
			let verdict = null;
			if (opts.stage === 'load-extraction') {
				// F1: fatal() defers process.exit to the log-flush callback and
				// RETURNS — without these returns the gate is an event-loop race
				// and the load loop can start issuing DB statements.
				const verdictPath = join(dir, 'eval-verdict.json');
				if (!existsSync(verdictPath)) {
					fatal(new Error('eval-verdict.json missing — the checkpoint gates the load (PW-A6)'), 'prereq');
					return;
				}
				verdict = JSON.parse(readFileSync(verdictPath, 'utf8'));
				const anyPassed = verdict.passed === true ||
					Object.values(verdict.strata ?? {}).some((s) => s && s.pass === true);
				if (!anyPassed) {
					fatal(new Error('eval verdict is not a pass — load refused'), 'prereq');
					return;
				}
				if (verdict.passed !== true) {
					log('load_partial_verdict', {
						passed_strata: Object.entries(verdict.strata ?? {}).filter(([, s]) => s?.pass).map(([k]) => k),
					});
				}
			}
			for (const ep of episodes) {
				try {
					if (opts.stage === 'extract-code') {
						await runExtractCode(sql, ep, dir, lookup, stageOpts, log);
					} else if (opts.stage === 'extract-merge') {
						await runExtractMerge(sql, ep, dir, lookup, stageOpts, log);
					} else {
						const episodeId = `${show.id}-${ep.id}`;
						const extraction = JSON.parse(readFileSync(join(dir, `${ep.id}.extraction.json`), 'utf8'));
						// PW-A6/F8/F27 via the harness-pinned pure gate
						const gate = checkLoadGate({ verdict, episodeId, extraction });
						if (!gate.ok) throw new Error(`${gate.reason} — episode not loadable`);
						// per-stratum admission: hold rel types whose stratum failed
						const loadableEdges = gate.allowedRelTypes === null
							? extraction.edges
							: extraction.edges.filter((e) => gate.allowedRelTypes.includes(e.relType));
						if (loadableEdges.length !== extraction.edges.length) {
							log('edges_held_by_stratum', {
								episode: ep.id,
								held: extraction.edges.length - loadableEdges.length,
								loading: loadableEdges.length,
							});
						}
						// second-show review #8: the EPISODE's collection, never show.id —
						// a five-collection show would otherwise misfile every edge
						const cid = collectionForEpisode(show, ep).id;
						const existingEdges = await sql.unsafe(EXISTING_EDGES_SQL, [episodeId, cid, `${cid}-youtube`]);
						const plan = buildExtractionLoadPlan({
							episodeId,
							collectionId: cid,
							edges: loadableEdges,
							existingEdges,
						});
						if (opts.dryRun) {
							log('extraction_load_dry_run', plan.summary);
						} else {
							await executeExtractionLoadPlan(sql, plan, { log });
						}
					}
					rollup.ok.push(ep.id);
				} catch (err) {
					log('episode_failed', { episode: ep.id, stage: opts.stage, error: scrub(err.message) });
					rollup.failed.push(ep.id);
				}
			}
			log('stage_rollup', { stage: opts.stage, ok: rollup.ok.length, failed: rollup.failed });
			return finish(rollup.failed.length ? 2 : 0);
		}

		const keytermRows = await sql`
      SELECT e.name FROM lumen.entities e
      JOIN lumen.edges ed ON ed.from_id = e.id OR ed.to_id = e.id
      WHERE e.entity_type IN ('person','place')
      GROUP BY e.name ORDER BY count(*) DESC LIMIT ${show.keytermMax}`;
		// show-specific terms FIRST — they are exactly the names the generic
		// model fumbles (validation trio: "McLauchlin" → "McLaughlin"); the
		// slice keeps the request at keytermMax, trading the tail of the
		// DB-derived list for them
		const keyterms = [...(show.extraKeyterms ?? []), ...keytermRows.map((r) => r.name)]
			.slice(0, show.keytermMax);
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
