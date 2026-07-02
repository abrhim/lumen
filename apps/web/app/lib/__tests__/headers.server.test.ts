import { describe, it, expect } from "vitest";
import { applySecurityHeaders } from "../headers.server";

describe("applySecurityHeaders", () => {
	it("sets the four security headers", () => {
		const res = applySecurityHeaders(new Response("ok"));
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(res.headers.get("X-Frame-Options")).toBe("DENY");
		expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
		expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
	});

	it("preserves status, body, and existing headers", async () => {
		const original = new Response("payload", {
			status: 201,
			headers: { "Content-Type": "text/plain", "Set-Cookie": "a=1" },
		});
		const res = applySecurityHeaders(original);
		expect(res.status).toBe(201);
		expect(await res.text()).toBe("payload");
		expect(res.headers.get("Content-Type")).toBe("text/plain");
		expect(res.headers.get("Set-Cookie")).toBe("a=1");
	});
});
