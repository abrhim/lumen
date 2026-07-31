import { test, expect } from "@playwright/test";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * Guest notes (Abram, 2026-07-31): "Do as much as possible until we NEED
 * them to be signed in." A signed-out visitor composes fully — links,
 * suggestions, live rail — with the draft on the device; sign-in is
 * demanded only at save, and the draft survives the trip.
 */

test.describe("guest composing", () => {
	test("a guest writes, links, and sees the live rail — no account", async ({ page }) => {
		await page.goto("/notes/new");
		const editor = page.locator(".note-editor");
		await editor.click();
		await page.keyboard.type("Faith notes: [[alma 32:21");
		await expect(page.getByRole("option").first()).toContainText("Alma 32:21");
		await page.keyboard.press("Enter");

		// the wikilink landed and the CANON rail resolves without a session
		await expect(editor.locator("[data-wikilink-ref='alma-32-21']")).toHaveCount(1);
		const rail = page.getByRole("region", { name: "Linked in this note" });
		await expect(rail).toBeVisible({ timeout: 5000 });
		await expect(rail).toContainText(/perfect knowledge/);

		// the draft rides localStorage
		await expect
			.poll(async () => page.evaluate(() => localStorage.getItem("lumen-guest-draft")))
			.toContain("[[alma-32-21|Alma 32:21]]");

		// ⌘S doesn't save — it explains
		await page.keyboard.press("ControlOrMeta+s");
		await expect(page.locator("[aria-live='polite'].sr-only")).toContainText("Sign in to save");
		await expect(page).toHaveURL("/notes/new");

		// the door carries the return path
		await expect(page.getByRole("link", { name: "Sign in to save" })).toHaveAttribute(
			"href",
			"/login?next=%2Fnotes%2Fnew",
		);
	});
});

test.describe("the draft survives the sign-in trip", () => {
	let user: E2eUser;
	test.beforeAll(async () => {
		user = await createE2eUser("guestnotes");
	});
	test.afterAll(async () => {
		await user?.cleanup();
	});

	test("a waiting draft restores signed-in and saves itself", async ({ context, page }) => {
		await user.install(context);
		// simulate the return leg: the guest draft is already on the device
		await page.addInitScript(() => {
			localStorage.setItem("lumen-guest-draft", "# Carried across\n\nWritten as a guest.\n");
		});
		await page.goto("/notes/new");
		const editor = page.locator(".note-editor");
		await expect(editor).toContainText("Written as a guest");

		// the restored draft creates itself on idle — no keystroke required
		await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/, { timeout: 10_000 });
		// and the ferry is emptied so the next /notes/new starts clean
		await expect
			.poll(async () => page.evaluate(() => localStorage.getItem("lumen-guest-draft")))
			.toBeNull();
	});
});
