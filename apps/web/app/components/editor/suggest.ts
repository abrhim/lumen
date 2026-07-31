import { BOOK_ALIAS_ENTRIES } from "@lumen/scripture/slug-map";
import {
	BOOK_CHAPTER_COUNTS,
	resolveAnchorRef,
	anchorRefToPath,
} from "@lumen/scripture/notes-refs";
import { CHAPTER_VERSE_COUNTS } from "@lumen/scripture/verse-counts";

/**
 * personal-notes — the destination engine behind `[[` and ⌘K (v2, Abram's
 * in-session direction 2026-07-30): progressive reference drilling with
 * fuzzy book matching, no artificial result cap (the popup scrolls).
 *
 *  - "alm"       → fuzzy book matches (Alma, …)
 *  - "alma"      → the book's chapters
 *  - "alma 3"    → chapter Alma 3 PINNED, then every verse in the chapter
 *  - "alma 3 2"  → Alma 3:2 first, then 3:20-29 (prefix), then …ends-in-2
 *
 * Still no /api/search leg (keeps the palette out of D3's blast radius);
 * anything entity-shaped inserts as typed and the grammar validates on
 * save (unresolvable refs render fail-closed).
 */

export interface InsertSuggestion {
	ref: string;
	/** human display, e.g. "Alma 32:21" */
	display: string;
	kind: "verse" | "chapter" | "entity" | "transcript" | "book";
	/** reader path when navigable (⌘↵ door) */
	path: string | null;
}

function titleCaseSlug(slug: string): string {
	return slug
		.split("-")
		.map((s) => (/^\d+$/.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1)))
		.join(" ");
}

/** Preferred display name per book id: the longest alias (the full name). */
const BOOK_DISPLAY: Record<string, string> = {};
for (const [alias, id] of BOOK_ALIAS_ENTRIES) {
	const pretty = alias
		.split(" ")
		.map((w) => (/^\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
		.join(" ");
	if (!BOOK_DISPLAY[id] || pretty.length > BOOK_DISPLAY[id].length) {
		BOOK_DISPLAY[id] = pretty;
	}
}

/** Fuzzy book match: exact alias, alias prefix, then subsequence. Returns
 * canonical ids ranked (exact > prefix > subsequence), deduped. */
function matchBooks(token: string): string[] {
	if (token === "") return [];
	const exact: string[] = [];
	const prefix: string[] = [];
	const sub: string[] = [];
	const seen = new Set<string>();
	const isSubsequence = (needle: string, hay: string) => {
		let i = 0;
		for (const ch of hay) if (ch === needle[i]) i++;
		return i >= needle.length;
	};
	for (const [alias, id] of BOOK_ALIAS_ENTRIES) {
		if (seen.has(id)) continue;
		if (alias === token) {
			exact.push(id);
			seen.add(id);
		}
	}
	for (const [alias, id] of BOOK_ALIAS_ENTRIES) {
		if (seen.has(id)) continue;
		if (alias.startsWith(token)) {
			prefix.push(id);
			seen.add(id);
		}
	}
	for (const [alias, id] of BOOK_ALIAS_ENTRIES) {
		if (seen.has(id)) continue;
		if (token.length >= 3 && isSubsequence(token, alias)) {
			sub.push(id);
			seen.add(id);
		}
	}
	return [...exact, ...prefix, ...sub];
}

function chapterSuggestion(book: string, chapter: number): InsertSuggestion {
	const ref = `${book}-${chapter}`;
	return {
		ref,
		display: `${BOOK_DISPLAY[book] ?? titleCaseSlug(book)} ${chapter}`,
		kind: "chapter",
		path: `/scripture/${book}/${chapter}`,
	};
}

function verseSuggestion(book: string, chapter: number, verse: number): InsertSuggestion {
	return {
		ref: `${book}-${chapter}-${verse}`,
		display: `${BOOK_DISPLAY[book] ?? titleCaseSlug(book)} ${chapter}:${verse}`,
		kind: "verse",
		path: `/scripture/${book}/${chapter}?verse=${verse}`,
	};
}

export function suggestDestinations(rawQuery: string): InsertSuggestion[] {
	const query = rawQuery.trim().toLowerCase().replace(/\./g, "");
	if (query === "") return [];
	const out: InsertSuggestion[] = [];
	const seen = new Set<string>();
	const push = (s: InsertSuggestion) => {
		if (seen.has(s.ref)) return;
		seen.add(s.ref);
		out.push(s);
	};

	// split trailing numeric parts off the book tokens: "alma 3 2" /
	// "alma 3:2" / "1 ne 3 7" → book="alma"/"1 ne", chapter=3, versePart="2"
	const m = /^(.*?)(?:\s+(\d+))?(?:\s*[:\s]\s*(\d+))?$/.exec(query);
	let bookToken = (m?.[1] ?? query).trim();
	let chapterNum = m?.[2] ? parseInt(m[2], 10) : null;
	let versePart = m?.[3] ?? null;

	// glued form: "alma63" → book "alma", chapter 63 (and "alma63 2" shifts
	// the trailing number into the verse slot)
	const glued = /^(.*?[a-z])(\d+)$/.exec(bookToken);
	if (glued && matchBooks(bookToken).length === 0) {
		const peeled = glued[1].trim();
		if (matchBooks(peeled).length > 0) {
			if (chapterNum !== null && versePart === null) versePart = String(chapterNum);
			bookToken = peeled;
			chapterNum = parseInt(glued[2], 10);
		}
	}

	const books = matchBooks(bookToken);

	if (books.length > 0 && chapterNum !== null) {
		for (const book of books) {
			const chapterCount = BOOK_CHAPTER_COUNTS[book] ?? 0;
			if (chapterNum < 1 || chapterNum > chapterCount) continue;
			const verseCount = CHAPTER_VERSE_COUNTS[book]?.[chapterNum - 1] ?? 0;
			if (versePart !== null) {
				// drilled to verse digits: exact first, then prefix (2 → 20s),
				// then ends-with (…2) — Abram's ranking
				const exact = parseInt(versePart, 10);
				if (exact >= 1 && exact <= verseCount) push(verseSuggestion(book, chapterNum, exact));
				for (let v = 1; v <= verseCount; v++) {
					if (v !== exact && String(v).startsWith(versePart)) {
						push(verseSuggestion(book, chapterNum, v));
					}
				}
				for (let v = 1; v <= verseCount; v++) {
					if (String(v).endsWith(versePart)) push(verseSuggestion(book, chapterNum, v));
				}
			} else {
				// chapter typed: pin the chapter, then all its verses
				push(chapterSuggestion(book, chapterNum));
				for (let v = 1; v <= verseCount; v++) push(verseSuggestion(book, chapterNum, v));
			}
		}
	} else if (books.length > 0) {
		// book typed (possibly fuzzily): list its chapters
		for (const book of books.slice(0, 4)) {
			const chapterCount = BOOK_CHAPTER_COUNTS[book] ?? 0;
			for (let c = 1; c <= chapterCount; c++) push(chapterSuggestion(book, c));
		}
	}

	// raw canonical ref or entity slug, as typed — always available as a door
	if (/^[a-z0-9-]+(@\d+(\.\d+)?)?$/.test(query)) {
		const anchor = resolveAnchorRef(query);
		if (anchor && !seen.has(query)) {
			out.push({
				ref: query,
				display:
					anchor.kind === "verse" || anchor.kind === "chapter"
						? titleCaseSlug(query).replace(/ (\d+) (\d+)$/, " $1:$2")
						: query,
				kind: anchor.kind,
				path: anchorRefToPath(anchor),
			});
		}
	}

	return out;
}
