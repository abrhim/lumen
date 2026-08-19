import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * /admin/enrichment — the review queue (docs/design/media-collections.md
 * B-scope).
 *
 * Three things unit tests structurally cannot prove, so they live here:
 *  1. the entitlement gate really 404s a signed-in non-admin;
 *  2. an accept really lands in lumen.enrichment_reviews — the write goes
 *     over PostgREST under an RLS policy, and RLS is invisible to any test
 *     that drives the loader with a fixture;
 *  3. the decision SURVIVES A RELOAD. The reason this table exists at all
 *     is that decisions must outlive a pipeline re-run, and the reason the
 *     read leg is PostgREST rather than Hyperdrive is its ~60s cache. A
 *     decision that reads back as pending is the whole bug class.
 */

const pg = createRequire(import.meta.url)("pg");

test.describe("enrichment review queue", () => {
	let admin: E2eUser;
	let plain: E2eUser;
	let seeded = false;

	test.beforeAll(async () => {
		admin = await createE2eUser("enrich-admin");
		plain = await createE2eUser("enrich-plain");
		const dsn = process.env.DATABASE_URL;
		if (!dsn) throw new Error("DATABASE_URL not exported — run via pnpm verify");
		const c = new pg.Client({ connectionString: dsn });
		await c.connect();
		await c.query(
			`INSERT INTO lumen.roles (slug, label, entitlements)
			 VALUES ('admin', 'Administrator', ARRAY['admin.users','admin.collections'])
			 ON CONFLICT (slug) DO UPDATE SET entitlements = EXCLUDED.entitlements`,
		);
		await c.query(
			`INSERT INTO lumen.user_roles (user_id, role_slug) VALUES ($1, 'admin')
			 ON CONFLICT DO NOTHING`,
			[admin.id],
		);
		// A queue needs a claim to review. The seed carries one podcast episode
		// but no extraction, so plant a mention-bearing edge of our own rather
		// than depending on whether a fleet load happens to be present.
		await c.query(
			`INSERT INTO lumen.collections (id, name, description, tier, category, provenance, license, storage, public)
			 VALUES ('e2e-enrich', 'E2E Enrichment', null, 'app', 'podcast', 'youtube', 'test', 'link', false)
			 ON CONFLICT (id) DO NOTHING`,
		);
		await c.query(
			`INSERT INTO lumen.entities (id, entity_type, name, collection_id, source)
			 VALUES ('e2e-enrich-ep', 'content_item', 'E2E Enrichment Episode', 'e2e-enrich', 'e2e-enrich-youtube')
			 ON CONFLICT (id) DO NOTHING`,
		);
		await c.query(
			`INSERT INTO lumen.transcripts (episode_id, seq, t_start_s, t_end_s, speaker, text)
			 VALUES ('e2e-enrich-ep', 7, 42, 48, '0', 'The claim under review is spoken right here.')
			 ON CONFLICT DO NOTHING`,
		);
		await c.query(
			`INSERT INTO lumen.edges (from_id, to_id, rel_type, collection_id, metadata, source)
			 VALUES ('e2e-enrich-ep', 'faith', 'TEACHES', 'e2e-enrich',
			   $1::jsonb, 'e2e-enrich-extraction')
			 ON CONFLICT (from_id, to_id, rel_type, collection_id) DO UPDATE SET metadata = EXCLUDED.metadata`,
			[JSON.stringify({ source: "extraction", confidence: 0.71, mentions: [{ t: 42, seq: 7, confidence: 0.71 }] })],
		);
		await c.end();
		seeded = true;
	});

	test.afterAll(async () => {
		const dsn = process.env.DATABASE_URL;
		if (dsn && seeded) {
			const c = new pg.Client({ connectionString: dsn });
			await c.connect();
			// reviews first — the collection FK holds them
			await c.query(`DELETE FROM lumen.enrichment_reviews WHERE collection_id = 'e2e-enrich'`);
			await c.query(`DELETE FROM lumen.edges WHERE collection_id = 'e2e-enrich'`);
			await c.query(`DELETE FROM lumen.transcripts WHERE episode_id = 'e2e-enrich-ep'`);
			await c.query(`DELETE FROM lumen.entities WHERE id = 'e2e-enrich-ep'`);
			await c.query(`DELETE FROM lumen.collections WHERE id = 'e2e-enrich'`);
			await c.end();
		}
		await admin?.cleanup();
		await plain?.cleanup();
	});

	test("a signed-in non-admin gets 404, not the queue", async ({ page, context }) => {
		await plain.install(context);
		const res = await page.goto("/admin/enrichment");
		expect(res?.status()).toBe(404);
		await expect(page.locator("body")).not.toContainText("Enrichment review");
	});

	test("an admin reviews a claim and the decision survives a reload", async ({ page, context }) => {
		await admin.install(context);
		const res = await page.goto("/admin/enrichment?collection=e2e-enrich");
		expect(res?.status()).toBe(200);
		await page.waitForSelector("html[data-hydrated]");
		await expect(page.getByRole("heading", { name: "Enrichment review" })).toBeVisible();

		// the claim renders with its evidence — a review without the quote is
		// just a confident guess
		await expect(page.locator("body")).toContainText("The claim under review is spoken right here.");
		await expect(page.locator("body")).toContainText("confidence 0.71");

		await page.getByRole("button", { name: "Accept" }).first().click();
		await expect(page.getByRole("button", { name: "✓ Accepted" })).toBeVisible();

		// prove the WRITE first — the button above can be optimistic, the
		// database cannot be
		await expect
			.poll(
				async () => {
					const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
					await c.connect();
					const { rows } = await c.query(
						`SELECT status FROM lumen.enrichment_reviews
						 WHERE from_id = 'e2e-enrich-ep' AND to_id = 'faith' AND mention_seq = 7`,
					);
					await c.end();
					return rows[0]?.status ?? null;
				},
				{ timeout: 10_000 },
			)
			.toBe("accepted");

		// THEN the point of the table: reload and it is still accepted
		await page.reload();
		await page.waitForSelector("html[data-hydrated]");
		await expect(page.getByRole("button", { name: "✓ Accepted" })).toBeVisible();

		// undo returns it to pending — absence IS the pending state
		await page.getByRole("button", { name: "✓ Accepted" }).click();
		await expect(page.getByRole("button", { name: "Accept" }).first()).toBeVisible();
	});
});
