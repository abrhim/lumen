import type { Neo4jClient } from '@lumen/neo4j-http';

export interface CrossReference {
  verse_id: string;
  reference: string;
  text: string;
  relationship: string;
  direction: 'incoming' | 'outgoing';
  source: string;
}

export interface CrossReferenceResult {
  verse_id: string;
  cross_reference_count: number;
  cross_references: CrossReference[];
}

export async function findCrossReferences(
  neo4j: Neo4jClient,
  verseId: string,
): Promise<CrossReferenceResult> {
  const results = await neo4j.layer.lumen.query<CrossReference>(
    `MATCH (v:{Verse} {id: $verseId})-[r:CROSS_REF]-(ref:{Verse})
     RETURN ref.id AS verse_id,
            ref.reference AS reference,
            ref.text AS text,
            type(r) AS relationship,
            CASE WHEN startNode(r) = v THEN 'outgoing' ELSE 'incoming' END AS direction,
            r.source AS source
     ORDER BY ref.id`,
    { verseId },
  );

  return {
    verse_id: verseId,
    cross_reference_count: results.length,
    cross_references: results,
  };
}
