import { test, expect } from "@playwright/test";
import { createE2eUser, type E2eUser } from "./support/session";

/**
 * B1 repro (CP-1 cluster, critical) — the G5 autosave contract:
 *  - the 3s debounce is IDLE-based: it resets on every keystroke, so no
 *    save fires while the writer keeps typing with sub-3s gaps
 *  - keystrokes made while a save is in flight stay dirty and trigger a
 *    follow-up save — the buffer can never be marked clean unseen
 */

let user: E2eUser;

test.beforeAll(async () => {
	user = await createE2eUser("autosave");
});
test.afterAll(async () => {
	await user?.cleanup();
});

test.beforeEach(async ({ context }) => {
	await user.install(context);
});

test("debounce is idle-based: continuous typing defers the save; idle lands exactly one", async ({
	page,
}) => {
	const { data: note } = await user.client
		.schema("lumen")
		.rpc("create_note_with_anchors", { p_body_md: "Idle probe.\n", p_anchors: [] })
		.single();
	const id = (note as { id: string }).id;

	const saves: number[] = [];
	page.on("request", (req) => {
		if (req.method() === "POST" && req.url().includes(`/notes/${id}`)) {
			saves.push(Date.now());
		}
	});

	await page.goto(`/notes/${id}`);
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	const editor = page.locator(".note-editor");
	await editor.click();

	// type with ~1.2s gaps for ~4.8s — every gap is under the 3s idle bar,
	// so a correct idle debounce fires NOTHING in this window
	const typingStart = Date.now();
	for (const word of [" alpha", " beta", " gamma", " delta"]) {
		await page.keyboard.type(word, { delay: 30 });
		await page.waitForTimeout(1200);
	}
	const savesDuringTyping = saves.filter((t) => t < typingStart + 4500).length;
	expect(savesDuringTyping).toBe(0);

	// now go idle: exactly one save lands
	await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 8000 });
	expect(saves.length).toBe(1);
});

test("keystrokes during an in-flight save stay dirty and are saved by a follow-up", async ({
	page,
}) => {
	const { data: note } = await user.client
		.schema("lumen")
		.rpc("create_note_with_anchors", { p_body_md: "Inflight probe.\n", p_anchors: [] })
		.single();
	const id = (note as { id: string }).id;

	// slow the update action so we can type mid-flight
	await page.route(`**/notes/${id}.data`, async (route) => {
		await new Promise((r) => setTimeout(r, 1500));
		await route.continue();
	});

	await page.goto(`/notes/${id}`);
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	const editor = page.locator(".note-editor");
	await editor.click();
	await page.keyboard.type(" first");

	// force an immediate save (⌘S), then type while it's in flight
	await page.keyboard.press("ControlOrMeta+s");
	await page.waitForTimeout(300);
	await page.keyboard.type(" second");

	// the buffer must NOT read Saved while "second" is unsaved; a follow-up
	// save must land it — poll the DB for the full text
	await expect
		.poll(
			async () => {
				const { data } = await user.client
					.schema("lumen")
					.from("notes")
					.select("body_md")
					.eq("id", id)
					.single();
				return data?.body_md ?? "";
			},
			{ timeout: 15000 },
		)
		.toContain("first second");
});

test("a 409 offers Keep mine / Load theirs — never a wedge, never a destroyed buffer", async ({
	page,
}) => {
	const { data: note } = await user.client
		.schema("lumen")
		.rpc("create_note_with_anchors", { p_body_md: "Fork probe.\n", p_anchors: [] })
		.single();
	const id = (note as { id: string }).id;

	await page.goto(`/notes/${id}`);
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	const editor = page.locator(".note-editor");
	await editor.click();

	// another writer (same user, other tab) bumps the row under us
	await user.client
		.schema("lumen")
		.from("notes")
		.update({ body_md: "Fork probe — other tab.\n" })
		.eq("id", id);

	// our stale-base save must surface the fork, not silently clobber or wedge
	await page.keyboard.type(" mine");
	await page.keyboard.press("ControlOrMeta+s");
	await expect(page.getByText("Changed elsewhere", { exact: true })).toBeVisible();

	// Keep mine: LWW — this editor becomes the last writer and un-wedges
	await page.getByRole("button", { name: "Keep mine" }).click();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 8000 });
	await expect
		.poll(async () => {
			const { data } = await user.client
				.schema("lumen")
				.from("notes")
				.select("body_md")
				.eq("id", id)
				.single();
			return data?.body_md ?? "";
		})
		.toContain("mine");
});
