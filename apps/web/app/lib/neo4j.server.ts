import { createNeo4jClient, type Neo4jClient } from "@lumen/neo4j-http";

interface Neo4jEnv {
	NEO4J_URI: string;
	NEO4J_USER: string;
	NEO4J_PASSWORD: string;
	NEO4J_DATABASE: string;
}

const ENTITY_TYPES = [
	"Verse",
	"Principle",
	"Person",
	"Place",
	"Chapter",
	"Book",
	"Volume",
	"StrongsWord",
	"JstReading",
	"ChapterSummary",
	"NaveTopic",
	"Era",
	"Event",
	"Symbol",
];

/** 5s interactive budget — Aura cold-resume must degrade fast, not hang the page. */
const INTERACTIVE_TIMEOUT_MS = 5_000;

/** Per-request factory. The client is stateless config + fetch; ~0ms to build. */
export function makeNeo4j(env: Neo4jEnv, fetchImpl?: typeof globalThis.fetch): Neo4jClient {
	return createNeo4jClient({
		uri: env.NEO4J_URI,
		username: env.NEO4J_USER,
		password: env.NEO4J_PASSWORD,
		database: env.NEO4J_DATABASE,
		layers: { lumen: "LM" },
		entityTypes: ENTITY_TYPES,
		timeoutMs: INTERACTIVE_TIMEOUT_MS,
		...(fetchImpl ? { fetch: fetchImpl } : {}),
	});
}
