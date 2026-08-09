import { HIGHLIGHT_COLORS } from "~/lib/highlight-colors";

/**
 * The selection menu (docs/design/highlighting.md, step 3).
 *
 * Two axes, not thirty buttons: a row of ten colours and a three-way style
 * toggle. Gospel Library does the same, and thirty targets on a phone would be
 * unusable.
 *
 * Placement is viewport-clamped: a selection near the top of the screen puts
 * the menu below it, and one near an edge slides in rather than overflowing.
 */

export type MarkStyle = "highlight" | "underline" | "text";

const STYLE_LABEL: Record<MarkStyle, string> = {
	highlight: "Highlight",
	underline: "Underline",
	text: "Colour",
};

export function MarkMenu({
	rect,
	style,
	activeColor,
	canSave,
	onStyle,
	onColor,
	onCopy,
	onRemove,
	onLookUp,
	onNote,
}: {
	/** the selection's bounding box, in viewport coordinates */
	rect: { top: number; bottom: number; left: number; width: number };
	style: MarkStyle;
	activeColor?: string;
	/** signed out, the colours are a door rather than a control */
	canSave: boolean;
	onStyle: (s: MarkStyle) => void;
	onColor: (c: string) => void;
	onCopy: () => void;
	/** present when the menu opened ON a mark rather than a new selection */
	onRemove?: () => void;
	/** single-word selections only — word study from the selection */
	onLookUp?: () => void;
	/** write a note about this passage; signed-in only */
	onNote?: () => void;
}) {
	const MENU_W = 288;
	const MENU_H = 132;
	const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
	const scrollX = typeof window === "undefined" ? 0 : window.scrollX;
	const scrollY = typeof window === "undefined" ? 0 : window.scrollY;
	// The menu belongs to the TEXT, not the screen. position:fixed left it
	// hanging in place while the reading scrolled away underneath (Abram).
	// Document coordinates + position:absolute means it travels with the words
	// it is about, which is what a reader expects of something anchored to a
	// passage.
	const above = rect.top > MENU_H + 16;
	const top = (above ? rect.top - 12 : rect.bottom + 12) + scrollY;
	// horizontal still clamps to the viewport: a menu that runs off the right
	// edge is unreachable no matter what it is anchored to
	const left =
		Math.min(Math.max(8, rect.left + rect.width / 2 - MENU_W / 2), vw - MENU_W - 8) + scrollX;

	return (
		<div
			role="dialog"
			aria-label="Mark the selected text"
			// mousedown, NOT pointerdown. Both stop the browser clearing the
			// selection this menu exists to act on, but preventDefault on
			// pointerdown also suppresses the compatibility mouse events — click
			// included — so the buttons became unclickable. Caught by e2e.
			onMouseDown={(e) => e.preventDefault()}
			style={{
				position: "absolute",
				top,
				left,
				width: MENU_W,
				transform: above ? "translateY(-100%)" : undefined,
			}}
			className="z-50 rounded-lg border border-rule2 bg-panel p-2 shadow-lg"
		>
			{canSave && (
			<div className="flex items-center gap-1">
				{(Object.keys(STYLE_LABEL) as MarkStyle[]).map((s) => (
					<button
						key={s}
						type="button"
						onClick={() => onStyle(s)}
						aria-pressed={style === s}
						className={`flex-1 rounded-md px-2 py-1 font-ui text-[11px] transition-colors ${
							style === s ? "bg-sel text-ink" : "text-muted-foreground hover:text-ink"
						}`}
					>
						{STYLE_LABEL[s]}
					</button>
				))}
			</div>
			)}
			<div className={`flex items-center gap-1.5${canSave ? " mt-2" : ""}`}>
				{HIGHLIGHT_COLORS.map((c) => (
					<button
						key={c}
						type="button"
						onClick={() => onColor(c)}
						aria-label={`Mark ${c}`}
						aria-pressed={activeColor === c}
						className={`hl-${c} hl-swatch size-[20px] rounded-[3px] outline-none transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-selbar ${
							activeColor === c ? "ring-2 ring-ink/50" : "hover:ring-2 hover:ring-rule2"
						}`}
					/>
				))}
			</div>
			{!canSave && (
				<p className="mt-2 font-ui text-[11px] leading-snug text-muted-foreground">
					Marks are kept on this device. Sign in to keep them everywhere.
				</p>
			)}
			<div className="mt-2 flex items-center gap-3 border-t border-rule pt-2 font-ui text-[11px]">
				{onNote && (
					<button type="button" onClick={onNote} className="text-muted-foreground hover:text-ink">
						Note
					</button>
				)}
				<button type="button" onClick={onCopy} className="text-muted-foreground hover:text-ink">
					Copy
				</button>
				{onLookUp && (
					<button type="button" onClick={onLookUp} className="text-muted-foreground hover:text-ink">
						Look up
					</button>
				)}
				{onRemove && (
					<button
						type="button"
						onClick={onRemove}
						className="ml-auto text-muted-foreground hover:text-destructive"
					>
						Remove
					</button>
				)}
			</div>
		</div>
	);
}
