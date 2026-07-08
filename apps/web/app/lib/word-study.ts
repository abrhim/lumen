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
