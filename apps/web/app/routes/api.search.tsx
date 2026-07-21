import { sql } from "drizzle-orm";
import {
	searchAll,
	getPublicCollectionIds,
	GROUP_KEYS,
	type GroupKey,
} from "@lumen/scripture";
import { getSessionUser } from "~/lib/auth.server";
import { ADMIN_COLLECTIONS, getEntitlements } from "~/lib/entitlements.server";
import { logEvent } from "~/lib/log.server";
import type { Route } from "./+types/api.search";

/**
 * GET /api/search — typed federated search (search-endpoint plan v2,
 * decision 5). Resource route: JSON only, never HTML. Validation runs before
 * any session/db work; error bodies carry stable codes (H14). Every response
 * is `Cache-Control: private, no-store` — the body varies by session
 * visibility (SEC-4/API-3, house SECURITY-3 pattern).
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
		scope = [...new Set(parts)] as GroupKey[];
	}

	// Non-numeric limit → 400; out-of-range clamps (documented asymmetry).
	let limitPerGroup = 8;
	const rawLimit = url.searchParams.get("limit");
	if (rawLimit !== null) {
		const n = Number(rawLimit);
		if (!Number.isInteger(n)) {
			return badRequest("limit_invalid", "limit must be an integer");
		}
		limitPerGroup = Math.max(1, Math.min(25, n));
	}

	// ── Visibility: the loader's job, never searchAll's (decision 6). ──
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	const publicIds = (await getPublicCollectionIds(context.db)) as string[];
	let visibleCollections = publicIds;
	let visibility: "public" | "admin" = "public";
	if (user) {
		const entitlements = await getEntitlements(context.db, user.id);
		if (entitlements.has(ADMIN_COLLECTIONS)) {
			const rows = (await context.db.execute(
				sql`SELECT id FROM lumen.collections`,
			)) as Array<{ id: string }>;
			visibleCollections = rows.map((r) => r.id);
			visibility = "admin";
		}
	}

	try {
		const result = await searchAll(context.db, {
			q,
			visibleCollections,
			scope,
			limitPerGroup,
		});

		// OBS-1: the one structured line the relevance-tuning loop feeds on.
		const perGroupMs: Record<string, number> = {};
		const groupHits: Record<string, number> = {};
		for (const [key, m] of Object.entries(result.meta.perGroup)) {
			perGroupMs[key] = m.ms;
			groupHits[key] = m.hits;
			if (m.error) {
				// OBS-2: a degraded group must never be mistaken for zero hits.
				logEvent("search_group_degraded", { key, message: m.error, ms: m.ms });
			}
		}
		logEvent("search_executed", {
			q,
			scope: scope ?? null,
			reference: result.reference?.display ?? null,
			groups: groupHits,
			zeroResult: result.groups.every((g) => g.results.length === 0) && !result.reference,
			elapsedMs: result.meta.totalMs,
			perGroupMs,
			mode: result.meta.mode,
			visibility,
			...(visibility === "admin" ? { userId: user?.id } : {}),
		});

		return json(
			{ query: result.query, reference: result.reference, groups: result.groups },
			200,
			headers,
		);
	} catch (err) {
		// OBS-3: scrubbed for the client, logged for the operator.
		logEvent("search_failed", {
			message: err instanceof Error ? err.message : String(err),
			qLen: q.length,
		});
		return json({ error: "Search failed", code: "internal" }, 500, headers);
	}
}
