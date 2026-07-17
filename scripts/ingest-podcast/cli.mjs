// Runner CLI contract (B7): stage whitelist, clear failures. Pure — the
// runner shell owns process.argv/exit.
import { assertVideoId } from './util.mjs';

export const STAGES = ['discover', 'fetch', 'transcribe', 'load'];

export function parseArgs(argv) {
	const out = { stage: null, episode: null, dryRun: false, refresh: false, show: 'unshaken' };
	for (const a of argv) {
		if (a === '--dry-run') out.dryRun = true;
		else if (a === '--refresh') out.refresh = true;
		else if (a.startsWith('--stage=')) {
			const s = a.slice(8);
			if (!STAGES.includes(s)) {
				throw new Error(`unknown --stage "${s}" (valid: ${STAGES.join('|')})`);
			}
			out.stage = s;
		} else if (a.startsWith('--episode=')) out.episode = assertVideoId(a.slice(10));
		else if (a.startsWith('--show=')) out.show = a.slice(7);
		else throw new Error(`unknown flag ${a}`);
	}
	return out;
}

/** --episode must name a manifest member — fail with the id, not a TypeError. */
export function checkEpisodeArg(id, episodes) {
	if (!episodes.some((e) => e.id === id)) {
		throw new Error(
			`--episode=${id} not in the discovered manifest (${episodes.length} episodes; run --refresh if it should be)`,
		);
	}
}
