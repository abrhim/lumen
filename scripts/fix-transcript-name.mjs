#!/usr/bin/env node
/**
 * Repair a proper noun that ASR consistently mangles, across lumen.transcripts.
 *
 *   node scripts/fix-transcript-name.mjs <key> [--commit]
 *
 * Whisper hears surnames phonetically and writes them differently every time.
 * The transcript is the reader-facing text on an episode page, so a guest whose
 * name is wrong in 26 episodes is wrong in public 26 times.
 *
 * Dry by default: prints every row it would change, with the exact edit, and
 * writes nothing until --commit.
 *
 * `lumen.transcripts.search_vector` is GENERATED ALWAYS (verified: attgenerated
 * = 's') and rejects any supplied value — updating `text` alone reindexes it.
 * Do not add it to the UPDATE. This is the trap CLAUDE.md warns about, and it
 * differs from lumen.verses, whose vector is trigger-maintained.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

/**
 * Each fix is a list of ordered [pattern, replacement] pairs. Order matters:
 * the full-name forms run first so a bare-surname rule cannot strip the
 * evidence a first name was also wrong.
 */
const FIXES = {
	woodmansee: {
		who: "Andrea Woodmansee",
		// A row qualifies if it matches this; keeps the scan honest and narrow.
		find: /\bwood\s?man(?:cy|sey|si)\b|\bandrew\s+wood\s?man\w*/i,
		rules: [
			// ASR reassigns her first name as well as her surname.
			[/\bAndrew\s+Wood\s?man(?:cy|sey|si|see)\b/gi, "Andrea Woodmansee"],
			[/\bAndrea\s+Wood\s?man(?:cy|sey|si)\b/gi, "Andrea Woodmansee"],
			// Bare surname, after both full-name forms have had their turn.
			[/\bWood\s?man(?:cy|sey|si)\b/gi, "Woodmansee"],
		],
	},
};

const [, , key] = process.argv;
const commit = process.argv.includes("--commit");
const fix = FIXES[key ?? ""];
if (!fix) {
	console.error(`usage: fix-transcript-name.mjs <${Object.keys(FIXES).join("|")}> [--commit]`);
	process.exit(2);
}

const dsn = readFileSync(new URL("../.env", import.meta.url), "utf8")
	.match(/^DATABASE_URL=(.*)$/m)?.[1]
	?.trim()
	.replace(/^["']|["']$/g, "");
if (!dsn) throw new Error("DATABASE_URL not found in repo-root .env");

/**
 * Some transcript segments arrive entirely lowercase and unpunctuated.
 * Capitalising one proper noun inside such a run is more conspicuous than the
 * misspelling was, so a match that carried no capital keeps none.
 */
const matchCase = (matched, replacement) =>
	/[A-Z]/.test(matched) ? replacement : replacement.toLowerCase();

const apply = (text) =>
	fix.rules.reduce((s, [re, to]) => s.replace(re, (m) => matchCase(m, to)), text);

const client = new pg.Client({ connectionString: dsn });
await client.connect();
try {
	const { rows } = await client.query(
		"SELECT episode_id, seq, text FROM lumen.transcripts ORDER BY episode_id, seq",
	);
	const changes = [];
	for (const r of rows) {
		if (!fix.find.test(r.text)) continue;
		const next = apply(r.text);
		if (next !== r.text) changes.push({ ...r, next });
	}

	console.log(`${fix.who}: ${changes.length} rows in ${new Set(changes.map((c) => c.episode_id)).size} episodes\n`);
	for (const c of changes) {
		// Print only the neighbourhood of each edit, so the diff stays readable.
		const before = c.text.match(/.{0,40}(?:wood\s?man\w*|andrew\s+wood\s?man\w*).{0,20}/i)?.[0] ?? "";
		const after = apply(before);
		console.log(`  ${c.episode_id} #${c.seq}`);
		console.log(`    - …${before.replace(/\s+/g, " ").trim()}…`);
		console.log(`    + …${after.replace(/\s+/g, " ").trim()}…`);
	}

	if (!commit) {
		console.log("\nDRY RUN. Re-run with --commit to write.");
		process.exit(0);
	}

	let written = 0;
	for (const c of changes) {
		// text only — search_vector is GENERATED ALWAYS and rebuilds itself.
		const res = await client.query(
			"UPDATE lumen.transcripts SET text = $3 WHERE episode_id = $1 AND seq = $2",
			[c.episode_id, c.seq, c.next],
		);
		written += res.rowCount;
	}
	const { rows: left } = await client.query(
		"SELECT count(*)::int AS n FROM lumen.transcripts WHERE text ~* $1",
		["wood\\s?man(cy|sey|si)"],
	);
	console.log(`\nWRITTEN ${written} rows. Misspellings remaining: ${left[0].n}`);
	if (left[0].n > 0) console.log("(some may be legitimately different words — inspect before re-running)");
} finally {
	await client.end();
}
