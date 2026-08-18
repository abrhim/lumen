// Host layer (SoJ phase 3 — docs/features/soj-extraction/host-layer-map.md).
// Curated person entities for the show's presenters + FEATURES edges from
// every episode in their collections. Modeled on materialize-art-edges.mjs:
// pure builder, --dry-run rollback, session-mode assert, one transaction,
// scoped delete, in-tx invariants, migration_state ledger.
//
// V1 scope (deliberate): only presenters whose full names are SOLID from the
// channel's own materials. The Stick of Judah lecturers and live-event
// guests are attributed in episode titles by surname or not at all — Abram
// knows these people; their entities wait for his list rather than guessed
// first names.
//
// Spelling: the host is Todd McLaughlin (Abram 2026-08-18); the channel's
// video titles misspell it "McLauchlin" — ids/names here use the man's.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { assertSessionMode, scrub } from './migrate-canon-spine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'host-curated';

export const HOSTS = [
	{
		id: 'todd-mclaughlin',
		name: 'Todd McLaughlin',
		description:
			'Teacher on The Stick of Joseph. His episodes cover temple worship, the priesthood, and the Lectures on Faith.',
		homeCollection: 'soj-todd-mclauchlin',
		hostsCollections: ['soj-todd-mclauchlin'],
	},
	{
		id: 'andrea-woodmansee',
		name: 'Andrea Woodmansee',
		description:
			'Teacher on The Stick of Joseph. Her episodes cover ancient temple theology, Hebrew wedding ritual, and the Holy Week series.',
		homeCollection: 'soj-andrea-woodmansee',
		hostsCollections: ['soj-andrea-woodmansee'],
	},
	{
		id: 'mike-day',
		name: 'Mike Day',
		description:
			'Co-host of Mike & Dave Read Books on The Stick of Joseph: long-form book studies and deep-dive guides.',
		homeCollection: 'soj-mike-dave-books',
		hostsCollections: ['soj-mike-dave-books'],
	},
	{
		id: 'dave-butler',
		name: 'Dave Butler',
		description:
			'Co-host of Mike & Dave Read Books on The Stick of Joseph: long-form book studies and deep-dive guides.',
		homeCollection: 'soj-mike-dave-books',
		hostsCollections: ['soj-mike-dave-books'],
	},
];

/** Pure: hosts + {collectionId: [episodeEntityId,...]} → entity/edge rows.
 * Edges: episode —FEATURES→ person, collection = the episode's own,
 * source = host-curated (node.tsx renders these via its Episodes query;
 * 'anthropic-batch' would leak them into phase-b Connections). */
export function buildHostPlan(hosts, episodesByCollection) {
	const entities = [];
	const edges = [];
	const missingCollections = [];
	for (const h of hosts) {
		if (!/^[a-z0-9][a-z0-9:-]*$/.test(h.id)) throw new Error(`unsafe host id: ${h.id}`);
		entities.push({
			id: h.id,
			entity_type: 'person',
			name: h.name,
			description: h.description,
			metadata: { role: 'host', curated: true },
			source: SOURCE,
			collection_id: h.homeCollection,
		});
		for (const cid of h.hostsCollections) {
			const eps = episodesByCollection[cid];
			if (!eps || eps.length === 0) {
				missingCollections.push({ host: h.id, collection: cid });
				continue;
			}
			for (const episodeId of eps) {
				edges.push({
					from_id: episodeId,
					to_id: h.id,
					rel_type: 'FEATURES',
					collection_id: cid,
					metadata: { source: 'curated', confidence: 1 },
				});
			}
		}
	}
	return { entities, edges, missingCollections };
}

function log(event, data = {}) {
	console.log(JSON.stringify({ event, at: new Date().toISOString(), ...data }));
}

async function main() {
	const dryRun = process.argv.includes('--dry-run');
	log('host_entities_start', { dryRun, hosts: HOSTS.length });

	let sql;
	try {
		const envPath = join(ROOT, '.env');
		if (!existsSync(envPath)) throw new Error('repo-root .env with admin DATABASE_URL required');
		const url = process.env.INGEST_DATABASE_URL?.trim()
			|| readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
		if (!url) throw new Error('DATABASE_URL not found in repo-root .env');
		if (/:6543\b/.test(url)) throw new Error('session-mode connection required (port 5432)');
		const require = createRequire(import.meta.url);
		const postgres = require('postgres');
		sql = postgres(url, { prepare: false, max: 1 });
	} catch (err) {
		log('host_entities_fatal', { message: scrub(err.message) });
		process.exit(1);
	}

	let exitCode = 0;
	try {
		await assertSessionMode(sql);

		const collectionIds = [...new Set(HOSTS.flatMap((h) => [h.homeCollection, ...h.hostsCollections]))];
		const eps = await sql`
			SELECT id, collection_id FROM lumen.entities
			WHERE entity_type = 'content_item' AND collection_id = ANY(${collectionIds})`;
		const episodesByCollection = {};
		for (const e of eps) {
			(episodesByCollection[e.collection_id] ??= []).push(e.id);
		}

		// an existing id that is NOT ours is a genuine collision — refuse
		const clashes = await sql`
			SELECT id, source FROM lumen.entities
			WHERE id = ANY(${HOSTS.map((h) => h.id)}) AND source IS DISTINCT FROM ${SOURCE}`;
		if (clashes.length) {
			throw new Error(`host id collision with foreign entities: ${clashes.map((c) => c.id).join(', ')}`);
		}

		const { entities, edges, missingCollections } = buildHostPlan(HOSTS, episodesByCollection);
		if (missingCollections.length) {
			throw new Error(`collections with no episodes: ${JSON.stringify(missingCollections)}`);
		}
		log('host_plan_built', { entities: entities.length, edges: edges.length });

		await sql.begin(async (tx) => {
			await tx`
				INSERT INTO lumen.entities (id, entity_type, name, description, metadata, source, collection_id)
				SELECT r.id, r.entity_type, r.name, r.description, r.metadata, r.source, r.collection_id
				FROM jsonb_to_recordset(${tx.json(entities)})
					AS r(id text, entity_type text, name text, description text, metadata jsonb, source text, collection_id text)
				ON CONFLICT (id) DO UPDATE SET
					name = EXCLUDED.name, description = EXCLUDED.description,
					metadata = EXCLUDED.metadata, collection_id = EXCLUDED.collection_id
				WHERE lumen.entities.source = ${SOURCE}`;
			const deleted = await tx`
				DELETE FROM lumen.edges WHERE rel_type = 'FEATURES' AND source = ${SOURCE}`;
			await tx`
				INSERT INTO lumen.edges (from_id, to_id, rel_type, collection_id, metadata, source)
				SELECT r.from_id, r.to_id, r.rel_type, r.collection_id, r.metadata, ${SOURCE}
				FROM jsonb_to_recordset(${tx.json(edges)})
					AS r(from_id text, to_id text, rel_type text, collection_id text, metadata jsonb)`;
			const [orph] = await tx`
				SELECT count(*)::int AS n FROM lumen.edges e
				WHERE e.source = ${SOURCE}
					AND (NOT EXISTS (SELECT 1 FROM lumen.nodes nn WHERE nn.id = e.from_id)
						OR NOT EXISTS (SELECT 1 FROM lumen.nodes nn WHERE nn.id = e.to_id))`;
			log('invariant_check', { name: 'host_zero_orphan_endpoints', expected: 0, actual: orph.n, pass: orph.n === 0 });
			if (orph.n !== 0) throw new Error('invariant failed: host_zero_orphan_endpoints');
			await tx`
				INSERT INTO lumen.migration_state (key, value)
				VALUES ('host-entities-materialize', ${tx.json({ at: new Date().toISOString(), entities: entities.length, edges: edges.length, deleted: deleted.count })})
				ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()`;
			if (dryRun) throw new Error('DRY_RUN_ROLLBACK');
		}).catch((e) => {
			if (e.message === 'DRY_RUN_ROLLBACK') log('dry_run_rollback', { note: 'all checks passed, nothing committed' });
			else throw e;
		});

		log('host_entities_done', { dryRun, entities: entities.length, edges: edges.length });
	} catch (err) {
		log('host_entities_fatal', { message: scrub(err.message) });
		exitCode = 1;
	} finally {
		await sql.end();
	}
	process.exit(exitCode);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) main();
