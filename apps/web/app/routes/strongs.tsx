import { Link, data } from "react-router";
import { sql } from "drizzle-orm";
import type { Route } from "./+types/strongs";

/**
 * Strong's traversal (Abram, 2026-07-31: "we need a UI to traverse all
 * Strong's entries, even if it is bespoke"). A ledger, not an app: the
 * overview lays out both languages as hundred-ranges; a range shows its
 * entries — original · transliteration · gloss — each a door to the
 * existing /word/:no study page. Deterministic, no search dependency.
 */

interface EntryRow {
	strongs_no: string;
	translit: string | null;
	gloss: string | null;
	original: string | null;
}

const RANGE = 100;
const MAX: Record<"H" | "G", number> = { H: 8674, G: 5624 };
const LANG_NAME: Record<"H" | "G", string> = { H: "Hebrew", G: "Greek" };

function parseFrom(raw: string | null): { lang: "H" | "G"; start: number } | null {
	const m = raw ? /^([HG])(\d+)$/.exec(raw) : null;
	if (!m) return null;
	const lang = m[1] as "H" | "G";
	const start = parseInt(m[2], 10);
	if (start < 1 || start > MAX[lang]) return null;
	return { lang, start: Math.floor((start - 1) / RANGE) * RANGE + 1 };
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const from = parseFrom(new URL(request.url).searchParams.get("from"));
	if (!from) return data({ view: "overview" as const, entries: null, from: null });
	const { lang, start } = from;
	const rows = (await context.db.execute(sql`
		SELECT strongs_no, translit, gloss, original
		FROM lumen.strongs_lexicon
		WHERE lang = ${lang === "H" ? "hebrew" : "greek"}
		  AND (substring(strongs_no from '[0-9]+'))::int BETWEEN ${start} AND ${start + RANGE - 1}
		ORDER BY (substring(strongs_no from '[0-9]+'))::int, strongs_no
	`)) as unknown as EntryRow[];
	return data({ view: "range" as const, entries: rows, from: { lang, start } });
}

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Strong’s — Lumen" }];
}

function rangeLinks(lang: "H" | "G") {
	const out: { label: string; from: string }[] = [];
	for (let start = 1; start <= MAX[lang]; start += RANGE) {
		const end = Math.min(start + RANGE - 1, MAX[lang]);
		out.push({ label: `${start}–${end}`, from: `${lang}${start}` });
	}
	return out;
}

export default function Strongs({ loaderData }: Route.ComponentProps) {
	if (loaderData.view === "range" && loaderData.entries && loaderData.from) {
		const { lang, start } = loaderData.from;
		const end = Math.min(start + RANGE - 1, MAX[lang]);
		const prev = start > 1 ? `${lang}${start - RANGE}` : null;
		const next = start + RANGE <= MAX[lang] ? `${lang}${start + RANGE}` : null;
		return (
			<main className="mx-auto max-w-2xl px-6 py-12">
				<header className="border-b border-rule pb-6">
					<p className="font-ui text-[13px] font-normal text-muted-foreground">
						<Link to="/strongs" className="hover:text-ink">
							Strong’s
						</Link>{" "}
						· {LANG_NAME[lang]}
					</p>
					<h1 className="mt-1 font-display text-3xl font-medium tracking-tight">
						{lang}
						{start}–{lang}
						{end}
					</h1>
				</header>
				<ul className="mt-4 list-none divide-y divide-rule">
					{loaderData.entries.map((e) => (
						<li key={e.strongs_no}>
							<Link
								to={`/word/${e.strongs_no}`}
								className="flex items-baseline gap-4 py-2.5 outline-none transition-colors duration-150 hover:bg-sel/50 focus-visible:bg-sel/50"
							>
								<span className="w-16 shrink-0 font-ui text-[12px] tabular-nums text-muted-foreground">
									{e.strongs_no}
								</span>
								<span
									className="w-24 shrink-0 font-reading text-[17px] text-ink"
									dir={lang === "H" ? "rtl" : "ltr"}
								>
									{e.original}
								</span>
								<span className="w-28 shrink-0 truncate font-reading text-[14px] text-muted-foreground">
									{e.translit}
								</span>
								<span className="min-w-0 truncate font-reading text-[15px] text-ink">
									{e.gloss}
								</span>
							</Link>
						</li>
					))}
				</ul>
				<nav className="mt-8 flex justify-between border-t border-rule pt-4 font-ui text-sm">
					{prev ? (
						<Link
							to={`/strongs?from=${prev}`}
							className="text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-ink"
						>
							← Previous hundred
						</Link>
					) : (
						<span />
					)}
					{next && (
						<Link
							to={`/strongs?from=${next}`}
							className="text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-ink"
						>
							Next hundred →
						</Link>
					)}
				</nav>
			</main>
		);
	}

	return (
		<main className="mx-auto max-w-4xl px-6 py-12">
			<header className="border-b border-rule pb-6">
				<h1 className="font-display text-3xl font-medium tracking-tight">Strong’s</h1>
				<p className="mt-2 font-reading text-[15px] text-muted-foreground">
					20,734 entries. Every number opens a word study.
				</p>
			</header>
			{(["H", "G"] as const).map((lang) => (
				<section key={lang} aria-labelledby={`strongs-${lang}`} className="mt-10">
					<h2
						id={`strongs-${lang}`}
						className="font-ui text-[13px] font-normal text-muted-foreground"
					>
						{LANG_NAME[lang]}
					</h2>
					<p className="mt-3 font-ui text-[13px] leading-7 tabular-nums">
						{rangeLinks(lang).map(({ label, from }, i) => (
							<span key={from}>
								{i > 0 && <span className="text-faint"> · </span>}
								<Link
									to={`/strongs?from=${from}`}
									className="whitespace-nowrap text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors duration-150 hover:text-ink"
								>
									{label}
								</Link>
							</span>
						))}
					</p>
				</section>
			))}
		</main>
	);
}
