// Title grammar for CFM deep-dive episodes (unshaken-ingest A1, plan probe 3).
// Four live variants: "Book C1-C2" · cross-book "1 Samuel 17 - 2 Samuel 10" ·
// multi-book "Ruth & 1 Samuel 1-7" · whole-book "The Book of Joshua: <sub>".
// The " - " separator ALSO appears inside cross-book blocks and subtitles —
// parsing is longest-valid-block-prefix, never a single split.

const PREFIX = 'Come Follow Me - ';

/** "2 Kings 14-25" | "1 Samuel 17" | "Ruth" → span pieces; null if not a ref.
 * Unicode dashes normalize inside ranges only (strongs lesson: dash classes). */
function parseRefElement(el) {
	const s = el.trim().replace(/[–—]/g, '-');
	const m = s.match(/^([1-3]? ?[A-Za-z][A-Za-z ]*?) (\d{1,3})(?:-(\d{1,3}))?$/);
	if (m) {
		const ranged = m[3] !== undefined;
		return {
			book: m[1],
			start: Number(m[2]),
			end: ranged ? Number(m[3]) : null,
			single: !ranged,
		};
	}
	// bare book name (whole book) — only meaningful inside "&" lists
	if (/^[1-3]? ?[A-Za-z][A-Za-z ]*$/.test(s) && !/\d/.test(s)) {
		return { book: s, start: 1, end: null, single: false, bare: true };
	}
	return null;
}

/** One block part, possibly an "&" list: "Ruth & 1 Samuel 1-7". */
function parseBlockPart(part) {
	const elements = part.split(' & ').map(parseRefElement);
	if (elements.some((e) => e === null)) return null;
	// a solo bare book is not a valid block ("A Special Episode" must not parse)
	if (elements.length === 1 && elements[0].bare) return null;
	return elements;
}

function toSpan(el) {
	return { book: el.book, start: el.start, end: el.single ? el.start : el.end };
}

/** parseTitle(title) → { spans:[{book,start,end|null}], subtitle } | null.
 * end:null means "to the end of the book" (resolved by anchorsForBlock). */
export function parseTitle(title) {
	if (typeof title !== 'string' || !title.startsWith(PREFIX)) return null;
	const rest = title.slice(PREFIX.length);

	// whole-book form: "The Book of Joshua: Choose You This Day"
	const whole = rest.match(/^The Book of ([1-3]? ?[A-Za-z][A-Za-z ]*?): (.+)$/);
	if (whole) {
		return { spans: [{ book: whole[1], start: 1, end: null }], subtitle: whole[2] };
	}

	const parts = rest.split(' - ');
	const first = parseBlockPart(parts[0]);
	if (!first) return null;

	// cross-book: "1 Samuel 17 - 2 Samuel 10 - <subtitle>" — both sides are
	// SINGLE-chapter refs; ranged or listed first parts never join across " - ".
	if (
		parts.length >= 2 &&
		first.length === 1 &&
		first[0].single &&
		!first[0].bare
	) {
		const second = parseRefElement(parts[1]);
		if (second && second.single && !second.bare) {
			return {
				spans: [
					{ book: first[0].book, start: first[0].start, end: null },
					{ book: second.book, start: 1, end: second.start },
				],
				subtitle: parts.slice(2).join(' - '),
			};
		}
	}

	const subtitle = parts.slice(1).join(' - ');
	if (!subtitle) return null; // deep dives always carry a subtitle
	return { spans: first.map(toSpan), subtitle };
}

/** Expand spans to spine chapter ids. FAIL-CLOSED: unknown books or missing
 * chapter counts throw — anchors are never silently dropped (H7). */
export function anchorsForBlock(spans, { bookIdByName, chapterCount }) {
	const ids = [];
	for (const span of spans) {
		const bookId = bookIdByName[span.book];
		if (!bookId) throw new Error(`unknown book in block: "${span.book}"`);
		const last = span.end ?? chapterCount[bookId];
		if (!Number.isInteger(last)) throw new Error(`no chapter count for ${bookId}`);
		if (!(span.start >= 1 && span.start <= last)) {
			throw new Error(`bad chapter range ${span.start}-${last} for ${bookId}`);
		}
		for (let c = span.start; c <= last; c += 1) ids.push(`${bookId}-${c}`);
	}
	return ids;
}
