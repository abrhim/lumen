import { Suspense, lazy, useEffect, useRef } from "react";
import {
	Await,
	Link,
	isRouteErrorResponse,
	useNavigate,
	useNavigation,
	useNavigationType,
} from "react-router";
import { WaypointsIcon, XIcon } from "lucide-react";
import {
	parseReference,
	buildVerseId,
	getVersesByChapter,
	getChapterSummary,
	getVerseConnections,
	getNeighborhood,
	getPublicCollectionIds,
	type CrossReference,
	type NeighborhoodResult,
	type VerseConnectionsResult,
	type VerseEntityRef,
} from "@lumen/scripture";
import { Skeleton } from "~/components/ui/skeleton";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "~/components/ui/sheet";
import { useIsMobile } from "~/hooks/use-mobile";
import { cachedJson } from "../lib/cache.server";
import { logEvent } from "../lib/log.server";
import type { Route } from "./+types/scripture";

const CONNECTIONS_TTL_SECONDS = 7 * 24 * 60 * 60; // scripture graph is immutable between ingests

// The overlay (d3 + dialog) loads only when a graph is opened.
const GraphOverlay = lazy(() => import("~/components/graph/GraphOverlay"));

// Stable stand-in while an optimistic first open waits for the loader's promise.
const PENDING_FOREVER = new Promise<never>(() => {});

interface VerseRow {
	id: string;
	verse_number: number;
	text: string;
	reference: string;
}

/** Resolved shape of the streamed panel promise — degradation is a value, not a rejection. */
type VersePanelData =
	| {
			degraded: false;
			crossRefs: CrossReference[];
			principles: VerseEntityRef[];
			people: VerseEntityRef[];
	  }
	| { degraded: true };

/** One owner for the ?verse grammar — the loader and the optimistic client parse share it. */
function parseVerseParam(search: string): number | null {
	const raw = new URLSearchParams(search).get("verse");
	if (raw === null || !/^\d+$/.test(raw)) return null;
	const n = parseInt(raw, 10);
	return n > 0 ? n : null;
}

/** Resolved shape of the streamed graph promise — degradation is a value, not a
 * rejection. Echoes the request (entityId/depth) so the overlay can tell a
 * freshly-resolved graph from a held-over stale one during transitions. */
export type GraphPanelData =
	| { degraded: false; neighborhood: NeighborhoodResult; entityId: string; depth: 1 | 2 | 3 }
	| { degraded: true; entityId: string; depth: 1 | 2 | 3 };

const GRAPH_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;

const GRAPH_NOT_FOUND: NeighborhoodResult = {
	found: false,
	center: null,
	nodes: [],
	edges: [],
	truncated: { shown: 0, total: 0 },
};

/** Depth clamps (unlike ?verse's treat-as-absent): the picker always needs a renderable value. */
function clampDepth(raw: string | null): 1 | 2 | 3 {
	if (raw === null || !/^\d+$/.test(raw)) return 1;
	return Math.min(3, Math.max(1, parseInt(raw, 10))) as 1 | 2 | 3;
}

/**
 * Never rejects — turbo-stream aborts and Neo4j failures both resolve degraded.
 * Cache discipline (B9): only `found:true` results earn the 7-day KV entry —
 * junk ids must not consume the KV write budget (free tier: 1,000 writes/day).
 * Logging happens at origin fetches only, never on cache hits (B19).
 */
async function loadGraph(
	context: Route.LoaderArgs["context"],
	entityId: string,
	depth: 1 | 2 | 3,
	collections: string[] | undefined,
): Promise<GraphPanelData> {
	const startedAt = Date.now();
	const collKey = (collections ?? []).slice().sort().join(",");
	const cacheKey = `graph:v1:${entityId}:${depth}:${collKey}`;
	try {
		if (context.cache) {
			try {
				const hit = await context.cache.get(cacheKey);
				if (hit != null) {
					return { degraded: false, neighborhood: JSON.parse(hit) as NeighborhoodResult, entityId, depth };
				}
			} catch (error) {
				logEvent("kv_cache_error", {
					op: "get",
					key: cacheKey,
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}

		const neighborhood = await getNeighborhood(context.neo4j, entityId, {
			depth,
			collections: collections && collections.length > 0 ? collections : undefined,
		});
		const elapsedMs = Date.now() - startedAt;

		if (!neighborhood.found) {
			logEvent("graph_not_found", { entityId, depth, collections: collKey, elapsedMs });
		} else {
			if (neighborhood.truncated.shown < neighborhood.truncated.total) {
				logEvent("graph_truncated", {
					entityId,
					depth,
					shown: neighborhood.truncated.shown,
					total: neighborhood.truncated.total,
					elapsedMs,
				});
			}
			if (context.cache) {
				try {
					await context.cache.put(cacheKey, JSON.stringify(neighborhood), {
						expirationTtl: CONNECTIONS_TTL_SECONDS,
					});
				} catch (error) {
					logEvent("kv_cache_error", {
						op: "put",
						key: cacheKey,
						message: error instanceof Error ? error.message : String(error),
					});
				}
			}
		}
		return { degraded: false, neighborhood, entityId, depth };
	} catch (error) {
		logEvent("graph_degraded", {
			name: error instanceof Error ? error.name : "unknown",
			message: error instanceof Error ? error.message : String(error),
			entityId,
			depth,
			collections: collKey,
			elapsedMs: Date.now() - startedAt,
		});
		return { degraded: true, entityId, depth };
	}
}

/** Never rejects: failures resolve to `{degraded: true}` so the streamed panel can't crash the page. */
async function loadConnections(
	context: Route.LoaderArgs["context"],
	bookId: string,
	chapter: number,
	verse: number,
): Promise<VersePanelData> {
	const verseId = buildVerseId(bookId, chapter, verse);
	try {
		const result = await cachedJson<VerseConnectionsResult>(
			context.cache,
			`vconn:v1:${verseId}`,
			CONNECTIONS_TTL_SECONDS,
			() => getVerseConnections(context.neo4j, verseId),
		);
		return {
			degraded: false,
			crossRefs: result.cross_references,
			principles: result.principles,
			people: result.people,
		};
	} catch (error) {
		logEvent("neo4j_degraded", {
			name: error instanceof Error ? error.name : "unknown",
			message: error instanceof Error ? error.message : String(error),
			book: bookId,
			chapter,
			verse,
		});
		return { degraded: true };
	}
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
	const rawBook = params.book ?? "";
	const rawChapter = params.chapter ?? "";
	const url = new URL(request.url);

	// "dc" parses as a volume, but D&C is a single-book volume and carries a
	// bookId — accept it here alongside plain book slugs.
	const parsed = parseReference(rawBook);
	const isBookish = parsed.level === "book" || parsed.level === "volume";
	if (!isBookish || !parsed.bookId) {
		logEvent("scripture_404", { cause: "unknown_book", book: rawBook });
		throw new Response(`Unknown book "${rawBook}".`, { status: 404 });
	}
	const bookId = parsed.bookId;

	if (!/^\d+$/.test(rawChapter)) {
		logEvent("scripture_404", { cause: "invalid_chapter", book: bookId, chapter: rawChapter });
		throw new Response(`"${rawChapter}" is not a valid chapter number.`, { status: 404 });
	}
	const chapter = parseInt(rawChapter, 10);

	// API-1: one canonical URL per chapter — aliases (1ne, "1 nephi") redirect.
	if (rawBook !== bookId) {
		throw new Response(null, {
			status: 301,
			headers: { Location: `/scripture/${bookId}/${chapter}${url.search}` },
		});
	}

	// Kick off the graph fetch before the Postgres round trip — they're
	// independent, and the panel shouldn't pay both latencies in sequence.
	// Deliberately not awaited: React Router streams the promise, so the
	// chapter renders immediately and the panel fills in when Neo4j answers.
	const requestedVerse = parseVerseParam(url.search);
	const pendingConnections =
		requestedVerse !== null ? loadConnections(context, bookId, chapter, requestedVerse) : null;

	// An invalid-charset id still opens the overlay in its not-found state
	// (contract: "Invalid/unknown entityId → overlay not-found") — it just
	// never touches Neo4j or KV (B8/B9).
	const rawGraphId = url.searchParams.get("graph");
	const graphId = rawGraphId !== null ? rawGraphId.slice(0, 128) : null;
	const graphIdValid = rawGraphId !== null && GRAPH_ID_RE.test(rawGraphId);
	const graphDepth = clampDepth(url.searchParams.get("depth"));

	// Public collection ids resolve in the critical path (COR-2): the Postgres
	// connection closes via waitUntil once the handler returns, so deferred
	// promises must never touch it. Cheap (5 rows), parallel, graph loads only.
	const [verses, summary, publicCollections] = await Promise.all([
		getVersesByChapter(context.db, bookId, chapter) as Promise<VerseRow[]>,
		getChapterSummary(context.db, bookId, chapter) as Promise<{ description?: string } | null>,
		graphIdValid
			? (getPublicCollectionIds(context.db) as Promise<string[]>).catch(() => undefined)
			: Promise.resolve(undefined),
	]);

	if (verses.length === 0) {
		logEvent("scripture_404", { cause: "empty_chapter", book: bookId, chapter });
		throw new Response(`${bookId} has no chapter ${chapter}.`, { status: 404 });
	}

	// A ?verse that isn't in this chapter is treated as no selection.
	const selectedVerse =
		requestedVerse !== null && verses.some((v) => v.verse_number === requestedVerse)
			? requestedVerse
			: null;
	const connections = selectedVerse !== null ? pendingConnections : null;

	// Streamed like connections; uses only Neo4j + KV, safe after the handler returns.
	const graph: Promise<GraphPanelData> | null =
		graphId === null
			? null
			: graphIdValid
				? loadGraph(context, graphId, graphDepth, publicCollections)
				: Promise.resolve({
						degraded: false,
						neighborhood: GRAPH_NOT_FOUND,
						entityId: graphId,
						depth: graphDepth,
					});

	// "1 Nephi 3:1" → "1 Nephi 3"
	const reference = verses[0].reference.replace(/:\d+$/, "");

	return {
		bookId,
		chapter,
		reference,
		summary: summary?.description ?? null,
		verses: verses.map((v) => ({
			id: v.id,
			verse_number: v.verse_number,
			text: v.text,
			reference: v.reference,
		})),
		selectedVerse,
		connections,
		graphId,
		graphDepth,
		graph,
	};
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: data ? `${data.reference} · Lumen` : "Lumen" }];
}

export default function Scripture({ loaderData }: Route.ComponentProps) {
	const { bookId, chapter, reference, summary, verses, selectedVerse, connections, graphId, graphDepth, graph } =
		loaderData;
	const navigation = useNavigation();
	const navigationType = useNavigationType();
	const navigate = useNavigate();
	const isMobile = useIsMobile();

	const chapterUrl = `/scripture/${bookId}/${chapter}`;

	// Optimistic selection: a same-chapter ?verse navigation moves the highlight
	// and opens the panel skeleton before the server responds. Shares the loader's
	// grammar AND its membership rule, so the optimistic state never disagrees
	// with what the server will decide.
	const navHere =
		navigation.location && navigation.location.pathname === chapterUrl
			? navigation.location
			: null;
	const validVerse = (search: string) => {
		const n = parseVerseParam(search);
		return n !== null && verses.some((v) => v.verse_number === n) ? n : null;
	};
	const activeVerse = navHere ? validVerse(navHere.search) : selectedVerse;
	const isPending = navHere !== null && activeVerse !== selectedVerse;
	const selected =
		activeVerse !== null ? verses.find((v) => v.verse_number === activeVerse) : undefined;

	// Cross-reference jumps record their target here (a ref, not location.state:
	// state persists on history entries and would replay the scroll on back/forward).
	const scrollIntent = useRef<number | null>(null);
	const onCrossRefNavigate = (verse: number) => {
		scrollIntent.current = verse;
	};

	// Replaces the old #vN hash: on a fresh document load or chapter change,
	// bring the selected verse into view (centered, not jammed to the top).
	// Skipped on back/forward — the browser restores its own position — and
	// when a cross-ref jump owns the scroll.
	const chapterKey = `${bookId}/${chapter}`;
	const seenChapter = useRef<string | null>(null);
	useEffect(() => {
		if (seenChapter.current === chapterKey) return;
		const isFirstRender = seenChapter.current === null;
		seenChapter.current = chapterKey;
		if (scrollIntent.current !== null) return;
		if (!isFirstRender && navigationType === "POP") return;
		if (selectedVerse !== null) scrollVerseIntoView(selectedVerse, "auto");
	}, [chapterKey, selectedVerse, navigationType]);

	// Consume the cross-ref scroll intent once its navigation settles.
	useEffect(() => {
		if (navigation.state !== "idle" || scrollIntent.current === null) return;
		if (selectedVerse === scrollIntent.current) {
			scrollVerseIntoView(selectedVerse, "smooth");
		}
		scrollIntent.current = null;
	}, [navigation.state, selectedVerse]);

	// The sheet renders the last selection during its exit animation so it
	// doesn't blank out (and keep its accessible title) while closing.
	const lastSelectedRef = useRef(selected);
	if (selected) lastSelectedRef.current = selected;
	const sheetVerse = selected ?? lastSelectedRef.current;

	// ---- graph overlay wiring ----
	// Optimistic like verse selection: the overlay opens (skeleton) the moment a
	// ?graph navigation starts; recenter/depth changes dim the current graph.
	let pendingGraph: { id: string; depth: 1 | 2 | 3 } | null | undefined;
	if (navHere !== null) {
		const p = new URLSearchParams(navHere.search);
		const g = p.get("graph");
		pendingGraph = g !== null ? { id: g, depth: clampDepth(p.get("depth")) } : null;
	}
	const effectiveGraphId = pendingGraph !== undefined ? (pendingGraph?.id ?? null) : graphId;
	const effectiveDepth = pendingGraph !== undefined ? (pendingGraph?.depth ?? 1) : graphDepth;
	const graphNavPending =
		pendingGraph !== undefined &&
		(pendingGraph?.id !== graphId || (pendingGraph !== null && pendingGraph.depth !== graphDepth));

	const graphUrl = (id: string, depth: 1 | 2 | 3) => {
		const q = new URLSearchParams();
		if (selectedVerse !== null) q.set("verse", String(selectedVerse));
		q.set("graph", id);
		q.set("depth", String(depth));
		return `${chapterUrl}?${q.toString()}`;
	};
	// Focus returns to whichever control opened the overlay (B16/UX-10).
	const graphInvoker = useRef<HTMLElement | null>(null);
	const openGraph = (id: string, depth: 1 | 2 | 3 = 1) => {
		if (document.activeElement instanceof HTMLElement && graphInvoker.current === null) {
			graphInvoker.current = document.activeElement;
		}
		navigate(graphUrl(id, depth), { preventScrollReset: true });
	};
	const closeGraph = () => {
		navigate(selectedVerse !== null ? `${chapterUrl}?verse=${selectedVerse}` : chapterUrl, {
			preventScrollReset: true,
		});
		// consumed by the overlay's onCloseAutoFocus; reset for the next open
		queueMicrotask(() => {
			graphInvoker.current = null;
		});
	};
	const readVerse = (t: { book: string; chapter: number; verse: number }) => {
		scrollIntent.current = t.verse;
		navigate(`/scripture/${t.book}/${t.chapter}?verse=${t.verse}`, { preventScrollReset: true });
	};

	const panelFor = (verse: VerseRow) => (
		<PanelBody
			verseText={verse.text}
			isPending={isPending}
			connections={connections}
			onCrossRefNavigate={onCrossRefNavigate}
			onOpenGraph={openGraph}
		/>
	);

	const graphButton = (entityId: string, label: string) => (
		<button
			type="button"
			onClick={() => openGraph(entityId)}
			aria-label={label}
			className="inline-flex items-center gap-1 rounded-md border border-rule2 px-2 py-1 font-ui text-[10px] font-bold uppercase tracking-wide text-muted-foreground transition-colors duration-150 hover:border-primary hover:text-primary"
		>
			<WaypointsIcon className="size-3.5" aria-hidden="true" />
			Graph
		</button>
	);

	return (
		<div className="mx-auto max-w-6xl px-6 py-10">
			<header className="border-b border-rule pb-5">
				<p className="font-ui text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">
					<Link to="/" className="hover:text-ink">
						Lumen
					</Link>
				</p>
				<div className="mt-2 flex items-center gap-3">
					<h1 className="font-display text-3xl font-medium tracking-tight">{reference}</h1>
					{/* the summary node is the semantically rich chapter center: it FEATURES
					    principles/people/places and COVERS the verses (bare chapter nodes
					    carry only structural CONTAINS edges) */}
					{graphButton(`summary-${bookId}-${chapter}`, `Open the local graph for ${reference}`)}
				</div>
				<nav
					aria-label="Chapter navigation"
					className="mt-3 flex gap-3 font-ui text-sm font-semibold text-primary"
				>
					{chapter > 1 && (
						<Link to={`/scripture/${bookId}/${chapter - 1}`} className="hover:underline">
							← Chapter {chapter - 1}
						</Link>
					)}
					<Link to={`/scripture/${bookId}/${chapter + 1}`} className="hover:underline">
						Chapter {chapter + 1} →
					</Link>
					<Link to={`/scripture/${bookId}`} className="text-muted-foreground hover:underline">
						All chapters
					</Link>
				</nav>
			</header>

			<div className="mt-8 gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_380px]">
				<main>
					{summary && (
						<section
							aria-label="Chapter summary"
							className="mb-8 rounded-lg border border-rule2 bg-panel p-5"
						>
							<h2 className="font-ui text-[10.5px] font-bold uppercase tracking-[0.14em] text-faint">
								Chapter summary
							</h2>
							<p className="mt-2 max-w-prose font-reading text-[15px] leading-relaxed text-ink">
								{summary}
							</p>
						</section>
					)}

					<ol className="max-w-prose list-none">
						{verses.map((verse) => {
							const isActive = verse.verse_number === activeVerse;
							return (
								<li key={verse.id} id={`v${verse.verse_number}`}>
									<Link
										to={isActive ? chapterUrl : `${chapterUrl}?verse=${verse.verse_number}`}
										preventScrollReset
										aria-current={isActive ? "true" : undefined}
										className={`relative block rounded-lg py-2 pl-14 pr-4 font-reading text-[19px] leading-relaxed text-ink transition-colors duration-150 hover:bg-selbar/10 ${
											isActive ? "bg-sel" : ""
										}`}
									>
										<span
											className={`absolute left-4 top-3 w-7 text-right font-ui text-xs font-semibold transition-colors duration-150 ${
												isActive ? "text-selbar" : "text-faint"
											}`}
										>
											{verse.verse_number}
										</span>
										{verse.text}
									</Link>
								</li>
							);
						})}
					</ol>
				</main>

				{/* Desktop rail — always mounted (on desktop) so selecting a verse never
				    reflows the text column. Unmounted on mobile after hydration so the
				    panel isn't reconciled twice; the CSS classes keep it hidden on
				    mobile before hydration. */}
				{!isMobile && (
					<section
						aria-label="Verse connections"
						className="hidden h-fit rounded-xl border border-rule bg-panel p-5 lg:sticky lg:top-6 lg:block lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto"
					>
						{selected ? (
							<>
								<div className="flex items-baseline justify-between gap-3">
									<h2 className="font-display text-xl font-medium">{selected.reference}</h2>
									<span className="flex items-center gap-2">
										{graphButton(selected.id, `Open the local graph for ${selected.reference}`)}
										<Link
											to={chapterUrl}
											preventScrollReset
											aria-label="Close verse panel"
											className="-m-2 p-2 text-muted-foreground transition-colors duration-150 hover:text-ink"
										>
											<XIcon className="size-4" aria-hidden="true" />
										</Link>
									</span>
								</div>
								{panelFor(selected)}
							</>
						) : (
							<p className="font-reading text-sm italic leading-relaxed text-faint">
								Select a verse to see the principles it teaches, the people it mentions, and its
								cross-references.
							</p>
						)}
					</section>
				)}
			</div>

			{/* Mobile — the rail becomes a bottom sheet so connections are reachable without
			    scrolling past the chapter. Mounted conditionally (not hidden with CSS): the
			    sheet portals to <body>, so a `lg:hidden` wrapper wouldn't contain it and the
			    modal would open on desktop too, blocking the page behind its overlay. */}
			{isMobile && (
				<Sheet
					// mutually exclusive with the graph overlay (UX-1): one dialog, one Esc target
					open={selected !== undefined && effectiveGraphId === null}
					onOpenChange={(open) => {
						if (!open) navigate(chapterUrl, { preventScrollReset: true });
					}}
				>
					<SheetContent
						side="bottom"
						className="max-h-[75dvh] overflow-y-auto rounded-t-2xl border-rule bg-panel p-5 pb-8"
					>
						{sheetVerse && (
							<>
								<SheetHeader className="p-0 text-left">
									<SheetTitle className="font-display text-xl font-medium text-ink">
										{sheetVerse.reference}
									</SheetTitle>
									<SheetDescription className="sr-only">
										Connections for {sheetVerse.reference}
									</SheetDescription>
									<div>{graphButton(sheetVerse.id, `Open the local graph for ${sheetVerse.reference}`)}</div>
								</SheetHeader>
								{panelFor(sheetVerse)}
							</>
						)}
					</SheetContent>
				</Sheet>
			)}

			{effectiveGraphId !== null && (
				<Suspense fallback={null}>
					<GraphOverlay
						entityId={effectiveGraphId}
						depth={effectiveDepth}
						graph={graph ?? PENDING_FOREVER}
						isPending={graphNavPending}
						invoker={graphInvoker}
						onNavigate={openGraph}
						onClose={closeGraph}
						onReadVerse={readVerse}
					/>
				</Suspense>
			)}
		</div>
	);
}

function scrollVerseIntoView(verseNumber: number, behavior: ScrollBehavior) {
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	document.getElementById(`v${verseNumber}`)?.scrollIntoView({
		block: "center",
		behavior: reduced ? "auto" : behavior,
	});
}

function PanelBody({
	verseText,
	isPending,
	connections,
	onCrossRefNavigate,
	onOpenGraph,
}: {
	verseText: string;
	isPending: boolean;
	connections: Promise<VersePanelData> | null;
	onCrossRefNavigate: (verse: number) => void;
	onOpenGraph: (entityId: string) => void;
}) {
	return (
		<>
			<blockquote className="mt-3 border-l-2 border-rule2 pl-3 font-reading text-sm italic leading-relaxed text-muted-foreground">
				{verseText}
			</blockquote>
			{isPending || connections === null ? (
				<ConnectionsSkeleton />
			) : (
				<Suspense fallback={<ConnectionsSkeleton />}>
					{/* errorElement: the server maps failures to {degraded:true}, but the
					    stream itself can still reject client-side — turbo-stream aborts
					    (server streamTimeout) and navigations cancelling in-flight deferred
					    data. Without it those rejections would take down the whole page. */}
					<Await resolve={connections} errorElement={<DegradedNotice />}>
						{(panel) => (
							<Connections panel={panel} onCrossRefNavigate={onCrossRefNavigate} onOpenGraph={onOpenGraph} />
						)}
					</Await>
				</Suspense>
			)}
		</>
	);
}

function DegradedNotice() {
	return (
		<p className="mt-5 font-reading text-sm italic text-muted-foreground">
			Graph features are unavailable right now — connections for this verse couldn't be loaded.
			The chapter text is unaffected.
		</p>
	);
}

function ConnectionsSkeleton() {
	return (
		<div aria-busy="true">
			<span className="sr-only">Loading connections…</span>
			<div className="mt-5 space-y-5" aria-hidden="true">
				<div>
					<Skeleton className="h-3 w-24" />
					<div className="mt-2 flex gap-1.5">
						<Skeleton className="h-7 w-24 rounded-md" />
						<Skeleton className="h-7 w-16 rounded-md" />
						<Skeleton className="h-7 w-20 rounded-md" />
					</div>
				</div>
				<div>
					<Skeleton className="h-3 w-16" />
					<div className="mt-2 space-y-2">
						<Skeleton className="h-20 w-full rounded-lg" />
						<Skeleton className="h-20 w-full rounded-lg" />
					</div>
				</div>
				<div>
					<Skeleton className="h-3 w-20" />
					<div className="mt-2 space-y-2">
						<Skeleton className="h-20 w-full rounded-lg" />
					</div>
				</div>
			</div>
		</div>
	);
}

function Connections({
	panel,
	onCrossRefNavigate,
	onOpenGraph,
}: {
	panel: VersePanelData;
	onCrossRefNavigate: (verse: number) => void;
	onOpenGraph: (entityId: string) => void;
}) {
	if (panel.degraded) return <DegradedNotice />;

	const cites = panel.crossRefs.filter((x) => x.direction === "outgoing");
	const citedBy = panel.crossRefs.filter((x) => x.direction === "incoming");
	const isEmpty =
		cites.length === 0 &&
		citedBy.length === 0 &&
		panel.principles.length === 0 &&
		panel.people.length === 0;

	return (
		<div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200 motion-safe:ease-out">
			<EntityChips title="Principles" accent="text-selbar" edge="border-l-selbar" chips={panel.principles} onSelect={onOpenGraph} />
			<EntityChips title="People" accent="text-people" edge="border-l-people" chips={panel.people} onSelect={onOpenGraph} />
			<CrossRefGroup title="Cites" accent="text-cites" refs={cites} onNavigate={onCrossRefNavigate} />
			<CrossRefGroup
				title="Cited by"
				accent="text-citedby"
				refs={citedBy}
				onNavigate={onCrossRefNavigate}
			/>
			{isEmpty && (
				<p className="mt-5 font-reading text-sm italic text-faint">
					No connections recorded for this verse.
				</p>
			)}
		</div>
	);
}

function EntityChips({
	title,
	accent,
	edge,
	chips,
	onSelect,
}: {
	title: string;
	accent: string;
	edge: string;
	chips: VerseEntityRef[];
	onSelect: (entityId: string) => void;
}) {
	if (chips.length === 0) return null;
	return (
		<div className="mt-5">
			<h3 className={`font-ui text-[10px] font-bold uppercase tracking-[0.14em] ${accent}`}>
				{title} · {chips.length}
			</h3>
			<ul className="mt-2 flex flex-wrap gap-1.5">
				{chips.map((c) => (
					<li key={c.id}>
						<button
							type="button"
							onClick={() => onSelect(c.id)}
							title={`Open the local graph for ${c.name}`}
							className={`rounded-md border border-rule2 border-l-[3px] ${edge} bg-white px-2.5 py-1 font-ui text-xs font-semibold text-ink transition-colors duration-150 hover:bg-sel`}
						>
							{c.name}
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

const SOURCE_LABELS: Record<string, string> = {
	"lds-doc-project": "LDS Documentation Project",
	"1867-jst": "1867 JST",
	"anthropic-batch": "AI-suggested",
	strongs: "Strong's Concordance",
	naves: "Nave's Topical Bible",
};

function sourceLabel(source: string | null | undefined): string {
	if (!source) return "Unattributed";
	return (
		SOURCE_LABELS[source] ?? source.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
	);
}

/** "1-ne-3-7" → link target, via the package's own verse-id grammar (bad ids → null → unlinked card). */
function verseIdToTarget(verseId: string): { href: string; verse: number } | null {
	const parsed = parseReference(verseId);
	if (parsed.level !== "verse" || !parsed.bookId || !parsed.chapter || !parsed.verse) return null;
	return {
		href: `/scripture/${parsed.bookId}/${parsed.chapter}?verse=${parsed.verse}`,
		verse: parsed.verse,
	};
}

function CrossRefGroup({
	title,
	accent,
	refs,
	onNavigate,
}: {
	title: string;
	accent: string;
	refs: CrossReference[];
	onNavigate: (verse: number) => void;
}) {
	if (refs.length === 0) return null;
	return (
		<div className="mt-5">
			<h3 className={`font-ui text-[10px] font-bold uppercase tracking-[0.14em] ${accent}`}>
				{title} · {refs.length}
			</h3>
			<ul className="mt-2 space-y-2">
				{refs.map((x) => {
					const target = verseIdToTarget(x.verse_id);
					const body = (
						<>
							<p className="font-ui text-xs font-semibold text-ink">{x.reference}</p>
							<p className="mt-1 line-clamp-3 font-reading text-[13px] leading-snug text-muted-foreground">
								{x.text}
							</p>
							<p className="mt-1.5 font-ui text-[9px] font-bold uppercase tracking-wide text-faint">
								{sourceLabel(x.source)}
							</p>
						</>
					);
					return (
						<li key={`${x.direction}-${x.verse_id}`}>
							{target ? (
								<Link
									to={target.href}
									preventScrollReset
									onClick={() => onNavigate(target.verse)}
									className="block rounded-lg border border-rule2 bg-white p-3 transition-[border-color,transform] duration-150 ease-out hover:-translate-y-px hover:border-primary motion-reduce:transition-none motion-reduce:hover:translate-y-0"
								>
									{body}
								</Link>
							) : (
								<div className="rounded-lg border border-rule2 bg-white p-3">{body}</div>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	const is404 = isRouteErrorResponse(error) && error.status === 404;
	const detail =
		isRouteErrorResponse(error) && typeof error.data === "string" && error.data
			? error.data
			: "Something went wrong loading this chapter.";
	return (
		<main className="mx-auto max-w-2xl px-6 py-16">
			<h1 className="font-display text-3xl font-medium">{is404 ? "Not found" : "Error"}</h1>
			<p className="mt-3 font-reading text-muted-foreground">{detail}</p>
			<p className="mt-6">
				<a href="/" className="font-ui text-sm font-semibold text-primary underline">
					← Back to the library
				</a>
			</p>
		</main>
	);
}
