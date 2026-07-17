/**
 * PROTOTYPE demo data for the podcast collection type (proto/podcast-ui).
 * "The Grove" is a placeholder show — nothing here is a real dataset. When the
 * feature lands for real, this module is replaced by lumen.entities rows
 * (entity_type content_item/content_segment, collection-scoped) and a `media`
 * descriptor convention; the route components are written against these shapes
 * so the swap is a loader change, not a rewrite.
 */

export type MediaDescriptor =
	| { kind: "youtube"; videoId: string | null; durationLabel: string }
	| { kind: "audio"; url: string | null; durationLabel: string };

export interface ChapterAnchor {
	book: string; // books.id — href target
	label: string; // "Alma 32"
	chapter: number;
}

export interface Segment {
	t: string; // "23:14"
	seconds: number;
	ref: string; // "Alma 32:28"
	book: string;
	chapter: number;
	verse: number;
	snippet: string;
}

export interface TranscriptBlock {
	t: string;
	seconds: number;
	speaker: "Host" | "Cohost";
	text: string;
}

export interface DemoEpisode {
	id: string;
	number: number;
	title: string;
	dateLabel: string;
	minutes: number;
	media: MediaDescriptor;
	chapters: ChapterAnchor[];
	/** Timestamped anchors — the transcript-pass fast-follow; only ep 37 has them. */
	segments: Segment[];
	discussed: string[];
	description: string;
	/** Excerpt only in the demo; the real thing arrives with ingestion. The
	 * transcript is the source segments get extracted from — refs are detected
	 * in this text, which is why the view auto-links them. */
	transcript: TranscriptBlock[];
}

export const DEMO_SHOW = {
	id: "the-grove",
	name: "The Grove",
	tagline: "A Come, Follow Me companion",
	provenance: "embedded playback · links to source · demo data",
} as const;

export const DEMO_EPISODES: DemoEpisode[] = [
	{
		id: "grove-ep-36",
		number: 36,
		title: "The Zoramites and the Rameumptom",
		dateLabel: "Jun 2026",
		minutes: 48,
		media: { kind: "audio", url: null, durationLabel: "48:21" },
		chapters: [
			{ book: "alma", label: "Alma 30", chapter: 30 },
			{ book: "alma", label: "Alma 31", chapter: 31 },
		],
		segments: [],
		discussed: ["Korihor", "Alma", "Prayer", "Pride"],
		description:
			"Korihor's challenge and the mission to the Zoramites — what a captive people's prayer reveals about worship.",
		transcript: [],
	},
	{
		id: "grove-ep-37",
		number: 37,
		title: "A Seed of Faith",
		dateLabel: "Jul 2026",
		minutes: 52,
		media: { kind: "youtube", videoId: null, durationLabel: "52:04" },
		chapters: [
			{ book: "alma", label: "Alma 32", chapter: 32 },
			{ book: "alma", label: "Alma 33", chapter: 33 },
			{ book: "alma", label: "Alma 34", chapter: 34 },
		],
		segments: [
			{
				t: "06:12",
				seconds: 372,
				ref: "Alma 32:21",
				book: "alma",
				chapter: 32,
				verse: 21,
				snippet: "“faith is not to have a perfect knowledge of things…”",
			},
			{
				t: "23:14",
				seconds: 1394,
				ref: "Alma 32:28",
				book: "alma",
				chapter: 32,
				verse: 28,
				snippet: "the seed experiment — planting the word",
			},
			{
				t: "41:03",
				seconds: 2463,
				ref: "Alma 33:19",
				book: "alma",
				chapter: 33,
				verse: 19,
				snippet: "the brazen serpent as a type of Christ",
			},
		],
		discussed: [
			"Alma",
			"Amulek",
			"Faith",
			"Hope",
			"Humility",
			"Prayer",
			"Patience",
			"The Word",
			"Antionum",
			"Onidah",
			"Zoramites",
			"Rameumptom",
			"Justice",
			"Mercy",
			"Atonement",
		],
		description:
			"Alma among the poor of the Zoramites — how an experiment upon the word grows into a tree of life.",
		transcript: [
			{
				t: "05:44",
				seconds: 344,
				speaker: "Host",
				text: "So Alma is on the hill Onidah, and the people who come to him aren't the ones in the synagogues — they're the ones who built the synagogues and then got thrown out of them. And that's who he teaches faith to.",
			},
			{
				t: "06:12",
				seconds: 372,
				speaker: "Cohost",
				text: "Right, and that's where you get the definition. Alma 32:21 — faith is not to have a perfect knowledge of things; therefore if ye have faith ye hope for things which are not seen, which are true.",
			},
			{
				t: "06:41",
				seconds: 401,
				speaker: "Cohost",
				text: "Every word of that is doing work. It's not hoping for whatever you want — it's hoping for things which are true. Faith has an object, and the object has to hold.",
			},
			{
				t: "07:19",
				seconds: 439,
				speaker: "Host",
				text: "And then he lowers the bar so far that nobody's excluded. Alma 32:27 — even if ye can no more than desire to believe, let this desire work in you. A particle of faith. That's the entry price.",
			},
			{
				t: "08:03",
				seconds: 483,
				speaker: "Cohost",
				text: "Which sets up the experiment. Alma 32:28 compares the word to a seed — you plant it, you don't ignore it, and you watch what it does. It either swells and enlightens or it doesn't. He's giving them something falsifiable.",
			},
			{
				t: "08:47",
				seconds: 527,
				speaker: "Host",
				text: "What I love is that the evidence is interior. The seed swells within you. Nobody can run the experiment for you, and nobody can run it on you.",
			},
			{
				t: "09:21",
				seconds: 561,
				speaker: "Cohost",
				text: "And it ends in a tree. We'll get to Alma 33:23 before we're done — plant this word in your hearts — but hold onto that image of the seed becoming a tree of life, because the whole sermon is walking there.",
			},
		],
	},
	{
		id: "grove-ep-38",
		number: 38,
		title: "My Son, Give Ear to My Words",
		dateLabel: "Jul 2026",
		minutes: 47,
		media: { kind: "youtube", videoId: null, durationLabel: "47:40" },
		chapters: [
			{ book: "alma", label: "Alma 36", chapter: 36 },
			{ book: "alma", label: "Alma 37", chapter: 37 },
			{ book: "alma", label: "Alma 38", chapter: 38 },
		],
		segments: [],
		discussed: ["Alma", "Helaman", "Shiblon", "Repentance", "Records"],
		description:
			"Alma's counsel to his sons — the chiasm of his conversion and the small means that bring about great things.",
		transcript: [],
	},
];

export function getDemoEpisode(id: string): DemoEpisode | null {
	return DEMO_EPISODES.find((e) => e.id === id) ?? null;
}

/** Landing groups: episodes in scripture order under a book heading. */
export function episodesByBook(): { book: string; episodes: DemoEpisode[] }[] {
	const groups = new Map<string, DemoEpisode[]>();
	for (const e of DEMO_EPISODES) {
		const key = e.chapters[0]?.label.replace(/\s+\d+$/, "") ?? "Other";
		const list = groups.get(key) ?? [];
		list.push(e);
		groups.set(key, list);
	}
	return [...groups.entries()].map(([book, episodes]) => ({
		book,
		episodes: [...episodes].sort((a, b) => (a.chapters[0]?.chapter ?? 0) - (b.chapters[0]?.chapter ?? 0)),
	}));
}
