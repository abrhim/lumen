import { test, expect } from "@playwright/test";
import { createE2eUser, type E2eUser } from "./support/session";

/** External web links, layer 1 (Abram, 2026-07-31): pasting an http(s) URL
 * into the editor becomes a link — selection as label, bare paste linkifies
 * the URL text; the read view renders the outward contract. */

const TALK = "https://www.churchofjesuschrist.org/study/general-conference/2021/10/15nelson";

let user: E2eUser;
test.beforeAll(async () => {
	user = await createE2eUser("extlinks");
});
test.afterAll(async () => {
	await user?.cleanup();
});
test.beforeEach(async ({ context }) => {
	await user.install(context);
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("bare paste linkifies; save renders the outward contract", async ({ page }) => {
	await page.goto("/notes/new");
	const editor = page.locator(".note-editor");
	await editor.click();
	await page.keyboard.type("The talk: ");
	await page.evaluate((url) => navigator.clipboard.writeText(url), TALK);
	await page.keyboard.press("ControlOrMeta+v");

	// linked in the editor immediately
	const inEditor = editor.locator(`a.note-extlink[href='${TALK}']`);
	await expect(inEditor).toHaveCount(1);

	// save → read view carries href + rel + target, label is the URL text
	await page.keyboard.press("ControlOrMeta+s");
	await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/, { timeout: 10_000 });
	await page.getByRole("button", { name: "Done", exact: true }).click();
	const link = page.locator(`article a.note-extlink[href='${TALK}']`);
	await expect(link).toBeVisible();
	await expect(link).toHaveAttribute("rel", "noopener noreferrer");
	await expect(link).toHaveAttribute("target", "_blank");
});

test("pasting over a selection keeps the selection as the label", async ({ page }) => {
	await page.goto("/notes/new");
	const editor = page.locator(".note-editor");
	await editor.click();
	await page.keyboard.type("Read Nelson today");
	// select the word "Nelson"
	await editor.locator("p").first().dblclick({ position: { x: 0, y: 0 } });
	await page.evaluate(() => {
		// double-click position is unreliable across fonts — select by range
		const p = document.querySelector(".note-editor p")!;
		const textNode = p.firstChild as Text;
		const start = textNode.data.indexOf("Nelson");
		const sel = window.getSelection()!;
		const range = document.createRange();
		range.setStart(textNode, start);
		range.setEnd(textNode, start + "Nelson".length);
		sel.removeAllRanges();
		sel.addRange(range);
	});
	await page.evaluate((url) => navigator.clipboard.writeText(url), TALK);
	await page.keyboard.press("ControlOrMeta+v");

	const link = editor.locator(`a.note-extlink[href='${TALK}']`);
	await expect(link).toHaveCount(1);
	await expect(link).toHaveText("Nelson");
	// the sentence reads on, unswallowed
	await expect(editor).toContainText("Read Nelson today");
});
