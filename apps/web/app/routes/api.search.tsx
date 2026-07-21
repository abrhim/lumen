import { sql } from "drizzle-orm";
import { searchAll, GROUP_KEYS, type GroupKey } from "@lumen/scripture";
import { getSessionUser } from "~/lib/auth.server";
import { getCollectionAccessStrict } from "~/lib/collection-access.server";
import { logEvent } from "~/lib/log.server";
import type { Route } from "./+types/api.search";

/**
 * GET /api/search — typed federated search (search-endpoint plan v2,
 * decision 5). Resource route: JSON only, never HTML. Validation runs before
 * any session/db work; error bodies carry stable codes (H14). Every response
 * is `Cache-Control: private, no-store` — the body varies by session
 * visibility (SEC-4/API-3, house SECURITY-3 pattern).
 *
 * Id stability (decision 5, APIC-6): every result id is durable EXCEPT
 * moment ids, which re-key on M3 re-runs — clients deep-link moments via
 * payload episode_id + t_start_s, never the id.
 */

const Q_MIN = 2;
const Q_MAX = 200;

function json(
	body: unknown,
	status: number,
	extra?: Headers,
): Response {
	const headers = new Headers(extra);
	headers.set("Content-Type", "application/json; charset=utf-8");
	headers.set("Cache-Control", "private, no-store");
	return new Response(JSON.stringify(body), { status, headers });
}

function badRequest(code: string, message: string): Response {
	return json({ error: message, code }, 400);
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const url = new URL(request.url);

	// ── Validation first: no session read, no db work on garbage (H14). ──
	const rawQ = url.searchParams.get("q");
	if (rawQ === null || rawQ.trim() === "") {
		return badRequest("q_required", "q is required");
	}
	const q = rawQ.trim();
	if (q.length < Q_MIN || q.length > Q_MAX) {
		return badRequest("q_length", `q must be ${Q_MIN}–${Q_MAX} characters`);
	}

	let scope: GroupKey[] | undefined;
	const rawScope = url.searchParams.get("scope");
	if (rawScope !== null) {
		const parts = rawScope.split(",").map((s) => s.trim());
		if (parts.some((s) => s === "" || !(GROUP_KEYS as readonly string[]).includes(s))) {
			return badRequest("scope_unknown", `scope must be a CSV of: ${GROUP_KEYS.join(", ")}`);
		}
		// Canonicalize: groups come back in GROUP_KEYS order regardless of
		// request order (decision 5 MUST).
		const requested = new Set(parts);
		scope = GROUP_KEYS.filter((k) => requested.has(k));
	}

	// Non-numeric limit → 400; numeric out-of-range clamps, fractions floor
	// (documented asymmetry, decision 5). Empty/whitespace is non-numeric —
	// Number('') is 0 and would otherwise silently clamp to 1.
	let limitPerGroup = 8;
	const rawLimit = url.searchParams.get("limit");
	if (rawLimit !== null) {
		const n = rawLimit.trim() === "" ? Number.NaN : Number(rawLimit);
		if (!Number.isFinite(n)) {
			return badRequest("limit_invalid", "limit must be a number");
		}
		limitPerGroup = Math.max(1, Math.min(25, Math.floor(n)));
	}

	// ── Visibility: the loader's job, never searchAll's (decision 6). ──
	// Session + visibility live INSIDE the try: a failure there (session-pool
	// exhaustion is a documented incident here) must exit through the same
	// JSON-500 + search_failed contract as a search failure, never a framework
	// 500. `headers` stays reachable in the catch so session-rotation
	// Set-Cookie survives on both paths.
	let headers: Headers | undefined;
	let visibility: "public" | "admin" = "public";
	try {
		const session = await getSessionUser(request, context.cloudflare.env);
		const user = session.user;
		headers = session.headers;
		// B7: one visibility source with the Phase B surfaces — the strict
		// variant so a lookup failure hits this try's 500 contract instead of
		// silently searching nothing.
		const access = await getCollectionAccessStrict(context.db, user?.id ?? null);
		let visibleCollections = access.publicIds;
		if (access.entitled) {
			const rows = (await context.db.execute(
				sql`SELECT id FROM lumen.collections`,
			)) as Array<{ id: string }>;
			visibleCollections = rows.map((r) => r.id);
			visibility = "admin";
		}

		const result = await searchAll(context.db, {
			q,
			visibleCollections,
			scope,
			limitPerGroup,
		});

		// OBS-1: the one structured line the relevance-tuning loop feeds on.
		// ms is null in combined mode — per-group time is unmeasurable there (B24).
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
			q,
			scope: scope ?? null,
			reference: result.reference?.display ?? null,
			groups: groupHits,
			// OBS-2 again: a degraded request never counts as zeroResult.
			zeroResult:
				!degraded && result.groups.every((g) => g.results.length === 0) && !result.reference,
			elapsedMs: result.meta.totalMs,
			perGroupMs,
			mode: result.meta.mode,
			// B15: fallback mode without this line means the combined-statement
			// failure cause is never recorded anywhere.
			...(result.meta.combinedError ? { combinedError: result.meta.combinedError } : {}),
			visibility,
			...(visibility === "admin" ? { userId: user?.id } : {}),
		});

		return json(
			{ query: result.query, reference: result.reference, groups: result.groups },
			200,
			headers,
		);
	} catch (err) {
		// OBS-3: scrubbed for the client; q/scope/visibility logged so the
		// operator can reproduce the 500.
		logEvent("search_failed", {
			message: err instanceof Error ? err.message : String(err),
			q,
			qLen: q.length,
			scope: scope ?? null,
			visibility,
		});
		return json({ error: "Search failed", code: "internal" }, 500, headers);
	}
}
