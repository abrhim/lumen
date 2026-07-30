import { describe, it, expect } from "vitest";
import {
	GROUP_KEYS,
	GROUP_RESULT_TYPES,
	NOTES_GROUP_KEY,
	SEARCH_RESPONSE_KEYS,
} from "../search-types";
// Red until implemented: the anchor/link ref grammar (plan A8, F7).
import { resolveAnchorRef } from "../notes-refs";

describe("harness A1 — GROUP_KEYS is FROZEN; notes is a route-layer key only", () => {
	it("GROUP_KEYS stays exactly the seven canon engine keys (CF-1: the signed-out/SQL contract)", () => {
		expect(GROUP_KEYS).toEqual([
			"scripture",
			"people",
			"places",
			"topics",
			"episodes",
			"art",
			"words",
		]);
	});

	it("NOTES_GROUP_KEY exists outside the engine vocabulary", () => {
		expect(NOTES_GROUP_KEY).toBe("notes");
		expect(GROUP_KEYS as readonly string[]).not.toContain(NOTES_GROUP_KEY);
	});

	it("SEARCH_RESPONSE_KEYS = notes first, then canon order (the signed-in response order)", () => {
		expect(SEARCH_RESPONSE_KEYS).toEqual([NOTES_GROUP_KEY, ...GROUP_KEYS]);
	});

	it("notes group may only contain 'note' results", () => {
		expect(GROUP_RESULT_TYPES.notes).toEqual(["note"]);
	});
});

describe("harness F7/A8 — anchor ref grammar (canonical slugs, fail-closed, collision-proof)", () => {
	it("classifies a verse ref", () => {
		expect(resolveAnchorRef("alma-32-21")).toEqual({ kind: "verse", ref: "alma-32-21" });
		expect(resolveAnchorRef("1-ne-3-7")).toEqual({ kind: "verse", ref: "1-ne-3-7" });
	});

	it("classifies a chapter ref", () => {
		expect(resolveAnchorRef("alma-32")).toEqual({ kind: "chapter", ref: "alma-32" });
	});

	it("classifies an entity ref", () => {
		const r = resolveAnchorRef("nephi-1");
		expect(r?.kind).toBe("entity");
	});

	it("CF-17: alias-shaped and beyond-count ids resolve to ENTITIES, not chapters (live collision set)", () => {
		// helaman-2 parses as hel-2 only via the ALIAS table — canonical slugs
		// only, so it falls through to the entity namespace (a live person id).
		expect(resolveAnchorRef("helaman-2")?.kind).toBe("entity");
		expect(resolveAnchorRef("jeremiah-3")?.kind).toBe("entity");
		// joel IS the canonical slug but Joel has 3 chapters — joel-4 is a person.
		expect(resolveAnchorRef("joel-4")?.kind).toBe("entity");
		// within-count canonical chapter stays a chapter
		expect(resolveAnchorRef("joel-2")?.kind).toBe("chapter");
	});

	it("CF-18: transcript anchors are episode@t_start_s; the volatile #seq shape is REJECTED", () => {
		expect(resolveAnchorRef("unshaken-O3SiM9Yi940@144.5")).toEqual({
			kind: "transcript",
			ref: "unshaken-O3SiM9Yi940@144.5",
		});
		// moment/seq ids are documented non-durable (M3 re-window) — never persistable
		expect(resolveAnchorRef("unshaken-O3SiM9Yi940#144")).toBeNull();
	});

	it("fail-closed: unknown book slug, malformed, empty, traversal junk → null", () => {
		expect(resolveAnchorRef("narnia-3-1")).toBeNull();
		expect(resolveAnchorRef("alma-0")).toBeNull();
		expect(resolveAnchorRef("")).toBeNull();
		expect(resolveAnchorRef("../../etc/passwd")).toBeNull();
		expect(resolveAnchorRef("alma-32-21; DROP TABLE lumen.notes")).toBeNull();
	});

	it("verse refs beyond a chapter's verse count stay shape-valid (existence is the action's DB check)", () => {
		expect(resolveAnchorRef("alma-32-9999")?.kind).toBe("verse");
	});
});
