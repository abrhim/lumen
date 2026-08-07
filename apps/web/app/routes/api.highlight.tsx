import { data } from "react-router";
import { getSessionUser } from "~/lib/auth.server";
import {
	isHighlightColor,
	toggleVerseHighlight,
	type HighlightColor,
} from "~/lib/highlights.server";
import type { Route } from "./+types/api.highlight";

/**
 * Toggle one whole-verse mark (docs/design/highlighting.md, slice 1).
 *
 * A resource route, not an action on the reader: a fetcher posting here does
 * NOT revalidate the chapter loader, so marking a verse costs one small write
 * instead of a full chapter re-read. The reader carries the optimistic state.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	headers.set("Cache-Control", "private, no-store");
	// signed out is not an error here — the reader never shows the control
	if (!user) return data({ ok: false as const, color: null }, { status: 401, headers });

	const form = await request.formData();
	const verseId = String(form.get("verse") ?? "");
	const chapterId = String(form.get("chapter") ?? "");
	const colorRaw = String(form.get("color") ?? "yellow");

	// ids are app-minted slugs; validate shape before they reach the database
	const idShape = /^[a-z0-9]+(-[a-z0-9]+)*$/;
	if (
		!idShape.test(verseId) ||
		!idShape.test(chapterId) ||
		!verseId.startsWith(`${chapterId}-`) ||
		!isHighlightColor(colorRaw)
	) {
		return data({ ok: false as const, color: null }, { status: 400, headers });
	}

	const result = await toggleVerseHighlight(request, context.cloudflare.env, {
		chapterId,
		verseId,
		color: colorRaw as HighlightColor,
	});
	return data({ ...result, verse: verseId }, { headers });
}
