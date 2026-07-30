#!/usr/bin/env node
/**
 * personal-notes A11 (CF-15) — F10's bundle-isolation mechanism.
 *
 * Walks the client build manifest's STATIC-import closure from the app
 * entry + the reader/search/notes route modules and asserts no reached
 * module matches /prosemirror|markdown-it|components\/editor/. The editor
 * is reachable ONLY through a dynamic import (React.lazy behind edit
 * intent) — reading a note must never load ProseMirror.
 *
 * Positive control: the editor chunk must EXIST somewhere under
 * dynamicImports — otherwise a renamed directory greens this test forever.
 * A missing manifest is a FAILURE, never a skip (build.manifest: true is
 * part of the contract).
 *
 * Run after `pnpm --filter @lumen/web build`:
 *   node scripts/check-notes-bundle.mjs
 * Exit 0 clean; 1 violation/missing manifest.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'apps/web/build/client/.vite/manifest.json');

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

if (!existsSync(MANIFEST)) {
	console.error('check-notes-bundle: FAIL — client manifest missing (build with build.manifest:true first)');
	process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

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
	const reached = new Set();
	const stack = [entry];
	while (stack.length > 0) {
		const key = stack.pop();
		if (reached.has(key)) continue;
		reached.add(key);
		for (const imp of manifest[key]?.imports ?? []) stack.push(imp);
	}
	const bad = [...reached].filter((k) => FORBIDDEN.test(k) || FORBIDDEN.test(manifest[k]?.file ?? ''));
	if (bad.length > 0) {
		failures += 1;
		console.error(`  ✗ ${entry} statically reaches: ${bad.join(', ')}`);
	} else {
		console.log(`  ✓ ${entry} — editor-free static closure (${reached.size} modules)`);
	}
}

// positive control: the editor chunk exists under someone's dynamicImports
const dynamicTargets = new Set(keys.flatMap((k) => manifest[k]?.dynamicImports ?? []));
const editorDynamic = [...dynamicTargets].some((k) => FORBIDDEN.test(k));
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
