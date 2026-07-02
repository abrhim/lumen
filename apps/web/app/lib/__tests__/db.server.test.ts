import { describe, it, expect, vi } from "vitest";
import { makeGetDb } from "../db.server";

const env = { HYPERDRIVE: { connectionString: "postgresql://u:p@host:5432/db" } } as any;

function mockPostgresFactory() {
	// postgres() returns a tagged-template client; drizzle only needs an object
	const client: any = () => {};
	client.unsafe = vi.fn();
	client.options = { parsers: {}, serializers: {} };
	return vi.fn(() => client);
}

describe("getDb singleton", () => {
	it("constructs the postgres client exactly once across calls", () => {
		const factory = mockPostgresFactory();
		const getDb = makeGetDb(factory as any);
		const a = getDb(env);
		const b = getDb(env);
		expect(factory).toHaveBeenCalledTimes(1);
		expect(a).toBe(b);
	});

	it("passes prepare: false (Hyperdrive does not support prepared statements)", () => {
		const factory = mockPostgresFactory();
		const getDb = makeGetDb(factory as any);
		getDb(env);
		expect(factory).toHaveBeenCalledWith(
			env.HYPERDRIVE.connectionString,
			expect.objectContaining({ prepare: false }),
		);
	});

	it("retries construction on next call after an init failure", () => {
		const client: any = () => {};
		client.options = { parsers: {}, serializers: {} };
		const factory = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error("boom");
			})
			.mockImplementation(() => client);
		const getDb = makeGetDb(factory as any);
		expect(() => getDb(env)).toThrow("boom");
		expect(() => getDb(env)).not.toThrow();
		expect(factory).toHaveBeenCalledTimes(2);
	});
});
