/**
 * The client-safe half of enrichment review — types, the filter vocabularies,
 * and the mention-identity codec.
 *
 * This file exists for the same reason highlight-colors.ts does: the review
 * page's COMPONENT needs these, and a `.server` module is stripped from the
 * client bundle, so importing them from enrichment-review.server.ts left the
 * references undefined at hydration and the page never came alive. The split
 * is the fix and the guard — anything in here is safe on both sides by
 * construction.
 */

export const PAGE_SIZE = 40;

export const REVIEW_STATUSES = ["accepted", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export function isReviewStatus(v: string): v is ReviewStatus {
	return (REVIEW_STATUSES as readonly string[]).includes(v);
}

/** Filter allow-list. The SQL predicate is chosen from HERE, never assembled
 * from a request string (the admin.users D6 rule). */
export const KIND_FILTERS = {
	all: null,
	principles: "TEACHES",
	entities: "MENTIONS",
	scripture: "DISCUSSES",
} as const;
export type KindFilter = keyof typeof KIND_FILTERS;

export const STATUS_FILTERS = ["all", "pending", "accepted", "rejected"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

// Object.hasOwn, never `key in MAP` — `in` walks the prototype chain, so
// ?kind=toString would resolve to an Object.prototype member.
export function parseKind(v: string | null): KindFilter {
	return v !== null && Object.hasOwn(KIND_FILTERS, v) ? (v as KindFilter) : "all";
}
export function parseStatus(v: string | null): StatusFilter {
	return v !== null && (STATUS_FILTERS as readonly string[]).includes(v) ? (v as StatusFilter) : "all";
}

/** The mention's identity, as both database legs address it. */
export interface MentionKey {
	fromId: string;
	toId: string;
	relType: string;
	collectionId: string;
	mentionSeq: number;
}

export interface ReviewRow extends MentionKey {
	t: number;
	confidence: number;
	targetName: string;
	targetType: string;
	episodeName: string;
	/** the utterance at this seq — the claim's evidence, verbatim */
	quote: string;
	status: ReviewStatus | "pending";
	reviewedAt: string | null;
	/** Abram's feedback on this claim, read by whoever tunes the next
	 * extraction round. Survives re-ingest with the decision. */
	note: string;
}

/** Stable string identity for a mention — the form the UI round-trips
 * through form fields and React keys. Pipe-joined because every component
 * is either an id (no pipes by construction) or an integer. */
export function mentionId(k: MentionKey): string {
	return [k.fromId, k.toId, k.relType, k.collectionId, k.mentionSeq].join("|");
}

export function parseMentionId(raw: string): MentionKey | null {
	const parts = raw.split("|");
	if (parts.length !== 5) return null;
	const seq = Number.parseInt(parts[4], 10);
	if (!Number.isSafeInteger(seq) || seq < 0) return null;
	if (parts.slice(0, 4).some((p) => p.length === 0)) return null;
	return {
		fromId: parts[0],
		toId: parts[1],
		relType: parts[2],
		collectionId: parts[3],
		mentionSeq: seq,
	};
}

/** Notes are feedback, not prose storage — a cap keeps one runaway paste
 * from becoming the table's problem. */
export const NOTE_MAX = 2000;
