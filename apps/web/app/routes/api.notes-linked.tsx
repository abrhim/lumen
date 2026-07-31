import { getSessionUser } from "~/lib/auth.server";
import { notesEnabled } from "~/lib/notes-enabled";
import { resolveLinkedCanon, mergeLinkedNotes } from "~/lib/notes-linked.server";
import { resolveAnchorRef } from "@lumen/scripture/notes-refs";
import { getNotesByIds } from "~/lib/notes.server";
import { deriveNoteSnippet } from "~/lib/notes-derive";
import type { Route } from "./+types/api.notes-linked";

/**
 * personal-notes — live linked-canon resolution for the composing rail
 * (Abram: the rail must update while editing, not on the autosave
 * cadence). Signed-in only; refs validated by the same grammar the rail
 * resolver applies (fail-closed: junk yields no rows). Canon reads only —
 * never notes tables — via the read-only connection.
 */

const REFS_MAX = 40;

export async function loader({ request, context }: Route.LoaderArgs) {
	if (!notesEnabled(context.cloudflare.env)) throw new Response(null, { status: 404 });
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	headers.set("Content-Type", "application/json; charset=utf-8");
	headers.set("Cache-Control", "private, no-store");
	// guest posture (Abram, 2026-07-31): canon is public data — a signed-out
	// composer's rail resolves verses/chapters/entities/episodes; NOTE refs
	// still require the session (RLS) and are simply absent for guests.
	const raw = new URL(request.url).searchParams.get("refs") ?? "";
	// refs never contain commas (slugs, spaces, @timestamps only)
	const refs = raw
		.split(",")
		.map((r) => r.trim())
		.filter(Boolean)
		.slice(0, REFS_MAX);
	const linked = await resolveLinkedCanon(context.db, refs);
	// note links: USER session (RLS) — foreign/deleted uuids are absence
	const noteRefs = user ? refs.filter((r) => resolveAnchorRef(r)?.kind === "note") : [];
	if (noteRefs.length > 0) {
		const rows = await getNotesByIds(
			request,
			context.cloudflare.env,
			noteRefs.map((r) => r.slice(5)),
		);
		mergeLinkedNotes(
			linked,
			noteRefs,
			rows.map((r) => ({
				id: r.id,
				title_line: r.title_line,
				snippet: deriveNoteSnippet(r.body_md) || null,
			})),
		);
	}
	return new Response(JSON.stringify(linked), { status: 200, headers });
}

export function headers(): HeadersInit {
	return { "Cache-Control": "private, no-store" };
}
