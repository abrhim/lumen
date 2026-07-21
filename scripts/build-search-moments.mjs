// M3 (search-endpoint): materialize transcript caption windows into
// lumen.search_index kind='moment', and repair the 10 double-encoded
// kind='episode' payloads (SEC-8/API-5). MANDATORY POST-INGEST RUNBOOK STEP:
// re-run after every episode ingest (DAT-3/BLA-6) — the ingest pipeline
// deletes transcripts by cascade but does not know about moments.
//
// Ownership (BLA-3): this script owns kind='moment' rows ONLY (plus the
// one-shot payload repair UPDATE on kind='episode'). All deletes are
// kind-scoped and keyed payload->>'episode_id' (never ref_id LIKE — '_' is a
// LIKE wildcard and YouTube ids may contain it). One transaction per episode
// (DAT-4): a crash leaves whole episodes present-or-absent, never partial.
//
// Windowing (plan decision 8): accumulate consecutive captions; flush at
// ≥500 chars on a >2.0s gap or sentence end; hard cap 800; tail <200 merges
// backward. Windows chain exactly over existing seqs (H15); contiguity of
// source seqs is an ASSERTED PRECONDITION (COR-7), exit 2 if violated.
//
// MOMENT ID STABILITY (decision 5, APIC-6): moment ids
// (ref_id = episode_id||'#'||seq_start) are RESPONSE-SCOPED, NOT durable —
// every re-run re-windows and re-keys them. Never persist, cache, or
// deep-link a moment id; deep-link via payload episode_id + t_start_s.
// All other search ids (verse/entity/episode/artwork/strongs) are durable.
//
//   node --import tsx scripts/build-search-moments.mjs            # dry-run
//   COMMIT=1 node --import tsx scripts/build-search-moments.mjs   # apply
// Exit 0 success/clean, 1 fatal, 2 invariant/precondition failure.
// Rollback: DELETE FROM lumen.search_index WHERE kind='moment'.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scrubSecrets } from './ingest-podcast/util.mjs';

const TARGET = 500;
const HARD_MAX = 800;
const MIN_TAIL = 200;
const GAP_S = 2.0;

// Pure, exported for tests: captions [{seq,t_start_s,t_end_s,text}] (numbers
// already coerced) → windows [{seq_start,seq_end,t_start_s,t_end_s,text}].
// HARD_MAX (DATC-4/CORC-7): flush BEFORE an append would overshoot, so only a
// single caption longer than HARD_MAX itself can produce a >HARD_MAX window
// (captions are never split — the chain invariant owns seq granularity).
// Trade-off: when the cap forces an early flush or blocks the tail merge, the
// MIN_TAIL floor yields to the cap.
export function windowCaptions(captions) {
	const windows = [];
	let cur = null;
	for (let i = 0; i < captions.length; i++) {
		const c = captions[i];
		const next = captions[i + 1];
		const text = c.text.trim();
		if (cur && cur.text.length + 1 + text.length > HARD_MAX) {
			windows.push(cur);
			cur = null;
		}
		if (!cur) {
			cur = { seq_start: c.seq, seq_end: c.seq, t_start_s: c.t_start_s, t_end_s: c.t_end_s, text };
		} else {
			cur.seq_end = c.seq;
			cur.t_end_s = c.t_end_s ?? cur.t_end_s;
			cur.text = (cur.text + ' ' + text).trim();
		}
		const gap = next ? Math.max(0, (next.t_start_s ?? 0) - (c.t_end_s ?? next.t_start_s ?? 0)) : 0;
		const sentenceEnd = /[.!?]["')\]]?$/.test(text);
		const shouldFlush =
			!next ||
			cur.text.length >= HARD_MAX ||
			(cur.text.length >= TARGET && (gap > GAP_S || sentenceEnd));
		if (shouldFlush) {
			windows.push(cur);
			cur = null;
		}
	}
	// Tail merge backward (COR: min window size) — skipped when the merge
	// would breach HARD_MAX (cap wins over the floor, see above).
	if (windows.length >= 2 && windows[windows.length - 1].text.length < MIN_TAIL) {
		const prev = windows[windows.length - 2];
		const tail = windows[windows.length - 1];
		if (prev.text.length + 1 + tail.text.length <= HARD_MAX) {
			windows.pop();
			prev.seq_end = tail.seq_end;
			prev.t_end_s = tail.t_end_s ?? prev.t_end_s;
			prev.text = prev.text + ' ' + tail.text;
		}
	}
	return windows;
}

async function main() {
	const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
	const commit = process.env.COMMIT === '1';
	const require = createRequire(import.meta.url);
	const postgres = require('postgres');
	const url = readFileSync(join(ROOT, '.env'), 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
	const sql = postgres(url, { prepare: false, max: 1 });

	try {
		// Precheck: M2's kjv_delta must exist (moment tsv is delta-indexed).
		const pre = await sql`SELECT to_regprocedure('lumen.kjv_delta(text)') IS NOT NULL AS pass`;
		console.log(JSON.stringify({ event: 'precheck', name: 'kjv_delta_exists', pass: pre[0].pass }));
		if (!pre[0].pass) {
			await sql.end();
			process.exit(2);
		}

		// Ownership baseline (BLA-3): other kinds must be untouched.
		const baseline = await sql`
			SELECT kind, count(*)::int AS n FROM lumen.search_index
			WHERE kind <> 'moment' GROUP BY kind`;

		const episodes = await sql`
			SELECT e.id, e.name, e.collection_id
			FROM lumen.entities e
			WHERE EXISTS (SELECT 1 FROM lumen.transcripts t WHERE t.episode_id = e.id)
			ORDER BY e.id`;
		console.log(JSON.stringify({ event: 'episodes_found', n: episodes.length }));

		// DAT-6/DATC-3: episode deletion cascades transcripts but not moments —
		// the per-episode loop below only sees episodes that still HAVE
		// transcripts, so orphaned (still publicly searchable) moments must be
		// reaped by their absence from lumen.transcripts. Kind-scoped, keyed
		// payload episode_id per the BLA-3 ownership rule.
		const orphans = await sql`
			SELECT count(*)::int AS n FROM lumen.search_index m
			WHERE m.kind = 'moment' AND NOT EXISTS (
			  SELECT 1 FROM lumen.transcripts t WHERE t.episode_id = m.payload->>'episode_id')`;
		console.log(JSON.stringify({ event: 'orphan_moments_found', n: orphans[0].n, commit }));
		if (commit && orphans[0].n > 0) {
			const deleted = await sql`
				DELETE FROM lumen.search_index m
				WHERE m.kind = 'moment' AND NOT EXISTS (
				  SELECT 1 FROM lumen.transcripts t WHERE t.episode_id = m.payload->>'episode_id')`;
			console.log(JSON.stringify({ event: 'orphan_moments_deleted', n: deleted.count }));
		}

		// COR-7 precondition: seq contiguous & 0-based per episode.
		const contig = await sql`
			SELECT episode_id, count(*)::int AS n, min(seq)::int AS mn, max(seq)::int AS mx
			FROM lumen.transcripts GROUP BY episode_id`;
		const broken = contig.filter((r) => r.mx - r.mn + 1 !== r.n);
		if (broken.length) {
			console.log(JSON.stringify({ event: 'precondition_failed', name: 'seq_contiguous', episodes: broken.map((b) => b.episode_id) }));
			await sql.end();
			process.exit(2);
		}
		console.log(JSON.stringify({ event: 'precheck', name: 'seq_contiguous', pass: true }));

		let totalWindows = 0;
		for (const ep of episodes) {
			const captions = (
				await sql`
					SELECT seq, t_start_s, t_end_s, text FROM lumen.transcripts
					WHERE episode_id = ${ep.id} ORDER BY seq`
			).map((c) => ({
				seq: Number(c.seq),
				t_start_s: c.t_start_s === null ? null : Number(c.t_start_s), // postgres.js string trap (COR-8)
				t_end_s: c.t_end_s === null ? null : Number(c.t_end_s),
				text: c.text,
			}));
			const windows = windowCaptions(captions);

			// Chain check before any write.
			let chainOk = windows.length > 0 && windows[0].seq_start === captions[0].seq
				&& windows[windows.length - 1].seq_end === captions[captions.length - 1].seq;
			for (let i = 1; chainOk && i < windows.length; i++) {
				if (windows[i].seq_start !== windows[i - 1].seq_end + 1) chainOk = false;
			}
			if (!chainOk) {
				console.log(JSON.stringify({ event: 'invariant_check', name: 'window_chain', episode: ep.id, pass: false }));
				await sql.end();
				process.exit(2);
			}

			if (commit) {
				await sql.begin(async (tx) => {
					await tx`DELETE FROM lumen.search_index
						WHERE kind = 'moment' AND payload->>'episode_id' = ${ep.id}`;
					for (let i = 0; i < windows.length; i += 500) {
						const chunk = windows.slice(i, i + 500);
						await tx`
							INSERT INTO lumen.search_index (kind, ref_id, collection_id, title, tsv, payload)
							SELECT 'moment', ${ep.id} || '#' || w.seq_start, ${ep.collection_id}, ${ep.name},
							       to_tsvector('english', w.text) || to_tsvector('english', lumen.kjv_delta(w.text)),
							       jsonb_build_object(
							         'episode_id', ${ep.id}::text,
							         't_start_s', w.t_start_s, 't_end_s', w.t_end_s,
							         'seq_start', w.seq_start, 'seq_end', w.seq_end,
							         'text', w.text)
							FROM jsonb_to_recordset(${sql.json(chunk)}::jsonb)
							  AS w(seq_start int, seq_end int, t_start_s numeric, t_end_s numeric, text text)`;
					}
					// SEC-8/API-5 repair: double-encoded episode payload → object.
					await tx`
						UPDATE lumen.search_index
						SET payload = jsonb_build_object('episode_id', ${ep.id}::text)
						WHERE kind = 'episode' AND ref_id = ${ep.id}
						  AND (jsonb_typeof(payload) <> 'object' OR NOT payload ? 'episode_id')`;
				});
			}
			totalWindows += windows.length;
			const lens = windows.map((w) => w.text.length);
			console.log(JSON.stringify({
				event: 'episode_windowed', episode_id: ep.id, commit,
				windows: windows.length, captions: captions.length,
				chars_p50: lens.sort((a, b) => a - b)[Math.floor(lens.length / 2)] ?? 0,
			}));
		}

		if (commit) {
			await sql.unsafe(`VACUUM ANALYZE lumen.search_index`);
			// Invariants.
			let failures = 0;
			const checks = [
				{
					name: 'moments_collection_stamped',
					sql: `SELECT count(*) = 0 AS pass FROM lumen.search_index
					  WHERE kind = 'moment' AND collection_id IS NULL`,
				},
				{
					name: 'episode_payloads_are_objects',
					sql: `SELECT count(*) = 0 AS pass FROM lumen.search_index
					  WHERE kind = 'episode' AND (jsonb_typeof(payload) <> 'object' OR NOT payload ? 'episode_id')`,
				},
				{
					// DATC-3: mirrors M4's artwork_orphan_free — no moment may
					// outlive its episode's transcripts.
					name: 'moment_orphan_free',
					sql: `SELECT count(*) = 0 AS pass FROM lumen.search_index m
					  WHERE m.kind = 'moment' AND NOT EXISTS (
					    SELECT 1 FROM lumen.transcripts t WHERE t.episode_id = m.payload->>'episode_id')`,
				},
				{
					// DATC-4: only a single unsplittable caption may exceed
					// HARD_MAX; multi-caption windows must respect the cap.
					name: 'moment_length_bounds',
					sql: `SELECT count(*) = 0 AS pass FROM lumen.search_index
					  WHERE kind = 'moment' AND length(payload->>'text') > ${HARD_MAX}
					    AND (payload->>'seq_start')::int <> (payload->>'seq_end')::int`,
				},
				{
					name: 'moment_coverage_matches_captions',
					sql: `SELECT NOT EXISTS (
					  SELECT 1 FROM (
					    SELECT t.episode_id, count(DISTINCT t.seq)::int AS captions,
					      coalesce((SELECT sum((m.payload->>'seq_end')::int - (m.payload->>'seq_start')::int + 1)
					                FROM lumen.search_index m
					                WHERE m.kind = 'moment' AND m.payload->>'episode_id' = t.episode_id), 0)::int AS covered
					    FROM lumen.transcripts t GROUP BY t.episode_id
					  ) x WHERE x.captions <> x.covered) AS pass`,
				},
			];
			for (const inv of checks) {
				const rows = await sql.unsafe(inv.sql);
				const pass = rows[0]?.pass === true;
				console.log(JSON.stringify({ event: 'invariant_check', name: inv.name, pass }));
				if (!pass) failures += 1;
			}
			// Ownership: other kinds unchanged.
			const after = await sql`
				SELECT kind, count(*)::int AS n FROM lumen.search_index
				WHERE kind <> 'moment' GROUP BY kind`;
			const beforeMap = Object.fromEntries(baseline.map((r) => [r.kind, r.n]));
			const afterMap = Object.fromEntries(after.map((r) => [r.kind, r.n]));
			const ownershipOk = JSON.stringify(beforeMap) === JSON.stringify(afterMap);
			console.log(JSON.stringify({ event: 'invariant_check', name: 'other_kinds_untouched', pass: ownershipOk, before: beforeMap, after: afterMap }));
			if (!ownershipOk) failures += 1;
			await sql.end();
			if (failures > 0) process.exit(2);
			console.log(JSON.stringify({ event: 'moments_done', commit: true, windows: totalWindows }));
			return;
		}
		await sql.end();
		console.log(JSON.stringify({ event: 'moments_dry_run_ok', windows: totalWindows }));
	} catch (err) {
		console.error('FATAL:', scrubSecrets(err.message));
		await sql.end();
		process.exit(1);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
