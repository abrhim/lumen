// Migration M1 (search-endpoint): pg_trgm + unaccent into the `extensions`
// schema, app-role grants, and trgm GIN indexes on entity/search_index names.
// House style: exported DDL, COMMIT=1 apply-gate (dry-run default), invariant
// checks (including AS THE APP ROLE — SEC-2/BLA-8: the admin DSN passing is
// not evidence the deployed Worker can execute extension operators), scrub.
//   node --import tsx scripts/migrate-search-extensions.mjs            # dry-run
//   COMMIT=1 node --import tsx scripts/migrate-search-extensions.mjs   # apply
// Exit 0 success/clean, 1 fatal, 2 invariant failure.
// Rollback: DROP INDEX lumen.idx_entities_name_trgm, lumen.idx_search_title_trgm;
// then DROP EXTENSION pg_trgm/unaccent — but ONLY after the M5 worker deploy is
// rolled back (plan.md Stage order: reverse-order rule; DROP EXTENSION CASCADE
// would take the indexes with it and a deployed searchAll would hard-error).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scrubSecrets } from './ingest-podcast/util.mjs';

// SEC-2: explicit schema placement — Supabase's `extensions` schema, where the
// app role is then granted USAGE + EXECUTE (probed: it has neither today, and
// the public-schema function default-ACL also omits lumen_read).
export const EXTENSIONS_DDL = `
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO lumen_read;
GRANT EXECUTE ON FUNCTION
  extensions.word_similarity(text, text),
  extensions.word_similarity_op(text, text),
  extensions.word_similarity_commutator_op(text, text),
  extensions.similarity(text, text),
  extensions.similarity_op(text, text),
  extensions.unaccent(text)
TO lumen_read;
`;

// PER-1/A1: these serve the OPERATOR(extensions.%) index prefilter (default
// threshold 0.3); `extensions.word_similarity(q, name) >= 0.45` refines on the
// prefiltered rows. Never write the bare function form WITHOUT the `%`
// prefilter in queries — it cannot use these indexes.
export const TRGM_INDEX_DDL = `
CREATE INDEX IF NOT EXISTS idx_entities_name_trgm
  ON lumen.entities USING gin (name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_title_trgm
  ON lumen.search_index USING gin (title extensions.gin_trgm_ops);
`;

const PRECHECKS = [
	{
		name: 'pg_trgm_available',
		sql: `SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') AS pass`,
	},
	{
		name: 'unaccent_available',
		sql: `SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'unaccent') AS pass`,
	},
	{
		name: 'extensions_schema_exists',
		sql: `SELECT to_regnamespace('extensions') IS NOT NULL AS pass`,
	},
];

const INVARIANTS = [
	{
		name: 'pg_trgm_installed',
		sql: `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS pass`,
	},
	{
		name: 'unaccent_installed',
		sql: `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'unaccent') AS pass`,
	},
	{
		name: 'lumen_read_has_extensions_usage',
		sql: `SELECT has_schema_privilege('lumen_read', 'extensions', 'USAGE') AS pass`,
	},
	{
		name: 'lumen_read_can_execute_word_similarity',
		sql: `SELECT has_function_privilege('lumen_read',
	    'extensions.word_similarity(text, text)', 'EXECUTE') AS pass`,
	},
	{
		name: 'lumen_read_can_execute_unaccent',
		sql: `SELECT has_function_privilege('lumen_read',
	    'extensions.unaccent(text)', 'EXECUTE') AS pass`,
	},
	{
		name: 'entities_name_trgm_index_present',
		sql: `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'lumen'
	    AND indexname = 'idx_entities_name_trgm') AS pass`,
	},
	{
		name: 'search_title_trgm_index_present',
		sql: `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'lumen'
	    AND indexname = 'idx_search_title_trgm') AS pass`,
	},
];

function loadDsn(root, file, key) {
	const p = join(root, file);
	if (!existsSync(p)) throw new Error(`${file} required`);
	const url = readFileSync(p, 'utf8').match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim();
	if (!url) throw new Error(`${key} not found in ${file}`);
	return url;
}

async function main() {
	const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
	const commit = process.env.COMMIT === '1';
	const require = createRequire(import.meta.url);
	const postgres = require('postgres');
	let sql;
	try {
		sql = postgres(loadDsn(ROOT, '.env', 'DATABASE_URL'), { prepare: false, max: 1 });
	} catch (err) {
		console.error('FATAL:', scrubSecrets(err.message));
		process.exit(1);
	}

	// Prechecks gate any write (DAT-8 ordering discipline).
	for (const pre of PRECHECKS) {
		const rows = await sql.unsafe(pre.sql);
		const pass = rows[0]?.pass === true;
		console.log(JSON.stringify({ event: 'precheck', name: pre.name, pass }));
		if (!pass) {
			await sql.end();
			process.exit(2);
		}
	}

	try {
		await sql.begin(async (tx) => {
			await tx.unsafe(EXTENSIONS_DDL);
			await tx.unsafe(TRGM_INDEX_DDL);
			if (!commit) throw new Error('DRY_RUN_ROLLBACK');
		});
		console.log(JSON.stringify({ event: 'migration_applied', commit: true }));
	} catch (err) {
		if (err.message === 'DRY_RUN_ROLLBACK') {
			console.log(JSON.stringify({ event: 'migration_dry_run_ok', commit: false }));
		} else {
			console.error('FATAL:', scrubSecrets(err.message));
			await sql.end();
			process.exit(1);
		}
	}

	let failures = 0;
	for (const inv of INVARIANTS) {
		try {
			const rows = await sql.unsafe(inv.sql);
			const pass = rows[0]?.pass === true;
			console.log(JSON.stringify({ event: 'invariant_check', name: inv.name, pass }));
			if (!pass) failures += 1;
		} catch (err) {
			console.log(
				JSON.stringify({ event: 'invariant_check', name: inv.name, pass: false, error: scrubSecrets(err.message) }),
			);
			failures += 1;
		}
	}
	await sql.end();

	// BLA-8: functional check AS THE APP ROLE via the lumen_read DSN — proves
	// the deployed Worker's exact privilege path, not the admin's.
	if (commit && failures === 0) {
		let appSql;
		try {
			appSql = postgres(
				loadDsn(ROOT, 'apps/web/.env', 'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE'),
				{ prepare: false, max: 1 },
			);
			// A1 production predicate form, arg order exactly as search.ts
			// issues it (DATC-6): `%` prefilter + word_similarity refine — the
			// pre-A1 form (set_config GUC + `<%`) proved a privilege path the
			// deployed Worker never exercises.
			const probe = await appSql`
				SELECT ('melchisedek' OPERATOR(extensions.%) 'melchizedek'
				        AND extensions.word_similarity('melchisedek', 'melchizedek') >= 0.45) AS hit,
				       extensions.unaccent('agapē') AS plain`;
			const pass = probe[0]?.hit === true && probe[0]?.plain === 'agape';
			console.log(JSON.stringify({ event: 'invariant_check', name: 'app_role_functional_probe', pass }));
			if (!pass) failures += 1;
			await appSql.end();
		} catch (err) {
			console.log(
				JSON.stringify({ event: 'invariant_check', name: 'app_role_functional_probe', pass: false, error: scrubSecrets(err.message) }),
			);
			failures += 1;
			if (appSql) await appSql.end();
		}
	}

	if (commit && failures > 0) process.exit(2);
	console.log(JSON.stringify({ event: 'migration_done', commit, invariant_failures: failures }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
