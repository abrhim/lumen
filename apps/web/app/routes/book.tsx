import { Link, isRouteErrorResponse } from "react-router";
import { parseReference, getChapterNumbers, getBook, chapterUnit } from "@lumen/scripture";
import { getSessionUser } from "../lib/auth.server";
import { logEvent } from "../lib/log.server";
import type { Route } from "./+types/book";

interface ChapterRow {
	chapter_number: number;
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
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

	// One canonical URL per book — aliases redirect (API-1 precedent). The 301
	// self-carries the session commit headers (F3): a thrown redirect
	// short-circuits the root loader's Set-Cookie (root.tsx invariant), so a
	// mid-read token rotation would otherwise be dropped. Signed-out requests
	// short-circuit inside getSessionUser (hasAuthCookie) — no cost.
	if (rawBook !== bookId) {
		const { headers } = await getSessionUser(request, context.cloudflare.env);
		headers.set("Location", `/scripture/${bookId}`);
		// the rotated auth Set-Cookie this 301 may carry must never be cached and
		// replayed to another visitor of this alias (SECURITY-3)
		headers.set("Cache-Control", "private, no-store");
		throw new Response(null, { status: 301, headers });
	}

	const [chapters, book] = await Promise.all([
		getChapterNumbers(context.db, bookId) as Promise<ChapterRow[]>,
		getBook(context.db, bookId) as Promise<{ name?: string } | null>,
	]);

	if (chapters.length === 0) {
		logEvent("scripture_404", { cause: "empty_book", book: bookId });
		throw new Response(`No chapters found for "${bookId}".`, { status: 404 });
	}

	// A one-chapter book has no contents page worth showing (Abram,
	// 2026-07-31) — land in the reading. Same self-carried session headers
	// as the alias 301 above; 302 because the list URL stays legitimate.
	if (chapters.length === 1) {
		const { headers } = await getSessionUser(request, context.cloudflare.env);
		headers.set("Location", `/scripture/${bookId}/${chapters[0].chapter_number}`);
		headers.set("Cache-Control", "private, no-store");
		throw new Response(null, { status: 302, headers });
	}

	return {
		bookId,
		name: book?.name ?? bookId,
		chapters: chapters.map((c) => c.chapter_number),
	};
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: data ? `${data.name} · Lintel` : "Lintel" }];
}

export default function Book({ loaderData }: Route.ComponentProps) {
	const { bookId, name, chapters } = loaderData;
	const unit = chapterUnit(bookId);

	return (
		<main data-plate="ledger" className="mx-auto max-w-4xl px-6 py-12">
			<header className="border-b border-rule pb-6">
				<h1 className="mt-2 font-display text-3xl font-medium tracking-tight">{name}</h1>
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
		<main data-plate="ledger" className="mx-auto max-w-4xl px-6 py-12">
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
