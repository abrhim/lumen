import type { ReactNode } from "react";
import { Link } from "react-router";

/** Reference row — the house treatment for any "this points somewhere" row
 * (born in the unshaken-surfaces spikes). Quiet at rest; hover raises the
 * selection background with a hairline outline and fades in a trailing arrow.
 * Single-line rows use the default baseline alignment; block content (e.g. a
 * quote) passes `className="items-start"`. `fit` shrinks the row to its
 * content (arrow included — its space is reserved, so hover never reflows);
 * use it for wrap-lists like the verse panel's principles/people. `arrow`
 * (default true) can be turned off where the trailing arrow is unwanted.
 */
export function RefRow({
	to,
	children,
	className = "items-baseline",
	ariaLabel,
	fit = false,
	arrow = true,
}: {
	to: string;
	children: ReactNode;
	className?: string;
	ariaLabel?: string;
	fit?: boolean;
	arrow?: boolean;
}) {
	return (
		<Link
			to={to}
			aria-label={ariaLabel}
			className={`group ${fit ? "inline-flex" : "-mx-2 flex"} gap-1.5 rounded-md border border-transparent px-2 py-1 transition-colors duration-150 hover:border-rule2 hover:bg-sel ${className}`}
		>
			{children}
			{arrow && (
				<span
					aria-hidden
					className="ml-auto font-ui text-xs text-primary opacity-0 transition-opacity duration-150 group-hover:opacity-100"
				>
					→
				</span>
			)}
		</Link>
	);
}
