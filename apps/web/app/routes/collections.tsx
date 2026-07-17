import { Link, isRouteErrorResponse, useSearchParams } from "react-router";
import { PlayIcon } from "lucide-react";
import { DEMO_SHOW, DEMO_EPISODES, episodesByBook } from "~/lib/podcast-demo";
import type { Route } from "./+types/collections";

/** Show landing (PROTOTYPE, demo data) — quietly the template for every future
 * public collection surface. Scripture order is the default identity; recency
 * is a secondary sort, URL-owned (?sort=recent). */
export async function loader({ params }: Route.LoaderArgs) {
	if (params.id !== DEMO_SHOW.id) {
		throw new Response(`No collection "${params.id}".`, { status: 404 });
	}
	return { show: DEMO_SHOW, groups: episodesByBook(), total: DEMO_EPISODES.length };
}

export function meta({ data }: Route.MetaArgs) {
	if (!data) return [{ title: "Lumen" }];
	return [{ title: `${data.show.name} · Lumen` }];
}

export default function CollectionLanding({ loaderData }: Route.ComponentProps) {
	const { show, groups, total } = loaderData;
	const [searchParams] = useSearchParams();
	const recent = searchParams.get("sort") === "recent";
	const flatRecent = [...DEMO_EPISODES].sort((a, b) => b.number - a.number);

	const row = (e: (typeof DEMO_EPISODES)[number]) => (
		<li key={e.id}>
			<Link
				to={`/media/${e.id}`}
				className="group flex items-center gap-4 rounded-lg border border-rule2 bg-surface p-3 transition-colors duration-150 hover:border-primary"
			>
				<span className="flex aspect-video w-20 flex-none items-center justify-center rounded-md bg-panel2">
					<span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
						<PlayIcon className="ml-0.5 h-3 w-3" fill="currentColor" />
					</span>
				</span>
				<span className="min-w-0">
					<span className="block truncate font-ui text-sm font-semibold text-ink group-hover:text-primary">
						Ep. {e.number} · {e.title}
					</span>
					<span className="mt-1 block font-ui text-xs text-faint">
						{e.chapters.map((c) => c.label).join(" · ")}
					</span>
				</span>
				<span className="ml-auto whitespace-nowrap text-right font-ui text-xs tabular-nums text-faint">
					{e.minutes} min
					<br />
					{e.dateLabel}
				</span>
			</Link>
		</li>
	);

	return (
		<main className="mx-auto max-w-4xl px-6 py-10">
			<p className="rounded-lg border border-dashed border-rule2 px-3 py-1.5 font-ui text-[11px] text-faint">
				Prototype · demo data — “{show.name}” is a placeholder show
			</p>

			<header className="mt-6 flex items-center gap-5 border-b border-rule pb-6">
				<div className="flex h-16 w-16 flex-none items-center justify-center rounded-xl bg-primary font-display text-2xl text-primary-foreground">
					{show.name[0]}
				</div>
				<div>
					<p className="font-ui text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">
						<Link to="/" className="hover:text-ink">
							Lumen
						</Link>{" "}
						· Collection
					</p>
					<h1 className="mt-1 font-display text-3xl font-medium tracking-tight">{show.name}</h1>
					<p className="mt-1 font-ui text-sm text-faint">
						{show.tagline} · {total} episodes · {show.provenance}
					</p>
				</div>
			</header>

			<nav aria-label="Sort order" className="mt-6 inline-flex overflow-hidden rounded-lg border border-rule2 font-ui text-xs font-semibold">
				<Link
					to={`/collections/${show.id}`}
					className={recent ? "px-3 py-1.5 text-faint hover:text-ink" : "bg-sel px-3 py-1.5 text-primary"}
					aria-current={recent ? undefined : "true"}
				>
					Scripture order
				</Link>
				<Link
					to={`/collections/${show.id}?sort=recent`}
					className={recent ? "bg-sel px-3 py-1.5 text-primary" : "px-3 py-1.5 text-faint hover:text-ink"}
					aria-current={recent ? "true" : undefined}
				>
					Recent
				</Link>
			</nav>

			{recent ? (
				<ul className="mt-6 list-none space-y-2">{flatRecent.map(row)}</ul>
			) : (
				groups.map((g) => (
					<section key={g.book} aria-label={g.book} className="mt-8">
						<h2 className="font-ui text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
							{g.book}
						</h2>
						<ul className="mt-3 list-none space-y-2">{g.episodes.map(row)}</ul>
					</section>
				))
			)}
		</main>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	const is404 = isRouteErrorResponse(error) && error.status === 404;
	return (
		<main className="mx-auto max-w-2xl px-6 py-16">
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
