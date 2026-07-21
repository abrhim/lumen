import { useEffect, useState } from "react";
import { Form, Link, useLocation, useRouteLoaderData } from "react-router";
import { MenuIcon } from "lucide-react";
import { useIsMobile } from "~/hooks/use-mobile";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "~/components/ui/sheet";
import type { loader as rootLoader } from "~/root";

const THEMES = ["paper", "parchment", "linen", "ink"] as const;
/** Swatch = each theme's paper ground (mirrors the --t-paper values in app.css). */
const THEME_SWATCH: Record<(typeof THEMES)[number], string> = {
	paper: "#fafaf7",
	parchment: "#f3ede1",
	linen: "#f3f6f7",
	ink: "#17181c",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<p className="font-ui text-[10px] font-bold uppercase tracking-[0.14em] text-faint">
			{children}
		</p>
	);
}

/** Universal menu (PROTOTYPE): one identity-aware trigger — avatar initial
 * when signed in, menu glyph when not — opening navigation + personal
 * settings. Popover on desktop, bottom drawer on mobile; the portal is
 * MOUNT-GATED on matchMedia (use-mobile), never CSS-hidden. Deliberately NO
 * Admin link (DEC-A: gated routes stay unadvertised). Future home for
 * collection visibility toggles (spine fast-follow). */
export function AppMenu() {
	const [open, setOpen] = useState(false);
	const [theme, setTheme] = useState<string>("paper");
	const isMobile = useIsMobile();
	const location = useLocation();
	const root = useRouteLoaderData<typeof rootLoader>("root");
	const user = root?.user;
	const email = user?.email ?? null;

	useEffect(() => {
		setTheme(document.documentElement.dataset.theme ?? "paper");
	}, []);

	const applyTheme = (next: string) => {
		setTheme(next);
		document.documentElement.dataset.theme = next;
		try {
			localStorage.setItem("lumen-theme", next);
		} catch {
			/* private mode */
		}
	};

	const navItem = (to: string, label: string, hint?: string) => {
		const current = location.pathname === to;
		return (
			<Link
				to={to}
				onClick={() => setOpen(false)}
				aria-current={current ? "page" : undefined}
				className={`flex items-baseline justify-between rounded-md px-2.5 py-2 font-ui text-sm font-semibold transition-colors duration-150 hover:bg-sel ${
					current ? "text-primary" : "text-ink"
				}`}
			>
				{label}
				{hint && <span className="font-normal text-[11px] text-faint">{hint}</span>}
			</Link>
		);
	};

	const panel = (
		<div className="flex flex-col gap-5">
			<div>
				<SectionLabel>Navigate</SectionLabel>
				<nav className="mt-1.5 flex flex-col">
					{navItem("/", "Library")}
					{navItem("/collections/the-grove", "The Grove", "collection")}
				</nav>
			</div>

			<div>
				<SectionLabel>
					Theme · <span className="normal-case">{theme}</span>
				</SectionLabel>
				<div className="mt-2.5 flex gap-2.5 px-1" role="radiogroup" aria-label="Theme">
					{THEMES.map((t) => (
						<button
							key={t}
							type="button"
							role="radio"
							aria-checked={theme === t}
							aria-label={`${t} theme`}
							onClick={() => applyTheme(t)}
							className={`relative size-7 rounded-full border transition-shadow duration-150 after:absolute after:-inset-1.5 after:content-[''] ${
								theme === t
									? "border-primary ring-2 ring-primary/40"
									: "border-rule2 hover:border-primary"
							}`}
							style={{ backgroundColor: THEME_SWATCH[t] }}
						/>
					))}
				</div>
			</div>

			<div className="border-t border-rule pt-4">
				<SectionLabel>Account</SectionLabel>
				{email ? (
					<div className="mt-1.5 flex items-center justify-between gap-3 px-1">
						<span className="min-w-0 truncate font-ui text-xs text-muted-foreground">{email}</span>
						<Form method="post" action="/logout">
							<input
								type="hidden"
								name="returnTo"
								value={location.pathname + location.search}
							/>
							<button
								type="submit"
								className="flex-none rounded-full border border-rule2 px-3 py-1 font-ui text-xs font-semibold text-primary transition-colors duration-150 hover:border-primary"
							>
								Sign out
							</button>
						</Form>
					</div>
				) : (
					<Link
						to="/login"
						onClick={() => setOpen(false)}
						className="mt-1.5 flex items-baseline justify-between rounded-md px-2.5 py-2 font-ui text-sm font-semibold text-primary transition-colors duration-150 hover:bg-sel"
					>
						Sign in
						<span aria-hidden="true">→</span>
					</Link>
				)}
			</div>
		</div>
	);

	const trigger = (
		<button
			type="button"
			aria-label="Menu"
			// visual size-8 with a 44px hit box (after: overlay) — Emil touch rule
			className="relative flex size-8 items-center justify-center rounded-full border border-rule2 bg-panel2 font-ui text-xs font-semibold uppercase text-ink shadow-sm outline-none transition-colors duration-150 hover:border-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 after:absolute after:-inset-2 after:content-['']"
		>
			{email ? email.slice(0, 1) : <MenuIcon className="size-4" aria-hidden="true" />}
		</button>
	);

	// Which Radix root mounts is the matchMedia gate; Radix itself only mounts
	// portal content while open.
	return isMobile ? (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger asChild>{trigger}</SheetTrigger>
			<SheetContent side="bottom" className="px-6 pb-8">
				<SheetHeader className="px-0 pb-1">
					<SheetTitle className="font-display text-lg font-medium">Lumen</SheetTitle>
				</SheetHeader>
				{panel}
			</SheetContent>
		</Sheet>
	) : (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent align="end" sideOffset={8} className="w-72 p-4">
				{panel}
			</PopoverContent>
		</Popover>
	);
}
