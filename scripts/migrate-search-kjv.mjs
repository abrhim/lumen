// Migration M2 (search-endpoint): lumen.kjv_variants + lumen.kjv_delta() +
// trigger replacement (verses: delta-index; entities: setweight A/B + delta)
// + batched trigger-driven backfill. Plan decision 11 order: table → function
// → functiondef capture → trigger replace → backfill → invariants → ANALYZE.
//   node --import tsx scripts/migrate-search-kjv.mjs            # dry-run
//   COMMIT=1 node --import tsx scripts/migrate-search-kjv.mjs   # apply
// Exit 0 success/clean, 1 fatal, 2 invariant failure.
// Rollback (BLA-1): restore both trigger functions from
// setup-triggers-and-rls.sql (repo copy live-verified identical; defs also
// captured below into the run log) → DROP FUNCTION lumen.kjv_delta →
// DROP TABLE lumen.kjv_variants. Vector superset residue is harmless; a
// re-backfill via SET text=text/name=name restores pre-M2 vectors exactly.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scrubSecrets } from './ingest-podcast/util.mjs';

// DAT-5: PK + checks; chains resolved at JSON build (G4), re-asserted below.
export const KJV_DDL = `
CREATE TABLE IF NOT EXISTS lumen.kjv_variants (
  variant text PRIMARY KEY CHECK (variant = lower(variant) AND variant <> ''),
  modern  text NOT NULL CHECK (modern <> '' AND modern <> variant)
);

CREATE OR REPLACE FUNCTION lumen.kjv_delta(t text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(v.modern, ' '), '')
  FROM regexp_split_to_table(lower(coalesce(t, '')), '[^a-z]+') AS w(word)
  JOIN lumen.kjv_variants v ON v.variant = w.word
$$;
`;

// DAT-1: the trigger stays the single vector authority; backfill never writes
// search_vector directly. All concat legs coalesced (COR-1-wf: 1,630 in-group
// entities have NULL description; tsvector || is NULL-strict).
export const TRIGGER_DDL = `
CREATE OR REPLACE FUNCTION lumen.update_verse_search_vector() RETURNS trigger AS $fn$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.text, ''))
                    || to_tsvector('english', lumen.kjv_delta(NEW.text));
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION lumen.update_entity_search_vector() RETURNS trigger AS $fn$
BEGIN
  NEW.search_vector := setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A')
                    || setweight(to_tsvector('english',
                         coalesce(NEW.description, '') || ' ' || lumen.kjv_delta(NEW.description)), 'B');
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
`;

const BATCH = 5000;
const TOP10_QUERIES = ['faith', 'spake', 'believeth'];

// Floors pinned live 2026-07-21 pre-M2 (harness H2 mirrors these).
const INVARIANTS = [
	{ name: 'kjv_variants_populated', sql: `SELECT count(*) >= 400 AS pass FROM lumen.kjv_variants` },
	{
		name: 'kjv_variants_chain_free',
		sql: `SELECT NOT EXISTS (SELECT 1 FROM lumen.kjv_variants a
	    JOIN lumen.kjv_variants b ON a.modern = b.variant) AS pass`,
	},
	{
		name: 'verses_no_null_vectors',
		sql: `SELECT count(*) = 0 AS pass FROM lumen.verses WHERE search_vector IS NULL`,
	},
	{
		name: 'entities_no_null_vectors',
		sql: `SELECT count(*) = 0 AS pass FROM lumen.entities WHERE search_vector IS NULL`,
	},
	{
		name: 'verse_floor_believeth_59',
		sql: `SELECT count(*) >= 59 AS pass FROM lumen.verses
	    WHERE search_vector @@ plainto_tsquery('english', 'believeth')`,
	},
	{
		name: 'verse_floor_spake_782',
		sql: `SELECT count(*) >= 782 AS pass FROM lumen.verses
	    WHERE search_vector @@ plainto_tsquery('english', 'spake')`,
	},
	{
		name: 'verse_floor_faith_810',
		sql: `SELECT count(*) >= 810 AS pass FROM lumen.verses
	    WHERE search_vector @@ plainto_tsquery('english', 'faith')`,
	},
	{
		name: 'entity_floor_shepherd_233',
		sql: `SELECT count(*) >= 233 AS pass FROM lumen.entities
	    WHERE search_vector @@ plainto_tsquery('english', 'shepherd')`,
	},
	{
		name: 'entity_floor_jerusalem_1686',
		sql: `SELECT count(*) >= 1686 AS pass FROM lumen.entities
	    WHERE search_vector @@ plainto_tsquery('english', 'jerusalem')`,
	},
	{
		name: 'believe_reaches_john_3_16',
		sql: `SELECT EXISTS (SELECT 1 FROM lumen.verses
	    WHERE id = 'john-3-16' AND search_vector @@ plainto_tsquery('english', 'believe')) AS pass`,
	},
	{
		name: 'show_reaches_shew_verses_533',
		sql: `SELECT count(*) >= 533 AS pass FROM lumen.verses
	    WHERE search_vector @@ plainto_tsquery('english', 'show')`,
	},
	{
		name: 'entities_carry_weight_A',
		sql: `SELECT EXISTS (SELECT 1 FROM lumen.entities
	    WHERE id = 'melchizedek-1' AND search_vector::text LIKE '%A%') AS pass`,
	},
];

async function main() {
	const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
	const commit = process.env.COMMIT === '1';
	const require = createRequire(import.meta.url);
	const postgres = require('postgres');

	let variants;
	try {
		variants = JSON.parse(readFileSync(join(ROOT, 'data', 'kjv-variants.json'), 'utf8'));
		const bad = Object.entries(variants).filter(
			([v, m]) => v !== v.toLowerCase() || !m || m === v || m in variants,
		);
		if (bad.length) throw new Error(`kjv-variants.json fails constraints: ${bad.slice(0, 5).map(([v]) => v).join(', ')}`);
		console.log(JSON.stringify({ event: 'precheck', name: 'variants_json_valid', pass: true, count: Object.keys(variants).length }));
	} catch (err) {
		console.error('FATAL:', scrubSecrets(err.message));
		process.exit(1);
	}

	const url = readFileSync(join(ROOT, '.env'), 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
	const sql = postgres(url, { prepare: false, max: 1 });

	const top10 = async (label) => {
		for (const q of TOP10_QUERIES) {
			const rows = await sql`
				SELECT id FROM lumen.verses
				WHERE search_vector @@ plainto_tsquery('english', ${q})
				ORDER BY ts_rank(search_vector, plainto_tsquery('english', ${q})) DESC, id
				LIMIT 10`;
			console.log(JSON.stringify({ event: 'top10_capture', phase: label, q, ids: rows.map((r) => r.id) }));
		}
	};

	try {
		// BLA-1: capture current trigger function defs into the run log.
		const defs = await sql`
			SELECT p.proname, pg_get_functiondef(p.oid) AS def
			FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
			WHERE n.nspname = 'lumen' AND p.proname IN
			  ('update_verse_search_vector', 'update_entity_search_vector')`;
		for (const d of defs) {
			console.log(JSON.stringify({ event: 'functiondef_capture', name: d.proname, def: d.def }));
		}

		await top10('pre');

		const rows = Object.entries(variants).map(([variant, modern]) => ({ variant, modern }));
		await sql.begin(async (tx) => {
			await tx.unsafe(KJV_DDL);
			await tx`DELETE FROM lumen.kjv_variants`;
			for (let i = 0; i < rows.length; i += 1000) {
				await tx`INSERT INTO lumen.kjv_variants ${tx(rows.slice(i, i + 1000))}`;
			}
			await tx.unsafe(TRIGGER_DDL);
			if (!commit) {
				// Dry-run: smoke the trigger path on a 100-row sample, then roll back.
				await tx`UPDATE lumen.verses SET text = text
				  WHERE id IN (SELECT id FROM lumen.verses ORDER BY id LIMIT 100)`;
				const smoke = await tx`
					SELECT lumen.kjv_delta('he believeth and spake') AS delta,
					       (SELECT count(*)::int FROM lumen.verses
					        WHERE search_vector @@ plainto_tsquery('english','believe')
					          AND id IN (SELECT id FROM lumen.verses ORDER BY id LIMIT 100)) AS sample_hits`;
				console.log(JSON.stringify({ event: 'dry_run_smoke', delta: smoke[0].delta, sample_hits: smoke[0].sample_hits }));
				throw new Error('DRY_RUN_ROLLBACK');
			}
		});
		console.log(JSON.stringify({ event: 'migration_applied', stage: 'ddl+triggers', commit: true }));
	} catch (err) {
		if (err.message === 'DRY_RUN_ROLLBACK') {
			console.log(JSON.stringify({ event: 'migration_dry_run_ok', commit: false }));
		} else {
			console.error('FATAL:', scrubSecrets(err.message));
			await sql.end();
			process.exit(1);
		}
	}

	// Batched trigger-driven backfill (DAT-7: 1–5k per tx, never one giant tx).
	if (commit) {
		try {
			for (const [table, col] of [['verses', 'text'], ['entities', 'name']]) {
				const ids = await sql.unsafe(`SELECT id FROM lumen.${table} ORDER BY id`);
				let done = 0;
				for (let i = 0; i < ids.length; i += BATCH) {
					const chunk = ids.slice(i, i + BATCH).map((r) => r.id);
					await sql.unsafe(
						`UPDATE lumen.${table} SET ${col} = ${col} WHERE id = ANY($1)`,
						[chunk],
					);
					done += chunk.length;
					console.log(JSON.stringify({ event: 'backfill_progress', table, done, total: ids.length }));
				}
			}
			await top10('post');
			await sql.unsafe(`VACUUM ANALYZE lumen.verses`);
			await sql.unsafe(`VACUUM ANALYZE lumen.entities`);
			console.log(JSON.stringify({ event: 'backfill_complete', analyzed: true }));
		} catch (err) {
			console.error('FATAL (backfill — re-run to resume; idempotent):', scrubSecrets(err.message));
			await sql.end();
			process.exit(1);
		}
	}

	// Invariants run read-only in BOTH modes (OBSC-8,
	// migrate-media-collections convention): post-commit they verify reality;
	// after a dry-run they report against the untouched database (pre-M2 they
	// are expected to fail) — report, don't judge.
	let failures = 0;
	for (const inv of INVARIANTS) {
		try {
			const rows = await sql.unsafe(inv.sql);
			const pass = rows[0]?.pass === true;
			console.log(JSON.stringify({ event: 'invariant_check', name: inv.name, pass }));
			if (!pass) failures += 1;
		} catch (err) {
			console.log(JSON.stringify({ event: 'invariant_check', name: inv.name, pass: false, error: scrubSecrets(err.message) }));
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
