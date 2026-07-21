// Harness for remediation v2 item 3: the dedupe merge migration
// (migrate-phaseb-dedupe.mjs) + the merge-aware writer (backfill-phase-b.ts).
// NO database — every check runs against pure helpers or an injected fake sql.
// Run: node --import tsx --test scripts/__tests__/phaseb-dedupe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	EXPECTED_DUP_GROUPS,
	SOURCE_PAIR,
	MERGED_SOURCES,
	PHASEB_INDEX_NAME,
	UNSHAKEN_INDEX_NAME,
	DUP_GROUPS_SQL,
	LOCK_GROUP_ROWS_SQL,
	MERGE_UPDATE_SQL,
	DELETE_AI_SQL,
	REMAINING_DUP_GROUPS_SQL,
	STAMPED_COUNT_SQL,
	CREATE_PHASEB_INDEX_SQL,
	INDEX_EXISTS_SQL,
	classifyDupGroups,
	relTypeComposition,
	groupsFromLockedRows,
	buildMergedMetadata,
	unionSources,
	buildEscrowPayload,
	validateEscrow,
	buildRestorePlan,
	restoreStatements,
	runDedupeTx,
} from '../migrate-phaseb-dedupe.mjs';
import {
	parseRenamesLedger,
	applyRename,
	assignFinalEntityId,
	remapEndpoint,
	pickSurvivorIndex,
	collapseEdgeRows,
	buildEntityUpsertStatement,
	buildEdgeUpsertStatement,
	phasebIndexExists,
	PHASEB_INDEX_EXISTS_SQL,
} from '../backfill-phase-b.ts';

// ── fixtures: a known dup pair, ai+curated metadata (verified anatomy) ──────

const CURATED_META = {
	source: 'bible-bom-curated',
	from_label: 'LM_Verse',
	to_label: 'LM_Verse',
	votes: 12,
};
const AI_META = {
	source: 'ai-generated',
	from_label: 'LM_Verse',
	to_label: 'LM_Verse',
	reason: 'Both describe the creation',
	relationship: 'parallel_account',
};

const curatedEdge = (over = {}) => ({
	fromId: 'gen-1-1',
	toId: 'moses-2-1',
	relType: 'CROSS_REF',
	collectionId: 'phase-b',
	metadata: { ...CURATED_META },
	source: 'anthropic-batch',
	...over,
});
const aiEdge = (over = {}) => ({
	fromId: 'gen-1-1',
	toId: 'moses-2-1',
	relType: 'CROSS_REF',
	collectionId: 'phase-b',
	metadata: { ...AI_META },
	source: 'anthropic-batch',
	...over,
});

const makeGroups = (n, over = {}) =>
	Array.from({ length: n }, (_, i) => ({
		from_id: `gen-1-${i + 1}`,
		to_id: `moses-2-${i + 1}`,
		rel_type: 'CROSS_REF',
		n: 2,
		sources: ['ai-generated', 'bible-bom-curated'],
		...over,
	}));

// ── migration pre-flight classifier ─────────────────────────────────────────

test('classifier accepts the verified anatomy (1,578 × 2-row ai+curated groups)', () => {
	const verdict = classifyDupGroups(makeGroups(EXPECTED_DUP_GROUPS));
	assert.equal(verdict.ok, true);
	assert.equal(verdict.reason_count, 0);
	assert.equal(EXPECTED_DUP_GROUPS, 1578); // the plan's number IS the default
});

test('classifier rejects group-count drift in both directions', () => {
	assert.equal(classifyDupGroups(makeGroups(1577)).ok, false);
	assert.equal(classifyDupGroups(makeGroups(1579)).ok, false);
	assert.match(classifyDupGroups(makeGroups(1577)).reasons[0], /group_count 1577 != expected 1578/);
});

test('classifier rejects an ai+ai pair (not the curated merge shape)', () => {
	const groups = makeGroups(EXPECTED_DUP_GROUPS);
	groups[7] = { ...groups[7], sources: ['ai-generated', 'ai-generated'] };
	const verdict = classifyDupGroups(groups);
	assert.equal(verdict.ok, false);
	assert.match(verdict.reasons[0], /source pair \[ai-generated, ai-generated\]/);
});

test('classifier rejects a 3-row group', () => {
	const groups = makeGroups(EXPECTED_DUP_GROUPS);
	groups[0] = { ...groups[0], n: 3, sources: ['ai-generated', 'ai-generated', 'bible-bom-curated'] };
	const verdict = classifyDupGroups(groups);
	assert.equal(verdict.ok, false);
	assert.match(verdict.reasons[0], /3 rows \(expected exactly 2\)/);
});

test('classifier rejects NULL and foreign sources', () => {
	const nullGroup = classifyDupGroups(makeGroups(1, { sources: [null, 'bible-bom-curated'] }), 1);
	assert.equal(nullGroup.ok, false);
	const foreign = classifyDupGroups(makeGroups(1, { sources: ['openbible', 'bible-bom-curated'] }), 1);
	assert.equal(foreign.ok, false);
});

test('rel_type composition reports per-type group counts, largest first', () => {
	const groups = [
		...makeGroups(3),
		...makeGroups(2, { rel_type: 'TEACHES' }),
		...makeGroups(2, { rel_type: 'MENTIONS' }),
	];
	assert.deepEqual(relTypeComposition(groups), { CROSS_REF: 3, MENTIONS: 2, TEACHES: 2 });
});

test('groupsFromLockedRows regroups FOR UPDATE rows into classifier input', () => {
	const rows = [
		{ row_ref: '(0,1)', from_id: 'a', to_id: 'b', rel_type: 'CROSS_REF', source: 'ai-generated' },
		{ row_ref: '(0,2)', from_id: 'a', to_id: 'b', rel_type: 'CROSS_REF', source: 'bible-bom-curated' },
		{ row_ref: '(0,3)', from_id: 'x', to_id: 'y', rel_type: 'TEACHES', source: 'bible-bom-curated' },
		{ row_ref: '(0,4)', from_id: 'x', to_id: 'y', rel_type: 'TEACHES', source: 'ai-generated' },
	];
	const groups = groupsFromLockedRows(rows);
	assert.equal(groups.length, 2);
	assert.equal(classifyDupGroups(groups, 2).ok, true);
	// and a locked ai+ai shape is rejected by the same classifier (in-tx gate)
	const bad = groupsFromLockedRows(rows.map((r) => ({ ...r, source: 'ai-generated' })));
	assert.equal(classifyDupGroups(bad, 2).ok, false);
});

// ── merge-metadata builder ──────────────────────────────────────────────────

test('merge builder: curated survivor gains AI reason/relationship + canonical sources', () => {
	const merged = buildMergedMetadata(CURATED_META, AI_META);
	assert.deepEqual(merged, {
		source: 'bible-bom-curated', // survivor keys preserved
		from_label: 'LM_Verse',
		to_label: 'LM_Verse',
		votes: 12,
		reason: 'Both describe the creation',
		relationship: 'parallel_account',
		sources: ['bible-bom-curated', 'ai-generated'],
	});
	// exact DB shape: same array the migration UPDATE stamps
	assert.deepEqual(merged.sources, MERGED_SOURCES);
});

test('merge builder mirrors the SQL: AI values overwrite, absent AI keys never erase', () => {
	// jsonb || overwrites when the AI row carries the key…
	const overwritten = buildMergedMetadata({ ...CURATED_META, reason: 'stale' }, AI_META);
	assert.equal(overwritten.reason, 'Both describe the creation');
	// …and jsonb_strip_nulls drops absent keys, so survivor values survive
	const kept = buildMergedMetadata({ ...CURATED_META, reason: 'curated note' }, { source: 'ai-generated' });
	assert.equal(kept.reason, 'curated note');
	assert.equal('relationship' in kept, false);
});

test('merge builder parity: the exact sources literal is embedded in MERGE_UPDATE_SQL', () => {
	assert.ok(MERGE_UPDATE_SQL.includes(JSON.stringify(MERGED_SOURCES)));
	assert.ok(STAMPED_COUNT_SQL.includes(JSON.stringify(MERGED_SOURCES)));
	assert.deepEqual([...SOURCE_PAIR].sort(), [...MERGED_SOURCES].sort());
});

test('unionSources: canonical order, no duplicates, arrays and scalars mix', () => {
	assert.deepEqual(unionSources(CURATED_META, AI_META), MERGED_SOURCES);
	// an already-merged row union'd with a single source stays canonical
	assert.deepEqual(unionSources({ sources: MERGED_SOURCES }, { source: 'ai-generated' }), MERGED_SOURCES);
	// unknown sources append after the canonical pair
	assert.deepEqual(
		unionSources({ source: 'openbible' }, { sources: MERGED_SOURCES }),
		['bible-bom-curated', 'ai-generated', 'openbible'],
	);
	assert.deepEqual(unionSources({}, undefined), []);
});

// ── in-memory dedupe collapse (writer) ──────────────────────────────────────

test('collapse merges the known ai+curated pair into one curated-survivor row', () => {
	const unrelated = curatedEdge({ fromId: '1-ne-3-7', toId: 'obedience', relType: 'TEACHES', metadata: { source: 'ai-generated', reason: 'r' } });
	const { rows, groupsCollapsed, rowsMerged } = collapseEdgeRows([curatedEdge(), aiEdge(), unrelated]);
	assert.equal(rows.length, 2);
	assert.equal(groupsCollapsed, 1);
	assert.equal(rowsMerged, 1);
	const merged = rows.find((r) => r.fromId === 'gen-1-1');
	assert.deepEqual(merged.metadata, buildMergedMetadata(CURATED_META, AI_META));
	assert.equal(merged.metadata.source, 'bible-bom-curated'); // curated provenance survives
	// the unrelated edge passes through untouched
	assert.deepEqual(rows.find((r) => r.fromId === '1-ne-3-7'), unrelated);
});

test('collapse is order-independent: AI row first still yields the curated survivor', () => {
	const a = collapseEdgeRows([aiEdge(), curatedEdge()]).rows[0];
	const b = collapseEdgeRows([curatedEdge(), aiEdge()]).rows[0];
	assert.deepEqual(a.metadata, b.metadata);
	assert.equal(a.metadata.source, 'bible-bom-curated');
	assert.deepEqual(a.metadata.sources, MERGED_SOURCES);
});

test('collapse output never self-conflicts in a batch (the PG 21000 class)', () => {
	const rows = [
		curatedEdge(), aiEdge(),
		curatedEdge({ fromId: 'alma-7-11', toId: 'isa-53-4' }),
		aiEdge({ fromId: 'alma-7-11', toId: 'isa-53-4' }),
		aiEdge({ fromId: 'alma-7-11', toId: 'isa-53-4', relType: 'TEACHES' }), // distinct rel_type = distinct tuple
	];
	const { rows: out } = collapseEdgeRows(rows);
	const keys = out.map((r) => `${r.fromId}|${r.toId}|${r.relType}`);
	assert.equal(new Set(keys).size, keys.length);
	assert.equal(out.length, 3);
	// and the edge upsert builder accepts the whole collapsed set as ONE batch
	const { values } = buildEdgeUpsertStatement(out);
	assert.equal(values.length, out.length * 6);
});

test('pickSurvivorIndex prefers the curated member wherever it sits', () => {
	assert.equal(pickSurvivorIndex([aiEdge(), curatedEdge()]), 1);
	assert.equal(pickSurvivorIndex([curatedEdge(), aiEdge()]), 0);
	// an already-merged row (sources array) counts as curated
	assert.equal(pickSurvivorIndex([aiEdge(), aiEdge({ metadata: { sources: MERGED_SOURCES } })]), 1);
	// degenerate ai+ai: falls back to first (classifier/invariants catch this in the DB path)
	assert.equal(pickSurvivorIndex([aiEdge(), aiEdge()]), 0);
});

// ── renames ledger ──────────────────────────────────────────────────────────

test('ledger: missing file (null) is an empty ledger; entries parse to a map', () => {
	assert.equal(parseRenamesLedger(null).size, 0);
	const ledger = parseRenamesLedger(JSON.stringify([{ from: 'a-sidney-gilbert-1', to: 'john-c-bennett-1' }]));
	assert.equal(ledger.get('a-sidney-gilbert-1'), 'john-c-bennett-1');
	assert.equal(applyRename(ledger, 'a-sidney-gilbert-1'), 'john-c-bennett-1');
	assert.equal(applyRename(ledger, 'sidney-gilbert-1'), 'sidney-gilbert-1'); // the DISTINCT correct entity is untouched
});

test('ledger: malformed shapes are refused (shared contract with migrate-entity-rename)', () => {
	assert.throws(() => parseRenamesLedger('not json'), /invalid JSON/);
	assert.throws(() => parseRenamesLedger('{"from":"a","to":"b"}'), /must be a JSON array/);
	assert.throws(() => parseRenamesLedger(JSON.stringify([{ from: 'BAD_ID', to: 'x-1' }])), /slug id/);
	assert.throws(() => parseRenamesLedger(JSON.stringify([{ from: 'a-1', to: 'a-1' }])), /from === to/);
	assert.throws(
		() => parseRenamesLedger(JSON.stringify([{ from: 'a-1', to: 'b-1' }, { from: 'a-1', to: 'c-1' }])),
		/duplicate from/,
	);
	assert.throws(
		() => parseRenamesLedger(JSON.stringify([{ from: 'a-1', to: 'b-1' }, { from: 'b-1', to: 'c-1' }])),
		/chained rename/,
	);
});

test('ledger applies to entity ids: the old id is never re-minted', () => {
	const ledger = parseRenamesLedger(JSON.stringify([{ from: 'a-sidney-gilbert-1', to: 'john-c-bennett-1' }]));
	const taken = new Set();
	const used = new Set();
	const r = assignFinalEntityId('a-sidney-gilbert-1', 'person', ledger, taken, used);
	assert.equal(r.finalId, 'john-c-bennett-1');
	assert.equal(r.ledgered, true);
	assert.equal(r.namespaced, false);
	assert.notEqual(r.finalId, 'a-sidney-gilbert-1');
});

test('ledger composes with collision namespacing (ledger first, then {type}:{id})', () => {
	const ledger = parseRenamesLedger(JSON.stringify([{ from: 'old-1', to: 'new-1' }]));
	const r = assignFinalEntityId('old-1', 'person', ledger, new Set(['new-1']), new Set());
	assert.equal(r.finalId, 'person:new-1');
	assert.equal(r.ledgered, true);
	assert.equal(r.namespaced, true);
	// no ledger hit: plain namespacing still works as before
	const plain = assignFinalEntityId('alma-2', 'person', new Map(), new Set(['alma-2']), new Set());
	assert.deepEqual([plain.finalId, plain.ledgered, plain.namespaced], ['person:alma-2', false, true]);
});

test('ledger applies to edge endpoints: node-map hit wins, fallback goes through ledger', () => {
	const ledger = parseRenamesLedger(JSON.stringify([{ from: 'a-sidney-gilbert-1', to: 'john-c-bennett-1' }]));
	const finalIdByLabelId = new Map([['LM_Person|a-sidney-gilbert-1', 'john-c-bennett-1']]);
	// endpoint present in the node map (already ledger-applied there)
	assert.equal(remapEndpoint(finalIdByLabelId, ledger, 'LM_Person', 'a-sidney-gilbert-1'), 'john-c-bennett-1');
	// endpoint absent from the node map: the ledger still applies
	assert.equal(remapEndpoint(new Map(), ledger, 'LM_Person', 'a-sidney-gilbert-1'), 'john-c-bennett-1');
	// non-ledgered endpoints pass through
	assert.equal(remapEndpoint(new Map(), ledger, 'LM_Verse', 'gen-1-1'), 'gen-1-1');
});

// ── escrow round-trip ───────────────────────────────────────────────────────

const escrowRow = (edge, ref) => ({
	row_ref: ref,
	row: {
		from_id: edge.fromId,
		to_id: edge.toId,
		rel_type: edge.relType,
		collection_id: edge.collectionId,
		metadata: edge.metadata,
		source: edge.source,
		created_at: '2025-11-02T08:00:00+00:00',
	},
});

function makeEscrowFixture() {
	const g1c = curatedEdge();
	const g1a = aiEdge();
	const g2c = curatedEdge({ fromId: 'alma-7-11', toId: 'isa-53-4' });
	const g2a = aiEdge({ fromId: 'alma-7-11', toId: 'isa-53-4' });
	const rows = [escrowRow(g1c, '(9,1)'), escrowRow(g1a, '(9,2)'), escrowRow(g2c, '(9,3)'), escrowRow(g2a, '(9,4)')];
	const census = [
		{ from_id: 'alma-7-11', to_id: 'isa-53-4', rel_type: 'CROSS_REF', n: 2, sources: ['ai-generated', 'bible-bom-curated'] },
		{ from_id: 'gen-1-1', to_id: 'moses-2-1', rel_type: 'CROSS_REF', n: 2, sources: ['ai-generated', 'bible-bom-curated'] },
	];
	return { rows, census };
}

test('escrow payload counts groups and rows and keeps full row images + ctid log refs', () => {
	const { rows, census } = makeEscrowFixture();
	const payload = buildEscrowPayload(rows, { started_at: 't0', commit: false });
	assert.equal(payload.group_count, 2);
	assert.equal(payload.row_count, 4);
	assert.equal(payload.rows[0].row_ref, '(9,1)');
	assert.deepEqual(validateEscrow(payload, census), []);
});

test('escrow validation catches census drift (missing group, extra group, size mismatch)', () => {
	const { rows, census } = makeEscrowFixture();
	const payload = buildEscrowPayload(rows, {});
	assert.match(
		validateEscrow(payload, [...census, { from_id: 'x', to_id: 'y', rel_type: 'TEACHES', n: 2, sources: [] }])[0],
		/escrow group_count 2 != census 3/,
	);
	const short = buildEscrowPayload(rows.slice(0, 3), {});
	assert.ok(validateEscrow(short, census).some((e) => /escrowed 1 rows, census 2/.test(e)));
	assert.ok(validateEscrow(payload, census.slice(0, 1)).some((e) => /absent from census/.test(e)));
});

/** Tiny natural-key interpreter for the restore plan (edges has no PK). */
function applyRestore(table, ops) {
	let t = table.map((r) => structuredClone(r));
	for (const op of ops) {
		if (op.op === 'delete_group') {
			t = t.filter(
				(r) =>
					!(
						r.collection_id === op.key.collection_id &&
						r.from_id === op.key.from_id &&
						r.to_id === op.key.to_id &&
						r.rel_type === op.key.rel_type
					),
			);
		} else {
			t.push(structuredClone(op.row));
		}
	}
	return t;
}

const sorted = (rows) => rows.map((r) => JSON.stringify(r)).sort();

test('escrow round-trip: restore plan reproduces the pre-merge rows exactly', () => {
	const { rows } = makeEscrowFixture();
	const payload = buildEscrowPayload(rows, { started_at: 't0' });
	// simulate the post-merge table: curated survivors merged, AI rows gone,
	// plus an untouched bystander row that restore must not disturb
	const bystander = {
		from_id: '1-ne-3-7', to_id: 'obedience', rel_type: 'TEACHES', collection_id: 'phase-b',
		metadata: { source: 'ai-generated' }, source: 'anthropic-batch', created_at: '2025-11-02T08:00:00+00:00',
	};
	const postMerge = [
		{ ...rows[0].row, metadata: buildMergedMetadata(rows[0].row.metadata, rows[1].row.metadata) },
		{ ...rows[2].row, metadata: buildMergedMetadata(rows[2].row.metadata, rows[3].row.metadata) },
		bystander,
	];
	const restored = applyRestore(postMerge, buildRestorePlan(payload));
	assert.deepEqual(sorted(restored), sorted([...rows.map((r) => r.row), bystander]));
});

test('restore statements: deletes precede inserts, parameterized, jsonb-cast metadata', () => {
	const { rows } = makeEscrowFixture();
	const stmts = restoreStatements(buildRestorePlan(buildEscrowPayload(rows, {})));
	assert.equal(stmts.length, 2 + 4); // 2 group deletes + 4 row inserts
	const firstInsert = stmts.findIndex((s) => s.text.startsWith('INSERT'));
	assert.ok(stmts.slice(0, firstInsert).every((s) => s.text.startsWith('DELETE')));
	const ins = stmts[firstInsert];
	assert.ok(ins.text.includes('::jsonb'));
	assert.equal(typeof ins.values[ins.text.match(/\(([^)]+)\)/)[1].split(', ').indexOf('metadata')], 'string');
	// hostile column names in a row image are refused (they would be interpolated)
	assert.throws(
		() => restoreStatements([{ op: 'insert_row', row: { 'bad; DROP TABLE x': 1 } }]),
		/unsafe column name/,
	);
});

// ── migration tx: injected fake sql exercises invariants + stop conditions ──

const withCount = (rows, count) => Object.assign([...rows], { count });

function fakeSql(handlers) {
	const calls = [];
	return {
		calls,
		async begin(fn) {
			return fn({
				async unsafe(text, params) {
					calls.push({ text, params });
					if (text.startsWith('SET LOCAL')) return [];
					const h = handlers.get(text);
					if (h === undefined) throw new Error(`unscripted SQL: ${text.trim().slice(0, 60)}`);
					return typeof h === 'function' ? h(params) : h;
				},
			});
		},
	};
}

const lockedRowsFixture = () => [
	{ row_ref: '(9,1)', from_id: 'gen-1-1', to_id: 'moses-2-1', rel_type: 'CROSS_REF', source: 'bible-bom-curated' },
	{ row_ref: '(9,2)', from_id: 'gen-1-1', to_id: 'moses-2-1', rel_type: 'CROSS_REF', source: 'ai-generated' },
	{ row_ref: '(9,3)', from_id: 'alma-7-11', to_id: 'isa-53-4', rel_type: 'CROSS_REF', source: 'bible-bom-curated' },
	{ row_ref: '(9,4)', from_id: 'alma-7-11', to_id: 'isa-53-4', rel_type: 'CROSS_REF', source: 'ai-generated' },
];

function happyHandlers({ updateCount = 2, deleteCount = 2, dupAfter = 0, stampedAfter = 2 } = {}) {
	const h = new Map();
	h.set(LOCK_GROUP_ROWS_SQL, withCount(lockedRowsFixture(), 4));
	h.set(MERGE_UPDATE_SQL, withCount([], updateCount));
	h.set(DELETE_AI_SQL, withCount([], deleteCount));
	h.set(REMAINING_DUP_GROUPS_SQL, [{ n: dupAfter }]);
	h.set(STAMPED_COUNT_SQL, [{ n: stampedAfter }]);
	h.set(INDEX_EXISTS_SQL, () => [{ pass: true }]);
	h.set(CREATE_PHASEB_INDEX_SQL, withCount([], 0));
	return h;
}

// escrow carries the full row images — the tx's row-identity check compares
// escrowed group keys against the FOR UPDATE set (reviewer fix, 2026-07-21)
const escrowFor = (groups, rows) => ({
	group_count: groups,
	row_count: rows,
	rows: lockedRowsFixture().slice(0, rows).map((r) => ({
		row: { from_id: r.from_id, to_id: r.to_id, rel_type: r.rel_type },
	})),
});

test('tx dry-run: full pass incl. index creation, then rolls back (never commits)', async () => {
	const sql = fakeSql(happyHandlers());
	const events = [];
	const outcome = await runDedupeTx(sql, {
		escrow: escrowFor(2, 4),
		preStampedCount: 0,
		commit: false,
		log: (e, d) => events.push(e),
	});
	assert.equal(outcome.status, 'dry_run_ok');
	assert.ok(sql.calls.some((c) => c.text === CREATE_PHASEB_INDEX_SQL)); // index validated in-tx even on dry-run
	assert.ok(events.includes('tx_index_created'));
});

test('tx commit: applied status when every invariant holds', async () => {
	const sql = fakeSql(happyHandlers());
	const outcome = await runDedupeTx(sql, { escrow: escrowFor(2, 4), preStampedCount: 0, commit: true });
	assert.equal(outcome.status, 'applied');
});

test('tx aborts on update-count mismatch BEFORE deleting anything (stop condition)', async () => {
	const sql = fakeSql(happyHandlers({ updateCount: 1 }));
	const outcome = await runDedupeTx(sql, { escrow: escrowFor(2, 4), preStampedCount: 0, commit: true });
	assert.equal(outcome.status, 'aborted');
	assert.match(outcome.reason, /^update_count_1_expected_2/);
	assert.ok(!sql.calls.some((c) => c.text === DELETE_AI_SQL));
	assert.ok(!sql.calls.some((c) => c.text === CREATE_PHASEB_INDEX_SQL));
});

test('tx aborts when the locked shape is not 1 ai + 1 curated per group', async () => {
	const h = happyHandlers();
	h.set(LOCK_GROUP_ROWS_SQL, withCount(lockedRowsFixture().map((r) => ({ ...r, source: 'ai-generated' })), 4));
	const outcome = await runDedupeTx(fakeSql(h), { escrow: escrowFor(2, 4), preStampedCount: 0, commit: true });
	assert.equal(outcome.status, 'aborted');
	assert.match(outcome.reason, /^locked_shape:/);
});

test('tx aborts when locked rowcount diverges from the escrow (counts == escrow sizes)', async () => {
	const outcome = await runDedupeTx(fakeSql(happyHandlers()), {
		escrow: escrowFor(3, 6), // escrow says 6 rows; only 4 lock
		preStampedCount: 0,
		commit: true,
	});
	assert.equal(outcome.status, 'aborted');
	assert.match(outcome.reason, /^locked_rows_4_escrow_6/);
});

test('tx aborts when dup groups remain or the stamp count is off', async () => {
	const remaining = await runDedupeTx(fakeSql(happyHandlers({ dupAfter: 3 })), {
		escrow: escrowFor(2, 4), preStampedCount: 0, commit: true,
	});
	assert.match(remaining.reason, /^dup_groups_remaining_3/);
	const stamp = await runDedupeTx(fakeSql(happyHandlers({ stampedAfter: 1 })), {
		escrow: escrowFor(2, 4), preStampedCount: 0, commit: true,
	});
	assert.match(stamp.reason, /^stamped_1_expected_2/);
});

test('tx aborts if idx_edges_unshaken_unique would be missing (never touched)', async () => {
	const h = happyHandlers();
	h.set(INDEX_EXISTS_SQL, (params) => [{ pass: params[0] !== UNSHAKEN_INDEX_NAME }]);
	const sql = fakeSql(h);
	const outcome = await runDedupeTx(sql, { escrow: escrowFor(2, 4), preStampedCount: 0, commit: true });
	assert.equal(outcome.status, 'aborted');
	assert.equal(outcome.reason, 'unshaken_index_missing');
	assert.ok(!sql.calls.some((c) => c.text === CREATE_PHASEB_INDEX_SQL)); // aborted before touching indexes
});

// ── writer statement builders + startup gate ────────────────────────────────

test('entity upsert preserves curated neo4j_id and guards against cross-collection hijack', () => {
	const { text, values } = buildEntityUpsertStatement([
		{ id: 'john-c-bennett-1', entityType: 'person', name: 'John C. Bennett', description: null, metadata: {}, source: 'anthropic-batch', collectionId: 'phase-b' },
		{ id: 'nephi-1', entityType: 'person', name: 'Nephi', description: 'son of Lehi', metadata: { era: 'BoM' }, source: 'anthropic-batch', collectionId: 'phase-b' },
	]);
	assert.equal(values.length, 16);
	assert.equal(values[0], 'john-c-bennett-1');
	assert.equal(typeof values[4], 'string'); // metadata pre-stringified for ::jsonb
	assert.ok(text.includes('ON CONFLICT (id) DO UPDATE'));
	assert.ok(text.includes(`'neo4j_id', lumen.entities.metadata->'neo4j_id'`));
	assert.ok(text.includes(`WHERE lumen.entities.collection_id = 'phase-b'`));
	assert.ok(text.includes('$16')); // both tuples fully parameterized
});

test('edge upsert arbitrates on the phase-b partial index and never clobbers merged provenance', () => {
	const { text, values } = buildEdgeUpsertStatement([curatedEdge()]);
	assert.equal(values.length, 6);
	assert.ok(text.includes(`ON CONFLICT (from_id, to_id, rel_type) WHERE collection_id = 'phase-b'`));
	for (const key of ['sources', 'reason', 'relationship']) {
		assert.ok(text.includes(`lumen.edges.metadata->'${key}'`), `preserves existing ${key}`);
	}
	assert.throws(() => buildEdgeUpsertStatement([curatedEdge({ collectionId: 'unshaken' })]), /phase-b/);
});

test('startup gate: writer refuses to run without idx_edges_phaseb_unique', async () => {
	assert.ok(PHASEB_INDEX_EXISTS_SQL.includes(PHASEB_INDEX_NAME));
	assert.equal(await phasebIndexExists({ query: async () => ({ rows: [{ pass: true }], rowCount: 1 }) }), true);
	assert.equal(await phasebIndexExists({ query: async () => ({ rows: [{ pass: false }], rowCount: 1 }) }), false);
	assert.equal(await phasebIndexExists({ query: async () => ({ rows: [], rowCount: 0 }) }), false);
});

test('census SQL: dup-group sources aggregate is NOT distinct (ai+ai must show twice)', () => {
	assert.ok(DUP_GROUPS_SQL.includes(`array_agg(metadata->>'source' ORDER BY`));
	assert.ok(!DUP_GROUPS_SQL.includes('DISTINCT'));
});

// ---------- reviewer-fix pins (2026-07-21) ----------

import { escrowLockKeyDiff, dupGroupKey } from '../migrate-phaseb-dedupe.mjs';
import { batchUpsertEntities, batchUpsertEdges, LoadInvariantError } from '../backfill-phase-b.ts';

test('escrowLockKeyDiff: identity is clean; a swapped group surfaces as missing+extra', () => {
	const escrowRows = [
		{ row: { from_id: 'a', to_id: 'b', rel_type: 'CROSS_REF' } },
		{ row: { from_id: 'a', to_id: 'b', rel_type: 'CROSS_REF' } },
	];
	const locked = [
		{ from_id: 'a', to_id: 'b', rel_type: 'CROSS_REF' },
		{ from_id: 'a', to_id: 'b', rel_type: 'CROSS_REF' },
	];
	assert.deepEqual(escrowLockKeyDiff(escrowRows, locked), { missing: 0, extra: 0 });
	const swapped = [{ from_id: 'x', to_id: 'y', rel_type: 'CROSS_REF' }];
	assert.deepEqual(escrowLockKeyDiff(escrowRows, swapped), { missing: 1, extra: 1 });
});

test('classifyDupGroups rejects a group whose row already carries metadata.sources', () => {
	const clean = { from_id: 'a', to_id: 'b', rel_type: 'CROSS_REF', n: 2, sources: ['ai-generated', 'bible-bom-curated'] };
	const poisoned = { ...clean, has_sources: true };
	assert.equal(classifyDupGroups([clean], 1).ok, true);
	const verdict = classifyDupGroups([poisoned], 1);
	assert.equal(verdict.ok, false);
	assert.ok(verdict.reasons[0].includes('metadata.sources'));
});

function makeFakeQueryable(rowCountFor) {
	const calls = [];
	return {
		calls,
		query: async (text, values) => {
			calls.push({ text, values });
			return { rows: [], rowCount: rowCountFor(calls.length, text, values) };
		},
	};
}

const mkEntity = (i) => ({
	id: `e-${i}`, entityType: 'person', name: `E ${i}`, description: null,
	collectionId: 'phase-b', metadata: {}, significance: null, searchText: `E ${i}`,
});
const mkEdge = (i) => ({
	fromId: `f-${i}`, toId: `t-${i}`, relType: 'CROSS_REF', collectionId: 'phase-b',
	metadata: {}, source: 'anthropic-batch',
});

test('batch runners slice at the 500 boundary and pass on exact rowCounts', async () => {
	const entities = Array.from({ length: 501 }, (_, i) => mkEntity(i));
	const q = makeFakeQueryable((call) => (call === 1 ? 500 : 1));
	await batchUpsertEntities(q, entities);
	assert.equal(q.calls.length, 2, '500 + 1 = two batches');
});

test('batchUpsertEntities aborts on rowCount mismatch (dropped row = hijack guard)', async () => {
	const q = makeFakeQueryable(() => 499);
	await assert.rejects(
		() => batchUpsertEntities(q, Array.from({ length: 500 }, (_, i) => mkEntity(i))),
		LoadInvariantError,
	);
});

test('batchUpsertEdges aborts on rowCount mismatch', async () => {
	const q = makeFakeQueryable(() => 0);
	await assert.rejects(
		() => batchUpsertEdges(q, [mkEdge(1)]),
		LoadInvariantError,
	);
});

test('tx aborts when the locked set is not exactly the escrowed groups (row identity)', async () => {
	const sql = fakeSql(happyHandlers());
	const escrow = {
		group_count: 2,
		row_count: 4,
		rows: [
			{ row: { from_id: 'gen-1-1', to_id: 'moses-2-1', rel_type: 'CROSS_REF' } },
			{ row: { from_id: 'gen-1-1', to_id: 'moses-2-1', rel_type: 'CROSS_REF' } },
			{ row: { from_id: 'SOMEWHERE', to_id: 'ELSE', rel_type: 'CROSS_REF' } },
			{ row: { from_id: 'SOMEWHERE', to_id: 'ELSE', rel_type: 'CROSS_REF' } },
		],
	};
	const outcome = await runDedupeTx(sql, { escrow, preStampedCount: 0, commit: true });
	assert.equal(outcome.status, 'aborted');
	assert.ok(outcome.reason.startsWith('escrow_lock_key_mismatch'));
	assert.ok(!sql.calls.some((c) => c.text === MERGE_UPDATE_SQL), 'no UPDATE before identity check');
});
