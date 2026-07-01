import type { Neo4jClient } from '@lumen/neo4j-http';

export interface PersonResult {
  found: boolean;
  id?: string;
  name?: string;
  description?: string;
  properties?: Record<string, unknown>;
  verse_count?: number;
  verses?: Array<{ verse_id: string; reference: string; text: string }>;
  places?: Array<{ id: string; name: string }>;
  message?: string;
  suggestions?: Array<{ id: string; name: string; disambiguation?: string }>;
}

export async function getPerson(
  neo4j: Neo4jClient,
  personId: string,
): Promise<PersonResult> {
  const results = await neo4j.layer.lumen.query(
    `MATCH (p:{Person} {id: $personId})
     OPTIONAL MATCH (p)-[:MENTIONS]-(v:{Verse})
     WITH p, collect(DISTINCT {
       verse_id: v.id,
       reference: v.reference,
       text: v.text
     })[0..20] AS verses
     OPTIONAL MATCH (p)-[:LOCATED_AT]-(place:{Place})
     RETURN p.id AS id,
            p.name AS name,
            p.description AS description,
            properties(p) AS properties,
            verses,
            collect(DISTINCT {
              id: place.id,
              name: place.name
            }) AS places`,
    { personId },
  );

  if (results.length === 0) {
    const candidates = await neo4j.layer.lumen.query<{ id: string; name: string; disambiguation?: string }>(
      `MATCH (p:{Person})
       WHERE toLower(p.name) CONTAINS toLower($name)
          OR p.id STARTS WITH $namePrefix
       RETURN p.id AS id, p.name AS name, p.disambiguation AS disambiguation
       ORDER BY size(p.id)
       LIMIT 10`,
      { name: personId, namePrefix: personId.toLowerCase() + '-' },
    );
    if (candidates.length > 0) {
      return {
        found: false,
        message: `Person "${personId}" not found. Did you mean one of these?`,
        suggestions: candidates,
      };
    }
    return { found: false, message: `Person "${personId}" not found.` };
  }

  const r = results[0] as any;
  return {
    found: true,
    id: r.id,
    name: r.name,
    description: r.description,
    properties: r.properties,
    verse_count: r.verses.filter((v: any) => v.verse_id !== null).length,
    verses: r.verses.filter((v: any) => v.verse_id !== null),
    places: r.places.filter((p: any) => p.id !== null),
  };
}
