import type { ReactNode, RefObject } from "react";

/**
 * THE layout canon (Abram, 2026-07-31) — encoded in code so it never
 * depends on anyone remembering it. Every page renders inside PageFrame;
 * a page that doesn't is either on the exemption list below or wrong.
 *
 * Three frames, one rhythm:
 *  - column  (max-w-2xl) — prose gets a text measure: notes, me, auth,
 *    collections index
 *  - ledger  (max-w-4xl) — lists get a page: home, book contents,
 *    strong's, word study, search, art index, node pages, admin
 *  - gallery (max-w-6xl) — pictures get the room: chapter art
 *
 * EXEMPT BY DESIGN (bespoke plates, on the record): the reader
 * (scripture.tsx — refereed centered column + rail grid) and the media
 * episode page (transport layout). They adopt the py-12 rhythm where it
 * touches but own their geometry.
 *
 * No frame changes while the user is inside a route's flow — drilling
 * within a section must never make the page narrow or widen.
 */

const FRAME_WIDTH = {
	column: "max-w-2xl",
	ledger: "max-w-4xl",
	gallery: "max-w-6xl",
} as const;

export type Frame = keyof typeof FRAME_WIDTH;

export function PageFrame({
	frame = "column",
	className,
	children,
	mainRef,
	onKeyDown,
}: {
	frame?: Frame;
	className?: string;
	children: ReactNode;
	mainRef?: RefObject<HTMLElement | null>;
	onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
}) {
	return (
		<main
			ref={mainRef}
			onKeyDown={onKeyDown}
			className={`mx-auto ${FRAME_WIDTH[frame]} px-6 py-12${className ? ` ${className}` : ""}`}
		>
			{children}
		</main>
	);
}

/** The house header: hairline underneath, optional quiet kicker word,
 * the 3xl display title, optional roman intro. Pages with composite
 * titles (word study's glyph row) hand-build their header inside
 * PageFrame instead — the frame is the load-bearing part. */
export function PageHeader({
	kicker,
	title,
	titleRef,
	titleTabIndex,
	intro,
	children,
}: {
	kicker?: ReactNode;
	title: ReactNode;
	/** focus-management pass-throughs (the notes pages land focus here) */
	titleRef?: RefObject<HTMLHeadingElement | null>;
	titleTabIndex?: number;
	intro?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<header className="border-b border-rule pb-6">
			{kicker && (
				<p className="font-ui text-[13px] font-normal text-muted-foreground">{kicker}</p>
			)}
			<h1
				ref={titleRef}
				tabIndex={titleTabIndex}
				className={`font-display text-3xl font-medium tracking-tight outline-none${kicker ? " mt-1" : ""}`}
			>
				{title}
			</h1>
			{intro && (
				<p className="mt-2 font-reading text-[15px] leading-relaxed text-muted-foreground">
					{intro}
				</p>
			)}
			{children}
		</header>
	);
}
