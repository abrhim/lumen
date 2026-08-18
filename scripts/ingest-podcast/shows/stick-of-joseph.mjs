// Show config — The Stick of Joseph. Second show through the pipeline, and
// the first test of the reusable-workflow contract unshaken.mjs promised.
//
// Two ways this show differs from Unshaken, both deliberate
// (docs/design/stick-of-joseph.md):
//
//  1. FIVE collections, not one. Abram dropped the ~120-episode Interviews
//     catch-all ("we can do something for those later") — the scope is the
//     five named bodies of work below. The unshaken contract carries ONE
//     collection per show; extending it is gated on the second-show audit.
//  2. EXPLICIT episode lists, not channel-scan discovery. The channel
//     publicly re-uploads episodes as retitled "ad free" duplicates (~67 of
//     239 playlist items, plus ~16 unmarked re-uploads) — a hazard class the
//     pipeline has never faced. The research verified canonical IDs by
//     enumerating YouTube's own playlist data, so discovery becomes a
//     lookup, and the dupe hazard mostly disappears with it.
//
// Claim priority when an episode could sit in two collections:
// todd > andrea > mike-dave > stick-of-judah > live-events — documentation
// for future rule-based additions; the lists above are already exclusive.
// 58 unique episodes, 78h30m of audio (~$20 of Deepgram).
//
// DO NOT run the fleet before (a) the audit's blockers are fixed and
// (b) a 2-3 episode validation has been EYEBALLED — interviews, not a
// single lecturer; diarization is unproven here. Include one 3-speaker
// episode in the validation set.
export const STICK_OF_JOSEPH = {
	id: 'stick-of-joseph',
	channelUrl: 'https://www.youtube.com/@thestickofjoseph/videos',
	collections: [
		{
			id: 'soj-todd-mclauchlin',
			// the man spells it McLaughlin (Abram 2026-08-18, confirmed by ear
			// against the audio); the CHANNEL titles all spell "McLauchlin",
			// so title matching must keep using the channel's spelling
			name: 'Todd McLaughlin',
			description: 'Temple worship, priesthood, and the Lectures on Faith with Todd McLaughlin',
			episodes: [
				'63onrrP5Tz4', // The Power That Holds the Universe Together (1:01:52)
				'K4aU8p1F9u8', // ALTARS in The LDS Temple (1:19:33)
				'5HXbn4MotUY', // Knowing God (1:30:33) — exists 3x on channel; this is canonical
				'fZmLnbgD8MM', // (1:46:58)
				'I2AX7Mfs4Zs', // (1:17:45)
				'nUIUwII8hCU', // (1:34:02)
				'87pLM-JW3gQ', // (1:12:57)
				'rfJCkv_JurI', // (1:27:25)
				'Ilk0hJpcahY', // (46:40)
			],
		},
		{
			id: 'soj-andrea-woodmansee',
			name: 'Andrea Woodmansee',
			description:
				'Andrea Woodmansee on ancient temple theology: interviews, Dive Deeper, and the Holy Week series',
			episodes: [
				'dU81hfwml6Q', // Hidden Hebrew Wedding Ritual and The Temple (1:47:33, 382K — channel's most viewed)
				'stdxxgwhcdM', // The Temple, The Veil, and the Bridegroom (1:20:05)
				'9ZJRk8A7Uko',
				'v-QW07yO9sA',
				'RqqdXM5ZiVU',
				'NSvD6OSyiZY',
				'pnhTLJDAnEE',
				'LcDCoyqsjn8',
				'HNhRCcboLDw',
				'Rh-E4cuElj8',
				'KbLlsUK8P3I',
				// Holy Week series (daily, 16-42 min)
				's_uPQIw2Wi8',
				'iV5iicd1WiU',
				'fNsO8WJck3k',
				'OigiFEv22OQ',
				'HwRzz5ZN8Ac',
				'Ot5_74i_Z5A',
			],
		},
		{
			id: 'soj-mike-dave-books',
			name: 'Mike & Dave Read Books',
			description: 'Long-form book studies and deep-dive guides with Mike Day and Dave Butler',
			// 13, not 14: 'Top Scriptural Discoveries of 2025' (5q2xlK2TvMA) title-
			// matched here but is a year-end livestream — it lives in live-events
			episodes: [
				'_1arHtma-Ps', // The King Follett Discourse (1:42:36)
				'vi1qdSzStjY', // The Ultimate Guide to Freemasonry and the Temple (4:53:47)
				'WnFgxDinydY', // The Ultimate Guide to The Great Apostasy (3:43:34)
				'0n5DjpJ8MJs', // Jesus's Brother, Corruption, and The Great Apostasy (1:03:06)
				'HmT9GXDMuOA', // The Ancient Meaning of 'the Serpent' (1:47:48)
				's3YjnFxSN8A', // Who Wrote The Bible? (1:15:28)
				'rsuxJwfOlh4', // The Cultic Prophet in Ancient Israel (1:02:03)
				'vfF0opRPkjk', // King Josiah, Deuteronomy, and the Book of Mormon (1:04:35)
				'JTPtEsp7YRE', // Hugh Nibley Discovers The Ancient Endowment in Egypt (2:33:24)
				'NxpBhGHQ2WY', // Bible Contradictions and the Book of Mormon (1:05:59)
				'yVLnswlrdLU', // The First Temple, Nephi and Isaiah (48:58)
				'fYTRLzerkQs', // Oral Traditions of Isaiah Revealed (1:13:34)
				'Loxh5eIBGu8', // Unveiling the Temple: Sacred and Profane (43:37)
			],
		},
		{
			id: 'soj-stick-of-judah',
			name: 'Stick of Judah Lectures',
			description: 'The in-person Old Testament lecture series, streamed',
			// 7 of a billed 12 — more will arrive. These sit inside the Live
			// Streams playlist, so any future rule must claim Judah FIRST.
			episodes: [
				'H-dSOTl41sA', // The Documentary Hypothesis — Mike Day (46:56)
				'oNV0gr7VT_c', // Abraham the Astronomer — Smoot (39:15, TRIMMED cut; full stream won1FoY03sg excluded)
				'VU2FtGsSL4o', // Creation Through Combat — Trevan Hatch (46:51)
				'os630CTIW1I', // The Divine Feminine in the Torah — Mandy Green (42:41)
				'oE2U7tsLFZc', // The First Great Apostasy and the Deuteronomists — Val Larsen (43:30)
				'JM6ILq8hkyE', // Ghosts in the Old Testament — Chris Blythe (1:50:19 — likely untrimmed padding)
				'J8fy3hItnp4', // Hidden Books of Moses in the Hebrew Bible — Rob Kaye (1:11:56)
			],
		},
		{
			id: 'soj-live-events',
			name: 'Live Events & Book Launches',
			description: 'Book launch parties and live panel streams',
			// raw streams, no trimmed alternatives — expect pre-roll dead air
			episodes: [
				'KPq7NLgzkPk', // Rob Kaye: Hebrew Astronomy in Scripture (2:08:35)
				'xuVHCRdfQJ8', // Post-Debate Breakdown with Jacob Hansen (2:08:30)
				'ZDYw6d4PBcA', // Debate Breakdown: Hansen vs. White (2:07:15)
				'S0BmPyAGpQc', // Remembering Jeffrey R. Holland's Greatest Teachings (2:26:06)
				'5q2xlK2TvMA', // Top Scriptural Discoveries of 2025 (2:09:00 — the one M&D overlap, assigned here)
				'lD1grvhY4nk', // Jonah Barnes Book Announcement for 2026 (1:55:03)
				'LXoi1I_TQAk', // An Evangelical's Guide... (Austin Fife panel, 1:42:41)
				'K3amsJN-A40', // The Missing Ministry of the Risen Christ launch (2:06:11)
				'NH4-DqrZEa8', // Are Members Dropping in Biblical Literacy? (2:09:55)
				'4_DJy3iG2Kc', // The Antichrist Playbook (1:57:43)
				'FtQkqeLWY0o', // "The Doctrines and the Mysteries" launch (2:12:26)
				'cBWo0gSVCeA', // Hidden Holy Days & Bring Forth the Best Robe (1:48:42)
			],
		},
	],
	// shared collection metadata (tier/category/licence apply to all five)
	collectionDefaults: {
		tier: 'app',
		category: 'podcast',
		provenance: 'youtube',
		license: 'embedded playback; transcript indexed for navigation',
		storage: 'link',
		public: true, // Abram 2026-08-18: open to everyone from ingest
	},
	pools: { fetch: 2, transcribe: 3 },
	keytermMax: 100,
	// names the generic model cannot guess. Spelling per Abram 2026-08-18:
	// the host is McLaughlin (the channel's video titles misspell it
	// "McLauchlin" — do not copy the titles here). Prioritized ahead of
	// the DB-derived list.
	extraKeyterms: [
		'Todd McLaughlin',
		'McLaughlin',
		'Andrea Woodmansee',
		'Woodmansee',
		'Stick of Joseph',
		'Stick of Judah',
		// bake-off: nova-3 resolved the telestial/celestial minimal pair
		// wrongly at 5 sites (WhisperX + argument context agree against it),
		// inverting the speaker's meaning; the keyterm biases the pair apart
		'telestial',
	],
	// interview/live-stream titles are not CFM grammar — no scripture block
	titleParse: 'verbatim',
	// raw streams carry trailing dead air; 300 would fail exactly the padded
	// episodes we flagged (validateUtterances THROWS on a coverage gap)
	tailToleranceS: 900,
	// interview show: 2-3 speakers standard, 4+ on launch panels
	diarize: true,
};
