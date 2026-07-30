import { test, expect } from "@playwright/test";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * Gap 48 — reduced motion: no computed entrance animation on the delete
 * dialog under prefers-reduced-motion (the B14 lesson: motion-safe:
 * variants, never motion-reduce overrides).
 */

test.use({ contextOptions: { reducedMotion: "reduce" } });

let user: E2eUser;
let noteId: string;

test.beforeAll(async () => {
	user = await createE2eUser("motion");
	const { data } = await user.client
		.schema("lumen")
		.rpc("create_note_with_anchors", { p_body_md: "Motion probe.\n", p_anchors: [] })
		.single();
	noteId = (data as { id: string }).id;
});
test.afterAll(async () => {
	await user?.cleanup();
});

test.beforeEach(async ({ context }) => {
	await user.install(context);
});

test("delete dialog mounts without an entrance animation", async ({ page }) => {
	await page.goto(`/notes/${noteId}`);
	await page.getByRole("button", { name: "Delete", exact: true }).click();
	const dialog = page.getByRole("alertdialog");
	await expect(dialog).toBeVisible();
	const animation = await dialog.evaluate((el) => getComputedStyle(el).animationName);
	expect(animation).toBe("none");
});
