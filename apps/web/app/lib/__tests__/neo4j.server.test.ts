import { describe, it, expect, vi } from "vitest";
import { makeNeo4j } from "../neo4j.server";

const env = {
	NEO4J_URI: "neo4j+s://testinstance.databases.neo4j.io",
	NEO4J_USER: "testuser",
	NEO4J_PASSWORD: "testpass",
	NEO4J_DATABASE: "testdb",
} as any;

function okFetch(body: unknown = { data: { fields: [], values: [] } }) {
	return vi.fn(
		async (_url: string, _init?: RequestInit) =>
			new Response(JSON.stringify(body), { status: 200 }),
	);
}

describe("makeNeo4j", () => {
	it("targets the Query v2 endpoint for the configured database over https", async () => {
		const fetchImpl = okFetch();
		const neo4j = makeNeo4j(env, fetchImpl as any);
		await neo4j.layer.lumen.query("MATCH (n:{Verse}) RETURN n LIMIT 1");
		const url = fetchImpl.mock.calls[0][0] as string;
		expect(url).toBe("https://testinstance.databases.neo4j.io/db/testdb/query/v2");
	});

	it("sends basic auth from env credentials", async () => {
		const fetchImpl = okFetch();
		const neo4j = makeNeo4j(env, fetchImpl as any);
		await neo4j.layer.lumen.query("MATCH (n:{Verse}) RETURN n");
		const init = fetchImpl.mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Basic " + btoa("testuser:testpass"),
		);
	});

	it("resolves {Verse} placeholders with the LM_ layer prefix", async () => {
		const fetchImpl = okFetch();
		const neo4j = makeNeo4j(env, fetchImpl as any);
		await neo4j.layer.lumen.query("MATCH (n:{Verse}) RETURN n");
		const init = fetchImpl.mock.calls[0][1] as RequestInit;
		expect(JSON.parse(init.body as string).statement).toContain("LM_Verse");
	});
});
