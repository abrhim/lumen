import { test } from "@playwright/test";
import { createE2eUser, type E2eUser } from "./support/session";
let user: E2eUser;
test.beforeAll(async () => { user = await createE2eUser("rmprobe"); });
test.afterAll(async () => { await user?.cleanup(); });
test.beforeEach(async ({ context }) => { await user.install(context); });
test("probe", async ({ page }) => {
	page.on("console", (m) => { if (m.type() === "error") console.log("PAGEERR:", m.text().slice(0, 300)); });
	page.on("response", async (r) => {
		if (r.status() >= 500) console.log("R500:", r.request().method(), r.url().slice(0, 120), (await r.text().catch(() => "")).slice(0, 300));
	});
	page.on("pageerror", (e) => console.log("PAGEEXC:", String(e).slice(0, 300)));
	await page.goto("/roadmap");
	await page.waitForTimeout(1500);
	const b = page.getByRole("button", { name: /press to add yours/ }).first();
	await b.click();
	await page.waitForTimeout(1200);
	console.log("LABEL:", await b.getAttribute("aria-label"));
	page.on("response", () => {});
});
