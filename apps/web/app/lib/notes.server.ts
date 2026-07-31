import type { SupabaseClient } from "@supabase/supabase-js";
import {
	NOTES_GROUP_KEY,
	type SearchGroup,
	type SearchResult,
} from "@lumen/scripture/search-types";
import { resolveAnchorRef, type AnchorRef } from "@lumen/scripture/notes-refs";
import { getAuth, type AuthEnv } from "./auth.server";
import { deriveNoteSnippet, deriveNoteTitle, NOTE_MAX_ANCHORS } from "./notes-derive";
import { logEvent } from "./log.server";

/**
 * personal-notes D1/D3/A13 — the notes data layer. Every read and write
 * goes through a per-request SSR Supabase client (user JWT → PostgREST →
 * RLS); there is NO admin path here and lumen_read holds no grants on
 * these tables, so cross-user leakage through the shared search path is
 * structurally impossible (A6).
 *
 * Soft-delete is enforced at RLS (A6): SELECT policies hide tombstones, so
 * `null` from a read means absent-or-deleted-or-foreign — deliberately
 * indistinguishable; the route 404s all three identically.
 *
 * Signatures take (request, env) and build the client internally: routes
 * never construct PostgREST clients, which keeps this module the single
 * mockable seam. Known accepted quirk (A5): if the access token expires
 * between getSessionUser's read and these calls, supabase-js refreshes
 * inline on a client whose Set-Cookie never reaches the response — benign
 * under gotrue's 10s reuse window because getSessionUser (same request,
 * memoized) already refreshed and its headers DO ride the response.
 *
 * Events (CF-26/CF-49): ids and sizes only. NEVER body_md, titles,
 * snippets, anchor ref_ids (allowlisted exception: note_anchor_invalid_ref),
 * and never owner_id — note-write logs must not become a per-user
 * devotional-activity timeline.
 */

export interface NoteRow {
	id: string;
	body_md: string;
	created_at: string;
	updated_at: string;
}

export interface NoteAnchorRow {
	note_id: string;
	kind: "verse" | "chapter" | "entity" | "transcript";
	ref_id: string;
	/** anchors are immutable (A6/CF-53) — creation time is the only time */
	created_at?: string;
	/** chapter-anchors embed only: the note's bounded generated first line
	 * (≤120 chars, raw markdown — strip client-side). Never the body. */
	notes?: { title_line: string | null } | null;
}

export type NoteWriteCause =
	| "rls_denied"
	| "not_found_or_forbidden"
	| "constraint"
	/** route-boundary refusals (oversized body, anchor cap) — emitted by the
	 * action, never by failWrite; a permanently-failing autosave must be
	 * visible to the operator (B26/CP-27a) */
	| "validation"
	/** PostgREST auth layer (PGRST3xx): expired/invalid JWT mid-write —
	 * distinct from transport failure so session-expiry is actionable (B26b) */
	| "auth"
	| "network";

export class NoteWriteError extends Error {
	writeCause: NoteWriteCause;
	pgCode?: string;
	constructor(cause: NoteWriteCause, message: string, pgCode?: string) {
		super(message);
		this.name = "NoteWriteError";
		this.writeCause = cause;
		this.pgCode = pgCode;
	}
}

/** PostgREST/PG error → one cause (CF-49). Codes are derived from THIS
 * schema's DDL: 23xxx (check/fk/unique), 22001 (length), 22P02 (bad uuid /
 * timestamptz literal — client-supplied `base_updated_at` lands here).
 * PGRST116 is "no rows"; PGRST3xx is the auth layer (B26/CP-27). */
export function classifyWriteError(error: { code?: string; message?: string }): {
	cause: NoteWriteCause;
	pgCode?: string;
} {
	const code = error.code ?? "";
	if (code === "42501") return { cause: "rls_denied", pgCode: code };
	if (/^23/.test(code) || code === "22001" || code === "22P02") {
		return { cause: "constraint", pgCode: code };
	}
	if (code === "PGRST116") return { cause: "not_found_or_forbidden", pgCode: code };
	if (/^PGRST3\d\d$/.test(code)) return { cause: "auth", pgCode: code };
	if (code !== "") return { cause: "network", pgCode: code };
	return { cause: "network" };
}

/** B13 (CP-14): the event carries NO free text from PG. Postgres renders the
 * offending VALUE into its messages (22P02 echoes a client-supplied
 * `base_updated_at` verbatim; PostgREST parse errors echo the filter string,
 * which on the anchors path contains ref_ids) — so a non-allowlisted event
 * would become a ref/user-value carrier. Cause + pg_code reproduce the error
 * class; this table is the only human-readable text that ships. */
const CAUSE_NOTE: Record<NoteWriteCause, string> = {
	rls_denied: "row-level security refused the write",
	not_found_or_forbidden: "no visible row for this id",
	constraint: "table constraint rejected the row",
	validation: "refused at the route boundary",
	auth: "postgrest rejected the session token",
	network: "transport or timeout",
};

function failWrite(op: string, error: { code?: string; message?: string }): never {
	const { cause, pgCode } = classifyWriteError(error);
	logEvent("note_write_failed", {
		op,
		cause,
		...(pgCode ? { pg_code: pgCode } : {}),
		note: CAUSE_NOTE[cause],
	});
	// the Error's own message stays untouched — it never reaches a log or a
	// response body (the action returns a fixed string), only a stack trace
	throw new NoteWriteError(cause, error.message ?? "write failed", pgCode);
}

/** One PostgREST client per request (mirrors the sessionMemo idiom). */
const clientMemo = new WeakMap<Request, SupabaseClient>();
function notesClient(request: Request, env: AuthEnv): SupabaseClient {
	const cached = clientMemo.get(request);
	if (cached) return cached;
	const { supabase } = getAuth(request, env);
	clientMemo.set(request, supabase);
	return supabase;
}

/* ─── reads ─── */

const NOTES_LIST_LIMIT = 200;

/** B22 (CP-23): the index row. `body_md` is NOT in it — 200 bodies at the
 * 64 KiB cap is 12.8 MB across the wire to render bounded titles. The
 * bounded generated `title_line` (≤120 chars, raw markdown) is the same
 * column the anchors embed already uses; the shared stripper turns it into
 * the title. No schema change: the `snippet_source` column half of CP-23 is
 * REJECTED on the record (a second derivation surface can drift from
 * deriveNoteTitle/deriveNoteSnippet), so the index carries no snippet. */
export interface NoteIndexRow {
	id: string;
	title_line: string | null;
	created_at: string;
	updated_at: string;
}

export async function listNotes(request: Request, env: AuthEnv): Promise<NoteIndexRow[]> {
	const { data, error } = await notesClient(request, env)
		.schema("lumen")
		.from("notes")
		.select("id, title_line, created_at, updated_at")
		.order("updated_at", { ascending: false })
		.limit(NOTES_LIST_LIMIT);
	if (error) failWrite("list", error);
	return (data ?? []) as NoteIndexRow[];
}

export async function getNote(
	request: Request,
	env: AuthEnv,
	id: string,
): Promise<NoteRow | null> {
	const { data, error } = await notesClient(request, env)
		.schema("lumen")
		.from("notes")
		.select("id, body_md, created_at, updated_at")
		.eq("id", id)
		.maybeSingle();
	if (error) failWrite("get", error);
	return data as NoteRow | null;
}

export async function getNoteAnchors(
	request: Request,
	env: AuthEnv,
	noteId: string,
): Promise<NoteAnchorRow[]> {
	const { data, error } = await notesClient(request, env)
		.schema("lumen")
		.from("note_anchors")
		.select("note_id, kind, ref_id")
		.eq("note_id", noteId);
	if (error) failWrite("anchors", error);
	return (data ?? []) as NoteAnchorRow[];
}

/** A5 (CF-5/CF-52): the chapter loader's anchor read — projection only,
 * hard LIMIT, verse+chapter kinds for this chapter. The degraded-as-value
 * wrapper (750ms abort, never-throw, `note_anchors_degraded`) lives at the
 * loader; this is the raw query. */
export const CHAPTER_ANCHORS_LIMIT = 200;

export async function getChapterNoteAnchors(
	request: Request,
	env: AuthEnv,
	bookId: string,
	chapter: number,
	signal?: AbortSignal,
): Promise<NoteAnchorRow[]> {
	const chapterRef = `${bookId}-${chapter}`;
	let query = notesClient(request, env)
		.schema("lumen")
		.from("note_anchors")
		// projection + the bounded title_line embed — never note bodies (CF-52)
		.select("note_id, kind, ref_id, created_at, notes(title_line)")
		.or(
			`and(kind.eq.chapter,ref_id.eq.${chapterRef}),and(kind.eq.verse,ref_id.like.${chapterRef}-*)`,
		)
		.order("created_at", { ascending: false })
		.limit(CHAPTER_ANCHORS_LIMIT);
	if (signal) query = query.abortSignal(signal);
	const { data, error } = await query;
	// B24 (CP-25): throw RAW — no failWrite here. scripture.tsx's never-throw
	// wrapper is the sole caller and owns the single `note_anchors_degraded`
	// emission; classifying through failWrite made every ordinary 750 ms abort
	// emit note_write_failed too, inflating the exact write-failure signal the
	// classifier exists to keep clean (A5 pins one event for this path).
	if (error) {
		// value-free by construction: the degraded event at the loader logs
		// name+message, and PG messages can echo the ref_ids in our own filter
		// string (B13's class) — so only the classified cause/code travel.
		const { cause, pgCode } = classifyWriteError(error);
		const err = new Error(pgCode ? `${cause} (${pgCode})` : cause);
		err.name = "ChapterAnchorsError";
		throw err;
	}
	// the to-one embed types as an array but returns an object at runtime
	return (data ?? []) as unknown as NoteAnchorRow[];
}

/* ─── validation ─── */

/** Validate raw anchor refs through the grammar (F7/A8) — fail-closed; the
 * first invalid ref aborts. `note_anchor_invalid_ref` is the allowlisted
 * ref-bearing event: an invalid ref from our own insert paths means
 * client/slug-map drift, a bug, not user garbage. */
export function validateAnchorRefs(
	raw: string[],
): { ok: true; anchors: AnchorRef[] } | { ok: false; ref: string } {
	const anchors: AnchorRef[] = [];
	// B15: mirror the route boundary's cap — no caller may hand an unbounded
	// set to the write paths (the offending ref is the cap marker, not a ref)
	if (raw.length > NOTE_MAX_ANCHORS) return { ok: false, ref: "" };
	for (const ref of raw) {
		const resolved = resolveAnchorRef(ref);
		if (!resolved) {
			logEvent("note_anchor_invalid_ref", { ref_id: ref.slice(0, 160) });
			return { ok: false, ref };
		}
		// note links are valid body content but never anchors (DB kind CHECK)
		if (resolved.kind === "note") continue;
		anchors.push(resolved);
	}
	return { ok: true, anchors };
}

/** Batch-read the user's own notes by id for note-link resolution (rail
 * rows + hover previews). Rides the per-request session client, so RLS is
 * the enforcement layer: a foreign or deleted uuid is simply absent — no
 * existence signal leaks. Never throws (absence on failure). */
export async function getNotesByIds(
	request: Request,
	env: AuthEnv,
	ids: string[],
): Promise<Array<{ id: string; title_line: string | null; body_md: string }>> {
	if (ids.length === 0) return [];
	try {
		const db = notesClient(request, env);
		const { data, error } = await db
			.schema("lumen")
			.from("notes")
			.select("id, title_line, body_md")
			.in("id", ids);
		if (error) return [];
		return (data ?? []) as Array<{ id: string; title_line: string | null; body_md: string }>;
	} catch {
		return [];
	}
}

/* ─── writes ─── */

export async function createNote(
	request: Request,
	env: AuthEnv,
	args: { body_md: string; anchors: AnchorRef[] },
): Promise<NoteRow> {
	// A7 (CF-25): one transaction via SECURITY INVOKER RPC — the note and its
	// anchors land together or not at all; owner_id is auth.uid() inside the
	// function, never form-supplied.
	const { data, error } = await notesClient(request, env)
		.schema("lumen")
		.rpc("create_note_with_anchors", {
			p_body_md: args.body_md,
			p_anchors: args.anchors.map((a) => ({ kind: a.kind, ref_id: a.ref })),
		})
		.single();
	if (error) failWrite("create", error);
	const row = data as NoteRow;
	logEvent("note_created", {
		note_id: row.id,
		body_len: args.body_md.length,
		anchor_count: args.anchors.length,
		anchor_kinds: [...new Set(args.anchors.map((a) => a.kind))],
	});
	return row;
}

export type UpdateNoteResult =
	| { ok: true; note: NoteRow }
	| { ok: false; conflict: NoteRow } // LWW base-echo mismatch (CF-37) → 409
	| { ok: false; conflict: null }; // gone/tombstoned/foreign → 404

export async function updateNote(
	request: Request,
	env: AuthEnv,
	args: { id: string; body_md: string; baseUpdatedAt: string },
): Promise<UpdateNoteResult> {
	// Single-statement conditional update (CF-37): staleness and tombstones
	// both come back as 0 rows — the update never lands on a base it didn't
	// see, and every UPDATE carries the deleted_at guard (CF-10).
	const supabase = notesClient(request, env);
	const { data, error } = await supabase
		.schema("lumen")
		.from("notes")
		.update({ body_md: args.body_md })
		.eq("id", args.id)
		.eq("updated_at", args.baseUpdatedAt)
		.is("deleted_at", null)
		.select("id, body_md, created_at, updated_at");
	if (error) failWrite("update", error);
	if (data && data.length > 0) {
		const note = data[0] as NoteRow;
		// B13 (CP-14): ids and sizes only — the base/new timestamps were outside
		// the pinned field set and, per-user, are a write-cadence timeline
		logEvent("note_updated", { note_id: note.id, body_len: args.body_md.length });
		return { ok: true, note };
	}
	// 0 rows: stale base (note still visible) → 409 + current; else 404.
	const current = await getNote(request, env, args.id);
	if (current) return { ok: false, conflict: current };
	return { ok: false, conflict: null };
}

/** Replace the anchor set via diff (A13/PERF-6): anchor rows are immutable
 * (A6 — no UPDATE grant exists), so the diff is delete-missing +
 * insert-new; unchanged anchors are never touched. */
export async function syncNoteAnchors(
	request: Request,
	env: AuthEnv,
	noteId: string,
	anchors: AnchorRef[],
): Promise<void> {
	const supabase = notesClient(request, env);
	const existing = await getNoteAnchors(request, env, noteId);
	const want = new Set(anchors.map((a) => `${a.kind} ${a.ref}`));
	const have = new Set(existing.map((a) => `${a.kind} ${a.ref_id}`));
	const toDelete = existing.filter((a) => !want.has(`${a.kind} ${a.ref_id}`));
	const toInsert = anchors.filter((a) => !have.has(`${a.kind} ${a.ref}`));

	// B15 (CP-16): INSERT FIRST, then delete. Delete-first meant a mid-sync
	// failure was anchor LOSS; insert-first degrades to a superset, which the
	// next save reconciles. Both halves are idempotent.
	if (toInsert.length > 0) {
		// double-capture is idempotent (CF-25): duplicates are ignored
		const { error } = await supabase
			.schema("lumen")
			.from("note_anchors")
			.upsert(
				toInsert.map((a) => ({ note_id: noteId, kind: a.kind, ref_id: a.ref })),
				{ onConflict: "note_id,kind,ref_id", ignoreDuplicates: true },
			);
		if (error) failWrite("anchor_insert", error);
	}

	// B15 (CP-16): ONE delete per kind (≤4 statements) instead of one round
	// trip per removed row. N serialized subrequests inside a single Worker
	// invocation walked into the subrequest ceiling and held N sessions
	// against a pool cap of 15 — a documented incident class here.
	const byKind = new Map<string, string[]>();
	for (const a of toDelete) {
		const bucket = byKind.get(a.kind);
		if (bucket) bucket.push(a.ref_id);
		else byKind.set(a.kind, [a.ref_id]);
	}
	for (const [kind, refIds] of byKind) {
		const { error } = await supabase
			.schema("lumen")
			.from("note_anchors")
			.delete()
			.eq("note_id", noteId)
			.eq("kind", kind)
			.in("ref_id", refIds);
		if (error) failWrite("anchor_delete", error);
	}
}

export async function softDeleteNote(
	request: Request,
	env: AuthEnv,
	id: string,
): Promise<boolean> {
	// Soft delete goes through the INVOKER RPC (harness-revision, sanctioned
	// 2026-07-30): PostgREST UPDATEs always carry RETURNING, and Postgres
	// checks RETURNING rows against the SELECT policy — which hides
	// tombstones by design, so a plain PATCH here can never succeed. The
	// RPC's UPDATE has no RETURNING; RLS still fully applies (invoker), and
	// the returned count preserves the 404-vs-ok distinction.
	const { data, error } = await notesClient(request, env)
		.schema("lumen")
		.rpc("soft_delete_note", { p_id: id });
	if (error) failWrite("delete", error);
	const deleted = ((data as number | null) ?? 0) > 0;
	if (deleted) logEvent("note_softdeleted", { note_id: id });
	return deleted;
}

/* ─── search (A4) ─── */

export interface NotesSearchGroup extends Omit<SearchGroup, "key"> {
	key: typeof NOTES_GROUP_KEY;
	/** Present-and-true when the leg failed/timed out signed-in — absence of
	 * the group is semantically loaded ("you have no matching notes"), so
	 * degradation must be explicit (CF-4). */
	degraded?: boolean;
}

export const NOTES_LEG_TIMEOUT_MS = 400;

/** Route-layer merge (CF-1): notes leads, canon order untouched. Null leg
 * (signed-out) returns the canon groups BY REFERENCE — zero mutation. An
 * empty healthy group prints nothing (register rule); a degraded group
 * stays present. Canon groups can never double a notes key (gap 15). */
export function mergeNotesGroup(
	canonGroups: SearchGroup[],
	notesGroup: NotesSearchGroup | null,
): SearchGroup[] {
	if (notesGroup === null) return canonGroups;
	const canon = canonGroups.filter((g) => g.key !== NOTES_GROUP_KEY);
	if (notesGroup.results.length === 0 && notesGroup.degraded !== true) return canon;
	return [notesGroup as SearchGroup, ...canon];
}

/** The signed-in notes leg: RLS-side websearch over the generated tsvector
 * (call shape pinned 'english'/'websearch' — CF-33). Never throws: failure
 * or timeout returns a degraded group and logs `search_group_degraded`
 * (CF-4). No cursor is ever minted (CF-8: absence = end of set; the group
 * links to /notes for the full corpus). */
export async function searchNotesLeg(
	request: Request,
	env: AuthEnv,
	q: string,
	limit: number,
): Promise<NotesSearchGroup> {
	const started = Date.now();
	try {
		const { data, error } = await notesClient(request, env)
			.schema("lumen")
			.from("notes")
			.select("id, body_md, updated_at")
			.textSearch("search", q, { config: "english", type: "websearch" })
			.order("updated_at", { ascending: false })
			.limit(limit)
			.abortSignal(AbortSignal.timeout(NOTES_LEG_TIMEOUT_MS));
		if (error) throw new Error(error.message);
		const results: SearchResult[] = ((data ?? []) as NoteRow[]).map((row) => ({
			type: "note",
			id: row.id,
			title: deriveNoteTitle(row.body_md),
			snippet: deriveNoteSnippet(row.body_md) || undefined,
			tier: 0,
			score: 0,
			payload: { updated_at: row.updated_at },
		}));
		return { key: NOTES_GROUP_KEY, results };
	} catch (err) {
		logEvent("search_group_degraded", {
			key: NOTES_GROUP_KEY,
			message: err instanceof Error ? err.message.slice(0, 200) : "unknown",
			ms: Date.now() - started,
		});
		return { key: NOTES_GROUP_KEY, results: [], degraded: true };
	}
}
