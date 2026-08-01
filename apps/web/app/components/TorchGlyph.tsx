/**
 * The torch (2026-08-01). Built for roadmap voting, then retired from it:
 * a flame reads as appreciation — liking, thanks, "this moved me" — not as
 * ranking, which is what the roadmap needed. Kept whole for the surface it
 * actually belongs to: appreciation on any entity (a verse, a collection,
 * an episode, someone's note).
 *
 * `level` (0..1) fills the head and handle from the bottom. At `lit` the
 * whole torch tips slightly and the flame ignites, then flickers. Styles
 * live in app.css under "torch"; the tilt is a state, so it holds under
 * reduced motion — only the ignite and flicker are motion-gated.
 */
export function TorchGlyph({ level, lit }: { level: number; lit: boolean }) {
	const pct = Math.round(level * 100);
	const clipId = `torch-fill-${pct}`;
	return (
		<svg viewBox="0 0 32 32" className={`size-[19px] ${lit ? "torch-lit" : ""}`} aria-hidden="true">
			<defs>
				<clipPath id={clipId}>
					<rect x="0" y={31 - 19 * (pct / 100)} width="32" height={19 * (pct / 100) + 1} />
				</clipPath>
			</defs>
			{lit && (
				<path
					className="torch-flame"
					d="M16 1.5 C14.2 3.9 13.6 5.7 14.3 7.3 C14.9 8.7 16.5 9 17.6 8.1 C18.8 7.1 18.7 5.4 17.9 3.9 C17.3 2.9 16.7 2.1 16 1.5 Z"
					fill="currentColor"
				/>
			)}
			<g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
				<path d="M11.5 12.5 h9 l-1.6 5.5 h-5.8 Z" />
				<path d="M14.6 18 L14 29 a2 2 0 0 0 4 0 L17.4 18" />
			</g>
			<g fill="currentColor" clipPath={`url(#${clipId})`}>
				<path d="M11.5 12.5 h9 l-1.6 5.5 h-5.8 Z" />
				<path d="M14.6 18 L14 29 a2 2 0 0 0 4 0 L17.4 18 Z" />
			</g>
		</svg>
	);
}
