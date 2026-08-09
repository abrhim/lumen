import { test, expect } from "@playwright/test";
import { createE2eUser, type E2eUser } from "./support/session";
import { HIGHLIGHT_COLORS } from "../app/lib/highlight-colors";

/**
 * Whole-verse marks — docs/design/highlighting.md, slice 1.
 *
 * The reload assertion is the point of the whole design. Marks are read through
 * the caller's own PostgREST client rather than over Hyperdrive, because
 * Hyperdrive caches reads ~60s and a mark that vanishes on reload is worthless.
 * That is the failure this test exists to catch.
 */

const CHAPTER = "/scripture/alma/32";

test("signed out: the menu keeps a mark locally, and it survives a reload", async ({ page }) => {
	await page.goto(CHAPTER);
	await page.waitForSelector("html[data-hydrated]");
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	// the gutter shortcut writes immediately, so it stays signed-in only
	expect(await page.locator("[data-hl]").count()).toBe(0);

	// but selecting text must still offer something — this audience arrives
	// from search and would otherwise never learn the feature exists
	await page.locator("#v21").scrollIntoViewIfNeeded();
	await page.evaluate(() => {
		const el = document.querySelector("#v21 [data-verse-text]")!;
		const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		const nodes: Text[] = [];
		let n: Node | null;
		while ((n = w.nextNode())) nodes.push(n as Text);
		const r = document.createRange();
		r.setStart(nodes[0], 0);
		r.setEnd(nodes[nodes.length - 1], 20);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(r);
		document.dispatchEvent(new Event("selectionchange"));
	});
	const menu = page.getByRole("dialog", { name: "Mark the selected text" });
	await expect(menu).toBeVisible();
	await expect(menu.getByText("Marks are kept on this device. Sign in to keep them everywhere.")).toBeVisible();
	await expect(menu.getByRole("button", { name: "Copy" })).toBeVisible();
	// the style toggle is hidden — it decides nothing you can save
	await expect(menu.getByRole("button", { name: "Underline" })).toHaveCount(0);

	// a colour KEEPS the mark locally — no account, no bounce to /login
	await menu.getByRole("button", { name: "Mark yellow" }).click();
	await expect(page).toHaveURL(/\/scripture\/alma\/32$/);
	await expect(page.locator("#v21 .hl-yellow")).toHaveCount(1);

	// and it is still there after a reload, which is the whole point of keeping
	// it: a stranger from search can try the feature and not lose it
	await page.reload();
	await page.waitForSelector("html[data-hydrated]");
	await expect(page.locator("#v21 .hl-yellow")).toHaveCount(1);
});

test.describe("signed in", () => {
	let user: E2eUser;
	test.beforeAll(async () => {
		user = await createE2eUser("highlights");
	});
	test.afterAll(async () => {
		await user?.cleanup();
	});
	test.beforeEach(async ({ context }) => {
		await user.install(context);
	});

	test("a mark lands, survives a reload, and toggles off", async ({ page }) => {
		await page.goto(CHAPTER);
		await page.waitForSelector("html[data-hydrated]");
		const gutter = page.locator('[data-hl="21"]');
		await expect(gutter).toBeVisible();

		// the mark paints on the segment span inside the verse, not the row
		const painted = page.locator("#v21 .hl-row");
		await expect(painted).toHaveCount(0);

		// mark it — and the tap must NOT navigate to ?verse=21
		await gutter.click();
		await expect(painted).toHaveClass(/hl-yellow/);
		expect(new URL(page.url()).searchParams.get("verse")).toBeNull();

		// the assertion the design exists for: still there after a full reload
		await page.waitForTimeout(600);
		await page.reload();
		await expect(page.locator("#v21 .hl-row")).toHaveClass(/hl-yellow/);

		// tapping again clears it, and that also persists
		await page.locator('[data-hl="21"]').click();
		await expect(page.locator("#v21 .hl-row")).toHaveCount(0);
		await page.waitForTimeout(600);
		await page.reload();
		await expect(page.locator("#v21 .hl-row")).toHaveCount(0);
	});

	test("a mark does not steal the word-study tap or the verse select", async ({ page }) => {
		await page.goto(CHAPTER);
		await page.waitForSelector("html[data-hydrated]");
		// tapping the verse TEXT still selects the verse
		await page.locator("#v21 [role=button]").first().click();
		await expect(page).toHaveURL(/\?verse=21/);
	});
});

test.describe("the colour picker", () => {
	let user: E2eUser;
	test.beforeAll(async () => {
		user = await createE2eUser("hl-colors");
	});
	test.afterAll(async () => {
		await user?.cleanup();
	});
	test.beforeEach(async ({ context }) => {
		await user.install(context);
	});

	test("the panel offers five colours, and they are real buttons", async ({ page }) => {
		await page.goto(`${CHAPTER}?verse=21`);
		await page.waitForSelector("html[data-hydrated]");
		const swatches = page.getByRole("button", { name: new RegExp(`^Mark (${HIGHLIGHT_COLORS.join("|")})$`) });
		await expect(swatches).toHaveCount(HIGHLIGHT_COLORS.length);
		// keyboard-reachable, which the gutter-number span is not
		await swatches.first().focus();
		await expect(swatches.first()).toBeFocused();
	});

	test("a colour marks, a different colour recolours, the same colour clears", async ({ page }) => {
		await page.goto(`${CHAPTER}?verse=21`);
		await page.waitForSelector("html[data-hydrated]");
		const row = page.locator("#v21 .hl-row");

		await page.getByRole("button", { name: "Mark green" }).click();
		await expect(row).toHaveClass(/hl-green/);

		await page.getByRole("button", { name: "Mark blue" }).click();
		await expect(row).toHaveClass(/hl-blue/);
		await expect(row).not.toHaveClass(/hl-green/);

		// pressing the colour in force clears it, and the label says so
		const blue = page.getByRole("button", { name: "Remove the blue mark" });
		await expect(blue).toHaveAttribute("aria-pressed", "true");
		await blue.click();
		await expect(page.locator("#v21 .hl-row")).toHaveCount(0);

		await page.waitForTimeout(600);
		await page.reload();
		await expect(page.locator("#v21 .hl-row")).toHaveCount(0);
	});

	test("the gutter shortcut clears whatever colour is there", async ({ page }) => {
		await page.goto(`${CHAPTER}?verse=21`);
		await page.waitForSelector("html[data-hydrated]");
		await page.getByRole("button", { name: "Mark pink" }).click();
		await expect(page.locator("#v21 .hl-row")).toHaveClass(/hl-pink/);
		// the number tap carries no picker — it must still clear a pink mark
		await page.locator('[data-hl="21"]').click();
		await expect(page.locator("#v21 .hl-row")).toHaveCount(0);
	});
});

test.describe("passage marks", () => {
	let user: E2eUser;
	test.beforeAll(async () => {
		user = await createE2eUser("passage");
	});
	test.afterAll(async () => {
		await user?.cleanup();
	});
	test.beforeEach(async ({ context }) => {
		await user.install(context);
	});

	test("selecting part of a verse marks the WORDS, not the row", async ({ page }) => {
		await page.goto(CHAPTER);
		await page.waitForSelector("html[data-hydrated]");
		// a reader selects what they can see
		await page.locator("#v21").scrollIntoViewIfNeeded();
		await page.waitForTimeout(300);

		await page.evaluate(() => {
			const el = document.querySelector("#v21 [data-verse-text]")!;
			const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
			const nodes: Text[] = [];
			let n: Node | null;
			while ((n = walker.nextNode())) nodes.push(n as Text);
			const r = document.createRange();
			const last = nodes[nodes.length - 1];
			r.setStart(nodes[0], 8);
			r.setEnd(last, nodes.length === 1 ? 34 : Math.min(6, last.length));
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(r);
			document.dispatchEvent(new Event("selectionchange"));
		});

		const menu = page.getByRole("dialog", { name: "Mark the selected text" });
		await expect(menu).toBeVisible();
		await menu.getByRole("button", { name: "Mark green" }).click();

		const painted = page.locator("#v21 .hl-green");
		await expect(painted).toHaveCount(1);

		// the mark must be SHORTER than the verse — that is the whole point, and
		// the thing v1 got wrong
		const verseText = await page.locator("#v21 [data-verse-text]").innerText();
		const markedText = await painted.innerText();
		expect(markedText.length).toBeLessThan(verseText.length);
		expect(verseText).toContain(markedText);

		// and it survives a reload, which is what the read path is designed for
		await page.reload();
		await expect(page.locator("#v21 .hl-green")).toHaveCount(1);
		expect(await page.locator("#v21 .hl-green").innerText()).toBe(markedText);
	});

	test("clicking an existing mark opens its menu — recolour and remove", async ({ page }) => {
		await page.goto(CHAPTER);
		await page.waitForSelector("html[data-hydrated]");
		await page.locator("#v22").scrollIntoViewIfNeeded();
		await page.waitForTimeout(300);

		await page.evaluate(() => {
			const el = document.querySelector("#v22 [data-verse-text]")!;
			const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
			const nodes: Text[] = [];
			let n: Node | null;
			while ((n = w.nextNode())) nodes.push(n as Text);
			const r = document.createRange();
			r.setStart(nodes[0], 0);
			r.setEnd(nodes[nodes.length - 1], 20);
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(r);
			document.dispatchEvent(new Event("selectionchange"));
		});
		const menu = page.getByRole("dialog", { name: "Mark the selected text" });
		await expect(menu).toBeVisible();
		await menu.getByRole("button", { name: "Mark blue" }).click();
		await expect(page.locator("#v22 .hl-blue")).toHaveCount(1);

		// click the mark itself — the menu returns, now offering Remove
		await page.locator("#v22 [data-mark-id]").first().click();
		const editing = page.getByRole("dialog", { name: "Mark the selected text" });
		await expect(editing).toBeVisible();
		await expect(editing.getByRole("button", { name: "Remove" })).toBeVisible();

		// recolour in place, not a second mark
		await editing.getByRole("button", { name: "Mark red" }).click();
		await expect(page.locator("#v22 .hl-red")).toHaveCount(1);
		await expect(page.locator("#v22 .hl-blue")).toHaveCount(0);

		// and remove it
		await page.locator("#v22 [data-mark-id]").first().click();
		await page.getByRole("button", { name: "Remove" }).click();
		await expect(page.locator("#v22 .hl-red")).toHaveCount(0);
	});
});

test.describe("guest marks are adopted on sign in", () => {
	let user: E2eUser;
	test.beforeAll(async () => {
		user = await createE2eUser("adopt");
	});
	test.afterAll(async () => {
		await user?.cleanup();
	});

	test("a mark made signed OUT becomes an account mark, and stops being local", async ({
		page,
		context,
	}) => {
		// signed out: make a mark
		await page.goto(CHAPTER);
		await page.waitForSelector("html[data-hydrated]");
		await page.evaluate(() => {
			const el = document.querySelector("#v23 [data-verse-text]")!;
			const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
			const nodes: Text[] = [];
			let n: Node | null;
			while ((n = w.nextNode())) nodes.push(n as Text);
			const r = document.createRange();
			r.setStart(nodes[0], 0);
			r.setEnd(nodes[nodes.length - 1], 18);
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(r);
			document.dispatchEvent(new Event("selectionchange"));
		});
		await page.getByRole("dialog", { name: "Mark the selected text" }).getByRole("button", { name: "Mark teal" }).click();
		await expect(page.locator("#v23 .hl-teal")).toHaveCount(1);
		expect(await page.evaluate(() => localStorage.getItem("lumen-guest-marks") !== null)).toBe(true);

		// now sign in, in the same browser
		await user.install(context);
		await page.reload();
		await page.waitForSelector("html[data-hydrated]");

		// the mark is still on the page, and the local copy is gone: it was adopted
		await expect(page.locator("#v23 .hl-teal")).toHaveCount(1, { timeout: 8000 });
		await expect
			.poll(async () => page.evaluate(() => localStorage.getItem("lumen-guest-marks")), {
				timeout: 8000,
			})
			.toBeNull();

		// and it is the ACCOUNT's now — it survives clearing the device store
		await page.evaluate(() => localStorage.clear());
		await page.reload();
		await page.waitForSelector("html[data-hydrated]");
		await expect(page.locator("#v23 .hl-teal")).toHaveCount(1);
	});
});
