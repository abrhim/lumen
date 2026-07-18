// Stage 2 — fetch (unshaken-ingest A1). ALIGNMENT INVARIANT (H3): audio is
// extracted from the SAME videoId the app embeds — transcript seconds must
// live on the embedded player's timeline. yt-dlp's default .part + atomic
// rename is load-bearing for resume safety (REL-2): never pass --no-part.
import { assertVideoId } from './util.mjs';

/** argv array for execFile (never a shell string). Audio-only; -N 4 fragment
 * concurrency speeds a single download (Amendment 1). */
export function bestAudioArgs(videoId, outPath) {
	assertVideoId(videoId);
	return [
		'-f', 'bestaudio[ext=m4a]/bestaudio',
		'-N', '4',
		'--no-progress',
		'--print-json',
		'-o', outPath,
		`https://www.youtube.com/watch?v=${videoId}`,
	];
}

/** H3: the downloaded stream's metadata must name the requested video. */
export function assertDownloadedId(metadata, expectedId) {
	if (!metadata || metadata.id !== expectedId) {
		throw new Error(
			`downloaded stream id ${JSON.stringify(metadata?.id)} != requested ${expectedId}`,
		);
	}
}

/** H10: an audio artifact is valid only under its FINAL name (never .part),
 * present, and non-empty. stat is injected: (path) => {exists, size}. */
export function isValidAudioArtifact(path, stat) {
	if (path.endsWith('.part')) return false;
	const s = stat(path);
	return Boolean(s && s.exists && s.size > 0);
}
