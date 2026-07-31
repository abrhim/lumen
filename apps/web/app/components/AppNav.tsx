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
	{ to: "/collections", label: "Collections", match: /^\/(collections|media|strongs|art)/ },
	{ to: "/me", label: "Me", match: /^\/me/ },
	{ to: "/about", label: "About", match: /^\/about/ },
	{ to: "/roadmap", label: "Roadmap", match: /^\/roadmap/ },
] as const;

/** The mark (icon exploration round 4, #7): beam, posts, the strike. */
function LintelMark({ className = "h-[13px] w-[16px]" }: { className?: string }) {
	return (
		<svg viewBox="0 3 32 26" fill="currentColor" aria-hidden="true" className={className}>
			<rect x="5" y="7" width="22" height="4.5" rx="1" />
			<rect x="6.5" y="13.5" width="4.5" height="15.5" rx="1" />
			<rect x="21" y="13.5" width="4.5" height="15.5" rx="1" />
			<path d="M16 3 C16 3 14.2 5.2 14.2 6.4 a1.8 1.8 0 0 0 3.6 0 C17.8 5.2 16 3 16 3 Z" />
		</svg>
	);
}

function summonSearch(e: { preventDefault: () => void }) {
	// the modal claims the summon by cancelling the event; if search chrome
	// ever crashes, nothing claims it and the word degrades to plain
	// navigation to /search — still a door (BRRU-3 posture)
	const ev = new CustomEvent("lumen:open-search", { cancelable: true });
	window.dispatchEvent(ev);
	if (ev.defaultPrevented) e.preventDefault();
}

function items(pathname: string, itemClass: string, masthead: boolean) {
	return (
		<>
			<Link
				to="/"
				className={
					masthead
						? `${itemClass} mb-3 flex items-center gap-2.5 font-display text-[26px] font-medium tracking-tight text-ink hover:text-primary`
						: `${itemClass} flex items-center gap-1.5 font-semibold tracking-tight text-ink hover:text-primary`
				}
			>
				<LintelMark className={masthead ? "h-[22px] w-[27px] self-center translate-y-[1px]" : "h-[13px] w-[16px] self-center translate-y-[1px]"} />
				Lintel
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
			<Link
				to="/search"
				onClick={summonSearch}
				className={`${itemClass} text-muted-foreground hover:text-ink`}
			>
				Search <span className="font-normal text-[11px] text-muted-foreground">⌘K</span>
			</Link>
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
				{items(pathname, "app-nav-item px-1 py-1 outline-none transition-colors duration-150 focus-visible:underline", true)}
			</nav>
			{/* the same words as a top row everywhere else */}
			<nav
				aria-label="Primary"
				className="mx-auto flex max-w-6xl items-baseline gap-x-5 px-6 pt-4 pr-28 font-ui text-sm min-[1440px]:hidden"
			>
				{items(pathname, "-my-2 px-1 py-2 outline-none transition-colors duration-150 focus-visible:underline", false)}
			</nav>
		</>
	);
}
