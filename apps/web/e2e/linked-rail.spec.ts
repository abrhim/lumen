import { test, expect } from "@playwright/test";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * Linked-canon rail + wikilink hover hints (Abram's in-session direction
 * 2026-07-30): the note page resolves its refs into a verse-detail-style
 * rail, and hovering a wikilink shows the destination's snippet.
 */

let user: E2eUser;
let noteId: string;

test.beforeAll(async () => {
	user = await createE2eUser("rail");
	const { data, error } = await user.client
		.schema("lumen")
		.rpc("create_note_with_anchors", {
			p_body_md:
				"# Seed study\n\nFaith as [[alma-32-21|the seed]], whole chapter at [[alma-32]].\n",
			p_anchors: [{ kind: "verse", ref_id: "alma-32-21" }],
		})
		.single();
	if (error) throw new Error(error.message);
	noteId = (data as { id: string }).id;
});
test.afterAll(async () => {
	await user?.cleanup();
});

test.beforeEach(async ({ context }) => {
	await user.install(context);
});

test("the rail lists linked verses and chapters with their text", async ({ page }) => {
	await page.goto(`/notes/${noteId}`);
	const rail = page.getByRole("region", { name: "Linked in this note" });
	await expect(rail).toBeVisible();
	await expect(rail.getByRole("heading", { name: "Verses", level: 3 })).toBeVisible();
	const verseRow = rail.getByRole("link", { name: /Alma 32:21/ });
	await expect(verseRow).toBeVisible();
	// the verse's own words ride the row
	await expect(verseRow).toContainText(/perfect knowledge/);
	await expect(rail.getByRole("heading", { name: "Chapters", level: 3 })).toBeVisible();
});

test("hovering a wikilink shows the destination snippet", async ({ page }) => {
	await page.goto(`/notes/${noteId}`);
	const link = page.locator(".note-body .note-wikilink").first();
	await expect(link).toBeVisible();
	await link.hover();
	const hintBox = page.locator(".note-hint");
	await expect(hintBox).toBeVisible();
	await expect(hintBox).toContainText("Alma 32:21");
	await expect(hintBox).toContainText(/perfect knowledge/);
	// moving off the body hides the hint
	await page.getByRole("heading", { name: "Seed study", level: 1 }).hover();
	await expect(hintBox).toHaveCount(0);
});

test("entity search: [[rameumptom suggests the place; rail rides the editor", async ({ page }) => {
	await page.goto("/notes/new");
	await page.locator(".note-editor").click();
	await page.keyboard.type("[[rameumptom");
	const option = page.getByRole("option", { name: /Rameumptom/i }).first();
	await expect(option).toBeVisible();
	await option.click();
	await expect(page.locator(".note-editor [data-wikilink-ref]")).toHaveCount(1);

	// save → the editor stays open and the rail appears beside it
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
	const rail = page.getByRole("region", { name: "Linked in this note" });
	await expect(rail).toBeVisible({ timeout: 10_000 });
	await expect(rail.getByRole("heading", { name: "People & topics", level: 3 })).toBeVisible();
	await expect(rail).toContainText(/Rameumptom/i);
});

test("the composing rail is LIVE: inserting a link populates it without any save", async ({
	page,
}) => {
	await page.goto("/notes/new");
	await page.locator(".note-editor").click();
	await page.keyboard.type("see [[alma 32:21");
	// Enter only commits once the suggestion exists (the B50 lesson)
	await expect(page.getByRole("option").first()).toContainText("Alma 32:21");
	await page.keyboard.press("Enter");
	// no save, no autosave wait — the rail resolves from the live doc
	const rail = page.getByRole("region", { name: "Linked in this note" });
	await expect(rail).toBeVisible({ timeout: 5000 });
	await expect(rail).toContainText("Alma 32:21");
	await expect(rail).toContainText(/perfect knowledge/);
	await expect(page).toHaveURL(/\/notes\/new$/);
});
