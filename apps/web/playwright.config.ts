import { defineConfig, devices } from "@playwright/test";

/**
 * personal-notes Q1 — the e2e layer (harness gaps 41–53). Runs against the
 * Vite dev server (live dev DB through the same Hyperdrive DSN the app
 * uses); specs create throwaway confirmed users per file and delete them
 * after (their notes cascade). Never touches real user rows.
 */
export default defineConfig({
	testDir: "./e2e",
	// pool hygiene: terminate zombie idle lumen_read sessions before the run
	// (dev-server kills leak them; cap 15 — see support/global-setup.ts)
	globalSetup: "./e2e/support/global-setup.ts",
	fullyParallel: false,
	workers: 1, // shared dev DB + session-pool cap 15 — never fan out
	timeout: 30_000,
	retries: process.env.CI ? 1 : 0,
	reporter: [["list"]],
	use: {
		// dedicated port — 5173 may belong to other projects' dev servers
		baseURL: "http://localhost:4179",
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "desktop",
			use: { ...devices["Desktop Chrome"] },
			testIgnore: /.*\.mobile\.spec\.ts/,
		},
		{
			name: "mobile",
			// iOS profile via CDP emulation on Chromium (house memory: CDP
			// emulation, never window-size crops). Real-WebKit + physical
			// device passes remain the manual Q6 checklist.
			use: { ...devices["iPhone 13"], browserName: "chromium" },
			testMatch: /.*\.mobile\.spec\.ts/,
		},
	],
	webServer: {
		command: "pnpm dev --port 4179",
		url: "http://localhost:4179",
		reuseExistingServer: true,
		timeout: 90_000,
	},
});
