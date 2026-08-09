/**
 * Marks made before signing in (docs/design/highlighting.md).
 *
 * Notes already work this way: compose freely, and an account is only needed to
 * KEEP the thing. Marks now match. This matters more than it looks — the whole
 * discovery plan is search and AI answers landing strangers on scripture pages,
 * and every one of them arrives signed out. Sending them to a login screen the
 * moment they touch the feature loses them at the first step.
 *
 * Guest marks live in localStorage and are adopted into the account on the next
 * signed-in chapter view. They are deliberately NOT a second source of truth:
 * once adopted they are deleted, and a failure to adopt keeps them for the next
 * attempt rather than dropping them.
 */

const KEY = "lumen-guest-marks";
/** enough to try the feature; not a shadow account */
const MAX = 50;

export interface GuestMark {
	chapterId: string;
	color: string;
	style: string;
	quote: string;
	spans: Array<{ verseId: string; start: number; end: number }>;
	/** ms since epoch, so adoption can keep the reader's own order */
	at: number;
}

function read(): GuestMark[] {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		// storage is user-writable: keep only rows that still have a usable shape
		return parsed.filter(
			(m): m is GuestMark =>
				m &&
				typeof m.chapterId === "string" &&
				typeof m.color === "string" &&
				Array.isArray(m.spans) &&
				m.spans.length > 0,
		);
	} catch {
		return [];
	}
}

function write(marks: GuestMark[]): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(marks.slice(-MAX)));
	} catch {
		/* private mode, or the quota is gone — the mark is lost, the reading is not */
	}
}

export function guestMarksFor(chapterId: string): GuestMark[] {
	return read().filter((m) => m.chapterId === chapterId);
}

export function addGuestMark(mark: Omit<GuestMark, "at">): void {
	write([...read(), { ...mark, at: Date.now() }]);
}

/** Remove one, by the identity a reader can actually point at: same chapter,
 * same geometry. Guest marks carry no id — they are not rows yet. */
export function removeGuestMark(chapterId: string, spanKey: string): void {
	write(read().filter((m) => m.chapterId !== chapterId || guestKey(m) !== spanKey));
}

/** A stable local id for a guest mark, so the renderer and the click router can
 * refer to one without a database row existing. */
export function guestKey(mark: Pick<GuestMark, "spans">): string {
	return `guest:${mark.spans.map((s) => `${s.verseId}:${s.start}:${s.end}`).join(",")}`;
}

export function allGuestMarks(): GuestMark[] {
	return read();
}

export function clearGuestMarks(): void {
	try {
		localStorage.removeItem(KEY);
	} catch {
		/* nothing to do — adoption already succeeded server-side */
	}
}
