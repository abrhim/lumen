#!/usr/bin/env node
/**
 * personal-notes A11 (CF-15) — F10's bundle-isolation mechanism.
 *
 * Walks the client build manifest's STATIC-import closure from the app
 * entry + the reader/search/notes route modules and asserts that no MODULE
 * reached that way matches /prosemirror|markdown-it|components\/editor/.
 * The editor is reachable ONLY through a dynamic import (React.lazy behind
 * edit intent) — reading a note must never load ProseMirror.
 *
 * B9/CP-10 — why this reads two files. Testing manifest KEYS and chunk
 * `file` names is a demonstrated false negative: Vite names shared split
 * chunks `_<name>-<hash>.js`, so a single
 * `import { sanitizeWikilinkLabel } from "~/components/editor/markdown"`
 * in search.tsx shipped `_markdown-<hash>.js` (161 KB raw / 63 KB gz of
 * markdown-it + prosemirror-model + prosemirror-markdown) inside a guarded
 * static closure while this script printed "editor-free" and exited 0.
 * The vite.config.ts `lumen-chunk-modules-manifest` plugin emits
 * `.vite/chunk-modules.json` (chunk fileName → module ids) next to the
 * manifest; every reached chunk is now resolved to its real contents.
 *
 * Positive controls: (1) the editor modules must appear SOMEWHERE in the
 * chunk map — otherwise a renamed directory greens this test forever;
 * (2) an editor chunk must exist under someone's `dynamicImports`.
 * A missing manifest or chunk map is a FAILURE, never a skip.
 *
 * Run after `pnpm --filter @lumen/web build`:
 *   node scripts/check-notes-bundle.mjs
 *   node scripts/check-notes-bundle.mjs --self-test   # oracle negative control
 * Exit 0 clean; 1 violation / missing input / failed self-test.
 *
 * NEGATIVE CONTROL (run it before trusting a green run after any change to
 * this script or to the emitting plugin). `--self-test` is the cheap, always
 * available form. The full end-to-end form, verified 2026-07-30, needs no
 * route-file edit — add a temporary `enforce: "pre"` plugin to
 * apps/web/vite.config.ts that prepends
 *   import { sanitizeWikilinkLabel } from "~/components/editor/markdown";
 * to `routes/search.tsx` (reference the binding so it survives tree-shaking),
 * rebuild, and run this script: it must FAIL on search.tsx with ~55 module
 * ids inside `assets/markdown-<hash>.js`. Every violation in that run is
 * module-level — the chunk's manifest key and file name match nothing
 * forbidden, which is precisely the false negative CP-10 measured. Remove the
 * temporary plugin and rebuild to return to green.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'apps/web/build/client/.vite/manifest.json');
const CHUNK_MODULES = join(ROOT, 'apps/web/build/client/.vite/chunk-modules.json');

const FORBIDDEN = /prosemirror|markdown-it|components\/editor/;
// static graphs that must stay editor-free (A11): the app shell + the
// reader, search, and notes route modules themselves
const GUARDED_SOURCES = [
	// RR7 suffixes client route modules with ?__react-router-build-client-route
	/root\.tsx(\?|$)/,
	/routes\/scripture\.tsx(\?|$)/,
	/routes\/search\.tsx(\?|$)/,
	/routes\/notes\.tsx(\?|$)/,
	/routes\/notes\.\$id\.tsx(\?|$)/,
];

/** Static-import closure over manifest keys (never `dynamicImports`). */
function reachedKeys(manifest, entry) {
	const reached = new Set();
	const stack = [entry];
	while (stack.length > 0) {
		const key = stack.pop();
		if (reached.has(key)) continue;
		reached.add(key);
		for (const imp of manifest[key]?.imports ?? []) stack.push(imp);
	}
	return reached;
}

/**
 * The oracle. `mode: 'legacy'` reproduces the pre-B9 key/file-only rule and
 * exists solely so --self-test can prove the false negative is closed.
 */
function scanEntry(manifest, chunkModules, entry, mode = 'modules') {
	const reached = reachedKeys(manifest, entry);
	const bad = new Set();
	for (const key of reached) {
		if (FORBIDDEN.test(key)) bad.add(`${key} (manifest key)`);
		const file = manifest[key]?.file;
		if (file && FORBIDDEN.test(file)) bad.add(`${file} (chunk name)`);
		if (mode === 'legacy' || !file) continue;
		for (const id of chunkModules[file] ?? []) {
			if (FORBIDDEN.test(id)) bad.add(`${id} (module inside ${file})`);
		}
	}
	return { reached, bad: [...bad] };
}

/**
 * Negative control for the oracle itself (CP-10 mandates one). A synthetic
 * bundle where a guarded route statically reaches a NEUTRALLY NAMED shared
 * chunk that contains the editor modules — exactly the shape measured with
 * the real probe import. The walker must flag it, and the legacy key/file
 * rule must miss it; a dynamic-only reach must stay clean.
 */
function selfTest() {
	const entry = 'app/routes/search.tsx?__react-router-build-client-route';
	const staticLeak = {
		manifest: {
			[entry]: { file: 'assets/search-A1B2C3.js', imports: ['_shared-D4E5F6.js'] },
			'_shared-D4E5F6.js': { file: 'assets/_shared-D4E5F6.js', imports: [] },
		},
		chunkModules: {
			'assets/search-A1B2C3.js': ['app/routes/search.tsx'],
			'assets/_shared-D4E5F6.js': [
				'app/components/editor/markdown.ts',
				'../../node_modules/markdown-it/index.mjs',
				'../../node_modules/prosemirror-model/dist/index.js',
			],
		},
	};
	const dynamicOnly = {
		manifest: {
			[entry]: { file: 'assets/search-A1B2C3.js', imports: [], dynamicImports: ['_shared-D4E5F6.js'] },
			'_shared-D4E5F6.js': { file: 'assets/_shared-D4E5F6.js', imports: [] },
		},
		chunkModules: staticLeak.chunkModules,
	};

	let bad = 0;
	const leak = scanEntry(staticLeak.manifest, staticLeak.chunkModules, entry);
	if (leak.bad.length === 3) {
		console.log(`  ✓ self-test: module-granular walk flags the shared-chunk leak (${leak.bad.length} module ids)`);
	} else {
		bad += 1;
		console.error(`  ✗ self-test: shared-chunk leak NOT flagged (found ${leak.bad.length}: ${leak.bad.join(', ')})`);
	}

	const legacy = scanEntry(staticLeak.manifest, staticLeak.chunkModules, entry, 'legacy');
	if (legacy.bad.length === 0) {
		console.log('  ✓ self-test: the pre-B9 key/file-only rule misses it — the false negative is real and now closed');
	} else {
		bad += 1;
		console.error(`  ✗ self-test: legacy rule unexpectedly flagged ${legacy.bad.join(', ')} — fixture no longer models CP-10`);
	}

	const clean = scanEntry(dynamicOnly.manifest, dynamicOnly.chunkModules, entry);
	if (clean.bad.length === 0) {
		console.log('  ✓ self-test: a dynamic-only reach to the same chunk stays clean (no false positive)');
	} else {
		bad += 1;
		console.error(`  ✗ self-test: dynamic-only reach falsely flagged ${clean.bad.join(', ')}`);
	}

	if (bad > 0) {
		console.error(`check-notes-bundle --self-test: FAIL (${bad})`);
		process.exit(1);
	}
	console.log('check-notes-bundle --self-test: PASS');
	process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

for (const [label, path] of [['client manifest', MANIFEST], ['chunk-modules map', CHUNK_MODULES]]) {
	if (!existsSync(path)) {
		console.error(
			`check-notes-bundle: FAIL — ${label} missing (build with build.manifest:true and the lumen-chunk-modules-manifest plugin first)`,
		);
		process.exit(1);
	}
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const chunkModules = JSON.parse(readFileSync(CHUNK_MODULES, 'utf8'));

const keys = Object.keys(manifest);
const entryKeys = keys.filter((k) => GUARDED_SOURCES.some((re) => re.test(k)));
if (entryKeys.length < GUARDED_SOURCES.length) {
	console.error(
		`check-notes-bundle: FAIL — expected ${GUARDED_SOURCES.length} guarded route modules in the manifest, found ${entryKeys.length} (${entryKeys.join(', ')})`,
	);
	process.exit(1);
}

let failures = 0;

for (const entry of entryKeys) {
	const { reached, bad } = scanEntry(manifest, chunkModules, entry);
	const moduleCount = [...reached].reduce(
		(n, k) => n + (chunkModules[manifest[k]?.file]?.length ?? 0),
		0,
	);
	if (bad.length > 0) {
		failures += 1;
		// a single leaked barrel drags in ~50 module ids — head the list
		const shown = bad.slice(0, 8);
		const more = bad.length - shown.length;
		console.error(
			`  ✗ ${entry} statically reaches ${bad.length} forbidden module(s):\n      ${shown.join('\n      ')}${more > 0 ? `\n      …and ${more} more` : ''}`,
		);
	} else {
		console.log(`  ✓ ${entry} — editor-free static closure (${reached.size} chunks / ${moduleCount} modules)`);
	}
}

// positive control 1 (B9): the editor modules must be findable in the chunk
// map at all — a renamed directory or a plugin that stopped emitting would
// otherwise green every assertion above forever.
const mappedEditorChunks = Object.entries(chunkModules).filter(([, ids]) => ids.some((id) => FORBIDDEN.test(id)));
if (mappedEditorChunks.length === 0) {
	failures += 1;
	console.error('  ✗ positive control: no chunk in chunk-modules.json contains an editor/prosemirror module — the guard is testing nothing');
} else {
	console.log(`  ✓ positive control: editor modules present in the chunk map (${mappedEditorChunks.length} chunk(s))`);
}

// positive control 2: the editor chunk exists under someone's dynamicImports
const dynamicTargets = new Set(keys.flatMap((k) => manifest[k]?.dynamicImports ?? []));
const editorDynamic = [...dynamicTargets].some(
	(k) => FORBIDDEN.test(k) || (chunkModules[manifest[k]?.file] ?? []).some((id) => FORBIDDEN.test(id)),
);
if (!editorDynamic) {
	failures += 1;
	console.error('  ✗ positive control: no editor chunk found under dynamicImports — the guard is testing nothing');
} else {
	console.log('  ✓ positive control: editor chunk present under dynamicImports');
}

if (failures > 0) {
	console.error(`check-notes-bundle: FAIL (${failures})`);
	process.exit(1);
}
console.log('check-notes-bundle: PASS');
