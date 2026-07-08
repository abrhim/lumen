import { cardImageUrl, type ArtItem } from "~/lib/art";

/** Thumbnail with SIZE-CAPPED fallback — never a museum original in a card
 * (measured 103 MB single file). Shared by the stack, verse panel, gallery.
 * `decorative` empties the alt when title/artist are adjacent visible text. */
export function ArtImage({ art, className, decorative = false }: { art: ArtItem; className: string; decorative?: boolean }) {
	return (
		<img
			src={cardImageUrl(art)}
			alt={decorative ? "" : `${art.title}${art.artist ? ` — ${art.artist}` : ""}`}
			loading="lazy"
			decoding="async"
			className={className}
			onError={(e) => {
				// broken thumb → the size-capped derivative, never the raw original
				const img = e.currentTarget;
				const fallback = cardImageUrl({ thumb: null, image: art.image });
				if (art.thumb && fallback && img.src !== fallback) img.src = fallback;
			}}
		/>
	);
}
