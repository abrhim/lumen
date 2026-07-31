import { Schema, type Node as PMNode } from "prosemirror-model";
import { MarkdownParser, MarkdownSerializer } from "prosemirror-markdown";
import type Token from "markdown-it/lib/token.mjs";
import { makeNotesMarkdown } from "~/lib/notes-markdown-config";

/**
 * personal-notes A2/A3 — the editor's markdown boundary.
 *
 * Storage invariant (CF-2): CANONICAL FORM, not byte identity. The house
 * serializer config is `-` bullets, `*` emphasis (`**` strong), ATX
 * headings, trailing newline. `C(md) = serializeNoteDoc(parseNoteMarkdown(md))`
 * is idempotent; every save path stores C, so all stored bodies are
 * canonical from birth.
 *
 * The parser consumes the SHARED whitelisted markdown-it config (A3) —
 * out-of-schema constructs arrive as literal text and can never produce a
 * token this schema has no handler for. parse never throws on any input.
 */

/** Constrained schema (plan D2/D7): paragraph, heading 1–3, strong, em,
 * bullet/ordered list, blockquote, wikilink inline atom. No code, hr,
 * image, or plain link — deliberate (out-of-schema text survives as text).
 * A future highlight is a body-less mark on this same schema. */
export const noteSchema = new Schema({
	nodes: {
		doc: { content: "block+" },
		paragraph: {
			content: "inline*",
			group: "block",
			parseDOM: [{ tag: "p" }],
			toDOM() {
				return ["p", 0];
			},
		},
		blockquote: {
			content: "block+",
			group: "block",
			parseDOM: [{ tag: "blockquote" }],
			toDOM() {
				return ["blockquote", 0];
			},
		},
		heading: {
			attrs: { level: { default: 1 } },
			content: "inline*",
			group: "block",
			defining: true,
			parseDOM: [
				{ tag: "h1", attrs: { level: 1 } },
				{ tag: "h2", attrs: { level: 2 } },
				{ tag: "h3", attrs: { level: 3 } },
			],
			toDOM(node) {
				return [`h${node.attrs.level}`, 0];
			},
		},
		bullet_list: {
			content: "list_item+",
			group: "block",
			attrs: { tight: { default: false } },
			parseDOM: [{ tag: "ul" }],
			toDOM() {
				return ["ul", 0];
			},
		},
		ordered_list: {
			content: "list_item+",
			group: "block",
			attrs: { order: { default: 1 }, tight: { default: false } },
			parseDOM: [{ tag: "ol" }],
			toDOM(node) {
				return ["ol", node.attrs.order === 1 ? {} : { start: node.attrs.order }, 0];
			},
		},
		list_item: {
			content: "block+",
			defining: true,
			parseDOM: [{ tag: "li" }],
			toDOM() {
				return ["li", 0];
			},
		},
		text: { group: "inline" },
		wikilink: {
			inline: true,
			group: "inline",
			atom: true,
			attrs: { ref: {}, label: { default: null } },
			parseDOM: [
				{
					tag: "span[data-wikilink-ref]",
					getAttrs(dom) {
						const el = dom as HTMLElement;
						return {
							ref: el.getAttribute("data-wikilink-ref") ?? "",
							label: el.getAttribute("data-wikilink-label"),
						};
					},
				},
			],
			toDOM(node) {
				const attrs: Record<string, string> = { "data-wikilink-ref": node.attrs.ref };
				if (node.attrs.label !== null) attrs["data-wikilink-label"] = node.attrs.label;
				return ["span", attrs, node.attrs.label ?? node.attrs.ref];
			},
		},
	},
	marks: {
		/** External web link (Abram, 2026-07-31). href is stored as typed;
		 * the SERVER renderer is the http(s) gate (fail-closed to plain
		 * text) — the editor never navigates its own anchors. */
		link: {
			attrs: { href: {} },
			inclusive: false,
			parseDOM: [
				{
					tag: "a[href]",
					getAttrs(dom) {
						return { href: (dom as HTMLElement).getAttribute("href") ?? "" };
					},
				},
			],
			toDOM(mark) {
				return [
					"a",
					{ href: String(mark.attrs.href), class: "note-extlink", rel: "noopener noreferrer" },
					0,
				];
			},
		},
		em: {
			parseDOM: [{ tag: "i" }, { tag: "em" }, { style: "font-style=italic" }],
			toDOM() {
				return ["em", 0];
			},
		},
		strong: {
			parseDOM: [{ tag: "b" }, { tag: "strong" }],
			toDOM() {
				return ["strong", 0];
			},
		},
	},
});

/** Tight-list detection, as prosemirror-markdown's own parser does it. */
function listIsTight(tokens: readonly Token[], i: number): boolean {
	while (++i < tokens.length) {
		if (tokens[i].type !== "list_item_open") return tokens[i].hidden;
	}
	return false;
}

const md = makeNotesMarkdown();

const noteParser = new MarkdownParser(noteSchema, md, {
	paragraph: { block: "paragraph" },
	blockquote: { block: "blockquote" },
	heading: {
		block: "heading",
		// schema allows 1–3; deeper pasted headings clamp rather than crash
		getAttrs: (tok) => ({ level: Math.min(3, Number(tok.tag.slice(1)) || 1) }),
	},
	bullet_list: {
		block: "bullet_list",
		getAttrs: (_tok, tokens, i) => ({ tight: listIsTight(tokens, i) }),
	},
	ordered_list: {
		block: "ordered_list",
		getAttrs: (tok, tokens, i) => ({
			order: Number(tok.attrGet("start")) || 1,
			tight: listIsTight(tokens, i),
		}),
	},
	list_item: { block: "list_item" },
	em: { mark: "em" },
	strong: { mark: "strong" },
	link: {
		mark: "link",
		getAttrs: (tok) => ({ href: tok.attrGet("href") ?? "" }),
	},
	wikilink: {
		node: "wikilink",
		getAttrs: (tok) => ({ ref: tok.meta?.ref ?? tok.content, label: tok.meta?.label ?? null }),
	},
});

/** Longest label a stored wikilink may carry — long enough for any real
 * quotation fragment, short enough that a pathological label can never
 * dominate a note body. */
const LABEL_MAX = 200;

/** Label grammar (A2/CF-42): `|`, `[`, `]` can never survive into a stored
 * label — the serialized form must re-tokenize to the same node. Newlines
 * (and every other whitespace run) collapse to a single space for the same
 * reason: the tokenizer rejects an inner newline, so a `\n`-bearing label
 * would serialize into escaped literal junk and the trailing lines would
 * re-parse as headings/quotes of their own (B18/CP-19). The collapse
 * matches `stripNoteMarkdownLine`'s read side. Insert paths sanitize with
 * this too (B47/CP-52 — see `insertLabel`). */
export function sanitizeWikilinkLabel(label: string): string {
	return label
		.replace(/[[\]|]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, LABEL_MAX)
		.trim();
}

/** The label an insert path (paste, ⌘K, `[[` commit) puts on the node it
 * creates. Sanitizing HERE — not only at serialize time — is what keeps the
 * label the writer sees identical to the label that gets stored (B47).
 * `null` means "bare `[[ref]]`". */
export function insertLabel(raw: string | null | undefined, ref: string): string | null {
	if (raw === null || raw === undefined) return null;
	const clean = sanitizeWikilinkLabel(raw);
	return clean === "" || clean === ref ? null : clean;
}

function writeWikilink(ref: string, label: string | null): string {
	const clean = label === null ? "" : sanitizeWikilinkLabel(label);
	return clean === "" || clean === ref ? `[[${ref}]]` : `[[${ref}|${clean}]]`;
}

const noteSerializer = new MarkdownSerializer(
	{
		blockquote(state, node) {
			state.wrapBlock("> ", null, node, () => state.renderContent(node));
		},
		paragraph(state, node) {
			state.renderInline(node);
			state.closeBlock(node);
		},
		heading(state, node) {
			state.write("#".repeat(node.attrs.level) + " ");
			state.renderInline(node, false);
			state.closeBlock(node);
		},
		bullet_list(state, node) {
			// house canonical form: `-` bullets (CF-2)
			state.renderList(node, "  ", () => "- ");
		},
		ordered_list(state, node) {
			const start = node.attrs.order || 1;
			const maxW = String(start + node.childCount - 1).length;
			const space = state.repeat(" ", maxW + 2);
			state.renderList(node, space, (i) => {
				const nStr = String(start + i);
				return state.repeat(" ", maxW - nStr.length) + nStr + ". ";
			});
		},
		list_item(state, node) {
			state.renderContent(node);
		},
		text(state, node) {
			state.text(node.text ?? "");
		},
		wikilink(state, node) {
			state.write(writeWikilink(node.attrs.ref, node.attrs.label));
		},
	},
	{
		em: {
			open: "*",
			close: "*",
			mixable: true,
			expelEnclosingWhitespace: true,
		},
		strong: {
			open: "**",
			close: "**",
			mixable: true,
			expelEnclosingWhitespace: true,
		},
		link: {
			open: "[",
			close(_state, mark) {
				const href = String(mark.attrs.href).replace(/[\s()]/g, (c) => encodeURIComponent(c));
				return `](${href})`;
			},
			mixable: false,
		},
	},
);

/** md → PM doc over the shared whitelisted config. Never throws on any
 * input (A3); out-of-schema constructs survive as literal text. */
export function parseNoteMarkdown(mdSource: string): PMNode {
	return noteParser.parse(mdSource);
}

/** PM doc → canonical markdown: `-` bullets, `*`/`**` emphasis, ATX
 * headings, exactly one trailing newline on non-empty docs. */
export function serializeNoteDoc(doc: PMNode): string {
	const out = noteSerializer.serialize(doc);
	if (out === "") return "";
	return out.endsWith("\n") ? out : out + "\n";
}

/** C(md) — the canonical form every save path stores (A2). Idempotent. */
export function canonicalizeNoteMarkdown(mdSource: string): string {
	return serializeNoteDoc(parseNoteMarkdown(mdSource));
}
