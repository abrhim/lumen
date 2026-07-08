/** Shared art types + pure helpers (art-graph feature). */

export interface ArtRef {
	book_id: string;
	chapter: number;
	verse_start: number | null;
	verse_end: number | null;
	is_primary?: boolean;
}

export interface ArtItem {
	id: string;
	title: string;
	artist: string | null;
	year: number | null;
	thumb: string | null;
	image: string;
	sourceUrl: string;
	/** catalog fame score — the stack and gallery rank by it (API-1) */
	fame: number | null;
	refs: ArtRef[];
}

export interface ArtworkRow {
	id: string;
	name: string;
	metadata: {
		artist_name?: string;
		year?: number | null;
		thumbnail_800_url?: string | null;
		image_url?: string;
		source_url?: string;
		fame?: number | null;
		refs?: ArtRef[];
	};
}

/** Only http(s) URLs from art metadata ever reach href/src (SEC-1/SEC-2). */
export function safeHttpUrl(url: string | null | undefined): string | null {
	if (!url) return null;
	return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

export function toArtItem(row: ArtworkRow): ArtItem {
	return {
		id: row.id,
		title: row.name,
		artist: row.metadata.artist_name ?? null,
		year: row.metadata.year ?? null,
		thumb: safeHttpUrl(row.metadata.thumbnail_800_url),
		image: safeHttpUrl(row.metadata.image_url) ?? "",
		sourceUrl: safeHttpUrl(row.metadata.source_url) ?? "",
		fame: row.metadata.fame ?? null,
		refs: row.metadata.refs ?? [],
	};
}

/** CSS custom-ident for view-transition-name — art ids carry ':' etc. */
export function artTransitionName(id: string): string {
	return `art-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/** Top-N by fame (nulls last) + overflow count, for the chapter card stack. */
export function pickArtStack<T extends { fame: number | null }>(
	items: T[],
	n: number,
): { stack: T[]; more: number } {
	const sorted = [...items].sort(
		(a, b) => (b.fame ?? Number.NEGATIVE_INFINITY) - (a.fame ?? Number.NEGATIVE_INFINITY),
	);
	return { stack: sorted.slice(0, n), more: Math.max(0, items.length - n) };
}
