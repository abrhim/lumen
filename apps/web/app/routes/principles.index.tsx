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
			       count(v.id)::int AS verse_count
			FROM lumen.entities e
			-- node.tsx scopes its verse list to 'anthropic-batch'. Every principle
			-- edge carries that source today, so an unscoped count would agree by
			-- luck; scope it here too or the index and the detail page drift the
			-- first time another source writes a verse edge.
			LEFT JOIN lumen.edges g ON g.to_id = e.id AND g.source = 'anthropic-batch'
			LEFT JOIN lumen.verses v ON v.id = g.from_id
			WHERE e.entity_type = 'principle'
			GROUP BY e.id, e.name, e.collection_id, e.metadata
			ORDER BY e.name
		`) as unknown as Promise<
			Array<{
				id: string;
				name: string;
				collection_id: string | null;
				category: string | null;
				verse_count: number;
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

	const shown = useMemo(() => {
		const needle = q.trim().toLowerCase();
		const list = principles.filter(
			(p) =>
				(!category || p.category === category) &&
				(!needle || p.name.toLowerCase().includes(needle)),
		);
		return sort === "verses"
			? [...list].sort((a, b) => b.verses - a.verses || a.name.localeCompare(b.name))
			: list;
	}, [principles, category, q, sort]);

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

			<div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
				{facet(null, "All", principles.length)}
				{Object.keys(CATEGORY_LABELS)
					.filter((c) => counts.get(c))
					.map((c) => facet(c, CATEGORY_LABELS[c], counts.get(c) ?? 0))}
			</div>

			<div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
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
								<span className="whitespace-nowrap font-ui text-xs tabular-nums text-faint">
									{p.verses === 0 ? "—" : `${p.verses} ${p.verses === 1 ? "verse" : "verses"}`}
								</span>
							</RefRow>
						</li>
					))}
				</ul>
			)}
		</PageFrame>
	);
}
