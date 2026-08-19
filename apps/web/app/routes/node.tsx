import { Suspense, lazy, useRef, useState } from "react";
import {
	Link,
	data,
	isRouteErrorResponse,
	redirect,
	useLocation,
	useNavigate,
} from "react-router";
import { sql } from "drizzle-orm";
import { getNeighborhood } from "@lumen/scripture";
import { RefRow } from "~/components/RefRow";
import { getSessionUser } from "~/lib/auth.server";
import { canViewCollection, getCollectionAccess } from "~/lib/collection-access.server";
import type { Route } from "./+types/node";

/** Generic node page — "everything Lumen knows about X" (the word.tsx
 * pattern) for any knowledge entity, behind typed routes where the TYPE IS
 * THE SLUG: /people/:id, /places/:id, /principles/:id, /events/:id, … One
 * generic component; per-type pages can specialize later. A right id under
 * the wrong type redirects to canonical. The local graph is an opt-in view
 * here (?graph=1) — node links elsewhere navigate to this page, not into a
 * drawer. Collection material (episode quotes) is gated by collection
 * visibility; the entity layer itself (phase-b) is public. */

const GraphOverlay = lazy(() => import("~/components/graph/GraphOverlay"));

/** entity_type -> route slug. The registry of typed node routes. */
const TYPE_SLUGS: Record<string, string> = {
	person: "people",
	place: "places",
	principle: "principles",
	event: "events",
	symbol: "symbols",
	era: "eras",
};
const KNOWN_SLUGS = new Set([...Object.values(TYPE_SLUGS), "node"]);

/** Chapter rows shown before "In scripture" collapses. Deep entities carry
 * dozens of chapters, and the sections below this one have to stay reachable. */
const SCRIPTURE_HEAD = 8;
export const nodePath = (type: string, id: string) =>
	`/${TYPE_SLUGS[type] ?? "node"}/${encodeURIComponent(id)}`;

const num = (x: unknown) => Number(x);
const jb = (x: unknown) => (typeof x === "string" ? JSON.parse(x) : x) as any;

function fmt(s: number) {
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = Math.floor(s % 60);
	return h > 0
		? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
		: `${m}:${String(ss).padStart(2, "0")}`;
}

/** Direction-aware labels for the relationship groups we understand; anything
 * else falls through with a humanized rel_type. */
const REL_LABELS: Record<string, [outLabel: string, inLabel: string]> = {
	PARENT_OF: ["Children", "Parents"],
	ANCESTOR_OF: ["Descendants", "Ancestors"],
	GRANDPARENT_OF: ["Grandchildren", "Grandparents"],
	SIBLING_OF: ["Siblings", "Siblings"],
	MARRIED_TO: ["Spouse", "Spouse"],
	INVOLVES: ["Involves", "Events"],
	KILLED: ["Killed", "Killed by"],
	TEACHER_OF: ["Taught", "Teachers"],
	MASTER_OF: ["Master of", "Masters"],
	HAS_SYMBOL: ["Symbols", "Symbol of"],
	TYPIFIES: ["Typifies", "Typified by"],
	FEATURES: ["Features", "Featured in"],
};
const humanize = (rel: string, incoming: boolean) => {
	const known = REL_LABELS[rel];
	if (known) return incoming ? known[1] : known[0];
	const words = rel.toLowerCase().replace(/_/g, " ");
	return incoming ? `${words} ←` : words;
};

export async function loader({ params, request, context }: Route.LoaderArgs) {
	const id = params.id ?? "";
	const db = context.db;
	if (!KNOWN_SLUGS.has(params.type ?? "")) throw data(null, { status: 404 });

	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	const [[entity], verseEdges, entityEdges, collectionEdges, hostEdges, access] = await Promise.all([
		db.execute(sql`SELECT id, entity_type, name, description, collection_id
			FROM lumen.entities WHERE id = ${id}`),
		// Verse-side references: any edge whose other end is a verse.
		db.execute(sql`SELECT g.rel_type, v.id AS verse_id, v.verse_number, c.number AS chapter,
				c.book_id, b.name AS book_name, b.sort_order
			FROM lumen.edges g
			JOIN lumen.verses v ON v.id = g.from_id
			JOIN lumen.chapters c ON c.id = v.chapter_id
			JOIN lumen.books b ON b.id = c.book_id
			WHERE g.to_id = ${id} AND g.source = 'anthropic-batch'
			ORDER BY b.sort_order, c.number, v.verse_number`),
		// Entity-side connections, both directions, with the far node joined.
		db.execute(sql`SELECT g.rel_type, (g.from_id = ${id}) AS outgoing,
				e2.id, e2.name, e2.entity_type
			FROM lumen.edges g
			JOIN lumen.entities e2
				ON e2.id = CASE WHEN g.from_id = ${id} THEN g.to_id ELSE g.from_id END
			WHERE (g.from_id = ${id} OR g.to_id = ${id}) AND g.source = 'anthropic-batch'
			ORDER BY g.rel_type, e2.name`),
		// Collection material: episode + timestamped mentions from EVERY media
		// collection's extraction (second-show: sources follow the collection —
		// `${collection_id}-extraction`; other suffixes never match this LIKE).
		db.execute(sql`SELECT g.from_id AS episode_id, g.rel_type, g.metadata,
				g.collection_id, ep.name AS episode_name, c.name AS collection_name
			FROM lumen.edges g
			JOIN lumen.entities ep ON ep.id = g.from_id
			JOIN lumen.collections c ON c.id = g.collection_id
			WHERE g.to_id = ${id} AND g.source = g.collection_id || '-extraction'`),
		// Curated host attribution (SoJ phase 3): episodes FEATURE their
		// presenters via host-curated edges — a fifth query rather than a
		// widened Connections gate, and deliberately not the -extraction path
		// (whose metadata contract requires a mentions array).
		db.execute(sql`SELECT g.from_id AS episode_id, ep.name AS episode_name,
				ep.metadata AS episode_meta, g.collection_id, c.name AS collection_name
			FROM lumen.edges g
			JOIN lumen.entities ep ON ep.id = g.from_id
			JOIN lumen.collections c ON c.id = g.collection_id
			WHERE g.to_id = ${id} AND g.rel_type = 'FEATURES' AND g.source = 'host-curated'`),
		getCollectionAccess(db, user?.id ?? null),
	]);
	if (!entity) throw data(null, { status: 404, headers });

	// The type is the slug: /people/ahaz-1 is canonical; /places/ahaz-1 redirects.
	const url = new URL(request.url);
	const canonical = nodePath(String(entity.entity_type), id);
	if (params.type !== canonical.split("/")[1]) throw redirect(canonical + url.search);

	// Group verse refs: book+chapter -> verse numbers (deduped across rel types).
	const chapters = new Map<
		string,
		{ label: string; bookId: string; chapter: number; verses: number[]; sort: number }
	>();
	for (const r of verseEdges as any[]) {
		const key = `${r.book_id}-${r.chapter}`;
		const g =
			chapters.get(key) ?? {
				label: `${r.book_name} ${r.chapter}`,
				bookId: String(r.book_id),
				chapter: num(r.chapter),
				verses: [],
				sort: num(r.sort_order) * 1000 + num(r.chapter),
			};
		if (!g.verses.includes(num(r.verse_number))) g.verses.push(num(r.verse_number));
		chapters.set(key, g);
	}
	const scripture = [...chapters.values()].sort((a, b) => a.sort - b.sort);
	const verseRefCount = scripture.reduce((n, c) => n + c.verses.length, 0);

	// Entity connections grouped by direction-aware label.
	const groups = new Map<string, { id: string; name: string; type: string }[]>();
	for (const e of entityEdges as any[]) {
		const label = humanize(String(e.rel_type), !e.outgoing);
		const list = groups.get(label) ?? [];
		if (!list.some((x) => x.id === e.id))
			list.push({ id: String(e.id), name: String(e.name), type: String(e.entity_type) });
		groups.set(label, list);
	}

	// Collection quotes: gated PER COLLECTION (second-show — the old gate keyed
	// everything on Unshaken's visibility); sample up to 6 mentions evenly,
	// quote a small transcript window around each.
	const allMentions: {
		episodeId: string;
		episodeName: string;
		collectionId: string;
		collectionName: string;
		t: number;
		seq: number;
	}[] = [];
	let mentionTotal = 0;
	for (const ce of collectionEdges as any[]) {
		if (!canViewCollection(access, String(ce.collection_id))) continue;
		const mentions = jb(ce.metadata).mentions as { t: number; seq: number }[];
		mentionTotal += mentions.length;
		for (const m of mentions)
			allMentions.push({
				episodeId: String(ce.episode_id),
				episodeName: String(ce.episode_name),
				collectionId: String(ce.collection_id),
				collectionName: String(ce.collection_name),
				t: num(m.t),
				seq: num(m.seq),
			});
	}
	allMentions.sort((a, b) => a.t - b.t);
	const step = Math.max(1, Math.floor(allMentions.length / 6));
	const sampled = allMentions.filter((_, i) => i % step === 0).slice(0, 6);
	const quotes = await Promise.all(
		sampled.map(async (m) => {
			const rows = await db.execute(
				sql`SELECT text FROM lumen.transcripts
					WHERE episode_id = ${m.episodeId} AND seq BETWEEN ${m.seq} AND ${m.seq + 2}
					ORDER BY seq`,
			);
			const text = (rows as any[]).map((r) => r.text).join(" ");
			return { ...m, text: text.length > 220 ? `${text.slice(0, 217)}…` : text };
		}),
	);
	// The lens entry targets the episode with the most of this node's mentions,
	// per collection; quotes group per collection so each carries its own name.
	const byCollection = new Map<string, { name: string; total: number; byEpisode: Map<string, number> }>();
	for (const m of allMentions) {
		const g = byCollection.get(m.collectionId) ?? { name: m.collectionName, total: 0, byEpisode: new Map() };
		g.total += 1;
		g.byEpisode.set(m.episodeId, (g.byEpisode.get(m.episodeId) ?? 0) + 1);
		byCollection.set(m.collectionId, g);
	}
	const collectionGroups = [...byCollection.entries()].map(([cid, g]) => ({
		id: cid,
		name: g.name,
		total: g.total,
		quotes: quotes.filter((q) => q.collectionId === cid),
		lensEpisode: [...g.byEpisode.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
	})).sort((a, b) => b.total - a.total);

	// Hosted episodes: per-collection visibility, newest first.
	const hostedEpisodes = (hostEdges as any[])
		.filter((e) => canViewCollection(access, String(e.collection_id)))
		.map((e) => ({
			id: String(e.episode_id),
			name: String(e.episode_name),
			collectionId: String(e.collection_id),
			collectionName: String(e.collection_name),
			uploadDate: String(jb(e.episode_meta)?.upload_date ?? ""),
		}))
		.sort((a, b) => b.uploadDate.localeCompare(a.uploadDate));

	// Opt-in graph view (?graph=1&depth=N): the node page hosts the local graph.
	let graph: { degraded: boolean; neighborhood?: unknown; entityId: string; depth: 1 | 2 | 3 } | null =
		null;
	if (url.searchParams.has("graph")) {
		const rawDepth = Number(url.searchParams.get("depth"));
		const depth = (rawDepth === 2 || rawDepth === 3 ? rawDepth : 1) as 1 | 2 | 3;
		try {
			const neighborhood = await getNeighborhood(context.neo4j, id, { depth });
			graph = { degraded: false, neighborhood, entityId: id, depth };
		} catch {
			graph = { degraded: true, entityId: id, depth };
		}
	}

	return data(
		{
			entity: {
				id: String(entity.id),
				type: String(entity.entity_type),
				name: String(entity.name),
				description: entity.description ? String(entity.description) : null,
			},
			scripture,
			verseRefCount,
			groups: [...groups.entries()].map(([label, items]) => ({ label, items })),
			hostedEpisodes,
			collections: collectionGroups,
			mentionTotal,
			graph,
		},
		{ headers },
	);
}

export function meta({ data: d }: Route.MetaArgs) {
	if (!d) return [{ title: "Lintel" }];
	return [{ title: `${d.entity.name} · Lintel` }];
}

const TYPE_LABELS: Record<string, string> = {
	person: "Person",
	place: "Place",
	principle: "Principle",
	event: "Event",
	symbol: "Symbol",
	era: "Era",
};

export default function NodeDetail({ loaderData }: Route.ComponentProps) {
	const { entity, scripture, verseRefCount, groups, hostedEpisodes, collections, graph } = loaderData;
	const navigate = useNavigate();
	const location = useLocation();
	const graphInvoker = useRef<HTMLElement | null>(null);
	// A well-attested entity carries a hundred verses across dozens of chapters,
	// which buries every section under it. Collapse to a readable head and let
	// the reader ask for the rest.
	const [allScripture, setAllScripture] = useState(false);
	const shownScripture = allScripture ? scripture : scripture.slice(0, SCRIPTURE_HEAD);
	const restCount = scripture.length - shownScripture.length;

	return (
		<main data-plate="ledger" className="mx-auto max-w-4xl px-6 py-12">
			<header className="border-b border-rule pb-6">
				<p className="font-ui text-[13px] font-normal text-muted-foreground">{TYPE_LABELS[entity.type] ?? entity.type}</p>
				<div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
					<h1 className="font-display text-3xl font-medium tracking-tight">{entity.name}</h1>
					<span className="font-reading text-sm text-muted-foreground">
						{TYPE_LABELS[entity.type] ?? entity.type}
					</span>
					<Link
						to="?graph=1"
						ref={(el) => {
							graphInvoker.current = el;
						}}
						className="font-ui text-sm font-semibold text-primary hover:underline"
					>
						View graph →
					</Link>
				</div>
				{/* Principle summaries run to several paragraphs now that they are
				    written rather than generated one-liners; a blank line in the
				    column is a paragraph break, not whitespace to collapse. */}
				{entity.description
					?.split(/\n{2,}/)
					.map((p) => p.trim())
					.filter(Boolean)
					.map((p, i) => (
						<p
							key={p.slice(0, 32)}
							className={`max-w-prose font-reading text-lg leading-relaxed text-ink ${i === 0 ? "mt-4" : "mt-3"}`}
						>
							{p}
						</p>
					))}
			</header>

			{graph && (
				<Suspense fallback={null}>
					<GraphOverlay
						entityId={graph.entityId}
						depth={graph.depth as 1 | 2 | 3}
						graph={Promise.resolve(graph as never)}
						isPending={false}
						invoker={graphInvoker}
						onNavigate={(id, depth) =>
							navigate(`/node/${encodeURIComponent(id)}?graph=1&depth=${depth}`)
						}
						onClose={() => navigate(location.pathname)}
						onReadVerse={(t) => navigate(`/scripture/${t.book}/${t.chapter}?verse=${t.verse}`)}
					/>
				</Suspense>
			)}

			{hostedEpisodes.length > 0 && (
				<section className="mt-10">
					<h2 className="font-reading text-sm text-muted-foreground">
						Episodes <span className="not-italic">· {hostedEpisodes.length}</span>
					</h2>
					<ul className="mt-3 list-none">
						{hostedEpisodes.map((ep) => (
							<li key={ep.id}>
								<RefRow to={`/collections/${ep.collectionId}/serial/${ep.id}`} ariaLabel={`Open ${ep.name}`}>
									<span className="min-w-0 flex-initial truncate font-reading text-[15px] text-ink">
										{ep.name}
									</span>
									<span className="whitespace-nowrap font-ui text-xs text-faint">
										{ep.collectionName}
									</span>
								</RefRow>
							</li>
						))}
					</ul>
				</section>
			)}

			{scripture.length > 0 && (
				<section className="mt-10">
					<h2 className="font-reading text-sm text-muted-foreground">
						In scripture{" "}
						<span className="not-italic">
							· {verseRefCount} {verseRefCount === 1 ? "verse" : "verses"} in {scripture.length}{" "}
							{scripture.length === 1 ? "chapter" : "chapters"}
						</span>
					</h2>
					<ul id="node-scripture" className="mt-3 list-none">
						{shownScripture.map((c) => (
							<li key={c.label}>
								<RefRow
									to={`/scripture/${c.bookId}/${c.chapter}?verse=${c.verses[0]}`}
									ariaLabel={`Open ${c.label} verse ${c.verses[0]}`}
								>
									<span className="whitespace-nowrap font-reading text-[15px] text-ink">
										{c.label}
									</span>
									<span className="min-w-0 flex-initial truncate font-ui text-xs tabular-nums text-faint">
										v. {c.verses.join(", ")}
									</span>
								</RefRow>
							</li>
						))}
					</ul>
					{(restCount > 0 || allScripture) && (
						<button
							type="button"
							onClick={() => setAllScripture((v) => !v)}
							aria-expanded={allScripture}
							aria-controls="node-scripture"
							className="mt-2 font-ui text-sm font-semibold text-faint transition-colors duration-150 hover:text-primary focus-visible:underline focus-visible:decoration-2 focus-visible:underline-offset-4 focus-visible:outline-none"
						>
							{allScripture ? "Show fewer" : `Show ${restCount} more`}
						</button>
					)}
				</section>
			)}

			{collections.map((col) => (
				col.total > 0 && (
				<section key={col.id} className="mt-10">
					<h2 className="font-reading text-sm text-muted-foreground">
						In {col.name} <span className="not-italic">· {col.total} passages</span>
					</h2>
					<div className="mt-3 space-y-3">
						{col.quotes.map((q) => (
							<RefRow
								key={`${q.episodeId}-${q.seq}`}
								to={`/media/${q.episodeId}?t=${Math.floor(q.t)}`}
								className="max-w-prose items-start py-2"
								ariaLabel={`Play from ${fmt(q.t)}`}
							>
								<span className="min-w-0 flex-1">
									<blockquote className="border-l-2 border-rule2 pl-4 font-reading text-[15px] leading-relaxed text-ink">
										“{q.text}”
									</blockquote>
									<span className="mt-1 block pl-4 font-ui text-xs text-faint">
										{q.episodeName} · <span className="tabular-nums">{fmt(q.t)}</span>
									</span>
								</span>
							</RefRow>
						))}
					</div>
					{col.lensEpisode && (
						<p className="mt-4 font-ui text-sm">
							<Link
								to={`/media/${col.lensEpisode}?lens=${encodeURIComponent(entity.id)}`}
								className="font-semibold text-primary hover:underline"
							>
								Read the episode through {entity.name} →
							</Link>
						</p>
					)}
				</section>
				)
			))}

			{groups.length > 0 && (
				<section className="mt-10">
					<h2 className="font-reading text-sm text-muted-foreground">Connections</h2>
					<div className="mt-3 max-w-prose space-y-4">
						{groups.map((g) => (
							<div key={g.label}>
								<p className="font-ui text-xs text-faint">{g.label}</p>
								<ul className="mt-1 list-none">
									{g.items.map((it) => (
										<li key={it.id}>
											<RefRow to={nodePath(it.type, it.id)}>
												<span className="font-reading text-[15px] text-ink">{it.name}</span>
												<span className="font-ui text-xs text-faint">
													{TYPE_LABELS[it.type] ?? it.type}
												</span>
											</RefRow>
										</li>
									))}
								</ul>
							</div>
						))}
					</div>
				</section>
			)}
		</main>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	const is404 = isRouteErrorResponse(error) && error.status === 404;
	return (
		<main data-plate="ledger" className="mx-auto max-w-4xl px-6 py-12">
			<h1 className="font-display text-3xl font-medium">{is404 ? "Not found" : "Error"}</h1>
			<p className="mt-3 font-reading text-muted-foreground">
				{is404 ? "That node isn't in the graph." : "Something went wrong."}
			</p>
		</main>
	);
}
