import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the auth + data layers; the routes under test are the system.
vi.mock("~/lib/auth.server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("~/lib/auth.server")>();
	return {
		...actual,
		getSessionUser: vi.fn(),
	};
});
vi.mock("~/lib/notes.server", () => ({
	listNotes: vi.fn(async () => []),
	getNote: vi.fn(async () => null),
	createNote: vi.fn(),
	updateNote: vi.fn(),
	softDeleteNote: vi.fn(),
	getChapterNoteAnchors: vi.fn(async () => []),
}));

import { getSessionUser } from "~/lib/auth.server";
import { getNote, createNote } from "~/lib/notes.server";
// Red until implemented: the notes routes (plan D5, F2/F7/F8).
import { loader as notesIndexLoader } from "../notes";
import { loader as noteLoader, action as noteAction } from "../notes.$id";

const SIGNED_OUT = { user: null, headers: new Headers() } as any;
const SIGNED_IN = {
	user: { id: "user-a", email: "a@example.com" },
	headers: new Headers(),
} as any;

function makeArgs(path: string, init?: RequestInit) {
	return {
		params: path.startsWith("/notes/") ? { id: path.split("/")[2] } : {},
		request: new Request(`http://localhost${path}`, init),
		context: { cloudflare: { env: {}, ctx: {} } },
	} as any;
}

beforeEach(() => {
	vi.mocked(getSessionUser).mockResolvedValue(SIGNED_OUT);
});

describe("harness F2 — signed-out users never meet the notes surface", () => {
	it("/notes redirects to /login", async () => {
		const res = (await notesIndexLoader(makeArgs("/notes"))) as Response;
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toMatch(/^\/login/);
	});

	it("/notes/:id redirects to /login without leaking existence", async () => {
		const res = (await noteLoader(makeArgs("/notes/some-uuid"))) as Response;
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toMatch(/^\/login/);
	});

	it("mutations are rejected signed-out", async () => {
		const res = (await noteAction(
			makeArgs("/notes/some-uuid", { method: "POST", body: new FormData() }),
		)) as Response;
		expect([302, 401, 403]).toContain(res.status);
		expect(createNote).not.toHaveBeenCalled();
	});
});

describe("harness F7 — anchor validation at the action boundary", () => {
	it("400s a nonexistent anchor ref before any write", async () => {
		vi.mocked(getSessionUser).mockResolvedValue(SIGNED_IN);
		const form = new FormData();
		form.set("intent", "create");
		form.set("anchor", "narnia-3-1");
		form.set("body_md", "hello");
		const res = (await noteAction(
			makeArgs("/notes/new", { method: "POST", body: form }),
		)) as Response;
		expect(res.status).toBe(400);
		expect(createNote).not.toHaveBeenCalled();
	});
});

describe("harness A13/A18 — contract pins from synthesis", () => {
	it("CF-31: session rotation headers ride the signed-in index loader (B4 class)", async () => {
		const headers = new Headers({ "Set-Cookie": "sb-sentinel=1" });
		vi.mocked(getSessionUser).mockResolvedValue({ ...SIGNED_IN, headers });
		const res = await notesIndexLoader(makeArgs("/notes"));
		const outHeaders =
			res instanceof Response ? res.headers : (res as any)?.init?.headers instanceof Headers ? (res as any).init.headers : new Headers((res as any)?.init?.headers);
		expect(outHeaders.get("Set-Cookie")).toContain("sb-sentinel=1");
	});

	it("CF-29: /notes/new GET renders the create surface — never 404s through getNote", async () => {
		vi.mocked(getSessionUser).mockResolvedValue(SIGNED_IN);
		await expect(noteLoader(makeArgs("/notes/new"))).resolves.toBeTruthy();
		expect(getNote).not.toHaveBeenCalled();
	});

	it("CF-27: a non-uuid :id 404s before any query — never a PG 22P02 500", async () => {
		vi.mocked(getSessionUser).mockResolvedValue(SIGNED_IN);
		await expect(noteLoader(makeArgs("/notes/not-a-uuid"))).rejects.toMatchObject({
			status: 404,
		});
		expect(getNote).not.toHaveBeenCalled();
	});

	it("CF-41: the signed-out redirect carries a same-origin next param", async () => {
		const res = (await notesIndexLoader(makeArgs("/notes"))) as Response;
		expect(res.headers.get("Location")).toBe("/login?next=%2Fnotes");
	});
});

describe("harness F8 — soft-deleted notes are gone from every surface", () => {
	it("/notes/:id 404s a soft-deleted (or absent) note for its own owner", async () => {
		vi.mocked(getSessionUser).mockResolvedValue(SIGNED_IN);
		vi.mocked(getNote).mockResolvedValue(null); // notes.server filters deleted_at
		await expect(noteLoader(makeArgs("/notes/dead-note"))).rejects.toMatchObject({
			status: 404,
		});
	});
});
