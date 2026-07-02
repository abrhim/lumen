import { getVolumeList, getAllBooks } from "@lumen/scripture";
import type { Route } from "./+types/home";

interface VolumeRow {
	id: string;
	name: string;
	metadata: { sort_order?: number } | null;
}

interface BookRow {
	id: string;
	name: string;
	volume_id: string;
	sort_order: number | null;
}

export async function loader({ context }: Route.LoaderArgs) {
	const [volumes, books] = await Promise.all([
		getVolumeList(context.db) as Promise<VolumeRow[]>,
		getAllBooks(context.db) as Promise<BookRow[]>,
	]);

	const booksByVolume = new Map<string, BookRow[]>();
	for (const book of books) {
		const list = booksByVolume.get(book.volume_id) ?? [];
		list.push(book);
		booksByVolume.set(book.volume_id, list);
	}

	const sorted = volumes
		.slice()
		.sort((a, b) => (a.metadata?.sort_order ?? 0) - (b.metadata?.sort_order ?? 0))
		.map((v) => ({
			id: v.id,
			name: v.name,
			books: (booksByVolume.get(v.id) ?? [])
				.slice()
				.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
				.map((b) => ({ id: b.id, name: b.name })),
		}));

	return { volumes: sorted };
}

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Lumen — Scripture Study" },
		{ name: "description", content: "An AI-native scripture study companion." },
	];
}

export default function Home({ loaderData }: Route.ComponentProps) {
	const { volumes } = loaderData;
	return (
		<main className="mx-auto max-w-4xl px-6 py-12">
			<header className="border-b border-rule pb-6">
				<p className="font-ui text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">
					Lumen
				</p>
				<h1 className="mt-2 font-display text-4xl font-medium tracking-tight">
					The Library
				</h1>
				<p className="mt-2 font-reading italic text-muted-foreground">
					Choose a book to begin reading.
				</p>
			</header>

			{volumes.map((volume) => (
				<section key={volume.id} className="mt-10" aria-labelledby={`vol-${volume.id}`}>
					<h2
						id={`vol-${volume.id}`}
						className="font-ui text-[11px] font-bold uppercase tracking-[0.14em] text-faint"
					>
						{volume.name}
					</h2>
					<ul className="mt-3 flex flex-wrap gap-2">
						{volume.books.map((book) => (
							<li key={book.id}>
								<a
									href={`/scripture/${book.id}/1`}
									className="inline-block rounded-md border border-rule2 bg-panel px-3 py-1.5 font-ui text-sm font-medium text-ink transition hover:border-primary hover:text-primary"
								>
									{book.name}
								</a>
							</li>
						))}
					</ul>
				</section>
			))}
		</main>
	);
}
