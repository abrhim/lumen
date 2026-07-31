import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Step-12 repro tests for the fix pass on the notes DATA layer.
 * B13 (log privacy), B15 (anchor cap + batched deletes), B22 (list
 * projection), B24 (single degraded emission), B26 (classifier taxonomy).
 *
 * The seam is `getAuth` — notes.server builds its own PostgREST client, so a
 * chainable stub standing in for supabase-js lets us assert the QUERY SHAPE
 * (projection, statement count, ordering), which is what these bugs are about.
 */

vi.mock("~/lib/log.server", () => ({ logEvent: vi.fn() }));
vi.mock("~/lib/auth.server", () => ({ getAuth: vi.fn() }));

import { logEvent } from "~/lib/log.server";
import { getAuth } from "~/lib/auth.server";
import {
	classifyWriteError,
	getChapterNoteAnchors,
	listNotes,
	syncNoteAnchors,
	validateAnchorRefs,
} from "../notes.server";
import { NOTE_MAX_ANCHORS } from "../notes-derive";

type QueryResult = { data: unknown; error: unknown };
type Call = { m: string; args: unknown[] };

const CHAIN = [
	"select",
	"order",
	"limit",
	"eq",
	"is",
	"or",
	"in",
	"like",
	"abortSignal",
	"update",
	"delete",
	"upsert",
	"insert",
	"maybeSingle",
	"single",
	"textSearch",
];

/** Every awaited query pops the next queued result; every hop is recorded. */
function stubClient(queue: QueryResult[]) {
	const calls: Call[] = [];
	const makeQuery = () => {
		const q: Record<string, unknown> = {};
		for (const m of CHAIN) {
			q[m] = (...args: unknown[]) => {
				calls.push({ m, args });
				return q;
			};
		}
		q.then = (onOk: (v: QueryResult) => unknown, onErr?: (e: unknown) => unknown) =>
			Promise.resolve(queue.shift() ?? { data: [], error: null }).then(onOk, onErr);
		return q;
	};
	const client: Record<string, unknown> = {
		schema: () => client,
		from: (t: string) => {
			calls.push({ m: "from", args: [t] });
			return makeQuery();
		},
		rpc: (fn: string, args: unknown) => {
			calls.push({ m: "rpc", args: [fn, args] });
			return makeQuery();
		},
	};
	vi.mocked(getAuth).mockReturnValue({ supabase: client } as never);
	return calls;
}

const req = () => new Request("http://localhost/notes");
const ENV = {} as never;
const events = () => vi.mocked(logEvent).mock.calls;
const argOf = (calls: Call[], m: string) => calls.find((c) => c.m === m)?.args;

beforeEach(() => {
	vi.mocked(logEvent).mockReset();
});

describe("B26/CP-27 — write-failure classifier taxonomy", () => {
	it("classifies PostgREST auth-layer codes as `auth`, not `network`", () => {
		// session expiry mid-autosave is the module's own documented window;
		// filing it under the catch-all made the least actionable cause
		expect(classifyWriteError({ code: "PGRST301" })).toEqual({
			cause: "auth",
			pgCode: "PGRST301",
		});
		expect(classifyWriteError({ code: "PGRST302" }).cause).toBe("auth");
	});

	it("drops the stray 2200N — it is unreachable for this schema's DDL", () => {
		expect(classifyWriteError({ code: "2200N" }).cause).not.toBe("constraint");
	});

	it("keeps the codes this DDL can actually raise on `constraint`", () => {
		for (const code of ["23514", "23503", "22001", "22P02"]) {
			expect(classifyWriteError({ code }).cause).toBe("constraint");
		}
		expect(classifyWriteError({ code: "42501" }).cause).toBe("rls_denied");
		expect(classifyWriteError({ code: "PGRST116" }).cause).toBe("not_found_or_forbidden");
		expect(classifyWriteError({}).cause).toBe("network");
	});
});

describe("B13/CP-14 — note_write_failed carries no free text from PG", () => {
	it("a 22P02 echoing a client-supplied base_updated_at leaks nothing", async () => {
		// the panel's net-new vector: PG renders the OFFENDING VALUE into its
		// message, so a client string reaches an event outside the ref allowlist
		const clientBytes = "2026-07-30T00:00:00Z'; secret-user-string";
		stubClient([
			{
				data: null,
				error: {
					code: "22P02",
					message: `invalid input syntax for type timestamp with time zone: "${clientBytes}"`,
				},
			},
		]);
		await expect(listNotes(req(), ENV)).rejects.toThrow();

		const [name, fields] = events()[0];
		expect(name).toBe("note_write_failed");
		expect(fields).toMatchObject({ op: "list", cause: "constraint", pg_code: "22P02" });
		expect(fields).not.toHaveProperty("message");
		expect(JSON.stringify(fields)).not.toContain("secret-user-string");
	});
});

describe("B22/CP-23 — the /notes list read never ships bodies", () => {
	it("projects id, title_line, created_at, updated_at — never body_md", async () => {
		const calls = stubClient([
			{ data: [{ id: "n1", title_line: "# Alma 32", created_at: "t", updated_at: "t" }], error: null },
		]);
		const rows = await listNotes(req(), ENV);
		const projection = String(argOf(calls, "select")?.[0]);
		expect(projection).not.toContain("body_md");
		expect(projection).toBe("id, title_line, created_at, updated_at");
		expect(rows[0]).not.toHaveProperty("body_md");
	});
});

describe("B24/CP-25 — chapter-anchor failures emit exactly once", () => {
	it("throws raw instead of also logging note_write_failed", async () => {
		// the loader's never-throw wrapper owns the single note_anchors_degraded
		// emission; classifying here doubled every ordinary 750 ms abort
		stubClient([{ data: null, error: { code: "20", message: "AbortError: signal timed out" } }]);
		await expect(getChapterNoteAnchors(req(), ENV, "alma", 32)).rejects.toThrow();
		expect(events().filter(([e]) => e === "note_write_failed")).toHaveLength(0);
	});

	it("the raw throw carries no PG free text (our own ref_ids ride the filter)", async () => {
		stubClient([
			{
				data: null,
				error: {
					code: "PGRST100",
					message: 'failed to parse filter (and(kind.eq.verse,ref_id.like.alma-32-*))',
				},
			},
		]);
		await expect(getChapterNoteAnchors(req(), ENV, "alma", 32)).rejects.toThrow(
			/network \(PGRST100\)/,
		);
	});
});

describe("B15/CP-16 — the anchor set is bounded and its deletes are batched", () => {
	it("validateAnchorRefs refuses an over-cap set before resolving anything", () => {
		const over = Array.from({ length: NOTE_MAX_ANCHORS + 1 }, () => "alma-32-21");
		expect(validateAnchorRefs(over).ok).toBe(false);
		expect(validateAnchorRefs(over.slice(0, NOTE_MAX_ANCHORS)).ok).toBe(true);
	});

	it("issues ONE delete per kind instead of one round trip per removed row", async () => {
		const existing = [
			{ note_id: "n1", kind: "verse", ref_id: "alma-32-21" },
			{ note_id: "n1", kind: "verse", ref_id: "alma-32-22" },
			{ note_id: "n1", kind: "verse", ref_id: "alma-32-23" },
			{ note_id: "n1", kind: "chapter", ref_id: "alma-32" },
			{ note_id: "n1", kind: "chapter", ref_id: "alma-33" },
		];
		const calls = stubClient([
			{ data: existing, error: null }, // getNoteAnchors
			{ data: null, error: null }, // one delete per kind…
			{ data: null, error: null },
		]);
		await syncNoteAnchors(req(), ENV, "n1", []);

		const deletes = calls.filter((c) => c.m === "delete");
		expect(deletes).toHaveLength(2); // verse + chapter, NOT 5
		const inArgs = calls.filter((c) => c.m === "in");
		expect(inArgs).toHaveLength(2);
		expect(inArgs[0].args[1]).toEqual(["alma-32-21", "alma-32-22", "alma-32-23"]);
		expect(inArgs[1].args[1]).toEqual(["alma-32", "alma-33"]);
	});

	it("inserts BEFORE deleting, so a mid-sync failure is a superset, never loss", async () => {
		const calls = stubClient([
			{ data: [{ note_id: "n1", kind: "verse", ref_id: "alma-32-21" }], error: null },
			{ data: null, error: null }, // upsert
			{ data: null, error: null }, // delete
		]);
		await syncNoteAnchors(req(), ENV, "n1", [{ kind: "verse", ref: "alma-32-22" } as never]);
		const order = calls.map((c) => c.m);
		expect(order.indexOf("upsert")).toBeGreaterThan(-1);
		expect(order.indexOf("delete")).toBeGreaterThan(order.indexOf("upsert"));
	});
});
