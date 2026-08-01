import { Link, useLocation } from "react-router";
import { LintelMark } from "./LintelMark";

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
	{ to: "/collections", label: "Collections", match: /^\/(collections|media|strongs|art)/ },
	{ to: "/about", label: "About", match: /^\/about/ },
	{ to: "/roadmap", label: "Roadmap", match: /^\/roadmap/ },
] as const;

function summonSearch(e: { preventDefault: () => void }) {
	// the modal claims the summon by cancelling the event; if search chrome
	// ever crashes, nothing claims it and the word degrades to plain
	// navigation to /search — still a door (BRRU-3 posture)
	const ev = new CustomEvent("lumen:open-search", { cancelable: true });
	window.dispatchEvent(ev);
	if (ev.defaultPrevented) e.preventDefault();
}

function items(pathname: string, itemClass: string) {
	return (
		<>
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
			<Link
				to="/search"
				onClick={summonSearch}
				className={`${itemClass} text-muted-foreground hover:text-ink`}
			>
				Search <span className="font-normal text-[11px] text-muted-foreground">⌘K</span>
			</Link>
			<Link
				to="/me"
				aria-current={/^\/me/.test(pathname) ? "page" : undefined}
				className={`${itemClass} ${
					/^\/me/.test(pathname)
						? "text-ink underline decoration-dotted underline-offset-4"
						: "text-muted-foreground hover:text-ink"
				}`}
			>
				Me
			</Link>
		</>
	);
}

export function AppNav() {
	const { pathname } = useLocation();
	return (
		<>
			{/* the masthead sits at the top ALWAYS, outside the nav (Abram);
			    on narrow the word-row shares its line, to the right */}
			<div className="flex flex-wrap items-center gap-x-7 gap-y-1 px-6 pt-5">
				<Link
					to="/"
					className="inline-flex items-center gap-2.5 font-display text-[26px] font-medium tracking-tight text-ink outline-none transition-colors duration-150 hover:text-primary focus-visible:underline"
				>
					<LintelMark className="h-[26px] w-[32px]" />
					Lintel
				</Link>
				<nav
					aria-label="Primary"
					className="app-toprow flex-wrap items-center gap-x-5 gap-y-1 font-ui text-sm"
				>
					{items(pathname, "-my-2 px-1 py-2 outline-none transition-colors duration-150 focus-visible:underline")}
				</nav>
			</div>
			{/* the words: a left rail on wide viewports (the reader's centered
			    column owns the left margin below 1440)… */}
			<nav
				aria-label="Primary"
				className="app-rail fixed left-8 top-28 z-30 w-fit flex-col items-start gap-y-3 font-ui text-sm"
			>
				{items(pathname, "app-nav-item px-1 py-1 outline-none transition-colors duration-150 focus-visible:underline")}
			</nav>

		</>
	);
}
