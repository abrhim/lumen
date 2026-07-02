import { describe, it, expect, vi } from "vitest";
import { makeCreateDb } from "../db.server";

const env = { HYPERDRIVE: { connectionString: "postgresql://u:p@host:5432/db" } } as any;

function mockClient() {
	const client: any = () => {};
	client.end = vi.fn(async () => {});
	client.options = { parsers: {}, serializers: {} };
	return client;
}

describe("createDb (per-request — Workers forbids cross-request I/O reuse)", () => {
	it("constructs a fresh postgres client on every call", () => {
		const factory = vi.fn(() => mockClient());
		const createDb = makeCreateDb(factory as any);
		const a = createDb(env);
		const b = createDb(env);
		expect(factory).toHaveBeenCalledTimes(2);
		expect(a.db).not.toBe(b.db);
	});

	it("passes prepare: false (Hyperdrive does not support prepared statements) and fetch_types: false", () => {
		const factory = vi.fn(() => mockClient());
		const createDb = makeCreateDb(factory as any);
		createDb(env);
		expect(factory).toHaveBeenCalledWith(
			env.HYPERDRIVE.connectionString,
			expect.objectContaining({ prepare: false, fetch_types: false }),
		);
	});

	it("end() closes the underlying client", async () => {
		const client = mockClient();
		const factory = vi.fn(() => client);
		const createDb = makeCreateDb(factory as any);
		const { end } = createDb(env);
		await end();
		expect(client.end).toHaveBeenCalledTimes(1);
	});

	it("propagates construction failure (next request constructs fresh anyway)", () => {
		const factory = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error("boom");
			})
			.mockImplementation(() => mockClient());
		const createDb = makeCreateDb(factory as any);
		expect(() => createDb(env)).toThrow("boom");
		expect(() => createDb(env)).not.toThrow();
	});
});
