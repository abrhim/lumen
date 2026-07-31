import { test, expect } from "@playwright/test";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * Gaps 31 (recovery loop, browser half), 52 (legend earned-quiet shows
 * while unearned), plus the `[[` door and autosave state line.
 */

let user: E2eUser;

test.beforeAll(async () => {
	user = await createE2eUser("editor");
});
test.afterAll(async () => {
	await user?.cleanup();
});

test.beforeEach(async ({ context }) => {
	await user.install(context);
});

test("auto-link fires on boundary; Backspace undoes and stays undone", async ({ page }) => {
	await page.goto("/notes/new");
	const editor = page.locator(".note-editor");
	await expect(editor).toBeVisible();
	await editor.click();
	await page.keyboard.type("as taught in Alma 32:21 ");
	const link = editor.locator("[data-wikilink-ref='alma-32-21']");
	await expect(link).toHaveCount(1);

	// undo the rule: the typed text comes back as plain prose
	await page.keyboard.press("Backspace");
	await expect(link).toHaveCount(0);
	await expect(editor).toContainText("Alma 32:21");

	// suppressed: typing through never re-fires on the same run (A12)
	await page.keyboard.type("and more ");
	await expect(link).toHaveCount(0);
});

test("[[ opens the suggestion popup; Esc closes it and keeps the typed text", async ({ page }) => {
	await page.goto("/notes/new");
	const editor = page.locator(".note-editor");
	await editor.click();
	await page.keyboard.type("see [[alma 32");
	await expect(page.getByRole("listbox")).toBeVisible();
	await expect(page.getByRole("option", { name: /Alma 32/ }).first()).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("listbox")).toHaveCount(0);
	// the typed `[[` remains — Esc never eats content
	await expect(editor).toContainText("[[alma 32");
});

test("Enter inserts the highlighted destination as a wikilink", async ({ page }) => {
	await page.goto("/notes/new");
	const editor = page.locator(".note-editor");
	await editor.click();
	await page.keyboard.type("see [[alma 32:21");
	await expect(page.getByRole("listbox")).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(editor.locator("[data-wikilink-ref='alma-32-21']")).toHaveCount(1);
	await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("the formatting legend prints for a fresh writer (earned-quiet start)", async ({ page }) => {
	await page.goto("/notes/new");
	await expect(page.getByText("⌘B bold")).toBeVisible();
});

test("save state: create lands on the note; edits autosave to Saved", async ({ page }) => {
	await page.goto("/notes/new");
	const editor = page.locator(".note-editor");
	await editor.click();
	await page.keyboard.type("Autosave probe");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	// create redirects to the real note; the editor stays open (keep writing)
	await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);

	// keep editing: the 3s idle debounce lands an autosave against the
	// fresh row's updated_at (the create-redirect base adoption)
	await editor.click();
	await page.keyboard.type(" grows");
	await expect(page.getByText("Unsaved")).toBeVisible();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });

	// Done exits to the read view with the derived title as h1
	await page.getByRole("button", { name: "Done", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Autosave probe grows", level: 1 }),
	).toBeVisible();
});

test("suggestion drilling: chapter pins, verses follow; digits filter prefix-then-suffix", async ({
	page,
}) => {
	await page.goto("/notes/new");
	const editor = page.locator(".note-editor");
	await editor.click();

	// "alma 3" → chapter pinned first, then the chapter's verses
	await page.keyboard.type("[[alma 3");
	const options = page.getByRole("option");
	await expect(options.first()).toContainText("Alma 3");
	await expect(options.nth(1)).toContainText("Alma 3:1");
	await expect(await options.count()).toBeGreaterThan(10);

	// drill: "alma 3 2" → exact 3:2 first, then the 20s
	await page.keyboard.type(" 2");
	await expect(options.first()).toContainText("Alma 3:2");
	await expect(options.nth(1)).toContainText("Alma 3:20");

	// fuzzy book: fresh [[ with a partial name still resolves
	await page.keyboard.press("Escape");
	await page.keyboard.press("Enter");
	await page.keyboard.type("[[alm 32:21");
	await expect(page.getByRole("option").first()).toContainText("Alma 32:21");

	// glued form: "alma63" peels into book + chapter; a following number
	// shifts into the verse slot
	await page.keyboard.press("Escape");
	await page.keyboard.press("Enter");
	await page.keyboard.type("[[alma63");
	await expect(page.getByRole("option").first()).toContainText("Alma 63");
	await page.keyboard.type(" 2");
	await expect(page.getByRole("option").first()).toContainText("Alma 63:2");
});
