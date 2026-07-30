import { parseReference } from "@lumen/scripture/slug-map";
import { BOOK_CHAPTER_COUNTS, resolveAnchorRef, anchorRefToPath } from "@lumen/scripture/notes-refs";

/**
 * personal-notes A10 — the client-side destination source behind `[[`
 * autocomplete and the ⌘K insert posture. No /api/search leg (keeps the
 * palette out of D3's blast radius): scripture resolves locally via the
 * shipped parseReference + chapter counts; anything entity-shaped inserts
 * as typed (the grammar validates on save; unresolvable refs render
 * fail-closed). Entity suggestions arrive with the palette's destination
 * index in a later feature.
 */

export interface InsertSuggestion {
	ref: string;
	/** human display, e.g. "Alma 32:21" */
	display: string;
	kind: "verse" | "chapter" | "entity" | "transcript";
	/** reader path when navigable (⌘↵ door) */
	path: string | null;
}

function titleCaseSlug(slug: string): string {
	return slug
		.split("-")
		.map((s) => (/^\d+$/.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1)))
		.join(" ");
}

export function suggestDestinations(rawQuery: string): InsertSuggestion[] {
	const query = rawQuery.trim();
	if (query === "") return [];
	const out: InsertSuggestion[] = [];
	const seen = new Set<string>();
	const push = (ref: string) => {
		const anchor = resolveAnchorRef(ref);
		if (!anchor || seen.has(ref)) return;
		seen.add(ref);
		out.push({
			ref,
			display:
				anchor.kind === "verse" || anchor.kind === "chapter" ? titleCaseSlug(ref).replace(/ (\d+) (\d+)$/, " $1:$2") : ref,
			kind: anchor.kind,
			path: anchorRefToPath(anchor),
		});
	};

	// human form: "alma 32:21", "1 ne. 3:7", "alma 32"
	const parsed = parseReference(query.replace(/\./g, ""));
	if (parsed.level === "verse" && parsed.bookId) {
		push(`${parsed.bookId}-${parsed.chapter}-${parsed.verse}`);
	} else if (parsed.level === "chapter" && parsed.bookId) {
		push(`${parsed.bookId}-${parsed.chapter}`);
	}

	// canonical-slug prefix: "alma-3" → alma-3 … alma-39 chapters (first few)
	if (/^[a-z0-9-]+$/.test(query)) {
		push(query); // exact canonical ref or entity shape, as typed
		const m = /^([a-z0-9-]+?)-?(\d*)$/.exec(query);
		if (m && BOOK_CHAPTER_COUNTS[m[1]] !== undefined && m[2] === "") {
			for (let c = 1; c <= Math.min(3, BOOK_CHAPTER_COUNTS[m[1]]); c++) push(`${m[1]}-${c}`);
		}
	}

	return out.slice(0, 6);
}
