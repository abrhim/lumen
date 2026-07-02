/**
 * Structural database contract: anything with Drizzle's `execute` shape.
 * Deliberately not `PostgresJsDatabase` — drizzle-orm's classes are nominal,
 * so importing them here couples consumers to this package's exact drizzle
 * instance (pnpm peer-variants make that fragile across a workspace).
 */
export interface Db {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	execute(query: any): Promise<any>;
}
