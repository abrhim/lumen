import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "../../packages/scripture/src/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
});
