import { Suspense, lazy, useEffect, useRef } from "react";
import {
	Await,
	Link,
	isRouteErrorResponse,
	useNavigate,
	useNavigation,
	useNavigationType,
} from "react-router";
import { ArrowLeftIcon, WaypointsIcon, XIcon } from "lucide-react";
import {
	parseReference,
	buildVerseId,
	getVersesByChapter,
	getChapterSummary,
	getVerseConnections,
	getNeighborhood,
	getPublicCollectionIds,
	getChapterArt,
	getChapterNumbers,
	chapterUnit,
	getCrossReferences,
	groupCrossRefs,
	BIBLE_BOOK_IDS,
	type CrossRefCard,
	type NeighborhoodResult,
	type VerseConnectionsResult,
	type VerseEntityRef,
} from "@lumen/scripture";
import { Skeleton } from "~/components/ui/skeleton";
import {
	Accordion,
	AccordionItem,
	AccordionTrigger,
	AccordionContent,
} from "~/components/ui/accordion";
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

interface ArtRef {
	book_id: string;
	chapter: number;
	verse_start: number | null;
	verse_end: number | null;
	is_primary?: boolean;
}

export interface ArtItem {
	id: string;
	title: string;
	artist: string | null;
	year: number | null;
	thumb: string | null;
	image: string;
	sourceUrl: string;
	refs: ArtRef[];
}

interface ArtworkRow {
	id: string;
	name: string;
	metadata: {
		artist_name?: string;
		year?: number | null;
		thumbnail_800_url?: string | null;
		image_url?: string;
		source_url?: string;
		refs?: ArtRef[];
	};
}

function toArtItem(row: ArtworkRow): ArtItem {
	return {
		id: row.id,
		title: row.name,
		artist: row.metadata.artist_name ?? null,
		year: row.metadata.year ?? null,
		thumb: row.metadata.thumbnail_800_url ?? null,
		image: row.metadata.image_url ?? "",
		sourceUrl: row.metadata.source_url ?? "",
		refs: row.metadata.refs ?? [],
	};
}

/** Resolved shape of the streamed panel promise — degradation is a value, not a rejection.
 * Cross-references left this payload for the critical path (Postgres) with the
 * OpenBible swap; only the Neo4j-backed entity chips still stream. */
type VersePanelData =
	| {
			degraded: false;
			principles: VerseEntityRef[];
			people: VerseEntityRef[];
	  }
	| { degraded: true };

/** Critical-path cross-references (OpenBible for Bible verses, curated
 * fallback for BoM/D&C/PGP). Degradation is a value — never throws (COR-6). */
interface CrossRefsPanel {
	degraded: boolean;
	cards: CrossRefCard[];
	totals: { outgoing: number; incoming: number };
	/** true when served from the curated fallback collection (chip + copy differ) */
	curated: boolean;
}

const LEGACY_CROSSREF_COLLECTION = "phase-b";

/** book id of a verse id: "ether-12-27" → "ether" */
const bookOfVerseId = (verseId: string) => verseId.replace(/-\d+-\d+$/, "");

async function loadCrossRefs(
	db: Route.LoaderArgs["context"]["db"],
	bookId: string,
	chapter: number,
	verse: number,
): Promise<CrossRefsPanel> {
	const verseId = buildVerseId(bookId, chapter, verse);
	const curated = !BIBLE_BOOK_IDS.has(bookId);
	const startedAt = Date.now();
	try {
		if (curated) {
			// BoM/D&C/PGP: the curated collection is the only verse↔verse source
			const { refs, totals } = await getCrossReferences(db, verseId, {
				collectionId: LEGACY_CROSSREF_COLLECTION,
				limitPerDirection: 200,
			});
			return { degraded: false, cards: groupCrossRefs(refs), totals, curated };
		}

		// Bible verses: OpenBible plus curated CROSS-CANON links (Abram's call —
		// the old Neo4j panel had no collection filter, so Bible↔BoM bridges like
		// 1 Cor 1:27 → Ether 12:27 were visible; keep them, drop the curated
		// set's noisy Bible↔Bible refs that OpenBible replaces).
		// generous limit: the accordion shows everything on expand ("see all");
		// worst hub-verse fan-out in the corpus is ~2k rows, typical <150
		const [openbible, legacy] = await Promise.all([
			getCrossReferences(db, verseId, { collectionId: "openbible", limitPerDirection: 200 }),
			getCrossReferences(db, verseId, { collectionId: LEGACY_CROSSREF_COLLECTION, limitPerDirection: 200 }),
		]);
		const crossCanon = legacy.refs.filter((r) => !BIBLE_BOOK_IDS.has(bookOfVerseId(r.verse_id)));
		const cards = groupCrossRefs([...openbible.refs, ...crossCanon]);
		const totals = {
			outgoing: openbible.totals.outgoing + crossCanon.filter((r) => r.direction === "outgoing").length,
			incoming: openbible.totals.incoming + crossCanon.filter((r) => r.direction === "incoming").length,
		};
		if (cards.length === 0) {
			// a Bible verse with zero refs is rare — distinguishable from a bug (OBS-7)
			logEvent("crossref_empty", { verse: verseId });
		}
		return { degraded: false, cards, totals, curated };
	} catch (error) {
		logEvent("crossref_degraded", {
			name: error instanceof Error ? error.name : "unknown",
			message: error instanceof Error ? error.message : String(error),
			book: bookId,
			chapter,
			verse,
			elapsedMs: Date.now() - startedAt,
		});
		return { degraded: true, cards: [], totals: { outgoing: 0, incoming: 0 }, curated };
	}
}

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
		// v2: payload shape changed when cross-references moved to Postgres.
		// Orphaned v1 entries self-evict via the TTL — no purge step (API-6).
		const result = await cachedJson<VerseConnectionsResult>(
			context.cache,
			`vconn:v2:${verseId}`,
			CONNECTIONS_TTL_SECONDS,
			() => getVerseConnections(context.neo4j, verseId),
		);
		return {
			degraded: false,
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
	const [verses, summary, publicCollections, artRows, chapterRows, crossRefsRaw] = await Promise.all([
		getVersesByChapter(context.db, bookId, chapter) as Promise<VerseRow[]>,
		getChapterSummary(context.db, bookId, chapter) as Promise<{ description?: string } | null>,
		graphIdValid
			? (getPublicCollectionIds(context.db) as Promise<string[]>).catch(() => undefined)
			: Promise.resolve(undefined),
		// art is an enhancement — its failure must never break the chapter
		(getChapterArt(context.db, bookId, chapter) as Promise<ArtworkRow[]>).catch(
			() => [] as ArtworkRow[],
		),
		// real prev/next bounds (FM-10), folded into the same round-trip window (PERF-2);
		// on failure fall back to "next exists" so navigation is never over-restricted
		(getChapterNumbers(context.db, bookId) as Promise<{ chapter_number: number }[]>).catch(
			() => [] as { chapter_number: number }[],
		),
		// cross-references share the same parallel window (PERF-1: added
		// wall-clock ≈ 0) and MUST stay in the critical path — the PG
		// connection is gone once the handler returns (COR-2). Never throws.
		requestedVerse !== null
			? loadCrossRefs(context.db, bookId, chapter, requestedVerse)
			: Promise.resolve(null),
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
	const crossRefs = selectedVerse !== null ? crossRefsRaw : null;

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
		crossRefs,
		graphId,
		graphDepth,
		graph,
		art: (artRows ?? []).map(toArtItem),
		maxChapter: chapterRows.length > 0 ? Math.max(...chapterRows.map((c) => c.chapter_number)) : null,
	};
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: data ? `${data.reference} · Lumen` : "Lumen" }];
}

export default function Scripture({ loaderData }: Route.ComponentProps) {
	const { bookId, chapter, reference, summary, verses, selectedVerse, connections, crossRefs, graphId, graphDepth, graph, art, maxChapter } =
		loaderData;
	const unit = chapterUnit(bookId);
	const navigation = useNavigation();
	const navigationType = useNavigationType();
	const navigate = useNavigate();
	const isMobile = useIsMobile();

	const chapterUrl = `/scripture/${bookId}/${chapter}`;
	// "1 Nephi 3" → "1 Nephi" for the breadcrumb link
	const bookName = reference.replace(/\s+\d+$/, "");
	// History back when there is history; otherwise up to the chapter grid.
	const goBack = () => {
		if (typeof window !== "undefined" && ((window.history.state?.idx as number) ?? 0) > 0) {
			navigate(-1);
		} else {
			navigate(`/scripture/${bookId}`);
		}
	};

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

	// Verse-anchored artworks for the selected verse (chapter-level refs stay in the strip)
	const verseArt =
		activeVerse === null
			? []
			: art.filter((a) =>
					a.refs.some(
						(r) =>
							r.book_id === bookId &&
							r.chapter === chapter &&
							r.verse_start !== null &&
							activeVerse >= r.verse_start &&
							activeVerse <= (r.verse_end ?? r.verse_start),
					),
				);

	const panelFor = (verse: VerseRow) => (
		<PanelBody
			verseText={verse.text}
			isPending={isPending}
			connections={connections}
			crossRefs={crossRefs}
			art={verseArt}
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
					<button
						type="button"
						onClick={goBack}
						aria-label="Back"
						className="-m-2 p-2 text-muted-foreground transition-colors duration-150 hover:text-ink"
					>
						<ArrowLeftIcon className="size-5" aria-hidden="true" />
					</button>
					<h1 className="font-display text-3xl font-medium tracking-tight">
						{/* the book name doubles as a breadcrumb to the chapter grid */}
						<Link
							to={`/scripture/${bookId}`}
							className="underline-offset-4 hover:underline hover:decoration-rule2"
						>
							{bookName}
						</Link>{" "}
						{chapter}
					</h1>
					{/* the summary node is the semantically rich chapter center: it FEATURES
					    principles/people/places and COVERS the verses (bare chapter nodes
					    carry only structural CONTAINS edges) */}
					{graphButton(`summary-${bookId}-${chapter}`, `Open the local graph for ${reference}`)}
				</div>
				<nav
					aria-label={`${unit} navigation`}
					className="mt-3 flex gap-3 font-ui text-sm font-semibold text-primary"
				>
					{chapter > 1 && (
						<Link to={`/scripture/${bookId}/${chapter - 1}`} className="hover:underline">
							← {unit} {chapter - 1}
						</Link>
					)}
					{(maxChapter === null || chapter < maxChapter) && (
						<Link to={`/scripture/${bookId}/${chapter + 1}`} className="hover:underline">
							{unit} {chapter + 1} →
						</Link>
					)}
				</nav>
			</header>

			<ChapterArtStrip art={art} />

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

function ChapterArtStrip({ art }: { art: ArtItem[] }) {
	if (art.length === 0) return null;
	return (
		<section aria-label="Artwork for this chapter" className="mt-6">
			<ul className="flex list-none gap-4 overflow-x-auto pb-2">
				{art.slice(0, 12).map((a) => (
					<li key={a.id} className="w-56 shrink-0">
						<a
							href={a.sourceUrl || a.image}
							target="_blank"
							rel="noreferrer"
							className="group block"
						>
							<ArtImage art={a} className="h-36 w-full rounded-lg border border-rule2 object-cover" />
							<p className="mt-1.5 truncate font-ui text-xs font-semibold text-ink group-hover:text-primary">
								{a.title}
							</p>
							<p className="truncate font-ui text-[10px] text-muted-foreground">
								{[a.artist, a.year].filter(Boolean).join(" · ")}
							</p>
						</a>
					</li>
				))}
			</ul>
		</section>
	);
}

/** Thumbnail with full-image fallback — the 800px thumbs live on a third-party bucket. */
function ArtImage({ art, className }: { art: ArtItem; className: string }) {
	return (
		<img
			src={art.thumb ?? art.image}
			alt={`${art.title}${art.artist ? ` — ${art.artist}` : ""}`}
			loading="lazy"
			className={className}
			onError={(e) => {
				const img = e.currentTarget;
				if (art.thumb && img.src !== art.image && art.image) img.src = art.image;
			}}
		/>
	);
}

function PanelBody({
	verseText,
	isPending,
	connections,
	crossRefs,
	art,
	onCrossRefNavigate,
	onOpenGraph,
}: {
	verseText: string;
	isPending: boolean;
	connections: Promise<VersePanelData> | null;
	crossRefs: CrossRefsPanel | null;
	art: ArtItem[];
	onCrossRefNavigate: (verse: number) => void;
	onOpenGraph: (entityId: string) => void;
}) {
	return (
		<>
			<blockquote className="mt-3 border-l-2 border-rule2 pl-3 font-reading text-sm italic leading-relaxed text-muted-foreground">
				{verseText}
			</blockquote>
			{art.length > 0 && (
				<div className="mt-4">
					<h3 className="font-ui text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
						Art · {art.length}
					</h3>
					<ul className="mt-2 flex list-none gap-2 overflow-x-auto">
						{art.slice(0, 6).map((a) => (
							<li key={a.id} className="shrink-0">
								<a href={a.sourceUrl || a.image} target="_blank" rel="noreferrer" title={`${a.title}${a.artist ? ` — ${a.artist}` : ""}`}>
									<ArtImage art={a} className="h-20 w-28 rounded-md border border-rule2 object-cover" />
								</a>
							</li>
						))}
					</ul>
				</div>
			)}
			{/* Panel order (Abram's call): principles/people first, citations below.
			    The streamed chips block keeps a reserved-shape skeleton so its
			    resolve nudges the accordion headers below as little as possible;
			    the accordion defaults collapsed, so the whole detail view stays
			    scannable and citations expand to the full list on demand. */}
			{isPending || connections === null ? (
				<EntityChipsSkeleton />
			) : (
				<Suspense fallback={<EntityChipsSkeleton />}>
					{/* errorElement: the server maps failures to {degraded:true}, but the
					    stream itself can still reject client-side — turbo-stream aborts
					    (server streamTimeout) and navigations cancelling in-flight deferred
					    data. Without it those rejections would take down the whole page. */}
					<Await resolve={connections} errorElement={<DegradedNotice />}>
						{(panel) => <Connections panel={panel} onOpenGraph={onOpenGraph} />}
					</Await>
				</Suspense>
			)}
			{isPending || crossRefs === null ? (
				<CrossRefsSkeleton />
			) : (
				<CrossRefsSection panel={crossRefs} onNavigate={onCrossRefNavigate} />
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

/** Skeleton for the synchronous cross-ref block (only shown while a same-chapter
 * verse navigation is pending — the data itself arrives with the loader).
 * Shaped like the median real output — two titled groups of cards — so the
 * pending→resolved swap moves layout as little as possible (CUX-2). */
function CrossRefsSkeleton() {
	return (
		<div aria-busy="true">
			<span className="sr-only">Loading cross-references…</span>
			<div className="mt-5 space-y-5" aria-hidden="true">
				<div>
					<Skeleton className="h-3 w-28" />
					<div className="mt-2 space-y-2">
						<Skeleton className="h-20 w-full rounded-lg" />
						<Skeleton className="h-20 w-full rounded-lg" />
						<Skeleton className="h-20 w-full rounded-lg" />
					</div>
				</div>
				<div>
					<Skeleton className="h-3 w-24" />
					<div className="mt-2 space-y-2">
						<Skeleton className="h-20 w-full rounded-lg" />
						<Skeleton className="h-20 w-full rounded-lg" />
					</div>
				</div>
			</div>
		</div>
	);
}

/** aria-busy scopes to ONLY the still-streaming entity block (A11Y-2) —
 * the already-rendered cross-ref cards above are never inside a busy region. */
function EntityChipsSkeleton() {
	return (
		<div aria-busy="true">
			<span className="sr-only">Loading principles and people…</span>
			<div className="mt-5 space-y-5" aria-hidden="true">
				<div>
					<Skeleton className="h-3 w-24" />
					<div className="mt-2 flex gap-1.5">
						<Skeleton className="h-7 w-24 rounded-md" />
						<Skeleton className="h-7 w-16 rounded-md" />
						<Skeleton className="h-7 w-20 rounded-md" />
					</div>
				</div>
			</div>
		</div>
	);
}

function CrossRefsSection({
	panel,
	onNavigate,
}: {
	panel: CrossRefsPanel;
	onNavigate: (verse: number) => void;
}) {
	if (panel.degraded) {
		return (
			<p className="mt-5 font-reading text-sm italic text-muted-foreground">
				Cross-references couldn't be loaded right now. The chapter text is unaffected.
			</p>
		);
	}
	const references = panel.cards.filter((c) => c.direction === "outgoing");
	const referencedBy = panel.cards.filter((c) => c.direction === "incoming");

	if (references.length === 0 && referencedBy.length === 0) {
		// differentiated empty states (UX-5): a Bible verse without OpenBible
		// refs is rare; an uncurated BoM/D&C verse is expected
		return (
			<p className="mt-5 font-reading text-sm italic text-faint">
				{panel.curated
					? "Cross-references are not yet curated for this volume."
					: "No cross-references found for this verse."}
			</p>
		);
	}

	const credit = !panel.curated && (
		<p className="mt-1.5 font-ui text-[10px] text-faint">
			Cross-references:{" "}
			<a
				href="https://www.openbible.info/labs/cross-references/"
				target="_blank"
				rel="noreferrer"
				className="underline hover:text-ink"
			>
				openbible.info
			</a>{" "}
			(
			<a
				href="https://creativecommons.org/licenses/by/4.0/"
				target="_blank"
				rel="noreferrer"
				className="underline hover:text-ink"
			>
				CC BY 4.0
			</a>
			, adapted — ranges expanded)
		</p>
	);

	return (
		<Accordion type="multiple" className="mt-5">
			<CrossRefAccordionItem
				value="references"
				title="References"
				accent="text-cites"
				cards={references}
				total={panel.totals.outgoing}
				curated={panel.curated}
				onNavigate={onNavigate}
				credit={credit}
			/>
			<CrossRefAccordionItem
				value="referenced-by"
				title="Referenced by"
				accent="text-citedby"
				cards={referencedBy}
				total={panel.totals.incoming}
				curated={panel.curated}
				onNavigate={onNavigate}
				credit={references.length === 0 ? credit : null}
			/>
		</Accordion>
	);
}

function Connections({
	panel,
	onOpenGraph,
}: {
	panel: VersePanelData;
	onOpenGraph: (entityId: string) => void;
}) {
	if (panel.degraded) return <DegradedNotice />;
	if (panel.principles.length === 0 && panel.people.length === 0) return null;

	return (
		// the live region belongs HERE — this is the block that arrives late
		// (streamed via Await); the cross-ref cards above render synchronously (CUX-1)
		<div
			aria-live="polite"
			className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200 motion-safe:ease-out"
		>
			<EntityChips title="Principles" accent="text-selbar" edge="border-l-selbar" chips={panel.principles} onSelect={onOpenGraph} />
			<EntityChips title="People" accent="text-people" edge="border-l-people" chips={panel.people} onSelect={onOpenGraph} />
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
							className={`rounded-md border border-rule2 border-l-[3px] ${edge} bg-surface px-2.5 py-1 font-ui text-xs font-semibold text-ink transition-colors duration-150 hover:bg-sel`}
						>
							{c.name}
						</button>
					</li>
				))}
			</ul>
		</div>
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

const CURATED_SOURCE_LABELS: Record<string, string> = {
	"anthropic-batch": "AI-suggested",
	curated: "Curated",
	"lds-doc-project": "LDS Documentation Project",
};

function CrossRefAccordionItem({
	value,
	title,
	accent,
	cards,
	total,
	curated,
	onNavigate,
	credit,
}: {
	value: string;
	title: string;
	accent: string;
	cards: CrossRefCard[];
	total: number;
	curated: boolean;
	onNavigate: (verse: number) => void;
	credit?: React.ReactNode;
}) {
	if (cards.length === 0) return null;
	// Truncation is disclosed, not silent (UX-2/A11Y-1) — but only when rows
	// were actually cut by the limit: the SQL total counts pre-dedup rows, so
	// "N of M" with untruncated cards would misread duplicates as hidden refs.
	const truncated = cards.length >= 200 && total > cards.length;
	const count = truncated ? `${cards.length} of ${total}` : `${cards.length}`;
	return (
		<AccordionItem value={value} className="border-rule2">
			<AccordionTrigger className="py-3 hover:no-underline">
				<span className={`flex items-baseline gap-2 font-ui text-[10px] font-bold uppercase tracking-[0.14em] ${accent}`}>
					<span>
						{title} · {count}
					</span>
					{curated && (
						// real visible text at 12px, not a decorative micro-label (A11Y-4);
						// "Curated", never "legacy" (UX-4)
						<span className="rounded border border-rule2 px-1.5 py-0.5 font-ui text-xs font-medium normal-case tracking-normal text-muted-foreground">
							Curated
						</span>
					)}
				</span>
			</AccordionTrigger>
			<AccordionContent>
			{/* CC-BY credit under the References header, per amendment 10 */}
			{credit}
			<ul className="mt-1 space-y-2">
				{cards.map((x) => {
					const target = verseIdToTarget(x.verse_id);
					// provenance stays visible on curated-source cards (the old
					// panel distinguished AI-suggested from human-curated; keep that
					// trust signal on the merged cross-canon cards too)
					const showSource = x.source !== null && x.source !== "openbible";
					const body = (
						<>
							{/* label carries the full range ("Psalm 148:4–5") — also the accessible name (A11Y-3) */}
							<p className="font-ui text-xs font-semibold text-ink">{x.label}</p>
							<p className="mt-1 line-clamp-3 font-reading text-[13px] leading-snug text-muted-foreground">
								{x.text}
							</p>
							{showSource && (
								<p className="mt-1.5 font-ui text-[10px] font-semibold uppercase tracking-wide text-faint">
									{CURATED_SOURCE_LABELS[x.source!] ?? x.source}
								</p>
							)}
						</>
					);
					return (
						<li key={`${x.direction}-${x.verse_id}`}>
							{target ? (
								<Link
									to={target.href}
									preventScrollReset
									onClick={() => onNavigate(target.verse)}
									className="block rounded-lg border border-rule2 bg-surface p-3 transition-[border-color,transform] duration-150 ease-out hover:-translate-y-px hover:border-primary motion-reduce:transition-none motion-reduce:hover:translate-y-0"
								>
									{body}
								</Link>
							) : (
								<div className="rounded-lg border border-rule2 bg-surface p-3">{body}</div>
							)}
						</li>
					);
				})}
			</ul>
			</AccordionContent>
		</AccordionItem>
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
