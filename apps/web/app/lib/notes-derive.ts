/**
 * personal-notes A14 (CF-27) — ONE markdown-stripping helper deriving the
 * plain-text title and snippet for every list surface (/notes index, reader
 * rail, search-leg results). Full markdown render happens ONLY on
 * /notes/:id; these are cheap string passes, never a parser.
 *
 * Output is plain text — never HTML, never wikilink/emphasis syntax. This
 * is the producer side of the F6 XSS surface: hostile bodies must come out
 * as inert text.
 */

/** A6/CF-32 — mirrored as a friendly 400 before PostgREST is hit; the DDL
 * CHECK (octet_length ≤ 65536) is the real wall. */
export const NOTE_BODY_MAX_BYTES = 65536;

export const NOTE_TITLE_MAX = 80;
export const NOTE_SNIPPET_MAX = 200;
export const UNTITLED_NOTE = "Untitled note";

/** One markdown line → plain text: wikilinks become their label (or ref),
 * emphasis/heading/list/quote syntax is stripped, tags are stripped. */
export function stripNoteMarkdownLine(line: string): string {
	return (
		line
			// wikilinks first: [[ref|label]] → label, [[ref]] → ref
			.replace(/\[\[([^\]|\n]+)\|([^\]\n]*)\]\]/g, (_m, _ref, label: string) => label)
			.replace(/\[\[([^\]|\n]+)\]\]/g, (_m, ref: string) => ref)
			// md links/images pasted as literal text: keep the label
			.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
			// block prefixes: headings, quotes, list markers
			.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d{1,3}[.)]\s+)/, "")
			// emphasis and code delimiters
			.replace(/(\*\*|__|[*_`~])/g, "")
			// anything tag-shaped is stripped, never escaped-and-kept
			.replace(/<[^>]*>/g, "")
			.replace(/\s+/g, " ")
			.trim()
	);
}

function cap(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max - 1).trimEnd() + "…";
}

/** First non-empty line, stripped and capped; empty/link-only bodies fall
 * back to "Untitled note" so index links never have empty names (Q4). */
export function deriveNoteTitle(bodyMd: string): string {
	for (const line of bodyMd.split("\n")) {
		const stripped = stripNoteMarkdownLine(line);
		if (stripped !== "") return cap(stripped, NOTE_TITLE_MAX);
	}
	return UNTITLED_NOTE;
}

/** Plain-text excerpt from the body AFTER the title line. */
export function deriveNoteSnippet(bodyMd: string): string {
	const lines = bodyMd.split("\n");
	let titleSeen = false;
	const parts: string[] = [];
	for (const line of lines) {
		const stripped = stripNoteMarkdownLine(line);
		if (stripped === "") continue;
		if (!titleSeen) {
			titleSeen = true;
			continue;
		}
		parts.push(stripped);
		if (parts.join(" ").length >= NOTE_SNIPPET_MAX) break;
	}
	return cap(parts.join(" "), NOTE_SNIPPET_MAX);
}
