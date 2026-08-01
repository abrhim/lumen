import { useEffect, useRef, useState } from "react";
import { Link, data, redirect, useFetcher } from "react-router";
import { PageFrame, PageHeader } from "~/components/PageFrame";
import { getSessionUser } from "~/lib/auth.server";
import { listRoadmap, pressUnvote, pressVote, type RoadmapFeature } from "~/lib/roadmap.server";

/** mirror of the SQL cap in migrate-roadmap.mjs (client-safe display) */
const VOTE_CAP = 3;
import type { Route } from "./+types/roadmap";

/**
 * Roadmap (2026-08-01): features live in lumen.roadmap_features. Anyone
 * sees the standings; signed-in readers press the chevron — up to
 * VOTE_CAP presses each. Signed out, the chevron is the sign-in door.
 */

export async function loader({ request, context }: Route.LoaderArgs) {
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	headers.set("Cache-Control", "private, no-store");
	const features = await listRoadmap(context.db, user?.id ?? null);
	return data({ features, signedIn: user !== null }, { headers });
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
	const n = Math.min(VOTE_CAP, Math.max(1, parseInt(String(form.get("n") ?? "1"), 10) || 1));
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

/** The vote: a chevron that fills with YOUR presses and a total that rolls
 * on change. Left-click adds a press, right-click (or the minus key) takes
 * one back. Signed out it is a plain door to /login. */
function VoteControl({
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
	// rapid presses race a single fetcher (each submit aborts the last), so
	// presses accumulate locally and flush as ONE request carrying the delta
	const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const deltaRef = useRef(0);
	useEffect(() => {
		// server truth arrived — fold it in and clear the optimistic layer
		if (fetcher.data?.ok && fetcher.data.feature === feature && fetcher.data.count != null) {
			baseMine.current = fetcher.data.count;
			setPressed(0);
		}
	}, [fetcher.data, feature]);
	const mineNow = Math.max(0, Math.min(safeCount(baseMine.current) + pressed, VOTE_CAP));
	const votesNow = Math.max(0, votes - mine + mineNow);
	const level = mineNow / VOTE_CAP;
	const atCap = mineNow >= VOTE_CAP;

	if (!signedIn) {
		return (
			<Link
				to="/login?next=%2Froadmap"
				className="flex shrink-0 items-center gap-2 font-ui text-[13px] tabular-nums text-muted-foreground transition-colors duration-150 hover:text-ink"
				aria-label={`${votes} votes — sign in to vote`}
			>
				<ChevronGlyph level={0} full={false} />
				<Ticker value={votes} />
			</Link>
		);
	}

	const spent = mineNow > 0;

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
		<div
			className={`flex shrink-0 items-center gap-1.5 font-ui text-[13px] tabular-nums ${spent ? "text-ink" : "text-muted-foreground"}`}
		>
			<button
				type="button"
				title="Add a press"
				aria-label={
					atCap
						? `${votesNow} votes — your ${VOTE_CAP} are in`
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
				className="flex items-center px-0.5 transition-colors duration-150 hover:text-primary"
			>
				{/* keying by press count re-mounts the glyph → the lift replays */}
				<span key={mineNow} className={spent ? "animate-vote-lift" : ""}>
					<ChevronGlyph level={level} full={atCap} />
				</span>
			</button>
			<Ticker value={votesNow} />
			<button
				type="button"
				title="Take a press back"
				aria-label={`take a press back (${mineNow} of ${VOTE_CAP})`}
				onClick={pressDown}
				disabled={!spent}
				className="flex items-center px-0.5 transition-colors duration-150 hover:text-primary disabled:cursor-default disabled:opacity-30 disabled:hover:text-current"
			>
				<ChevronGlyph dir="down" />
			</button>
		</div>
	);
}

function safeCount(n: number): number {
	return Number.isFinite(n) ? n : 0;
}

/** The chevron. Up: a muted track with your presses filling both arms from
 * their ends toward the apex, solid and lifted once all of them are in.
 * Down: a plain glyph — it's an action, not a gauge. */
function ChevronGlyph({
	level = 0,
	full = false,
	dir = "up",
}: {
	level?: number;
	full?: boolean;
	dir?: "up" | "down";
}) {
	const pct = Math.round(level * 100);
	const clipId = `vote-fill-${pct}`;
	const d = "M4.5 15 L12 7.5 L19.5 15";
	if (dir === "down") {
		return (
			<svg viewBox="0 0 24 24" className="size-[16px]" aria-hidden="true">
				<path
					d="M4.5 9.5 L12 17 L19.5 9.5"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		);
	}
	return (
		<svg
			viewBox="0 0 24 24"
			className={`size-[16px] vote-chevron ${full ? "vote-chevron-full" : ""}`}
			aria-hidden="true"
		>
			<defs>
				<clipPath id={clipId}>
					<rect x="0" y={17 - 11 * (pct / 100)} width="24" height={11 * (pct / 100) + 1} />
				</clipPath>
			</defs>
			<path
				d={d}
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				opacity="0.3"
			/>
			<path
				d={d}
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				clipPath={`url(#${clipId})`}
			/>
		</svg>
	);
}

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** The total, as an odometer: only the digits that change roll. The
 * button's aria-label carries the spoken value, so the strips themselves
 * stay out of the accessibility tree. */
function Ticker({ value }: { value: number }) {
	const chars = String(Math.max(0, value)).split("");
	return (
		<span aria-hidden className="ticker">
			{chars.map((ch, i) => (
				// keyed from the RIGHT so crossing 9→10 pushes a column on the
				// front instead of re-rolling every place
				<span key={chars.length - i} className="ticker-col">
					<span
						className="ticker-strip"
						style={{ transform: `translateY(-${Number(ch) * 10}%)` }}
					>
						{DIGITS.map((digit) => (
							<span key={digit} className="ticker-digit">
								{digit}
							</span>
						))}
					</span>
				</span>
			))}
		</span>
	);
}

const STATE_LABEL: Record<string, string> = {
	building: "Building",
	planned: "Planned",
	proposed: "Proposed — ranked by your votes",
	shipped: "Shipped",
};

export default function Roadmap({ loaderData }: Route.ComponentProps) {
	const { features, signedIn } = loaderData;
	const groups: Array<[string, RoadmapFeature[]]> = ["building", "planned", "proposed", "shipped"]
		.map((state) => {
			const rows = features.filter((f) => f.state === state);
			rows.sort((a, b) =>
				state === "proposed"
					? b.votes - a.votes || a.title.localeCompare(b.title)
					: state === "shipped"
						? (b.shipped_at ?? "").localeCompare(a.shipped_at ?? "") ||
							a.title.localeCompare(b.title)
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
						? `In rough order. No dates. Vote on the features you want most — up to ${VOTE_CAP} presses each.`
						: "In rough order. No dates. Sign in to vote on the features you want most."
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
									<VoteControl
										feature={f.id}
										votes={f.votes}
										mine={f.mine}
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
