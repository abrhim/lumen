/**
 * Telling one read failure from another (issue #3).
 *
 * The admin list rendered a single generic message for every cause, so an
 * exhausted connection pool was indistinguishable from a broken query —
 * identifying the last occurrence took a manual investigation against
 * production. The classes differ in the one way a reader cares about: waiting
 * and trying again fixes a connection failure and will never fix a bad query.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It never returns Postgres's message text. PG renders the offending VALUE
 *    into its messages, so the message is a user-content carrier — the same
 *    rule notes.server.ts follows (B13/CP-14): cause + SQLSTATE reproduce the
 *    class, and nothing free-form ships. It reads the message only to spot the
 *    pooler (below) and then throws the text away.
 *  - It does not retry. Retrying into an exhausted pool is what deepens it.
 */

export type DbReadCause =
	| "pool_exhausted"
	| "connect_failed"
	| "permission"
	| "query"
	| "constraint"
	| "unknown";

export interface DbReadFailure {
	cause: DbReadCause;
	pgCode?: string;
	/** true when waiting and trying again could genuinely succeed */
	transient: boolean;
}

/** SQLSTATEs that mean "no usable connection", not "bad query". */
const CONNECTION_SQLSTATES = new Set([
	"53300", // too_many_connections
	"53400", // configuration_limit_exceeded
	"57P01", // admin_shutdown
	"57P02", // crash_shutdown
	"57P03", // cannot_connect_now
	"08000",
	"08001",
	"08003",
	"08004",
	"08006",
	"08007",
	"08P01",
]);

/** postgres.js and Node socket codes for the same condition. */
const CONNECTION_DRIVER_CODES = new Set([
	"CONNECT_TIMEOUT",
	"CONNECTION_CLOSED",
	"CONNECTION_DESTROYED",
	"CONNECTION_ENDED",
	"ECONNREFUSED",
	"ECONNRESET",
	"ETIMEDOUT",
	"EPIPE",
	"ENOTFOUND",
	"EHOSTUNREACH",
]);

/**
 * Supabase's pooler reports session-mode exhaustion in the MESSAGE, under a
 * generic SQLSTATE — reading the text is the only way to tell it apart from an
 * ordinary server error. Matched here, then discarded.
 */
const POOL_EXHAUSTED =
	/EMAXCONNSESSION|max clients reached|too many clients|remaining connection slots/i;

export function classifyReadError(err: unknown): DbReadFailure {
	// drizzle wraps the driver error, and its wrapper message embeds the query
	// text AND the bound params — so the CAUSE is both the accurate error and
	// the safe one to inspect (entitlements.server.ts keeps the same property).
	const driver = err instanceof Error && err.cause !== undefined ? err.cause : err;
	const code =
		driver && typeof driver === "object" && "code" in driver
			? String((driver as { code: unknown }).code)
			: "";
	const message = driver instanceof Error ? driver.message : "";

	if (POOL_EXHAUSTED.test(message)) {
		return { cause: "pool_exhausted", pgCode: code || undefined, transient: true };
	}
	if (CONNECTION_DRIVER_CODES.has(code) || CONNECTION_SQLSTATES.has(code)) {
		return { cause: "connect_failed", pgCode: code, transient: true };
	}
	if (code === "42501") return { cause: "permission", pgCode: code, transient: false };
	if (/^42/.test(code)) return { cause: "query", pgCode: code, transient: false };
	if (/^2[23]/.test(code)) return { cause: "constraint", pgCode: code, transient: false };
	return { cause: "unknown", pgCode: code || undefined, transient: false };
}
