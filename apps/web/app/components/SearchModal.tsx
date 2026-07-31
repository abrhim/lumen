import { useEffect, useRef, useState } from "react";
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

/** One class for the orb in every form (interactive trigger, SSR/degraded
 * anchor) so they stay pixel-identical. Visual size-8 with a 44px hit box
 * (after: overlay) — Emil touch rule. */
const ORB_CLASS =
	"relative flex size-8 items-center justify-center rounded-full border border-rule2 bg-panel2 text-ink shadow-sm outline-none transition-colors duration-150 hover:border-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 after:absolute after:-inset-2 after:content-['']";

/** SSR-safe, dependency-free orb: a plain link to /search. This is what renders
 * server-side and before hydration (B19 — the interactive modal mounts
 * client-only so an SSR render throw in its subtree, Radix Dialog/Sheet or
 * use-mobile, can't reject the shell and replace every route's document), what
 * SearchChromeBoundary degrades to, and what shows on /search itself where the
 * page owns search entirely (B21/B28/B29 — with no live DialogTrigger here the
 * modal can never stack over the page or be Space-reopened). */
export function SearchOrbAnchor() {
	return (
		<a href="/search" aria-label="Search" title="Search" className={ORB_CLASS}>
			<SearchIcon className="size-4" aria-hidden="true" />
		</a>
	);
}

/** Global search entry (search-ui plan): orb beside AppMenu, `/` and `⌘K`
 * app-wide. Minimal on purpose — one input, Enter navigates to /search?q=
 * (always scope-clean, Q3), Escape closes. On /search the page owns the
 * hotkeys (they focus the inline input) and this component stands down to a
 * plain link — the modal never stacks over the page (F9). Focus-trap and
 * return-focus come from the house Radix Dialog/Sheet (Δ AU-3); which root
 * mounts is the matchMedia gate, same as AppMenu (Δ UU-5). */
export function SearchModal({ hideTrigger = false }: { hideTrigger?: boolean } = {}) {
	// B19: mount the interactive modal client-only. SSR + first paint render the
	// static anchor (unthrowable), so a render throw in the Radix/use-mobile
	// subtree can only reach SearchChromeBoundary on the CLIENT, never reject the
	// server shell. The class boundary can't catch SSR throws (client-only).
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	const location = useLocation();
	// B28: the route matches trailing-slash URLs (`GET /search/` → 200), so a
	// bare `=== "/search"` would leave the modal live on /search/ and let `/`/⌘K
	// stack the Dialog over the page. Normalize the trailing slash (same
	// proxy-vs-source class as B-U2).
	const onSearchPage = location.pathname.replace(/\/+$/, "") === "/search";

	if (!mounted || onSearchPage) return hideTrigger ? null : <SearchOrbAnchor />;
	return <SearchModalInteractive hideTrigger={hideTrigger} />;
}

function SearchModalInteractive({ hideTrigger = false }: { hideTrigger?: boolean }) {
	const [open, setOpen] = useState(false);
	const [q, setQ] = useState("");
	// B-U1 (Abram, live test) + B21: a pointer-opened modal must NOT return focus
	// to the orb on close — the focused button then turns Space-to-scroll into
	// Space-reopens-search. Keyboard opens keep the a11y return-focus. The flag is
	// (re)computed at each open from the trigger click's `detail` so a cancelled
	// earlier pointerdown can't leave it stale-true and drop keyboard return-focus.
	const openedByPointer = useRef(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const isMobile = useIsMobile();
	const navigate = useNavigate();
	// B13: keyboard-avoidance offset for the fixed bottom Sheet (see effect below).
	const [kbInset, setKbInset] = useState(0);

	useEffect(() => {
		const onSummon = (e: Event) => {
			e.preventDefault();
			openedByPointer.current = false;
			setOpen(true);
		};
		window.addEventListener("lumen:open-search", onSummon);
		return () => window.removeEventListener("lumen:open-search", onSummon);
	}, []);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			// ⌘K opens EVERYWHERE — including inside inputs (Decisions SU-6).
			// B51: unless a closer handler already claimed it (the note editor
			// binds Mod-k to its insert palette; two palettes must never stack).
			if (e.defaultPrevented) return;
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				openedByPointer.current = false;
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
				openedByPointer.current = false;
				setOpen(true);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	// B13: on iOS the soft keyboard shrinks the visual viewport, but a
	// `fixed bottom-0` Sheet stays pinned to the layout-viewport bottom, so the
	// keyboard covers the input. Lift the sheet by the covered height while it's
	// open. (Radix's deferred autofocus also often won't raise the keyboard in
	// gesture on WebKit — see onOpenAutoFocus — so this needs an on-device pass.)
	useEffect(() => {
		if (!isMobile || !open) return;
		const vv = window.visualViewport;
		if (!vv) return;
		const update = () => {
			const covered = window.innerHeight - vv.height - vv.offsetTop;
			setKbInset(covered > 1 ? covered : 0);
		};
		update();
		vv.addEventListener("resize", update);
		vv.addEventListener("scroll", update);
		return () => {
			vv.removeEventListener("resize", update);
			vv.removeEventListener("scroll", update);
			setKbInset(0);
		};
	}, [isMobile, open]);

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
			onClick={(e) => {
				// detail≥1 = pointer click; detail 0 = keyboard (Enter/Space). A
				// cancelled pointerdown never fires onClick, so the flag can't go
				// stale (B21/BRRC-4).
				openedByPointer.current = e.detail > 0;
			}}
			className={ORB_CLASS}
		>
			<SearchIcon className="size-4" aria-hidden="true" />
		</button>
	);

	const form = (
		<form onSubmit={onSubmit}>
			<input
				ref={inputRef}
				type="search"
				value={q}
				onChange={(e) => setQ(e.target.value)}
				autoComplete="off"
				spellCheck={false}
				enterKeyHint="search"
				aria-label="Search the library"
				placeholder="a name, a phrase, a verse…"
				className="w-full rounded-none border-0 border-b border-rule2 bg-transparent pb-2 pt-1 font-display text-2xl font-medium tracking-[-0.01em] text-ink caret-selbar outline-none transition-colors duration-150 placeholder:font-reading placeholder:text-base placeholder:font-normal placeholder:italic placeholder:tracking-normal placeholder:text-faint focus-visible:border-selbar [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none"
			/>
		</form>
	);

	return isMobile ? (
		<Sheet open={open} onOpenChange={setOpen}>
			{!hideTrigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
			<SheetContent
				side="bottom"
				className="px-6 pb-8"
				style={kbInset ? { bottom: kbInset } : undefined}
				onOpenAutoFocus={(e) => {
					// B13: WebKit raises the soft keyboard only for a focus that
					// runs synchronously in the open handler — preventDefault Radix's
					// deferred autofocus and focus the input directly. Device-verify.
					e.preventDefault();
					inputRef.current?.focus();
				}}
				onCloseAutoFocus={(e) => {
					if (openedByPointer.current) {
						e.preventDefault();
						(document.activeElement as HTMLElement | null)?.blur?.();
					}
					openedByPointer.current = false;
				}}
			>
				<SheetHeader className="px-0 pb-1">
					<SheetTitle className="font-display text-lg font-medium">Search</SheetTitle>
				</SheetHeader>
				{form}
			</SheetContent>
		</Sheet>
	) : (
		<Dialog open={open} onOpenChange={setOpen}>
			{!hideTrigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
			<DialogContent
				showCloseButton={false}
				aria-describedby={undefined}
				className="top-[22vh] max-w-md translate-y-0 gap-3 p-5"
				onCloseAutoFocus={(e) => {
					if (openedByPointer.current) {
						e.preventDefault();
						(document.activeElement as HTMLElement | null)?.blur?.();
					}
					openedByPointer.current = false;
				}}
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
