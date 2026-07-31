import { Link, data, isRouteErrorResponse } from "react-router";
import { sql } from "drizzle-orm";
import { PlayIcon } from "lucide-react";
import { getSessionUser } from "~/lib/auth.server";
import { canViewCollection, getCollectionAccess } from "~/lib/collection-access.server";
import { displayFamily } from "~/lib/collection-display";
import type { Route } from "./+types/collections";

/** Collection landing — the `episodes` display family's index page. Episodes
 * grouped in scripture order (the collection's identity; recency can return
 * once upload dates are backfilled). FAIL-CLOSED twice over: the collection
 * must be registered with the `episodes` family in collection-display.ts AND
 * be public (or the viewer holds admin.collections, or local dev). */

const num = (x: unknown) => Number(x);
const jb = (x: unknown) => (typeof x === "string" ? JSON.parse(x) : x) as any;

function fmtDuration(s: number) {
	const h = Math.floor(s / 3600);
	const m = Math.round((s % 3600) / 60);
	return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

interface Span {
	book: string;
	start: number;
	end: number | null;
}

/** "Ruth 1 · 1 Sam. 1–7" style label from the episode's spans metadata. */
function spansLabel(spans: Span[]): string {
	return spans
		.map((s) => `${s.book} ${s.end !== null && s.end !== s.start ? `${s.start}–${s.end}` : s.start}`)
		.join(" · ");
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
	const id = params.id ?? "";
	const db = context.db;

	// Registry first: an unregistered collection renders nowhere (rule 1).
	if (displayFamily(id) !== "episodes") throw data(null, { status: 404 });

	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	const [[collection], episodes, books, access] = await Promise.all([
		db.execute(sql`SELECT id, name, description FROM lumen.collections WHERE id = ${id}`),
		db.execute(sql`SELECT id, name, metadata FROM lumen.entities
			WHERE collection_id = ${id} AND entity_type = 'content_item'`),
		db.execute(sql`SELECT name, sort_order FROM lumen.books`),
		getCollectionAccess(db, user?.id ?? null),
	]);
	if (!collection || !canViewCollection(access, id)) throw data(null, { status: 404, headers });

	const bookOrder = new Map<string, number>();
	for (const b of books as any[]) bookOrder.set(String(b.name), num(b.sort_order));

	// Group by the FIRST span's book; order groups canonically, episodes by
	// starting chapter within the group.
	const rows = (episodes as any[]).map((e) => {
		const meta = jb(e.metadata);
		const spans = (meta?.spans ?? []) as Span[];
		return {
			id: String(e.id),
			title: String(e.name),
			durationS: num(meta?.media?.duration_s) || 0,
			spans,
			spansLabel: spansLabel(spans),
			book: spans[0]?.book ?? "Other",
			startChapter: num(spans[0]?.start) || 0,
		};
	});
	const groupMap = new Map<string, typeof rows>();
	for (const r of rows) {
		const list = groupMap.get(r.book) ?? [];
		list.push(r);
		groupMap.set(r.book, list);
	}
	const groups = [...groupMap.entries()]
		.sort(([a], [b]) => (bookOrder.get(a) ?? 999) - (bookOrder.get(b) ?? 999))
		.map(([book, list]) => ({
			book,
			episodes: list.sort((a, b) => a.startChapter - b.startChapter),
		}));

	return data(
		{
			collection: {
				id: String(collection.id),
				name: String(collection.name),
				description: collection.description ? String(collection.description) : null,
			},
			groups,
			total: rows.length,
		},
		{ headers },
	);
}

export function meta({ data: d }: Route.MetaArgs) {
	if (!d) return [{ title: "candlestick.study" }];
	return [{ title: `${d.collection.name} · candlestick.study` }];
}

export default function CollectionLanding({ loaderData }: Route.ComponentProps) {
	const { collection, groups, total } = loaderData;

	return (
		<main className="mx-auto max-w-4xl px-6 py-12">
			<header className="border-b border-rule pb-6">
				<p className="font-ui text-[13px] font-normal text-muted-foreground">Collection</p>
				<h1 className="mt-3 font-display text-3xl font-medium tracking-tight">{collection.name}</h1>
				<p className="mt-1 font-ui text-sm text-faint">
					{collection.description && `${collection.description} · `}
					{total} episodes
				</p>
			</header>

			{groups.map((g) => (
				<section key={g.book} aria-label={g.book} className="mt-8">
					<h2 className="font-reading text-sm text-muted-foreground">{g.book}</h2>
					<ul className="mt-2 list-none space-y-1">
						{g.episodes.map((e) => (
							<li key={e.id}>
								<Link
									to={`/media/${e.id}`}
									className="group -mx-3 flex items-center gap-4 rounded-lg border border-transparent p-3 transition-colors duration-150 hover:border-rule2 hover:bg-sel"
								>
									<span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-rule2 text-faint transition-colors group-hover:border-primary group-hover:text-primary">
										<PlayIcon className="ml-0.5 h-3.5 w-3.5" fill="currentColor" />
									</span>
									<span className="min-w-0">
										<span className="block truncate font-reading text-[15px] text-ink">
											{e.title.replace(/^Come Follow Me - /, "")}
										</span>
										<span className="mt-0.5 block font-ui text-xs text-faint">{e.spansLabel}</span>
									</span>
									<span className="ml-auto whitespace-nowrap font-ui text-xs tabular-nums text-faint">
										{fmtDuration(e.durationS)}
									</span>
								</Link>
							</li>
						))}
					</ul>
				</section>
			))}
		</main>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	const is404 = isRouteErrorResponse(error) && error.status === 404;
	return (
		<main className="mx-auto max-w-4xl px-6 py-12">
			<h1 className="font-display text-3xl font-medium">{is404 ? "Not found" : "Error"}</h1>
			<p className="mt-3 font-reading text-muted-foreground">
				{is404 ? "That collection doesn't exist." : "Something went wrong."}
			</p>
			<p className="mt-6">
				<a href="/" className="font-ui text-sm font-semibold text-primary underline">
					← Back to the library
				</a>
			</p>
		</main>
	);
}
