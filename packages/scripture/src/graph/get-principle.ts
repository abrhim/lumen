import type { Neo4jClient } from '@lumen/neo4j-http';

export interface PrincipleVerse {
  verse_id: string;
  reference: string;
  text: string;
}

export interface RelatedPrinciple {
  id: string;
  name: string;
  relationship: string;
}

export interface PrincipleResult {
  found: boolean;
  id?: string;
  name?: string;
  description?: string;
  verse_count?: number;
  verses?: PrincipleVerse[];
  related_principles?: RelatedPrinciple[];
  message?: string;
  suggestions?: Array<{ id: string; name: string }>;
}

export async function getPrinciple(
  neo4j: Neo4jClient,
  principleId: string,
): Promise<PrincipleResult> {
  const results = await neo4j.layer.lumen.query(
    `MATCH (p:{Principle} {id: $principleId})
     OPTIONAL MATCH (p)-[:TEACHES]-(v:{Verse})
     WITH p, collect(DISTINCT {
       verse_id: v.id,
       reference: v.reference,
       text: v.text
     })[0..20] AS verses
     OPTIONAL MATCH (p)-[r]-(related:{Principle})
     RETURN p.id AS id,
            p.name AS name,
            p.description AS description,
            verses,
            collect(DISTINCT {
              id: related.id,
              name: related.name,
              relationship: type(r)
            }) AS related_principles`,
    { principleId },
  );

  if (results.length === 0) {
    const candidates = await neo4j.layer.lumen.query<{ id: string; name: string }>(
      `MATCH (p:{Principle})
       WHERE toLower(p.name) CONTAINS toLower($name)
          OR p.id CONTAINS $name
       RETURN p.id AS id, p.name AS name
       ORDER BY size(p.id)
       LIMIT 10`,
      { name: principleId },
    );
    if (candidates.length > 0) {
      return {
        found: false,
        message: `Principle "${principleId}" not found. Did you mean one of these?`,
        suggestions: candidates,
      };
    }
    return { found: false, message: `Principle "${principleId}" not found.` };
  }

  const r = results[0] as any;
  return {
    found: true,
    id: r.id,
    name: r.name,
    description: r.description,
    verse_count: r.verses.filter((v: any) => v.verse_id !== null).length,
    verses: r.verses.filter((v: any) => v.verse_id !== null),
    related_principles: r.related_principles.filter((p: any) => p.id !== null),
  };
}
