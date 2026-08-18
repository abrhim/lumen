import { Link, data } from "react-router";
import { sql } from "drizzle-orm";
import { getSessionUser } from "~/lib/auth.server";
import { PageFrame, PageHeader } from "~/components/PageFrame";
import { canViewCollection, getCollectionAccess } from "~/lib/collection-access.server";
import { displayFamily } from "~/lib/collection-display";
import type { Route } from "./+types/collections.index";

/**
 * Collections — CURATED (Abram, 2026-07-31; second-show 2026-08-18):
 * Strong's and Art are bespoke doors. Media collections print one door per
 * VIEWABLE registered collection (the collection-display registry is the
 * fail-closed gate — unregistered collections render nowhere). Counts are
 * live; a private collection simply doesn't print for the public, and the
 * admin preview sees it through canViewCollection.
 */

interface Door {
	to: string;
	name: string;
	detail: string;
	count: string;
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const db = context.db;
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	headers.set("Cache-Control", "private, no-store");
	const [strongs, art, mediaCollections, access] = await Promise.all([
		db.execute(sql`SELECT count(*)::int AS n FROM lumen.strongs_lexicon`) as unknown as Promise<
			Array<{ n: number }>
		>,
		db.execute(
			sql`SELECT count(*)::int AS n FROM lumen.entities WHERE entity_type = 'artwork'`,
		) as unknown as Promise<Array<{ n: number }>>,
		// second-show fix 6: every ingested MEDIA collection with its episode
		// count in one query, visibility applied below (admin preview included).
		// Strong's and Art stay bespoke — they are not media collections and do
		// not render from lumen.collections.
		db.execute(
			sql`SELECT c.id, c.name, c.description, count(e.id)::int AS episodes
			    FROM lumen.collections c
			    LEFT JOIN lumen.entities e
			      ON e.collection_id = c.id AND e.entity_type = 'content_item'
			    WHERE c.category = 'podcast'
			    GROUP BY c.id, c.name, c.description
			    ORDER BY c.name`,
		) as unknown as Promise<
			Array<{ id: string; name: string; description: string | null; episodes: number }>
		>,
		getCollectionAccess(db, user?.id ?? null),
	]);

	const doors: Door[] = [
		{
			to: "/strongs",
			name: "Strong’s",
			detail: "The Hebrew and Greek lexicon behind every word study.",
			count: `${(strongs[0]?.n ?? 0).toLocaleString("en-GB")} entries`,
		},
		{
			to: "/art",
			name: "Art",
			detail: "Public-domain works, shelved against the chapters they depict.",
			count: `${(art[0]?.n ?? 0).toLocaleString("en-GB")} works`,
		},
	];
	for (const c of mediaCollections) {
		// the display registry stays the fail-closed gate: an unregistered
		// collection is queryable but rendered nowhere
		if (displayFamily(c.id) !== "episodes") continue;
		if (!canViewCollection(access, c.id)) continue;
		if (c.episodes === 0) continue;
		doors.push({
			to: `/collections/${c.id}`,
			name: c.name,
			detail: c.description ?? "Podcast episodes.",
			count: `${c.episodes.toLocaleString("en-GB")} ${c.episodes === 1 ? "episode" : "episodes"}`,
		});
	}
	return data({ doors }, { headers });
}

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Collections — Lintel" }];
}

export default function CollectionsIndex({ loaderData }: Route.ComponentProps) {
	const { doors } = loaderData;
	return (
		<PageFrame frame="column">
			<PageHeader title="Collections" />
			<ul className="mt-8 list-none divide-y divide-rule">
				{doors.map((d) => (
					<li key={d.to}>
						<Link
							to={d.to}
							className="-mx-5 block rounded-xl px-5 py-6 outline-none transition-colors duration-150 hover:bg-sel/50 focus-visible:bg-sel/50"
						>
							<span className="flex items-baseline justify-between gap-4">
								<span className="font-display text-lg font-medium text-ink">{d.name}</span>
								<span className="font-ui text-[12px] tabular-nums text-muted-foreground">
									{d.count}
								</span>
							</span>
							<span className="mt-1 block font-reading text-[15px] leading-relaxed text-muted-foreground">
								{d.detail}
							</span>
						</Link>
					</li>
				))}
			</ul>
		</PageFrame>
	);
}
