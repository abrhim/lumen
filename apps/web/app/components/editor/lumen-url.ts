import { resolveAnchorRef } from "@lumen/scripture/notes-refs";

/**
 * personal-notes — paste conversion (mechanism 4): a pasted **Lumen** URL
 * becomes the wikilink it names.
 *
 * B17/CP-18: the origin is a gate, not decoration. `handlePaste` returns
 * true on a hit, which DESTROYS the pasted text, so any URL this function
 * converts had better be one of ours: `https://en.wikipedia.org/wiki/faith`
 * turning into `[[faith]]` silently replaces the writer's external
 * reference with an unrelated internal link. Only same-origin absolute URLs
 * and bare in-app pathnames are eligible; everything else returns null and
 * the paste falls through to plain text.
 */

/** Typed-node route prefixes (routes/node.tsx `TYPE_SLUGS`) — the only
 * two-segment paths whose second segment is an entity id. Without this the
 * bare branch converted `github.com/anthropics/claude` → `[[claude]]`. */
const ENTITY_ROUTE_PREFIXES = new Set([
	"people",
	"places",
	"principles",
	"events",
	"symbols",
	"eras",
	"node",
]);

function currentOrigin(): string | null {
	if (typeof window === "undefined" || !window.location) return null;
	const origin = window.location.origin;
	return typeof origin === "string" && origin !== "" && origin !== "null" ? origin : null;
}

/**
 * A pasted string → the anchor ref it names, or null.
 *
 * @param origin overrides the same-origin gate (tests; defaults to
 *   `window.location.origin`). When no origin can be determined, absolute
 *   URLs are refused outright — fail closed.
 */
export function lumenUrlToRef(raw: string, origin?: string | null): string | null {
	const trimmed = raw.trim();
	if (trimmed === "" || /\s/.test(trimmed)) return null;

	const base = origin === undefined ? currentOrigin() : origin;
	let url: URL;
	if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
		// a bare in-app pathname — same-origin by construction
		try {
			url = new URL(trimmed, base ?? "https://notes.invalid");
		} catch {
			return null;
		}
	} else {
		try {
			url = new URL(trimmed);
		} catch {
			return null;
		}
		if (base === null || url.origin !== base) return null;
	}

	const segs = url.pathname.split("/").filter(Boolean);
	if (segs[0] === "scripture" && segs.length === 3) {
		const verse = url.searchParams.get("verse");
		const ref = `${segs[1]}-${segs[2]}${verse ? `-${verse}` : ""}`;
		return resolveAnchorRef(ref) ? ref : null;
	}
	if (segs[0] === "notes" && segs.length === 2) {
		const ref = `note:${segs[1]}`;
		return resolveAnchorRef(ref) ? ref : null;
	}
	if (segs[0] === "media" && segs.length === 2) {
		const t = url.searchParams.get("t");
		if (t !== null && /^\d+(\.\d+)?$/.test(t)) {
			const ref = `${segs[1]}@${t}`;
			return resolveAnchorRef(ref) ? ref : null;
		}
		return null;
	}
	if (
		segs.length === 2 &&
		ENTITY_ROUTE_PREFIXES.has(segs[0]) &&
		resolveAnchorRef(decodeURIComponent(segs[1]))?.kind === "entity"
	) {
		return decodeURIComponent(segs[1]);
	}
	return null;
}
