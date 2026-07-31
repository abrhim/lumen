import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * personal-notes B9/CP-10: the manifest alone is a proven false-negative
 * oracle. Vite names shared split chunks `_<name>-<hash>.js`, so a guarded
 * route can statically pull markdown-it + prosemirror through a chunk whose
 * manifest KEY and `file` match nothing forbidden — measured at 63 KB gz
 * inside search.tsx's static closure while the checker printed
 * "editor-free static closure" and exited 0.
 *
 * Emit the ground truth the manifest omits: every output chunk mapped to the
 * module ids it actually contains. scripts/check-notes-bundle.mjs walks the
 * manifest's static-import closure and then asserts at MODULE granularity
 * over this map. Build-only, additive, and written next to the manifest it
 * complements (`build/client/.vite/chunk-modules.json`).
 */
function chunkModulesManifest(): Plugin {
	let root = process.cwd();
	return {
		name: "lumen-chunk-modules-manifest",
		apply: "build",
		configResolved(config) {
			root = config.root;
		},
		generateBundle(_options, bundle) {
			const map: Record<string, string[]> = {};
			for (const [fileName, output] of Object.entries(bundle)) {
				if (output.type !== "chunk") continue;
				map[fileName] = Object.keys(output.modules).map((id) =>
					id.startsWith(`${root}/`) ? id.slice(root.length + 1) : id,
				);
			}
			this.emitFile({
				type: "asset",
				fileName: ".vite/chunk-modules.json",
				source: JSON.stringify(map, null, "\t"),
			});
		},
	};
}

export default defineConfig({
	// personal-notes A11 (CF-15): the client manifest is the F10 bundle-
	// isolation oracle — scripts/check-notes-bundle.mjs walks its static-
	// import closure post-build, resolving each reached chunk to its modules
	// through the companion map emitted above (B9).
	build: { manifest: true },
	plugins: [
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		tailwindcss(),
		reactRouter(),
		tsconfigPaths(),
		chunkModulesManifest(),
	],
});
