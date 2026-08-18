import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * Second-show surfaces (docs/design/second-show.md §4). A Stick of Joseph
 * episode — verbatim title, spans:null, its OWN collection — must render on
 * every surface Unshaken does: the collections door, the spanless landing,
 * and the episode page with the collection's byline.
 *
 * Public invisibility of the private collection is NOT asserted here:
 * canViewCollection returns true for everything under import.meta.env.DEV
 * (established design — the same function guarded Unshaken pre-flip).
 */
const pg = createRequire(import.meta.url)("pg");
const EPISODE = "sojspec00001";

test.describe("second show surfaces", () => {
	let admin: E2eUser;
	test.beforeAll(async () => {
		admin = await createE2eUser("second-show");
		const { buildLoadPlan } = await import("../../../scripts/ingest-podcast/load.mjs");
		const { STICK_OF_JOSEPH } = await import(
			"../../../scripts/ingest-podcast/shows/stick-of-joseph.mjs"
		);
		const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
		await c.connect();
		const plan = buildLoadPlan(
			{
				videoId: EPISODE,
				title: "ALTARS in The LDS Temple",
				subtitle: null,
				spans: null,
				uploadDate: "20260601",
				durationS: 4773,
				collectionId: "soj-todd-mclauchlin",
			},
			[
				{ seq: 0, t_start_s: 0, t_end_s: 4, speaker: "0", text: "Welcome back, today Todd joins us to talk about altars." },
				{ seq: 1, t_start_s: 4, t_end_s: 9, speaker: "1", text: "Thank you, it is a joy to be here." },
			],
			[],
			STICK_OF_JOSEPH,
		);
		await c.query("BEGIN");
		for (const s of plan.statements) await c.query(s.text, s.values);
		await c.query("COMMIT");
		await c.end();
	});
	test.afterAll(async () => {
		const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
		await c.connect();
		await c.query("DELETE FROM lumen.entities WHERE id = $1", [`stick-of-joseph-${EPISODE}`]);
		await c.query("DELETE FROM lumen.search_index WHERE ref_id = $1", [`stick-of-joseph-${EPISODE}`]);
		await c.query("DELETE FROM lumen.collections WHERE id = 'soj-todd-mclauchlin'");
		await c.end();
		await admin?.cleanup();
	});

	test("door, spanless landing, and episode page all render from the collection", async ({
		page,
	}) => {
		// the door prints with a live count
		await page.goto("/collections");
		await page.waitForSelector("html[data-hydrated]");
		await expect(page.locator("body")).toContainText("Todd McLaughlin");
		await expect(page.locator("body")).toContainText("1 episodes"); // door count copy is per-door

		// the landing: recency list, NO book-group headers, singular copy
		await page.goto("/collections/soj-todd-mclauchlin");
		await expect(page.getByRole("heading", { name: "Todd McLaughlin" })).toBeVisible();
		await expect(page.locator("body")).not.toContainText("Other");
		await expect(page.locator("body")).toContainText("1 episode");
		await expect(page.locator("body")).toContainText("ALTARS in The LDS Temple");

		// the episode page renders the transcript from ITS OWN collection
		await page.goto(`/media/stick-of-joseph-${EPISODE}`);
		await expect(page.locator("body")).toContainText("Todd joins us to talk about altars");
		await expect(page.locator("body")).toContainText("Todd McLaughlin");
	});
});
