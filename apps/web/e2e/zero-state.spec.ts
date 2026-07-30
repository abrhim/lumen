import { test, expect } from "@playwright/test";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * Gap 44 — zero-state: capture VERBS print (they are the scent, CF-20);
 * register rows don't; empty /notes speaks once in type.
 */

let user: E2eUser;

test.beforeAll(async () => {
	user = await createE2eUser("zero");
});
test.afterAll(async () => {
	await user?.cleanup();
});

test.beforeEach(async ({ context }) => {
	await user.install(context);
});

test("empty /notes: one italic line and a plain door", async ({ page }) => {
	await page.goto("/notes");
	await expect(page.getByText("Nothing written yet.")).toBeVisible();
	await expect(page.getByRole("link", { name: "Begin a note" })).toBeVisible();
	// no empty-state card, no illustration — the line and the door only
	await expect(page.locator("main img, main svg:not([aria-hidden])")).toHaveCount(0);
});

test("reader with zero notes: New note prints, no register rows", async ({ page }) => {
	await page.goto("/scripture/alma/32?verse=21");
	await expect(page.getByRole("link", { name: "New note" })).toBeVisible();
	// no last-touched note → Add-to-note degrades away (A9)
	await expect(page.getByRole("button", { name: "Add to note" })).toHaveCount(0);
	await expect(page.getByRole("heading", { name: "Your notes" })).toHaveCount(0);
});

test("B5: signed-in /login?next= honors the same-origin return trip", async ({ page }) => {
	await page.goto("/login?next=%2Fnotes");
	await expect(page).toHaveURL(/\/notes$/);
});

test("B5: hostile next collapses to home, never off-origin", async ({ page }) => {
	await page.goto("/login?next=//evil.example/steal");
	await expect(page).toHaveURL(/localhost:4179\/$/);
});
