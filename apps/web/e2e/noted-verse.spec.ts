import { test, expect } from "@playwright/test";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * Gap 49 (+45's structural half) — the noted verse: SR parity via the
 * accessible-name suffix, the register h3, and the ring dot in first slot.
 */

let user: E2eUser;

test.beforeAll(async () => {
	user = await createE2eUser("noted");
	const { error } = await user.client
		.schema("lumen")
		.rpc("create_note_with_anchors", {
			p_body_md: "# On the seed\n\nFaith as [[alma-32-21|the seed]].\n",
			p_anchors: [{ kind: "verse", ref_id: "alma-32-21" }],
		})
		.single();
	if (error) throw new Error(error.message);
});
test.afterAll(async () => {
	await user?.cleanup();
});

test.beforeEach(async ({ context }) => {
	await user.install(context);
});

test("noted verse: accessible name suffix, register h3, ring dot first", async ({ page }) => {
	await page.goto("/scripture/alma/32?verse=21");

	// CF-21(a): the verse link's accessible name says so
	const verse21 = page.getByRole("link", { name: /your note/ });
	await expect(verse21).toHaveCount(1);

	// register: real h3, row is a door to the note, gloss names the scope
	await expect(page.getByRole("heading", { name: "Your notes", level: 3 })).toBeVisible();
	const row = page.getByRole("link", { name: /On the seed/ });
	await expect(row).toBeVisible();
	await expect(page.getByText("this verse")).toBeVisible();

	// CF-21(b): the ring form — border-token dot; the desktop cluster's ring
	// is the visible one (the mobile stack ring is correctly lg:hidden)
	await expect(page.locator(".border-dot-note:visible")).toHaveCount(1);

	// the row opens the note
	await row.click();
	await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
	await expect(page.getByRole("heading", { name: "On the seed", level: 1 })).toBeVisible();
});
