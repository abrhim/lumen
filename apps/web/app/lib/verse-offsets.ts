import { tokenize } from "@lumen/scripture";

/**
 * Turning a DOM selection into character offsets in a verse — step 2 of
 * docs/design/highlighting.md.
 *
 * The arithmetic here is the whole feature. Get it wrong and marks land on the
 * wrong words and the data is quietly corrupt, so everything below is a pure
 * function over strings and numbers and is unit tested. The only DOM-aware part
 * is `indexTextPieces`, which walks child nodes and does nothing else.
 *
 * Offsets count characters in the verse's OWN text — never DOM positions, and
 * never anything outside the verse-text container. The verse link also holds
 * the verse NUMBER (first, in the gutter) and a ", your note" screen-reader
 * span; counting those shifts every offset and silently misplaces every mark.
 */

/** The shape a real DOM node satisfies structurally, so the walk is testable
 * without a DOM implementation. */
export interface NodeLike {
	nodeType: number;
	textContent: string | null;
	childNodes: ArrayLike<NodeLike>;
}

const TEXT_NODE = 3;

export interface TextPiece {
	node: NodeLike;
	/** inclusive start of this piece in the verse's plain text */
	start: number;
	/** exclusive end */
	end: number;
}

/**
 * Every text node under `container`, in document order, with its span in the
 * verse's plain text. Concatenating the pieces reproduces the verse exactly —
 * which is what makes the offsets agree with what the reader shows.
 */
export function indexTextPieces(container: NodeLike): TextPiece[] {
	const pieces: TextPiece[] = [];
	let cursor = 0;
	const walk = (node: NodeLike) => {
		if (node.nodeType === TEXT_NODE) {
			const len = node.textContent?.length ?? 0;
			if (len > 0) {
				pieces.push({ node, start: cursor, end: cursor + len });
				cursor += len;
			}
			return;
		}
		for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
	};
	walk(container);
	return pieces;
}

/**
 * A DOM position — a node plus an offset within it — as a character offset.
 * Returns null when the node is not inside the container at all.
 *
 * A range endpoint can name a TEXT node (offset = characters into it) or an
 * ELEMENT (offset = index among its children); both occur in practice.
 */
export function offsetOfPosition(
	pieces: TextPiece[],
	container: NodeLike,
	node: NodeLike,
	nodeOffset: number,
): number | null {
	if (node.nodeType === TEXT_NODE) {
		const piece = pieces.find((p) => p.node === node);
		if (!piece) return null;
		return piece.start + Math.min(nodeOffset, piece.end - piece.start);
	}
	// an element position: the boundary sits before its nodeOffset-th child.
	// Resolve it to the first text piece at or after that child.
	const children = node.childNodes;
	if (nodeOffset >= children.length) {
		// past the last child — the end of this element's own text
		const own = collectPieces(pieces, node);
		if (own.length > 0) return own[own.length - 1].end;
		return node === container ? totalLength(pieces) : null;
	}
	const target = children[nodeOffset];
	const inTarget = collectPieces(pieces, target);
	if (inTarget.length > 0) return inTarget[0].start;
	const own = collectPieces(pieces, node);
	return own.length > 0 ? own[0].start : null;
}

function collectPieces(pieces: TextPiece[], root: NodeLike): TextPiece[] {
	const found: TextPiece[] = [];
	const walk = (n: NodeLike) => {
		if (n.nodeType === TEXT_NODE) {
			const p = pieces.find((x) => x.node === n);
			if (p) found.push(p);
			return;
		}
		for (let i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i]);
	};
	walk(root);
	return found;
}

function totalLength(pieces: TextPiece[]): number {
	return pieces.length === 0 ? 0 : pieces[pieces.length - 1].end;
}

export interface OffsetRange {
	start: number;
	end: number;
}

/**
 * Grow a raw range out to whole words, using the SAME tokenizer the reader
 * renders with, so a mark can never cut a word in half.
 *
 * The rule is "cover exactly the words the selection touched":
 *  - a start inside a word moves BACK to that word's first character;
 *  - a start in the gap between words moves FORWARD to the next word, because
 *    the reader did not touch the word behind it;
 *  - an end inside a word moves FORWARD to that word's last character;
 *  - an end in a gap moves BACK to the previous word, for the same reason.
 *
 * Punctuation between two covered words stays inside the range, because the
 * result is one interval and not a set of words — "verily, verily" must paint
 * as one band, not two with a white gap.
 *
 * Returns null when the selection covers no word at all (all whitespace or
 * punctuation), which must not become a mark.
 */
export function snapToWords(text: string, start: number, end: number): OffsetRange | null {
	if (start > end) [start, end] = [end, start];
	const lo = Math.max(0, Math.min(start, text.length));
	const hi = Math.max(0, Math.min(end, text.length));
	const tokens = tokenize(text);
	if (tokens.length === 0) return null;

	// first word whose end is past the start — i.e. the first one touched
	const first = tokens.find((t) => t.char_end > lo);
	// last word whose start is before the end
	let last: (typeof tokens)[number] | undefined;
	for (const t of tokens) {
		if (t.char_start < hi) last = t;
		else break;
	}
	if (!first || !last || first.char_start > last.char_start) return null;
	// a zero-width selection sitting in a gap touches nothing
	if (lo === hi && (lo <= first.char_start || lo >= first.char_end)) return null;
	return { start: first.char_start, end: last.char_end };
}

export interface VerseSpanInput {
	verseId: string;
	text: string;
	/** raw offsets in THIS verse, before snapping */
	start: number;
	end: number;
}

export interface VerseSpan {
	verseId: string;
	start: number;
	end: number;
}

/**
 * Snap each verse's slice and drop the ones that cover no word. A selection
 * dragged across three verses arrives as three inputs: partial, whole, partial.
 * Verses whose slice lands entirely in whitespace fall out, which is why the
 * result can be shorter than the input.
 */
export function snapSpans(inputs: VerseSpanInput[]): VerseSpan[] {
	const out: VerseSpan[] = [];
	for (const v of inputs) {
		const snapped = snapToWords(v.text, v.start, v.end);
		if (snapped) out.push({ verseId: v.verseId, start: snapped.start, end: snapped.end });
	}
	return out;
}

/** The marked text itself, for the mark's `quote` column. Verses join with a
 * space so the quote reads as prose rather than running words together. */
export function quoteOf(inputs: VerseSpanInput[], spans: VerseSpan[]): string {
	const byId = new Map(inputs.map((i) => [i.verseId, i.text]));
	return spans
		.map((s) => byId.get(s.verseId)?.slice(s.start, s.end) ?? "")
		.filter(Boolean)
		.join(" ");
}
