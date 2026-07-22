import { useEffect, useRef, useState } from "react";
import { Link, isRouteErrorResponse, useFetcher, useLocation, useNavigate, useNavigation } from "react-router";
import { sql } from "drizzle-orm";
import {
	GROUP_KEYS,
	searchAll,
	type GroupKey,
	type ResultType,
	type SearchGroup,
	type SearchReference,
	type SearchResponse,
	type SearchResult,
} from "@lumen/scripture";
import {
	BookOpenIcon,
	CalendarIcon,
	FileTextIcon,
	HourglassIcon,
	ImageIcon,
	LanguagesIcon,
	LightbulbIcon,
	MapPinIcon,
	PlayIcon,
	ShapesIcon,
	TagIcon,
	UserRoundIcon,
	type LucideIcon,
} from "lucide-react";
import { getSessionUser } from "~/lib/auth.server";
import { getCollectionAccessStrict } from "~/lib/collection-access.server";
import { logSearchExecuted, logSearchFailed } from "~/lib/search-obs.server";
import { parseQ, parseScope, Q_MIN } from "~/lib/search-request.server";
import type { Route } from "./+types/search";

/** /search — the reader's search page (search-ui plan). SSR via searchAll
 * direct (Q4: no HTTP self-call), sharing the API's validation + OBS helpers
 * so each surface logs its own requests exactly once (Δ CU-6/OU-6). The
 * inline input live-updates through a debounced fetcher to /api/search;
 * Enter, scope clicks, and More-pills commit URL navigations (Q6). */

type SearchPageState = "empty" | "keepTyping" | "reference" | "results";

interface SearchLoaderData {
	state: SearchPageState;
	q: string;
	/** Included groups from the URL, canonicalized; null = all seven. */
	scope: GroupKey[] | null;
	/** Runtime-null on empty/keepTyping (F19 pins it); typed non-null because
	 * the harness dereferences data.results on query paths without narrowing. */
	results: SearchResponse;
	referenceHref: string | null;
	limitPerGroup: number;
	/** Q_MIN rides the payload — the client can't import the .server module. */
	qMin: number;
	headers: Headers;
}

/** Δ CU-3/ACU-2 density mapping (F8): fewer groups, deeper pages. */
export function adaptiveLimit(includedGroups: number): number {
	if (includedGroups >= 5) return 8;
	if (includedGroups >= 3) return 12;
	if (includedGroups === 2) return 18;
	return 25;
}

export interface MarkSegment {
	mark: boolean;
	text: string;
}

/** ⟪⟫ snippet markers → typed segments (F12). Unbalanced input degrades to
 * plain text with the markers stripped — the glyphs never reach the page. */
export function parseMarks(text: string): MarkSegment[] {
	const segs: MarkSegment[] = [];
	const plain = (t: string) => {
		if (t) segs.push({ mark: false, text: t });
	};
	let rest = text;
	for (;;) {
		const open = rest.indexOf("⟪");
		if (open === -1) {
			plain(rest.replaceAll("⟫", ""));
			break;
		}
		const close = rest.indexOf("⟫", open + 1);
		if (close === -1) {
			plain(rest.replaceAll("⟪", "").replaceAll("⟫", ""));
			break;
		}
		plain(rest.slice(0, open).replaceAll("⟫", ""));
		const inner = rest.slice(open + 1, close);
		if (inner) segs.push({ mark: true, text: inner });
		rest = rest.slice(close + 1);
	}
	return segs;
}

/** Δ AU-1/F21: the mark is a selbar underline, mixed 15% toward the theme's
 * ink so the decoration clears 3:1 on BOTH paper and bg-sel in all four
 * themes (WCAG ratios computed from the app.css hexes):
 *   paper     #3b5296 → 7.09:1 on #fafaf7 · 6.50:1 on #edf0f7
 *   parchment #9c7029 → 3.78:1 on #f3ede1 · 3.65:1 on #f6e9c8
 *   linen     #216681 → 5.89:1 on #f3f6f7 · 5.35:1 on #e0edf2
 *   ink       #d7ac61 → 8.42:1 on #17181c · 6.25:1 on #35301e
 * (the mockup's 60%-alpha selbar fails at 1.89–3.55:1; solid selbar leaves
 * parchment at 2.99:1 on bg-sel). */
const MARK_CLASS =
	"bg-transparent font-medium text-inherit underline decoration-[color-mix(in_srgb,var(--t-selbar)_85%,var(--t-ink))] decoration-2 underline-offset-4";

/** JSX children only — dangerouslySetInnerHTML is banned here (Δ SU-5). */
export function MarkedText({ text }: { text: string }) {
	return (
		<>
			{parseMarks(text).map((seg, i) =>
				seg.mark ? (
					<mark key={i} className={MARK_CLASS}>
						{seg.text}
					</mark>
				) : (
					seg.text
				),
			)}
		</>
	);
}

/** Moment deep-links come from the payload, never result.id — moment ids are
 * response-scoped and re-key on every M3 re-window (A6/APIC-6). */
export function momentHref(payload: Record<string, unknown>): string {
	return `/media/${encodeURIComponent(String(payload.episode_id))}?t=${Math.floor(Number(payload.t_start_s))}`;
}

/** Every client fetch to /api/search carries an EXPLICIT limit re-derived
 * from adaptive density — the API's default-8 would silently shrink
 * continuation pages (Δ CU-7/F20). */
export function buildPageFetchUrl({
	q,
	scope,
	after,
}: {
	q: string;
	scope: GroupKey[];
	after?: string;
}): string {
	const params = new URLSearchParams({
		q,
		scope: scope.join(","),
		limit: String(adaptiveLimit(scope.length)),
	});
	if (after !== undefined) params.set("after", after);
	return `/api/search?${params}`;
}

/** Append-time dedupe (Δ CU-4/F20): a re-windowed moment can arrive on the
 * next page under a brand-new id — identity is (episode_id, t_start_s).
 * Structurally generic so the harness's literal rows type-check too. */
export function dedupeMoments<
	T extends { type: string; id: string; payload: Record<string, unknown> },
>(existing: T[], appended: T[]): T[] {
	const seen = new Set<string>();
	const keyOf = (r: T) =>
		r.type === "moment"
			? `m:${String(r.payload.episode_id)}#${Number(r.payload.t_start_s)}`
			: `i:${r.type}:${r.id}`;
	const out: T[] = [];
	for (const r of [...existing, ...appended]) {
		const key = keyOf(r);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(r);
	}
	return out;
}

/** B-U2: only verse/chapter references SHORT-CIRCUIT (the engine skips FTS —
 * decision 4). A bare book/volume name ('moses') returns reference AND full
 * groups; suppressing them hid the whole graph behind the Book of Moses. */
function isShortCircuitReference(ref: SearchReference): boolean {
	return ref.level === "verse" || ref.level === "chapter";
}

function referencePath(ref: SearchReference): string | null {
	if (!ref.found || !ref.book_id) return null;
	if (ref.level === "verse" && ref.chapter !== undefined && ref.verse !== undefined) {
		return `/scripture/${ref.book_id}/${ref.chapter}?verse=${ref.verse}`;
	}
	if (ref.level === "chapter" && ref.chapter !== undefined) {
		return `/scripture/${ref.book_id}/${ref.chapter}`;
	}
	return `/scripture/${ref.book_id}`;
}

export async function loader({ request, context }: Route.LoaderArgs): Promise<SearchLoaderData> {
	// F17 (Δ SU-4): EVERY exit — returns and thrown Responses alike — carries
	// private, no-store; the body varies by session visibility.
	const headers = new Headers({ "Cache-Control": "private, no-store" });
	const url = new URL(request.url);

	const scopeResult = parseScope(url.searchParams.get("scope"));
	if (!scopeResult.ok) {
		throw new Response(scopeResult.message, { status: 400, headers });
	}
	const scope = scopeResult.value;
	const limitPerGroup = adaptiveLimit(scope?.length ?? GROUP_KEYS.length);

	const base = {
		scope: scope ?? null,
		// See SearchLoaderData.results: null at runtime, non-null in the type.
		results: null as unknown as SearchResponse,
		referenceHref: null,
		limitPerGroup,
		qMin: Q_MIN,
		headers,
	};

	const rawQ = url.searchParams.get("q");
	const qResult = parseQ(rawQ);
	if (!qResult.ok) {
		if (qResult.code === "q_required") {
			// Δ UU-2/F19: bare /search is a designed state, not a dead end.
			return { ...base, state: "empty", q: "" };
		}
		const trimmed = (rawQ ?? "").trim();
		if (trimmed.length < Q_MIN) {
			// Δ UU-9/F19: sub-Q_MIN issues no search at all.
			return { ...base, state: "keepTyping", q: trimmed };
		}
		throw new Response(qResult.message, { status: 400, headers });
	}
	const q = qResult.value;

	let visibility: "public" | "admin" = "public";
	try {
		const session = await getSessionUser(request, context.cloudflare.env);
		const user = session.user;
		const access = await getCollectionAccessStrict(context.db, user?.id ?? null);
		let visibleCollections = access.publicIds;
		if (access.entitled) {
			const rows = (await context.db.execute(
				sql`SELECT id FROM lumen.collections`,
			)) as Array<{ id: string }>;
			visibleCollections = rows.map((r) => r.id);
			visibility = "admin";
		}

		const results = await searchAll(context.db, { q, visibleCollections, scope, limitPerGroup });

		logSearchExecuted(results, { q, scope, visibility, userId: user?.id });

		const referenceHref = results.reference?.found ? referencePath(results.reference) : null;
		return {
			...base,
			state:
				results.reference?.found && isShortCircuitReference(results.reference)
					? "reference"
					: "results",
			q,
			results,
			referenceHref,
		};
	} catch (err) {
		logSearchFailed(err, { q, scope, visibility });
		throw new Response("Search failed", { status: 500, headers });
	}
}

/** The loader returns a plain object (the harness pins data.headers on it),
 * so loaderHeaders is empty — the document header is static here and covers
 * the error branches too. */
export function headers(_args: Route.HeadersArgs) {
	return { "Cache-Control": "private, no-store" };
}

export function meta({ data }: Route.MetaArgs) {
	const q = data?.q;
	return [{ title: q ? `“${q}” · Search · Lumen` : "Search · Lumen" }];
}

/* ─── rendering ─── */

const GROUP_LABELS: Record<GroupKey, string> = {
	scripture: "Scripture",
	people: "People",
	places: "Places",
	topics: "Topics",
	episodes: "Episodes",
	art: "Art",
	words: "Words",
};

const GROUP_ICONS: Record<GroupKey, LucideIcon> = {
	scripture: BookOpenIcon,
	people: UserRoundIcon,
	places: MapPinIcon,
	topics: TagIcon,
	episodes: PlayIcon,
	art: ImageIcon,
	words: LanguagesIcon,
};

const TYPE_ICONS: Record<ResultType, LucideIcon> = {
	verse: BookOpenIcon,
	jst: BookOpenIcon,
	person: UserRoundIcon,
	place: MapPinIcon,
	topic: TagIcon,
	principle: LightbulbIcon,
	symbol: ShapesIcon,
	event: CalendarIcon,
	era: HourglassIcon,
	summary: FileTextIcon,
	episode: PlayIcon,
	moment: PlayIcon,
	artwork: ImageIcon,
	strongs: LanguagesIcon,
};

/** entity_type -> typed node route (media.tsx precedent — the type is the slug). */
const TYPE_SLUGS: Record<string, string> = {
	person: "people",
	place: "places",
	principle: "principles",
	event: "events",
	symbol: "symbols",
	era: "eras",
};

const STARTING_QUERIES = ["melchizedek", "covenant", "faith unto repentance", "1 nephi 3:7"];

function fmt(s: number) {
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = Math.floor(s % 60);
	return h > 0
		? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
		: `${m}:${String(ss).padStart(2, "0")}`;
}

const BOOK_DISPLAY: Record<string, string> = { dc: "D&C" };
const bookDisplay = (id: string) =>
	BOOK_DISPLAY[id] ?? id.replace(/-/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());

interface ArtRef {
	book_id?: string;
	chapter?: number | string;
	verse_start?: number | string | null;
	verse_end?: number | string | null;
	is_primary?: boolean;
}

function artRefDisplay(ref: ArtRef): string {
	const base = `${bookDisplay(String(ref.book_id))} ${ref.chapter}`;
	if (ref.verse_start === null || ref.verse_start === undefined) return base;
	const range =
		ref.verse_end !== null && ref.verse_end !== undefined && ref.verse_end !== ref.verse_start
			? `–${ref.verse_end}`
			: "";
	return `${base}:${ref.verse_start}${range}`;
}

function resultHref(r: SearchResult): string | null {
	switch (r.type) {
		case "verse":
		case "jst": {
			const m = String(r.payload.verse_id ?? "").match(/^(.*)-(\d+)-(\d+)$/);
			return m ? `/scripture/${m[1]}/${m[2]}?verse=${m[3]}` : null;
		}
		case "summary":
			return r.payload.book_id && r.payload.chapter
				? `/scripture/${r.payload.book_id}/${r.payload.chapter}`
				: null;
		case "episode":
			return `/media/${encodeURIComponent(r.id)}`;
		case "moment":
			return momentHref(r.payload);
		case "artwork": {
			const refs = Array.isArray(r.payload.refs) ? (r.payload.refs as ArtRef[]) : [];
			const ref = refs.find((x) => x.is_primary) ?? refs[0];
			return ref?.book_id && ref.chapter ? `/scripture/${ref.book_id}/${ref.chapter}/art` : null;
		}
		case "strongs":
			return `/word/${encodeURIComponent(String(r.payload.strongs_no ?? r.id))}`;
		default:
			return `/${TYPE_SLUGS[r.type] ?? "node"}/${encodeURIComponent(r.id)}`;
	}
}

/** React keys must tolerate moment-id churn across appends (F10/A6). */
const rowKey = (r: SearchResult) =>
	r.type === "moment"
		? `m:${String(r.payload.episode_id)}#${Number(r.payload.t_start_s)}`
		: `${r.type}:${r.id}`;

function RowIcon({ type }: { type: ResultType }) {
	const Icon = TYPE_ICONS[type];
	return (
		<Icon
			aria-hidden="true"
			strokeWidth={1.8}
			className="mr-1.5 inline-block size-3.5 flex-none align-[-0.2em] text-faint"
		/>
	);
}

function RowBody({ groupKey, r }: { groupKey: GroupKey; r: SearchResult }) {
	if (groupKey === "scripture") {
		return (
			<>
				<span className="font-ui text-[11px] font-semibold tracking-[0.02em] text-faint">
					<RowIcon type={r.type} />
					<span className="text-ink transition-colors duration-150 group-focus:text-selbar">
						{r.title}
					</span>
					{r.type === "jst" && <span> · JST</span>}
				</span>
				<p className="mt-0.5 line-clamp-2 font-reading text-[15px] leading-relaxed text-ink">
					<MarkedText text={r.snippet ?? ""} />
				</p>
			</>
		);
	}
	if (groupKey === "episodes") {
		const t = r.payload.t_start_s;
		return (
			<>
				<span className="font-ui text-[11px] font-semibold tracking-[0.02em] text-faint">
					<RowIcon type={r.type} />
					{t !== undefined && t !== null && (
						<>
							<span className="font-bold tabular-nums text-primary">{fmt(Number(t))}</span>
							{" · "}
						</>
					)}
					<span>{r.title}</span>
				</span>
				<p className="mt-0.5 line-clamp-2 font-reading text-[15px] leading-relaxed text-ink">
					<MarkedText text={r.snippet ?? ""} />
				</p>
			</>
		);
	}
	if (groupKey === "art") {
		const thumb = typeof r.payload.thumbnail_url === "string" ? r.payload.thumbnail_url : null;
		const refs = Array.isArray(r.payload.refs) ? (r.payload.refs as ArtRef[]) : [];
		return (
			<>
				<span
					aria-hidden="true"
					className="float-right ml-3.5 flex size-12 flex-none items-center justify-center overflow-hidden rounded-md border border-rule2 bg-panel2 max-lg:hidden"
				>
					{thumb ? (
						<img src={thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
					) : (
						<ImageIcon aria-hidden="true" strokeWidth={1.5} className="size-4 text-faint" />
					)}
				</span>
				<span className="font-reading text-[15px] leading-normal text-ink">
					<RowIcon type={r.type} />
					{r.title}
				</span>
				<p className="mt-0.5 line-clamp-2 font-reading text-[15px] leading-relaxed text-muted-foreground">
					{r.snippet ? (
						<MarkedText text={r.snippet} />
					) : (
						refs
							.slice(0, 3)
							.map(artRefDisplay)
							.join(" · ")
					)}
				</p>
			</>
		);
	}
	if (groupKey === "words") {
		const parts = r.title.split(" ");
		const orig = parts.length > 1 ? parts[parts.length - 1] : "";
		const name = orig ? parts.slice(0, -1).join(" ") : r.title;
		return (
			<>
				<span className="font-reading text-[15px] leading-normal text-ink">
					<RowIcon type={r.type} />
					{name}
					{orig && <span className="ml-1.5 font-reading text-[19px]">{orig}</span>}
					<span className="ml-2 font-ui text-[11px] font-medium tracking-[0.02em] text-faint">
						{String(r.payload.strongs_no ?? "")}
					</span>
				</span>
				{r.snippet && (
					<p className="mt-0.5 line-clamp-2 font-reading text-[15px] leading-relaxed text-muted-foreground">
						<MarkedText text={r.snippet} />
					</p>
				)}
			</>
		);
	}
	// people / places / topics — the entity idiom.
	const typeWord = r.type === "summary" ? "chapter summary" : r.type;
	const title = r.type === "topic" ? r.title.charAt(0) + r.title.slice(1).toLowerCase() : r.title;
	return (
		<>
			<span className="font-reading text-[15px] leading-normal text-ink">
				<RowIcon type={r.type} />
				{title}
				<span className="ml-2 font-ui text-[11px] font-medium tracking-[0.02em] text-faint">
					{typeWord}
				</span>
			</span>
			{r.snippet && (
				<p className="mt-0.5 line-clamp-2 font-reading text-[15px] leading-relaxed text-muted-foreground">
					<MarkedText text={r.snippet} />
				</p>
			)}
		</>
	);
}

const ROW_CLASS =
	"group relative block rounded-lg px-3 py-2 outline-none transition-[box-shadow,background-color] duration-150 hover:ring-1 hover:ring-inset hover:ring-selbar/35 focus:bg-sel focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-selbar";

function ResultRow({ groupKey, r }: { groupKey: GroupKey; r: SearchResult }) {
	const href = resultHref(r);
	const body = <RowBody groupKey={groupKey} r={r} />;
	return (
		<li>
			{href ? (
				// tabIndex -1: rows are reached by roving ↑↓ focus, not Tab (Δ AU-2).
				<Link to={href} tabIndex={-1} data-result-row className={ROW_CLASS}>
					{body}
				</Link>
			) : (
				<div className={ROW_CLASS}>{body}</div>
			)}
		</li>
	);
}

function Kbd({ children }: { children: React.ReactNode }) {
	return (
		<kbd className="mx-0.5 rounded border border-rule2 px-1 py-px font-ui text-[10px] font-semibold">
			{children}
		</kbd>
	);
}

interface ApiSearchPage {
	query: string;
	reference: SearchReference | null;
	groups: SearchGroup[];
}

export default function SearchPage({ loaderData }: Route.ComponentProps) {
	const { state, q, results, referenceHref, qMin } = loaderData;
	const scopeParam = loaderData.scope;
	const location = useLocation();
	const navigate = useNavigate();
	const navigation = useNavigation();

	const included: GroupKey[] = (scopeParam as GroupKey[] | null) ?? [...GROUP_KEYS];
	const excludedCount = GROUP_KEYS.length - included.length;
	const singleScopeKey = included.length === 1 ? included[0] : null;

	const inputRef = useRef<HTMLInputElement>(null);
	const mainRef = useRef<HTMLElement>(null);
	const [input, setInput] = useState(q);
	const trimmed = input.trim();

	// ── live typing: debounced fetcher to /api/search (Q6/Δ UU-4) ──
	const liveFetcher = useFetcher<ApiSearchPage>();
	const debounceRef = useRef<number | undefined>(undefined);
	const liveQRef = useRef<string | null>(null);
	const [live, setLive] = useState<ApiSearchPage | null>(null);

	// ── single-scope pagination appends (Δ CU-7/CU-4) ──
	const pageFetcher = useFetcher<ApiSearchPage>();
	const pendingCursorRef = useRef<string | null>(null);
	const [extra, setExtra] = useState<{ results: SearchResult[]; nextCursor?: string } | null>(null);

	// A navigation commit discards in-flight live results and appends (Q6).
	useEffect(() => {
		liveQRef.current = null;
		setLive(null);
		setExtra(null);
		setInput((prev) => (prev.trim() === q ? prev : q));
	}, [location.key, q]);

	useEffect(() => {
		const d = liveFetcher.data;
		if (d && liveQRef.current !== null && d.query === liveQRef.current) setLive(d);
	}, [liveFetcher.data]);

	useEffect(() => {
		const d = pageFetcher.data;
		if (!d || pendingCursorRef.current === null) return;
		pendingCursorRef.current = null;
		const g = d.groups.find((x) => x.key === singleScopeKey);
		if (!g) return;
		setExtra((prev) => ({
			results: [...(prev?.results ?? []), ...g.results],
			nextCursor: g.nextCursor,
		}));
	}, [pageFetcher.data, singleScopeKey]);

	const onInputChange = (value: string) => {
		setInput(value);
		window.clearTimeout(debounceRef.current);
		const next = value.trim();
		if (next === q || next.length < qMin) {
			// Back to the SSR data / quiet keep-typing — no request (Δ UU-9).
			liveQRef.current = null;
			setLive(null);
			return;
		}
		debounceRef.current = window.setTimeout(() => {
			liveQRef.current = next;
			liveFetcher.load(buildPageFetchUrl({ q: next, scope: included }));
		}, 350);
	};

	const display = live ?? (state === "results" || state === "reference" ? results : null);
	const displayQ = live ? live.query : q;
	const displayReference = display?.reference?.found ? display.reference : null;
	const displayReferenceHref = live
		? displayReference && referencePath(displayReference)
		: referenceHref;

	const view: "empty" | "keepTyping" | "pending" | "reference" | "zero" | "results" =
		trimmed === ""
			? "empty"
			: trimmed.length < qMin
				? "keepTyping"
				: displayReference && isShortCircuitReference(displayReference)
					? "reference"
					: display
						? display.groups.some((g) => g.results.length > 0)
							? "results"
							: "zero"
						: "pending";

	// ── URL commits (Q6): Enter, scope clicks, restore-all ──
	const commitNavigate = (to: string) => {
		window.clearTimeout(debounceRef.current);
		liveQRef.current = null;
		navigate(to);
	};

	const searchUrl = (nextQ: string, nextScope: GroupKey[]) => {
		const params = new URLSearchParams();
		if (nextQ) params.set("q", nextQ);
		if (nextScope.length < GROUP_KEYS.length) params.set("scope", nextScope.join(","));
		const qs = params.toString();
		return qs ? `/search?${qs}` : "/search";
	};

	const onSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (trimmed === "") {
			commitNavigate("/search");
			return;
		}
		if (trimmed.length < qMin) return;
		// Second Enter on a resolved reference opens the reader (F13).
		if (trimmed === q && view === "reference" && displayReferenceHref) {
			commitNavigate(displayReferenceHref);
			return;
		}
		commitNavigate(searchUrl(trimmed, included));
	};

	const commitScope = (next: GroupKey[]) => {
		commitNavigate(searchUrl(trimmed.length >= qMin ? trimmed : q, next));
	};

	const toggleScope = (key: GroupKey) => {
		const isIncluded = included.includes(key);
		// Floor of one: the last included group cannot be excluded (Δ CU-3).
		if (isIncluded && included.length === 1) return;
		commitScope(
			isIncluded
				? included.filter((k) => k !== key)
				: GROUP_KEYS.filter((k) => included.includes(k) || k === key),
		);
	};

	// ── hotkeys on the page itself: / and ⌘K focus the inline input — the
	// modal never stacks here (F9); SearchModal stands down on /search. ──
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			const focusInline = () => {
				e.preventDefault();
				inputRef.current?.focus();
				inputRef.current?.select();
			};
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				// ⌘K works EVERYWHERE, inputs included (Decisions SU-6).
				focusInline();
				return;
			}
			if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
				const t = e.target as HTMLElement | null;
				const editable =
					t &&
					(t.tagName === "INPUT" ||
						t.tagName === "TEXTAREA" ||
						t.tagName === "SELECT" ||
						t.isContentEditable);
				if (!editable) focusInline();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	// ── roving ↑↓ selection: real row.focus(), survives appends (Δ AU-2/F11) ──
	const onMainKeyDown = (e: React.KeyboardEvent) => {
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		const rows = Array.from(
			mainRef.current?.querySelectorAll<HTMLAnchorElement>("[data-result-row]") ?? [],
		);
		if (rows.length === 0) return;
		const cur = rows.findIndex((r) => r === document.activeElement);
		if (cur === -1 && e.key === "ArrowUp") return;
		e.preventDefault();
		if (cur === 0 && e.key === "ArrowUp") {
			inputRef.current?.focus();
			return;
		}
		const next = e.key === "ArrowDown" ? Math.min(cur + 1, rows.length - 1) : cur - 1;
		rows[next]?.focus();
		rows[next]?.scrollIntoView({ block: "nearest" });
	};

	// ── delayed pending signal: skeleton-quiet under 300 ms ──
	const busy =
		navigation.state !== "idle" || liveFetcher.state !== "idle" || pageFetcher.state !== "idle";
	const [busySlow, setBusySlow] = useState(false);
	useEffect(() => {
		if (!busy) {
			setBusySlow(false);
			return;
		}
		const t = window.setTimeout(() => setBusySlow(true), 300);
		return () => window.clearTimeout(t);
	}, [busy]);

	// ── single-scope merge + continuation cursor ──
	const baseGroup = singleScopeKey
		? (display?.groups.find((g) => g.key === singleScopeKey) ?? null)
		: null;
	const mergedSingle =
		baseGroup && extra ? dedupeMoments(baseGroup.results, extra.results) : baseGroup?.results;
	const currentCursor = extra ? extra.nextCursor : baseGroup?.nextCursor;

	const loadMoreRef = useRef<() => void>(() => {});
	loadMoreRef.current = () => {
		if (!singleScopeKey || !currentCursor || pageFetcher.state !== "idle") return;
		pendingCursorRef.current = currentCursor;
		pageFetcher.load(buildPageFetchUrl({ q: displayQ, scope: [singleScopeKey], after: currentCursor }));
	};
	const sentinelRef = useRef<HTMLDivElement>(null);
	const hasCursor = currentCursor !== undefined;
	useEffect(() => {
		const el = sentinelRef.current;
		if (!el) return;
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((en) => en.isIntersecting)) loadMoreRef.current();
			},
			{ rootMargin: "200px" },
		);
		io.observe(el);
		return () => io.disconnect();
	}, [singleScopeKey, hasCursor]);

	const groupCount = (key: GroupKey): { n: number; truncated: boolean } | null => {
		const g = display?.groups.find((x) => x.key === key);
		if (!g) return null;
		if (key === singleScopeKey && mergedSingle) {
			return { n: mergedSingle.length, truncated: currentCursor !== undefined };
		}
		return { n: g.results.length, truncated: g.nextCursor !== undefined };
	};

	const totalShown = included.reduce((n, key) => n + (groupCount(key)?.n ?? 0), 0);
	const anyTruncated = included.some((key) => groupCount(key)?.truncated);
	const hasRows = view === "results" && totalShown > 0;

	const statusText = busySlow
		? "Searching…"
		: view === "results"
			? `${totalShown}${anyTruncated ? "+" : ""} ${totalShown === 1 ? "result" : "results"} for “${displayQ}”`
			: view === "zero"
				? `No results for “${displayQ}”`
				: view === "reference" && displayReference
					? `Reference — ${displayReference.display}`
					: "";

	const showScopeLine = view === "results" || view === "zero" || excludedCount > 0;

	return (
		<main ref={mainRef} className="mx-auto max-w-4xl px-6 py-10" onKeyDown={onMainKeyDown}>
			<header className="border-b border-rule pb-6">
				<p className="font-ui text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">
					<Link to="/" className="transition-colors duration-150 hover:text-ink">
						Lumen
					</Link>{" "}
					· Search
				</p>
				<form className="mt-3 max-w-prose" onSubmit={onSubmit}>
					<input
						ref={inputRef}
						type="search"
						value={input}
						onChange={(e) => onInputChange(e.target.value)}
						autoComplete="off"
						spellCheck={false}
						enterKeyHint="search"
						autoFocus={state === "empty"}
						aria-label="Search the library"
						placeholder="a name, a phrase, a verse — “melchizedek”, “covenant”, “1 nephi 3:7”…"
						className="w-full rounded-none border-0 border-b border-rule2 bg-transparent pb-2 pt-1 font-display text-[clamp(1.6rem,5.5vw,2.25rem)] font-medium leading-tight tracking-[-0.02em] text-ink caret-selbar outline-none transition-colors duration-150 placeholder:font-reading placeholder:text-[clamp(1.15rem,4vw,1.5rem)] placeholder:font-normal placeholder:italic placeholder:tracking-normal placeholder:text-faint focus-visible:border-selbar"
					/>
				</form>
				{/* Δ UU-7: no hotkey hint on touch; ↑↓ appears only once rows exist. */}
				<p className="mt-2 hidden font-ui text-xs font-medium text-faint pointer-fine:block">
					Press <Kbd>/</Kbd> anywhere to search
					{hasRows && (
						<>
							{" · "}
							<Kbd>↑</Kbd>
							<Kbd>↓</Kbd> to move
						</>
					)}
					{" · "}
					<Kbd>Enter</Kbd> to open
				</p>

				{showScopeLine && (
					<ul className="mt-6 flex flex-wrap gap-x-4 gap-y-1.5">
						{GROUP_KEYS.map((key) => {
							const isIncluded = included.includes(key);
							const count = isIncluded ? groupCount(key) : null;
							const lastIncluded = isIncluded && included.length === 1;
							return (
								<li key={key}>
									<button
										type="button"
										aria-pressed={isIncluded}
										aria-disabled={lastIncluded || undefined}
										onClick={() => toggleScope(key)}
										// after:-inset-y-2 over py-1 → 44 px hit box (house touch law, Δ UU-6)
										className={`relative py-1 font-ui text-sm font-semibold transition-colors duration-150 after:absolute after:-inset-x-1 after:-inset-y-2 after:content-[''] ${
											isIncluded
												? "text-primary hover:underline hover:underline-offset-4"
												: "text-faint line-through decoration-1 hover:text-muted-foreground"
										}`}
									>
										{GROUP_LABELS[key]}
										{count && (
											<span
												className={`ml-1.5 font-medium tabular-nums ${count.n === 0 ? "text-faint/70" : "text-faint"}`}
											>
												{count.n}
												{count.truncated ? "+" : ""}
											</span>
										)}
										<span className="sr-only">
											{isIncluded ? ", included — activate to exclude" : ", excluded — activate to include"}
										</span>
									</button>
								</li>
							);
						})}
						{excludedCount >= 2 && (
							<li>
								<button
									type="button"
									onClick={() => commitScope([...GROUP_KEYS])}
									className="relative py-1 font-ui text-sm font-semibold text-faint transition-colors duration-150 after:absolute after:-inset-x-1 after:-inset-y-2 after:content-[''] hover:text-primary"
								>
									Show all
								</button>
							</li>
						)}
					</ul>
				)}

				{/* The ONE aria-live region (house D9): fixed height, text swaps only.
				    The result list itself is never live (Δ AU-4). */}
				<div
					role="status"
					aria-live="polite"
					className="mt-3 flex h-5 items-center font-ui text-xs tabular-nums text-faint"
				>
					{statusText}
				</div>
			</header>

			{view === "empty" && (
				<div className="mt-12 max-w-prose">
					<p className="font-reading text-[17px] italic leading-relaxed text-muted-foreground">
						Search the whole library at once — scripture, people, places, topics, episodes, art,
						and the words behind the words.
					</p>
					<p className="mt-8 font-reading text-[17px] leading-relaxed text-muted-foreground">
						Some places to begin:
					</p>
					<ul className="mt-2 space-y-1.5">
						{STARTING_QUERIES.map((s) => (
							<li key={s}>
								<Link
									to={`/search?${new URLSearchParams({ q: s })}`}
									className="font-reading text-[17px] text-primary hover:underline hover:underline-offset-4"
								>
									“{s}”
								</Link>
							</li>
						))}
					</ul>
				</div>
			)}

			{view === "keepTyping" && (
				<p className="mt-12 max-w-prose font-reading text-[17px] italic leading-relaxed text-muted-foreground">
					Keep typing…
				</p>
			)}

			{view === "zero" && (
				<p className="mt-12 max-w-prose font-reading text-[17px] italic leading-relaxed text-muted-foreground">
					Nothing in the library matches <span className="not-italic">“{displayQ}”</span>
					{excludedCount > 0 ? " in the included groups" : ""}. Try a broader phrase, a name, or
					a book and chapter — “alma 32”.
				</p>
			)}

			{(view === "reference" || (view === "results" && displayReference)) && displayReference && (
				<div className="mt-10 border-b border-rule pb-4">
					<p className="font-ui text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
						Reference
					</p>
					{displayReferenceHref ? (
						<>
							<Link
								to={displayReferenceHref}
								className="group mt-2 inline-block font-display text-2xl font-medium tracking-tight text-ink"
							>
								{displayReference.display}{" "}
								<span
									aria-hidden="true"
									className="inline-block text-primary transition-transform duration-150 motion-safe:group-hover:translate-x-0.5"
								>
									→
								</span>
							</Link>
							{view === "reference" && (
								<p className="mt-1.5 font-reading text-[15px] italic text-muted-foreground">
									Opens the reader at {displayReference.display} — press Enter again to go.
								</p>
							)}
						</>
					) : (
						<p className="mt-2 font-display text-2xl font-medium tracking-tight text-ink">
							{displayReference.display}
						</p>
					)}
				</div>
			)}

			{view === "results" &&
				display &&
				included.map((key) => {
					const g = display.groups.find((x) => x.key === key);
					if (!g) return null;
					const rows = key === singleScopeKey && mergedSingle ? mergedSingle : g.results;
					if (rows.length === 0) return null;
					const GIcon = GROUP_ICONS[key];
					const count = groupCount(key);
					const truncated = count?.truncated ?? false;
					return (
						<section key={key} className="mt-11">
							{/* Fraunces sentence-case group header — never caps-tracked
							    (Abram's ban); the More-pill shows on truncation ONLY. */}
							<h2 className="flex items-center gap-2.5 border-b border-rule pb-2">
								<GIcon
									aria-hidden="true"
									strokeWidth={1.8}
									className="size-[1.05rem] flex-none text-faint"
								/>
								<span className="font-display text-xl font-medium tracking-tight text-ink">
									{GROUP_LABELS[key]}
								</span>
								<span className="font-ui text-xs font-medium tabular-nums text-faint">
									{count?.n}
									{truncated ? "+" : ""}
								</span>
								{truncated && !singleScopeKey && (
									<Link
										to={searchUrl(displayQ, [key])}
										className="relative ml-auto flex-none rounded-full border border-rule2 px-3 py-1 font-ui text-xs font-semibold text-primary transition-colors duration-150 after:absolute after:-inset-2 after:content-[''] hover:border-primary"
									>
										More in {GROUP_LABELS[key].toLowerCase()} →
									</Link>
								)}
							</h2>
							<ol className="mt-2 max-w-prose list-none space-y-0.5 p-0">
								{rows.map((r) => (
									<ResultRow key={rowKey(r)} groupKey={key} r={r} />
								))}
							</ol>
							{key === singleScopeKey && (
								<>
									{currentCursor !== undefined && (
										<>
											{/* Sentinel + explicit button: the button IS the
											    keyboard / reduced-motion / no-observer path. */}
											<div ref={sentinelRef} aria-hidden="true" className="h-px" />
											<p className="mt-4 pl-3">
												<button
													type="button"
													onClick={() => loadMoreRef.current()}
													disabled={pageFetcher.state !== "idle"}
													className="relative rounded-full border border-rule2 px-4 py-1.5 font-ui text-xs font-semibold text-primary transition-colors duration-150 after:absolute after:-inset-2 after:content-[''] hover:border-primary disabled:opacity-60"
												>
													{pageFetcher.state === "idle" ? "More" : "Loading…"}
												</button>
											</p>
										</>
									)}
									{currentCursor === undefined && extra && (
										<p className="mt-4 pl-3 font-reading text-[15px] italic text-muted-foreground">
											That’s everything.
										</p>
									)}
								</>
							)}
						</section>
					);
				})}
		</main>
	);
}

/** BRRU-2: the page recovers inline — root chrome (orb, menu) survives. */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	const isResponse = isRouteErrorResponse(error);
	const message =
		isResponse && error.status === 400
			? typeof error.data === "string" && error.data
				? error.data
				: "That search couldn’t be read."
			: "Search failed — nothing wrong with your query; the library hiccuped.";
	return (
		<main className="mx-auto max-w-4xl px-6 py-10">
			<header className="border-b border-rule pb-6">
				<p className="font-ui text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">
					<Link to="/" className="transition-colors duration-150 hover:text-ink">
						Lumen
					</Link>{" "}
					· Search
				</p>
			</header>
			<p className="mt-8 max-w-prose font-reading text-[17px] italic leading-relaxed text-muted-foreground">
				{message}
			</p>
			<p className="mt-4">
				<Link
					to="/search"
					className="font-ui text-sm font-semibold text-primary underline underline-offset-4"
				>
					Start a new search
				</Link>
			</p>
		</main>
	);
}
