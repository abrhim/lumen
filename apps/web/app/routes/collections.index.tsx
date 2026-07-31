import { Link, data } from "react-router";
import { sql } from "drizzle-orm";
import { getSessionUser } from "~/lib/auth.server";
import { canViewCollection, getCollectionAccess } from "~/lib/collection-access.server";
import { displayFamily } from "~/lib/collection-display";
import type { Route } from "./+types/collections.index";

/**
 * Collections index (Abram, 2026-07-31: "i can't go to a list of all
 * collections and find my podcast i like"). Every collection the viewer
 * can see, as a typographic ledger: name, description, item count.
 * Fail-closed: non-viewable collections simply don't print (the register
 * rule — absence, never a lock icon).
 */

interface CollectionRow {
	id: string;
	name: string;
	description: string | null;
	items: number;
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const db = context.db;
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	headers.set("Cache-Control", "private, no-store");
	const [rows, access] = await Promise.all([
		db.execute(sql`
			SELECT c.id, c.name, c.description, count(e.id)::int AS items
			FROM lumen.collections c
			LEFT JOIN lumen.entities e
				ON e.collection_id = c.id AND e.entity_type = 'content_item'
			GROUP BY c.id, c.name, c.description
			ORDER BY c.name
		`) as unknown as Promise<CollectionRow[]>,
		getCollectionAccess(db, user?.id ?? null),
	]);
	const collections = (rows as CollectionRow[]).filter((c) => canViewCollection(access, c.id));
	return data({ collections }, { headers });
}

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Collections — Lumen" }];
}

export default function CollectionsIndex({ loaderData }: Route.ComponentProps) {
	const { collections } = loaderData;
	return (
		<main className="mx-auto max-w-2xl px-6 py-12">
			<header className="border-b border-rule pb-6">
				<h1 className="font-display text-3xl font-medium tracking-tight">Collections</h1>
				<p className="mt-2 font-reading italic text-muted-foreground">
					Recorded voices alongside the text.
				</p>
			</header>
			{collections.length === 0 ? (
				<p className="mt-8 font-reading text-muted-foreground">Nothing here yet.</p>
			) : (
				<ul className="mt-4 list-none divide-y divide-rule">
					{collections.map((c) => {
						const linked = displayFamily(c.id) === "episodes";
						const body = (
							<>
								<span className="flex items-baseline justify-between gap-4">
									<span className="font-display text-lg font-medium text-ink">{c.name}</span>
									{c.items > 0 && (
										<span className="font-ui text-[11px] tabular-nums text-muted-foreground">
											{c.items} {c.items === 1 ? "episode" : "episodes"}
										</span>
									)}
								</span>
								{c.description && (
									<span className="mt-1 block font-reading text-[15px] leading-relaxed text-muted-foreground">
										{c.description}
									</span>
								)}
							</>
						);
						return (
							<li key={c.id}>
								{linked ? (
									<Link
										to={`/collections/${c.id}`}
										className="block py-5 outline-none transition-colors duration-150 hover:bg-sel/50 focus-visible:bg-sel/50"
									>
										{body}
									</Link>
								) : (
									<div className="block py-5">{body}</div>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</main>
	);
}
