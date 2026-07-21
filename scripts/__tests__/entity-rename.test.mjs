// Harness for remediation v2 item 7 — entity rename migration + ledger.
// Run: node --import tsx --test scripts/__tests__/entity-rename.test.mjs
// All sql is FAKE (injected); no database or network is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	LEDGER_PATH,
	ID_PATTERN,
	validateLedger,
	classifyRename,
	transformMetadata,
	renameOne,
	ROW_IMAGE_SQL,
	LOCK_ROW_SQL,
	EDGE_COUNT_SQL,
	LOCK_EDGES_SQL,
	RENAME_SQL,
	ID_COUNT_SQL,
} from '../migrate-entity-rename.mjs';

// ── ledger validation ───────────────────────────────────────────────────────

test('the committed ledger file parses, validates, and pins the item-7 rename', () => {
	const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
	assert.deepEqual(ledger, [{ from: 'a-sidney-gilbert-1', to: 'john-c-bennett-1' }]);
	assert.deepEqual(validateLedger(ledger), []);
});

test('validateLedger: shape errors', () => {
	assert.deepEqual(validateLedger({ from: 'a', to: 'b' }), ['ledger must be a JSON array']);
	assert.ok(validateLedger([null])[0].includes('not an object'));
	assert.ok(validateLedger(['a-to-b'])[0].includes('not an object'));
	assert.ok(validateLedger([{ from: 'a-1' }]).some((e) => e.includes('to must be a slug id')));
	assert.ok(validateLedger([{ from: 'a-1', to: '' }]).some((e) => e.includes('to must be a slug id')));
	assert.ok(validateLedger([{ from: 'A-Sidney', to: 'b-1' }]).some((e) => e.includes('from must be a slug id')));
	assert.ok(validateLedger([{ from: 'a 1', to: 'b-1' }]).some((e) => e.includes('from must be a slug id')));
	assert.ok(validateLedger([{ from: 'a-1', to: 'b-1', note: 'x' }]).some((e) => e.includes('unknown keys')));
	assert.ok(validateLedger([{ from: 'a-1', to: 'a-1' }]).some((e) => e.includes('from === to')));
});

test('validateLedger: namespaced `{type}:{id}` ids are legal (house precedent)', () => {
	assert.ok(ID_PATTERN.test('person:nephi-1'));
	assert.deepEqual(validateLedger([{ from: 'person:nephi-1', to: 'nephi-9' }]), []);
});

test('validateLedger: duplicate targets, duplicate froms, and chains are refused', () => {
	assert.ok(
		validateLedger([
			{ from: 'a-1', to: 'c-1' },
			{ from: 'b-1', to: 'c-1' },
		]).some((e) => e.includes("duplicate target 'c-1'")),
	);
	assert.ok(
		validateLedger([
			{ from: 'a-1', to: 'b-1' },
			{ from: 'a-1', to: 'c-1' },
		]).some((e) => e.includes("duplicate from 'a-1'")),
	);
	// a->b, b->c is order-dependent; a<->b swap is unsatisfiable — both refused
	assert.ok(
		validateLedger([
			{ from: 'a-1', to: 'b-1' },
			{ from: 'b-1', to: 'c-1' },
		]).some((e) => e.includes('chained rename')),
	);
	assert.ok(
		validateLedger([
			{ from: 'a-1', to: 'b-1' },
			{ from: 'b-1', to: 'a-1' },
		]).some((e) => e.includes('chained rename')),
	);
});

// ── assertion classifier ────────────────────────────────────────────────────

const cleanFromRow = {
	id: 'a-sidney-gilbert-1',
	entity_type: 'person',
	name: 'John C. Bennett',
	metadata: { source_note: 'phase-b' },
};

test('classifyRename: clean state passes', () => {
	assert.deepEqual(classifyRename({ fromRow: cleanFromRow, edgeCount: 0, toRow: null }), { ok: true, reason: null });
});

test('classifyRename: missing from-row aborts', () => {
	assert.equal(classifyRename({ fromRow: null, edgeCount: 0, toRow: null }).reason, 'from_row_missing');
});

test('classifyRename: nonzero edge count aborts (edges appeared since verification)', () => {
	assert.equal(classifyRename({ fromRow: cleanFromRow, edgeCount: 1, toRow: null }).reason, 'edges_present');
	assert.equal(classifyRename({ fromRow: cleanFromRow, edgeCount: '3', toRow: null }).reason, 'edges_present');
	// missing count is fail-closed, never treated as zero
	assert.equal(classifyRename({ fromRow: cleanFromRow, edgeCount: NaN, toRow: null }).reason, 'edges_present');
});

test('classifyRename: occupied to-id aborts', () => {
	const verdict = classifyRename({ fromRow: cleanFromRow, edgeCount: 0, toRow: { id: 'john-c-bennett-1' } });
	assert.equal(verdict.reason, 'to_id_occupied');
});

test('classifyRename: preexisting metadata.neo4j_id aborts — human review', () => {
	const row = { ...cleanFromRow, metadata: { neo4j_id: 'something-else' } };
	assert.equal(classifyRename({ fromRow: row, edgeCount: 0, toRow: null }).reason, 'neo4j_id_preexisting');
	// key present counts as set, whatever its value
	const rowNull = { ...cleanFromRow, metadata: { neo4j_id: null } };
	assert.equal(classifyRename({ fromRow: rowNull, edgeCount: 0, toRow: null }).reason, 'neo4j_id_preexisting');
});

test('classifyRename: non-object metadata (A1 string-scalar class) aborts; null metadata passes', () => {
	const scalar = { ...cleanFromRow, metadata: '{"wrapped":true}' };
	assert.equal(classifyRename({ fromRow: scalar, edgeCount: 0, toRow: null }).reason, 'metadata_not_object');
	const arr = { ...cleanFromRow, metadata: ['a'] };
	assert.equal(classifyRename({ fromRow: arr, edgeCount: 0, toRow: null }).reason, 'metadata_not_object');
	const nul = { ...cleanFromRow, metadata: null };
	assert.equal(classifyRename({ fromRow: nul, edgeCount: 0, toRow: null }).ok, true);
});

// ── metadata transform ──────────────────────────────────────────────────────

test('transformMetadata stamps neo4j_id = from, preserves keys, does not mutate', () => {
	const meta = { source_note: 'phase-b', aliases: ['Dr. Bennett'] };
	const out = transformMetadata(meta, 'a-sidney-gilbert-1');
	assert.deepEqual(out, { source_note: 'phase-b', aliases: ['Dr. Bennett'], neo4j_id: 'a-sidney-gilbert-1' });
	assert.deepEqual(meta, { source_note: 'phase-b', aliases: ['Dr. Bennett'] }); // untouched
});

test('transformMetadata: null/undefined metadata becomes {neo4j_id}', () => {
	assert.deepEqual(transformMetadata(null, 'x-1'), { neo4j_id: 'x-1' });
	assert.deepEqual(transformMetadata(undefined, 'x-1'), { neo4j_id: 'x-1' });
});

test('transformMetadata throws on preexisting neo4j_id and on non-object metadata', () => {
	assert.throws(() => transformMetadata({ neo4j_id: 'old' }, 'x-1'), /already set/);
	assert.throws(() => transformMetadata('scalar', 'x-1'), /not a jsonb object/);
	assert.throws(() => transformMetadata(['a'], 'x-1'), /not a jsonb object/);
});

// ── renameOne against a fake sql (behavior, not SQL text) ───────────────────

const ENTRY = { from: 'a-sidney-gilbert-1', to: 'john-c-bennett-1' };

const rows = (arr, count = arr.length) => Object.assign([...arr], { count });

/** Fake postgres.js: begin(cb) runs cb(tx), commits on return, rolls back on
 * throw; tx.unsafe dispatches on the script's exported SQL consts. */
function makeFakeSql(overrides = {}) {
	const calls = [];
	const state = { committed: false, rolledBack: false };
	const defaults = {
		fromRow: { ...cleanFromRow },
		edgeCount: 0,
		toRow: null,
		updateCount: 1,
		countFor: (id) => (id === ENTRY.to ? 1 : 0), // post-rename state
	};
	const cfg = { ...defaults, ...overrides };
	const tx = {
		unsafe: async (text, params = []) => {
			calls.push({ text, params });
			if (text.includes('statement_timeout')) return rows([]);
			if (text === LOCK_EDGES_SQL) return rows([]);
			if (text === LOCK_ROW_SQL) return rows(cfg.fromRow ? [{ row: cfg.fromRow }] : []);
			if (text === EDGE_COUNT_SQL) return rows([{ n: cfg.edgeCount }]);
			if (text === ROW_IMAGE_SQL) return rows(cfg.toRow ? [{ row: cfg.toRow }] : []);
			if (text === RENAME_SQL) return rows([], cfg.updateCount);
			if (text === ID_COUNT_SQL) return rows([{ n: cfg.countFor(params[0]) }]);
			throw new Error(`unexpected SQL: ${text}`);
		},
	};
	return {
		calls,
		state,
		begin: async (cb) => {
			try {
				const r = await cb(tx);
				state.committed = true;
				return r;
			} catch (err) {
				state.rolledBack = true;
				throw err;
			}
		},
	};
}

test('renameOne dry-run: full path exercised, tx rolled back, correct UPDATE params', async () => {
	const sql = makeFakeSql();
	const outcome = await renameOne(sql, ENTRY, { commit: false });
	assert.deepEqual(outcome, { status: 'dry_run_ok', reason: null });
	assert.equal(sql.state.rolledBack, true);
	assert.equal(sql.state.committed, false);
	const update = sql.calls.find((c) => c.text === RENAME_SQL);
	assert.ok(update, 'UPDATE was issued inside the tx');
	assert.equal(update.params[0], ENTRY.from);
	assert.equal(update.params[1], ENTRY.to);
	// stamp happens SQL-side (no full-metadata round-trip through JS)
	assert.equal(update.params.length, 2);
	assert.ok(RENAME_SQL.includes(`jsonb_build_object('neo4j_id', $1::text)`));
	assert.ok(RENAME_SQL.includes(`COALESCE(metadata, '{}'::jsonb)`));
	// edge-write lock taken before the row lock
	const lockIdx = sql.calls.findIndex((c) => c.text === LOCK_EDGES_SQL);
	const rowIdx = sql.calls.findIndex((c) => c.text === LOCK_ROW_SQL);
	assert.ok(lockIdx !== -1 && lockIdx < rowIdx, 'LOCK TABLE precedes row lock');
	// both in-tx invariant counts ran
	const countCalls = sql.calls.filter((c) => c.text === ID_COUNT_SQL).map((c) => c.params[0]);
	assert.deepEqual(countCalls.sort(), [ENTRY.from, ENTRY.to].sort());
});

test('renameOne COMMIT=1: commits when every assertion and invariant holds', async () => {
	const sql = makeFakeSql();
	const outcome = await renameOne(sql, ENTRY, { commit: true });
	assert.deepEqual(outcome, { status: 'applied', reason: null });
	assert.equal(sql.state.committed, true);
	assert.equal(sql.state.rolledBack, false);
});

test('renameOne aborts on string-wrapped metadata (metadata_not_object), no UPDATE', async () => {
	const sql = makeFakeSql({ fromRow: { ...cleanFromRow, metadata: '{"wrapped":true}' } });
	const outcome = await renameOne(sql, ENTRY, { commit: true });
	assert.deepEqual(outcome, { status: 'aborted', reason: 'metadata_not_object' });
	assert.equal(sql.calls.some((c) => c.text === RENAME_SQL), false, 'no UPDATE issued');
	assert.equal(sql.state.committed, false);
});

test('renameOne aborts BEFORE any UPDATE when edges appeared since verification', async () => {
	const sql = makeFakeSql({ edgeCount: 2 });
	const outcome = await renameOne(sql, ENTRY, { commit: true });
	assert.deepEqual(outcome, { status: 'aborted', reason: 'edges_present' });
	assert.equal(sql.state.rolledBack, true);
	assert.equal(sql.state.committed, false);
	assert.equal(sql.calls.some((c) => c.text === RENAME_SQL), false, 'no UPDATE issued');
});

test('renameOne aborts BEFORE any UPDATE when the to-id is occupied', async () => {
	const sql = makeFakeSql({ toRow: { id: ENTRY.to, name: 'squatter' } });
	const outcome = await renameOne(sql, ENTRY, { commit: true });
	assert.deepEqual(outcome, { status: 'aborted', reason: 'to_id_occupied' });
	assert.equal(sql.calls.some((c) => c.text === RENAME_SQL), false);
	assert.equal(sql.state.committed, false);
});

test('renameOne aborts BEFORE any UPDATE on preexisting metadata.neo4j_id', async () => {
	const sql = makeFakeSql({ fromRow: { ...cleanFromRow, metadata: { neo4j_id: 'pinned' } } });
	const outcome = await renameOne(sql, ENTRY, { commit: true });
	assert.deepEqual(outcome, { status: 'aborted', reason: 'neo4j_id_preexisting' });
	assert.equal(sql.calls.some((c) => c.text === RENAME_SQL), false);
	assert.equal(sql.state.committed, false);
});

test('renameOne aborts on missing from-row', async () => {
	const sql = makeFakeSql({ fromRow: null });
	const outcome = await renameOne(sql, ENTRY, { commit: true });
	assert.deepEqual(outcome, { status: 'aborted', reason: 'from_row_missing' });
	assert.equal(sql.state.committed, false);
});

test('renameOne in-tx invariants abort under COMMIT: rowcount != 1', async () => {
	const sql = makeFakeSql({ updateCount: 0 });
	const outcome = await renameOne(sql, ENTRY, { commit: true });
	assert.deepEqual(outcome, { status: 'aborted', reason: 'updated_rowcount_0' });
	assert.equal(sql.state.committed, false);
	assert.equal(sql.state.rolledBack, true);
});

test('renameOne in-tx invariants abort under COMMIT: from-id still present / to-id not unique', async () => {
	const lingering = makeFakeSql({ countFor: (id) => 1 }); // from still there AND to present
	const o1 = await renameOne(lingering, ENTRY, { commit: true });
	assert.deepEqual(o1, { status: 'aborted', reason: 'from_id_count_1' });
	assert.equal(lingering.state.committed, false);

	const duplicated = makeFakeSql({ countFor: (id) => (id === ENTRY.to ? 2 : 0) });
	const o2 = await renameOne(duplicated, ENTRY, { commit: true });
	assert.deepEqual(o2, { status: 'aborted', reason: 'to_id_count_2' });
	assert.equal(duplicated.state.committed, false);
});

test('renameOne rethrows infrastructure errors (fatal, not abort)', async () => {
	const sql = {
		state: { committed: false, rolledBack: false },
		calls: [],
		begin: async () => {
			throw new Error('connection reset');
		},
	};
	await assert.rejects(() => renameOne(sql, ENTRY, { commit: false }), /connection reset/);
});
