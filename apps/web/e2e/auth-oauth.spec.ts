import { test, expect } from "@playwright/test";

/** Google OAuth plumbing (task #17) — testable without real Google:
 * the start leg builds a proper authorize redirect carrying the PKCE
 * params; the callback fails CLOSED to /login with a plain error. */

test("/auth/google 302s to the Supabase authorize URL for Google", async ({ request }) => {
	const res = await request.get("/auth/google?next=%2Fnotes", { maxRedirects: 0 });
	expect(res.status()).toBe(302);
	const loc = res.headers()["location"] ?? "";
	expect(loc).toContain("/auth/v1/authorize");
	expect(loc).toContain("provider=google");
	expect(loc).toContain("code_challenge");
	expect(decodeURIComponent(loc)).toContain("/auth/callback?next=%2Fnotes");
	// the PKCE verifier cookie rides the redirect (D4/D5)
	expect(res.headers()["set-cookie"] ?? "").toContain("code-verifier");
});

test("callback without a code lands on /login with the oauth error", async ({ request }) => {
	const res = await request.get("/auth/callback", { maxRedirects: 0 });
	expect(res.status()).toBe(302);
	expect(res.headers()["location"]).toBe("/login?error=oauth");
});

test("callback with a garbage code fails closed to /login", async ({ request }) => {
	const res = await request.get("/auth/callback?code=not-a-real-code&next=%2Fnotes", {
		maxRedirects: 0,
	});
	expect(res.status()).toBe(302);
	expect(res.headers()["location"]).toContain("/login?next=%2Fnotes&error=oauth");
});

test("the login page carries the Google door", async ({ page }) => {
	await page.goto("/login?next=%2Fnotes");
	const door = page.getByRole("link", { name: "Sign in with Google" });
	await expect(door).toBeVisible();
	await expect(door).toHaveAttribute("href", "/auth/google?next=%2Fnotes");
});
