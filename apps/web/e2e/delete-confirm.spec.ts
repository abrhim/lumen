import { test, expect } from "@playwright/test";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * Gap 46 — delete-confirm focus discipline (the B5/B9 class): cancel
 * returns to the trigger; confirm lands on /notes' h1 with an
 * announcement, never a dead <body> focus.
 */

let user: E2eUser;

test.beforeAll(async () => {
	user = await createE2eUser("delete");
});
test.afterAll(async () => {
	await user?.cleanup();
});

test.beforeEach(async ({ context }) => {
	await user.install(context);
});

test("cancel returns focus to the trigger; confirm lands on /notes h1", async ({ page }) => {
	const { data: note } = await user.client
		.schema("lumen")
		.rpc("create_note_with_anchors", { p_body_md: "Delete me.\n", p_anchors: [] })
		.single();
	const id = (note as { id: string }).id;

	await page.goto(`/notes/${id}`);
	const trigger = page.getByRole("button", { name: "Delete", exact: true });
	// keyboard-open so the focus assertion is honest (pointer-blur guard)
	await trigger.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("alertdialog")).toBeVisible();

	// Esc = cancel; focus returns to the trigger
	await page.keyboard.press("Escape");
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	await expect(trigger).toBeFocused();

	// confirm: focus lands on the /notes h1 with the announcement
	await page.keyboard.press("Enter");
	await page.getByRole("button", { name: "Delete note" }).click();
	await expect(page).toHaveURL(/\/notes$/);
	await expect(page.getByRole("heading", { name: "Your notes", level: 1 })).toBeFocused();
	await expect(page.getByText("Note deleted")).toHaveCount(1);

	// F8: the note is gone from the index and 404s directly
	await expect(page.getByText("Delete me.")).toHaveCount(0);
	const res = await page.request.get(`/notes/${id}`);
	expect(res.status()).toBe(404);
});
