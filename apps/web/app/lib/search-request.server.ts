import { GROUP_KEYS, type GroupKey } from "@lumen/scripture";

/**
 * Shared /api/search + /search request validation (search-ui Δ CU-6/UU-9).
 * Plain data in, discriminated result out — each caller shapes its own
 * Response (the API route returns JSON 400s, the page loader throws them),
 * so nothing here touches Response, headers, or logging. The page keeps its
 * own adaptiveLimit; only the API's `limit` param semantics live here.
 */

export const Q_MIN = 2;
export const Q_MAX = 200;

export type SearchParamCode = "q_required" | "q_length" | "scope_unknown" | "limit_invalid";

export type ParseResult<T> =
	| { ok: true; value: T }
	| { ok: false; code: SearchParamCode; message: string };

export function parseQ(rawQ: string | null): ParseResult<string> {
	if (rawQ === null || rawQ.trim() === "") {
		return { ok: false, code: "q_required", message: "q is required" };
	}
	const q = rawQ.trim();
	if (q.length < Q_MIN || q.length > Q_MAX) {
		return { ok: false, code: "q_length", message: `q must be ${Q_MIN}–${Q_MAX} characters` };
	}
	return { ok: true, value: q };
}

/**
 * personal-notes A4 (CF-1/CF-7): `notes` never enters parseScope's
 * vocabulary — signed-out validation bytes stay frozen. The routes split
 * the raw scope FIRST; when `notes` is present the canon remainder is
 * parsed normally and the session decides whether the original request was
 * an error (signed-out: replay the frozen scope_unknown 400) or a notes
 * request (signed-in: run the leg; notes-only NEVER calls searchAll — an
 * empty scope array would search all seven groups).
 */
export function extractNotesScope(rawScope: string | null): {
	canonRaw: string | null;
	wantsNotes: boolean;
	notesOnly: boolean;
} {
	if (rawScope === null) return { canonRaw: null, wantsNotes: false, notesOnly: false };
	const parts = rawScope.split(",").map((s) => s.trim());
	if (!parts.includes("notes")) return { canonRaw: rawScope, wantsNotes: false, notesOnly: false };
	const rest = parts.filter((p) => p !== "notes");
	return {
		canonRaw: rest.length > 0 ? rest.join(",") : null,
		wantsNotes: true,
		notesOnly: rest.length === 0,
	};
}

export function parseScope(rawScope: string | null): ParseResult<GroupKey[] | undefined> {
	if (rawScope === null) {
		return { ok: true, value: undefined };
	}
	const parts = rawScope.split(",").map((s) => s.trim());
	if (parts.some((s) => s === "" || !(GROUP_KEYS as readonly string[]).includes(s))) {
		return {
			ok: false,
			code: "scope_unknown",
			message: `scope must be a CSV of: ${GROUP_KEYS.join(", ")}`,
		};
	}
	// Canonicalize: groups come back in GROUP_KEYS order regardless of
	// request order (decision 5 MUST).
	const requested = new Set(parts);
	return { ok: true, value: GROUP_KEYS.filter((k) => requested.has(k)) };
}

/**
 * Non-numeric limit → error; numeric out-of-range clamps, fractions floor
 * (documented asymmetry, decision 5). Empty/whitespace is non-numeric —
 * Number('') is 0 and would otherwise silently clamp to 1.
 */
export function parseLimit(rawLimit: string | null): ParseResult<number> {
	if (rawLimit === null) {
		return { ok: true, value: 8 };
	}
	const n = rawLimit.trim() === "" ? Number.NaN : Number(rawLimit);
	if (!Number.isFinite(n)) {
		return { ok: false, code: "limit_invalid", message: "limit must be a number" };
	}
	return { ok: true, value: Math.max(1, Math.min(25, Math.floor(n))) };
}
