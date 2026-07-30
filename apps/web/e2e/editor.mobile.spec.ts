import { test, expect } from "@playwright/test";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * Gap 53 — F12's mobile smoke walks the `[[` door (the universal insert
 * door — never Cmd+J) on the iOS profile: type, insert link, save.
 * The physical-device pass (Q6 checklist) remains a manual step.
 */

let user: E2eUser;

test.beforeAll(async () => {
	user = await createE2eUser("mobile");
});
test.afterAll(async () => {
	await user?.cleanup();
});

test.beforeEach(async ({ context }) => {
	await user.install(context);
});

test("mobile: type, insert a link via [[, save", async ({ page }) => {
	await page.goto("/notes/new");
	const editor = page.locator(".note-editor");
	await expect(editor).toBeVisible();
	await editor.click();
	await page.keyboard.type("Mobile capture of [[alma 32:21");
	await expect(page.getByRole("listbox")).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(editor.locator("[data-wikilink-ref='alma-32-21']")).toHaveCount(1);
	await page.getByRole("button", { name: "Save", exact: true }).click();
	// create keeps the editor open on the fresh note; Done exits to read view
	await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
	await page.getByRole("button", { name: "Done", exact: true }).click();
	await expect(page.getByRole("heading", { name: /Mobile capture/, level: 1 })).toBeVisible();
});
