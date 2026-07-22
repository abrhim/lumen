import type { GroupKey, SearchResponse } from "@lumen/scripture";
import { logEvent } from "./log.server";

/**
 * Shared search observability (search-ui Δ OU-6): the OBS-1/2/3 block from
 * /api/search, callable from both the API route and the /search page loader
 * so each surface logs its own requests exactly once. Cursor-rejection 400s
 * are deliberately NOT logged (ratified decision 10; OU-5 rejected).
 */

export interface SearchLogContext {
	q: string;
	scope: GroupKey[] | undefined;
	visibility: "public" | "admin";
	/** Δ OU-6/B16: which surface issued this search — the `/search` page loader
	 * (a URL navigation) or the `/api/search` fetcher (live/debounced typing and
	 * pagination). Both surfaces log every request once, so an Enter-after-
	 * debounce logs twice; without this discriminator the two events are field-
	 * identical (the page logs `scope: null` for an all-groups search while the
	 * fetcher always sends the full array) and analytics double-counts and
	 * pollutes the OU-1 zero-result denominator. */
	surface: "page" | "api";
	userId?: string;
	after?: string;
}

/** OBS-1: the one structured line the relevance-tuning loop feeds on.
 * ms is null in combined mode — per-group time is unmeasurable there (B24). */
export function logSearchExecuted(result: SearchResponse, ctx: SearchLogContext): void {
	const { q, scope, visibility, userId, after, surface } = ctx;
	const perGroupMs: Record<string, number | null> = {};
	const groupHits: Record<string, number> = {};
	let degraded = false;
	for (const [key, m] of Object.entries(result.meta.perGroup)) {
		perGroupMs[key] = m.ms;
		groupHits[key] = m.hits;
		if (m.error) {
			// OBS-2: a degraded group must never be mistaken for zero hits.
			degraded = true;
			logEvent("search_group_degraded", { key, message: m.error, ms: m.ms });
		}
	}
	logEvent("search_executed", {
		// B16: page-loader vs API-fetcher events must be distinguishable.
		surface,
		q,
		scope: scope ?? null,
		reference: result.reference?.display ?? null,
		groups: groupHits,
		// Δ OU-1: pagination depth — continuations are visible in the stream…
		hasCursor: after !== undefined,
		// OBS-2 again: a degraded request never counts as zeroResult. Δ OU-1:
		// …and excluded from the zero-result denominator (page 2 of an
		// exhausted group is not a relevance failure).
		zeroResult:
			!degraded &&
			after === undefined &&
			result.groups.every((g) => g.results.length === 0) &&
			!result.reference,
		elapsedMs: result.meta.totalMs,
		perGroupMs,
		mode: result.meta.mode,
		// B15: fallback mode without this line means the combined-statement
		// failure cause is never recorded anywhere.
		...(result.meta.combinedError ? { combinedError: result.meta.combinedError } : {}),
		visibility,
		...(visibility === "admin" ? { userId } : {}),
	});
}

/** OBS-3: scrubbed for the client; q/scope/visibility logged so the operator
 * can reproduce the 500. */
export function logSearchFailed(
	err: unknown,
	ctx: Pick<SearchLogContext, "q" | "scope" | "visibility" | "surface" | "after">,
): void {
	logEvent("search_failed", {
		message: err instanceof Error ? err.message : String(err),
		surface: ctx.surface,
		q: ctx.q,
		qLen: ctx.q.length,
		scope: ctx.scope ?? null,
		visibility: ctx.visibility,
		// B25/OC-5: a continuation-leg 500 must be distinguishable from a page-1
		// failure so OBS-3's repro promise holds — boolean only, the raw cursor
		// stays unechoed per F3.
		hasCursor: ctx.after !== undefined,
	});
}
