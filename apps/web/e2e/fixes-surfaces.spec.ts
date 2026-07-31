import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * Step-13 fix-pass repros — surface behavior (worker C):
 *  - B12 (CP-13): /search notes rows join the roving tab-stop system; the
 *    SR status counts them (was "0 results" with rows on screen).
 *  - B53 (CP-70): /search?scope=notes stops rendering the all-canon ghost.
 *  - B34 (CP-37): a deleted last-touched note degrades capture to the
 *    New-note door instead of 404ing forever.
 *  - B37 (CP-40): keyboard capture hands focus across the verbs↔gloss swap.
 *  - B39 (CP-42): the media `+ note` door is AA-contrast (out from under
 *    the .text-faint exclusion), keyboard-focusable, and /media gets an
 *    axe scan at all.
 *  - B52 (CP-69): the door is visible without hover on coarse pointers.
 */

/** A token no canon text matches — notes-only search results. Per-user
 * notes isolation (RLS) makes cross-run collisions impossible. */
const TOKEN = "zzqxylophar";

let user: E2eUser;

test.beforeAll(async () => {
	user = await createE2eUser("fixes-c");
});
test.afterAll(async () => {
	await user?.cleanup();
});
test.beforeEach(async ({ context }) => {
	await user.install(context);
});

async function seedNote(body: string): Promise<string> {
	const { data, error } = await user.client
		.schema("lumen")
		.rpc("create_note_with_anchors", { p_body_md: body, p_anchors: [] })
		.single();
	if (error) throw new Error(error.message);
	return (data as { id: string }).id;
}

/** First episode id in the dev DB, via the public search API (the moment/
 * episode corpus is public; no auth needed for discovery). */
async function findEpisodeId(page: Page): Promise<string | null> {
	const res = await page.request.get("/api/search?q=unshaken&scope=episodes&limit=1");
	if (!res.ok()) return null;
	const body = (await res.json()) as {
		groups?: Array<{ key: string; results?: Array<{ id: string }> }>;
	};
	return body.groups?.find((g) => g.key === "episodes")?.results?.[0]?.id ?? null;
}

/* ─── B12 — notes rows in the roving tab-stop system + honest count ─── */

test("search: notes-only matches are keyboard-reachable and counted (B12)", async ({ page }) => {
	await seedNote(`# Roving fixture\n\nA word only I use: ${TOKEN}.\n`);
	await page.goto(`/search?q=${TOKEN}`);
	await expect(page.getByRole("heading", { name: "Your notes" })).toBeVisible();

	// The SR status must count the note rows — "0 results" with rows on
	// screen was the lie.
	await expect(page.getByRole("status")).toContainText(/1 result for/);

	// The note row carries the roving tab stop (tabIndex 0)…
	const row = page.locator("[data-result-row]").first();
	await expect(row).toHaveAttribute("tabindex", "0");
	await expect(row).toHaveAttribute("href", /^\/notes\//);

	// …and ArrowDown from the input enters the list at that row.
	await page.locator("input[type='search']").focus();
	await page.keyboard.press("ArrowDown");
	await expect(row).toBeFocused();

	// ArrowUp from the first row returns to the input (roving contract).
	await page.keyboard.press("ArrowUp");
	await expect(page.locator("input[type='search']")).toBeFocused();
});

/* ─── B53 — scope=notes renders honestly ─── */

test("search: scope=notes no longer claims a full-library search (B53)", async ({ page }) => {
	// a token of its own — the roving test seeds TOKEN for the same user, and
	// "1 result" must count THIS fixture only
	const SCOPED = "vvqmarimbol";
	await seedNote(`Scoped fixture: ${SCOPED} only.\n`);
	await page.goto(`/search?q=${SCOPED}&scope=notes`);
	await expect(page.getByRole("heading", { name: "Your notes" })).toBeVisible();

	// Every canon pill reads excluded — none of those groups ran.
	for (const label of ["Scripture", "People", "Episodes"]) {
		await expect(page.getByRole("button", { name: new RegExp(`^${label}`) })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	}
	// The scope line names what DID run.
	await expect(page.locator("header").getByText("Your notes", { exact: false }).first()).toBeVisible();
	// The count is honest and the row reachable.
	await expect(page.getByRole("status")).toContainText(/1 result for/);
	await expect(page.locator("[data-result-row]").first()).toHaveAttribute("tabindex", "0");
});

/* ─── B34 — deleted last-touched note un-wedges the capture loop ─── */

test("capture: deleted last-touched note degrades to the New-note door (B34)", async ({ page }) => {
	const noteId = await seedNote("# Doomed target\n\nSeed body.\n");

	// Visiting the note makes it the last-touched capture target (A9).
	await page.goto(`/notes/${noteId}`);
	await expect(page.getByRole("heading", { name: "Doomed target", level: 1 })).toBeVisible();

	// Soft-delete it out from under the pointer (another tab, another device…).
	const { error } = await user.client.schema("lumen").rpc("soft_delete_note", { p_id: noteId });
	expect(error).toBeNull();

	await page.goto("/scripture/alma/32?verse=21");
	await page.getByRole("button", { name: "Add to note" }).click();

	// Honest copy — not "try again" for a permanent state.
	await expect(page.getByText("That note is gone — start a new one.")).toBeVisible();
	// The dead verb is gone; the New-note door remains.
	await expect(page.getByRole("button", { name: "Add to note" })).toHaveCount(0);
	await expect(page.getByRole("link", { name: "New note" })).toBeVisible();
	// The stale pointer is cleared — the next capture anywhere starts clean.
	expect(await page.evaluate(() => localStorage.getItem("lumen:last-note"))).toBeNull();

	// And it stays recovered across a reload (no resurrection from storage).
	await page.reload();
	await expect(page.getByRole("link", { name: "New note" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Add to note" })).toHaveCount(0);
});

/* ─── B37 — keyboard capture keeps a focus anchor across the swap ─── */

test("capture: keyboard append focuses the gloss link; undo hands back (B37)", async ({ page }) => {
	const noteId = await seedNote("# Focus target\n\nSeed body.\n");
	await page.goto(`/notes/${noteId}`);
	await expect(page.getByRole("heading", { name: "Focus target", level: 1 })).toBeVisible();

	await page.goto("/scripture/alma/32?verse=21");
	const add = page.getByRole("button", { name: "Add to note" });
	// Keyboard-driven (detail === 0) — the pointer path deliberately leaves
	// focus alone.
	await add.focus();
	await page.keyboard.press("Enter");

	await expect(page.getByText(/Added to “Focus target”/)).toBeVisible();
	// The button unmounted; focus landed on the gloss's "open" link, not <body>.
	await expect(page.getByRole("link", { name: "open", exact: true })).toBeFocused();

	// Symmetric handoff: keyboard undo re-prints the verb and focuses it.
	await page.keyboard.press("Tab"); // open → undo
	await expect(page.getByRole("button", { name: "undo", exact: true })).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page.getByText(/Added to “Focus target”/)).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Add to note" })).toBeFocused();
});

/* ─── B39 — media door contrast + keyboard focusability + /media axe ─── */

test("media: + note door is keyboard-focusable and holds AA when revealed (B39)", async ({
	page,
}) => {
	const episodeId = await findEpisodeId(page);
	test.skip(episodeId === null, "no episode with a transcript in the dev DB");

	await page.goto(`/media/${episodeId}`);
	const door = page.locator("a[aria-label^='New note at']").first();
	await door.waitFor({ state: "attached" });

	// Fine pointer: hidden until hover/focus…
	await expect(door).toHaveCSS("opacity", "0");
	// …but reachable by keyboard, and the focus reveal is real.
	const stamp = page.locator("button[aria-label^='Play from']").first();
	await stamp.focus();
	await page.keyboard.press("Tab");
	await expect(door).toBeFocused();
	await expect(door).toHaveCSS("opacity", "1");

	// The door left .text-faint — it must be scanned, and pass, while
	// revealed. The two excludes are the DOCUMENTED pre-existing debt only
	// (reader-chrome .text-faint, corner Lumen link) — the door itself is
	// text-muted-foreground and inside the scan.
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa"])
		.exclude(".text-faint")
		.exclude("a[href='/']")
		.analyze();
	expect(results.violations).toEqual([]);
});

/* ─── B52 — coarse pointers see the door without hover ─── */

test.describe("coarse pointer", () => {
	// pointer: coarse via touch emulation — house memory: emulate, never
	// window-size crops. Chromium flips the pointer media feature with touch.
	test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

	test("media: + note door is visible without hover on touch (B52)", async ({ page }) => {
		const episodeId = await findEpisodeId(page);
		test.skip(episodeId === null, "no episode with a transcript in the dev DB");

		await page.goto(`/media/${episodeId}`);
		const door = page.locator("a[aria-label^='New note at']").first();
		await door.waitFor({ state: "attached" });

		// No hover happened — the door is simply there, full-contrast (a
		// reduced-alpha reveal would re-fail the AA floor B39 fixed).
		await expect(door).toHaveCSS("opacity", "1");
		await expect(door).toBeVisible();

		// The always-visible door must hold AA on touch too.
		const results = await new AxeBuilder({ page })
			.withTags(["wcag2a", "wcag2aa"])
			.exclude(".text-faint")
			.exclude("a[href='/']")
			.analyze();
		expect(results.violations).toEqual([]);
	});
});
