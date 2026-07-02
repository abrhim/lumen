import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { logEvent } from "./log.server";

type PostgresFactory = typeof postgres;

interface HyperdriveEnv {
	HYPERDRIVE: { connectionString: string };
}

export interface RequestDb {
	db: PostgresJsDatabase;
	/** Close the client; call via ctx.waitUntil after the response is sent. */
	end: () => Promise<void>;
}

/**
 * Per-request client (plan amendment 1). Workers forbids sharing sockets
 * across requests ("Cannot perform I/O on behalf of a different request"),
 * so there is deliberately NO module-scoped caching here. Hyperdrive pools
 * upstream at the edge, which is what makes per-request setup cheap.
 *
 * `prepare: false` is required — Hyperdrive multiplexes connections and does
 * not support prepared statements. `fetch_types: false` skips postgres.js's
 * startup type query (saves a round trip per request).
 */
export function makeCreateDb(postgresFactory: PostgresFactory) {
	return function createDb(env: HyperdriveEnv): RequestDb {
		try {
			const client = postgresFactory(env.HYPERDRIVE.connectionString, {
				prepare: false,
				max: 5,
				fetch_types: false,
			});
			return {
				db: drizzle(client),
				end: () => client.end(),
			};
		} catch (error) {
			logEvent("pg_client_init_failed", {
				message: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	};
}

export const createDb = makeCreateDb(postgres);
