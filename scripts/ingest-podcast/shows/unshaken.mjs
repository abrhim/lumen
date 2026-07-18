// Show config — Unshaken (Jared Halverson). The reusable-workflow contract:
// a future show supplies exactly this shape (design doc §Ingestion workflow).
export const UNSHAKEN = {
	id: 'unshaken',
	channelUrl: 'https://www.youtube.com/c/Unshaken/videos',
	episodeCount: 10,
	collection: {
		name: 'Unshaken',
		description:
			'Come Follow Me deep-dive scripture study with Jared Halverson (weekly, verse by verse)',
		tier: 'app',
		category: 'podcast',
		provenance: 'youtube',
		license: 'embedded playback; transcript indexed for navigation',
	 	storage: 'link',
	},
	pools: { fetch: 2, transcribe: 3 }, // Amendment 1 per-resource caps
	keytermMax: 100, // Q5 — verified at transcribe dry-run
	tailToleranceS: 300, // REL-1 coverage tolerance
	discoverScanLimit: 120, // clips outnumber deep dives ~7:1 (probe 1)
};
