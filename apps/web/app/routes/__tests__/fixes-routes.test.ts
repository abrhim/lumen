import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Step-12 repro tests for the fix pass on the notes ROUTES.
 * B6 (canonical size guard), B15 (anchor cap), B23 (session read inside the
 * try), B25 (unclassified throws are logged), B26 (validation 400s are
 * observable), B30 (typed wikilinks anchor at birth), B33 (no purge promise),
 * B41 (?anchor= drift event), B43 (the real RLS-filtered 404 path),
 * B46 (capture 409s carry the current row).
 *
 * Mocking idiom mirrors notes.routes.test.ts; the factory here additionally
 * exposes the anchor helpers the capture intents call.
 */

vi.mock("~/lib/auth.server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("~/lib/auth.server")>();
	return { ...actual, getSessionUser: vi.fn() };
});
vi.mock("~/lib/log.server", () => ({ logEvent: vi.fn() }));
vi.mock("~/lib/notes.server", () => ({
	listNotes: vi.fn(async () => []),
	getNote: vi.fn(async () => null),
	createNote: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111" })),
	updateNote: vi.fn(),
	softDeleteNote: vi.fn(),
	getChapterNoteAnchors: vi.fn(async () => []),
	getNoteAnchors: vi.fn(async () => []),
	syncNoteAnchors: vi.fn(async () => undefined),
}));

import { getSessionUser } from "~/lib/auth.server";
import { logEvent } from "~/lib/log.server";
import { createNote, getNote, updateNote } from "~/lib/notes.server";
import { loader as notesIndexLoader } from "../notes";
import { loader as noteLoader, action as noteAction } from "../notes.$id";
import { NOTE_MAX_ANCHORS } from "~/lib/notes-derive";

const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SIGNED_IN = { user: { id: "user-a", email: "a@example.com" }, headers: new Headers() } as any;

function makeArgs(path: string, init?: RequestInit) {
	const [pathname] = path.split("?");
	const seg = pathname.split("/")[2];
	return {
		params: pathname.startsWith("/notes/") ? { id: seg } : {},
		request: new Request(`http://localhost${path}`, init),
		context: { cloudflare: { env: {}, ctx: {} }, db: {} },
	} as any;
}

const post = (path: string, fields: Array<[string, string]>) => {
	const form = new FormData();
	for (const [k, v] of fields) form.append(k, v);
	return makeArgs(path, { method: "POST", body: form });
};

const events = () => vi.mocked(logEvent).mock.calls;
const eventNames = () => events().map(([e]) => e);
const body = async (res: Response) => JSON.parse(await res.text());

beforeEach(() => {
	vi.mocked(getSessionUser).mockResolvedValue(SIGNED_IN);
	vi.mocked(logEvent).mockReset();
	vi.mocked(getNote).mockResolvedValue(null);
	vi.mocked(createNote).mockResolvedValue({ id: UUID } as any);
});

describe("B6/CP-7 — the size guard measures the CANONICAL bytes the DDL sees", () => {
	// the serializer backslash-escapes ` * \ ~ [ ] — a body that clears the raw
	// guard can still blow the octet_length(65536) CHECK and come back a 500
	const RAW_UNDER_CANONICAL_OVER = "*".repeat(40_000);

	it("update: an escape-expanding body 400s note_too_large, never reaching PG", async () => {
		expect(new TextEncoder().encode(RAW_UNDER_CANONICAL_OVER).byteLength).toBeLessThan(65536);
		const res = (await noteAction(
			post(`/notes/${UUID}`, [
				["intent", "update"],
				["body_md", RAW_UNDER_CANONICAL_OVER],
				["base_updated_at", "2026-07-30T00:00:00Z"],
			]),
		)) as Response;
		expect(res.status).toBe(400);
		expect((await body(res)).code).toBe("note_too_large");
		expect(updateNote).not.toHaveBeenCalled();
	});

	it("append: capturing into a note already at the cap 400s instead of 500ing", async () => {
		vi.mocked(getNote).mockResolvedValue({
			id: UUID,
			body_md: "x".repeat(65_530) + "\n",
			created_at: "t",
			updated_at: "t",
		} as any);
		const res = (await noteAction(
			post(`/notes/${UUID}`, [
				["intent", "append"],
				["anchor", "alma-32-21"],
			]),
		)) as Response;
		expect(res.status).toBe(400);
		expect((await body(res)).code).toBe("note_too_large");
		expect(updateNote).not.toHaveBeenCalled();
	});
});

describe("B15/CP-16 + B26/CP-27 — the anchor set is capped and refusals are observable", () => {
	it("create refuses an over-cap anchor set before any write", async () => {
		const fields: Array<[string, string]> = [
			["intent", "create"],
			["body_md", "hello"],
		];
		for (let i = 0; i <= NOTE_MAX_ANCHORS; i++) fields.push(["anchor", "alma-32-21"]);
		const res = (await noteAction(post("/notes/new", fields))) as Response;
		expect(res.status).toBe(400);
		expect((await body(res)).code).toBe("anchor_limit");
		expect(createNote).not.toHaveBeenCalled();
	});

	it("a route-boundary 400 emits note_write_failed cause:validation", async () => {
		// B26: a client bug producing permanently-failing oversized autosaves —
		// A13's worst outcome class — used to be invisible to the operator, while
		// `validation` sat in the cause union as dead vocabulary
		const res = (await noteAction(
			post("/notes/new", [
				["intent", "create"],
				["body_md", "*".repeat(70_000)],
			]),
		)) as Response;
		expect(res.status).toBe(400);
		const [name, fields] = events().find(([e]) => e === "note_write_failed")!;
		expect(name).toBe("note_write_failed");
		expect(fields).toMatchObject({ op: "create", cause: "validation" });
		expect(fields).not.toHaveProperty("message");
	});
});

describe("B23/CP-24 — a session failure stays inside the A13 JSON contract", () => {
	it("a pool-exhaustion throw returns JSON 500, not an ErrorBoundary swap", async () => {
		// the documented incident class here; an unhandled action throw would
		// replace the note page out from under a live editor buffer
		vi.mocked(getSessionUser).mockRejectedValue(new Error("remaining connection slots"));
		const res = (await noteAction(
			post(`/notes/${UUID}`, [
				["intent", "update"],
				["body_md", "hi"],
				["base_updated_at", "t"],
			]),
		)) as Response;
		expect(res.status).toBe(500);
		expect(res.headers.get("Content-Type")).toContain("application/json");
		expect((await body(res)).code).toBe("internal");
	});
});

describe("B25/CP-26 — unclassified throws in the action are no longer silent", () => {
	it("logs note_action_failed for a throw the data layer did not classify", async () => {
		vi.mocked(createNote).mockRejectedValue(new TypeError("boom"));
		const res = (await noteAction(
			post("/notes/new", [
				["intent", "create"],
				["body_md", "hello"],
			]),
		)) as Response;
		expect(res.status).toBe(500);
		const found = events().find(([e]) => e === "note_action_failed");
		expect(found?.[1]).toMatchObject({ intent: "create", name: "TypeError" });
		expect(JSON.stringify(found?.[1])).not.toContain("boom"); // no free text (B13)
	});

	it("stays quiet for NoteWriteError — the data layer already logged it", async () => {
		const err = new Error("write failed");
		err.name = "NoteWriteError";
		vi.mocked(createNote).mockRejectedValue(err);
		await noteAction(
			post("/notes/new", [
				["intent", "create"],
				["body_md", "hello"],
			]),
		);
		expect(eventNames()).not.toContain("note_action_failed");
	});
});

describe("B30/CP-32 — typed wikilinks become anchor rows at birth", () => {
	it("create unions the body's refs with the form anchors", async () => {
		await noteAction(
			post("/notes/new", [
				["intent", "create"],
				["body_md", "On faith: [[alma-32-21]] and [[alma-32-22|the seed]].\n"],
				["anchor", "alma-32"],
			]),
		);
		const anchors = vi.mocked(createNote).mock.calls[0][2].anchors;
		expect(anchors.map((a) => a.ref).sort()).toEqual(["alma-32", "alma-32-21", "alma-32-22"]);
	});

	it("an unresolvable TYPED ref is skipped and logged, never a refusal", async () => {
		// form anchors come from our own capture doors (fail-closed); body refs
		// are prose, and a typo must not block the save (G5)
		const res = await noteAction(
			post("/notes/new", [
				["intent", "create"],
				["body_md", "See [[narnia-3-1]] and [[alma-32-21]].\n"],
			]),
		);
		expect((res as Response).status).toBe(302);
		expect(vi.mocked(createNote).mock.calls[0][2].anchors.map((a) => a.ref)).toEqual([
			"alma-32-21",
		]);
		expect(eventNames()).toContain("note_anchor_invalid_ref");
	});
});

describe("B41/CP-44 — the ?anchor= prefill reports slug-map drift", () => {
	it("logs note_anchor_invalid_ref instead of silently nulling the ref", async () => {
		await noteLoader(makeArgs("/notes/new?anchor=narnia-3-1"));
		const found = events().find(([e]) => e === "note_anchor_invalid_ref");
		expect(found?.[1]).toMatchObject({ ref_id: "narnia-3-1" });
	});

	it("stays quiet when the prefill resolves", async () => {
		await noteLoader(makeArgs("/notes/new?anchor=alma-32-21"));
		expect(eventNames()).not.toContain("note_anchor_invalid_ref");
	});
});

describe("B43/CP-46 — the F8 404 through the RLS filter, not the UUID guard", () => {
	it("a syntactically VALID id whose row is invisible 404s via getNote", async () => {
		// the pinned F8 test uses "dead-note", which 404s at UUID_RE before the
		// mocked getNote is ever consulted — this exercises the tombstone path
		vi.mocked(getNote).mockResolvedValue(null); // notes.server filters deleted_at
		await expect(noteLoader(makeArgs(`/notes/${UUID}`))).rejects.toMatchObject({ status: 404 });
		expect(getNote).toHaveBeenCalledTimes(1);
		expect(vi.mocked(getNote).mock.calls[0][2]).toBe(UUID);
	});
});

describe("B46/CP-50 — capture 409s carry the current row A13 pins", () => {
	const CURRENT = {
		id: UUID,
		body_md: "someone else wrote this\n",
		created_at: "t",
		updated_at: "2026-07-30T02:00:00Z",
	};

	it("append's stale exit attaches current", async () => {
		vi.mocked(getNote).mockResolvedValue({
			id: UUID,
			body_md: "notes\n",
			created_at: "t",
			updated_at: "2026-07-30T01:00:00Z",
		} as any);
		vi.mocked(updateNote).mockResolvedValue({ ok: false, conflict: CURRENT } as any);
		const res = (await noteAction(
			post(`/notes/${UUID}`, [
				["intent", "append"],
				["anchor", "alma-32-21"],
			]),
		)) as Response;
		expect(res.status).toBe(409);
		expect((await body(res)).current).toEqual({
			body_md: CURRENT.body_md,
			updated_at: CURRENT.updated_at,
		});
	});

	it("append_undo's stale exit attaches current", async () => {
		vi.mocked(getNote).mockResolvedValue(CURRENT as any);
		const res = (await noteAction(
			post(`/notes/${UUID}`, [
				["intent", "append_undo"],
				["anchor", "alma-32-21"],
				["appended_line", "[[alma-32-21]]"],
				["base_updated_at", "2026-07-30T01:00:00Z"], // stale
			]),
		)) as Response;
		expect(res.status).toBe(409);
		expect((await body(res)).current).toEqual({
			body_md: CURRENT.body_md,
			updated_at: CURRENT.updated_at,
		});
	});
});

describe("B22/CP-23 — the /notes index derives from title_line", () => {
	it("titles come from the bounded generated column, and no body ships", async () => {
		const { listNotes } = await import("~/lib/notes.server");
		vi.mocked(listNotes).mockResolvedValue([
			{ id: "n1", title_line: "# Alma 32 — the seed", created_at: "t", updated_at: "t" },
		] as any);
		const res: any = await notesIndexLoader(makeArgs("/notes"));
		const row = res.data.notes[0];
		expect(row.title).toBe("Alma 32 — the seed");
		expect(row).not.toHaveProperty("snippet");
	});
});

describe("B33/CP-35 — the delete dialog makes no retention promise", () => {
	it("the 30-day purge sentence is gone (A6/CF-36 withheld it)", () => {
		// doctrine pin: `deleted_at` is a COMMENT only — no v1 job and no
		// user-facing promise, so the sentence was false in both directions
		const src = readFileSync(new URL("../notes.$id.tsx", import.meta.url), "utf8");
		const dialog = src.slice(src.indexOf("<AlertDialogDescription>"));
		expect(dialog.slice(0, 400)).not.toMatch(/purged after 30 days/);
		expect(dialog).toContain("It disappears from your notes, the reader, and search.");
	});
});
