import { parseReference } from "@lumen/scripture/slug-map";
import { BOOK_CHAPTER_COUNTS } from "@lumen/scripture/notes-refs";

/**
 * personal-notes A12 (CF-28) — the reference input rule's DETECTOR.
 *
 * Scans prose for canon references with a zero-false-positive posture (F4):
 * a missed link costs one manual `[[`; a false positive mangles the user's
 * sentence. The detector wraps the shipped parseReference (which alone
 * returns `unknown` for "1 Ne. 3:7" — periods are normalized here first).
 *
 * Rules, per the ratified contract:
 *  - Verse form (`Book C:V`) fires case-insensitively — mobile
 *    autocapitalize-off keyboards produce "alma 32:21".
 *  - Chapter form (`Book C`) fires only for capitalized, scripture-unique
 *    book names — "I told John 3 times" / "she acts 2 ways" never link.
 *  - Range policy: a trailing `-` after the verse suppresses the fire
 *    (link-with-range-label is deferred; never mangle "Alma 32:21-23").
 *  - Chapter numbers are bounded by the real per-book chapter count.
 */

export interface CanonReferenceMatch {
	/** canonical ref id, e.g. "alma-32-21" / "alma-32" */
	ref: string;
	/** the exact source span, e.g. "Alma 32:21" */
	text: string;
	index: number;
	length: number;
	kind: "verse" | "chapter";
}

/** Books whose chapter form ("Alma 32") is safe to auto-link: the name,
 * as written in prose, means scripture and nothing else. Common English
 * words and everyday names (John, Acts, Job, Mark, Ruth, Joel…) are
 * deliberately absent — their verse form (`John 3:16`) still links, the
 * colon is the disambiguator. Numbered books are always safe: "1 John 5"
 * has no everyday reading. */
const CHAPTER_FORM_BOOKS = new Set([
	"genesis", "exodus", "leviticus", "deuteronomy", "psalms", "psalm",
	"proverbs", "ecclesiastes", "isaiah", "jeremiah", "lamentations",
	"ezekiel", "hosea", "obadiah", "micah", "nahum", "habakkuk",
	"zephaniah", "haggai", "zechariah", "malachi",
	"matthew", "romans", "galatians", "ephesians", "philippians",
	"colossians", "philemon", "hebrews", "revelation",
	"mosiah", "alma", "helaman", "ether", "mormon", "moroni", "omni",
	"jarom", "enos", "words of mormon",
	"moses", "abraham", "d&c", "doctrine and covenants",
]);

const TRAILING_PUNCT = /[),.;:!?'"’”]+$/;

interface Tok {
	text: string;
	start: number;
}

function tokenize(text: string): Tok[] {
	const toks: Tok[] = [];
	const re = /\S+/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		toks.push({ text: m[0], start: m.index });
	}
	return toks;
}

/** ". " abbreviation periods → "" so parseReference sees "1 ne 3:7". */
function normalizeBook(candidate: string): string {
	return candidate.replace(/\./g, "").replace(/\s+/g, " ").trim();
}

function isNumberedOrCapitalized(bookSpan: string): boolean {
	const alpha = bookSpan.match(/[A-Za-z]/);
	if (/^\d/.test(bookSpan)) return true;
	return alpha !== null && alpha[0] === alpha[0].toUpperCase();
}

export function findCanonReferences(text: string): CanonReferenceMatch[] {
	const toks = tokenize(text);
	const matches: CanonReferenceMatch[] = [];
	const consumed = new Set<number>();

	// ── Verse form: <book tokens> C:V ──
	for (let i = 0; i < toks.length; i++) {
		const verseMatch = /^(\d{1,3}):(\d{1,3})/.exec(toks[i].text);
		if (!verseMatch) continue;
		const rest = toks[i].text.slice(verseMatch[0].length);
		// range guard: "Alma 32:21-" / "Alma 32:21-23" never fire
		if (rest.startsWith("-")) continue;
		// boundary: what follows the verse number must be punctuation only
		if (rest !== "" && !TRAILING_PUNCT.test(rest)) continue;
		if (rest !== "" && /[A-Za-z0-9]/.test(rest)) continue;

		for (let j = Math.min(3, i); j >= 1; j--) {
			const bookToks = toks.slice(i - j, i);
			const bookSpan = bookToks.map((t) => t.text).join(" ");
			if (!/^[A-Za-z0-9&.\s]+$/.test(bookSpan)) continue;
			const parsed = parseReference(
				`${normalizeBook(bookSpan)} ${verseMatch[1]}:${verseMatch[2]}`,
			);
			if (parsed.level !== "verse" || !parsed.bookId) continue;
			const count = BOOK_CHAPTER_COUNTS[parsed.bookId];
			if (count === undefined || parsed.chapter! > count) continue;
			const start = bookToks[0].start;
			const end = toks[i].start + verseMatch[0].length;
			matches.push({
				ref: `${parsed.bookId}-${parsed.chapter}-${parsed.verse}`,
				text: text.slice(start, end),
				index: start,
				length: end - start,
				kind: "verse",
			});
			for (let k = i - j; k <= i; k++) consumed.add(k);
			break;
		}
	}

	// ── Chapter form: <Capitalized unique book> C ──
	for (let i = 0; i < toks.length; i++) {
		if (consumed.has(i)) continue;
		const chapMatch = /^(\d{1,3})$/.exec(toks[i].text.replace(TRAILING_PUNCT, ""));
		if (!chapMatch) continue;
		if (/[-:]/.test(toks[i].text)) continue;

		for (let j = Math.min(3, i); j >= 1; j--) {
			if (consumed.has(i - j)) continue;
			const bookToks = toks.slice(i - j, i);
			const bookSpan = bookToks.map((t) => t.text).join(" ");
			if (!/^[A-Za-z0-9&.\s]+$/.test(bookSpan)) continue;
			const normalized = normalizeBook(bookSpan).toLowerCase();
			const unique = CHAPTER_FORM_BOOKS.has(normalized) || /^\d/.test(normalized);
			if (!unique) continue;
			if (!isNumberedOrCapitalized(bookSpan)) continue;
			const parsed = parseReference(`${normalizeBook(bookSpan)} ${chapMatch[1]}`);
			if (parsed.level !== "chapter" || !parsed.bookId) continue;
			const count = BOOK_CHAPTER_COUNTS[parsed.bookId];
			if (count === undefined || parsed.chapter! > count) continue;
			const start = bookToks[0].start;
			const end = toks[i].start + chapMatch[1].length;
			matches.push({
				ref: `${parsed.bookId}-${parsed.chapter}`,
				text: text.slice(start, end),
				index: start,
				length: end - start,
				kind: "chapter",
			});
			for (let k = i - j; k <= i; k++) consumed.add(k);
			break;
		}
	}

	return matches.sort((a, b) => a.index - b.index);
}
