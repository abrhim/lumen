import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

/**
 * Session-pool hygiene (house memory: dev-server kills leave zombie
 * `lumen_read` sessions; Supabase session pool caps at 15). Back-to-back
 * Playwright runs inherit the previous run's corpses and the app's data
 * routes (api.notes-linked, search legs) hang past spec timeouts — the
 * linked-rail LIVE spec was the canary. Terminate idle sessions up front
 * so every run starts with a clean pool.
 *
 * Admin DSN comes from repo-root .env (same sourcing rule as the service
 * key in session.ts). Missing DSN degrades to a warning — the suite can
 * still run, it just inherits whatever the pool holds.
 */
export default async function globalSetup() {
	let dsn = process.env.DATABASE_URL;
	// walk up from cwd (apps/web when playwright runs) to the repo root —
	// __dirname/import.meta are transpile-mode-dependent here, cwd is not
	let dir = process.cwd();
	for (let i = 0; !dsn && i < 5; i++) {
		try {
			const env = readFileSync(join(dir, ".env"), "utf8");
			dsn = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
		} catch {
			// no .env at this level — keep walking
		}
		dir = join(dir, "..");
	}
	if (!dsn) {
		console.warn("[global-setup] no DATABASE_URL — skipping lumen_read pool cleanup");
		return;
	}
	const client = new Client({ connectionString: dsn });
	try {
		await client.connect();
		const { rows } = await client.query(
			"select count(pg_terminate_backend(pid)) as n from pg_stat_activity where usename = 'lumen_read' and state = 'idle'",
		);
		if (Number(rows[0]?.n) > 0) {
			console.log(`[global-setup] terminated ${rows[0].n} idle lumen_read session(s)`);
		}
	} catch (err) {
		console.warn(`[global-setup] pool cleanup failed: ${(err as Error).message}`);
	} finally {
		await client.end().catch(() => {});
	}
}
