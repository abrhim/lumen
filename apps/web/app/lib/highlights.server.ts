import { getAuth, type AuthEnv } from "./auth.server";
import { logEvent } from "./log.server";

/**
 * Highlights — docs/design/highlighting.md. Slice 1 is whole-verse marks.
 *
 * Every read and write here goes through the CALLER'S OWN PostgREST client,
 * never over `context.db`. That is deliberate: `context.db` is Hyperdrive, which
 * caches reads for about 60 seconds, and a person who marks a verse and reloads
 * must see the mark immediately. The same mistake made a roadmap vote read back
 * as zero (2026-08-01). lumen_read holds no grant on the table at all, so this
 * is enforced by the database, not by discipline.
 */

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "grey"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export function isHighlightColor(v: string): v is HighlightColor {
	return (HIGHLIGHT_COLORS as readonly string[]).includes(v);
}

export interface Highlight {
	id: string;
	verse_id: string;
	color: HighlightColor;
}

/** The caller's whole-verse marks for one chapter, keyed by verse number.
 * Fail-SOFT: a failure loses the marks for this render, never the chapter. */
export async function chapterHighlights(
	request: Request,
	env: AuthEnv,
	chapterId: string,
): Promise<Record<number, HighlightColor>> {
	try {
		const { supabase } = getAuth(request, env);
		const { data, error } = await supabase
			.schema("lumen")
			.from("highlights")
			.select("verse_id, color")
			.eq("chapter_id", chapterId)
			.is("start_offset", null);
		if (error || !data) return {};
		const out: Record<number, HighlightColor> = {};
		for (const row of data as { verse_id: string; color: string }[]) {
			// verse ids are `<chapter>-<n>`; the number is the tail
			const n = Number.parseInt(row.verse_id.slice(chapterId.length + 1), 10);
			if (Number.isFinite(n) && isHighlightColor(row.color)) out[n] = row.color;
		}
		return out;
	} catch {
		return {};
	}
}

/**
 * Toggle one whole-verse mark. Marking an unmarked verse inserts; marking it
 * again in the SAME colour clears it; a different colour recolours it. Returns
 * the colour now in force, or null when the mark is gone.
 */
export async function toggleVerseHighlight(
	request: Request,
	env: AuthEnv,
	args: { chapterId: string; verseId: string; color: HighlightColor },
): Promise<{ ok: boolean; color: HighlightColor | null }> {
	const { supabase } = getAuth(request, env);
	const { data: userData } = await supabase.auth.getUser();
	const ownerId = userData.user?.id;
	if (!ownerId) return { ok: false, color: null };

	const { data: existing, error: readErr } = await supabase
		.schema("lumen")
		.from("highlights")
		.select("id, color")
		.eq("verse_id", args.verseId)
		.is("start_offset", null)
		.maybeSingle();
	if (readErr) {
		logEvent("highlight_failed", { op: "read", code: readErr.code });
		return { ok: false, color: null };
	}

	if (existing) {
		const row = existing as { id: string; color: string };
		if (row.color === args.color) {
			const { error } = await supabase
				.schema("lumen")
				.from("highlights")
				.delete()
				.eq("id", row.id);
			if (error) {
				logEvent("highlight_failed", { op: "delete", code: error.code });
				return { ok: false, color: null };
			}
			return { ok: true, color: null };
		}
		const { error } = await supabase
			.schema("lumen")
			.from("highlights")
			.update({ color: args.color })
			.eq("id", row.id);
		if (error) {
			logEvent("highlight_failed", { op: "recolor", code: error.code });
			return { ok: false, color: null };
		}
		return { ok: true, color: args.color };
	}

	const { error } = await supabase.schema("lumen").from("highlights").insert({
		owner_id: ownerId,
		verse_id: args.verseId,
		chapter_id: args.chapterId,
		color: args.color,
	});
	if (error) {
		logEvent("highlight_failed", { op: "insert", code: error.code });
		return { ok: false, color: null };
	}
	return { ok: true, color: args.color };
}
