import MarkdownIt from "markdown-it";
import { resolveAnchorRef, anchorRefToPath } from "@lumen/scripture/notes-refs";
import { makeNotesMarkdown } from "./notes-markdown-config";
import { logEvent } from "./log.server";

/**
 * personal-notes D4/A14 — server-side constrained markdown → HTML for note
 * READ surfaces (/notes/:id, the reader rail, search snippets never use
 * this — they are plain text via the stripper in notes.server.ts).
 *
 * Same shared whitelisted markdown-it config as the editor parser (A3):
 * html:false, out-of-schema constructs render as escaped literal text.
 * Wikilinks resolve fail-closed — a ref outside the grammar renders as a
 * styled <span>, never an anchor, never an error (F5). The renderer NEVER
 * throws (CF-50): any failure returns the body as escaped plaintext and
 * logs `note_render_failed` (no body content in the log, ever).
 */

export interface RenderNoteOptions {
	/** entity slug → route path; unresolved entities render as plain spans */
	resolveEntityPath?: (slug: string) => string | null;
	/** A14/CF-45: on the note page the derived title owns <h1>, so body
	 * headings demote one level (h1→h2 … h3→h4). Default off — the harness
	 * pins the un-demoted constrained render. */
	demoteHeadings?: boolean;
}

const md = makeNotesMarkdown();
const { escapeHtml } = new MarkdownIt().utils;

/** Defense-in-depth (F6): even as inert escaped TEXT, the byte sequence
 * `javascript:` never reaches a render surface. */
function neutralize(escaped: string): string {
	return escaped.replace(/javascript:/gi, "javascript&#58;");
}

md.renderer.rules.text = (tokens, idx) => neutralize(escapeHtml(tokens[idx].content));

md.renderer.rules.heading_open = (tokens, idx, _opts, env) => {
	const level = Number(tokens[idx].tag.slice(1)) || 1;
	const demoted = env?.demoteHeadings ? Math.min(6, level + 1) : level;
	return `<h${demoted}>`;
};
md.renderer.rules.heading_close = (tokens, idx, _opts, env) => {
	const level = Number(tokens[idx].tag.slice(1)) || 1;
	const demoted = env?.demoteHeadings ? Math.min(6, level + 1) : level;
	return `</h${demoted}>\n`;
};

/** "alma-32-21" → "Alma 32:21", "1-ne-3-7" → "1 Ne 3:7" — a light display
 * form for composed aria-labels (CF-46); no DB name lookup in v1. */
function displayRef(ref: string): string {
	const anchor = resolveAnchorRef(ref);
	if (anchor?.kind === "verse" || anchor?.kind === "chapter") {
		const segments = ref.split("-");
		const nums = anchor.kind === "verse" ? segments.splice(-2) : segments.splice(-1);
		const book = segments
			.map((s) => (/^\d+$/.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1)))
			.join(" ");
		return `${book} ${nums.join(":")}`;
	}
	return ref;
}

/** Labels are user text, never markup: anything tag-shaped is STRIPPED
 * (not merely escaped) before rendering — escaped `onmouseover=` in the
 * visible text of a link is still a smuggling surface (F6). */
function sanitizeRenderLabel(label: string, fallback: string): string {
	const stripped = label.replace(/<[^>]*>/g, "").trim();
	return stripped === "" ? fallback : stripped;
}

md.renderer.rules.wikilink = (tokens, idx, _opts, env) => {
	const token = tokens[idx];
	const ref: string = token.meta?.ref ?? token.content;
	const label: string = sanitizeRenderLabel(token.meta?.label ?? ref, ref);
	const anchor = resolveAnchorRef(ref);
	const path = anchor
		? anchorRefToPath(anchor, env?.resolveEntityPath as ((slug: string) => string | null) | undefined)
		: null;
	const text = neutralize(escapeHtml(label));
	const refAttr = ` data-ref="${escapeHtml(ref)}"`;
	if (!path) {
		// fail-closed: no link semantics, no role — styled plain text (F5/CF-46)
		return `<span class="note-wikilink-dead"${refAttr}>${text}</span>`;
	}
	const display = displayRef(ref);
	const ariaLabel =
		label !== display ? ` aria-label="${neutralize(escapeHtml(`${label} — ${display}`))}"` : "";
	return `<a href="${escapeHtml(path)}" class="note-wikilink"${refAttr}${ariaLabel}>${text}</a>`;
};

/** Constrained md → HTML. Never throws. */
export function renderNoteHtml(body: string, options: RenderNoteOptions = {}): string {
	try {
		return md.render(body, {
			demoteHeadings: options.demoteHeadings === true,
			resolveEntityPath: options.resolveEntityPath,
		});
	} catch (err) {
		// no body content in logs — length and error name only (CF-50)
		logEvent("note_render_failed", {
			body_len: body.length,
			message: err instanceof Error ? err.name : "unknown",
		});
		return `<pre>${neutralize(escapeHtml(body))}</pre>`;
	}
}
