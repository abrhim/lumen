import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		include: ["app/**/__tests__/**/*.test.ts"],
		environment: "node",
		// Clear mock call history between tests; implementations are re-primed
		// in each file's beforeEach. Assertions are unchanged by this.
		clearMocks: true,
	},
});
