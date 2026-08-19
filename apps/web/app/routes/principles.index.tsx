import { useMemo, useState } from "react";
import { data, useSearchParams } from "react-router";
import { sql } from "drizzle-orm";
import { RefRow } from "~/components/RefRow";
import { PageFrame, PageHeader } from "~/components/PageFrame";
import { getSessionUser } from "~/lib/auth.server";
import { canViewCollection, getCollectionAccess } from "~/lib/collection-access.server";
import type { Route } from "./+types/principles.index";

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Principles · Lintel" }];
}

/**
 * /principles — the index over every principle entity.
 *
 * 262 rows is small enough to ship whole and filter in the browser, which is
 * the point: typing narrows instantly with no round trip. The category facet
 * rides in the URL because it is a small discrete set worth linking to; the
 * text query stays local because putting a keystroke in the URL turns typing
 * into navigation.
 *
 * Rows carry their verse count because it is the honest signal of depth here —
 * the spread runs from 1,452 down to zero, and 78 principles have no verse
 * behind them at all. A reader deciding where to start deserves to see that.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	const [rows, access] = await Promise.all([
		context.db.execute(sql`
			SELECT e.id, e.name, e.collection_id,
			       e.metadata->>'category' AS category,
			       -- node.tsx scopes its verse list to 'anthropic-batch'. Every
			       -- principle edge carries that source today, so an unscoped
			       -- count would agree by luck; scope it here too or the index
			       -- and the detail page drift the first time another source
			       -- writes a verse edge.
			       (SELECT count(*)::int FROM lumen.edges g
			          JOIN lumen.verses v ON v.id = g.from_id
			         WHERE g.to_id = e.id AND g.source = 'anthropic-batch') AS verse_count,
			       -- Everything else pointing at this principle: episode mentions,
			       -- entity connections. A principle with no verses is not
			       -- necessarily empty, and the index said it was.
			       (SELECT count(*)::int FROM lumen.edges g
			         WHERE g.to_id = e.id
			           AND NOT EXISTS (SELECT 1 FROM lumen.verses v WHERE v.id = g.from_id)) AS link_count
			FROM lumen.entities e
			WHERE e.entity_type = 'principle'
			ORDER BY e.name
		`) as unknown as Promise<
			Array<{
				id: string;
				name: string;
				collection_id: string | null;
				category: string | null;
				verse_count: number;
				link_count: number;
			}>
		>,
		getCollectionAccess(context.db, user?.id ?? null),
	]);

	// Principles all sit in one public collection today. The gate is here so
	// that stays true by construction rather than by luck.
	const principles = rows
		.filter((r) => !r.collection_id || canViewCollection(access, String(r.collection_id)))
		.map((r) => ({
			id: String(r.id),
			name: String(r.name),
			category: r.category ? String(r.category) : null,
			verses: Number(r.verse_count),
			links: Number(r.link_count),
		}));

	return data({ principles }, { headers });
}

/* ---------------------------------- UI ---------------------------------- */

const CATEGORY_LABELS: Record<string, string> = {
	doctrine: "Doctrine",
	"gospel-principle": "Gospel principles",
	"christlike-attribute": "Christlike attributes",
	ordinance: "Ordinances",
	commandment: "Commandments",
	covenant: "Covenants",
};

const label = (c: string | null) => (c ? (CATEGORY_LABELS[c] ?? c) : "Uncategorized");

type Sort = "name" | "verses";

export default function PrinciplesIndex({ loaderData }: Route.ComponentProps) {
	const { principles } = loaderData;
	const [searchParams, setSearchParams] = useSearchParams();
	const [q, setQ] = useState("");
	const category = searchParams.get("category");
	const sort: Sort = searchParams.get("sort") === "verses" ? "verses" : "name";

	const counts = useMemo(() => {
		const m = new Map<string, number>();
		for (const p of principles) m.set(p.category ?? "", (m.get(p.category ?? "") ?? 0) + 1);
		return m;
	}, [principles]);

	// A principle with nothing pointing at it at all — no verse, no episode, no
	// connection. Distinct from the far larger set that simply has no verses.
	const bare = (p: { verses: number; links: number }) => p.verses === 0 && p.links === 0;
	const bareCount = useMemo(() => principles.filter(bare).length, [principles]);
	const onlyBare = searchParams.get("unlinked") === "1";

	const shown = useMemo(() => {
		const needle = q.trim().toLowerCase();
		const list = principles.filter(
			(p) =>
				(!category || p.category === category) &&
				(!onlyBare || bare(p)) &&
				(!needle || p.name.toLowerCase().includes(needle)),
		);
		return sort === "verses"
			? [...list].sort((a, b) => b.verses - a.verses || a.name.localeCompare(b.name))
			: list;
	}, [principles, category, q, sort, onlyBare]);

	const setParam = (key: string, value: string | null) => {
		const next = new URLSearchParams(searchParams);
		if (value === null) next.delete(key);
		else next.set(key, value);
		setSearchParams(next, { preventScrollReset: true });
	};

	const facet = (key: string | null, text: string, n: number) => {
		const on = category === key;
		return (
			<button
				key={key ?? "all"}
				type="button"
				onClick={() => setParam("category", key)}
				aria-pressed={on}
				className={`font-ui text-[13px] transition-colors duration-150 hover:text-primary ${
					on ? "font-semibold text-ink" : "text-muted-foreground"
				}`}
			>
				{text} <span className="tabular-nums text-faint">{n}</span>
			</button>
		);
	};

	return (
		<PageFrame frame="ledger">
			<PageHeader
				kicker="Index"
				title="Principles"
				intro="Every principle the collections teach, and how many verses stand behind each one."
			/>

			{/* Search first (Abram, 2026-08-19): typing is what a reader reaches
			    for on a 262-row index, and the categories are the narrower move. */}
			<div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
				<label className="min-w-0 flex-1">
					<span className="sr-only">Filter principles by name</span>
					<input
						type="search"
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder="Filter by name…"
						className="w-full max-w-sm border-b border-rule bg-transparent py-1 font-reading text-[15px] text-ink placeholder:text-faint focus:border-primary focus:outline-none"
					/>
				</label>
				<div className="flex items-center gap-4 font-ui text-[13px]">
					<button
						type="button"
						onClick={() => setParam("unlinked", onlyBare ? null : "1")}
						aria-pressed={onlyBare}
						className={`transition-colors duration-150 hover:text-primary ${onlyBare ? "font-semibold text-ink" : "text-muted-foreground"}`}
					>
						Nothing yet <span className="tabular-nums text-faint">{bareCount}</span>
					</button>
					<span aria-hidden="true" className="text-faint">
						·
					</span>
					<button
						type="button"
						onClick={() => setParam("sort", null)}
						aria-pressed={sort === "name"}
						className={`transition-colors duration-150 hover:text-primary ${sort === "name" ? "font-semibold text-ink" : "text-muted-foreground"}`}
					>
						A–Z
					</button>
					<button
						type="button"
						onClick={() => setParam("sort", "verses")}
						aria-pressed={sort === "verses"}
						className={`transition-colors duration-150 hover:text-primary ${sort === "verses" ? "font-semibold text-ink" : "text-muted-foreground"}`}
					>
						Most referenced
					</button>
				</div>
			</div>

			<div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
				{facet(null, "All", principles.length)}
				{Object.keys(CATEGORY_LABELS)
					.filter((c) => counts.get(c))
					.map((c) => facet(c, CATEGORY_LABELS[c], counts.get(c) ?? 0))}
			</div>

			<p aria-live="polite" className="mt-4 font-ui text-[13px] text-faint">
				{shown.length} of {principles.length}
			</p>

			{shown.length === 0 ? (
				<p className="mt-6 font-reading text-[17px] text-muted-foreground">
					Nothing here by that name. Try a shorter word, or clear the category.
				</p>
			) : (
				<ul className="mt-2 list-none">
					{shown.map((p) => (
						<li key={p.id}>
							<RefRow to={`/principles/${p.id}`} ariaLabel={`Open ${p.name}`}>
								<span className="min-w-0 flex-initial truncate font-reading text-[15px] text-ink">
									{p.name}
								</span>
								<span className="whitespace-nowrap font-ui text-xs text-faint">
									{label(p.category)}
								</span>
								{/* A principle with no verses may still carry episode
								    mentions and entity connections; saying "—" for both
								    called 55 of these empty when they are not. */}
								<span className="whitespace-nowrap font-ui text-xs tabular-nums text-faint">
									{p.verses > 0
										? `${p.verses} ${p.verses === 1 ? "verse" : "verses"}`
										: p.links > 0
											? `${p.links} ${p.links === 1 ? "connection" : "connections"}`
											: "nothing yet"}
								</span>
							</RefRow>
						</li>
					))}
				</ul>
			)}
		</PageFrame>
	);
}
