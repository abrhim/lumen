// One-time repair (unshaken-extraction A2, panel F1 + EV-A11): A1's executor
// pre-stringified jsonb values, leaving every unshaken edge/entity metadata
// as a jsonb STRING scalar. Unwrap loop until zero string rows remain.
//   node --import tsx scripts/repair-metadata-encoding.mjs            # dry-run
//   COMMIT=1 node --import tsx scripts/repair-metadata-encoding.mjs  # apply
// Exit 0 clean, 1 fatal, 2 invariant failure.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scrubSecrets } from './ingest-podcast/util.mjs';

const COLLECTION = 'unshaken';
const TABLES = ['edges', 'entities'];

export const STRING_ROWS_SQL = (table) => `
SELECT ctid::text AS row_ref, metadata #>> '{}' AS raw
FROM lumen.${table}
WHERE collection_id = '${COLLECTION}' AND jsonb_typeof(metadata) = 'string'`;

export const UNWRAP_SQL = (table) => `
UPDATE lumen.${table}
SET metadata = (metadata #>> '{}')::jsonb
WHERE collection_id = '${COLLECTION}' AND jsonb_typeof(metadata) = 'string'`;

async function main() {
	const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
	const commit = process.env.COMMIT === '1';
	let sql;
	try {
		const envPath = join(ROOT, '.env');
		if (!existsSync(envPath)) throw new Error('root .env with DATABASE_URL required');
		const url = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
		if (!url) throw new Error('DATABASE_URL not found in root .env');
		const require = createRequire(import.meta.url);
		const postgres = require('postgres');
		sql = postgres(url, { prepare: false, max: 1 });
	} catch (err) {
		console.error('FATAL:', scrubSecrets(err.message));
		process.exit(1);
	}

	try {
		// EV-A11 DRY_RUN validation: every string row must JSON.parse to an
		// OBJECT in JS before any UPDATE runs — non-JSON content would abort
		// the unwrap mid-migration; scalar/array content would ship garbage.
		let unparseable = 0;
		for (const table of TABLES) {
			const rows = await sql.unsafe(STRING_ROWS_SQL(table));
			let objects = 0;
			let doubleWrapped = 0;
			for (const r of rows) {
				// F10: validate to the INNERMOST layer — arrays are typeof
				// 'object' but unwrap to jsonb-array garbage, and double-wrapped
				// rows can hide non-object content one layer down.
				let inner = r.raw;
				let layers = 0;
				let parseFailed = false;
				while (typeof inner === 'string' && layers < 6) {
					try {
						inner = JSON.parse(inner);
					} catch {
						parseFailed = true;
						break;
					}
					layers += 1;
				}
				const isObject = !parseFailed && inner !== null && typeof inner === 'object' && !Array.isArray(inner);
				if (!isObject) {
					unparseable += 1;
					console.log(
						JSON.stringify({
							event: 'non_object_row',
							table,
							row_ref: r.row_ref,
							layers,
							inner_type: parseFailed ? 'unparseable' : Array.isArray(inner) ? 'array' : typeof inner,
						}),
					);
				} else if (layers > 1) doubleWrapped += 1;
				else objects += 1;
			}
			console.log(
				JSON.stringify({ event: 'dry_run_scan', table, string_rows: rows.length, objects, double_wrapped: doubleWrapped }),
			);
		}
		if (unparseable > 0) {
			console.error(`FATAL: ${unparseable} rows would not unwrap to objects — aborting before any write`);
			await sql.end();
			process.exit(1);
		}

		if (commit) {
			await sql.begin(async (tx) => {
				// unwrap LOOP: double-wrapped rows need one pass per layer
				for (let pass = 1; pass <= 5; pass += 1) {
					let touched = 0;
					for (const table of TABLES) {
						const res = await tx.unsafe(UNWRAP_SQL(table));
						touched += res.count;
					}
					console.log(JSON.stringify({ event: 'unwrap_pass', pass, touched }));
					if (touched === 0) break;
				}
				// in-migration invariant, not just later smoke
				for (const table of TABLES) {
					const [{ n }] = await tx.unsafe(
						`SELECT count(*)::int AS n FROM lumen.${table}
             WHERE collection_id = '${COLLECTION}' AND jsonb_typeof(metadata) = 'string'`,
					);
					if (Number(n) !== 0) throw new Error(`${table}: ${n} string rows remain after unwrap loop`);
				}
			});
			console.log(JSON.stringify({ event: 'repair_applied', commit: true }));
		} else {
			console.log(JSON.stringify({ event: 'repair_dry_run_ok', commit: false }));
		}

		// post-state report (works for both modes)
		let failures = 0;
		for (const table of TABLES) {
			const [{ n }] = await sql.unsafe(
				`SELECT count(*)::int AS n FROM lumen.${table}
         WHERE collection_id = '${COLLECTION}' AND jsonb_typeof(metadata) = 'string'`,
			);
			const pass = commit ? Number(n) === 0 : true;
			console.log(JSON.stringify({ event: 'invariant_check', name: `${table}_no_string_metadata`, pass, remaining: Number(n) }));
			if (!pass) failures += 1;
		}
		await sql.end();
		if (failures) process.exit(2);
	} catch (err) {
		console.error('FATAL:', scrubSecrets(err.message));
		await sql.end();
		process.exit(1);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
