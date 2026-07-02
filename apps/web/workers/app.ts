import { createRequestHandler } from "react-router";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Neo4jClient } from "@lumen/neo4j-http";
import { createDb } from "../app/lib/db.server";
import { makeNeo4j } from "../app/lib/neo4j.server";
import { applySecurityHeaders } from "../app/lib/headers.server";
import type { KVLike } from "../app/lib/cache.server";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
		db: PostgresJsDatabase;
		neo4j: Neo4jClient;
		cache: KVLike | undefined;
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

export default {
	async fetch(request, env, ctx) {
		// Per-request client (plan amendment 1): Workers forbids cross-request
		// socket reuse; Hyperdrive makes per-request connections cheap.
		const { db, end } = createDb(env);
		try {
			const response = await requestHandler(request, {
				cloudflare: { env, ctx },
				db,
				neo4j: makeNeo4j(env),
				// Cache is optional: absent binding degrades to live queries (COR-1)
				cache: (env as { CACHE?: KVNamespace }).CACHE,
			});
			return applySecurityHeaders(response);
		} finally {
			ctx.waitUntil(end());
		}
	},
} satisfies ExportedHandler<Env>;
