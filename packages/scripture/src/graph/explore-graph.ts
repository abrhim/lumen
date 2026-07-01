import type { Neo4jClient } from '@lumen/neo4j-http';

export interface GraphConnection {
  direction?: 'incoming' | 'outgoing';
  relationship: string;
  connected_id: string;
  connected_name: string;
  connected_labels: string[];
  connected_description?: string;
}

export interface DeepGraphConnection {
  connected_id: string;
  connected_name: string;
  connected_labels: string[];
  hops: number;
  path: string[];
  connected_description?: string;
}

export interface GraphEntity {
  id: string;
  name: string;
  labels: string[];
  properties: Record<string, unknown>;
}

export interface ExploreGraphResult {
  found: boolean;
  entity?: GraphEntity;
  depth?: number;
  connection_count?: number;
  connections?: (GraphConnection | DeepGraphConnection)[];
  message?: string;
}

export async function exploreGraph(
  neo4j: Neo4jClient,
  entityId: string,
  depth = 1,
  relTypes?: string[],
): Promise<ExploreGraphResult> {
  const hasRelFilter = relTypes && relTypes.length > 0;
  const relFilterClause = hasRelFilter ? 'AND type(r) IN $relTypes' : '';
  const params: Record<string, unknown> = { entityId };
  if (hasRelFilter) params.relTypes = relTypes;

  if (depth === 1) {
    const results = await neo4j.layer.lumen.query(
      `MATCH (n {id: $entityId})
       OPTIONAL MATCH (n)-[r]-(connected)
       WHERE true ${relFilterClause}
       RETURN n.id AS id,
              n.name AS name,
              labels(n) AS node_labels,
              properties(n) AS properties,
              collect(DISTINCT {
                direction: CASE WHEN startNode(r) = n THEN 'outgoing' ELSE 'incoming' END,
                relationship: type(r),
                connected_id: connected.id,
                connected_name: connected.name,
                connected_labels: labels(connected),
                connected_description: substring(coalesce(connected.description, ''), 0, 200)
              }) AS connections`,
      params,
    );

    if (results.length === 0) {
      return { found: false, message: `Entity "${entityId}" not found.` };
    }

    const r = results[0] as any;
    const conns = r.connections.filter((c: any) => c.connected_id !== null);
    return {
      found: true,
      entity: { id: r.id, name: r.name, labels: r.node_labels, properties: r.properties },
      connection_count: conns.length,
      connections: conns,
    };
  }

  const depthRelFilter = hasRelFilter
    ? 'AND ALL(r IN relationships(path) WHERE type(r) IN $relTypes)'
    : '';

  const results = await neo4j.layer.lumen.query(
    `MATCH (n {id: $entityId})
     CALL {
       WITH n
       MATCH path = (n)-[*1..${depth}]-(connected)
       WHERE connected <> n ${depthRelFilter}
       WITH connected, relationships(path) AS rels, length(path) AS hops
       RETURN DISTINCT connected.id AS connected_id,
              connected.name AS connected_name,
              labels(connected) AS connected_labels,
              hops,
              [r IN rels | type(r)] AS path_relationships,
              substring(coalesce(connected.description, ''), 0, 200) AS connected_description
       ORDER BY hops
       LIMIT 50
     }
     RETURN n.id AS id,
            n.name AS name,
            labels(n) AS node_labels,
            properties(n) AS properties,
            collect({
              connected_id: connected_id,
              connected_name: connected_name,
              connected_labels: connected_labels,
              hops: hops,
              path: path_relationships,
              connected_description: connected_description
            }) AS connections`,
    params,
  );

  if (results.length === 0) {
    return { found: false, message: `Entity "${entityId}" not found.` };
  }

  const r = results[0] as any;
  return {
    found: true,
    entity: { id: r.id, name: r.name, labels: r.node_labels, properties: r.properties },
    depth,
    connection_count: r.connections.length,
    connections: r.connections,
  };
}
