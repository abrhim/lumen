import { test, expect } from "@playwright/test";
import { createE2eUser, type E2eUser } from "./support/session";

/** Roadmap voting (2026-08-01): public standings, flame presses for the
 * signed-in, capped at 10, one row per (feature, voter) in the DB. */

test("signed out: standings visible, the flame is a sign-in door", async ({ page }) => {
	await page.goto("/roadmap");
	await expect(page.getByRole("heading", { name: "Roadmap", level: 1 })).toBeVisible();
	await expect(page.getByRole("heading", { name: /Proposed/ })).toBeVisible();
	const door = page.getByRole("link", { name: /sign in to vote/ }).first();
	await expect(door).toBeVisible();
	await expect(door).toHaveAttribute("href", "/login?next=%2Froadmap");
});

test.describe("signed in", () => {
	let user: E2eUser;
	test.beforeAll(async () => {
		user = await createE2eUser("roadmap");
	});
	test.afterAll(async () => {
		await user?.cleanup();
	});
	test.beforeEach(async ({ context }) => {
		await user.install(context);
	});

	test("presses increment, persist, and cap at ten", async ({ page }) => {
		await page.goto("/roadmap");
		const flame = page.getByRole("button", { name: /press to add yours/ }).first();
		await expect(flame).toBeVisible();
		const label0 = (await flame.getAttribute("aria-label"))!;
		const before = parseInt(label0, 10);

		await flame.click();
		await flame.click();
		await flame.click();
		await expect(flame).toHaveAttribute("aria-label", new RegExp(`3 of 10`));

		// the burst flushes ~250ms after the last press — let it land
		await page.waitForTimeout(900);
		await page.reload();
		const after = page.getByRole("button", { name: /3 of 10/ }).first();
		await expect(after).toBeVisible();
		await expect(after).toHaveAttribute("aria-label", new RegExp(`^${before + 3} votes`));

		// hammer past the cap — the DB clamps; the lit torch stays live
		for (let i = 0; i < 9; i++) {
			const b = page.getByRole("button", { name: /press to add yours|are in/ }).first();
			if ((await b.getAttribute("aria-label"))?.includes("are in")) break;
			await b.click();
		}
		await page.waitForTimeout(900);
		await page.reload();
		const lit = page.getByRole("button", { name: /your 10 are in/ }).first();
		await expect(lit).toBeVisible();

		// right-click takes one back — and it persists
		await lit.click({ button: "right" });
		await expect(
			page.getByRole("button", { name: /9 of 10/ }).first(),
		).toBeVisible();
		await page.waitForTimeout(900);
		await page.reload();
		await expect(page.getByRole("button", { name: /9 of 10/ }).first()).toBeVisible();
	});
});
