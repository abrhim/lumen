import type { Neo4jClient } from '@lumen/neo4j-http';

export interface PrincipleVerseResult {
  verse_id: string;
  reference: string;
  text: string;
  volume_id: string;
  book_id: string;
}

export interface SearchByPrincipleResult {
  principle_id: string;
  volume: string;
  result_count: number;
  results: PrincipleVerseResult[];
}

export async function searchByPrinciple(
  neo4j: Neo4jClient,
  principleId: string,
  volume?: string,
  limit = 10,
): Promise<SearchByPrincipleResult> {
  const volumeFilter = volume
    ? 'AND v.volume_id = $volume'
    : '';

  const results = await neo4j.layer.lumen.query<PrincipleVerseResult>(
    `MATCH (p:{Principle} {id: $principleId})-[:TEACHES]-(v:{Verse})
     WHERE true ${volumeFilter}
     RETURN v.id AS verse_id,
            v.reference AS reference,
            v.text AS text,
            v.volume_id AS volume_id,
            v.book_id AS book_id
     ORDER BY v.id
     LIMIT toInteger($limit)`,
    {
      principleId,
      volume: volume ?? null,
      limit,
    },
  );

  return {
    principle_id: principleId,
    volume: volume ?? 'all',
    result_count: results.length,
    results,
  };
}
