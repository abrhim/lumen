import type { Neo4jClient } from '@lumen/neo4j-http';
import type { CrossReference } from './find-cross-references';

export interface VerseEntityRef {
  id: string;
  name: string;
}

export interface VerseConnectionsResult {
  verse_id: string;
  cross_references: CrossReference[];
  principles: VerseEntityRef[];
  people: VerseEntityRef[];
}

/**
 * Everything the reader's verse panel needs in one round trip:
 * CROSS_REF verses (both directions), TEACHES principles, MENTIONS people.
 */
export async function getVerseConnections(
  neo4j: Neo4jClient,
  verseId: string,
): Promise<VerseConnectionsResult> {
  const results = await neo4j.layer.lumen.query<{
    cross_references: CrossReference[];
    principles: VerseEntityRef[];
    people: VerseEntityRef[];
  }>(
    `MATCH (v:{Verse} {id: $verseId})
     CALL {
       WITH v
       OPTIONAL MATCH (v)-[r:CROSS_REF]-(ref:{Verse})
       WITH v, r, ref ORDER BY ref.id
       RETURN collect({
         verse_id: ref.id,
         reference: ref.reference,
         text: ref.text,
         relationship: type(r),
         direction: CASE WHEN startNode(r) = v THEN 'outgoing' ELSE 'incoming' END,
         source: r.source
       }) AS cross_references
     }
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
     RETURN cross_references, principles, people`,
    { verseId },
  );

  if (results.length === 0) {
    // Verse not in the graph — an empty panel, not an error.
    return { verse_id: verseId, cross_references: [], principles: [], people: [] };
  }

  const r = results[0];

  // The graph holds parallel CROSS_REF edges for some verse pairs (same
  // direction, e.g. duplicated ingest rows) — one card per referenced verse.
  const seen = new Set<string>();
  const crossReferences = r.cross_references.filter((x) => {
    if (x.verse_id === null) return false;
    const key = `${x.direction}:${x.verse_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    verse_id: verseId,
    cross_references: crossReferences,
    principles: r.principles.filter((p) => p.id !== null),
    people: r.people.filter((p) => p.id !== null),
  };
}
