import { useState } from "react";
import { Link, isRouteErrorResponse } from "react-router";
import { ArrowLeftIcon } from "lucide-react";
import { parseReference, getChapterArt, getChapterArtCount, getBook, chapterUnit } from "@lumen/scripture";
import { ArtImage } from "~/components/ArtImage";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { toArtItem, safeHttpUrl, artTransitionName, closeUpImageUrl, type ArtItem, type ArtworkRow } from "~/lib/art";
import { logEvent } from "../lib/log.server";
import type { Route } from "./+types/scripture.art";

export async function loader({ params, request, context }: Route.LoaderArgs) {
	const rawBook = params.book ?? "";
	const rawChapter = params.chapter ?? "";
	const url = new URL(request.url);

	const parsed = parseReference(rawBook);
	const isBookish = parsed.level === "book" || parsed.level === "volume";
	if (!isBookish || !parsed.bookId) {
		logEvent("art_gallery_404", { cause: "unknown_book", book: rawBook });
		throw new Response(`Unknown book "${rawBook}".`, { status: 404 });
	}
	const bookId = parsed.bookId;

	if (!/^\d+$/.test(rawChapter)) {
		logEvent("art_gallery_404", { cause: "invalid_chapter", book: bookId, chapter: rawChapter });
		throw new Response(`"${rawChapter}" is not a valid chapter number.`, { status: 404 });
	}
	const chapter = parseInt(rawChapter, 10);

	// aliases 301 to the canonical slug, like the sibling chapter route (API-4)
	if (rawBook !== bookId) {
		throw new Response(null, {
			status: 301,
			headers: { Location: `/scripture/${bookId}/${chapter}/art${url.search}` },
		});
	}

	// pagination (Abram's call): 24 per page, true total from one count source
	const PER_PAGE = 24;
	const rawPage = parseInt(url.searchParams.get("page") ?? "1", 10);
	const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

	// never-throw: art is an enhancement — degrade, log, keep the page (OBS-4)
	const startedAt = Date.now();
	let art: ArtworkRow[] = [];
	let total = 0;
	let book: { name?: string } | null = null;
	let degraded = false;
	try {
		[art, total, book] = await Promise.all([
			getChapterArt(context.db, bookId, chapter, PER_PAGE, (page - 1) * PER_PAGE) as Promise<ArtworkRow[]>,
			getChapterArtCount(context.db, bookId, chapter),
			getBook(context.db, bookId) as Promise<{ name?: string } | null>,
		]);
	} catch (error) {
		degraded = true;
		logEvent("art_gallery_degraded", {
			name: error instanceof Error ? error.name : "unknown",
			message: error instanceof Error ? error.message : String(error),
			book: bookId,
			chapter,
			elapsedMs: Date.now() - startedAt,
		});
	}

	// human display reference, never the raw slug (CUO-1)
	const reference = `${book?.name ?? bookId} ${chapter}`;

	return {
		bookId,
		chapter,
		reference,
		degraded,
		verse: url.searchParams.get("verse"),
		page,
		total,
		totalPages: Math.max(1, Math.ceil(total / PER_PAGE)),
		art: art.map(toArtItem),
	};
}

export function meta({ data }: Route.MetaArgs) {
	return [
		{ title: data ? `Art · ${data.reference} · Lumen` : "Lumen" },
	];
}

export default function ChapterArtGallery({ loaderData }: Route.ComponentProps) {
	const { bookId, chapter, reference, art, degraded, verse, page, total, totalPages } = loaderData;
	const unit = chapterUnit(bookId);
	// the return path keeps the reader's verse selection (UX-5)
	const backUrl = `/scripture/${bookId}/${chapter}${verse ? `?verse=${verse}` : ""}`;
	const pageUrl = (p: number) => {
		const q = new URLSearchParams();
		if (verse) q.set("verse", verse);
		if (p > 1) q.set("page", String(p));
		const s = q.toString();
		return `/scripture/${bookId}/${chapter}/art${s ? `?${s}` : ""}`;
	};
	// close-up view (Abram's design): select a piece, see it large in place
	const [selected, setSelected] = useState<ArtItem | null>(null);

	return (
		<main className="mx-auto max-w-6xl px-6 py-10">
			<header className="border-b border-rule pb-5">
				<p className="font-ui text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">
					<Link to="/" className="hover:text-ink">
						Lumen
					</Link>
				</p>
				<div className="mt-2 flex items-center gap-3">
					<Link
						to={backUrl}
						aria-label={`Back to ${reference}`}
						className="-m-2 p-2 text-muted-foreground transition-colors duration-150 hover:text-ink"
					>
						<ArrowLeftIcon className="size-5" aria-hidden="true" />
					</Link>
					<h1 className="font-display text-3xl font-medium tracking-tight">
						<Link to={backUrl} className="underline-offset-4 hover:underline hover:decoration-rule2">
							{reference}
						</Link>{" "}
						· Art
					</h1>
				</div>
				<p className="mt-2 font-reading italic text-muted-foreground">
					{total} artwork{total === 1 ? "" : "s"} anchored to this {unit.toLowerCase()}
					{totalPages > 1 && ` · page ${page} of ${totalPages}`}
				</p>
			</header>

			{degraded && (
				<p className="mt-8 font-reading text-sm italic text-muted-foreground">
					Artwork couldn't be loaded right now — try again in a moment.
				</p>
			)}
			{!degraded && art.length === 0 && (
				<p className="mt-8 font-reading text-sm italic text-faint">
					No artwork has been indexed for this {unit.toLowerCase()} yet.
				</p>
			)}

			{/* fixed aspect-ratio boxes: zero CLS on image load; tab order = DOM order (UX-4).
			    Cards open the close-up dialog; the outbound source link lives there. */}
			<ul className="mt-8 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
				{art.map((a, i) => (
					<li key={a.id}>
						<button
							type="button"
							onClick={() => setSelected(a)}
							className="group block w-full text-left"
							aria-label={`View ${a.title}${a.artist ? ` by ${a.artist}` : ""} up close`}
						>
							<div
								className="aspect-[4/3] overflow-hidden rounded-lg border border-rule2 bg-panel"
								// morph targets ONLY for the stack's members (page 1, top 5):
								// naming all 24 cards makes the browser snapshot every one
								// of them on each navigation (perf diagnosis)
								style={page === 1 && i < 5 ? { viewTransitionName: artTransitionName(a.id) } : undefined}
							>
								{/* decorative: title/artist are adjacent visible text (CUO-6) */}
								<ArtImage art={a} decorative className="h-full w-full object-cover" />
							</div>
							<p className="mt-1.5 truncate font-ui text-xs font-semibold text-ink group-hover:text-primary">
								{a.title}
							</p>
							<p className="truncate font-ui text-[10px] text-muted-foreground">
								{[a.artist, a.year].filter(Boolean).join(" · ")}
							</p>
						</button>
					</li>
				))}
			</ul>

			{totalPages > 1 && (
				<nav aria-label="Gallery pages" className="mt-8 flex items-center justify-between font-ui text-sm font-semibold text-primary">
					{page > 1 ? (
						<Link to={pageUrl(page - 1)} className="hover:underline">
							← Previous
						</Link>
					) : (
						<span />
					)}
					<span className="font-normal text-muted-foreground">
						Page {page} of {totalPages}
					</span>
					{page < totalPages ? (
						<Link to={pageUrl(page + 1)} className="hover:underline">
							Next →
						</Link>
					) : (
						<span />
					)}
				</nav>
			)}

			<Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
				<DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
					{selected && (
						<>
							<DialogHeader>
								<DialogTitle className="font-display text-xl">{selected.title}</DialogTitle>
								<DialogDescription className="font-ui text-xs">
									{[selected.artist, selected.year].filter(Boolean).join(" · ") || "Artist unknown"}
								</DialogDescription>
							</DialogHeader>
							<img
								// size-capped close-up (1600w) — the raw originals measured up
								// to 103 MB; the source link below reaches the true original
								src={safeHttpUrl(closeUpImageUrl(selected)) ?? ""}
								alt={`${selected.title}${selected.artist ? ` — ${selected.artist}` : ""}`}
								className="max-h-[65vh] w-full rounded-lg border border-rule2 object-contain"
							/>
							{safeHttpUrl(selected.sourceUrl) && (
								<a
									href={safeHttpUrl(selected.sourceUrl)!}
									target="_blank"
									rel="noreferrer"
									className="font-ui text-sm font-semibold text-primary underline underline-offset-4"
								>
									View source ↗
								</a>
							)}
						</>
					)}
				</DialogContent>
			</Dialog>
		</main>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	const is404 = isRouteErrorResponse(error) && error.status === 404;
	const detail =
		isRouteErrorResponse(error) && typeof error.data === "string" && error.data
			? error.data
			: "Something went wrong loading this gallery.";
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
