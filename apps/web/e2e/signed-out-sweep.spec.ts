import { test, expect } from "@playwright/test";

/**
 * Gap 51 / F2 — the signed-out sweep: zero notes surface anywhere.
 * The cheapest, highest-value spec in the layer (blast-radius).
 */

test.describe("signed-out: the notes feature does not exist", () => {
	test("/notes redirects to /login with a same-origin next", async ({ page }) => {
		await page.goto("/notes");
		await expect(page).toHaveURL(/\/login\?next=%2Fnotes$/);
	});

	test("/notes/:id redirects without leaking existence", async ({ page }) => {
		await page.goto("/notes/00000000-0000-0000-0000-000000000000");
		await expect(page).toHaveURL(/\/login\?next=/);
	});

	test("reader chapter shows no notes surface", async ({ page }) => {
		await page.goto("/scripture/alma/32?verse=21");
		await expect(page.getByRole("heading", { name: "Your notes" })).toHaveCount(0);
		await expect(page.getByText("Add to note")).toHaveCount(0);
		await expect(page.getByText("New note")).toHaveCount(0);
		// no note ring-dots (the only border-dot-note carriers)
		await expect(page.locator(".border-dot-note")).toHaveCount(0);
	});

	test("/search shows no notes group", async ({ page }) => {
		await page.goto("/search?q=faith");
		await expect(page.getByRole("heading", { name: "Your notes" })).toHaveCount(0);
	});

	test("/api/search carries no notes key", async ({ request }) => {
		const res = await request.get("/api/search?q=faith");
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.groups.map((g: { key: string }) => g.key)).not.toContain("notes");
	});

	test("signed-out scope=notes stays the frozen scope_unknown 400", async ({ request }) => {
		const res = await request.get("/api/search?q=faith&scope=notes");
		expect(res.status()).toBe(400);
		const body = await res.json();
		expect(body.code).toBe("scope_unknown");
		expect(body.error).not.toContain("notes");
	});
});
