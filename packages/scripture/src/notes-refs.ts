/**
 * personal-notes A8 (CF-17/CF-18) — the anchor/link ref grammar.
 *
 * Classifies a stored ref id into verse | chapter | entity | transcript,
 * fail-closed (null on anything malformed). Precedence: scripture → entity
 * → transcript is resolved structurally — `@` only ever appears in
 * transcript refs, so the shapes are disjoint.
 *
 * Two rules make the live collision set exactly zero (verified against the
 * DB on 2026-07-30):
 *  - CANONICAL slugs only: book segments validate against the canonical
 *    BOOK_SLUGS values, never the alias table (`helaman-2` is hel-2 only
 *    via an alias — as a stored ref it is the person `helaman-2`).
 *  - Per-book chapter counts bound `<book>-<n>`: `joel-4` exceeds Joel's
 *    3 chapters and falls through to the entity namespace (a live person).
 *
 * Transcript refs are `episode@t_start_s`. The `#seq` moment shape is
 * REJECTED outright: moment/segment seqs are documented response-scoped
 * (re-keyed by every M3 re-window) and must never be persisted (CF-18).
 */

export type AnchorKind = 'verse' | 'chapter' | 'entity' | 'transcript';

export interface AnchorRef {
	kind: AnchorKind;
	ref: string;
}

/**
 * Max chapter (D&C: section) number per canonical book slug. Generated from
 * the live lumen.chapters spine (2026-07-30); the canon is closed, so this
 * table is static data, not config.
 */
export const BOOK_CHAPTER_COUNTS: Record<string, number> = {
	'gen': 50, 'ex': 40, 'lev': 27, 'num': 36, 'deut': 34, 'josh': 24,
	'judg': 21, 'ruth': 4, '1-sam': 31, '2-sam': 24, '1-kgs': 22, '2-kgs': 25,
	'1-chr': 29, '2-chr': 36, 'ezra': 10, 'neh': 13, 'esth': 10, 'job': 42,
	'ps': 150, 'prov': 31, 'eccl': 12, 'song': 8, 'isa': 66, 'jer': 52,
	'lam': 5, 'ezek': 48, 'dan': 12, 'hosea': 14, 'joel': 3, 'amos': 9,
	'obad': 1, 'jonah': 4, 'micah': 7, 'nahum': 3, 'hab': 3, 'zeph': 3,
	'hag': 2, 'zech': 14, 'mal': 4,
	'matt': 28, 'mark': 16, 'luke': 24, 'john': 21, 'acts': 28, 'rom': 16,
	'1-cor': 16, '2-cor': 13, 'gal': 6, 'eph': 6, 'philip': 4, 'col': 4,
	'1-thes': 5, '2-thes': 3, '1-tim': 6, '2-tim': 4, 'titus': 3,
	'philem': 1, 'heb': 13, 'james': 5, '1-pet': 5, '2-pet': 3, '1-jn': 5,
	'2-jn': 1, '3-jn': 1, 'jude': 1, 'rev': 22,
	'1-ne': 22, '2-ne': 33, 'jacob': 7, 'enos': 1, 'jarom': 1, 'omni': 1,
	'w-of-m': 1, 'mosiah': 29, 'alma': 63, 'hel': 16, '3-ne': 30, '4-ne': 1,
	'morm': 9, 'ether': 15, 'moroni': 10,
	'dc': 138,
	'moses': 8, 'abr': 5, 'js-m': 1, 'js-h': 1, 'a-of-f': 1,
};

const REF_MAX = 128;
/** Scripture/entity refs: lowercase slug segments, no leading digit-junk. */
const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Entity ids start with a letter (live namespace: people/places/topics…). */
const ENTITY_SHAPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Transcript: episode entity id + `@` + non-negative seconds (t_start_s). */
const TRANSCRIPT_SHAPE = /^([A-Za-z0-9][A-Za-z0-9_-]*)@(\d+(?:\.\d+)?)$/;

const ALL_DIGITS = /^\d+$/;

/**
 * Classify a stored anchor/wikilink ref. Returns null for anything outside
 * the grammar — unknown books in scripture shapes, malformed numbers, the
 * forbidden `#seq` transcript shape, traversal/injection junk.
 *
 * Verse refs beyond a chapter's real verse count stay shape-valid
 * (existence is the action's DB check); chapter refs beyond the book's
 * chapter count are NOT chapters — they fall through to the entity
 * namespace (CF-17: `joel-4` is a person).
 */
export function resolveAnchorRef(raw: string): AnchorRef | null {
	if (typeof raw !== 'string') return null;
	const ref = raw;
	if (ref.length === 0 || ref.length > REF_MAX) return null;

	// The volatile moment-id shape is rejected before anything else so a
	// `#seq` capture can never be persisted by accident (CF-18).
	if (ref.includes('#')) return null;

	if (ref.includes('@')) {
		const m = TRANSCRIPT_SHAPE.exec(ref);
		if (!m) return null;
		return { kind: 'transcript', ref };
	}

	if (!SLUG_SHAPE.test(ref)) return null;

	const segments = ref.split('-');
	const last = segments[segments.length - 1];
	const secondLast = segments.length >= 2 ? segments[segments.length - 2] : null;

	// Verse shape: <book>-<chapter>-<verse>, both trailing segments numeric.
	// Fail-closed on unknown books — no live entity carries two trailing
	// number groups, so there is nothing to fall through to.
	if (secondLast !== null && ALL_DIGITS.test(last) && ALL_DIGITS.test(secondLast)) {
		const book = segments.slice(0, -2).join('-');
		const count = BOOK_CHAPTER_COUNTS[book];
		if (count === undefined) return null;
		const chapter = parseInt(secondLast, 10);
		const verse = parseInt(last, 10);
		if (chapter < 1 || chapter > count || verse < 1) return null;
		return { kind: 'verse', ref };
	}

	// Chapter shape: <book>-<n> with a CANONICAL book slug and n within the
	// book's chapter count. Beyond-count numbers belong to the entity
	// namespace (CF-17); zero is malformed everywhere.
	if (ALL_DIGITS.test(last)) {
		const book = segments.slice(0, -1).join('-');
		const count = BOOK_CHAPTER_COUNTS[book];
		const n = parseInt(last, 10);
		if (n < 1) return null;
		if (count !== undefined && n <= count) {
			return { kind: 'chapter', ref };
		}
		// falls through: alias-shaped (`helaman-2`) or beyond-count (`joel-4`)
	}

	if (!ENTITY_SHAPE.test(ref)) return null;
	return { kind: 'entity', ref };
}

/**
 * Reader-side path for a resolved anchor ref (D4/A14). Entity refs need a
 * type to build /:type/:id, which the grammar alone cannot know — callers
 * pass an entity resolver (slug → route path) and unresolved entities
 * return null (render as plain text, fail-closed).
 */
export function anchorRefToPath(
	anchor: AnchorRef,
	resolveEntityPath?: (slug: string) => string | null,
): string | null {
	switch (anchor.kind) {
		case 'verse': {
			const segments = anchor.ref.split('-');
			const verse = segments.pop()!;
			const chapter = segments.pop()!;
			return `/scripture/${segments.join('-')}/${chapter}?verse=${verse}`;
		}
		case 'chapter': {
			const segments = anchor.ref.split('-');
			const chapter = segments.pop()!;
			return `/scripture/${segments.join('-')}/${chapter}`;
		}
		case 'transcript': {
			const at = anchor.ref.indexOf('@');
			return `/media/${anchor.ref.slice(0, at)}?t=${anchor.ref.slice(at + 1)}`;
		}
		case 'entity':
			return resolveEntityPath?.(anchor.ref) ?? null;
	}
}
