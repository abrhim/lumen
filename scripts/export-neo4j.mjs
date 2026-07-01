/**
 * Export all LM_* (Lumen) nodes and relationships from Neo4j Aura to JSON.
 *
 * Usage:
 *   node scripts/export-neo4j.mjs
 *
 * Reads NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, NEO4J_DATABASE from .env
 * Writes to data/neo4j-export/nodes.json and data/neo4j-export/edges.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'data/neo4j-export');

// Load .env
function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) {
    // Try apps/web/.dev.vars as fallback
    const devVarsPath = resolve(ROOT, 'apps/web/.dev.vars');
    if (existsSync(devVarsPath)) {
      parseEnvFile(devVarsPath);
      return;
    }
    throw new Error('No .env or apps/web/.dev.vars found. Create one with NEO4J_* vars.');
  }
  parseEnvFile(envPath);
}

function parseEnvFile(path) {
  const content = readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

function normalizeUri(uri) {
  return uri
    .replace(/^neo4j\+s:\/\//, 'https://')
    .replace(/^neo4j\+ssc:\/\//, 'https://')
    .replace(/^neo4j:\/\//, 'http://')
    .replace(/\/$/, '');
}

async function query(endpoint, auth, cypher, params = {}) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.neo4j.query',
      'Authorization': auth,
    },
    body: JSON.stringify({ statement: cypher, parameters: params }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Neo4j HTTP ${res.status}: ${text}`);
  }

  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(`Neo4j error: ${body.errors[0].message}`);
  }

  if (!body.data) return [];
  const { fields, values } = body.data;
  return values.map(row => {
    const obj = {};
    for (let i = 0; i < fields.length; i++) {
      obj[fields[i]] = unwrap(row[i]);
    }
    return obj;
  });
}

function unwrap(val) {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'object') return val;
  if ('$type' in val && '_value' in val) {
    if (val.$type === 'Integer') return Number(val._value);
    if (val.$type === 'Float') return Number(val._value);
    if (val.$type === 'List') return val._value.map(unwrap);
    if (val.$type === 'Map') {
      const out = {};
      for (const [k, v] of Object.entries(val._value)) out[k] = unwrap(v);
      return out;
    }
    if (val.$type === 'Node') {
      const n = val._value;
      const props = {};
      for (const [k, v] of Object.entries(n._properties || {})) props[k] = unwrap(v);
      return { _labels: n._labels, _element_id: n._element_id, ...props };
    }
    if (val.$type === 'Relationship') {
      const r = val._value;
      const props = {};
      for (const [k, v] of Object.entries(r._properties || {})) props[k] = unwrap(v);
      return {
        _type: r._type,
        _start: r._start_node_element_id,
        _end: r._end_node_element_id,
        ...props,
      };
    }
    return val._value;
  }
  return val;
}

async function main() {
  loadEnv();

  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USER;
  const password = process.env.NEO4J_PASSWORD;
  const database = process.env.NEO4J_DATABASE || 'neo4j';

  if (!uri || !user || !password) {
    throw new Error('NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD required');
  }

  const baseUri = normalizeUri(uri);
  const endpoint = `${baseUri}/db/${database}/query/v2`;
  const auth = 'Basic ' + btoa(`${user}:${password}`);

  mkdirSync(OUT_DIR, { recursive: true });

  // Export nodes by label
  console.log('Querying node labels...');
  const labelRows = await query(endpoint, auth,
    `MATCH (n) WHERE any(l IN labels(n) WHERE l STARTS WITH 'LM_')
     RETURN DISTINCT labels(n) AS labels, count(*) AS cnt ORDER BY cnt DESC`
  );

  console.log('Labels found:');
  let totalNodes = 0;
  for (const r of labelRows) {
    console.log(`  ${r.labels}: ${r.cnt}`);
    totalNodes += r.cnt;
  }
  console.log(`Total: ${totalNodes} nodes\n`);

  // Export all nodes in batches
  console.log('Exporting nodes...');
  const allNodes = [];
  const BATCH = 5000;

  for (const labelRow of labelRows) {
    const label = labelRow.labels[0];
    let skip = 0;
    let batch;
    do {
      batch = await query(endpoint, auth,
        `MATCH (n:\`${label}\`)
         RETURN n
         ORDER BY n.id
         SKIP $skip LIMIT $limit`,
        { skip, limit: BATCH }
      );
      for (const row of batch) {
        allNodes.push(row.n);
      }
      skip += batch.length;
      if (batch.length > 0) {
        process.stdout.write(`  ${label}: ${skip} nodes\r`);
      }
    } while (batch.length === BATCH);
    console.log(`  ${label}: ${skip} nodes`);
  }

  writeFileSync(resolve(OUT_DIR, 'nodes.json'), JSON.stringify(allNodes, null, 2));
  console.log(`\nWrote ${allNodes.length} nodes to data/neo4j-export/nodes.json`);

  // Export edges
  console.log('\nExporting edges...');
  const edgeTypeRows = await query(endpoint, auth,
    `MATCH (a)-[r]->(b)
     WHERE any(l IN labels(a) WHERE l STARTS WITH 'LM_')
     RETURN type(r) AS relType, count(*) AS cnt ORDER BY cnt DESC`
  );

  console.log('Edge types:');
  let totalEdges = 0;
  for (const r of edgeTypeRows) {
    console.log(`  ${r.relType}: ${r.cnt}`);
    totalEdges += r.cnt;
  }
  console.log(`Total: ${totalEdges} edges\n`);

  const allEdges = [];

  for (const edgeRow of edgeTypeRows) {
    const relType = edgeRow.relType;
    let skip = 0;
    let batch;
    do {
      batch = await query(endpoint, auth,
        `MATCH (a)-[r:\`${relType}\`]->(b)
         WHERE any(l IN labels(a) WHERE l STARTS WITH 'LM_')
         RETURN a.id AS from_id, type(r) AS rel_type, b.id AS to_id,
                properties(r) AS props, labels(a)[0] AS from_label, labels(b)[0] AS to_label
         SKIP $skip LIMIT $limit`,
        { skip, limit: BATCH }
      );
      for (const row of batch) {
        allEdges.push({
          from_id: row.from_id,
          to_id: row.to_id,
          rel_type: row.rel_type,
          from_label: row.from_label,
          to_label: row.to_label,
          ...(row.props && Object.keys(row.props).length > 0 ? { props: row.props } : {}),
        });
      }
      skip += batch.length;
      if (batch.length > 0) {
        process.stdout.write(`  ${relType}: ${skip} edges\r`);
      }
    } while (batch.length === BATCH);
    console.log(`  ${relType}: ${skip} edges`);
  }

  writeFileSync(resolve(OUT_DIR, 'edges.json'), JSON.stringify(allEdges, null, 2));
  console.log(`\nWrote ${allEdges.length} edges to data/neo4j-export/edges.json`);

  // Summary
  console.log('\n--- Export Summary ---');
  console.log(`Nodes: ${allNodes.length}`);
  console.log(`Edges: ${allEdges.length}`);
  console.log(`Output: ${OUT_DIR}/`);
}

main().catch(err => {
  console.error('Export failed:', err.message);
  process.exit(1);
});
