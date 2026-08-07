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

test("signed out: verse numbers carry no mark control", async ({ page }) => {
	await page.goto(CHAPTER);
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	expect(await page.locator("[data-hl]").count()).toBe(0);
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

		const verseRow = page.locator("#v21 [role=button]").first();
		await expect(verseRow).not.toHaveClass(/hl-yellow/);

		// mark it — and the tap must NOT navigate to ?verse=21
		await gutter.click();
		await expect(verseRow).toHaveClass(/hl-yellow/);
		expect(new URL(page.url()).searchParams.get("verse")).toBeNull();

		// the assertion the design exists for: still there after a full reload
		await page.waitForTimeout(600);
		await page.reload();
		await expect(page.locator("#v21 [role=button]").first()).toHaveClass(/hl-yellow/);

		// tapping again clears it, and that also persists
		await page.locator('[data-hl="21"]').click();
		await expect(page.locator("#v21 [role=button]").first()).not.toHaveClass(/hl-yellow/);
		await page.waitForTimeout(600);
		await page.reload();
		await expect(page.locator("#v21 [role=button]").first()).not.toHaveClass(/hl-yellow/);
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
		const row = page.locator("#v21 [role=button]").first();

		await page.getByRole("button", { name: "Mark green" }).click();
		await expect(row).toHaveClass(/hl-green/);

		await page.getByRole("button", { name: "Mark blue" }).click();
		await expect(row).toHaveClass(/hl-blue/);
		await expect(row).not.toHaveClass(/hl-green/);

		// pressing the colour in force clears it, and the label says so
		const blue = page.getByRole("button", { name: "Remove the blue mark" });
		await expect(blue).toHaveAttribute("aria-pressed", "true");
		await blue.click();
		await expect(row).not.toHaveClass(/hl-blue/);

		await page.waitForTimeout(600);
		await page.reload();
		await expect(page.locator("#v21 [role=button]").first()).not.toHaveClass(/hl-(blue|green)/);
	});

	test("the gutter shortcut clears whatever colour is there", async ({ page }) => {
		await page.goto(`${CHAPTER}?verse=21`);
		await page.waitForSelector("html[data-hydrated]");
		await page.getByRole("button", { name: "Mark pink" }).click();
		await expect(page.locator("#v21 [role=button]").first()).toHaveClass(/hl-pink/);
		// the number tap carries no picker — it must still clear a pink mark
		await page.locator('[data-hl="21"]').click();
		await expect(page.locator("#v21 [role=button]").first()).not.toHaveClass(/hl-pink/);
	});
});
