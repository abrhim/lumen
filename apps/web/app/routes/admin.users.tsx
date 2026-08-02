import { useEffect, useRef, useState } from "react";
import {
	Link,
	data,
	isRouteErrorResponse,
	useFetcher,
	useLocation,
	useNavigation,
	useRouteError,
	useSearchParams,
	useSubmit,
} from "react-router";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, SearchIcon, XIcon } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { getSessionUser } from "~/lib/auth.server";
import { ADMIN_USERS, requireEntitlement } from "~/lib/entitlements.server";
import {
	loadUsersPage,
	type AdminUserRow,
	type SortDir,
	type SortKey,
} from "~/lib/admin-users.server";
import type { Route } from "./+types/admin.users";

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Users · Admin · Lintel" }];
}

/**
 * Admin all-users list (plan D6-D12). The route ErrorBoundary below RE-THROWS
 * any 404 so it bubbles to root and replaces <App> (no chrome/PII leak); it only
 * handles non-404 failures locally so a background page-fetch blip can't nuke
 * the view (B6). Perfect existence-concealment is not achievable (the route
 * table ships in the public client manifest) and was never the goal — the
 * entitlement gate is the control (D10). See the ErrorBoundary for the residual.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
	// Gate FIRST (D4/H3): no user query runs unless this resolves. The return
	// is load-bearing (CR-1) — consuming it means a forgotten `await` cannot
	// compile. 404 not 403 (D10). Session read precedes it only to supply the
	// userId the gate needs; rotation headers ride every outcome we control.
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	const { userId } = await requireEntitlement(context.db, user?.id ?? null, ADMIN_USERS);
	const page = await loadUsersPage(context.db, new URL(request.url).searchParams);
	return data({ ...page, viewer: userId }, { headers });
}

/* ---------------------------------- UI ---------------------------------- */

const SORT_LABELS: Record<SortKey, string> = {
	created: "Joined",
	seen: "Last seen",
	email: "Email",
};
const STATUS_LABELS = { confirmed: "Confirmed", banned: "Banned", anonymous: "Anonymous" } as const;

const joinedFmt = new Intl.DateTimeFormat("en-GB", {
	day: "numeric",
	month: "short",
	year: "numeric",
});
const absoluteFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** COALESCE'd 'epoch' sentinel from the view (D2) = "never". */
function isNever(d: Date | string): boolean {
	return new Date(d).getTime() <= 0;
}

function relativeSeen(d: Date | string): string {
	const then = new Date(d).getTime();
	const days = Math.floor((Date.now() - then) / 86_400_000);
	if (days <= 0) return "today";
	if (days === 1) return "1d ago";
	if (days < 30) return `${days}d ago`;
	if (days < 365) return `${Math.floor(days / 30)}mo ago`;
	return `${Math.floor(days / 365)}y ago`;
}

function displayName(u: AdminUserRow): string {
	// email is the view's COALESCE(email,'') — "" not null — so `??` would return
	// "" for an anonymous no-name user, blanking the cell; `||` catches it (CORRECTNESS-8)
	return u.display_name || u.full_name || u.email || "—";
}

function initial(u: AdminUserRow): string {
	return (displayName(u)[0] ?? "?").toUpperCase();
}

function StatusBadges({ u }: { u: AdminUserRow }) {
	// existing variants only (D9): exceptional states get color, the expected
	// state (confirmed) stays neutral — no --success token exists and none is
	// added (the base-only --destructive lesson)
	return (
		<span className="flex flex-wrap items-center gap-1">
			{u.is_banned && <Badge variant="destructive">banned</Badge>}
			{u.is_deleted && <Badge variant="outline">deleted</Badge>}
			{u.is_anonymous && <Badge variant="secondary">anonymous</Badge>}
			{!u.is_banned && !u.is_deleted && !u.is_anonymous && (
				<Badge variant="outline">{u.is_confirmed ? "confirmed" : "unconfirmed"}</Badge>
			)}
		</span>
	);
}

function RoleBadges({ roles }: { roles: string[] }) {
	if (roles.length === 0) return <span className="text-faint">—</span>;
	return (
		<span className="flex flex-wrap items-center gap-1">
			{roles.map((r) => (
				<Badge key={r} variant={r === "admin" ? "default" : "secondary"}>
					{r}
				</Badge>
			))}
		</span>
	);
}

function SortGlyph({ active, dir }: { active: boolean; dir: SortDir }) {
	if (!active) return <ChevronsUpDownIcon className="size-3 text-faint" aria-hidden="true" />;
	return dir === "asc" ? (
		<ArrowUpIcon className="size-3" aria-hidden="true" />
	) : (
		<ArrowDownIcon className="size-3" aria-hidden="true" />
	);
}

function UserCell({ u }: { u: AdminUserRow }) {
	return (
		<div className="flex min-w-0 items-center gap-3">
			<span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-rule2 bg-panel2 font-ui text-xs font-semibold uppercase text-ink">
				{initial(u)}
			</span>
			<div className="min-w-0">
				<p className="truncate font-ui text-sm font-semibold text-ink">{displayName(u)}</p>
				<p className="truncate font-ui text-xs text-muted-foreground">{u.email || "—"}</p>
			</div>
		</div>
	);
}

const SKELETON_KEYS = ["a", "b", "c"];

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
	const [searchParams] = useSearchParams();
	const submit = useSubmit();
	const navigation = useNavigation();
	const location = useLocation();
	const fetcher = useFetcher<typeof loader>();

	const { epoch, q, role, status, sort, dir, rolesCatalog } = loaderData;

	// TWO distinct pending signals (B5): a search/filter/sort is a GET NAVIGATION
	// to this route (useSubmit method:get); load-more is the FETCHER. Watching
	// only the fetcher left the entire search/filter path with no busy state.
	const searching = navigation.state === "loading" && navigation.location?.pathname === "/admin/users";
	const loadingMore = fetcher.state !== "idle";

	// Appended pages live OUTSIDE the URL (cursor is fetcher-local, D8).
	const [extra, setExtra] = useState<{
		epoch: string;
		rows: AdminUserRow[];
		cursor: string | null;
	}>({ epoch, rows: [], cursor: loaderData.nextCursor });

	// once-only consumption marker (B4): holds the cursor of the page we actually
	// requested this generation. The epoch guard alone cannot tell "a fresh page
	// for epoch E" from "the RETAINED page for a PREVIOUS epoch E" after a filter
	// round-trip (A→B→A gives a byte-identical epoch) — so retained fetcher.data
	// would be re-appended, punching a silent hole in the list.
	const requestedRef = useRef<string | null>(null);

	// Filter set changed (or same-epoch revalidation) → loaderData IS the new
	// page 1: drop the tail and abandon any in-flight generation (D6/B4 reset).
	useEffect(() => {
		requestedRef.current = null;
		setExtra({ epoch, rows: [], cursor: loaderData.nextCursor });
	}, [epoch, loaderData]);

	// Append a fetcher page ONCE, and only if it was requested this generation
	// AND belongs to the current epoch (B4 + D6 race guard).
	useEffect(() => {
		if (fetcher.state !== "idle" || !fetcher.data) return;
		if (requestedRef.current === null) return; // retained / cross-generation data — never re-consume
		const fetched = fetcher.data;
		requestedRef.current = null; // consumed exactly once
		if (fetched.epoch !== epoch) return; // stale filter set — drop
		setExtra((prev) =>
			prev.epoch !== epoch
				? prev
				: { epoch, rows: [...prev.rows, ...fetched.rows], cursor: fetched.nextCursor },
		);
	}, [fetcher.data, fetcher.state, epoch]);

	const rows = [...loaderData.rows, ...extra.rows];
	const count = loaderData.count ?? rows.length;

	const loadMore = () => {
		// no-op while a filter/sort navigation is committing (CORRECTNESS-5): the
		// old cursor must never be paired with the incoming filter set
		if (fetcher.state !== "idle" || searching || !extra.cursor) return;
		requestedRef.current = extra.cursor; // mark this generation requested (B4)
		const p = new URLSearchParams(searchParams);
		p.set("cursor", extra.cursor);
		fetcher.load(`/admin/users?${p.toString()}`);
	};

	// The "Load more" BUTTON is the IntersectionObserver sentinel (D6): a real
	// control — keyboard/SR users activate it, focus survives appends (rows
	// insert above it, its DOM identity persists), and the observer just
	// auto-clicks it as it nears the viewport.
	const sentinelRef = useRef<HTMLButtonElement>(null);
	const loadMoreRef = useRef(loadMore);
	loadMoreRef.current = loadMore;
	useEffect(() => {
		const el = sentinelRef.current;
		if (!el || !extra.cursor) return;
		const io = new IntersectionObserver(
			([e]) => {
				if (e.isIntersecting) loadMoreRef.current();
			},
			{ rootMargin: "600px" },
		);
		io.observe(el);
		return () => io.disconnect();
	}, [extra.cursor]);

	// Search: URL-owned, debounced 250ms. Keystrokes REPLACE (no per-keystroke
	// history spam); discrete actions PUSH so Back unwinds them (ADVB-7).
	const [qInput, setQInput] = useState(q);
	const inputRef = useRef<HTMLInputElement>(null);
	// sync the field from the URL only when it is NOT focused — a landing
	// navigation for an EARLIER query would otherwise clobber in-flight typing
	// (ADVB-6). Back/forward and chip clears leave the field unfocused, so those
	// URL-driven syncs still apply.
	useEffect(() => {
		if (document.activeElement !== inputRef.current) setQInput(q);
	}, [q]);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const submitParams = (mutate: (p: URLSearchParams) => void, immediate = false) => {
		// base off the PENDING navigation's params when one is in flight so a
		// second change made mid-navigation doesn't drop the first (ADVB-4)
		const base = new URLSearchParams(navigation.location?.search ?? location.search);
		// carry the live search box so a filter/sort/chip click within the debounce
		// window doesn't silently drop a typed query (ADVA-2)
		if (immediate) {
			if (qInput) base.set("q", qInput);
			else base.delete("q");
		}
		mutate(base);
		base.delete("cursor"); // the cursor is never URL state
		const go = () => submit(base, { method: "get", replace: !immediate, preventScrollReset: true });
		if (debounceRef.current) clearTimeout(debounceRef.current);
		if (immediate) go();
		else debounceRef.current = setTimeout(go, 250);
	};
	// clear a pending debounce on unmount AND when the history entry changes, so a
	// stale timer can't fire post-Back and hijack the restored entry (ADVB-8)
	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [location.key]);

	const onSearchChange = (value: string) => {
		setQInput(value);
		submitParams((p) => (value ? p.set("q", value) : p.delete("q")));
	};

	const setParam = (key: string, value: string) =>
		submitParams((p) => (value ? p.set(key, value) : p.delete(key)), true);

	const toggleSort = (key: SortKey) => {
		const nextDir: SortDir = sort === key ? (dir === "desc" ? "asc" : "desc") : key === "email" ? "asc" : "desc";
		submitParams((p) => {
			p.set("sort", key);
			p.set("dir", nextDir);
		}, true);
	};

	// mobile sort select (ADVB-9): value carries BOTH column and direction so a
	// phone user can reach oldest-first / Z→A, and the trigger never misrepresents
	// a ?dir=desc URL set on desktop
	const setSort = (value: string) => {
		const [s, d] = value.split("-");
		submitParams((p) => {
			p.set("sort", s);
			p.set("dir", d);
		}, true);
	};
	const MOBILE_SORTS: { value: string; label: string }[] = (["created", "seen", "email"] as SortKey[]).flatMap(
		(k) => [
			{ value: `${k}-desc`, label: `${SORT_LABELS[k]} · ${k === "email" ? "Z–A" : "newest"}` },
			{ value: `${k}-asc`, label: `${SORT_LABELS[k]} · ${k === "email" ? "A–Z" : "oldest"}` },
		],
	);

	const activeFilters = [
		role ? { key: "role", label: "Role", value: role } : null,
		status ? { key: "status", label: "Status", value: STATUS_LABELS[status] } : null,
	].filter((f) => f !== null);

	const ariaSort = (key: SortKey) =>
		sort === key ? (dir === "asc" ? ("ascending" as const) : ("descending" as const)) : ("none" as const);

	const headerButton = (key: SortKey, label: string) => (
		<button
			type="button"
			onClick={() => toggleSort(key)}
			// after:-inset-y-3 → 44px hit target (20px label + 24px) — house touch law (UX-A11Y-3)
			className="group relative inline-flex touch-manipulation items-center gap-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/50 after:absolute after:-inset-y-3 after:inset-x-0 after:content-['']"
		>
			{label}
			<SortGlyph active={sort === key} dir={dir} />
		</button>
	);

	return (
		// pt-16 keeps the search field and header labels out from under the
		// fixed top-right chrome (AccountChip/ThemeSelect, z-40)
		<main data-plate="ledger" className="mx-auto max-w-4xl px-6 py-12">
			<header>
				<p className="font-ui text-[13px] font-normal text-muted-foreground">Admin</p>
				<h1 className="mt-2 font-display text-3xl font-medium tracking-tight">Users</h1>
			</header>

			<div className="mt-6 flex flex-col gap-2">
				{/* search is the front door; role="search" is the SR landmark */}
				<form role="search" onSubmit={(e) => e.preventDefault()} className="relative">
					<SearchIcon
						aria-hidden="true"
						className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
					/>
					<Input
						ref={inputRef}
						type="search"
						name="q"
						value={qInput}
						onChange={(e) => onSearchChange(e.target.value)}
						autoComplete="off"
						spellCheck={false}
						data-1p-ignore
						enterKeyHint="search"
						placeholder="Search users by name or email…"
						aria-label="Search users"
						aria-describedby="user-search-count"
						className="pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
					/>
					{qInput !== "" && (
						<button
							type="button"
							onClick={() => {
								setQInput("");
								submitParams((p) => p.delete("q"), true);
							}}
							aria-label="Clear search"
							// after:-inset-2 → 44px hit target (28px + 16px) — house touch law (UX-A11Y-3)
							className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-faint transition-colors after:absolute after:-inset-2 after:content-[''] hover:text-ink"
						>
							<XIcon aria-hidden="true" className="size-4" />
						</button>
					)}
				</form>

				{/* fixed-height count bar = the ONE aria-live region (D9). Text swaps
				    ("Searching…" ↔ counts) never nudge the table below. Driven by the
				    NAVIGATION pending state so a slow search actually announces (B5). */}
				<div
					id="user-search-count"
					role="status"
					aria-live="polite"
					className="flex h-6 items-center font-ui text-xs tabular-nums text-faint"
				>
					{searching
						? "Searching…"
						: q
							? `${count} ${count === 1 ? "result" : "results"} for “${q}”${rows.length < count ? ` · ${rows.length} shown` : ""}`
							: `${count} ${count === 1 ? "user" : "users"}${rows.length < count ? ` · ${rows.length} shown` : ""}`}
				</div>

				<div className="flex flex-wrap items-center gap-2">
					{/* after:-inset-2 → 44px hit target on the h-7 triggers (UX-A11Y-3),
					    same overlay trick as root.tsx's ThemeSelect */}
					<Select value={role || "all"} onValueChange={(v) => setParam("role", v === "all" ? "" : v)}>
						<SelectTrigger
							size="sm"
							aria-label="Filter by role"
							className="relative bg-surface font-ui text-xs after:absolute after:-inset-2 after:content-['']"
						>
							<SelectValue placeholder="Role" />
						</SelectTrigger>
						<SelectContent className="font-ui text-xs">
							<SelectItem value="all">All roles</SelectItem>
							{(rolesCatalog ?? []).map((r) => (
								<SelectItem key={r.slug} value={r.slug}>
									{r.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select
						value={status || "all"}
						onValueChange={(v) => setParam("status", v === "all" ? "" : v)}
					>
						<SelectTrigger
							size="sm"
							aria-label="Filter by status"
							className="relative bg-surface font-ui text-xs after:absolute after:-inset-2 after:content-['']"
						>
							<SelectValue placeholder="Status" />
						</SelectTrigger>
						<SelectContent className="font-ui text-xs">
							<SelectItem value="all">Any status</SelectItem>
							{Object.entries(STATUS_LABELS).map(([k, label]) => (
								<SelectItem key={k} value={k}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{/* mobile: column headers don't exist in card mode — value carries
					    column+dir so direction is reachable (ADVB-9); same URL params */}
					<div className="md:hidden">
						<Select value={`${sort}-${dir}`} onValueChange={setSort}>
							<SelectTrigger
								size="sm"
								aria-label="Sort"
								className="relative bg-surface font-ui text-xs after:absolute after:-inset-2 after:content-['']"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent className="font-ui text-xs">
								{MOBILE_SORTS.map((o) => (
									<SelectItem key={o.value} value={o.value}>
										Sort: {o.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{activeFilters.length > 0 && (
						<ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
							{activeFilters.map((f) => (
								<li key={f.key} className="relative">
									<Badge variant="outline" className="gap-1 pr-1">
										<span className="text-faint">{f.label}:</span> {f.value}
										<button
											type="button"
											onClick={() => setParam(f.key, "")}
											aria-label={`Remove ${f.label} filter`}
											// after:-inset-3.5 → 44px hit target (16px + 28px) — house touch law (UX-A11Y-3)
											className="relative ml-0.5 flex size-4 items-center justify-center rounded-full after:absolute after:-inset-3.5 after:content-[''] hover:bg-muted"
										>
											<XIcon className="size-3" aria-hidden="true" />
										</button>
									</Badge>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>

			{/* results region: keep stale rows visible while a new query settles —
			    no collapse-and-jump (stale-while-revalidate). The dim is a STATE
			    signal, so the opacity is NOT gated behind motion-safe (reduced-motion
			    users still need the busy feedback); only the transition is (B5). */}
			<div
				aria-busy={searching || undefined}
				className={searching ? "opacity-60 motion-safe:transition-opacity" : ""}
			>
				{rows.length === 0 && !searching ? (
					<div className="mt-4 flex min-h-40 flex-col items-center justify-center gap-1 text-center">
						<p className="font-display text-lg text-ink">
							{q
								? `No users match “${q}”.`
								: activeFilters.length > 0
									? "No users match these filters."
									: "No users yet."}
						</p>
						<p className="font-ui text-sm text-muted-foreground">
							{q || activeFilters.length > 0
								? "Try a different name or email, or clear your filters."
								: "Users appear here after their first sign-in."}
						</p>
					</div>
				) : (
					<>
						{/* mobile: stacked cards — a 5-col PII table must not h-scroll */}
						<ul className="mt-4 space-y-2 md:hidden">
							{rows.map((u) => (
								<li key={u.id} className="rounded-lg border border-rule2 bg-surface p-3">
									<UserCell u={u} />
									<div className="mt-2 flex flex-wrap items-center gap-1.5">
										<RoleBadges roles={u.roles} />
										<StatusBadges u={u} />
									</div>
									<dl className="mt-2 flex gap-4 font-ui text-xs tabular-nums text-faint">
										<div>
											<dt className="inline">Joined </dt>
											<dd className="inline text-muted-foreground">
												{isNever(u.created_at) ? "—" : joinedFmt.format(new Date(u.created_at))}
											</dd>
										</div>
										<div>
											<dt className="inline">Seen </dt>
											<dd className="inline text-muted-foreground">
												{isNever(u.last_sign_in_at) ? "—" : relativeSeen(u.last_sign_in_at)}
											</dd>
										</div>
									</dl>
								</li>
							))}
						</ul>

						{/* desktop: real semantic table — native aria-sort + SR cell headers */}
						<table className="mt-4 hidden w-full border-collapse font-ui text-sm md:table">
							<caption className="sr-only">All users. Use column headers to sort.</caption>
							<thead className="sticky top-0 z-30 bg-panel/95 backdrop-blur">
								<tr className="border-b border-rule2 text-left align-middle">
									<th scope="col" aria-sort={ariaSort("email")} className="relative h-9 px-3 font-semibold text-faint">
										{headerButton("email", "User")}
									</th>
									<th scope="col" className="h-9 px-3 font-semibold text-faint">
										Roles
									</th>
									<th scope="col" className="h-9 px-3 font-semibold text-faint">
										Status
									</th>
									<th scope="col" aria-sort={ariaSort("created")} className="relative h-9 px-3 font-semibold text-faint">
										{headerButton("created", "Joined")}
									</th>
									<th scope="col" aria-sort={ariaSort("seen")} className="relative h-9 px-3 font-semibold text-faint">
										{headerButton("seen", "Last seen")}
									</th>
								</tr>
							</thead>
							{/* tripwire: revisit windowing only if a single session realistically
							    loads ~2,000+ rows into the DOM — premature before that (D9) */}
							<tbody>
								{rows.map((u) => (
									<tr key={u.id} className="h-14 border-b border-rule">
										<td className="px-3">
											<UserCell u={u} />
										</td>
										<td className="px-3">
											<RoleBadges roles={u.roles} />
										</td>
										<td className="px-3">
											<StatusBadges u={u} />
										</td>
										<td className="px-3 tabular-nums text-muted-foreground">
											{isNever(u.created_at) ? (
												"—"
											) : (
												<time dateTime={new Date(u.created_at).toISOString()}>
													{joinedFmt.format(new Date(u.created_at))}
												</time>
											)}
										</td>
										<td
											className="px-3 tabular-nums text-muted-foreground"
											title={isNever(u.last_sign_in_at) ? undefined : absoluteFmt.format(new Date(u.last_sign_in_at))}
										>
											{isNever(u.last_sign_in_at) ? "—" : relativeSeen(u.last_sign_in_at)}
										</td>
									</tr>
								))}
								{loadingMore &&
									SKELETON_KEYS.map((k) => (
										<tr key={k} className="h-14 border-b border-rule">
											<td className="px-3">
												<div className="flex items-center gap-3">
													<Skeleton className="size-8 rounded-full" />
													<div className="space-y-1.5">
														<Skeleton className="h-3 w-32" />
														<Skeleton className="h-2.5 w-40" />
													</div>
												</div>
											</td>
											<td className="px-3">
												<Skeleton className="h-4 w-16" />
											</td>
											<td className="px-3">
												<Skeleton className="h-4 w-20" />
											</td>
											<td className="px-3">
												<Skeleton className="h-3 w-20" />
											</td>
											<td className="px-3">
												<Skeleton className="h-3 w-14" />
											</td>
										</tr>
									))}
							</tbody>
						</table>

						{/* list tail: auto-loading Load-more button (the sentinel) or the
						    explicit end state — never silence */}
						{extra.cursor ? (
							<button
								ref={sentinelRef}
								type="button"
								onClick={loadMore}
								// aria-disabled, NOT disabled (UX-A11Y-5): disabling the focused
								// button on activation dumps keyboard/SR focus to <body>. loadMore
								// already early-returns while busy, so this is display-only.
								aria-disabled={loadingMore || undefined}
								className="mt-1 flex h-12 w-full touch-manipulation items-center justify-center rounded-md font-ui text-xs font-semibold text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 hover:text-ink aria-disabled:opacity-60"
							>
								{loadingMore ? "Loading…" : "Load more"}
							</button>
						) : (
							rows.length > 0 && (
								<p className="py-6 text-center font-ui text-xs text-faint">
									End of results · {count} {count === 1 ? "user" : "users"}
								</p>
							)
						)}
					</>
				)}
			</div>
		</main>
	);
}

/**
 * Route ErrorBoundary (B6). Without one, a transient failure on the
 * IntersectionObserver's BACKGROUND fetcher.load — a network blip, a 500, or a
 * mid-session revocation 404 while merely scrolling — bubbles to the ROOT
 * boundary and replaces the whole admin view with no retry. This keeps the
 * failure local.
 *
 * The 404 branch renders root.tsx's 404 markup BYTE-IDENTICALLY so a non-admin
 * hitting /admin/users still sees exactly what a nonexistent route shows (D10
 * concealment). KEEP IT IN SYNC WITH root.tsx ErrorBoundary's 404 branch — the
 * concealment depends on the two outputs being indistinguishable. (The title/
 * timing side-channel remains the accepted D10 residual.)
 */
export function ErrorBoundary() {
	const error = useRouteError();
	// RE-THROW a 404 so it bubbles to root's ErrorBoundary and REPLACES <App>.
	// This removes the real leak: rendering the 404 here left root's fixed chrome
	// — including a signed-in non-admin's own AccountChip (email/PII) — wrapping
	// it. After the re-throw the deployed 404 renders the bare root 404, no chrome
	// (verified live). React Router propagates an error thrown from an
	// ErrorBoundary to the parent route's boundary.
	// RESIDUAL (accepted, D10): the doc still isn't byte-identical to a no-match
	// 404 — RR echoes the URL in the no-match message and preloads THIS route's
	// module because the path matched. Neither reveals admin state, and the route
	// table is already public in the client manifest, so existence was never
	// concealable; the entitlement gate is the real control.
	if (isRouteErrorResponse(error) && error.status === 404) throw error;
	// any other failure (a background page-fetch blip): a real reload affordance
	// instead of root's dead-end "Oops!" — the loaded rows are lost, but reload
	// re-runs page 1
	//
	// issue #3: the sentence has to be TRUE. loadUsersPage names the class it
	// caught; a connection failure really does clear on its own, and a permission
	// or query fault never will — offering the same "reload to try again" for
	// both is a promise the page can't keep. An UNCLASSIFIED error (a network
	// blip on the background fetcher, which never reaches our classifier) keeps
	// the original wording and the button: unknown is not the same as hopeless.
	const payload = isRouteErrorResponse(error) ? (error.data as { cause?: string } | null) : null;
	const busy = payload?.cause === "pool_exhausted" || payload?.cause === "connect_failed";
	const permanent =
		payload?.cause === "permission" ||
		payload?.cause === "query" ||
		payload?.cause === "constraint";
	return (
		<main data-plate="ledger" className="mx-auto max-w-4xl px-6 py-12">
			<h1 className="font-display text-3xl font-medium tracking-tight">Couldn't load users</h1>
			<p className="mt-2 font-reading text-[17px] text-muted-foreground">
				{busy
					? "The database is busy right now. This usually clears on its own."
					: permanent
						? "Something went wrong loading the list. Reloading won't fix this one."
						: "Something went wrong. Reload the page to try again."}
			</p>
			{!permanent && (
				<button
					type="button"
					onClick={() => window.location.reload()}
					className="mt-6 inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-ui text-sm font-semibold text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50"
				>
					Reload
				</button>
			)}
		</main>
	);
}
