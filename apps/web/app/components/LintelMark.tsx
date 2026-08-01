/** The mark (icon exploration round 4, #7): beam, posts, the strike. */
export function LintelMark({ className = "h-[13px] w-[16px]" }: { className?: string }) {
	return (
		<svg viewBox="0 3 32 26" fill="currentColor" aria-hidden="true" className={className}>
			<rect x="5" y="7" width="22" height="4.5" rx="1" />
			<rect x="6.5" y="13.5" width="4.5" height="15.5" rx="1" />
			<rect x="21" y="13.5" width="4.5" height="15.5" rx="1" />
			<path d="M16 3 C16 3 14.2 5.2 14.2 6.4 a1.8 1.8 0 0 0 3.6 0 C17.8 5.2 16 3 16 3 Z" />
		</svg>
	);
}
