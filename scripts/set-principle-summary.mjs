#!/usr/bin/env node
/**
 * Write a written summary onto a principle entity.
 *
 *   node scripts/set-principle-summary.mjs <entity-id> <file.md> [--commit]
 *
 * The one-line descriptions on principle entities came from `anthropic-batch`.
 * The written ones replace them in place — same column, so every surface that
 * already renders a description picks the new text up with no migration.
 *
 * Dry by default: it prints the before and after and changes nothing until
 * --commit. `lumen.entities.search_vector` is maintained by
 * trg_entities_search_vector (a BEFORE trigger, NOT a generated column), so the
 * update refreshes search on its own and must not supply a value.
 *
 * Paragraph breaks are meaningful — node.tsx and media.tsx split on a blank
 * line — so blank lines in the file survive and single newlines are joined.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const [, , entityId, filePath] = process.argv;
const commit = process.argv.includes("--commit");

if (!entityId || !filePath) {
	console.error("usage: set-principle-summary.mjs <entity-id> <file.md> [--commit]");
	process.exit(2);
}

const dsn = readFileSync(new URL("../.env", import.meta.url), "utf8")
	.match(/^DATABASE_URL=(.*)$/m)?.[1]
	?.trim()
	.replace(/^["']|["']$/g, "");
if (!dsn) throw new Error("DATABASE_URL not found in repo-root .env");

// Strip a leading markdown H1 and anything from a `---` rule onward: the
// deliverable files carry a title and a provenance footer that are for Abram,
// not for the column.
const raw = readFileSync(filePath, "utf8");
const body = raw
	.replace(/^#\s+.*$/m, "")
	.split(/^---\s*$/m)[0]
	.trim();

const summary = body
	.split(/\n{2,}/)
	.map((p) => p.split("\n").map((l) => l.trim()).join(" ").trim())
	.filter(Boolean)
	.join("\n\n");

if (!summary) throw new Error(`${filePath} produced an empty summary`);

const client = new pg.Client({ connectionString: dsn });
await client.connect();
try {
	const { rows } = await client.query(
		"SELECT id, name, entity_type, description FROM lumen.entities WHERE id = $1",
		[entityId],
	);
	if (!rows.length) throw new Error(`no entity ${entityId}`);
	const before = rows[0];
	if (before.entity_type !== "principle") {
		throw new Error(`${entityId} is a ${before.entity_type}, not a principle`);
	}

	console.log(`${before.name} (${before.id})\n`);
	console.log(`--- before (${before.description?.length ?? 0} chars) ---`);
	console.log(before.description ?? "(none)");
	console.log(`\n--- after (${summary.length} chars, ${summary.split(/\n{2,}/).length} paragraphs) ---`);
	console.log(summary);

	if (!commit) {
		console.log("\nDRY RUN. Re-run with --commit to write.");
		process.exit(0);
	}

	await client.query("UPDATE lumen.entities SET description = $2 WHERE id = $1", [
		entityId,
		summary,
	]);
	const { rows: after } = await client.query(
		"SELECT description, search_vector IS NOT NULL AS indexed FROM lumen.entities WHERE id = $1",
		[entityId],
	);
	if (after[0].description !== summary) throw new Error("readback mismatch — not written");
	console.log(`\nWRITTEN. search_vector rebuilt by trigger: ${after[0].indexed}`);
} finally {
	await client.end();
}
