import { isRouteErrorResponse } from "react-router";
import {
	parseReference,
	buildVerseId,
	getVersesByChapter,
	getChapterSummary,
	findCrossReferences,
	type CrossReference,
	type CrossReferenceResult,
} from "@lumen/scripture";
import { cachedJson } from "../lib/cache.server";
import { logEvent } from "../lib/log.server";
import type { Route } from "./+types/scripture";

const XREFS_TTL_SECONDS = 7 * 24 * 60 * 60; // scripture graph is immutable between ingests

interface VerseRow {
	id: string;
	verse_number: number;
	text: string;
	reference: string;
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
	const rawBook = params.book ?? "";
	const rawChapter = params.chapter ?? "";
	const url = new URL(request.url);

	const parsed = parseReference(rawBook);
	if (parsed.level !== "book" || !parsed.bookId) {
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

	const [verses, summary] = await Promise.all([
		getVersesByChapter(context.db, bookId, chapter) as Promise<VerseRow[]>,
		getChapterSummary(context.db, bookId, chapter) as Promise<{ description?: string } | null>,
	]);

	if (verses.length === 0) {
		logEvent("scripture_404", { cause: "empty_chapter", book: bookId, chapter });
		throw new Response(`${bookId} has no chapter ${chapter}.`, { status: 404 });
	}

	const verseParam = url.searchParams.get("verse");
	let selectedVerse: number | null = null;
	if (verseParam && /^\d+$/.test(verseParam)) {
		const n = parseInt(verseParam, 10);
		if (n > 0) selectedVerse = n;
	}

	let crossRefs: CrossReference[] | null = null;
	let graphDegraded = false;
	if (selectedVerse !== null) {
		const verseId = buildVerseId(bookId, chapter, selectedVerse);
		try {
			const result = await cachedJson<CrossReferenceResult>(
				context.cache,
				`xrefs:v1:${verseId}`,
				XREFS_TTL_SECONDS,
				() => findCrossReferences(context.neo4j, verseId),
			);
			crossRefs = result.cross_references;
		} catch (error) {
			graphDegraded = true;
			logEvent("neo4j_degraded", {
				name: error instanceof Error ? error.name : "unknown",
				message: error instanceof Error ? error.message : String(error),
				book: bookId,
				chapter,
				verse: selectedVerse,
			});
		}
	}

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
		crossRefs,
		graphDegraded,
	};
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: data ? `${data.reference} · Lumen` : "Lumen" }];
}

export default function Scripture({ loaderData }: Route.ComponentProps) {
	const { bookId, chapter, reference, summary, verses, selectedVerse, crossRefs, graphDegraded } =
		loaderData;

	const chapterUrl = `/scripture/${bookId}/${chapter}`;
	const selected = selectedVerse !== null ? verses.find((v) => v.verse_number === selectedVerse) : undefined;
	const showRail = selectedVerse !== null;
	const cites = (crossRefs ?? []).filter((x) => x.direction === "outgoing");
	const citedBy = (crossRefs ?? []).filter((x) => x.direction === "incoming");

	return (
		<div className="mx-auto max-w-6xl px-6 py-10">
			<header className="border-b border-rule pb-5">
				<p className="font-ui text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">
					<a href="/" className="hover:text-ink">Lumen</a>
				</p>
				<h1 className="mt-2 font-display text-3xl font-medium tracking-tight">{reference}</h1>
				<nav aria-label="Chapter navigation" className="mt-3 flex gap-3 font-ui text-sm font-semibold text-accent">
					{chapter > 1 && (
						<a href={`/scripture/${bookId}/${chapter - 1}`} className="hover:underline">
							← Chapter {chapter - 1}
						</a>
					)}
					<a href={`/scripture/${bookId}/${chapter + 1}`} className="hover:underline">
						Chapter {chapter + 1} →
					</a>
				</nav>
			</header>

			<div className={`mt-8 gap-10 ${showRail ? "lg:grid lg:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
				<main>
					{summary && (
						<section aria-label="Chapter summary" className="mb-8 rounded-lg border border-rule2 bg-panel p-5">
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
							const isSelected = verse.verse_number === selectedVerse;
							return (
								<li key={verse.id} id={`v${verse.verse_number}`}>
									<a
										href={`${chapterUrl}?verse=${verse.verse_number}#v${verse.verse_number}`}
										aria-current={isSelected ? "true" : undefined}
										className={`relative block rounded-lg py-2 pl-14 pr-4 font-reading text-[19px] leading-relaxed text-ink transition hover:bg-selbar/10 ${
											isSelected ? "bg-sel shadow-[inset_3px_0_0_0_var(--color-selbar)]" : ""
										}`}
									>
										<span
											className={`absolute left-4 top-3 w-7 text-right font-ui text-xs font-semibold ${
												isSelected ? "text-selbar" : "text-faint"
											}`}
										>
											{verse.verse_number}
										</span>
										{verse.text}
									</a>
								</li>
							);
						})}
					</ol>
				</main>

				{showRail && (
					<section
						aria-labelledby="xref-heading"
						className="mt-10 h-fit rounded-xl border border-rule bg-panel p-5 lg:sticky lg:top-6 lg:mt-0"
					>
						<div className="flex items-baseline justify-between gap-3">
							<h2 id="xref-heading" className="font-display text-xl font-medium">
								{selected?.reference ?? `${reference}:${selectedVerse}`}
							</h2>
							<a
								href={chapterUrl}
								className="font-ui text-xs font-bold uppercase tracking-wide text-muted hover:text-ink"
							>
								Close ✕
							</a>
						</div>

						{selected && (
							<blockquote className="mt-3 border-l-2 border-rule2 pl-3 font-reading text-sm italic leading-relaxed text-muted">
								{selected.text}
							</blockquote>
						)}

						{graphDegraded ? (
							<p className="mt-5 font-reading text-sm italic text-muted">
								Graph features are unavailable right now — cross-references for this verse
								couldn't be loaded. The chapter text above is unaffected.
							</p>
						) : (
							<>
								<CrossRefGroup title="Cites" accent="text-cites" refs={cites} />
								<CrossRefGroup title="Cited by" accent="text-citedby" refs={citedBy} />
								{cites.length === 0 && citedBy.length === 0 && (
									<p className="mt-5 font-reading text-sm italic text-faint">
										No cross-references recorded for this verse.
									</p>
								)}
							</>
						)}
					</section>
				)}
			</div>
		</div>
	);
}

function CrossRefGroup({
	title,
	accent,
	refs,
}: {
	title: string;
	accent: string;
	refs: CrossReference[];
}) {
	if (refs.length === 0) return null;
	return (
		<div className="mt-5">
			<h3 className={`font-ui text-[10px] font-bold uppercase tracking-[0.14em] ${accent}`}>
				{title} · {refs.length}
			</h3>
			<ul className="mt-2 space-y-2">
				{refs.map((x) => (
					<li key={`${x.direction}-${x.verse_id}`} className="rounded-lg border border-rule2 bg-white p-3">
						<p className="font-ui text-xs font-semibold text-ink">{x.reference}</p>
						<p className="mt-1 line-clamp-3 font-reading text-[13px] leading-snug text-muted">
							{x.text}
						</p>
						<p className="mt-1.5 font-ui text-[9px] font-bold uppercase tracking-wide text-faint">
							{x.source ?? "unattributed"}
						</p>
					</li>
				))}
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
			<p className="mt-3 font-reading text-muted">{detail}</p>
			<p className="mt-6">
				<a href="/" className="font-ui text-sm font-semibold text-accent underline">
					← Back to the library
				</a>
			</p>
		</main>
	);
}
