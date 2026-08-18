// WhisperX raw output → pipeline transcript artifact (second-show engine
// switch, docs/design/transcription-bake-off.md). Pure conversion here;
// the CLI shell at the bottom does I/O. The artifact matches the shape
// transcribeEpisode produces, so loadEpisode and utterancesToRows run
// unchanged: { results: { utterances: [{start,end,speaker,transcript}] },
// __params }.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { validateUtterances } from './transcribe.mjs';

/** "SPEAKER_07" → 7; anything unparseable → null (utterancesToRows keeps
 * null speakers null). */
function speakerIndex(label) {
	if (label == null) return null;
	const m = /(\d+)$/.exec(String(label));
	return m ? Number(m[1]) : null;
}

/** WhisperX alignment occasionally emits empty, zero-length, or slightly
 * reordered segments; validateUtterances THROWS on all three, so clamp
 * here rather than reject a whole episode over alignment jitter. */
export function convertWhisperx(raw) {
	const segments = raw?.segments;
	if (!Array.isArray(segments) || segments.length === 0) {
		throw new Error('whisperx raw output has no segments');
	}
	const utterances = [];
	let prevStart = 0;
	let prevEnd = 0;
	for (const seg of segments) {
		const text = String(seg.text ?? '').trim();
		if (!text) continue;
		let start = Number(seg.start);
		let end = Number(seg.end);
		if (!Number.isFinite(start)) start = prevEnd;
		if (!Number.isFinite(end)) end = start;
		if (start < prevStart) start = prevStart; // monotonicity clamp
		if (end <= start) end = start + 0.01;
		utterances.push({
			start,
			end,
			speaker: speakerIndex(seg.speaker),
			transcript: text,
		});
		prevStart = start;
		prevEnd = end;
	}
	return {
		results: { utterances },
		__params: { diarize: true, model: 'whisperx-large-v3', keyterms: 0 },
	};
}

// ── CLI: node whisperx-convert.mjs <dir> <videoId> [durationS] ──
const [, , dir, vid, durationArg] = process.argv;
if (dir && vid) {
	const rawPath = `${dir}/${vid}.whisperx-raw.json`;
	if (!existsSync(rawPath)) {
		console.error(`missing ${rawPath} — run the Modal batch first`);
		process.exit(1);
	}
	const artifact = convertWhisperx(JSON.parse(readFileSync(rawPath, 'utf8')));
	const durationS = durationArg ? Number(durationArg) : null;
	validateUtterances(artifact, { durationS, tailToleranceS: 900 });
	const out = `${dir}/${vid}.whisperx.json`;
	writeFileSync(`${out}.tmp`, JSON.stringify(artifact));
	renameSync(`${out}.tmp`, out);
	console.log(JSON.stringify({
		event: 'convert_done',
		episode: vid,
		utterances: artifact.results.utterances.length,
		speakers: new Set(artifact.results.utterances.map((u) => u.speaker).filter((s) => s != null)).size,
	}));
}
