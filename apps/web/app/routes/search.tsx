import { useEffect, useRef, useState } from "react";
import {
	data,
	Link,
	isRouteErrorResponse,
	useFetcher,
	useLocation,
	useNavigate,
	useNavigation,
} from "react-router";
import { sql } from "drizzle-orm";
import {
	GROUP_KEYS,
	searchAll,
	type GroupKey,
	type ResultType,
	type SearchGroup,
	type SearchReference,
	type SearchResult,
} from "@lumen/scripture";
import {
	BookOpenIcon,
	CalendarIcon,
	FileTextIcon,
	HourglassIcon,
	ImageIcon,
	CircleHelpIcon,
	LanguagesIcon,
	LightbulbIcon,
	MapPinIcon,
	NotebookPenIcon,
	PlayIcon,
	ShapesIcon,
	TagIcon,
	UserRoundIcon,
	XIcon,
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

/** The client-facing search payload — {query, reference, groups} only. The page
 * loader and the /api/search fetcher return the SAME shape; `meta` (raw DB error
 * strings) is stripped before it reaches the hydration payload (B10). */
interface ApiSearchPage {
	query: string;
	reference: SearchReference | null;
	groups: SearchGroup[];
}

interface SearchLoaderData {
	state: SearchPageState;
	q: string;
	/** Included groups from the URL, canonicalized; null = all seven. */
	scope: GroupKey[] | null;
	/** Runtime-null on empty/keepTyping (F19 pins it); typed non-null because
	 * the harness dereferences data.results on query paths without narrowing. */
	results: ApiSearchPage;
	referenceHref: string | null;
	limitPerGroup: number;
	/** Q_MIN rides the payload — the client can't import the .server module. */
	qMin: number;
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

/** The API's q upper bound (parseQ enforces 2–200): the client gates ≤ Q_MAX so a
 * >200-char live query never round-trips to a silent 400 (B7). */
const Q_MAX = 200;

/** RR single-fetch RETURNS API 400/500 bodies as `fetcher.data = {error,code}`
 * (never the ErrorBoundary), so every fetcher consumer shape-guards before it
 * touches `.groups` (B3/B7). */
export function isApiPage(d: unknown): d is ApiSearchPage {
	return typeof d === "object" && d !== null && Array.isArray((d as { groups?: unknown }).groups);
}

/** F17 (Δ SU-4): Cache-Control on EVERY exit — and B4: the session's
 * token-rotation Set-Cookie preserved when present (undefined pre-session). */
function withNoStore(session?: Headers): Headers {
	const headers = new Headers(session);
	headers.set("Cache-Control", "private, no-store");
	return headers;
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const url = new URL(request.url);

	const scopeResult = parseScope(url.searchParams.get("scope"));
	if (!scopeResult.ok) {
		throw new Response(scopeResult.message, { status: 400, headers: withNoStore() });
	}
	const scope = scopeResult.value;
	const limitPerGroup = adaptiveLimit(scope?.length ?? GROUP_KEYS.length);

	const base = {
		scope: scope ?? null,
		// See SearchLoaderData.results: null at runtime, non-null in the type.
		results: null as unknown as ApiSearchPage,
		referenceHref: null,
		limitPerGroup,
		qMin: Q_MIN,
	};

	const rawQ = url.searchParams.get("q");
	const qResult = parseQ(rawQ);
	if (!qResult.ok) {
		if (qResult.code === "q_required") {
			// Δ UU-2/F19: bare /search is a designed state, not a dead end.
			return data({ ...base, state: "empty", q: "" } satisfies SearchLoaderData, {
				headers: withNoStore(),
			});
		}
		const trimmed = (rawQ ?? "").trim();
		if (trimmed.length < Q_MIN) {
			// Δ UU-9/F19: sub-Q_MIN issues no search at all.
			return data({ ...base, state: "keepTyping", q: trimmed } satisfies SearchLoaderData, {
				headers: withNoStore(),
			});
		}
		throw new Response(qResult.message, { status: 400, headers: withNoStore() });
	}
	const q = qResult.value;

	// B4: `session.headers` (token-rotation Set-Cookie) must survive client-nav —
	// hoisted so the 500-throw path can attach it too (mirror api.search.tsx).
	let sessionHeaders: Headers | undefined;
	let visibility: "public" | "admin" = "public";
	try {
		const session = await getSessionUser(request, context.cloudflare.env);
		const user = session.user;
		sessionHeaders = session.headers;
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

		// B16: this surface is the page loader (a URL navigation), distinct from the
		// /api/search fetcher — so Enter-after-debounce isn't double-counted.
		logSearchExecuted(results, { q, scope, visibility, userId: user?.id, surface: "page" });

		const referenceHref = results.reference?.found ? referencePath(results.reference) : null;
		return data(
			{
				...base,
				state:
					results.reference?.found && isShortCircuitReference(results.reference)
						? "reference"
						: "results",
				q,
				// B10: strip `meta` (raw DB combinedError/error strings) — the client
				// reads only these three, exactly like api.search.tsx.
				results: { query: results.query, reference: results.reference, groups: results.groups },
				referenceHref,
			} satisfies SearchLoaderData,
			{ headers: withNoStore(sessionHeaders) },
		);
	} catch (err) {
		logSearchFailed(err, { q, scope, visibility, surface: "page" });
		throw new Response("Search failed", { status: 500, headers: withNoStore(sessionHeaders) });
	}
}

/** B4: forward the loader's headers (Cache-Control + any session Set-Cookie set
 * on the `data(…,{headers})` return) to the document response, guaranteeing the
 * F17 header even when loaderHeaders is empty. */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	const headers = new Headers(loaderHeaders);
	headers.set("Cache-Control", "private, no-store");
	return headers;
}

export function meta({ data: d }: Route.MetaArgs) {
	const q = d?.q;
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
	// personal-notes A15: the personal layer's mark (register + result rows)
	note: NotebookPenIcon,
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

/** B11: the words leg ships translit/original/lang/dir as payload fields — read
 * them directly rather than splitting `title` on its last space (354/20,734
 * strongs titles carry a multi-word original the split mangled, e.g. "οὐ μή"). */
export function wordParts(r: SearchResult): {
	name: string;
	original: string;
	lang?: string;
	dir?: "rtl" | "ltr";
} {
	const original = typeof r.payload.original === "string" ? r.payload.original : "";
	const translit = typeof r.payload.translit === "string" ? r.payload.translit : "";
	const lang = typeof r.payload.lang === "string" ? r.payload.lang : undefined;
	const dir = r.payload.dir === "rtl" || r.payload.dir === "ltr" ? r.payload.dir : undefined;
	return { name: translit || r.title, original, lang, dir };
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
		const { name, original, lang, dir } = wordParts(r);
		return (
			<>
				<span className="font-reading text-[15px] leading-normal text-ink">
					<RowIcon type={r.type} />
					{name}
					{original && (
						// B11: original script from the payload — carries its own lang/dir so
						// screen readers don't voice Hebrew/Greek with the page language.
						<span lang={lang} dir={dir} className="ml-1.5 font-reading text-[19px]">
							{original}
						</span>
					)}
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

function ResultRow({
	groupKey,
	r,
	tabStop,
	onFocus,
}: {
	groupKey: GroupKey;
	r: SearchResult;
	tabStop: boolean;
	onFocus: () => void;
}) {
	const href = resultHref(r);
	const body = <RowBody groupKey={groupKey} r={r} />;
	return (
		<li>
			{href ? (
				// Roving tab-stop (Δ AU-2/AC-3/B15): the active row is tabIndex 0 so Tab
				// reaches the list and ↑↓ move from it; the rest are -1.
				<Link
					to={href}
					tabIndex={tabStop ? 0 : -1}
					data-result-row
					onFocus={onFocus}
					className={ROW_CLASS}
				>
					{body}
				</Link>
			) : (
				<div className={ROW_CLASS}>{body}</div>
			)}
		</li>
	);
}

/** A10: inline example query in the syntax help — reads as content, not chrome. */
function Sample({ children }: { children: React.ReactNode }) {
	return <span className="font-medium text-ink">{children}</span>;
}

/** A10: a word called out mid-sentence (a keyword, or the matched form). */
function Term({ children }: { children: React.ReactNode }) {
	return <em className="font-medium not-italic text-ink">{children}</em>;
}

function Kbd({ children }: { children: React.ReactNode }) {
	return (
		<kbd className="mx-0.5 rounded border border-rule2 px-1 py-px font-ui text-[10px] font-semibold">
			{children}
		</kbd>
	);
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
	// B7/OC-3: a live fetch that returns an API error body (or an over-long query)
	// shows a quiet inline state, never leaves the view stuck "pending".
	const [liveError, setLiveError] = useState(false);

	// ── single-scope pagination appends (Δ CU-7/CU-4) ──
	const pageFetcher = useFetcher<ApiSearchPage>();
	const pendingCursorRef = useRef<string | null>(null);
	const [extra, setExtra] = useState<{ results: SearchResult[]; nextCursor?: string } | null>(null);
	// B3/CC-4: an append fetch that returns an API error body shows an inline retry,
	// never a TypeError that swaps the whole page to the ErrorBoundary.
	const [pageError, setPageError] = useState(false);
	// B5/AC-1: a keyboard-initiated "More" moves focus to the first appended row so
	// the roving anchor survives the append; pointer / sentinel appends leave it null.
	const appendAnchorRef = useRef<number | null>(null);
	// B15/AC-3: the roving tab-stop — the row Tab lands on and ↑↓ move from.
	const [rovingKey, setRovingKey] = useState<string | null>(null);

	// A navigation commit discards in-flight live results and appends (Q6). B2/CC-3:
	// the pending append cursor + roving anchor + error flags reset here too.
	useEffect(() => {
		liveQRef.current = null;
		setLive(null);
		setLiveError(false);
		setExtra(null);
		setPageError(false);
		pendingCursorRef.current = null;
		setRovingKey(null);
		setInput((prev) => (prev.trim() === q ? prev : q));
	}, [location.key, q]);

	useEffect(() => {
		const d = liveFetcher.data as unknown;
		if (d === undefined || liveQRef.current === null) return;
		if (!isApiPage(d)) {
			// B7/OC-3: API 400/500 bodies land in fetcher.data (no `query` key), not
			// the boundary — surface a quiet failure rather than showing stale results.
			setLiveError(true);
			return;
		}
		if (d.query === liveQRef.current) {
			setLive(d);
			setLiveError(false);
		}
	}, [liveFetcher.data]);

	useEffect(() => {
		const d = pageFetcher.data as unknown;
		if (d === undefined || pendingCursorRef.current === null) return;
		pendingCursorRef.current = null;
		if (!isApiPage(d)) {
			// B3/CC-4: never dereference an error body's `.groups` — retry inline.
			setPageError(true);
			return;
		}
		setPageError(false);
		const g = d.groups.find((x) => x.key === singleScopeKey);
		if (!g) return;
		setExtra((prev) => ({
			results: [...(prev?.results ?? []), ...g.results],
			nextCursor: g.nextCursor,
		}));
	}, [pageFetcher.data, singleScopeKey]);

	// B27/PC-4: a debounce still pending when the user clicks a result <Link> would
	// fire a post-unmount /api/search round trip — clear it on unmount.
	useEffect(() => () => window.clearTimeout(debounceRef.current), []);

	const onInputChange = (value: string) => {
		setInput(value);
		window.clearTimeout(debounceRef.current);
		const next = value.trim();
		if (next !== q) {
			// The displayed query is leaving the committed single-scope page — its
			// appended pages, pending cursor, and roving anchor no longer belong to
			// it (B2/CC-2), so a later More can't replay an old cursor.
			setExtra(null);
			pendingCursorRef.current = null;
			setRovingKey(null);
		}
		if (next === q || next.length < qMin || next.length > Q_MAX) {
			// Back to SSR data / quiet keep-typing / too-long — no request (Δ UU-9, B7).
			liveQRef.current = null;
			setLive(null);
			setLiveError(false);
			return;
		}
		setLiveError(false);
		debounceRef.current = window.setTimeout(() => {
			liveQRef.current = next;
			liveFetcher.load(buildPageFetchUrl({ q: next, scope: included }));
		}, 350);
	};

	// B7: re-issue the live fetch after a transient failure (no debounce — the
	// user asked for it explicitly).
	const retryLive = () => {
		if (trimmed.length < qMin || trimmed.length > Q_MAX) return;
		window.clearTimeout(debounceRef.current);
		setLiveError(false);
		liveQRef.current = trimmed;
		liveFetcher.load(buildPageFetchUrl({ q: trimmed, scope: included }));
	};

	const display = live ?? (state === "results" || state === "reference" ? results : null);
	const displayQ = live ? live.query : q;
	const displayReference = display?.reference?.found ? display.reference : null;
	const displayReferenceHref = live
		? displayReference && referencePath(displayReference)
		: referenceHref;

	const view: "empty" | "keepTyping" | "pending" | "reference" | "zero" | "results" | "error" =
		trimmed === ""
			? "empty"
			: trimmed.length < qMin
				? "keepTyping"
				: trimmed.length > Q_MAX || liveError
					? "error"
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
		// A resolved reference (committed OR live-typed) opens the reader on Enter —
		// keyed on the DISPLAYED query, not the stale committed `q` (F13/B22).
		if (view === "reference" && displayReferenceHref) {
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
		// B24: entering / moving among rows cancels a pending live re-fetch so a
		// debounce firing mid-navigation can't re-key the list and drop the row.
		window.clearTimeout(debounceRef.current);
		if (cur === 0 && e.key === "ArrowUp") {
			inputRef.current?.focus();
			return;
		}
		const next = e.key === "ArrowDown" ? Math.min(cur + 1, rows.length - 1) : cur - 1;
		rows[next]?.focus();
		rows[next]?.scrollIntoView({ block: "nearest" });
	};

	// ── delayed pending signal: skeleton-quiet under 300 ms ──
	// B8/UC-3: `view === "pending"` (typed past qMin, first results not yet in)
	// starts the slow-timer at the keystroke so it spans the 350 ms debounce.
	const busy =
		navigation.state !== "idle" ||
		liveFetcher.state !== "idle" ||
		pageFetcher.state !== "idle" ||
		view === "pending";
	const [busySlow, setBusySlow] = useState(false);
	// A10 (human, live-test): advanced-syntax help — icon toggle, instructions
	// render between the input row and the scope line.
	const [syntaxOpen, setSyntaxOpen] = useState(false);
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

	// B5/AC-1: once a keyboard-initiated append lands, move focus to the first
	// newly-appended row so ↑↓ keeps an anchor (and the unmounting "More" button
	// on the final page doesn't drop focus to <body>).
	useEffect(() => {
		if (appendAnchorRef.current === null) return;
		const anchor = appendAnchorRef.current;
		appendAnchorRef.current = null;
		const rows = Array.from(
			mainRef.current?.querySelectorAll<HTMLElement>("[data-result-row]") ?? [],
		);
		const target = rows[anchor] ?? rows[rows.length - 1];
		target?.focus();
		target?.scrollIntoView({ block: "nearest" });
	}, [mergedSingle?.length]);

	const loadMoreRef = useRef<(viaKeyboard?: boolean) => void>(() => {});
	loadMoreRef.current = (viaKeyboard = false) => {
		if (!singleScopeKey || !currentCursor || pageFetcher.state !== "idle") return;
		pendingCursorRef.current = currentCursor;
		appendAnchorRef.current = viaKeyboard ? (mergedSingle?.length ?? 0) : null;
		pageFetcher.load(
			buildPageFetchUrl({ q: displayQ, scope: [singleScopeKey], after: currentCursor }),
		);
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

	// B15/AC-3: the roving tab-stop key. Default to the first rendered row so Tab
	// reaches the list and ↑↓ work on a fresh SSR load; a stale key (after a query
	// change) that matches no rendered row falls back to the first row.
	let firstRowKey: string | null = null;
	const renderedKeys = new Set<string>();
	if (view === "results" && display) {
		for (const gk of included) {
			const g = display.groups.find((x) => x.key === gk);
			const gkRows = gk === singleScopeKey && mergedSingle ? mergedSingle : g?.results;
			if (gkRows) {
				for (const row of gkRows) {
					const k = rowKey(row);
					renderedKeys.add(k);
					if (firstRowKey === null) firstRowKey = k;
				}
			}
		}
	}
	const activeRowKey = rovingKey && renderedKeys.has(rovingKey) ? rovingKey : firstRowKey;

	const statusText = busySlow
		? "Searching…"
		: view === "results"
			? `${totalShown}${anyTruncated ? "+" : ""} ${totalShown === 1 ? "result" : "results"} for “${displayQ}”`
			: view === "zero"
				? `No results for “${displayQ}”`
				: view === "keepTyping"
					? // B24/AC-8: parity with the sighted "Keep typing…" state.
						`Keep typing — at least ${qMin} characters`
					: view === "error"
						? trimmed.length > Q_MAX
							? `Search is too long — keep it under ${Q_MAX} characters`
							: "Something went wrong — try again"
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
				<form className="relative mt-3 max-w-prose" onSubmit={onSubmit}>
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
						// B-U3: the native search-cancel X is OS chrome, off-brand — killed
						// here; the branded clear button below replaces it.
						className="w-full rounded-none border-0 border-b border-rule2 bg-transparent pb-2 pt-1 pr-9 font-display text-[clamp(1.6rem,5.5vw,2.25rem)] font-medium leading-tight tracking-[-0.02em] text-ink caret-selbar outline-none transition-colors duration-150 placeholder:font-reading placeholder:text-[clamp(1.15rem,4vw,1.5rem)] placeholder:font-normal placeholder:italic placeholder:tracking-normal placeholder:text-faint focus-visible:border-selbar [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none"
					/>
					{input !== "" && (
						<button
							type="button"
							aria-label="Clear search"
							onClick={() => {
								onInputChange("");
								inputRef.current?.focus();
							}}
							className="absolute bottom-3 right-0 -m-2 p-2 text-faint transition-colors duration-150 hover:text-ink"
						>
							<XIcon aria-hidden="true" strokeWidth={1.8} className="size-4" />
						</button>
					)}
				</form>
				{/* Δ UU-7: no hotkey hint on touch; ↑↓ appears only once rows exist.
				    A10: the syntax toggle is universal — touch users get it too. */}
				<div className="mt-2 flex items-baseline justify-between gap-4">
					<p className="hidden font-ui text-xs font-medium text-faint pointer-fine:block">
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
					<button
						type="button"
						aria-expanded={syntaxOpen}
						aria-controls="search-syntax"
						onClick={() => setSyntaxOpen((v) => !v)}
						className={`relative ml-auto flex items-center gap-1.5 font-ui text-xs font-semibold transition-colors duration-150 after:absolute after:-inset-2 after:content-[''] ${
							syntaxOpen ? "text-primary" : "text-faint hover:text-primary"
						}`}
					>
						<CircleHelpIcon aria-hidden="true" strokeWidth={1.8} className="size-3.5" />
						Search syntax
					</button>
				</div>
				{syntaxOpen && (
					<div
						id="search-syntax"
						className="mt-3 max-w-prose font-reading text-[15px] leading-relaxed"
					>
						<p className="text-ink">
							Type plain words for most searches. A few extras, when you want them:
						</p>
						<ul className="mt-2.5 space-y-2 text-muted-foreground">
							<li>
								<Sample>“wall of Jerusalem”</Sample> — quotation marks keep words together,
								as one exact phrase.
							</li>
							<li>
								<Sample>faith OR hope</Sample> — the word <Term>OR</Term>, in capitals,
								finds either one.
							</li>
							<li>
								<Sample>temple -solomon</Sample> — a minus sign right before a word leaves
								it out.
							</li>
						</ul>
						<p className="mt-3 text-muted-foreground">
							The rest is automatic: <Sample>believe</Sample> also finds{" "}
							<Term>believeth</Term>, a misspelled name like <Sample>melchisedek</Sample>{" "}
							still finds Melchizedek, and a reference like <Sample>1 Nephi 3:7</Sample>{" "}
							opens the verse.
						</p>
					</div>
				)}

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
										// B9/UC-4: a pointer click must not leave the button focused, or
										// Space-to-scroll re-fires the toggle (the B-U1 hijack mode).
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => toggleScope(key)}
										// after:-inset-y-2 over py-1 → 44 px hit box (house touch law, Δ UU-6)
										className={`relative py-1 font-ui text-sm font-semibold transition-colors duration-150 after:absolute after:-inset-x-1 after:-inset-y-2 after:content-[''] focus-visible:outline-none focus-visible:underline focus-visible:decoration-selbar focus-visible:decoration-2 focus-visible:underline-offset-4 ${
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
											{/* B23/AC-7: the floor-of-1 toggle no-ops — don't tell SR users to
											    "activate to exclude" it. */}
											{lastIncluded
												? ", included — at least one group must stay included"
												: isIncluded
													? ", included — activate to exclude"
													: ", excluded — activate to include"}
										</span>
									</button>
								</li>
							);
						})}
						{excludedCount >= 2 && (
							<li>
								<button
									type="button"
									onMouseDown={(e) => e.preventDefault()}
									onClick={() => commitScope([...GROUP_KEYS])}
									className="relative py-1 font-ui text-sm font-semibold text-faint transition-colors duration-150 after:absolute after:-inset-x-1 after:-inset-y-2 after:content-[''] hover:text-primary focus-visible:outline-none focus-visible:underline focus-visible:decoration-selbar focus-visible:decoration-2 focus-visible:underline-offset-4"
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
					<p className="font-reading text-[17px] leading-relaxed text-muted-foreground">
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
				<p className="mt-12 max-w-prose font-reading text-[17px] leading-relaxed text-muted-foreground">
					Keep typing…
				</p>
			)}

			{/* B8/UC-3: a quiet placeholder while the first live results resolve —
			    shown only after the 300 ms slow-timer (which now spans the debounce). */}
			{view === "pending" && busySlow && (
				<ul className="mt-12 max-w-prose space-y-3" aria-hidden="true">
					{[0, 1, 2, 3].map((i) => (
						<li key={i} className="h-4 rounded bg-rule2/50" style={{ width: `${72 - i * 11}%` }} />
					))}
				</ul>
			)}

			{/* B7/CC-6/OC-3: a live-fetch failure or an over-long query never leaves a
			    blank void — quiet copy, with a retry for the transient case. */}
			{view === "error" && (
				<p className="mt-12 max-w-prose font-reading text-[17px] leading-relaxed text-muted-foreground">
					{trimmed.length > Q_MAX ? (
						<>That’s a very long search — try fewer than {Q_MAX} characters.</>
					) : (
						<>
							Something went wrong reaching the library.{" "}
							<button
								type="button"
								onMouseDown={(e) => e.preventDefault()}
								onClick={retryLive}
								className="font-ui text-[15px] font-semibold not-italic text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-selbar"
							>
								Try again
							</button>
							.
						</>
					)}
				</p>
			)}

			{/* B6/CC-5: a found book/volume reference renders its lead even when its
			    groups are empty (zero copy sits beneath) — never suppress a valid
			    reader door. */}
			{displayReference && (view === "reference" || view === "results" || view === "zero") && (
				<div className="mt-10">
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
								<p className="mt-1.5 font-reading text-[15px] text-muted-foreground">
									{/* B22/UC-8: one Enter opens the reader now (onSubmit is keyed on
									    the displayed query), so the count is honest. */}
									Opens the reader at {displayReference.display} — press Enter to open.
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

			{view === "zero" && (
				<p className="mt-12 max-w-prose font-reading text-[17px] leading-relaxed text-muted-foreground">
					Nothing in the library matches <span className="not-italic">“{displayQ}”</span>
					{excludedCount > 0 ? " in the included groups" : ""}. Try a broader phrase, a name, or
					a book and chapter — “alma 32”.
				</p>
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
							<h2 className="flex items-center gap-2.5 pb-1">
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
									<ResultRow
										key={rowKey(r)}
										groupKey={key}
										r={r}
										tabStop={rowKey(r) === activeRowKey}
										onFocus={() => setRovingKey(rowKey(r))}
									/>
								))}
							</ol>
							{key === singleScopeKey && (
								<>
									{pageError ? (
										// B3/CC-4: an append error surfaces here — never a page crash.
										<p className="mt-4 pl-3 font-reading text-[15px] text-muted-foreground">
											Couldn’t load more.{" "}
											<button
												type="button"
												onMouseDown={(e) => e.preventDefault()}
												onClick={(e) => {
													setPageError(false);
													loadMoreRef.current(e.detail === 0);
												}}
												className="font-ui text-xs font-semibold not-italic text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-selbar"
											>
												Try again
											</button>
										</p>
									) : currentCursor !== undefined ? (
										<>
											{/* Sentinel + explicit button: the button IS the
											    keyboard / reduced-motion / no-observer path. B5: not
											    disabled while loading (that blurs focus to <body>) —
											    aria-busy + loadMoreRef's own idle guard instead. */}
											<div ref={sentinelRef} aria-hidden="true" className="h-px" />
											<p className="mt-4 pl-3">
												<button
													type="button"
													onMouseDown={(e) => e.preventDefault()}
													onClick={(e) => loadMoreRef.current(e.detail === 0)}
													aria-busy={pageFetcher.state !== "idle"}
													className="relative rounded-full border border-rule2 px-4 py-1.5 font-ui text-xs font-semibold text-primary transition-colors duration-150 after:absolute after:-inset-2 after:content-[''] hover:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-selbar"
												>
													{pageFetcher.state === "idle" ? "More" : "Loading…"}
												</button>
											</p>
										</>
									) : extra ? (
										<p className="mt-4 pl-3 font-reading text-[15px] text-muted-foreground">
											That’s everything.
										</p>
									) : null}
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

	// B29/BRRC-3: on the errored /search the page's own hotkey effect is
	// unmounted and SearchModal still stands down by pathname, so `/` and ⌘K would
	// be dead on the one page whose hint says "Press / anywhere". Render a working
	// input here and rebind the hotkeys so recovery never depends on the modal.
	const navigate = useNavigate();
	const inputRef = useRef<HTMLInputElement>(null);
	const [value, setValue] = useState("");
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			const focusInline = () => {
				e.preventDefault();
				inputRef.current?.focus();
				inputRef.current?.select();
			};
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
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

	return (
		<main className="mx-auto max-w-4xl px-6 py-10">
			<header className="border-b border-rule pb-6">
				<p className="font-ui text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">
					<Link to="/" className="transition-colors duration-150 hover:text-ink">
						Lumen
					</Link>{" "}
					· Search
				</p>
				<form
					className="relative mt-3 max-w-prose"
					onSubmit={(e) => {
						e.preventDefault();
						const t = value.trim();
						navigate(t ? `/search?${new URLSearchParams({ q: t })}` : "/search");
					}}
				>
					<input
						ref={inputRef}
						type="search"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						autoComplete="off"
						spellCheck={false}
						enterKeyHint="search"
						aria-label="Search the library"
						placeholder="a name, a phrase, a verse…"
						className="w-full rounded-none border-0 border-b border-rule2 bg-transparent pb-2 pt-1 font-display text-[clamp(1.6rem,5.5vw,2.25rem)] font-medium leading-tight tracking-[-0.02em] text-ink caret-selbar outline-none transition-colors duration-150 placeholder:font-reading placeholder:text-[clamp(1.15rem,4vw,1.5rem)] placeholder:font-normal placeholder:italic placeholder:tracking-normal placeholder:text-faint focus-visible:border-selbar [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none"
					/>
				</form>
			</header>
			<p className="mt-8 max-w-prose font-reading text-[17px] leading-relaxed text-muted-foreground">
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
