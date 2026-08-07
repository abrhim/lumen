import { data } from "react-router";
import { getSessionUser } from "~/lib/auth.server";
import {
	createMark,
	deleteMark,
	isHighlightStyle,
	updateMark,
	type HighlightColor,
	type HighlightStyle,
	type NewMarkSpan,
} from "~/lib/highlights.server";
import { isHighlightColor } from "~/lib/highlight-colors";
import type { Route } from "./+types/api.highlight";

/**
 * Passage marks — create, recolour, remove (docs/design/highlighting.md).
 *
 * A resource route, not an action on the reader: a fetcher posting here does
 * NOT revalidate the chapter loader, so marking costs one small write instead
 * of a full chapter re-read. The reader carries the optimistic state.
 */

/** app-minted slugs; validate the shape before anything reaches the database */
const ID_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function action({ request, context }: Route.ActionArgs) {
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	headers.set("Cache-Control", "private, no-store");
	if (!user) return data({ ok: false as const }, { status: 401, headers });

	const form = await request.formData();
	const intent = String(form.get("intent") ?? "create");

	if (intent === "delete") {
		const id = String(form.get("id") ?? "");
		if (!UUID_SHAPE.test(id)) return data({ ok: false as const }, { status: 400, headers });
		const ok = await deleteMark(request, context.cloudflare.env, id);
		return data({ ok, id }, { headers });
	}

	if (intent === "update") {
		const id = String(form.get("id") ?? "");
		const color = String(form.get("color") ?? "");
		const style = String(form.get("style") ?? "");
		if (!UUID_SHAPE.test(id)) return data({ ok: false as const }, { status: 400, headers });
		if (color && !isHighlightColor(color)) return data({ ok: false as const }, { status: 400, headers });
		if (style && !isHighlightStyle(style)) return data({ ok: false as const }, { status: 400, headers });
		const ok = await updateMark(request, context.cloudflare.env, {
			id,
			...(color ? { color: color as HighlightColor } : {}),
			...(style ? { style: style as HighlightStyle } : {}),
		});
		return data({ ok, id }, { headers });
	}

	// create
	const chapterId = String(form.get("chapter") ?? "");
	const color = String(form.get("color") ?? "");
	const style = String(form.get("style") ?? "highlight");
	const quote = String(form.get("quote") ?? "");
	if (!ID_SHAPE.test(chapterId) || !isHighlightColor(color) || !isHighlightStyle(style)) {
		return data({ ok: false as const }, { status: 400, headers });
	}

	// spans arrive as `verseId:start:end`, repeated
	const spans: NewMarkSpan[] = [];
	for (const raw of form.getAll("span")) {
		const [verseId, s, e] = String(raw).split(":");
		const start = Number.parseInt(s ?? "", 10);
		const end = Number.parseInt(e ?? "", 10);
		if (
			!ID_SHAPE.test(verseId ?? "") ||
			!verseId!.startsWith(`${chapterId}-`) ||
			!Number.isFinite(start) ||
			!Number.isFinite(end) ||
			start < 0 ||
			end <= start
		) {
			return data({ ok: false as const }, { status: 400, headers });
		}
		spans.push({ verseId: verseId!, start, end });
	}
	if (spans.length === 0) return data({ ok: false as const }, { status: 400, headers });

	const result = await createMark(request, context.cloudflare.env, {
		chapterId,
		color: color as HighlightColor,
		style: style as HighlightStyle,
		quote,
		spans,
	});
	return data(result, { headers });
}
