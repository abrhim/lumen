import { Link, data } from "react-router";
import { sql } from "drizzle-orm";
import { getSessionUser } from "~/lib/auth.server";
import { PageFrame, PageHeader } from "~/components/PageFrame";
import { canViewCollection, getCollectionAccess } from "~/lib/collection-access.server";
import type { Route } from "./+types/collections.index";

/**
 * Collections — CURATED (Abram, 2026-07-31): exactly three doors surface
 * right now — Strong's, Art, and Unshaken. The generic all-collections
 * listing is deliberately gone; new collections earn their line here by
 * ruling, not by existing. Counts are live; a non-viewable Unshaken
 * simply doesn't print (fail-closed, absence).
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
	const [strongs, art, unshaken, episodes, access] = await Promise.all([
		db.execute(sql`SELECT count(*)::int AS n FROM lumen.strongs_lexicon`) as unknown as Promise<
			Array<{ n: number }>
		>,
		db.execute(
			sql`SELECT count(*)::int AS n FROM lumen.entities WHERE entity_type = 'artwork'`,
		) as unknown as Promise<Array<{ n: number }>>,
		db.execute(
			sql`SELECT id, name, description FROM lumen.collections WHERE id = 'unshaken'`,
		) as unknown as Promise<Array<{ id: string; name: string; description: string | null }>>,
		db.execute(
			sql`SELECT count(*)::int AS n FROM lumen.entities
			    WHERE entity_type = 'content_item' AND collection_id = 'unshaken'`,
		) as unknown as Promise<Array<{ n: number }>>,
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
	const u = unshaken[0];
	if (u && canViewCollection(access, u.id)) {
		doors.push({
			to: `/collections/${u.id}`,
			name: u.name,
			detail: u.description ?? "Verse-by-verse podcast episodes.",
			count: `${(episodes[0]?.n ?? 0).toLocaleString("en-GB")} episodes`,
		});
	}
	return data({ doors }, { headers });
}

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Collections — lintel" }];
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
