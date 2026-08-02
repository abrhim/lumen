import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * /admin/users RENDERS (2026-08-02).
 *
 * This page shipped 2026-07-10 and had never once rendered successfully: the
 * entitlement gate 404'd everyone while lumen.user_roles was empty, so the
 * first real admin found a 500. Thirty-six unit tests passed throughout,
 * because they drive the loader with a hand-made fixture — `roles: []`, a JS
 * array the driver never actually produces. With fetch_types:false postgres.js
 * returns a text[] as the STRING '{admin}', and typecheck cannot see it: the
 * query result crosses the boundary through `as unknown as`, which is an
 * assertion, not a check.
 *
 * So the guard has to be a real render against real data. That is this file.
 */

const pg = createRequire(import.meta.url)("pg");

test.describe("admin users page", () => {
	let admin: E2eUser;
	let plain: E2eUser;

	test.beforeAll(async () => {
		admin = await createE2eUser("admin-render");
		plain = await createE2eUser("admin-plain");
		// grant through SQL: service_role holds no DML on lumen.user_roles, and
		// granting it any would widen the API surface for a test's convenience
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
		await c.end();
	});

	test.afterAll(async () => {
		await admin?.cleanup();
		await plain?.cleanup();
	});

	test("an admin sees the list, and the roles column survives the driver", async ({
		page,
		context,
	}) => {
		await admin.install(context);
		const res = await page.goto("/admin/users");
		expect(res?.status()).toBe(200);
		await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
		// text presence, not visibility: the page renders desktop and mobile
		// variants of each row and CSS hides one of them
		const body = page.locator("body");
		await expect(body).toContainText(admin.email);
		// the roles column itself — a role-bearing row and a roleless one, the
		// two branches that both crashed when roles arrived as a string
		await expect(page.locator("text=/^admin$/").first()).toHaveCount(1);
		await expect(body).toContainText(plain.email);
		await expect(body).not.toContainText("Couldn't load users");
		// the tell for the regression: Postgres's array literal reaching the DOM
		await expect(body).not.toContainText("{}");
		await expect(body).not.toContainText("{admin}");
	});

	test("a signed-in NON-admin gets the 404, not the list", async ({ page, context }) => {
		await plain.install(context);
		const res = await page.goto("/admin/users");
		expect(res?.status()).toBe(404);
		await expect(page.locator("body")).not.toContainText(admin.email);
	});
});
