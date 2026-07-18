// Migration (unshaken-ingest A1): lumen.transcripts + lumen.search_index +
// admin.collections role grant. House style: exported DDL (canon-spine
// lesson — testable, not inline), DRY_RUN default, invariant checks, scrub.
//   node --import tsx scripts/migrate-media-collections.mjs            # dry-run
//   COMMIT=1 node --import tsx scripts/migrate-media-collections.mjs  # apply
// Exit 0 success/clean, 1 fatal, 2 invariant failure.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scrubSecrets } from './ingest-podcast/util.mjs';

// Design doc §Schema, verbatim. Partial unique index per COR-1: the blanket
// index would abort on 1,578 live phase-b duplicate edge tuples.
export const MEDIA_DDL = `
CREATE TABLE IF NOT EXISTS lumen.transcripts (
  episode_id    text NOT NULL REFERENCES lumen.entities(id) ON DELETE CASCADE,
  seq           int  NOT NULL,
  t_start_s     numeric(9,3) NOT NULL,
  t_end_s       numeric(9,3),
  speaker       text,
  text          text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
  PRIMARY KEY (episode_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_transcripts_search ON lumen.transcripts USING gin (search_vector);

CREATE TABLE IF NOT EXISTS lumen.search_index (
  kind          text NOT NULL,
  ref_id        text NOT NULL,
  collection_id text REFERENCES lumen.collections(id),
  title         text NOT NULL,
  tsv           tsvector NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (kind, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_search_tsv  ON lumen.search_index USING gin (tsv);
CREATE INDEX IF NOT EXISTS idx_search_coll ON lumen.search_index (collection_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unshaken_unique
  ON lumen.edges (from_id, to_id, rel_type) WHERE collection_id = 'unshaken';
`;

// SEC-4: scoped to the admin role. B8/⊇ rule: append, never replace;
// idempotent via the containment guard.
export const ROLE_GRANT_SQL = `
UPDATE lumen.roles
SET entitlements = array_append(entitlements, 'admin.collections')
WHERE slug = 'admin'
  AND NOT (entitlements @> ARRAY['admin.collections']);
`;

const INVARIANTS = [
	{
		name: 'transcripts_table_exists',
		sql: `SELECT to_regclass('lumen.transcripts') IS NOT NULL AS pass`,
	},
	{
		name: 'search_index_table_exists',
		sql: `SELECT to_regclass('lumen.search_index') IS NOT NULL AS pass`,
	},
	{
		name: 'transcripts_fk_cascades',
		sql: `SELECT EXISTS (
      SELECT 1 FROM information_schema.referential_constraints
      WHERE constraint_schema = 'lumen' AND delete_rule = 'CASCADE'
        AND constraint_name LIKE 'transcripts%'
    ) AS pass`,
	},
	{
		name: 'edges_partial_unique_present',
		sql: `SELECT EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname = 'lumen'
        AND indexname = 'idx_edges_unshaken_unique'
    ) AS pass`,
	},
	{
		name: 'admin_role_has_collections_key',
		sql: `SELECT EXISTS (
      SELECT 1 FROM lumen.roles WHERE slug = 'admin'
        AND entitlements @> ARRAY['admin.collections']
    ) AS pass`,
	},
	{
		name: 'admin_role_keeps_users_key',
		sql: `SELECT EXISTS (
      SELECT 1 FROM lumen.roles WHERE slug = 'admin'
        AND entitlements @> ARRAY['admin.users']
    ) AS pass`,
	},
];

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
		await sql.begin(async (tx) => {
			await tx.unsafe(MEDIA_DDL);
			await tx.unsafe(ROLE_GRANT_SQL);
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

	// invariants run outside the tx: post-commit they verify reality; after a
	// dry-run the table checks are expected to fail — report, don't judge.
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
	if (commit && failures > 0) process.exit(2);
	console.log(JSON.stringify({ event: 'migration_done', commit, invariant_failures: failures }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
