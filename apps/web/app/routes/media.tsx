import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, isRouteErrorResponse } from "react-router";
import { PlayIcon } from "lucide-react";
import { useIsMobile } from "~/hooks/use-mobile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "~/components/ui/sheet";
import {
	DEMO_SHOW,
	DEMO_EPISODES,
	getDemoEpisode,
	type DemoEpisode,
	type MediaDescriptor,
} from "~/lib/podcast-demo";
import type { Route } from "./+types/media";

/** Episode detail page (PROTOTYPE, demo data): the Strong's-page analog for a
 * media collection item. Collection decides the surface; media.kind only picks
 * the player. Real version reads content_item entities scoped to a collection. */
export async function loader({ params, request }: Route.LoaderArgs) {
	const episode = getDemoEpisode(params.id ?? "");
	if (!episode) throw new Response(`No episode "${params.id}".`, { status: 404 });
	const i = DEMO_EPISODES.findIndex((e) => e.id === episode.id);
	// ?t=<seconds> is an ENTRY link (YouTube-style): read once to start the
	// player there; seeks during the visit deliberately don't write it back.
	const rawT = new URL(request.url).searchParams.get("t");
	const t = rawT !== null ? Number.parseInt(rawT, 10) : null;
	return {
		episode,
		prev: DEMO_EPISODES[i - 1] ?? null,
		next: DEMO_EPISODES[i + 1] ?? null,
		initialT: t !== null && Number.isFinite(t) && t >= 0 ? t : null,
	};
}

export function meta({ data }: Route.MetaArgs) {
	if (!data) return [{ title: "Lumen" }];
	return [{ title: `${data.episode.title} · ${DEMO_SHOW.name} · Lumen` }];
}

/** Click-to-load facade: no third-party bytes until the visitor asks for them.
 * Tapping (or a timestamp click) mounts a youtube-nocookie iframe at startAt;
 * an audio-kind item renders a native player in the same slot. */
function Player({ media, startAt }: { media: MediaDescriptor; startAt: number | null }) {
	if (startAt === null) return null;
	if (media.kind === "youtube" && media.videoId) {
		return (
			<iframe
				key={startAt}
				className="aspect-video w-full rounded-lg border border-rule2"
				src={`https://www.youtube-nocookie.com/embed/${media.videoId}?start=${startAt}&autoplay=1`}
				title="Episode video"
				allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
				allowFullScreen
			/>
		);
	}
	if (media.kind === "audio" && media.url) {
		return <audio className="w-full" controls autoPlay src={media.url} />;
	}
	return (
		<div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-rule2 bg-panel2 px-6 text-center font-ui text-sm text-faint">
			Demo — a {media.kind === "youtube" ? "youtube-nocookie embed" : "native audio player"} mounts
			here once a source is wired{startAt > 0 ? ` (seeked to ${startAt}s)` : ""}.
		</div>
	);
}

/** Auto-link "Alma 32:21"-style refs in transcript prose — the demo version of
 * what ingest-time ref detection produces. Chapter-only mentions stay plain. */
function renderWithRefs(text: string) {
	const re = /\bAlma (\d{1,2}):(\d{1,3})\b/g;
	const out: ReactNode[] = [];
	let last = 0;
	for (const m of text.matchAll(re)) {
		if (m.index > last) out.push(text.slice(last, m.index));
		out.push(
			<Link
				key={m.index}
				to={`/scripture/alma/${m[1]}?verse=${m[2]}`}
				className="font-semibold text-primary underline decoration-rule2 underline-offset-2 hover:decoration-primary"
			>
				{m[0]}
			</Link>,
		);
		last = m.index + m[0].length;
	}
	if (last < text.length) out.push(text.slice(last));
	return out;
}

function DiscussedChip({ label }: { label: string }) {
	return (
		<span className="flex-none rounded-full border border-rule2 bg-surface px-3 py-1 font-ui text-xs font-semibold text-ink">
			{label}
		</span>
	);
}

/** One horizontally-scrollable row of chips (scrollbar hidden, edge fades
 * track scroll position). When the row overflows, an "All n" button opens the
 * full set — a modal on desktop, a bottom drawer on mobile. The portal is
 * MOUNT-GATED on matchMedia (use-mobile), never CSS-hidden: portals escape
 * hidden wrappers (web-app-wiring learning). */
function DiscussedRow({ items }: { items: string[] }) {
	const [open, setOpen] = useState(false);
	const [overflowing, setOverflowing] = useState(false);
	const [edges, setEdges] = useState({ start: true, end: true });
	const listRef = useRef<HTMLDivElement>(null);
	const isMobile = useIsMobile();

	const measure = () => {
		const el = listRef.current;
		if (!el) return;
		setOverflowing(el.scrollWidth > el.clientWidth + 1);
		setEdges({
			start: el.scrollLeft <= 1,
			end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
		});
	};

	useEffect(() => {
		const el = listRef.current;
		if (!el) return;
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const mask = !overflowing
		? ""
		: edges.start && !edges.end
			? "[mask-image:linear-gradient(to_right,black_86%,transparent)]"
			: edges.end && !edges.start
				? "[mask-image:linear-gradient(to_right,transparent,black_14%)]"
				: "[mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]";

	const heading = (
		<span className="font-ui text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
			Discussed
		</span>
	);
	const allChips = (
		<div className="flex flex-wrap gap-2">
			{items.map((d) => (
				<DiscussedChip key={d} label={d} />
			))}
		</div>
	);

	return (
		<>
			<div className="mt-3 flex items-center gap-2">
				<div
					ref={listRef}
					onScroll={measure}
					tabIndex={0}
					aria-label="Discussed topics (scrollable)"
					className={`flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${mask}`}
				>
					{items.map((d) => (
						<DiscussedChip key={d} label={d} />
					))}
				</div>
				{overflowing && (
					<button
						type="button"
						onClick={() => setOpen(true)}
						className="flex-none rounded-full border border-rule2 px-3 py-1 font-ui text-xs font-semibold text-primary transition-colors duration-150 hover:border-primary"
					>
						All {items.length}
					</button>
				)}
			</div>
			{open &&
				(isMobile ? (
					<Sheet open onOpenChange={setOpen}>
						<SheetContent side="bottom" className="px-6 pb-8">
							<SheetHeader className="px-0">
								<SheetTitle asChild>{heading}</SheetTitle>
							</SheetHeader>
							{allChips}
						</SheetContent>
					</Sheet>
				) : (
					<Dialog open onOpenChange={setOpen}>
						<DialogContent className="max-w-md">
							<DialogHeader>
								<DialogTitle asChild>{heading}</DialogTitle>
							</DialogHeader>
							{allChips}
						</DialogContent>
					</Dialog>
				))}
		</>
	);
}

export default function MediaDetail({ loaderData }: Route.ComponentProps) {
	const { episode, prev, next, initialT } = loaderData;
	const [startAt, setStartAt] = useState<number | null>(initialT);

	// Active transcript block = last one at-or-before the seek point. Stands in
	// for live player-position sync (iframe API) until a real video is wired.
	const activeIdx =
		startAt === null
			? -1
			: episode.transcript.reduce((acc, b, i) => (b.seconds <= startAt ? i : acc), -1);

	return (
		<main className="mx-auto max-w-4xl px-6 py-10">
			<p className="rounded-lg border border-dashed border-rule2 px-3 py-1.5 font-ui text-[11px] text-faint">
				Prototype · demo data — “{DEMO_SHOW.name}” is a placeholder show
			</p>

			<header className="mt-6 border-b border-rule pb-6">
				<p className="font-ui text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">
					<Link to="/" className="hover:text-ink">
						Lumen
					</Link>{" "}
					·{" "}
					<Link to={`/collections/${DEMO_SHOW.id}`} className="hover:text-ink">
						{DEMO_SHOW.name}
					</Link>{" "}
					· Episode {episode.number}
				</p>
				<h1 className="mt-3 font-display text-3xl font-medium tracking-tight">{episode.title}</h1>
				<p className="mt-1 font-ui text-sm text-faint">
					{episode.chapters.map((c) => c.label).join(" · ")} · {episode.dateLabel} ·{" "}
					{episode.minutes} min
				</p>
			</header>

			<section aria-label="Player" className="mt-8">
				{startAt === null ? (
					<button
						type="button"
						onClick={() => setStartAt(0)}
						className="group relative flex aspect-video w-full items-center justify-center rounded-lg border border-rule2 bg-panel2 transition-colors duration-150 hover:border-primary"
						aria-label="Play episode (loads the embedded player)"
					>
						<span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
							<PlayIcon className="ml-1 h-6 w-6" fill="currentColor" />
						</span>
						<span className="absolute bottom-3 right-3 rounded bg-ink px-2 py-0.5 font-ui text-xs font-bold tabular-nums text-paper">
							{episode.media.durationLabel}
						</span>
					</button>
				) : (
					<Player media={episode.media} startAt={startAt} />
				)}
				<p className="mt-2 font-ui text-[10px] text-faint">
					Nothing loads from third parties until you press play (youtube-nocookie).
				</p>
			</section>

			<section aria-label="In this episode" className="mt-10">
				<h2 className="font-ui text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
					In this episode
				</h2>
				<div className="mt-3 flex flex-wrap gap-2">
					{episode.chapters.map((c) => (
						<Link
							key={c.label}
							to={`/scripture/${c.book}/${c.chapter}`}
							className="rounded-full border border-rule2 bg-surface px-3 py-1 font-ui text-xs font-semibold text-primary transition-colors duration-150 hover:border-primary"
						>
							{c.label}
						</Link>
					))}
				</div>
				{episode.segments.length > 0 && (
					<div className="mt-4 rounded-lg border border-rule2 bg-surface px-4 py-1">
						{episode.segments.map((s) => (
							<div
								key={s.t}
								className="flex items-baseline gap-3 border-b border-rule py-2.5 last:border-b-0"
							>
								<button
									type="button"
									onClick={() => setStartAt(s.seconds)}
									className="font-ui text-xs font-bold tabular-nums text-primary hover:underline"
									aria-label={`Play from ${s.t}`}
								>
									{s.t}
								</button>
								<Link
									to={`/scripture/${s.book}/${s.chapter}?verse=${s.verse}`}
									className="whitespace-nowrap rounded-full border border-rule2 px-2.5 py-0.5 font-ui text-[11px] font-semibold text-primary transition-colors duration-150 hover:border-primary"
								>
									{s.ref}
								</Link>
								<span className="min-w-0 flex-1 truncate font-reading text-[13.5px] text-muted-foreground">
									{s.snippet}
								</span>
							</div>
						))}
					</div>
				)}
				<p className="mt-3 max-w-prose font-reading text-[15px] leading-relaxed text-ink">
					{episode.description}
				</p>
			</section>

			<section aria-label="Discussed" className="mt-10">
				<h2 className="font-ui text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
					Discussed
				</h2>
				<DiscussedRow items={episode.discussed} />
			</section>

			{episode.transcript.length > 0 && (
				<section aria-label="Transcript" className="mt-10">
					<div className="flex items-baseline gap-3">
						<h2 className="font-ui text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
							Transcript
						</h2>
						<span className="rounded-full border border-dashed border-rule2 px-2 py-0.5 font-ui text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
							Excerpt · demo
						</span>
					</div>
					<div className="mt-4 max-w-prose">
						{episode.transcript.map((b, i) => {
							const speakerTurn = i === 0 || episode.transcript[i - 1].speaker !== b.speaker;
							return (
								<div
									key={b.seconds}
									className={`grid grid-cols-[3.5rem_1fr] gap-x-3 rounded-lg px-2 py-2.5 ${
										i === activeIdx ? "bg-sel" : ""
									}`}
								>
									<button
										type="button"
										onClick={() => setStartAt(b.seconds)}
										className="self-start pt-0.5 text-left font-ui text-xs font-bold tabular-nums text-primary hover:underline"
										aria-label={`Play from ${b.t}`}
									>
										{b.t}
									</button>
									<div>
										{speakerTurn && (
											<p className="font-ui text-[10px] font-bold uppercase tracking-[0.14em] text-faint">
												{b.speaker}
											</p>
										)}
										<p className="font-reading text-[15px] leading-relaxed text-ink">
											{renderWithRefs(b.text)}
										</p>
									</div>
								</div>
							);
						})}
					</div>
					<p className="mt-3 font-ui text-[10px] text-faint">
						Timestamps seek the player · references detected in the text link to the reader ·
						share a moment with ?t=&lt;seconds&gt;
					</p>
				</section>
			)}

			<nav
				aria-label="Adjacent episodes"
				className="mt-12 flex items-center justify-between border-t border-rule pt-5 font-ui text-sm font-semibold text-primary"
			>
				{prev ? (
					<Link to={`/media/${prev.id}`} className="hover:underline">
						← Ep. {prev.number} · {prev.title}
					</Link>
				) : (
					<span />
				)}
				{next ? (
					<Link to={`/media/${next.id}`} className="hover:underline">
						Ep. {next.number} · {next.title} →
					</Link>
				) : (
					<span />
				)}
			</nav>
		</main>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	const is404 = isRouteErrorResponse(error) && error.status === 404;
	return (
		<main className="mx-auto max-w-2xl px-6 py-16">
			<h1 className="font-display text-3xl font-medium">{is404 ? "Not found" : "Error"}</h1>
			<p className="mt-3 font-reading text-muted-foreground">
				{is404 ? "That episode isn't in the library." : "Something went wrong."}
			</p>
			<p className="mt-6">
				<a href="/" className="font-ui text-sm font-semibold text-primary underline">
					← Back to the library
				</a>
			</p>
		</main>
	);
}
