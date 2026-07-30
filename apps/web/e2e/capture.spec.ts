import { test, expect } from "@playwright/test";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * Gaps 41 + 42 — capture round-trip with reading continuity, and
 * append-undo (body restored byte-identical, anchor gone).
 */

let user: E2eUser;

test.beforeAll(async () => {
	user = await createE2eUser("capture");
});
test.afterAll(async () => {
	await user?.cleanup();
});

test.beforeEach(async ({ context }) => {
	await user.install(context);
});

test("New note from a verse: anchor prefilled, Back restores ?verse=", async ({ page }) => {
	await page.goto("/scripture/alma/32?verse=21");
	await page.getByRole("link", { name: "New note" }).click();
	await expect(page).toHaveURL(/\/notes\/new\?anchor=alma-32-21$/);
	// the editor opens with the anchor wikilink prefilled
	await expect(page.locator(".note-editor")).toBeVisible();
	await expect(page.locator(".note-editor [data-wikilink-ref='alma-32-21']")).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(/\/scripture\/alma\/32\?verse=21$/);
});

test("Add to note appends, gloss confirms, undo restores byte-identical", async ({ page }) => {
	// seed a note through the app's own transactional RPC
	const { data: note, error } = await user.client
		.schema("lumen")
		.rpc("create_note_with_anchors", {
			p_body_md: "# Capture target\n\nSeed body.\n",
			p_anchors: [],
		})
		.single();
	expect(error).toBeNull();
	const noteRow = note as { id: string; body_md: string };

	// visiting the note makes it the last-touched capture target (A9); the
	// derived title owns the h1 and consumes the first-line heading (A14)
	await page.goto(`/notes/${noteRow.id}`);
	await expect(page.getByRole("heading", { name: "Capture target", level: 1 })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Capture target" })).toHaveCount(1);

	await page.goto("/scripture/alma/32?verse=21");
	await page.getByRole("button", { name: "Add to note" }).click();
	// the one-line gloss confirmation IS the undo window (A9) — no toast
	await expect(page.getByText(/Added to “Capture target”/)).toBeVisible();

	// the wikilink + anchor landed
	const { data: appended } = await user.client
		.schema("lumen")
		.from("notes")
		.select("body_md")
		.eq("id", noteRow.id)
		.single();
	expect(appended?.body_md).toContain("[[alma-32-21|");
	const { data: anchors } = await user.client
		.schema("lumen")
		.from("note_anchors")
		.select("ref_id")
		.eq("note_id", noteRow.id);
	expect((anchors ?? []).map((a) => a.ref_id)).toContain("alma-32-21");

	// undo: body byte-identical, anchor gone (gap 42). The gloss hides the
	// moment the fetcher SUBMITS, so both DB assertions must poll — the
	// action may still be mid-flight.
	await page.getByRole("button", { name: "undo" }).click();
	await expect(page.getByText(/Added to/)).toHaveCount(0);
	await expect.poll(async () => {
		const { data } = await user.client
			.schema("lumen")
			.from("notes")
			.select("body_md")
			.eq("id", noteRow.id)
			.single();
		return data?.body_md;
	}).toBe("# Capture target\n\nSeed body.\n");
	await expect.poll(async () => {
		const { data } = await user.client
			.schema("lumen")
			.from("note_anchors")
			.select("ref_id")
			.eq("note_id", noteRow.id);
		return (data ?? []).map((a) => a.ref_id);
	}).not.toContain("alma-32-21");

	// reading continuity: still on the chapter, verse still selected
	await expect(page).toHaveURL(/\/scripture\/alma\/32\?verse=21$/);
});
