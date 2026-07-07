import type { Neo4jClient } from '@lumen/neo4j-http';

export interface VerseEntityRef {
  id: string;
  name: string;
}

export interface VerseConnectionsResult {
  verse_id: string;
  principles: VerseEntityRef[];
  people: VerseEntityRef[];
}

/**
 * The streamed half of the reader's verse panel: TEACHES principles and
 * MENTIONS people, one Neo4j round trip. Cross-references moved to Postgres
 * (`getCrossReferences` in crossrefs.ts) with the OpenBible ingest — this
 * function's only caller is the web loader (MCP's find_cross_references is
 * backed by the separate findCrossReferences; verified via grep, API-2).
 */
export async function getVerseConnections(
  neo4j: Neo4jClient,
  verseId: string,
): Promise<VerseConnectionsResult> {
  const results = await neo4j.layer.lumen.query<{
    principles: VerseEntityRef[];
    people: VerseEntityRef[];
  }>(
    `MATCH (v:{Verse} {id: $verseId})
     CALL {
       WITH v
       OPTIONAL MATCH (v)-[:TEACHES]-(p:{Principle})
       WITH p ORDER BY p.name
       RETURN collect(DISTINCT { id: p.id, name: p.name }) AS principles
     }
     CALL {
       WITH v
       OPTIONAL MATCH (v)-[:MENTIONS]-(pe:{Person})
       WITH pe ORDER BY pe.name
       RETURN collect(DISTINCT { id: pe.id, name: pe.name }) AS people
     }
     RETURN principles, people`,
    { verseId },
  );

  if (results.length === 0) {
    // Verse not in the graph — an empty panel, not an error.
    return { verse_id: verseId, principles: [], people: [] };
  }

  const r = results[0];
  return {
    verse_id: verseId,
    principles: r.principles.filter((p) => p.id !== null),
    people: r.people.filter((p) => p.id !== null),
  };
}
