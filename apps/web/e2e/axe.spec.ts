import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * Gap 47 — axe passes on the notes surfaces in both themes. WCAG AA floor;
 * violations print in full so failures are actionable.
 */

let user: E2eUser;
let noteId: string;

test.beforeAll(async () => {
	user = await createE2eUser("axe");
	const { data, error } = await user.client
		.schema("lumen")
		.rpc("create_note_with_anchors", {
			p_body_md:
				"# Axe fixture\n\nBody with [[alma-32-21|the seed]] and **bold**.\n\n- a list\n\n> a quote\n",
			p_anchors: [{ kind: "verse", ref_id: "alma-32-21" }],
		})
		.single();
	if (error) throw new Error(error.message);
	noteId = (data as { id: string }).id;
});
test.afterAll(async () => {
	await user?.cleanup();
});

test.beforeEach(async ({ context }) => {
	await user.install(context);
});

const THEMES = ["light", "parchment"] as const;

for (const theme of THEMES) {
	test.describe(`${theme} theme`, () => {
		test.beforeEach(async ({ page }) => {
			if (theme === "parchment") {
				await page.addInitScript(() =>
					document.documentElement.setAttribute("data-theme", "parchment"),
				);
			}
		});

		async function expectClean(page: import("@playwright/test").Page, opts?: { reader?: boolean }) {
			let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
			if (opts?.reader) {
				// PRE-EXISTING reader-chrome contrast debt, not personal-notes
				// surface (flagged for the code panel): the corner "Lumen" link
				// and existing text-faint labels ("curated", verse numbers).
				builder = builder.exclude(".text-faint").exclude("a[href='/']");
			}
			const results = await builder.analyze();
			expect(results.violations).toEqual([]);
		}

		test("/notes index", async ({ page }) => {
			await page.goto("/notes");
			await expectClean(page);
		});

		test("/notes/:id read view", async ({ page }) => {
			await page.goto(`/notes/${noteId}`);
			await expectClean(page);
		});

		test("/notes/:id edit view", async ({ page }) => {
			await page.goto(`/notes/${noteId}`);
			await page.getByRole("button", { name: "Edit", exact: true }).click();
			await page.locator(".note-editor").waitFor();
			await expectClean(page);
		});

		test("reader with the notes register", async ({ page }) => {
			await page.goto("/scripture/alma/32?verse=21");
			await page.getByRole("heading", { name: "Your notes", level: 3 }).waitFor();
			await expectClean(page, { reader: true });
		});
	});
}
