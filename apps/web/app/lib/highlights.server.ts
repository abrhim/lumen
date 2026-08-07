import { getAuth, type AuthEnv } from "./auth.server";
import { isHighlightColor, type HighlightColor } from "./highlight-colors";
import { logEvent } from "./log.server";

/**
 * Passage marks — docs/design/highlighting.md v2.
 *
 * Every read and write goes through the CALLER'S OWN PostgREST client, never
 * over `context.db`. `context.db` is Hyperdrive, which caches reads for about
 * 60 seconds, and a mark that vanishes on reload is worthless. `lumen_read`
 * holds no grant on either table, so the database enforces this rather than
 * discipline.
 */

export { HIGHLIGHT_COLORS, isHighlightColor, DEFAULT_HIGHLIGHT } from "./highlight-colors";
export type { HighlightColor } from "./highlight-colors";

export const HIGHLIGHT_STYLES = ["highlight", "underline", "text"] as const;
export type HighlightStyle = (typeof HIGHLIGHT_STYLES)[number];

export function isHighlightStyle(v: string): v is HighlightStyle {
	return (HIGHLIGHT_STYLES as readonly string[]).includes(v);
}

/** One mark's slice of one verse, as the reader paints it. */
export interface VerseMark {
	id: string;
	start: number;
	end: number;
	color: string;
	style: string;
}

/** Marks for a chapter, keyed by verse number. */
export type ChapterMarks = Record<number, VerseMark[]>;

/**
 * The caller's marks for one chapter. One request: spans embedded under their
 * marks, so a passage crossing three verses arrives whole rather than as three
 * unrelated rows.
 *
 * Fail-SOFT: a failure loses the marks for this render, never the chapter.
 */
export async function chapterMarks(
	request: Request,
	env: AuthEnv,
	chapterId: string,
): Promise<ChapterMarks> {
	try {
		const { supabase } = getAuth(request, env);
		const { data, error } = await supabase
			.schema("lumen")
			.from("highlight_marks")
			.select("id, color, style, highlight_spans(verse_id, start_offset, end_offset)")
			.eq("chapter_id", chapterId);
		if (error || !data) return {};
		const out: ChapterMarks = {};
		for (const row of data as unknown as {
			id: string;
			color: string;
			style: string;
			highlight_spans: { verse_id: string; start_offset: number; end_offset: number }[] | null;
		}[]) {
			if (!isHighlightColor(row.color)) continue;
			for (const span of row.highlight_spans ?? []) {
				// verse ids are `<chapter>-<n>`; the number is the tail
				const n = Number.parseInt(span.verse_id.slice(chapterId.length + 1), 10);
				if (!Number.isFinite(n)) continue;
				(out[n] ??= []).push({
					id: row.id,
					start: span.start_offset,
					end: span.end_offset,
					color: row.color,
					style: row.style,
				});
			}
		}
		// oldest first, so the newest mark paints on top (verse-segments.ts)
		for (const list of Object.values(out)) list.sort((a, b) => a.start - b.start);
		return out;
	} catch {
		return {};
	}
}

export interface NewMarkSpan {
	verseId: string;
	start: number;
	end: number;
}

/**
 * Write one mark and its spans. The mark row goes first so the spans have
 * something to hang from; if the spans fail, the orphan mark is removed rather
 * than left as an invisible row that owns nothing.
 */
export async function createMark(
	request: Request,
	env: AuthEnv,
	args: {
		chapterId: string;
		color: HighlightColor;
		style: HighlightStyle;
		quote: string;
		spans: NewMarkSpan[];
	},
): Promise<{ ok: boolean; id: string | null }> {
	if (args.spans.length === 0) return { ok: false, id: null };
	const { supabase } = getAuth(request, env);
	const { data: userData } = await supabase.auth.getUser();
	const ownerId = userData.user?.id;
	if (!ownerId) return { ok: false, id: null };

	const { data: mark, error: markErr } = await supabase
		.schema("lumen")
		.from("highlight_marks")
		.insert({
			owner_id: ownerId,
			chapter_id: args.chapterId,
			color: args.color,
			style: args.style,
			quote: args.quote.slice(0, 4000),
		})
		.select("id")
		.single();
	if (markErr || !mark) {
		logEvent("highlight_failed", { op: "mark", code: markErr?.code });
		return { ok: false, id: null };
	}

	const markId = (mark as { id: string }).id;
	const { error: spanErr } = await supabase
		.schema("lumen")
		.from("highlight_spans")
		.insert(
			args.spans.map((s) => ({
				mark_id: markId,
				verse_id: s.verseId,
				start_offset: s.start,
				end_offset: s.end,
			})),
		);
	if (spanErr) {
		logEvent("highlight_failed", { op: "spans", code: spanErr.code });
		// no geometry means the mark paints nothing — do not leave it behind
		await supabase.schema("lumen").from("highlight_marks").delete().eq("id", markId);
		return { ok: false, id: null };
	}
	return { ok: true, id: markId };
}

/** Recolour or restyle an existing mark. */
export async function updateMark(
	request: Request,
	env: AuthEnv,
	args: { id: string; color?: HighlightColor; style?: HighlightStyle },
): Promise<boolean> {
	const { supabase } = getAuth(request, env);
	const patch: Record<string, string> = {};
	if (args.color) patch.color = args.color;
	if (args.style) patch.style = args.style;
	if (Object.keys(patch).length === 0) return false;
	const { error } = await supabase
		.schema("lumen")
		.from("highlight_marks")
		.update(patch)
		.eq("id", args.id);
	if (error) {
		logEvent("highlight_failed", { op: "update", code: error.code });
		return false;
	}
	return true;
}

/** Remove a mark. Its spans cascade. */
export async function deleteMark(request: Request, env: AuthEnv, id: string): Promise<boolean> {
	const { supabase } = getAuth(request, env);
	const { error } = await supabase.schema("lumen").from("highlight_marks").delete().eq("id", id);
	if (error) {
		logEvent("highlight_failed", { op: "delete", code: error.code });
		return false;
	}
	return true;
}
