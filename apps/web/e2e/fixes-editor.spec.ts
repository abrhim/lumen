import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * Step-12 repro specs for the editor fix pass (worker A):
 * B10 + B36 + CP-62 (combobox ARIA on the focused element, valid listbox),
 * B11 (caret anchoring), B29 (`]]` deactivates the span), B48 (highlight
 * reset on list identity), B50 (repeat announcements re-announce),
 * B51 (outside-click dismissal of the ⌘K palette).
 *
 * Every assertion below fails against the pre-fix editor.
 */

let user: E2eUser;

test.beforeAll(async () => {
	user = await createE2eUser("fixes-editor");
});
test.afterAll(async () => {
	await user?.cleanup();
});

test.beforeEach(async ({ context }) => {
	await user.install(context);
});

const LISTBOX = "#note-insert-listbox";

test("B10/CP-62: the `[[` posture's combobox ARIA rides the FOCUSED editor", async ({ page }) => {
	await page.goto("/notes/new");
	const editor = page.locator(".note-editor");
	await editor.click();
	await page.keyboard.type("see [[alma 32");
	await expect(page.getByRole("listbox")).toBeVisible();

	// the contract is on the contenteditable itself — the element that has
	// DOM focus — not on the role-less wrapper div, where it was inert
	await expect(editor).toHaveAttribute("role", "combobox");
	await expect(editor).toHaveAttribute("aria-expanded", "true");
	await expect(editor).toHaveAttribute("aria-autocomplete", "list");
	await expect(editor).toHaveAttribute("aria-controls", "note-insert-listbox");
	await expect(editor).toHaveAttribute("aria-activedescendant", "note-insert-opt-0");
	expect(
		await page.evaluate(() => document.activeElement?.getAttribute("aria-activedescendant")),
	).toBe("note-insert-opt-0");
	// the wrapper carries none of it any more
	expect(await page.locator("[aria-activedescendant]").count()).toBe(1);

	// activedescendant tracks the highlight
	await page.keyboard.press("ArrowDown");
	await expect(editor).toHaveAttribute("aria-activedescendant", "note-insert-opt-1");

	// closing restores the plain multiline textbox
	await page.keyboard.press("Escape");
	await expect(page.getByRole("listbox")).toHaveCount(0);
	await expect(editor).toHaveAttribute("role", "textbox");
	await expect(editor).toHaveAttribute("aria-multiline", "true");
	expect(await editor.getAttribute("aria-expanded")).toBeNull();
});

test("B36: the empty state is not a child of role=listbox (axe, popup open)", async ({ page }) => {
	await page.goto("/notes/new");
	const editor = page.locator(".note-editor");
	await editor.click();

	// a query with matches: the listbox exists and axe is clean WITH THE
	// POPUP OPEN (the scan the suite never used to run)
	await page.keyboard.type("[[alma 32");
	await expect(page.getByRole("listbox")).toBeVisible();
	const open = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
	expect(open.violations).toEqual([]);

	// a query with NO matches: the hint renders, but never inside the listbox
	await page.keyboard.type(" qqzzxx");
	await expect(page.getByText("Type a reference")).toBeVisible();
	await expect(page.locator(LISTBOX)).toHaveCount(0);
	expect(await page.locator(`${LISTBOX} > *`).count()).toBe(0);
	await expect(editor).toHaveAttribute("aria-expanded", "false");
	const empty = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
	expect(empty.violations).toEqual([]);
});

test("B11: the popup opens at the caret and stays in the viewport in a tall note", async ({
	page,
}) => {
	const body = Array.from({ length: 120 }, (_, i) => `Paragraph ${i} of a very tall note.`).join(
		"\n\n",
	);
	const { data: note } = await user.client
		.schema("lumen")
		.rpc("create_note_with_anchors", { p_body_md: `${body}\n`, p_anchors: [] })
		.single();
	const id = (note as { id: string }).id;

	await page.goto(`/notes/${id}`);
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	const editor = page.locator(".note-editor");
	await expect(editor).toBeVisible();

	// caret in the FIRST paragraph, with the editor's foot far below the fold
	const firstPara = editor.locator("p").first();
	await firstPara.click();
	await page.keyboard.press("End");
	await page.keyboard.type(" [[alma 32");

	const listbox = page.getByRole("listbox");
	await expect(listbox).toBeVisible();
	await expect(listbox).toBeInViewport();

	// anchored to the CARET, measured in viewport coords — page coords would
	// be polluted by the pre-existing tall-note native scroll drift (B54)
	const rects = await page.evaluate(() => {
		const lb = document.getElementById("note-insert-listbox")!.getBoundingClientRect();
		const sel = window.getSelection()!;
		const caret = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : { top: 0 };
		return { lbTop: lb.top, lbBottom: lb.bottom, caretTop: caret.top };
	});
	expect(
		Math.min(Math.abs(rects.lbTop - rects.caretTop), Math.abs(rects.lbBottom - rects.caretTop)),
	).toBeLessThan(420);
});

test("B29: typing `]]` deactivates the span — auto-link survives the session", async ({ page }) => {
	await page.goto("/notes/new");
	const editor = page.locator(".note-editor");
	await editor.click();

	// a wikilink typed out by hand, closed by hand
	await page.keyboard.type("[[alma-32-21]]");
	await expect(page.getByRole("listbox")).toHaveCount(0);
	await expect(editor).toHaveAttribute("role", "textbox");

	// the auto-link rule must still fire afterwards (it is gated on the span)
	await page.keyboard.type(" and see 1 Nephi 3:7 ");
	await expect(editor.locator("[data-wikilink-ref='1-ne-3-7']")).toHaveCount(1);

	// same for abandoning a span by moving the caret out of the block
	await page.keyboard.type("[[alma 3");
	await expect(page.getByRole("listbox")).toBeVisible();
	await page.keyboard.press("Escape");
	await page.keyboard.press("Enter");
	await page.keyboard.type("then Mosiah 3:19 ");
	await expect(editor.locator("[data-wikilink-ref='mosiah-3-19']")).toHaveCount(1);
});

test("B48: the highlight resets when the LIST changes, not just its length", async ({ page }) => {
	await page.goto("/notes/new");
	const editor = page.locator(".note-editor");
	await editor.click();

	// "alma 3" and "mosiah 3" return lists of identical length (28) with no
	// destination in common — the pre-fix reset never fired between them
	await page.keyboard.type("[[alma 3");
	await expect(page.getByRole("option").first()).toContainText("Alma 3");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	await expect(editor).toHaveAttribute("aria-activedescendant", "note-insert-opt-2");

	for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");
	await page.keyboard.type("mosiah 3");
	await expect(page.getByRole("option").first()).toContainText("Mosiah 3");
	await expect(editor).toHaveAttribute("aria-activedescendant", "note-insert-opt-0");
	await expect(page.getByRole("option").first()).toHaveAttribute("aria-selected", "true");

	// Enter therefore inserts what the writer is looking at
	await page.keyboard.press("Enter");
	await expect(editor.locator("[data-wikilink-ref='mosiah-3']")).toHaveCount(1);
});

test("B50: the same announcement twice still mutates the live region", async ({ page }) => {
	await page.goto("/notes/new");
	const editor = page.locator(".note-editor");
	await editor.click();
	const live = page.locator("[aria-live='polite'].sr-only");

	await page.keyboard.type("[[alma 32:21");
	// Enter only commits once the suggestion exists — racing it inserts a
	// paragraph instead and nothing is ever announced
	await expect(page.getByRole("option").first()).toContainText("Alma 32:21");
	await page.keyboard.press("Enter");
	await expect(live).toContainText("Inserted link to Alma 32:21");
	const first = (await live.textContent()) ?? "";

	await page.keyboard.type(" and again [[alma 32:21");
	await expect(page.getByRole("option").first()).toContainText("Alma 32:21");
	await page.keyboard.press("Enter");
	// wait for the MUTATED text with an EXACT comparison — toContainText is
	// satisfied by the stale pre-insert region, and toHaveText normalizes
	// zero-width characters away, so both pass before the update lands
	await expect.poll(async () => (await live.textContent()) ?? "").not.toBe(first);
	const second = (await live.textContent()) ?? "";

	// identical text = no DOM mutation = no announcement; the region must
	// differ (zero-width alternation) while reading the same to a user
	expect(second).not.toBe(first);
	expect(second.replace(/\u200B/g, "")).toBe(first.replace(/\u200B/g, ""));
});

test("B51: clicking outside the ⌘K palette closes it down the Esc path", async ({ page }) => {
	await page.goto("/notes/new");
	const editor = page.locator(".note-editor");
	await editor.click();
	await page.keyboard.type("faith is a seed");

	await page.keyboard.press("ControlOrMeta+k");
	const queryInput = page.getByRole("combobox", { name: "Link destination" });
	await expect(queryInput).toBeVisible();
	await queryInput.fill("alma 32:21");
	await expect(page.getByRole("option").first()).toBeVisible();

	// click away: the palette must go, focus + selection must come back
	await page.getByText("⌘B bold").click();
	await expect(queryInput).toHaveCount(0);
	await expect(page.getByRole("listbox")).toHaveCount(0);
	expect(await page.locator("[aria-expanded='true']").count()).toBe(0);
	await expect(editor).toBeFocused();

	// and a later Esc is inert — no surprise jump back to a stale selection
	await page.keyboard.press("Escape");
	await expect(editor).toBeFocused();
	await page.keyboard.type("!");
	await expect(editor).toContainText("faith is a seed!");
});
