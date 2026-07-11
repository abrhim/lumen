import { useEffect, useRef, useState } from "react";
import { Link, data, useFetcher, useSearchParams, useSubmit } from "react-router";
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
	return [{ title: "Users · Admin · Lumen" }];
}

/**
 * Admin all-users list (plan D6-D12). Deliberately NO ErrorBoundary here:
 * the gate's thrown 404 bubbles to the root boundary and renders IDENTICALLY
 * to a nonexistent route — the D10 concealment (body/status; the timing
 * side-channel is documented and accepted).
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
	return u.display_name ?? u.full_name ?? u.email ?? "—";
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
	const fetcher = useFetcher<typeof loader>();

	const { epoch, q, role, status, sort, dir, rolesCatalog } = loaderData;

	// Appended pages live OUTSIDE the URL (cursor is fetcher-local, D8).
	const [extra, setExtra] = useState<{
		epoch: string;
		rows: AdminUserRow[];
		cursor: string | null;
	}>({ epoch, rows: [], cursor: loaderData.nextCursor });

	// Filter set changed (or same-epoch revalidation) → loaderData IS the new
	// page 1: drop the tail (D6 epoch reset).
	useEffect(() => {
		setExtra({ epoch, rows: [], cursor: loaderData.nextCursor });
	}, [epoch, loaderData]);

	// Append fetcher pages ONLY when they belong to the current epoch — a
	// stale in-flight page for an abandoned filter set is dropped (D6 race guard).
	useEffect(() => {
		if (fetcher.state !== "idle" || !fetcher.data) return;
		const fetched = fetcher.data;
		if (fetched.epoch !== epoch) return;
		setExtra((prev) =>
			prev.epoch !== epoch
				? prev
				: { epoch, rows: [...prev.rows, ...fetched.rows], cursor: fetched.nextCursor },
		);
	}, [fetcher.data, fetcher.state, epoch]);

	const rows = [...loaderData.rows, ...extra.rows];
	const count = loaderData.count ?? rows.length;
	const loading = fetcher.state !== "idle";

	const loadMore = () => {
		if (fetcher.state !== "idle" || !extra.cursor) return;
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

	// Search: URL-owned, debounced 250ms, replace (no history spam per
	// keystroke), drops the cursor by nature (cursor never enters the URL).
	const [qInput, setQInput] = useState(q);
	useEffect(() => setQInput(q), [q]);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const submitParams = (mutate: (p: URLSearchParams) => void, immediate = false) => {
		const p = new URLSearchParams(searchParams);
		mutate(p);
		p.delete("cursor"); // belt & braces — the cursor is never URL state
		const go = () => submit(p, { method: "get", replace: true, preventScrollReset: true });
		if (debounceRef.current) clearTimeout(debounceRef.current);
		if (immediate) go();
		else debounceRef.current = setTimeout(go, 250);
	};
	// unmount-only ([]): a per-render cleanup would clear the timer set by the
	// keystroke that caused the render — the debounced submit would never fire
	useEffect(
		() => () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		},
		[],
	);

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
			className="group relative inline-flex touch-manipulation items-center gap-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/50 after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-['']"
		>
			{label}
			<SortGlyph active={sort === key} dir={dir} />
		</button>
	);

	return (
		// pt-16 keeps the search field and header labels out from under the
		// fixed top-right chrome (AccountChip/ThemeSelect, z-40)
		<main className="mx-auto max-w-5xl px-6 pb-16 pt-16">
			<header>
				<p className="font-ui text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">
					<Link to="/" className="hover:text-ink">
						Lumen
					</Link>{" "}
					· Admin
				</p>
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
							className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-faint transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:text-ink"
						>
							<XIcon aria-hidden="true" className="size-4" />
						</button>
					)}
				</form>

				{/* fixed-height count bar = the ONE aria-live region (D9). Text swaps
				    ("Searching…" ↔ counts) never nudge the table below. */}
				<div
					id="user-search-count"
					role="status"
					aria-live="polite"
					className="flex h-6 items-center font-ui text-xs tabular-nums text-faint"
				>
					{loading && rows.length === 0
						? "Searching…"
						: q
							? `${count} ${count === 1 ? "result" : "results"} for “${q}”${rows.length < count ? ` · ${rows.length} shown` : ""}`
							: `${count} ${count === 1 ? "user" : "users"}${rows.length < count ? ` · ${rows.length} shown` : ""}`}
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<Select value={role || "all"} onValueChange={(v) => setParam("role", v === "all" ? "" : v)}>
						<SelectTrigger size="sm" aria-label="Filter by role" className="bg-surface font-ui text-xs">
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
						<SelectTrigger size="sm" aria-label="Filter by status" className="bg-surface font-ui text-xs">
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
					{/* mobile: column headers don't exist in card mode — same URL params */}
					<div className="md:hidden">
						<Select value={sort} onValueChange={(v) => toggleSortTo(v as SortKey, submitParams, dir)}>
							<SelectTrigger size="sm" aria-label="Sort" className="bg-surface font-ui text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent className="font-ui text-xs">
								{Object.entries(SORT_LABELS).map(([k, label]) => (
									<SelectItem key={k} value={k}>
										Sort: {label}
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
											className="relative ml-0.5 flex size-4 items-center justify-center rounded-full after:absolute after:-inset-2 after:content-[''] hover:bg-muted"
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
			    no collapse-and-jump (stale-while-revalidate, motion-safe only) */}
			<div aria-busy={loading || undefined} className={loading ? "motion-safe:opacity-60 motion-safe:transition-opacity" : ""}>
				{rows.length === 0 && !loading ? (
					<div className="mt-4 flex min-h-40 flex-col items-center justify-center gap-1 text-center">
						<p className="font-display text-lg text-ink">
							{q ? `No users match “${q}”.` : "No users yet."}
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
								{loading &&
									SKELETON_KEYS.map((k) => (
										<tr key={k} className="h-14 border-b border-rule">
											<td className="px-3">
												<div className="flex items-center gap-3">
													<Skeleton className="size-8 rounded-full motion-safe:animate-pulse" />
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
								disabled={loading}
								className="mt-1 flex h-12 w-full touch-manipulation items-center justify-center rounded-md font-ui text-xs font-semibold text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 hover:text-ink disabled:opacity-60"
							>
								{loading ? "Loading…" : "Load more"}
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

/** Mobile sort select: switching column applies that column's natural default
 * direction (dates newest-first, email A→Z), matching the header buttons. */
function toggleSortTo(
	key: SortKey,
	submitParams: (mutate: (p: URLSearchParams) => void, immediate?: boolean) => void,
	_dir: SortDir,
) {
	submitParams((p) => {
		p.set("sort", key);
		p.set("dir", key === "email" ? "asc" : "desc");
	}, true);
}
