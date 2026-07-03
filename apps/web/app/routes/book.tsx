import { Link, isRouteErrorResponse } from "react-router";
import { parseReference, getChapterNumbers, getEntity } from "@lumen/scripture";
import { logEvent } from "../lib/log.server";
import type { Route } from "./+types/book";

interface ChapterRow {
	chapter_number: number;
}

export async function loader({ params, context }: Route.LoaderArgs) {
	const rawBook = params.book ?? "";

	// Same acceptance as the chapter route: "dc" parses as a volume but carries
	// a bookId (single-book volume).
	const parsed = parseReference(rawBook);
	const isBookish = parsed.level === "book" || parsed.level === "volume";
	if (!isBookish || !parsed.bookId) {
		logEvent("scripture_404", { cause: "unknown_book", book: rawBook });
		throw new Response(`Unknown book "${rawBook}".`, { status: 404 });
	}
	const bookId = parsed.bookId;

	// One canonical URL per book — aliases redirect (API-1 precedent).
	if (rawBook !== bookId) {
		throw new Response(null, { status: 301, headers: { Location: `/scripture/${bookId}` } });
	}

	const [chapters, entity] = await Promise.all([
		getChapterNumbers(context.db, bookId) as Promise<ChapterRow[]>,
		getEntity(context.db, bookId) as Promise<{ name?: string } | null>,
	]);

	if (chapters.length === 0) {
		logEvent("scripture_404", { cause: "empty_book", book: bookId });
		throw new Response(`No chapters found for "${bookId}".`, { status: 404 });
	}

	return {
		bookId,
		name: entity?.name ?? bookId,
		chapters: chapters.map((c) => c.chapter_number),
	};
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: data ? `${data.name} · Lumen` : "Lumen" }];
}

export default function Book({ loaderData }: Route.ComponentProps) {
	const { bookId, name, chapters } = loaderData;
	// D&C is divided into sections, not chapters
	const unit = bookId === "dc" ? "Section" : "Chapter";

	return (
		<main className="mx-auto max-w-4xl px-6 py-12">
			<header className="border-b border-rule pb-6">
				<p className="font-ui text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">
					<Link to="/" className="hover:text-ink">
						Lumen
					</Link>
				</p>
				<h1 className="mt-2 font-display text-4xl font-medium tracking-tight">{name}</h1>
				<p className="mt-2 font-reading italic text-muted-foreground">
					{chapters.length} {unit.toLowerCase()}
					{chapters.length === 1 ? "" : "s"}
				</p>
			</header>

			<nav aria-label={`${unit}s in ${name}`} className="mt-8">
				<ol className="grid list-none grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2">
					{chapters.map((n) => (
						<li key={n}>
							<Link
								to={`/scripture/${bookId}/${n}`}
								className="flex h-12 items-center justify-center rounded-md border border-rule2 bg-panel font-ui text-sm font-semibold text-ink transition-colors duration-150 hover:border-primary hover:text-primary"
							>
								{n}
							</Link>
						</li>
					))}
				</ol>
			</nav>
		</main>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	const is404 = isRouteErrorResponse(error) && error.status === 404;
	const detail =
		isRouteErrorResponse(error) && typeof error.data === "string" && error.data
			? error.data
			: "Something went wrong loading this book.";
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
