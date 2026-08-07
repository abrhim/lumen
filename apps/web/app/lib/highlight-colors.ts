/**
 * The mark palette, in a CLIENT-SAFE file.
 *
 * highlights.server.ts re-exports this. The reader imports it directly: pulling
 * it from the .server module drags the server boundary into the client bundle
 * and the page dies on hydration (the same way VOTE_CAP did on /roadmap).
 * Same reason entitlements-keys.ts sits beside entitlements.server.ts.
 *
 * The SQL CHECK in scripts/migrate-highlights.mjs holds the same five names.
 */
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "grey"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export function isHighlightColor(v: string): v is HighlightColor {
	return (HIGHLIGHT_COLORS as readonly string[]).includes(v);
}

/** The mark laid down by the gutter-number shortcut, which carries no picker. */
export const DEFAULT_HIGHLIGHT: HighlightColor = "yellow";
