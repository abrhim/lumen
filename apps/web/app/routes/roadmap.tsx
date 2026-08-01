import { useEffect, useRef, useState } from "react";
import { Link, data, redirect, useFetcher } from "react-router";
import { PageFrame, PageHeader } from "~/components/PageFrame";
import { getSessionUser } from "~/lib/auth.server";
import { listRoadmap, myVotes, pressVote, type RoadmapFeature } from "~/lib/roadmap.server";

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
	const count = await pressVote(request, context.cloudflare.env, featureId);
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
	// optimistic presses: queued submissions count immediately
	const [pressed, setPressed] = useState(0);
	const baseMine = useRef(mine);
	useEffect(() => {
		// server truth arrived — fold it in and clear the optimistic layer
		if (fetcher.data?.ok && fetcher.data.feature === feature && fetcher.data.count != null) {
			baseMine.current = fetcher.data.count;
			setPressed(0);
		}
	}, [fetcher.data, feature]);
	const mineNow = Math.min(safeCount(baseMine.current) + pressed, VOTE_CAP);
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
				<FlameGlyph level={0} />
				{votes}
			</Link>
		);
	}

	return (
		<button
			type="button"
			disabled={atCap}
			aria-label={
				atCap
					? `${votesNow} votes — your ${VOTE_CAP} are in`
					: `${votesNow} votes — press to add yours (${mineNow} of ${VOTE_CAP})`
			}
			onClick={() => {
				if (atCap) return;
				setPressed((p) => p + 1);
				fetcher.submit({ feature }, { method: "post" });
			}}
			className="group flex shrink-0 items-center gap-2 font-ui text-[13px] tabular-nums text-muted-foreground transition-colors duration-150 hover:text-ink disabled:cursor-default disabled:text-ink"
		>
			{/* keying by press count re-mounts the glyph → the pop replays */}
			<span key={mineNow} className={mineNow > 0 ? "motion-safe:animate-vote-pop" : ""}>
				<FlameGlyph level={level} />
				{mineNow > 0 && !atCap && (
					<span aria-hidden className="pointer-events-none relative">
						<span className="absolute -top-4 left-0 size-[3px] rounded-full bg-dot-teaches motion-safe:animate-vote-spark-1" />
						<span className="absolute -top-3 left-2 size-[2.5px] rounded-full bg-dot-media motion-safe:animate-vote-spark-2" />
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

/** Two-layer flame: quiet outline, fill rising with `level` (0..1). */
function FlameGlyph({ level }: { level: number }) {
	const pct = Math.round(level * 100);
	return (
		<svg viewBox="0 0 32 32" className="size-[18px]" aria-hidden="true">
			<defs>
				<clipPath id={`flame-fill-${pct}`}>
					<rect x="0" y={`${32 - (26 * pct) / 100 - 3}`} width="32" height={`${(26 * pct) / 100 + 3}`} />
				</clipPath>
			</defs>
			<path
				d="M16 3 C16 3 8 12 8 19 a8 8 0 0 0 16 0 C24 12 16 3 16 3 Z"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			/>
			{pct > 0 && (
				<path
					d="M16 3 C16 3 8 12 8 19 a8 8 0 0 0 16 0 C24 12 16 3 16 3 Z"
					fill="currentColor"
					clipPath={`url(#flame-fill-${pct})`}
				/>
			)}
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
