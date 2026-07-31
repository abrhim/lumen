import { Link, data } from "react-router";
import { sql } from "drizzle-orm";
import type { Route } from "./+types/art";
import { PageFrame, PageHeader } from "~/components/PageFrame";

/**
 * Art traversal (Abram, 2026-07-31): the whole art collection as a
 * contents page — books in canonical order, each chapter that carries
 * artwork a numbered door into the existing per-chapter gallery
 * (/scripture/:book/:chapter/art). A ledger of where the art lives,
 * not a scroll of 4,461 images.
 */

interface ChapterCount {
	book_id: string;
	chapter: number;
	works: number;
}

interface BookRow {
	id: string;
	name: string;
	sort_order: number | null;
}

export async function loader({ context }: Route.LoaderArgs) {
	const [counts, books] = await Promise.all([
		context.db.execute(sql`
			SELECT r->>'book_id' AS book_id, (r->>'chapter')::int AS chapter, count(*)::int AS works
			FROM lumen.entities, jsonb_array_elements(metadata->'refs') AS r
			WHERE entity_type = 'artwork' AND r->>'book_id' IS NOT NULL AND r->>'chapter' IS NOT NULL
			GROUP BY 1, 2
		`) as unknown as Promise<ChapterCount[]>,
		context.db.execute(
			sql`SELECT id, name, sort_order FROM lumen.books ORDER BY sort_order`,
		) as unknown as Promise<BookRow[]>,
	]);

	const byBook = new Map<string, ChapterCount[]>();
	for (const c of counts as ChapterCount[]) {
		const list = byBook.get(c.book_id) ?? [];
		list.push(c);
		byBook.set(c.book_id, list);
	}
	const sections = (books as BookRow[])
		.filter((b) => byBook.has(b.id))
		.map((b) => ({
			id: b.id,
			name: b.name,
			total: byBook.get(b.id)!.reduce((n, c) => n + c.works, 0),
			chapters: byBook.get(b.id)!.sort((a, c) => a.chapter - c.chapter),
		}));
	const total = sections.reduce((n, s) => n + s.total, 0);
	return data({ sections, total });
}

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Art — Lumen" }];
}

export default function Art({ loaderData }: Route.ComponentProps) {
	const { sections, total } = loaderData;
	return (
		<PageFrame frame="ledger">
			<PageHeader
				title="Art"
				intro={`${total.toLocaleString("en-GB")} public-domain works, shelved by chapter.`}
			/>
			{sections.map((s) => (
				<section key={s.id} aria-labelledby={`art-${s.id}`} className="mt-8">
					<h2 id={`art-${s.id}`} className="flex items-baseline gap-3">
						<span className="font-display text-lg font-medium text-ink">{s.name}</span>
						<span className="font-ui text-[12px] tabular-nums text-muted-foreground">
							{s.total.toLocaleString("en-GB")}
						</span>
					</h2>
					<p className="mt-1.5 font-ui text-[14px] leading-7 tabular-nums">
						{s.chapters.map((c, i) => (
							<span key={c.chapter}>
								{i > 0 && <span className="text-faint"> · </span>}
								<Link
									to={`/scripture/${s.id}/${c.chapter}/art`}
									title={`${s.name} ${c.chapter} — ${c.works} ${c.works === 1 ? "work" : "works"}`}
									className="whitespace-nowrap text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors duration-150 hover:text-ink"
								>
									{c.chapter}
								</Link>
							</span>
						))}
					</p>
				</section>
			))}
		</PageFrame>
	);
}
