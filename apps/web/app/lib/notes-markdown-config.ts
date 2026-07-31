import MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

/**
 * personal-notes A3 (CF-3) — ONE shared markdown-it configuration for both
 * parsers of stored note bodies: the editor's md→ProseMirror parser and the
 * server renderer (notes-render.server.ts). Two independently-whitelisted
 * parsers of the same bodies is a drift generator — a body that renders fine
 * must never crash the editor, so both sides consume exactly this token
 * stream.
 *
 * Whitelist stance: start from the `zero` preset and enable ONLY the
 * constrained construct set (paragraph and text are already in zero).
 * Everything else — code/fence/hr/link/image/autolink/html/table — stays
 * disabled, so out-of-schema constructs tokenize as literal text instead of
 * producing tokens the constrained PM schema has no handler for.
 */

/** The enabled rule set, exported so a test can pin it against upgrades. */
export const NOTES_MARKDOWN_RULES = [
	"heading", // ATX headings
	"lheading", // setext headings (canonicalized to ATX on serialize)
	"list",
	"blockquote",
	"emphasis", // strong + em
	"escape", // backslash escapes — must match the serializer's escaping
	// external web links (Abram, 2026-07-31): EXPLICIT [label](url) only —
	// autolink/linkify/image stay out; the renderer enforces http(s) and a
	// non-http href renders as its label, never an anchor
	"link",
] as const;

export interface WikilinkMeta {
	ref: string;
	label: string | null;
}

/** `[[ref]]` / `[[ref|label]]` — the persisted link grammar (A2/CF-42).
 * The tokenizer accepts any non-empty single-line ref; validity is the
 * renderer's / grammar's concern (fail-closed there, not here). */
function wikilink(state: StateInline, silent: boolean): boolean {
	const { src, pos } = state;
	if (src.charCodeAt(pos) !== 0x5b /* [ */ || src.charCodeAt(pos + 1) !== 0x5b) {
		return false;
	}
	const close = src.indexOf("]]", pos + 2);
	if (close < 0) return false;
	const inner = src.slice(pos + 2, close);
	if (inner.length === 0 || inner.includes("\n")) return false;
	const pipe = inner.indexOf("|");
	const ref = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
	if (ref === "") return false;
	const label = pipe === -1 ? null : inner.slice(pipe + 1);
	if (!silent) {
		const token = state.push("wikilink", "", 0);
		token.meta = { ref, label } satisfies WikilinkMeta;
		token.content = label ?? ref;
	}
	state.pos = close + 2;
	return true;
}

export function makeNotesMarkdown(): MarkdownIt {
	const md = new MarkdownIt("zero", { html: false, linkify: false });
	md.enable([...NOTES_MARKDOWN_RULES]);
	md.inline.ruler.push("wikilink", wikilink);
	return md;
}
