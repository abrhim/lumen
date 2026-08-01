import { useEffect, useRef, useState } from "react";
import { Link, data, redirect, useFetcher } from "react-router";
import { PageFrame, PageHeader } from "~/components/PageFrame";
import { getSessionUser } from "~/lib/auth.server";
import { listRoadmap, myVotes, pressUnvote, pressVote, type RoadmapFeature } from "~/lib/roadmap.server";

/** mirror of the SQL cap in migrate-roadmap.mjs (client-safe display) */
const VOTE_CAP = 10;
import type { Route } from "./+types/roadmap";

/**
 * Roadmap (2026-08-01): features live in lumen.roadmap_features now.
 * Anyone sees the standings; signed-in readers press the flame — up to
 * VOTE_CAP presses per feature (the Comeau-heart interaction, in the
 * house mark). Signed out, the flame is the sign-in door.
 */

export async function loader({ request, context }: Route.LoaderArgs) {
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	headers.set("Cache-Control", "private, no-store");
	const [features, mine] = await Promise.all([
		listRoadmap(context.db),
		user ? myVotes(request, context.cloudflare.env) : Promise.resolve({} as Record<string, number>),
	]);
	return data({ features, mine, signedIn: user !== null }, { headers });
}

export async function action({ request, context }: Route.ActionArgs) {
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	headers.set("Cache-Control", "private, no-store");
	if (!user) {
		return redirect("/login?next=%2Froadmap", { headers });
	}
	const form = await request.formData();
	const featureId = String(form.get("feature") ?? "");
	if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(featureId)) {
		return data({ ok: false as const }, { status: 400, headers });
	}
	const down = form.get("press") === "down";
	const n = Math.min(10, Math.max(1, parseInt(String(form.get("n") ?? "1"), 10) || 1));
	// a burst lands as ONE request: apply n capped presses sequentially
	let count: number | null = null;
	for (let i = 0; i < n; i++) {
		count = down
			? await pressUnvote(request, context.cloudflare.env, featureId)
			: await pressVote(request, context.cloudflare.env, featureId);
		if (count === null) break;
	}
	return data({ ok: count !== null, feature: featureId, count }, { headers });
}

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Roadmap — Lintel" }];
}

/** The flame: fills with YOUR presses (level = mine/cap), pops on each
 * press, sparks fly. Reduced motion: the fill still rises, nothing moves
 * otherwise. Signed out it is a plain door to /login. */
function FlameVote({
	feature,
	votes,
	mine,
	signedIn,
}: {
	feature: string;
	votes: number;
	mine: number;
	signedIn: boolean;
}) {
	const fetcher = useFetcher<typeof action>();
	// optimistic press DELTA (right-click retracts): folds into server truth
	const [pressed, setPressed] = useState(0);
	const baseMine = useRef(mine);
	useEffect(() => {
		// server truth arrived — fold it in and clear the optimistic layer
		if (fetcher.data?.ok && fetcher.data.feature === feature && fetcher.data.count != null) {
			baseMine.current = fetcher.data.count;
			setPressed(0);
		}
	}, [fetcher.data, feature]);
	const mineNow = Math.max(0, Math.min(safeCount(baseMine.current) + pressed, VOTE_CAP));
	const votesNow = votes - mine + mineNow;
	const level = mineNow / VOTE_CAP;
	const atCap = mineNow >= VOTE_CAP;

	if (!signedIn) {
		return (
			<Link
				to="/login?next=%2Froadmap"
				className="group flex shrink-0 items-center gap-2 font-ui text-[13px] tabular-nums text-muted-foreground transition-colors duration-150 hover:text-ink"
				aria-label={`${votes} votes — sign in to vote`}
			>
				<TorchGlyph level={0} lit={false} />
				{votes}
			</Link>
		);
	}

	// burst batching: rapid presses race a single fetcher (each submit
	// aborts the last), so presses accumulate locally and flush as ONE
	// request carrying the net delta
	const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const deltaRef = useRef(0);
	const scheduleFlush = () => {
		if (flushTimer.current) clearTimeout(flushTimer.current);
		flushTimer.current = setTimeout(() => {
			const d = deltaRef.current;
			deltaRef.current = 0;
			if (d === 0) return;
			fetcher.submit(
				{ feature, press: d > 0 ? "up" : "down", n: String(Math.abs(d)) },
				{ method: "post" },
			);
		}, 250);
	};
	const pressUp = () => {
		if (mineNow >= VOTE_CAP) return;
		setPressed((p) => p + 1);
		deltaRef.current += 1;
		scheduleFlush();
	};
	const pressDown = () => {
		if (mineNow <= 0) return;
		setPressed((p) => p - 1);
		deltaRef.current -= 1;
		scheduleFlush();
	};
	return (
		<button
			type="button"
			title="Click adds a press · right-click takes one back"
			aria-label={
				atCap
					? `${votesNow} votes — your ${VOTE_CAP} are in; right-click or press minus to take one back`
					: `${votesNow} votes — press to add yours (${mineNow} of ${VOTE_CAP})`
			}
			aria-keyshortcuts="Minus"
			onClick={pressUp}
			onContextMenu={(e) => {
				e.preventDefault();
				pressDown();
			}}
			onKeyDown={(e) => {
				if (e.key === "-") {
					e.preventDefault();
					pressDown();
				}
			}}
			className={`group flex shrink-0 items-center gap-2 font-ui text-[13px] tabular-nums transition-colors duration-150 hover:text-ink ${atCap ? "text-ink" : "text-muted-foreground"}`}
		>
			{/* keying by press count re-mounts the glyph → the pop replays */}
			<span key={mineNow} className={mineNow > 0 ? "animate-vote-pop" : ""}>
				<TorchGlyph level={level} lit={atCap} />
				{mineNow > 0 && !atCap && (
					<span aria-hidden className="pointer-events-none relative">
						<span className="absolute -top-4 left-0 size-[3px] rounded-full bg-dot-teaches animate-vote-spark-1" />
						<span className="absolute -top-3 left-2 size-[2.5px] rounded-full bg-dot-media animate-vote-spark-2" />
					</span>
				)}
			</span>
			{votesNow}
		</button>
	);
}

function safeCount(n: number): number {
	return Number.isFinite(n) ? n : 0;
}

/** The torch (Abram, 2026-08-01): head + handle fill with `level`; at
 * full the whole torch tips slightly and the flame IGNITES, then
 * flickers while lit. Reduced motion: states apply instantly — fill
 * rises, tilt holds, no flicker. */
function TorchGlyph({ level, lit }: { level: number; lit: boolean }) {
	const pct = Math.round(level * 100);
	const clipId = `torch-fill-${pct}`;
	return (
		<svg
			viewBox="0 0 32 32"
			className={`size-[19px] ${lit ? "torch-lit" : ""}`}
			aria-hidden="true"
		>
			<defs>
				<clipPath id={clipId}>
					<rect x="0" y={31 - 19 * (pct / 100)} width="32" height={19 * (pct / 100) + 1} />
				</clipPath>
			</defs>
			{/* the flame — exists only once lit; ignites from the head */}
			{lit && (
				<path
					className="torch-flame"
					d="M16 1.5 C14.2 3.9 13.6 5.7 14.3 7.3 C14.9 8.7 16.5 9 17.6 8.1 C18.8 7.1 18.7 5.4 17.9 3.9 C17.3 2.9 16.7 2.1 16 1.5 Z"
					fill="currentColor"
				/>
			)}
			{/* head wrap + handle, outline */}
			<g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
				<path d="M11.5 12.5 h9 l-1.6 5.5 h-5.8 Z" />
				<path d="M14.6 18 L14 29 a2 2 0 0 0 4 0 L17.4 18" />
			</g>
			{/* the fill, rising with presses */}
			<g fill="currentColor" clipPath={`url(#${clipId})`}>
				<path d="M11.5 12.5 h9 l-1.6 5.5 h-5.8 Z" />
				<path d="M14.6 18 L14 29 a2 2 0 0 0 4 0 L17.4 18 Z" />
			</g>
		</svg>
	);
}

const STATE_LABEL: Record<string, string> = {
	building: "Building",
	planned: "Planned",
	proposed: "Proposed — ranked by your votes",
	shipped: "Shipped",
};

export default function Roadmap({ loaderData }: Route.ComponentProps) {
	const { features, mine, signedIn } = loaderData;
	const groups: Array<[string, RoadmapFeature[]]> = ["building", "planned", "proposed", "shipped"]
		.map((state) => {
			const rows = features.filter((f) => f.state === state);
			rows.sort((a, b) =>
				state === "proposed"
					? b.votes - a.votes || a.title.localeCompare(b.title)
					: (a.sort_order ?? 99) - (b.sort_order ?? 99) || a.title.localeCompare(b.title),
			);
			return [state, rows] as [string, RoadmapFeature[]];
		})
		.filter(([, rows]) => rows.length > 0);

	return (
		<PageFrame frame="column">
			<PageHeader
				title="Roadmap"
				intro={
					signedIn
						? `In rough order. No dates. Press the flame on what you want — up to ${VOTE_CAP} presses each.`
						: "In rough order. No dates. Sign in to vote for what you want."
				}
			/>
			{groups.map(([state, rows]) => (
				<section key={state} aria-labelledby={`rm-${state}`} className="mt-8">
					<h2 id={`rm-${state}`} className="font-ui text-[13px] font-normal text-muted-foreground">
						{STATE_LABEL[state]}
					</h2>
					<ul className="mt-2 list-none">
						{rows.map((f) => (
							<li
								key={f.id}
								className="flex items-center justify-between gap-6 border-b border-rule py-3 last:border-b-0"
							>
								<div className="min-w-0">
									<p className="font-reading text-[16px] leading-relaxed text-ink">{f.title}</p>
									{f.detail && (
										<p className="mt-0.5 font-reading text-[14px] leading-relaxed text-muted-foreground">
											{f.detail}
										</p>
									)}
								</div>
								{f.state === "shipped" ? (
									<span className="shrink-0 font-ui text-[12px] tabular-nums text-muted-foreground">
										{f.shipped_at ?? ""}
									</span>
								) : (
									<FlameVote
										feature={f.id}
										votes={f.votes}
										mine={mine[f.id] ?? 0}
										signedIn={signedIn}
									/>
								)}
							</li>
						))}
					</ul>
				</section>
			))}
		</PageFrame>
	);
}
