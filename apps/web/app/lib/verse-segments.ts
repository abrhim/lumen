/**
 * Cutting a verse into paintable pieces — docs/design/highlighting.md, step 5.
 *
 * Marks can overlap and can sit inside one another, so the renderer cannot just
 * wrap existing spans. It has to cut the verse at every boundary that matters
 * and paint each piece with whatever covers it.
 *
 * Two kinds of boundary matter:
 *  - mark edges, which decide colour and style;
 *  - word edges, which the Bible reader already wraps for word study.
 *
 * Pure, so the overlap arithmetic is unit tested rather than eyeballed.
 */

export interface MarkRange {
	id: string;
	start: number;
	end: number;
	color: string;
	style: string;
}

export interface WordRange {
	/** the `data-wpos` the reader needs for word study */
	position: number;
	start: number;
	end: number;
}

export interface Segment {
	start: number;
	end: number;
	/** set when this piece lies inside a word the reader can look up */
	wordPosition?: number;
	/** marks covering this piece, in the order they were given */
	marks: MarkRange[];
}

/**
 * Every piece of the verse between consecutive boundaries, in order, covering
 * the text exactly once. Concatenating `text.slice(start, end)` over the result
 * reproduces the verse — the property the renderer depends on.
 *
 * `words` is empty for books with no word tags; the verse then cuts on mark
 * edges alone.
 */
export function segmentVerse(
	textLength: number,
	words: WordRange[],
	marks: MarkRange[],
): Segment[] {
	if (textLength <= 0) return [];

	const cuts = new Set<number>([0, textLength]);
	for (const w of words) {
		if (w.start > 0 && w.start < textLength) cuts.add(w.start);
		if (w.end > 0 && w.end < textLength) cuts.add(w.end);
	}
	for (const m of marks) {
		if (m.start > 0 && m.start < textLength) cuts.add(m.start);
		if (m.end > 0 && m.end < textLength) cuts.add(m.end);
	}
	const points = [...cuts].sort((a, b) => a - b);

	const segments: Segment[] = [];
	for (let i = 0; i < points.length - 1; i++) {
		const start = points[i];
		const end = points[i + 1];
		if (end <= start) continue;
		// a piece is inside a word when the word covers its whole width; cuts
		// come from the word edges themselves, so a partial overlap cannot occur
		const word = words.find((w) => w.start <= start && w.end >= end);
		const covering = marks.filter((m) => m.start <= start && m.end >= end);
		segments.push({
			start,
			end,
			...(word ? { wordPosition: word.position } : {}),
			marks: covering,
		});
	}
	return segments;
}

/**
 * The class list for one piece. Later marks win the background, because the
 * most recently laid mark is the one the reader just made — layering a colour
 * inside another is a feature, and the newer intent should read on top.
 *
 * Underline and text-colour do not paint a background, so they can ride along
 * with a highlight underneath rather than fighting it.
 */
export function segmentClasses(segment: Segment): string {
	if (segment.marks.length === 0) return "";
	const classes: string[] = [];
	const fills = segment.marks.filter((m) => m.style === "highlight");
	const top = fills[fills.length - 1];
	if (top) classes.push(`hl-${top.color}`, "hl-row");
	for (const m of segment.marks) {
		if (m.style === "underline") classes.push(`hl-${m.color}`, "hl-underline");
		else if (m.style === "text") classes.push(`hl-${m.color}`, "hl-text");
	}
	return classes.join(" ");
}
