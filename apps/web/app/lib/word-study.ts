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
