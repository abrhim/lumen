import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, data, isRouteErrorResponse, useSearchParams } from "react-router";
import { sql } from "drizzle-orm";
import { useIsMobile } from "~/hooks/use-mobile";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "~/components/ui/sheet";
import { getSessionUser } from "~/lib/auth.server";
import { notesEnabled } from "~/lib/notes-enabled";
import { canViewCollection, getCollectionAccess } from "~/lib/collection-access.server";
import type { Route } from "./+types/media";

/** Episode detail — the `episodes` display family's item page (study posture,
 * discovered with Abram in the unshaken-surfaces spikes). The transcript is
 * the primary text: caption fragments assembled into sentence-safe reading
 * paragraphs, every word a seek target, the playhead underlined live via the
 * YouTube iframe API. Video docks in the rail (desktop) / a sticky top strip
 * (mobile); chapters + references are rails on desktop, bottom sheets on
 * mobile. ?t=<s> is an entry link; ?lens=<entity> filters to that node's
 * passages. Gated: collection must be public, or the viewer holds
 * admin.collections (preview path), or local dev. */

const num = (x: unknown) => Number(x);
const jb = (x: unknown) => (typeof x === "string" ? JSON.parse(x) : x) as any;

function fmt(s: number) {
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = Math.floor(s % 60);
	return h > 0
		? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
		: `${m}:${String(ss).padStart(2, "0")}`;
}

/** entity_type -> typed node route (the type is the slug). */
const TYPE_SLUGS: Record<string, string> = {
	person: "people",
	place: "places",
	principle: "principles",
	event: "events",
	symbol: "symbols",
	era: "eras",
};
const nodePath = (type: string, id: string) =>
	`/${TYPE_SLUGS[type] ?? "node"}/${encodeURIComponent(id)}`;

interface Moment {
	t: number;
	seq: number;
}
interface Frag {
	t: number;
	e: number;
	text: string;
}
interface Para {
	seq: number;
	t: number;
	chapter?: { label: string; t: number };
	refs: { ref: string; book: string; chapter: number; verse: number; t: number }[];
	/** people/places (MENTIONS) and principles (TEACHES) said in this
	 * paragraph — the margin shows them WHERE they are said (phase 1 of the
	 * collection pitch), not as an aggregate side list */
	ents: { id: string; name: string; kind: "teaches" | "mentions"; t: number }[];
	frags: Frag[];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
	const id = params.id ?? "";
	const db = context.db;
	const url = new URL(request.url);
	const lensId = url.searchParams.get("lens");

	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	const [[episode], access] = await Promise.all([
		db.execute(sql`SELECT id, name, collection_id, metadata FROM lumen.entities
			WHERE id = ${id} AND entity_type = 'content_item'`),
		getCollectionAccess(db, user?.id ?? null),
	]);
	// Unknown episode and un-viewable collection are the SAME 404 (don't
	// confirm gated content exists — the admin.users doctrine, D10).
	if (!episode || !canViewCollection(access, String(episode.collection_id))) {
		throw data(null, { status: 404, headers });
	}
	const collectionId = String(episode.collection_id);

	// second-show: sources follow the collection — the episode's own
	// collection_id, already in hand, templates every source filter
	const srcYoutube = `${collectionId}-youtube`;
	const srcExtraction = `${collectionId}-extraction`;
	const [[collection], transcript, anchors, discusses, entityEdges] = await Promise.all([
		db.execute(sql`SELECT name FROM lumen.collections WHERE id = ${collectionId}`),
		db.execute(sql`SELECT seq, t_start_s, t_end_s, text FROM lumen.transcripts
			WHERE episode_id = ${id} ORDER BY seq`),
		db.execute(sql`SELECT g.to_id, b.abbrev, c.number, g.metadata
			FROM lumen.edges g
			JOIN lumen.chapters c ON c.id = g.to_id
			JOIN lumen.books b ON b.id = c.book_id
			WHERE g.from_id = ${id} AND g.source = ${srcYoutube}`),
		db.execute(sql`SELECT g.to_id, v.reference, g.metadata
			FROM lumen.edges g JOIN lumen.verses v ON v.id = g.to_id
			WHERE g.from_id = ${id} AND g.source = ${srcExtraction}
			AND g.rel_type = 'DISCUSSES'`),
		db.execute(sql`SELECT g.to_id, g.rel_type, en.name, en.entity_type, g.metadata
			FROM lumen.edges g JOIN lumen.entities en ON en.id = g.to_id
			WHERE g.from_id = ${id} AND g.source = ${srcExtraction}
			AND g.rel_type IN ('MENTIONS','TEACHES')`),
	]);

	const meta = jb(episode.metadata);
	const media = meta?.media ?? {};
	const durationS = num(media.duration_s) || 0;
	const videoId = media.kind === "youtube" ? String(media.video_id) : null;

	// Chapter anchors: seq -> heading label, in time order. A chapter can sit
	// in the episode's range yet have no anchored moment — the rail skips it.
	const chapterAt = new Map<number, { label: string; t: number }>();
	const chapters = anchors
		.flatMap((a: any) => {
			const m = jb(a.metadata).mentions[0];
			return m ? [{ label: `${a.abbrev} ${a.number}`, t: num(m.t), seq: num(m.seq) }] : [];
		})
		.sort((a, b) => a.t - b.t);
	for (const c of chapters) chapterAt.set(c.seq, { label: c.label, t: c.t });

	// Assemble caption fragments into reading paragraphs, KEEPING per-fragment
	// timing so the client can seek from any word and underline the playhead.
	// Break at chapter anchors; otherwise only at a SENTENCE END, with a
	// runaway cap for sentences that never terminate.
	const r1 = (x: number) => Math.round(x * 10) / 10;
	const endsSentence = (s: string) => /[.?!…]["')\]]?\s*$/.test(s);
	const paras: Para[] = [];
	let cur: Para | null = null;
	let words = 0;
	let prevEnd = 0;
	let prevDone = true;
	// A chapter anchor that lands mid-sentence waits for the sentence to end
	// before it breaks (the heading keeps the anchor's own timestamp).
	let pendingChapter: { label: string; t: number } | undefined;
	for (const row of transcript as any[]) {
		const seq = num(row.seq);
		const t = num(row.t_start_s);
		const e = num(row.t_end_s ?? row.t_start_s);
		const gap = t - prevEnd;
		const text = String(row.text);
		const w = text.split(/\s+/).length;
		if (chapterAt.has(seq)) pendingChapter = chapterAt.get(seq);
		const breakHere =
			cur === null ||
			(prevDone && (pendingChapter !== undefined || (gap > 1.6 && words >= 30) || words + w > 110)) ||
			words + w > 200;
		const frag = { t: r1(t), e: r1(e), text };
		if (breakHere) {
			cur = { seq, t: r1(t), chapter: pendingChapter, refs: [], ents: [], frags: [frag] };
			pendingChapter = undefined;
			paras.push(cur);
			words = w;
		} else {
			cur!.frags.push(frag);
			words += w;
		}
		prevEnd = e;
		prevDone = endsSentence(text);
	}
	if (paras.length === 0) throw data(null, { status: 404, headers });

	// seq -> paragraph index (paragraph start seqs are ascending).
	const starts = paras.map((p) => p.seq);
	const paraOf = (seq: number) => {
		let lo = 0;
		let hi = starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (starts[mid] <= seq) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	};

	// Verse moments annotate their paragraph.
	for (const d of discusses as any[]) {
		const [, book, ch, vs] = String(d.to_id).match(/^(.+)-(\d+)-(\d+)$/) ?? [];
		if (!book) continue;
		for (const m of jb(d.metadata).mentions as Moment[]) {
			paras[paraOf(num(m.seq))].refs.push({
				ref: String(d.reference),
				book,
				chapter: num(ch),
				verse: num(vs),
				t: num(m.t),
			});
		}
	}

	// Entity mentions annotate their paragraph, exactly as verse refs do —
	// one chip per entity per paragraph, at its first moment there. The
	// aggregate people/principles index is gone on purpose (Abram): the margin
	// IS the index now, placed where the words are said.
	const lensMoments: Moment[] = [];
	let lensName: string | null = null;
	let lensType = "person";
	for (const e of entityEdges as any[]) {
		const mentions = jb(e.metadata).mentions as Moment[];
		const kind = e.rel_type === "TEACHES" ? ("teaches" as const) : ("mentions" as const);
		const seen = new Set<number>();
		for (const m of mentions) {
			const pi = paraOf(num(m.seq));
			if (seen.has(pi)) continue;
			seen.add(pi);
			paras[pi].ents.push({ id: String(e.to_id), name: String(e.name), kind, t: num(m.t) });
		}
		if (lensId === e.to_id) {
			lensName = e.name;
			lensType = e.rel_type === "TEACHES" ? "principle" : String(e.entity_type);
			lensMoments.push(...mentions);
		}
	}
	for (const p of paras) p.ents.sort((a, b) => a.t - b.t);

	// Lens: which paragraphs survive the filter.
	let lens: { id: string; name: string; type: string; count: number; paraIdx: number[] } | null =
		null;
	if (lensId && lensName) {
		const idx = [...new Set(lensMoments.map((m) => paraOf(num(m.seq))))].sort((a, b) => a - b);
		lens = { id: lensId, name: lensName, type: lensType, count: lensMoments.length, paraIdx: idx };
	}

	return data(
		{
			// personal-notes A16/media capture: the affordance prints signed-in only
			canCapture: user !== null && notesEnabled(context.cloudflare.env),
			episodeId: id,
			collectionId,
			collectionName: collection ? String(collection.name) : collectionId,
			title: String(episode.name),
			videoId,
			durationS,
			paras,
			chapters: chapters.map(({ label, t }) => ({ label, t })),
			lens,
		},
		{ headers },
	);
}

export function meta({ data: d }: Route.MetaArgs) {
	if (!d) return [{ title: "Lintel" }];
	return [{ title: `${d.title} · ${d.collectionName} · Lintel` }];
}

const msg = (payload: object) => JSON.stringify({ id: "lumen-media", channel: "widget", ...payload });

/** Always-present video accordion at the top of the desktop rail. The iframe,
 * once mounted, is only ever CSS-hidden — collapsing keeps audio playing
 * (listen-while-reading) and keeps the playhead sync alive. */
function VideoAccordion({
	videoId,
	mountT,
	posT,
	iframeRef,
	onPlay,
	autoScroll,
	onAutoScroll,
}: {
	videoId: string;
	mountT: number | null;
	posT: number | null;
	iframeRef: React.RefObject<HTMLIFrameElement | null>;
	onPlay: () => void;
	autoScroll: boolean;
	onAutoScroll: (v: boolean) => void;
}) {
	const [open, setOpen] = useState(true);
	return (
		<section className="mb-6">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				aria-expanded={open}
				className="flex w-full items-baseline justify-between font-reading text-sm italic text-faint hover:text-ink"
			>
				<span>Video</span>
				<span aria-hidden className="font-ui text-xs not-italic">
					{open ? "▾" : "▸"}
				</span>
			</button>
			{!open && mountT !== null && (
				<p className="mt-1 font-ui text-[10px] tabular-nums text-faint">
					playing · {posT !== null ? fmt(posT) : "…"}
				</p>
			)}
			<div className={open ? "mt-2" : "h-0 overflow-hidden"}>
				{mountT === null ? (
					<button
						type="button"
						onClick={onPlay}
						className="flex aspect-video w-full items-center justify-center rounded-lg border border-rule2 bg-panel2 font-ui text-xs text-faint transition-colors hover:border-primary"
					>
						▶ Play episode
					</button>
				) : (
					<iframe
						ref={iframeRef}
						className="aspect-video w-full rounded-lg border border-rule2"
						src={`https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&start=${Math.max(0, Math.floor(mountT) - 2)}&autoplay=1`}
						title="Episode video"
						allow="autoplay; encrypted-media; picture-in-picture"
						allowFullScreen
						onLoad={() =>
							iframeRef.current?.contentWindow?.postMessage(msg({ event: "listening" }), "*")
						}
					/>
				)}
				<label className="mt-2 flex cursor-pointer items-center gap-2 font-ui text-xs text-faint hover:text-ink">
					<input
						type="checkbox"
						checked={autoScroll}
						onChange={(e) => onAutoScroll(e.target.checked)}
						className="accent-primary"
					/>
					Follow along (auto-scroll)
				</label>
			</div>
		</section>
	);
}

/** Mobile: the video lives in a sticky top strip. Collapsed it is one quiet
 * line (audio keeps playing — the iframe is only CSS-hidden); expanded it is
 * the full-width player. Exactly one player iframe exists at a time app-wide:
 * this bar renders only when isMobile, the rail accordion only when not. */
function MobileVideoBar({
	videoId,
	mountT,
	posT,
	iframeRef,
	onPlay,
	autoScroll,
	onAutoScroll,
}: {
	videoId: string;
	mountT: number | null;
	posT: number | null;
	iframeRef: React.RefObject<HTMLIFrameElement | null>;
	onPlay: () => void;
	autoScroll: boolean;
	onAutoScroll: (v: boolean) => void;
}) {
	const [open, setOpen] = useState(true);
	return (
		<div className="sticky top-0 z-40 -mx-6 border-b border-rule bg-paper/95 px-6 py-2 backdrop-blur">
			{mountT === null ? (
				<button
					type="button"
					onClick={onPlay}
					className="font-ui text-sm font-semibold text-primary hover:underline"
				>
					▶ Play episode
				</button>
			) : (
				<>
					<div className="flex items-baseline justify-between gap-3">
						<button
							type="button"
							onClick={() => setOpen(!open)}
							aria-expanded={open}
							className="font-reading text-sm italic text-faint hover:text-ink"
						>
							Video <span className="font-ui text-xs not-italic">{open ? "▾" : "▸"}</span>
							{!open && (
								<span className="ml-2 font-ui text-xs not-italic tabular-nums">
									playing · {posT !== null ? fmt(posT) : "…"}
								</span>
							)}
						</button>
						<label className="flex cursor-pointer items-center gap-1.5 font-ui text-xs text-faint">
							<input
								type="checkbox"
								checked={autoScroll}
								onChange={(e) => onAutoScroll(e.target.checked)}
								className="accent-primary"
							/>
							Follow along
						</label>
					</div>
					<div className={open ? "mt-2 pb-1" : "h-0 overflow-hidden"}>
						<iframe
							ref={iframeRef}
							className="aspect-video w-full rounded-lg border border-rule2"
							src={`https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&start=${Math.max(0, Math.floor(mountT) - 2)}&autoplay=1`}
							title="Episode video"
							allow="autoplay; encrypted-media; picture-in-picture"
							allowFullScreen
							onLoad={() =>
								iframeRef.current?.contentWindow?.postMessage(msg({ event: "listening" }), "*")
							}
						/>
					</div>
				</>
			)}
		</div>
	);
}




interface ParaBlockProps {
	p: Para;
	/** lens links need the episode; captureEpisodeId is empty signed out */
	episodeId: string;
	active: boolean;
	/** playhead seconds; only meaningful when active (−1 otherwise, kept stable
	 * so the memo comparator lets inactive paragraphs skip re-render) */
	posT: number;
	showGap: boolean;
	lensed: boolean;
	onSeek: (t: number) => void;
	/** personal-notes: transcript capture door — `episode@t_start_s` anchors
	 * (A8: durable across re-windowing; never a seq). Empty string = signed
	 * out, the affordance never prints (F2). */
	captureEpisodeId: string;
}

const ParaBlock = memo(
	function ParaBlock({ p, episodeId, active, posT, showGap, lensed, onSeek, captureEpisodeId }: ParaBlockProps) {
		// The fragment the playhead is inside — last one started at-or-before posT.
		const uIdx = active ? p.frags.reduce((acc, f, i) => (f.t <= posT ? i : acc), -1) : -1;
		return (
			<div id={`para-${p.seq}`}>
				{showGap && <p className="py-3 text-center font-ui text-sm text-faint">· · ·</p>}
				{p.chapter && !lensed && (
					<h3 className="mt-10 flex items-baseline gap-3 border-b border-rule pb-2 font-display text-xl font-medium tracking-tight">
						{p.chapter.label}
						<button
							type="button"
							onClick={() => onSeek(p.chapter!.t)}
							className="font-ui text-xs font-bold tabular-nums text-primary hover:underline"
						>
							{fmt(p.chapter.t)}
						</button>
					</h3>
				)}
				<div className={`group relative mt-4 rounded px-2 py-1 ${active ? "bg-sel" : ""}`}>
					{(p.refs.length > 0 || p.ents.length > 0) && (
						/* the rail FLOATS beside the paragraph, top-aligned to it —
						   never inside the text's box, so no line shortens around it
						   (Abram). left-full escapes the prose column into the page's
						   right whitespace; below ~1340px that whitespace is gone and
						   the under-paragraph line takes over. */
						<span className="absolute left-full top-1 ml-8 hidden w-[11rem] font-ui text-xs leading-5 min-[1340px]:block">
							{p.refs.map((r) => (
								<Link
									key={`${r.ref}${r.t}`}
									to={`/scripture/${r.book}/${r.chapter}?verse=${r.verse}`}
									className="block whitespace-nowrap text-primary decoration-rule2 underline-offset-2 hover:underline"
								>
									{r.ref}
								</Link>
							))}
							{/* the margin speaks the reader's dot language: blue = a
							    principle TAUGHT here, green = a person/place mentioned.
							    Each chip lenses the episode to its passages. */}
							{p.ents.map((en) => (
								<Link
									key={`${en.id}${en.t}`}
									to={`/media/${episodeId}?lens=${encodeURIComponent(en.id)}`}
									aria-label={`Show every passage about ${en.name}`}
									className="block w-full truncate text-muted-foreground decoration-rule2 underline-offset-2 hover:text-ink hover:underline"
								>
									<span
										aria-hidden
										className={`mr-1.5 inline-block size-[5px] rounded-full align-middle ${
											en.kind === "teaches" ? "bg-dot-teaches" : "bg-dot-mentions"
										}`}
									/>
									{en.name}
								</Link>
							))}
						</span>
					)}
					<button
						type="button"
						onClick={() => onSeek(p.t)}
						className="mr-3 align-baseline font-ui text-xs font-bold tabular-nums text-faint opacity-0 transition-opacity hover:text-primary hover:underline group-hover:opacity-100"
						aria-label={`Play from ${fmt(p.t)}`}
					>
						{fmt(p.t)}
					</button>
					{captureEpisodeId !== "" && (
						// B39 (CP-42): text-muted-foreground, matching the reader capture
						// verbs — text-faint on these backgrounds is the documented AA
						// failure class, and this NEW door must not shelter under the
						// pre-existing .text-faint axe exclusion.
						// B52 (CP-69): coarse pointers have no hover — the door stays
						// visible on touch (full opacity: a reduced-alpha reveal would
						// re-fail the AA contrast B39 just fixed; the muted token IS the
						// quiet register). Fine pointers keep the hover/focus reveal.
						<Link
							to={`/notes/new?anchor=${encodeURIComponent(`${captureEpisodeId}@${p.t}`)}`}
							className="mr-3 align-baseline font-ui text-xs font-semibold text-muted-foreground transition-opacity hover:text-primary hover:underline focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
							aria-label={`New note at ${fmt(p.t)}`}
						>
							+ note
						</Link>
					)}
					<span className="cursor-pointer font-reading text-[15px] leading-relaxed text-ink">
						{p.frags.map((f, i) => (
							<span
								key={f.t}
								onClick={() => onSeek(f.t)}
								className={
									i === uIdx
										? "underline decoration-primary decoration-2 underline-offset-4"
										: "hover:underline hover:decoration-rule2 hover:underline-offset-4"
								}
							>
								{f.text}
								{i < p.frags.length - 1 ? " " : ""}
							</span>
						))}
					</span>
					{(p.refs.length > 0 || p.ents.length > 0) && (
						<span className="mt-1 block font-ui text-xs min-[1340px]:hidden">
							<span className="text-faint">— </span>
							{p.refs.map((r, i) => (
								<span key={`${r.ref}${r.t}`}>
									<Link
										to={`/scripture/${r.book}/${r.chapter}?verse=${r.verse}`}
										className="text-primary decoration-rule2 underline-offset-2 hover:underline"
									>
										{r.ref}
									</Link>
									{i < p.refs.length - 1 || p.ents.length > 0 ? ", " : ""}
								</span>
							))}
							{p.ents.map((en, i) => (
								<span key={`${en.id}${en.t}`}>
									<Link
										to={`/media/${episodeId}?lens=${encodeURIComponent(en.id)}`}
										className="text-muted-foreground decoration-rule2 underline-offset-2 hover:underline"
									>
										<span
											aria-hidden
											className={`mr-1 inline-block size-[5px] rounded-full align-middle ${
												en.kind === "teaches" ? "bg-dot-teaches" : "bg-dot-mentions"
											}`}
										/>
										{en.name}
									</Link>
									{i < p.ents.length - 1 ? ", " : ""}
								</span>
							))}
						</span>
					)}
				</div>
			</div>
		);
	},
	(prev, next) =>
		prev.p === next.p &&
		prev.episodeId === next.episodeId &&
		prev.showGap === next.showGap &&
		prev.lensed === next.lensed &&
		prev.onSeek === next.onSeek &&
		prev.captureEpisodeId === next.captureEpisodeId &&
		prev.active === next.active &&
		(!next.active || prev.posT === next.posT),
);

function Transcript({
	paras,
	episodeId,
	activeIdx,
	posT,
	onSeek,
	lensSet,
	captureEpisodeId,
}: {
	paras: Para[];
	episodeId: string;
	activeIdx: number;
	posT: number;
	onSeek: (t: number) => void;
	lensSet: Set<number> | null;
	captureEpisodeId: string;
}) {
	let prevShown = -1;
	return (
		<div className="max-w-prose">
			{paras.map((p, i) => {
				if (lensSet && !lensSet.has(i)) return null;
				const showGap = lensSet !== null && prevShown >= 0 && i - prevShown > 1;
				prevShown = i;
				const active = i === activeIdx;
				return (
					<ParaBlock
						key={p.seq}
						p={p}
						episodeId={episodeId}
						active={active}
						posT={active ? posT : -1}
						showGap={showGap}
						lensed={lensSet !== null}
						onSeek={onSeek}
						captureEpisodeId={captureEpisodeId}
					/>
				);
			})}
		</div>
	);
}

export default function MediaDetail({ loaderData }: Route.ComponentProps) {
	const {
		episodeId,
		collectionId,
		collectionName,
		title,
		videoId,
		durationS,
		paras,
		chapters,
		lens,
		canCapture,
	} = loaderData;
	const [searchParams] = useSearchParams();
	const entryT = Number(searchParams.get("t"));
	const entry = Number.isFinite(entryT) && entryT > 0 ? entryT : null;

	// mountT: where the iframe mounts (null = no player). posT: the playhead
	// the transcript follows — optimistic on click, then live from infoDelivery.
	const [mountT, setMountT] = useState<number | null>(entry);
	const [posT, setPosT] = useState<number | null>(entry);
	const [autoScroll, setAutoScroll] = useState(true);
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const isMobile = useIsMobile();
	const [sheet, setSheet] = useState<null | "chapters">(null);

	useEffect(() => {
		const onMessage = (ev: MessageEvent) => {
			if (typeof ev.data !== "string" || !ev.origin.includes("youtube")) return;
			try {
				const d = JSON.parse(ev.data);
				const ct = d?.info?.currentTime;
				if (d?.event === "infoDelivery" && typeof ct === "number") {
					setPosT((prev) => (prev !== null && Math.abs(prev - ct) < 0.3 ? prev : ct));
				}
			} catch {
				/* not ours */
			}
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);

	const seek = useCallback((t: number) => {
		setPosT(t);
		const w = iframeRef.current?.contentWindow;
		if (w) {
			w.postMessage(msg({ event: "command", func: "seekTo", args: [Math.max(0, t - 2), true] }), "*");
			w.postMessage(msg({ event: "command", func: "playVideo", args: [] }), "*");
		} else {
			setMountT(t);
		}
	}, []);

	const followT = posT ?? mountT;
	const activeIdx = useMemo(
		() => (followT === null ? -1 : paras.reduce((acc, p, i) => (p.t <= followT ? i : acc), -1)),
		[followT, paras],
	);

	// Follow-along: keep the playing paragraph in view while the video runs.
	useEffect(() => {
		if (!autoScroll || posT === null || activeIdx < 0) return;
		document
			.getElementById(`para-${paras[activeIdx].seq}`)
			?.scrollIntoView({ behavior: "smooth", block: "center" });
	}, [autoScroll, activeIdx, posT !== null, paras]);

	const lensSet = lens ? new Set(lens.paraIdx) : null;
	const lensHref = (id: string) => `/media/${episodeId}?lens=${encodeURIComponent(id)}`;
	const hasVideo = videoId !== null;

	const header = (
		<header className="border-b border-rule pb-6">
			<p className="font-ui text-[13px] font-normal text-muted-foreground">
				<Link to={`/collections/${collectionId}`} className="hover:text-ink">
					{collectionName}
				</Link>
			</p>
			<h1 className="mt-3 font-display text-3xl font-medium tracking-tight">{title}</h1>
			<p className="mt-1 font-ui text-sm text-faint">
				{chapters.length > 0 &&
					`${chapters[0].label}–${chapters[chapters.length - 1].label.split(" ").pop()} · `}
				{fmt(durationS)}
			</p>
		</header>
	);

	return (
		<main data-plate="ledger" className="mx-auto max-w-4xl px-6 pb-20 pt-10 lg:pb-10">
			{header}
			{isMobile && hasVideo && (
				<MobileVideoBar
					videoId={videoId}
					mountT={mountT}
					posT={posT}
					iframeRef={iframeRef}
					onPlay={() => {
						setMountT(0);
						setPosT(0);
					}}
					autoScroll={autoScroll}
					onAutoScroll={setAutoScroll}
				/>
			)}
			{lens && (
				<div className="z-30 -mx-6 mt-6 border-b border-rule bg-paper/95 px-6 py-2.5 backdrop-blur lg:sticky lg:top-0">
					<p className="font-ui text-sm text-ink">
						Showing {lens.count === 1 ? "the passage" : `${lens.count} passages`} about{" "}
						<span className="font-semibold">{lens.name}</span>
						<span className="text-faint"> · </span>
						<Link
							to={nodePath(lens.type, lens.id)}
							className="font-semibold text-primary hover:underline"
						>
							About {lens.name} →
						</Link>
						<span className="text-faint"> · </span>
						<Link to={`/media/${episodeId}`} className="font-semibold text-primary hover:underline">
							Show full episode
						</Link>
					</p>
				</div>
			)}
			<div className="mt-8 gap-12 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
				<nav aria-label="Chapters" className="hidden lg:block">
					{/* Same independent scroll as the References rail (Numbers has 36 chapters). */}
					<div className="sticky top-8 -mx-3 max-h-[calc(100vh-4rem)] overflow-y-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
						{!isMobile && hasVideo && (
							<VideoAccordion
								videoId={videoId}
								mountT={mountT}
								posT={posT}
								iframeRef={iframeRef}
								onPlay={() => {
									setMountT(0);
									setPosT(0);
								}}
								autoScroll={autoScroll}
								onAutoScroll={setAutoScroll}
							/>
						)}
						<h2 className="font-reading text-sm italic text-faint">Chapters</h2>
						<ul className="mt-2 list-none border-l border-rule">
							{chapters.map((c) => (
								<li key={c.label}>
									<button
										type="button"
										onClick={() => seek(c.t)}
										className="block w-full py-1 pl-3 text-left font-ui text-xs text-faint hover:border-l hover:border-primary hover:text-ink"
									>
										{c.label}
										<span className="ml-1.5 tabular-nums opacity-70">{fmt(c.t)}</span>
									</button>
								</li>
							))}
						</ul>
					</div>
				</nav>
				<div>
					<Transcript
						paras={paras}
						episodeId={episodeId}
						activeIdx={activeIdx}
						posT={followT ?? -1}
						onSeek={seek}
						lensSet={lensSet}
						captureEpisodeId={canCapture ? episodeId : ""}
					/>
				</div>
			</div>

			{/* Mobile bottom bar: the rails, reachable from any scroll depth. */}
			<nav
				aria-label="Episode navigation"
				className="fixed inset-x-0 bottom-0 z-40 flex items-baseline gap-6 border-t border-rule bg-paper/95 px-6 py-3 font-ui text-sm font-semibold text-primary backdrop-blur lg:hidden"
			>
				<button type="button" onClick={() => setSheet("chapters")} className="hover:underline">
					Chapters
				</button>
			</nav>
			{/* Sheets are MOUNT-GATED on isMobile (portals escape hidden wrappers). */}
			{isMobile && sheet !== null && (
				<Sheet open onOpenChange={(open) => !open && setSheet(null)}>
					<SheetContent side="bottom" className="max-h-[75vh] overflow-y-auto px-6 pb-8">
						<SheetHeader className="px-0">
							<SheetTitle asChild>
								<h2 className="font-display text-lg font-medium tracking-tight text-ink">
									Chapters
								</h2>
							</SheetTitle>
						</SheetHeader>
						<ul className="list-none border-l border-rule">
								{chapters.map((c) => (
									<li key={c.label}>
										<button
											type="button"
											onClick={() => {
												seek(c.t);
												setSheet(null);
											}}
											className="block w-full py-1.5 pl-3 text-left font-reading text-[15px] text-ink hover:text-primary"
										>
											{c.label}
											<span className="ml-2 font-ui text-xs tabular-nums text-faint">{fmt(c.t)}</span>
										</button>
									</li>
								))}
							</ul>
					</SheetContent>
				</Sheet>
			)}
		</main>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	const is404 = isRouteErrorResponse(error) && error.status === 404;
	return (
		<main data-plate="ledger" className="mx-auto max-w-4xl px-6 py-12">
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
