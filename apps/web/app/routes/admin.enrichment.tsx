import { useState } from "react";
import { Link, data, isRouteErrorResponse, useFetcher, useRouteError, useSearchParams } from "react-router";
import { getSessionUser } from "~/lib/auth.server";
import { requireEntitlement } from "~/lib/entitlements.server";
import { ADMIN_COLLECTIONS } from "~/lib/entitlements-keys";
import { loadReviewPage, reviewableCollections } from "~/lib/enrichment-review.server";
// client-safe half — a `.server` import here leaves these undefined at
// hydration and the page never comes alive (caught by e2e, 2026-08-19)
import {
	KIND_FILTERS,
	NOTE_MAX,
	PAGE_SIZE,
	STATUS_FILTERS,
	mentionId,
	parseKind,
	parseStatus,
	type KindFilter,
	type ReviewRow,
	type StatusFilter,
} from "~/lib/enrichment-review-shared";
import type { Route } from "./+types/admin.enrichment";

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Enrichment · Admin · Lintel" }];
}

/**
 * Enrichment review queue (docs/design/media-collections.md B-scope, Abram
 * verbatim: "an admin can review all collection AI enrichment. and they can
 * go sort by AI confidence and mark accepted or not… in the ui").
 *
 * Worst-confidence-first, because a queue you read top-down should spend
 * your attention where the machine was least sure. Each row carries the
 * verbatim utterance the claim was drawn from — reviewing a claim without
 * its evidence is just guessing politely.
 *
 * The gate mirrors admin.users: requireEntitlement FIRST, 404 not 403, and
 * the ErrorBoundary re-throws 404 so a non-admin never sees signed-in chrome.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	await requireEntitlement(context.db, user?.id ?? null, ADMIN_COLLECTIONS);

	const url = new URL(request.url);
	const collections = await reviewableCollections(context.db);
	const requested = url.searchParams.get("collection");
	const collectionId =
		requested && collections.some((c) => c.id === requested)
			? requested
			: (collections[0]?.id ?? "");
	const kind = parseKind(url.searchParams.get("kind"));
	const status = parseStatus(url.searchParams.get("status"));
	const offsetRaw = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
	const offset = Number.isSafeInteger(offsetRaw) && offsetRaw > 0 ? Math.min(offsetRaw, 100_000) : 0;

	const page = collectionId
		? await loadReviewPage(context.db, request, context.cloudflare.env, {
				collectionId,
				kind,
				status,
				offset,
			})
		: { rows: [], degraded: false, hasMore: false };

	return data({ ...page, collections, collectionId, kind, status, offset }, { headers });
}

/* ---------------------------------- UI ---------------------------------- */

const KIND_LABELS: Record<KindFilter, string> = {
	all: "Everything",
	principles: "Principles",
	entities: "People & places",
	scripture: "Scripture",
};

const STATUS_LABELS: Record<StatusFilter, string> = {
	all: "Any state",
	pending: "Not reviewed",
	accepted: "Accepted",
	rejected: "Rejected",
};

function fmtT(s: number) {
	const m = Math.floor(s / 60);
	const ss = Math.floor(s % 60);
	const h = Math.floor(m / 60);
	return h > 0
		? `${h}:${String(m % 60).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
		: `${m}:${String(ss).padStart(2, "0")}`;
}

/** One claim. Its own fetcher so a decision updates this row and nothing
 * else; the shown state is optimistic and reverts if the write fails. */
function Row({ row }: { row: ReviewRow }) {
	const fetcher = useFetcher<{ ok: boolean; status: string }>();
	const [noteOpen, setNoteOpen] = useState(false);
	const id = mentionId(row);
	const pendingIntent = fetcher.formData?.get("intent");
	const optimistic =
		pendingIntent && pendingIntent !== "note"
			? String(pendingIntent) === "clear"
				? "pending"
				: String(pendingIntent)
			: null;
	const shown = optimistic ?? row.status;
	const failed = fetcher.data?.ok === false;

	const decide = (intent: string) =>
		fetcher.submit(
			{ mention: id, intent },
			{ method: "post", action: "/api/enrichment-review" },
		);

	return (
		<li className="border-t border-rule py-4 first:border-t-0">
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<span className="font-reading text-[15px] font-semibold text-ink">{row.targetName}</span>
				<span className="font-ui text-[11px] text-muted-foreground">{row.targetType}</span>
				<span className="font-ui text-[11px] tabular-nums text-muted-foreground">
					confidence {row.confidence.toFixed(2)}
				</span>
				<Link
					to={`/collections/${row.collectionId}/serial/${row.fromId}?t=${Math.floor(row.t)}&entity=${encodeURIComponent(row.toId)}`}
					className="font-ui text-[11px] text-primary hover:underline"
				>
					{row.episodeName.length > 46 ? `${row.episodeName.slice(0, 44)}…` : row.episodeName} ▸{" "}
					{fmtT(row.t)}
				</Link>
			</div>
			{row.quote && (
				<p className="mt-1.5 font-reading text-[14.5px] leading-[1.5] text-ink">
					<span className="text-muted-foreground">“</span>
					{row.quote}
					<span className="text-muted-foreground">”</span>
				</p>
			)}
			<label className="mt-2 block">
				<span className="sr-only">Note on this claim</span>
				<textarea
					defaultValue={row.note}
					rows={noteOpen || row.note ? 2 : 1}
					maxLength={NOTE_MAX}
					onFocus={() => setNoteOpen(true)}
					onBlur={(e) => {
						setNoteOpen(false);
						if (e.target.value.trim() !== row.note.trim()) {
							fetcher.submit(
								{ mention: id, intent: "note", note: e.target.value },
								{ method: "post", action: "/api/enrichment-review" },
							);
						}
					}}
					placeholder="Note for the next tuning round…"
					className="w-full resize-y border-b border-rule bg-transparent py-1 font-reading text-[14px] text-ink placeholder:text-faint focus:border-primary focus:outline-none"
				/>
			</label>
			<div className="mt-2 flex items-center gap-4">
				<button
					type="button"
					onClick={() => decide(shown === "accepted" ? "clear" : "accepted")}
					aria-pressed={shown === "accepted"}
					className={`font-ui text-[13px] font-semibold underline-offset-4 hover:underline ${
						shown === "accepted" ? "text-primary" : "text-muted-foreground"
					}`}
				>
					{shown === "accepted" ? "✓ Accepted" : "Accept"}
				</button>
				<button
					type="button"
					onClick={() => decide(shown === "rejected" ? "clear" : "rejected")}
					aria-pressed={shown === "rejected"}
					className={`font-ui text-[13px] font-semibold underline-offset-4 hover:underline ${
						shown === "rejected" ? "text-ink" : "text-muted-foreground"
					}`}
				>
					{shown === "rejected" ? "✕ Rejected" : "Reject"}
				</button>
				{failed && (
					<span role="status" className="font-ui text-[12px] text-ink">
						That didn't save. Try again.
					</span>
				)}
			</div>
		</li>
	);
}

export default function AdminEnrichment({ loaderData }: Route.ComponentProps) {
	const { rows, degraded, hasMore, collections, collectionId, kind, status, offset } = loaderData;
	const [searchParams, setSearchParams] = useSearchParams();

	const setParam = (key: string, value: string) => {
		const next = new URLSearchParams(searchParams);
		next.set(key, value);
		// any filter change invalidates the page position
		if (key !== "offset") next.delete("offset");
		setSearchParams(next, { preventScrollReset: true });
	};

	return (
		<main data-plate="ledger" className="mx-auto max-w-4xl px-6 py-12">
			<header className="border-b border-rule pb-6">
				<p className="font-ui text-[13px] font-normal text-muted-foreground">Admin</p>
				<h1 className="mt-3 font-display text-3xl font-medium tracking-tight">Enrichment review</h1>
				<p className="mt-2 max-w-prose font-reading text-[17px] leading-relaxed text-muted-foreground">
					Every claim the pipeline drew from a transcript, least confident first. Accepting or
					rejecting one is permanent in the sense that matters: a re-run of the pipeline will not
					undo your decision.
				</p>
			</header>

			<div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 font-ui text-[13px]">
				<label className="flex items-center gap-2">
					<span className="text-muted-foreground">Collection</span>
					<select
						value={collectionId}
						onChange={(e) => setParam("collection", e.target.value)}
						className="border-b border-rule bg-transparent py-1 text-ink"
					>
						{collections.map((c) => (
							<option key={c.id} value={c.id}>
								{c.name}
							</option>
						))}
					</select>
				</label>
				<label className="flex items-center gap-2">
					<span className="text-muted-foreground">Kind</span>
					<select
						value={kind}
						onChange={(e) => setParam("kind", e.target.value)}
						className="border-b border-rule bg-transparent py-1 text-ink"
					>
						{(Object.keys(KIND_FILTERS) as KindFilter[]).map((k) => (
							<option key={k} value={k}>
								{KIND_LABELS[k]}
							</option>
						))}
					</select>
				</label>
				<label className="flex items-center gap-2">
					<span className="text-muted-foreground">State</span>
					<select
						value={status}
						onChange={(e) => setParam("status", e.target.value)}
						className="border-b border-rule bg-transparent py-1 text-ink"
					>
						{STATUS_FILTERS.map((s) => (
							<option key={s} value={s}>
								{STATUS_LABELS[s]}
							</option>
						))}
					</select>
				</label>
			</div>

			{degraded ? (
				<p className="mt-8 font-reading text-[17px] text-muted-foreground">
					The queue couldn't load right now. Reloading usually clears it.
				</p>
			) : rows.length === 0 ? (
				<p className="mt-8 font-reading text-[17px] text-muted-foreground">
					{status === "all"
						? "No enrichment here yet."
						: `Nothing ${STATUS_LABELS[status].toLowerCase()} in this view.`}
				</p>
			) : (
				<>
					<ul className="mt-6 list-none">
						{rows.map((r) => (
							<Row key={mentionId(r)} row={r} />
						))}
					</ul>
					<div className="mt-8 flex items-center gap-6 font-ui text-[13px]">
						{offset > 0 && (
							<button
								type="button"
								onClick={() => setParam("offset", String(Math.max(0, offset - PAGE_SIZE)))}
								className="font-semibold text-primary hover:underline"
							>
								← Previous
							</button>
						)}
						{hasMore && (
							<button
								type="button"
								onClick={() => setParam("offset", String(offset + PAGE_SIZE))}
								className="font-semibold text-primary hover:underline"
							>
								Next →
							</button>
						)}
						<span className="tabular-nums text-muted-foreground">
							{offset + 1}–{offset + rows.length}
						</span>
					</div>
				</>
			)}
		</main>
	);
}

export function ErrorBoundary() {
	const error = useRouteError();
	// re-throw 404 so it bubbles to root and replaces <App> — a non-admin must
	// not get signed-in chrome wrapped around the miss (the admin.users rule)
	if (isRouteErrorResponse(error) && error.status === 404) throw error;
	return (
		<main data-plate="ledger" className="mx-auto max-w-4xl px-6 py-12">
			<h1 className="font-display text-3xl font-medium tracking-tight">Couldn't load the queue</h1>
			<p className="mt-2 font-reading text-[17px] text-muted-foreground">
				Something went wrong. Reload the page to try again.
			</p>
		</main>
	);
}
