import { Link, isRouteErrorResponse } from "react-router";
import { ArrowLeftIcon } from "lucide-react";
import { getLexiconEntry, getVersesByStrongs, getStrongsOccurrenceCount } from "@lumen/scripture";
import { structureDefinition, strongsLanguage } from "~/lib/word-study";
import { logEvent } from "../lib/log.server";
import type { Route } from "./+types/word";

const PER_PAGE = 25;

/** Word detail page: everything Lumen knows about one Strong's lemma, with
 * room to breathe — the in-verse card is the teaser, this is the reference. */
export async function loader({ params, request, context }: Route.LoaderArgs) {
	const no = (params.no ?? "").toUpperCase();
	if (!/^[HG]\d{1,5}[A-Z]?$/.test(no)) {
		logEvent("word_page_404", { cause: "invalid_number", no: params.no });
		throw new Response(`"${params.no}" is not a Strong's number.`, { status: 404 });
	}
	const url = new URL(request.url);
	const rawPage = parseInt(url.searchParams.get("page") ?? "1", 10);
	const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

	const [entry, total, verses] = await Promise.all([
		getLexiconEntry(context.db, no),
		getStrongsOccurrenceCount(context.db, no),
		getVersesByStrongs(context.db, no, PER_PAGE, (page - 1) * PER_PAGE),
	]);
	if (!entry && total === 0) {
		logEvent("word_page_404", { cause: "unknown_number", no });
		throw new Response(`No data for ${no}.`, { status: 404 });
	}

	return {
		no,
		entry,
		total,
		page,
		totalPages: Math.max(1, Math.ceil(total / PER_PAGE)),
		verses,
	};
}

export function meta({ data }: Route.MetaArgs) {
	if (!data) return [{ title: "lintel" }];
	const name = data.entry?.translit ?? data.no;
	return [{ title: `${name} · ${data.no} · lintel` }];
}

export default function WordDetail({ loaderData }: Route.ComponentProps) {
	const { no, entry, total, page, totalPages, verses } = loaderData;
	const lang = strongsLanguage(no);
	const defLines = entry?.definition ? structureDefinition(entry.definition) : [];
	const pageUrl = (p: number) => `/word/${no}${p > 1 ? `?page=${p}` : ""}`;

	return (
		<main className="mx-auto max-w-4xl px-6 py-12">
			<header className="border-b border-rule pb-6">
				<p className="font-ui text-[13px] font-normal text-muted-foreground">Word study</p>
				<div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
					{entry?.original && (
						<span className="font-reading text-5xl text-ink" dir={lang === "Hebrew" ? "rtl" : "ltr"}>
							{entry.original}
						</span>
					)}
					<h1 className="font-display text-3xl font-medium tracking-tight">
						{entry?.translit ?? no}
					</h1>
					<span className="rounded border border-rule2 px-2 py-0.5 font-ui text-xs font-semibold text-muted-foreground">
						{lang}
					</span>
					<span className="font-ui text-sm text-faint">{no}</span>
				</div>
				{entry?.gloss && (
					<p className="mt-3 max-w-prose font-reading text-xl text-ink">{entry.gloss}</p>
				)}
			</header>

			{defLines.length > 0 && (
				<section aria-label="Definition" className="mt-8">
					<h2 className="font-ui text-[13px] font-normal text-muted-foreground">
						Definition
					</h2>
					<div className="mt-3 max-w-prose space-y-1.5">
						{defLines.map((l, i) => (
							<p
								key={i}
								className={`font-reading text-[15px] leading-relaxed ${
									l.depth === 0 ? "text-ink" : "text-muted-foreground"
								}`}
								style={{ paddingLeft: `${l.depth * 1.25}rem` }}
							>
								{l.text}
							</p>
						))}
					</div>
					<p className="mt-4 font-ui text-[10px] text-faint">
						Lexicon:{" "}
						<a
							href="https://github.com/STEPBible/STEPBible-Data"
							target="_blank"
							rel="noreferrer"
							className="underline hover:text-ink"
						>
							STEPBible
						</a>{" "}
						(CC BY 4.0)
					</p>
				</section>
			)}

			<section aria-label="Occurrences" className="mt-10">
				<h2 className="font-ui text-[13px] font-normal text-muted-foreground">
					Occurrences · {total} verse{total === 1 ? "" : "s"}
					{totalPages > 1 && ` · page ${page} of ${totalPages}`}
				</h2>
				<ul className="mt-3 list-none space-y-2">
					{verses.map((v) => {
						const m = v.verse_id.match(/^(.*)-(\d+)-(\d+)$/);
						const href = m ? `/scripture/${m[1]}/${m[2]}?verse=${m[3]}` : null;
						const body = (
							<>
								<p className="font-ui text-xs font-semibold text-ink group-hover:text-primary">
									{v.reference}
								</p>
								<p className="mt-1 line-clamp-2 font-reading text-[13px] leading-snug text-muted-foreground">
									{v.text}
								</p>
							</>
						);
						return (
							<li key={v.verse_id}>
								{href ? (
									<Link
										to={href}
										className="group block rounded-lg border border-rule2 bg-surface p-3 transition-colors duration-150 hover:border-primary"
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
				{totalPages > 1 && (
					<nav aria-label="Occurrence pages" className="mt-6 flex items-center justify-between font-ui text-sm font-semibold text-primary">
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
			</section>
		</main>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	const is404 = isRouteErrorResponse(error) && error.status === 404;
	return (
		<main className="mx-auto max-w-2xl px-6 py-16">
			<h1 className="font-display text-3xl font-medium">{is404 ? "Not found" : "Error"}</h1>
			<p className="mt-3 font-reading text-muted-foreground">
				{is404 ? "That Strong's number isn't in the concordance." : "Something went wrong."}
			</p>
			<p className="mt-6">
				<a href="/" className="font-ui text-sm font-semibold text-primary underline">
					← Back to the library
				</a>
			</p>
		</main>
	);
}
