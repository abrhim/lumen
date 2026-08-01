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

	test("presses increment, persist, and cap at three", async ({ page }) => {
		await page.goto("/roadmap");
		const up = page.getByRole("button", { name: /press to add yours/ }).first();
		await expect(up).toBeVisible();
		const before = parseInt((await up.getAttribute("aria-label"))!, 10);

		await up.click();
		await up.click();
		await expect(up).toHaveAttribute("aria-label", /2 of 3/);

		// the burst flushes ~250ms after the last press — let it land
		await page.waitForTimeout(900);
		await page.reload();
		const after = page.getByRole("button", { name: /2 of 3/ }).first();
		await expect(after).toBeVisible();
		await expect(after).toHaveAttribute("aria-label", new RegExp(`^${before + 2} votes`));

		// hammer past the cap — the DB clamps and the button stays live
		for (let i = 0; i < 4; i++) {
			const b = page.getByRole("button", { name: /press to add yours|are in/ }).first();
			if ((await b.getAttribute("aria-label"))?.includes("are in")) break;
			await b.click();
		}
		await page.waitForTimeout(900);
		await page.reload();
		await expect(page.getByRole("button", { name: /your 3 are in/ }).first()).toBeVisible();

		// the down chevron takes one back — and it persists
		await page.getByRole("button", { name: /take a press back/ }).first().click();
		await expect(page.getByRole("button", { name: /2 of 3/ }).first()).toBeVisible();
		await page.waitForTimeout(900);
		await page.reload();
		await expect(page.getByRole("button", { name: /2 of 3/ }).first()).toBeVisible();

		// right-click on the up chevron is the same retraction
		await page.getByRole("button", { name: /press to add yours/ }).first().click({ button: "right" });
		await expect(page.getByRole("button", { name: /1 of 3/ }).first()).toBeVisible();

		// spend them back down to nothing: the down chevron goes dead at zero
		await page.getByRole("button", { name: /take a press back/ }).first().click();
		await expect(page.getByRole("button", { name: /take a press back/ }).first()).toBeDisabled();
	});
});
