import { test, expect } from "@playwright/test";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * Note-to-note linking (Abram, 2026-07-31): `[[` offers the writer's own
 * notes by title; the inserted link renders as a real door to /notes/:id;
 * the rail grows a Notes register; the meta line counts the link. Plus the
 * editor bar relocation: Done/status/legend now LEAD the editor.
 */

let user: E2eUser;

test.beforeAll(async () => {
	user = await createE2eUser("note-links");
});
test.afterAll(async () => {
	await user?.cleanup();
});
test.beforeEach(async ({ context }) => {
	await user.install(context);
});

async function seedNote(body: string): Promise<string> {
	const { data, error } = await user.client
		.schema("lumen")
		.rpc("create_note_with_anchors", { p_body_md: body, p_anchors: [] })
		.single();
	if (error) throw new Error(error.message);
	return (data as { id: string }).id;
}

test("[[ offers my notes; the committed link is a door to the other note", async ({ page }) => {
	const targetId = await seedNote("# Faith is a seed\n\nAlma's sermon on the word.\n");

	await page.goto("/notes/new");
	const editor = page.locator(".note-editor");
	await editor.click();
	await page.keyboard.type("Compare [[faith is a");
	const option = page.getByRole("option").first();
	await expect(option).toContainText("Faith is a seed");
	await expect(option).toContainText("note");
	await page.keyboard.press("Enter");

	// the inserted node carries the note ref and the note's TITLE as label
	const link = editor.locator(`[data-wikilink-ref='note:${targetId}']`);
	await expect(link).toHaveCount(1);
	await expect(link).toContainText("Faith is a seed");

	// the composing rail resolves it LIVE into a Notes register
	const rail = page.getByRole("region", { name: "Linked in this note" });
	await expect(rail).toBeVisible({ timeout: 5000 });
	await expect(rail.getByRole("heading", { name: "Notes", level: 3 })).toBeVisible();
	await expect(rail).toContainText("Faith is a seed");

	// save → the create redirect keeps the editing posture (LWW adoption);
	// Done lands the read view
	await page.keyboard.press("ControlOrMeta+s");
	await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/, { timeout: 10_000 });
	await page.getByRole("button", { name: "Done", exact: true }).click();
	const bodyLink = page.locator(`article a[data-ref='note:${targetId}']`);
	await expect(bodyLink).toBeVisible();
	await expect(page.getByText("· 1 link", { exact: false })).toBeVisible();
	await bodyLink.click();
	await expect(page).toHaveURL(`/notes/${targetId}`);
	await expect(page.getByRole("heading", { name: "Faith is a seed", level: 1 })).toBeVisible();
});

test("the editor bar (Done · status · legend) leads the editor", async ({ page }) => {
	const id = await seedNote("# Bar order\n\nBody.\n");
	await page.goto(`/notes/${id}`);
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	const editor = page.locator(".note-editor");
	await expect(editor).toBeVisible();

	const done = page.getByRole("button", { name: "Done", exact: true });
	await expect(done).toBeVisible();
	const barBottom = (await done.boundingBox())!.y;
	const editorTop = (await editor.boundingBox())!.y;
	expect(barBottom).toBeLessThan(editorTop);
	// the legend rides the same leading bar
	await expect(page.getByText("⌘B", { exact: false })).toBeVisible();
});

test("a foreign note uuid renders dead — absence, not a leak", async ({ page }) => {
	// a syntactically valid uuid that is NOT one of this user's notes
	const foreign = "00000000-0000-4000-8000-000000000000";
	const id = await seedNote(`# Absence\n\nsee [[note:${foreign}|their note]]\n`);
	await page.goto(`/notes/${id}`);

	// renders as a link (grammar-valid) but the rail shows NO Notes register
	// and the hover preview map is empty for it — RLS resolved it to nothing
	await expect(page.getByRole("heading", { name: "Absence", level: 1 })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Notes", level: 3 })).toHaveCount(0);
});
