import { test, expect } from "@playwright/test";

/**
 * /principles — the index (Abram, 2026-08-19: "a /principles page with the
 * list, searchable, faceted").
 *
 * The filtering runs in the browser over the whole set, so a loader test
 * proves nothing about it. What lives here is what only a real page can show:
 * that typing narrows without a round trip, that the category facet survives a
 * reload because it rides in the URL, and that the text query deliberately
 * does NOT — a keystroke in the URL turns typing into navigation.
 */

test.describe("principles index", () => {
	test("lists, filters by name, and facets by category", async ({ page }) => {
		await page.goto("/principles");
		await page.waitForSelector("html[data-hydrated]");

		await expect(page.getByRole("heading", { name: "Principles", level: 1 })).toBeVisible();

		const rows = page.locator("main ul li");
		const total = await rows.count();
		expect(total).toBeGreaterThan(0);
		await expect(page.locator("body")).toContainText(`${total} of ${total}`);

		// typing narrows in the browser, with no navigation
		const urlBefore = page.url();
		await page.getByPlaceholder("Filter by name…").fill("faith");
		await expect(rows).not.toHaveCount(total);
		const narrowed = await rows.count();
		expect(narrowed).toBeGreaterThan(0);
		expect(page.url()).toBe(urlBefore); // the query stays out of the URL

		// every surviving row actually matches
		for (const name of await rows.locator("span").first().allTextContents()) {
			expect(name.toLowerCase()).toContain("faith");
		}

		// a miss says so rather than printing an empty list
		await page.getByPlaceholder("Filter by name…").fill("zzzz-no-such-principle");
		await expect(rows).toHaveCount(0);
		await expect(page.locator("body")).toContainText("Nothing here by that name");
		await page.getByPlaceholder("Filter by name…").fill("");
		await expect(rows).toHaveCount(total);
	});

	test("the category facet rides in the URL and survives a reload", async ({ page }) => {
		await page.goto("/principles");
		await page.waitForSelector("html[data-hydrated]");
		const rows = page.locator("main ul li");
		const total = await rows.count();

		const doctrine = page.getByRole("button", { name: /^Doctrine/ });
		await doctrine.click();
		await expect(doctrine).toHaveAttribute("aria-pressed", "true");
		const filtered = await rows.count();
		expect(filtered).toBeLessThan(total);
		expect(new URL(page.url()).searchParams.get("category")).toBe("doctrine");

		// the point of putting it in the URL: it is still there afterwards
		await page.reload();
		await page.waitForSelector("html[data-hydrated]");
		await expect(rows).toHaveCount(filtered);
		await expect(page.getByRole("button", { name: /^Doctrine/ })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	test("sorting by reference count puts the heaviest principle first", async ({ page }) => {
		await page.goto("/principles?sort=verses");
		await page.waitForSelector("html[data-hydrated]");

		const counts = await page
			.locator("main ul li")
			.evaluateAll((els) =>
				els.map((el) => {
					const m = el.textContent?.match(/(\d[\d,]*)\s+verses?/);
					return m ? Number(m[1].replace(/,/g, "")) : 0;
				}),
			);
		expect(counts.length).toBeGreaterThan(1);
		// descending, and the first row is not a principle with nothing behind it
		expect(counts[0]).toBeGreaterThan(0);
		expect([...counts].sort((a, b) => b - a)).toEqual(counts);
	});

	test("a row opens its principle page", async ({ page }) => {
		await page.goto("/principles");
		await page.waitForSelector("html[data-hydrated]");
		const first = page.locator("main ul li a").first();
		const name = (await first.locator("span").first().textContent())?.trim() ?? "";
		await first.click();
		await expect(page).toHaveURL(/\/principles\/[^/]+$/);
		await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
	});
});
