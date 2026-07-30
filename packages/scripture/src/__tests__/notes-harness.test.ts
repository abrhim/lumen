import { describe, it, expect } from "vitest";
import { GROUP_KEYS, GROUP_RESULT_TYPES } from "../search-types";
// Red until implemented: the anchor/link ref grammar (plan D2/D3, F7).
import { resolveAnchorRef } from "../notes-refs";

describe("harness F9/D3 — notes group in the search contract", () => {
	it("GROUP_KEYS gains 'notes' at index 0 (personal layer leads)", () => {
		expect(GROUP_KEYS[0]).toBe("notes");
		// the existing canon order is preserved after it
		expect(GROUP_KEYS.slice(1)).toEqual([
			"scripture",
			"people",
			"places",
			"topics",
			"episodes",
			"art",
			"words",
		]);
	});

	it("notes group may only contain 'note' results", () => {
		expect(GROUP_RESULT_TYPES.notes).toEqual(["note"]);
	});
});

describe("harness F7 — anchor ref grammar (one address space, fail-closed)", () => {
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

	it("classifies a transcript-segment ref (episode#seq)", () => {
		const r = resolveAnchorRef("unshaken-O3SiM9Yi940#144");
		expect(r).toEqual({ kind: "transcript", ref: "unshaken-O3SiM9Yi940#144" });
	});

	it("fail-closed: unknown book slug, malformed, empty, traversal junk → null", () => {
		expect(resolveAnchorRef("narnia-3-1")).toBeNull();
		expect(resolveAnchorRef("alma-0")).toBeNull();
		expect(resolveAnchorRef("")).toBeNull();
		expect(resolveAnchorRef("../../etc/passwd")).toBeNull();
		expect(resolveAnchorRef("alma-32-21; DROP TABLE lumen.notes")).toBeNull();
	});

	it("verse refs beyond the chapter's verse count are not validated here (DB truth), but shape junk is", () => {
		// shape-valid stays kind-classified; existence is the action's job (F7 400 path)
		expect(resolveAnchorRef("alma-32-9999")?.kind).toBe("verse");
	});
});
