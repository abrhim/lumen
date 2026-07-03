import { Suspense, useEffect, useRef } from "react";
import {
	Await,
	Link,
	isRouteErrorResponse,
	useNavigate,
	useNavigation,
	useNavigationType,
} from "react-router";
import { XIcon } from "lucide-react";
import {
	parseReference,
	buildVerseId,
	getVersesByChapter,
	getChapterSummary,
	getVerseConnections,
	type CrossReference,
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

	const [verses, summary] = await Promise.all([
		getVersesByChapter(context.db, bookId, chapter) as Promise<VerseRow[]>,
		getChapterSummary(context.db, bookId, chapter) as Promise<{ description?: string } | null>,
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
	};
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: data ? `${data.reference} · Lumen` : "Lumen" }];
}

export default function Scripture({ loaderData }: Route.ComponentProps) {
	const { bookId, chapter, reference, summary, verses, selectedVerse, connections } = loaderData;
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

	const panelFor = (verse: VerseRow) => (
		<PanelBody
			verseText={verse.text}
			isPending={isPending}
			connections={connections}
			onCrossRefNavigate={onCrossRefNavigate}
		/>
	);

	return (
		<div className="mx-auto max-w-6xl px-6 py-10">
			<header className="border-b border-rule pb-5">
				<p className="font-ui text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">
					<Link to="/" className="hover:text-ink">
						Lumen
					</Link>
				</p>
				<h1 className="mt-2 font-display text-3xl font-medium tracking-tight">{reference}</h1>
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
									<Link
										to={chapterUrl}
										preventScrollReset
										aria-label="Close verse panel"
										className="-m-2 p-2 text-muted-foreground transition-colors duration-150 hover:text-ink"
									>
										<XIcon className="size-4" aria-hidden="true" />
									</Link>
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
					open={selected !== undefined}
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
								</SheetHeader>
								{panelFor(sheetVerse)}
							</>
						)}
					</SheetContent>
				</Sheet>
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
}: {
	verseText: string;
	isPending: boolean;
	connections: Promise<VersePanelData> | null;
	onCrossRefNavigate: (verse: number) => void;
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
						{(panel) => <Connections panel={panel} onCrossRefNavigate={onCrossRefNavigate} />}
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
}: {
	panel: VersePanelData;
	onCrossRefNavigate: (verse: number) => void;
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
			<EntityChips title="Principles" accent="text-selbar" edge="border-l-selbar" chips={panel.principles} />
			<EntityChips title="People" accent="text-people" edge="border-l-people" chips={panel.people} />
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
}: {
	title: string;
	accent: string;
	edge: string;
	chips: VerseEntityRef[];
}) {
	if (chips.length === 0) return null;
	return (
		<div className="mt-5">
			<h3 className={`font-ui text-[10px] font-bold uppercase tracking-[0.14em] ${accent}`}>
				{title} · {chips.length}
			</h3>
			<ul className="mt-2 flex flex-wrap gap-1.5">
				{chips.map((c) => (
					<li
						key={c.id}
						className={`rounded-md border border-rule2 border-l-[3px] ${edge} bg-white px-2.5 py-1 font-ui text-xs font-semibold text-ink`}
					>
						{c.name}
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
