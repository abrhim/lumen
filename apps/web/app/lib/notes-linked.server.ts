import { sql } from "drizzle-orm";
import { resolveAnchorRef, anchorRefToPath } from "@lumen/scripture/notes-refs";

/**
 * personal-notes — linked-canon resolution for the note page's rail and
 * the wikilink hover hints (Abram's in-session direction 2026-07-30).
 * Resolves a note's refs (anchors + body wikilinks) into titled, snippeted
 * rows using the read-only canon connection: verses carry their text,
 * chapters their summary, entities their gloss, transcript moments the
 * words at that timestamp. Fail-closed: an unresolvable ref just doesn't
 * appear (the body already renders it as dead plain text).
 */

export interface LinkedItem {
	ref: string;
	title: string;
	snippet: string | null;
	href: string | null;
	/** small type line under the title (row gloss) */
	gloss: string | null;
}

export interface LinkedCanon {
	verses: LinkedItem[];
	chapters: LinkedItem[];
	entities: LinkedItem[];
	media: LinkedItem[];
	/** ref → hover-hint content for the body's wikilinks */
	previews: Record<string, { title: string; snippet: string | null; href: string | null }>;
}

const ENTITY_TYPE_SLUGS: Record<string, string> = {
	person: "people",
	place: "places",
	principle: "principles",
	event: "events",
	symbol: "symbols",
	era: "eras",
};

const LINKED_CAP = 40;

function titleCaseSlug(slug: string): string {
	return slug
		.split("-")
		.map((s) => (/^\d+$/.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1)))
		.join(" ");
}

function fmtT(s: number): string {
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = Math.floor(s % 60);
	return h > 0
		? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
		: `${m}:${String(ss).padStart(2, "0")}`;
}

function clip(text: string, max: number): string {
	const t = text.replace(/\s+/g, " ").trim();
	return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

type Db = { execute: (q: unknown) => Promise<unknown> };

/** Resolve up to LINKED_CAP refs into rail rows + hover previews. Never
 * throws — a failed leg just yields fewer rows (degradation is absence
 * here; the body text remains the source of truth). */
export async function resolveLinkedCanon(db: Db, refs: string[]): Promise<LinkedCanon> {
	const out: LinkedCanon = { verses: [], chapters: [], entities: [], media: [], previews: {} };
	const resolved = refs
		.slice(0, LINKED_CAP)
		.map((ref) => ({ ref, anchor: resolveAnchorRef(ref) }))
		.filter((r) => r.anchor !== null);

	const verseIds = resolved.filter((r) => r.anchor!.kind === "verse").map((r) => r.ref);
	const chapterRefs = resolved.filter((r) => r.anchor!.kind === "chapter").map((r) => r.ref);
	const entityIds = resolved.filter((r) => r.anchor!.kind === "entity").map((r) => r.ref);
	const transcriptRefs = resolved.filter((r) => r.anchor!.kind === "transcript").map((r) => r.ref);

	const push = (bucket: LinkedItem[], item: LinkedItem) => {
		bucket.push(item);
		out.previews[item.ref] = { title: item.title, snippet: item.snippet, href: item.href };
	};

	try {
		if (verseIds.length > 0) {
			const rows = (await db.execute(
				sql`SELECT id, reference, text FROM lumen.verses WHERE id IN ${verseIds}`,
			)) as Array<{ id: string; reference: string; text: string }>;
			const byId = new Map(rows.map((r) => [r.id, r]));
			for (const ref of verseIds) {
				const row = byId.get(ref);
				if (!row) continue;
				push(out.verses, {
					ref,
					title: row.reference,
					snippet: clip(row.text, 220),
					href: anchorRefToPath({ kind: "verse", ref })!,
					gloss: null,
				});
			}
		}

		if (chapterRefs.length > 0) {
			const rows = (await db.execute(
				sql`SELECT metadata->>'chapter_id' AS chapter_id, description
				    FROM lumen.entities
				    WHERE entity_type = 'chapter_summary'
				      AND metadata->>'chapter_id' IN ${chapterRefs}`,
			)) as Array<{ chapter_id: string; description: string | null }>;
			const byId = new Map(rows.map((r) => [r.chapter_id, r.description]));
			for (const ref of chapterRefs) {
				push(out.chapters, {
					ref,
					title: titleCaseSlug(ref).replace(/ (\d+)$/, " $1"),
					snippet: byId.get(ref) ? clip(byId.get(ref)!, 220) : null,
					href: anchorRefToPath({ kind: "chapter", ref })!,
					gloss: "chapter",
				});
			}
		}

		if (entityIds.length > 0) {
			const rows = (await db.execute(
				sql`SELECT id, name, entity_type, description FROM lumen.entities WHERE id IN ${entityIds}`,
			)) as Array<{ id: string; name: string; entity_type: string; description: string | null }>;
			const byId = new Map(rows.map((r) => [r.id, r]));
			for (const ref of entityIds) {
				const row = byId.get(ref);
				if (!row) continue;
				// unmapped types still get a door — /node/:id is the catch-all
				const slug = ENTITY_TYPE_SLUGS[row.entity_type] ?? "node";
				push(out.entities, {
					ref,
					title: row.name,
					snippet: row.description ? clip(row.description, 220) : null,
					href: `/${slug}/${encodeURIComponent(ref)}`,
					gloss: row.entity_type === "naves_topic" ? "topic" : row.entity_type,
				});
			}
		}

		for (const ref of transcriptRefs) {
			const at = ref.indexOf("@");
			const episodeId = ref.slice(0, at);
			const t = Number(ref.slice(at + 1));
			const [ep] = (await db.execute(
				sql`SELECT name FROM lumen.entities WHERE id = ${episodeId} LIMIT 1`,
			)) as Array<{ name: string }>;
			const [seg] = (await db.execute(
				sql`SELECT text FROM lumen.transcripts
				    WHERE episode_id = ${episodeId} AND t_start_s <= ${t}
				    ORDER BY t_start_s DESC LIMIT 1`,
			)) as Array<{ text: string }>;
			if (!ep) continue;
			push(out.media, {
				ref,
				title: ep.name.replace(/^Come Follow Me - /, ""),
				snippet: seg ? clip(seg.text, 220) : null,
				href: `/media/${encodeURIComponent(episodeId)}?t=${t}`,
				gloss: `▸ ${fmtT(t)}`,
			});
		}
	} catch {
		// degradation is absence — the note page must never fail on rail data
	}

	return out;
}
