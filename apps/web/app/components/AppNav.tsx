import { Link, useLocation } from "react-router";

/**
 * Global nav (Abram, 2026-07-31): wayfinding words on every page —
 * "scripture home, my notes, the collections list, one click." On wide
 * viewports it is a LEFT RAIL: containerless words off to the left,
 * plenty of air, and on hover a large soft rounded shadow floats up
 * behind the word (`.app-nav-item` in app.css — hand CSS, no shadcn).
 * Below 1440px the same words render as a quiet top row instead: the
 * reader's centered column owns the left margin there and the rail
 * would collide.
 *
 * Typography only (doctrine 8). Current section: full ink + the house
 * dotted underline. The fixed search/menu cluster stays top-right.
 */
const SECTIONS = [
	{ to: "/", label: "Scripture", match: /^\/($|scripture|word)/ },
	{ to: "/notes", label: "Notes", match: /^\/notes/ },
	{ to: "/collections", label: "Collections", match: /^\/(collections|media)/ },
	{ to: "/me", label: "Me", match: /^\/me/ },
] as const;

function items(pathname: string, itemClass: string) {
	return (
		<>
			<Link
				to="/"
				className={`${itemClass} font-semibold tracking-tight text-ink hover:text-primary`}
			>
				<span aria-hidden="true">⁂ </span>Lumen
			</Link>
			{SECTIONS.map(({ to, label, match }) => {
				const current = match.test(pathname);
				return (
					<Link
						key={label}
						to={to}
						aria-current={current ? "page" : undefined}
						className={`${itemClass} ${
							current
								? "text-ink underline decoration-dotted underline-offset-4"
								: "text-muted-foreground hover:text-ink"
						}`}
					>
						{label}
					</Link>
				);
			})}
		</>
	);
}

export function AppNav() {
	const { pathname } = useLocation();
	return (
		<>
			{/* the left rail — wide viewports only (the reader's centered
			    column owns the left margin below 1440) */}
			<nav
				aria-label="Primary"
				className="fixed left-10 top-28 z-30 hidden w-fit flex-col items-start gap-y-3 font-ui text-sm min-[1440px]:flex"
			>
				{items(pathname, "app-nav-item px-1 py-1 outline-none transition-colors duration-150 focus-visible:underline")}
			</nav>
			{/* the same words as a top row everywhere else */}
			<nav
				aria-label="Primary"
				className="mx-auto flex max-w-6xl items-baseline gap-x-5 px-6 pt-4 pr-28 font-ui text-sm min-[1440px]:hidden"
			>
				{items(pathname, "-my-2 px-1 py-2 outline-none transition-colors duration-150 focus-visible:underline")}
			</nav>
		</>
	);
}
