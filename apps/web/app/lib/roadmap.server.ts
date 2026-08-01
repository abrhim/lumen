import { sql, type SQLWrapper } from "drizzle-orm";
import { getAuth, type AuthEnv } from "./auth.server";

/**
 * Roadmap data (2026-08-01). Standings are PUBLIC counts aggregated
 * server-side over the read-only connection — voter ids never leave the
 * server. A signed-in reader's own counts ride the user client (RLS:
 * SELECT own rows). Presses go through the capped INVOKER RPC.
 */

export interface RoadmapFeature {
	id: string;
	title: string;
	detail: string | null;
	state: "proposed" | "planned" | "building" | "shipped" | "declined";
	sort_order: number | null;
	shipped_at: string | null;
	votes: number;
}

type Db = { execute: (q: SQLWrapper) => Promise<unknown> };

export async function listRoadmap(db: Db): Promise<RoadmapFeature[]> {
	const rows = (await db.execute(sql`
		SELECT f.id, f.title, f.detail, f.state, f.sort_order,
		       f.shipped_at::date::text AS shipped_at,
		       COALESCE(SUM(v.count), 0)::int AS votes
		FROM lumen.roadmap_features f
		LEFT JOIN lumen.roadmap_votes v ON v.feature_id = f.id
		GROUP BY f.id
	`)) as RoadmapFeature[];
	return rows;
}

/** The signed-in reader's own press counts, keyed by feature id. */
export async function myVotes(request: Request, env: AuthEnv): Promise<Record<string, number>> {
	try {
		const { supabase } = getAuth(request, env);
		const { data, error } = await supabase
			.schema("lumen")
			.from("roadmap_votes")
			.select("feature_id, count");
		if (error || !data) return {};
		return Object.fromEntries(data.map((r) => [r.feature_id as string, r.count as number]));
	} catch {
		return {};
	}
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
