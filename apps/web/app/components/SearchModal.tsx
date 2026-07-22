import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { SearchIcon } from "lucide-react";
import { useIsMobile } from "~/hooks/use-mobile";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "~/components/ui/sheet";

/** Mirrors Q_MIN (search-request.server) — the .server module can't ship in
 * client code; the modal only gates its own submit with it. */
const MODAL_Q_MIN = 2;

/** Global search entry (search-ui plan): orb beside AppMenu, `/` and `⌘K`
 * app-wide. Minimal on purpose — one input, Enter navigates to /search?q=
 * (always scope-clean, Q3), Escape closes. On /search the page owns the
 * hotkeys (they focus the inline input) and this component stands down —
 * the modal never stacks over the page (F9). Focus-trap and return-focus
 * come from the house Radix Dialog/Sheet (Δ AU-3); which root mounts is the
 * matchMedia gate, same as AppMenu (Δ UU-5). */
export function SearchModal() {
	const [open, setOpen] = useState(false);
	const [q, setQ] = useState("");
	const isMobile = useIsMobile();
	const location = useLocation();
	const navigate = useNavigate();
	const onSearchPage = location.pathname === "/search";

	useEffect(() => {
		if (onSearchPage) return;
		const onKeyDown = (e: KeyboardEvent) => {
			// ⌘K opens EVERYWHERE — including inside inputs (Decisions SU-6).
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setOpen(true);
				return;
			}
			// Bare `/` opens only outside editable targets.
			if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
				const t = e.target as HTMLElement | null;
				const editable =
					t &&
					(t.tagName === "INPUT" ||
						t.tagName === "TEXTAREA" ||
						t.tagName === "SELECT" ||
						t.isContentEditable);
				if (editable) return;
				e.preventDefault();
				setOpen(true);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onSearchPage]);

	const onSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = q.trim();
		if (trimmed.length < MODAL_Q_MIN) return;
		setOpen(false);
		setQ("");
		navigate(`/search?${new URLSearchParams({ q: trimmed })}`);
	};

	const trigger = (
		<button
			type="button"
			aria-label="Search"
			title="Search ( / or ⌘K )"
			// visual size-8 with a 44px hit box (after: overlay) — Emil touch rule
			className="relative flex size-8 items-center justify-center rounded-full border border-rule2 bg-panel2 text-ink shadow-sm outline-none transition-colors duration-150 hover:border-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 after:absolute after:-inset-2 after:content-['']"
		>
			<SearchIcon className="size-4" aria-hidden="true" />
		</button>
	);

	const form = (
		<form onSubmit={onSubmit}>
			<input
				type="search"
				value={q}
				onChange={(e) => setQ(e.target.value)}
				autoComplete="off"
				spellCheck={false}
				enterKeyHint="search"
				aria-label="Search the library"
				placeholder="a name, a phrase, a verse…"
				className="w-full rounded-none border-0 border-b border-rule2 bg-transparent pb-2 pt-1 font-display text-2xl font-medium tracking-[-0.01em] text-ink caret-selbar outline-none transition-colors duration-150 placeholder:font-reading placeholder:text-base placeholder:font-normal placeholder:italic placeholder:tracking-normal placeholder:text-faint focus-visible:border-selbar"
			/>
		</form>
	);

	return isMobile ? (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger asChild>{trigger}</SheetTrigger>
			<SheetContent side="bottom" className="px-6 pb-8 motion-reduce:animate-none">
				<SheetHeader className="px-0 pb-1">
					<SheetTitle className="font-display text-lg font-medium">Search</SheetTitle>
				</SheetHeader>
				{form}
			</SheetContent>
		</Sheet>
	) : (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent
				showCloseButton={false}
				aria-describedby={undefined}
				className="top-[22vh] max-w-md translate-y-0 gap-3 p-5 motion-reduce:animate-none"
			>
				<DialogTitle className="sr-only">Search the library</DialogTitle>
				{form}
				<p className="font-ui text-[11px] font-medium text-faint">
					<kbd className="mr-0.5 rounded border border-rule2 px-1 py-px font-ui text-[10px] font-semibold">
						Enter
					</kbd>{" "}
					to search ·{" "}
					<kbd className="mx-0.5 rounded border border-rule2 px-1 py-px font-ui text-[10px] font-semibold">
						Esc
					</kbd>{" "}
					to close
				</p>
			</DialogContent>
		</Dialog>
	);
}
