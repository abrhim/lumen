import type { ArtItem } from "~/lib/art";

/** Thumbnail with full-image fallback — the 800px thumbs live on a third-party
 * bucket. Shared by the chapter stack, verse panel, and gallery (API-5). */
export function ArtImage({ art, className }: { art: ArtItem; className: string }) {
	return (
		<img
			src={art.thumb ?? art.image}
			alt={`${art.title}${art.artist ? ` — ${art.artist}` : ""}`}
			loading="lazy"
			className={className}
			onError={(e) => {
				const img = e.currentTarget;
				if (art.thumb && img.src !== art.image && art.image) img.src = art.image;
			}}
		/>
	);
}
