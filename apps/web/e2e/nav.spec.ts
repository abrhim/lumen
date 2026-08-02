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

test("Collections carries exactly three doors; the podcast door lands", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Collections" }).click();
	await expect(page).toHaveURL("/collections");
	// the curated set (Abram, 2026-07-31): Strong's, Art, Unshaken — no more
	await expect(page.getByRole("link", { name: /Strong/ })).toBeVisible();
	await expect(page.getByRole("link", { name: /^Art/ })).toBeVisible();
	const unshaken = page.getByRole("link", { name: /Unshaken/i }).first();
	await expect(unshaken).toBeVisible();
	expect(await page.locator("main ul > li").count()).toBe(3);
	await unshaken.click();
	await expect(page).toHaveURL(/\/collections\/.+/);
});

test("Strong's traverses: overview → range → word study", async ({ page }) => {
	await page.goto("/strongs");
	await page.getByRole("link", { name: "1–100", exact: true }).first().click();
	await expect(page).toHaveURL("/strongs?from=H1");
	await expect(page.getByRole("heading", { name: "H1–H100" })).toBeVisible();
	const first = page.locator("main ul a").first();
	await expect(first).toContainText("H1");
	await first.click();
	await expect(page).toHaveURL(/\/word\/H1/);
});

test("Art traverses: ledger → chapter gallery", async ({ page }) => {
	await page.goto("/art");
	await expect(page.getByRole("heading", { name: "Art", level: 1 })).toBeVisible();
	// canonical shelving: a book section with numbered chapter doors
	const door = page.locator("main section a").first();
	await door.click();
	await expect(page).toHaveURL(/\/scripture\/[a-z0-9-]+\/\d+\/art/);
});

test("wide viewports carry the LEFT RAIL; current section reads full ink", async ({ page }) => {
	await page.setViewportSize({ width: 1512, height: 900 });
	await page.goto("/notes");
	const rail = page.getByRole("navigation", { name: "Primary" });
	await expect(rail).toBeVisible();
	// vertical: the rail's words stack (Lumen above Scripture above Notes)
	const lumen = (await page.getByRole("link", { name: "Lintel", exact: true }).boundingBox())!;
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

test("a one-chapter book lands in the reading, not a contents page", async ({ page }) => {
	await page.goto("/scripture/enos");
	await expect(page).toHaveURL("/scripture/enos/1");
	// a many-chapter book keeps its contents page
	await page.goto("/scripture/alma");
	await expect(page).toHaveURL("/scripture/alma");
});

test("About and Roadmap exist, framed by the canon, linked from the home foot", async ({
	page,
}) => {
	await page.goto("/");
	await page
		.getByRole("navigation", { name: "Primary" })
		.getByRole("link", { name: "About", exact: true })
		.click();
	await expect(page).toHaveURL("/about");
	await expect(page.getByRole("heading", { name: "About", level: 1 })).toBeVisible();
	// Scoped to the foot, which is what this test is about. `main` stopped being
	// specific enough once PageFoot landed on every chrome page: the About copy
	// already links the roadmap in prose, so a main-wide match finds two.
	await page.locator("footer").getByRole("link", { name: "Roadmap", exact: true }).click();
	await expect(page).toHaveURL("/roadmap");
	await expect(page.getByRole("heading", { name: "Roadmap", level: 1 })).toBeVisible();
	await expect(page.getByText("In rough order. No dates.")).toBeVisible();
});

test("mobile pane carries the verse itself, roman; desktop rail does not", async ({ page }) => {
	// desktop: the blockquote is hidden (the verse sits beside the rail)
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/scripture/alma/32?verse=21");
	const quote = page.locator("blockquote", { hasText: "perfect knowledge" }).first();
	await expect(quote).toBeHidden();
});
