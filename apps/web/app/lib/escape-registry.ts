/**
 * personal-notes A10 (CF-14) — doctrine 6's LIFO escape registry, built
 * minimally here (first client). One global Escape handler; each escapable
 * surface pushes an entry on open and disposes it on close. Esc closes the
 * INNERMOST layer only and never falls through to page semantics (Esc
 * never eats a chapter): with an empty registry Esc is inert here — the
 * document keydown listener simply doesn't act.
 *
 * Enumerated clients (this feature): `[[` popup → editor (typed text
 * remains); insert palette → editor + cursor restored; rail note-compose →
 * invoking verse control; delete confirm → its trigger (Radix handles its
 * own — it does NOT register here to avoid double-close).
 */

export interface EscapeEntry {
	/** close the surface and restore focus to its invoker; return true if
	 * the entry consumed the escape */
	onEscape: () => void;
}

const stack: EscapeEntry[] = [];

/** Push on open; call the returned dispose on close (idempotent). */
export function pushEscape(entry: EscapeEntry): () => void {
	stack.push(entry);
	return () => {
		const i = stack.indexOf(entry);
		if (i !== -1) stack.splice(i, 1);
	};
}

/** Unwind one layer. Returns true when a layer consumed the escape. */
export function popEscape(): boolean {
	const top = stack.pop();
	if (!top) return false;
	top.onEscape();
	return true;
}

export function escapeDepth(): number {
	return stack.length;
}
