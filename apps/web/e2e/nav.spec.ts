import { test, expect } from "@playwright/test";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * Global nav (Abram, 2026-07-31) — the three named pains, pinned:
 *  1. editing a note → one click to the scripture home
 *  2. anywhere → one click to /notes
 *  3. anywhere → one click to the collections list, and the podcast is on it
 * Wide viewports get the left rail; narrower get the top row. Both carry
 * the same words.
 */

let user: E2eUser;
test.beforeAll(async () => {
	user = await createE2eUser("nav");
});
test.afterAll(async () => {
	await user?.cleanup();
});
test.beforeEach(async ({ context }) => {
	await user.install(context);
});

test("editing a note, one click reaches the scripture home", async ({ page }) => {
	await page.goto("/notes/new");
	await expect(page.locator(".note-editor")).toBeVisible();
	await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Scripture" }).click();
	await expect(page).toHaveURL("/");
	await expect(page.getByRole("heading", { name: "The Library" })).toBeVisible();
});

test("the reader reaches Notes in one click", async ({ page }) => {
	await page.goto("/scripture/alma/32");
	await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Notes" }).click();
	await expect(page).toHaveURL("/notes");
});

test("Collections lists the podcast and lands on it", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Collections" }).click();
	await expect(page).toHaveURL("/collections");
	const unshaken = page.getByRole("link", { name: /Unshaken/i }).first();
	await expect(unshaken).toBeVisible();
	await unshaken.click();
	await expect(page).toHaveURL(/\/collections\/.+/);
});

test("wide viewports carry the LEFT RAIL; current section reads full ink", async ({ page }) => {
	await page.setViewportSize({ width: 1512, height: 900 });
	await page.goto("/notes");
	const rail = page.getByRole("navigation", { name: "Primary" });
	await expect(rail).toBeVisible();
	// vertical: the rail's words stack (Lumen above Scripture above Notes)
	const lumen = (await rail.getByRole("link", { name: "Lumen" }).boundingBox())!;
	const notes = (await rail.getByRole("link", { name: "Notes", exact: true }).boundingBox())!;
	expect(lumen.x).toBeLessThan(200); // off to the left
	expect(notes.y).toBeGreaterThan(lumen.y + 20); // stacked, with air
	await expect(rail.getByRole("link", { name: "Notes", exact: true })).toHaveAttribute(
		"aria-current",
		"page",
	);
});

test("Me opens settings; theme applies and survives reload", async ({ page }) => {
	await page.goto("/notes");
	await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Me", exact: true }).click();
	await expect(page).toHaveURL("/me");
	await expect(page.getByRole("heading", { name: "Me", level: 1 })).toBeVisible();

	// theme flips the document and persists across a reload (boot script)
	await page.getByRole("radio", { name: "parchment" }).click();
	await expect
		.poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
		.toBe("parchment");
	await page.reload();
	await expect
		.poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
		.toBe("parchment");

	// signed-in account register shows the address and a sign-out door
	await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("the top-right cluster is gone; Search lives in the nav and summons the palette", async ({
	page,
}) => {
	await page.goto("/notes");
	// no orb button, no menu button in the fixed chrome
	expect(await page.locator(".fixed.right-4.top-4").count()).toBe(0);
	await expect(page.getByRole("button", { name: "Menu" })).toHaveCount(0);

	await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Search/ }).click();
	// the palette opens in place — no navigation
	await expect(page.getByRole("searchbox", { name: "Search the library" })).toBeVisible();
	await expect(page).toHaveURL("/notes");
	// Esc closes; typing + Enter navigates to /search
	await page.keyboard.type("faith");
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/\/search\?q=faith/);
});
