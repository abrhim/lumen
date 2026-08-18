// Stage 3 — transcribe (unshaken-ingest A1). Deepgram prerecorded, nova.
// Key travels ONLY in the Authorization header (H9 — argv/URL leak via ps).
// Uploads stream from disk in the runner; this module is pure contracts.

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';
const KEYTERM_MAX = 100; // Q5/REL-6: hard client-side cap, measured at dry-run

export function buildDeepgramRequest({ apiKey, keyterms = [], model = 'nova-3', diarize = false }) {
	if (!apiKey) throw new Error('DEEPGRAM_API_KEY required');
	return {
		url: DEEPGRAM_URL,
		method: 'POST',
		headers: {
			Authorization: `Token ${apiKey}`,
			'Content-Type': 'audio/mp4',
		},
		query: {
			model,
			utterances: 'true',
			smart_format: 'true',
			punctuate: 'true',
			// interview shows (SoJ) need speaker turns; utterancesToRows already
			// carries u.speaker when present, so downstream is shape-stable
			...(diarize ? { diarize: 'true' } : {}),
			keyterm: keyterms.slice(0, KEYTERM_MAX),
		},
	};
}

/** H5 + REL-1: response utterances must be non-empty, well-typed, start-
 * monotonic, non-negative, end>start — and when the episode duration is
 * known, cover it to within tailToleranceS (silent truncation fails). */
export function validateUtterances(dg, { durationS = null, tailToleranceS = 300 } = {}) {
	const utts = dg?.results?.utterances;
	if (!Array.isArray(utts) || utts.length === 0) {
		throw new Error('no utterances in Deepgram response');
	}
	let prevStart = -Infinity;
	for (const u of utts) {
		if (typeof u.start !== 'number' || typeof u.end !== 'number' || typeof u.transcript !== 'string') {
			throw new Error('malformed utterance');
		}
		if (u.start < 0) throw new Error(`negative start ${u.start}`);
		if (u.end <= u.start) throw new Error(`end ${u.end} <= start ${u.start}`);
		if (u.start < prevStart) throw new Error(`non-monotonic start ${u.start} < ${prevStart}`);
		prevStart = u.start;
	}
	if (durationS !== null) {
		const lastEnd = utts[utts.length - 1].end;
		if (lastEnd < durationS - tailToleranceS) {
			throw new Error(
				`transcript coverage gap: last utterance ends ${lastEnd}s of ${durationS}s (duration tolerance ${tailToleranceS}s)`,
			);
		}
	}
	return utts;
}

/** Deepgram utterances → lumen.transcripts row shapes (design §schema). */
export function utterancesToRows(dg, episodeId) {
	const utts = dg.results.utterances;
	return utts.map((u, i) => ({
		episode_id: episodeId,
		seq: i,
		t_start_s: u.start,
		t_end_s: u.end,
		speaker: u.speaker != null ? String(u.speaker) : null,
		text: u.transcript,
	}));
}
