import type { WordTagRow } from "@lumen/scripture";

/** A verse rendered as alternating plain/tagged segments — built purely from
 * char offsets (FM-7: the verse is SLICED, never reconstructed from tokens). */
export interface WordSegment {
	text: string;
	tag: WordTagRow | null;
}

export function buildWordSegments(text: string, tags: WordTagRow[]): WordSegment[] {
	const sorted = [...tags].sort((a, b) => a.char_start - b.char_start);
	const segments: WordSegment[] = [];
	let cursor = 0;
	for (const t of sorted) {
		if (t.char_start < cursor || t.char_end > text.length) continue; // defensive: bad offsets never corrupt the text
		if (t.char_start > cursor) segments.push({ text: text.slice(cursor, t.char_start), tag: null });
		segments.push({ text: text.slice(t.char_start, t.char_end), tag: t });
		cursor = t.char_end;
	}
	if (cursor < text.length) segments.push({ text: text.slice(cursor), tag: null });
	return segments;
}

/** FM-7 invariant: joining the segments must yield the original string. */
export function segmentsReconstruct(text: string, segments: WordSegment[]): boolean {
	return segments.map((s) => s.text).join("") === text;
}

/** A structured line of a lexicon definition (word detail page typesetting). */
export interface DefinitionLine {
	depth: number;
	text: string;
}

/**
 * Abbott-Smith / BDB definitions arrive as flat text with `__` sense markers
 * (`__1.` → `__(i)` → `__(a)`/`__(1)`). Turn them into an indent hierarchy so
 * the word page reads like a lexicon instead of a wall.
 */
export function structureDefinition(definition: string): DefinitionLine[] {
	return definition
		.split("\n")
		.map((raw) => raw.trim())
		.filter(Boolean)
		.map((line) => {
			const m = line.match(/^(__+)(.*)$/);
			if (!m) return { depth: 0, text: line };
			const body = m[2].trim();
			let depth = 1;
			if (/^\((?:[ivx]+)\)/i.test(body)) depth = 2;
			else if (/^\((?:[a-z]|\d+)\)/i.test(body)) depth = 3;
			else if (/^\d/.test(body)) depth = 1;
			return { depth, text: body };
		});
}

/** 'H7225' → 'Hebrew'; 'G25' → 'Greek'. */
export function strongsLanguage(strongsNo: string): "Hebrew" | "Greek" {
	return strongsNo.startsWith("H") ? "Hebrew" : "Greek";
}

/** Pure function words the KJV tagging prefixes onto content words: the Greek
 * article (ὁ) and the Hebrew object marker (אֵת). "taxing" arrives as
 * [G3588, G582] — showing the article's "the/this/who" reads as no definition. */
const FUNCTION_WORD_NOS = new Set(["G3588", "H853"]);

/** The entry the inline card should lead with: the first content-bearing one,
 * falling back to entries[0] when the word IS a function word. */
export function primaryEntry<T extends { strongs_no: string }>(entries: T[]): T | undefined {
	return entries.find((e) => !FUNCTION_WORD_NOS.has(e.strongs_no)) ?? entries[0];
}

/**
 * The contiguous run of word positions sharing `position`'s exact Strong's
 * signature — several English words rendering one original word ("to be
 * taxed" ← ἀπογράφω) highlight as a group.
 */
export function wordGroupPositions(tags: WordTagRow[], position: number): Set<number> {
	// drivers disagree on TEXT[] decoding (worker: raw '{G583}' string) — the
	// signature only needs equality, so stringify whatever shape arrives
	const sigByPos = new Map(
		tags.map((t) => [t.position, Array.isArray(t.strongs) ? t.strongs.join(" ") : String(t.strongs)]),
	);
	const sig = sigByPos.get(position);
	const group = new Set([position]);
	if (sig === undefined) return group;
	for (let p = position - 1; sigByPos.get(p) === sig; p--) group.add(p);
	for (let p = position + 1; sigByPos.get(p) === sig; p++) group.add(p);
	return group;
}
