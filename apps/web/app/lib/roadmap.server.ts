import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getAuth, type AuthEnv } from "./auth.server";

/**
 * Roadmap data (2026-08-01). Standings are PUBLIC counts; voter ids never
 * leave the server. Presses go through the capped INVOKER RPC.
 */

export interface RoadmapFeature {
	id: string;
	title: string;
	detail: string | null;
	state: "proposed" | "planned" | "building" | "shipped" | "declined";
	sort_order: number | null;
	shipped_at: string | null;
	votes: number;
	mine: number;
}

/**
 * The public total AND the caller's own presses, from ONE query on ONE
 * connection. They must share a snapshot: the rendered number is
 * `votes - mine + optimistic`, so a fresh `mine` against a stale `votes`
 * renders a just-cast vote as zero. That is exactly what happened when
 * the total came from Hyperdrive and `mine` came from PostgREST —
 * Hyperdrive caches reads for ~60s, PostgREST doesn't. The explicit
 * transaction is what keeps this query out of that cache.
 */
export async function listRoadmap(
	db: PostgresJsDatabase,
	voterId: string | null,
): Promise<RoadmapFeature[]> {
	const rows = await db.transaction(async (tx) =>
		tx.execute(sql`
			SELECT f.id, f.title, f.detail, f.state, f.sort_order,
			       f.shipped_at::date::text AS shipped_at,
			       COALESCE(SUM(v.count), 0)::int AS votes,
			       COALESCE(SUM(v.count) FILTER (WHERE v.voter_id = ${voterId}::uuid), 0)::int AS mine
			FROM lumen.roadmap_features f
			LEFT JOIN lumen.roadmap_votes v ON v.feature_id = f.id
			GROUP BY f.id
		`),
	);
	return rows as unknown as RoadmapFeature[];
}

/** One press. Returns the caller's new count for that feature, or null. */
export async function pressVote(
	request: Request,
	env: AuthEnv,
	featureId: string,
): Promise<number | null> {
	const { supabase } = getAuth(request, env);
	const { data, error } = await supabase
		.schema("lumen")
		.rpc("roadmap_vote", { p_feature_id: featureId });
	if (error) return null;
	return typeof data === "number" ? data : null;
}

/** One retraction. Returns the caller's new count (0 = row gone). */
export async function pressUnvote(
	request: Request,
	env: AuthEnv,
	featureId: string,
): Promise<number | null> {
	const { supabase } = getAuth(request, env);
	const { data, error } = await supabase
		.schema("lumen")
		.rpc("roadmap_unvote", { p_feature_id: featureId });
	if (error) return null;
	return typeof data === "number" ? data : null;
}
