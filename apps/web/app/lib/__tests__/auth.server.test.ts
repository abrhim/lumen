import { describe, it, expect, vi } from "vitest";
import {
	buildCookieOptions,
	makeGetAuth,
	getSessionUser,
	hasAuthCookie,
	clearAuthCookieHeaders,
	safeReturnTo,
	type RequestAuth,
} from "../auth.server";

const ENV = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" };

function req(url = "https://lumen.example/", cookie?: string) {
	return new Request(url, { headers: cookie ? { Cookie: cookie } : {} });
}

/** Fake RequestAuth whose getClaims behavior we script; setCookies simulates
 * what the ssr client writes via setAll during the call. */
function fakeAuth(opts: {
	claims?: { sub: string; email?: string } | null;
	error?: boolean;
	throws?: boolean;
	setCookies?: string[];
}): (request: Request, env: typeof ENV) => RequestAuth {
	return () => {
		const headers = new Headers();
		return {
			supabase: {
				auth: {
					getClaims: vi.fn(async () => {
						for (const c of opts.setCookies ?? []) headers.append("Set-Cookie", c);
						if (opts.throws) throw new Error("network sadness");
						if (opts.error) return { data: null, error: { message: "bad" } };
						return { data: { claims: opts.claims ?? null }, error: null };
					}),
				},
			} as unknown as RequestAuth["supabase"],
			commitHeaders: () => headers,
		};
	};
}

describe("H1 cookie adapter", () => {
	it("forces httpOnly + lax + path=/ and follows the request protocol for secure", () => {
		const https = buildCookieOptions({ maxAge: 400 }, "https://lumen.example/login");
		expect(https).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", secure: true, maxAge: 400 });
		const http = buildCookieOptions({}, "http://localhost:5173/login");
		expect(http.secure).toBe(false);
	});

	it("real ssr client: setAll-written cookies come out of commitHeaders with the forced flags", async () => {
		// capture the cookie adapter the factory hands to createServerClient
		let adapter: {
			getAll: () => { name: string; value: string }[];
			setAll: (cs: { name: string; value: string; options: Record<string, unknown> }[]) => void;
		} | null = null;
		const createClient = vi.fn((_u: string, _k: string, config: { cookies: typeof adapter }) => {
			adapter = config.cookies;
			return { auth: {} };
		});
		const getAuth = makeGetAuth(createClient as never);
		const { commitHeaders } = getAuth(req("https://lumen.example/", "sb-proj-auth-token=abc; other=1"), ENV);
		expect(adapter!.getAll()).toContainEqual({ name: "sb-proj-auth-token", value: "abc" });
		adapter!.setAll([
			{ name: "sb-proj-auth-token.0", value: "chunk0", options: { maxAge: 34560000 } },
			{ name: "sb-proj-auth-token.1", value: "chunk1", options: { maxAge: 34560000 } },
		]);
		const set = commitHeaders().getSetCookie();
		expect(set).toHaveLength(2); // chunked session survives (platform#3)
		for (const c of set) {
			expect(c).toContain("HttpOnly");
			expect(c).toContain("SameSite=Lax");
			expect(c).toContain("Path=/");
			expect(c).toContain("Secure");
			expect(c).toContain("Max-Age=34560000"); // ssr's 400d rides through (D4)
		}
	});
});

describe("H5 getSessionUser — both directions (tske B2)", () => {
	it("happy path returns the user", async () => {
		const { user } = await getSessionUser(
			req("https://x/", "sb-proj-auth-token=jwt"),
			ENV,
			fakeAuth({ claims: { sub: "u1", email: "a@b.co" } }),
		);
		expect(user).toEqual({ id: "u1", email: "a@b.co" });
	});

	it("no auth cookie → null WITHOUT calling getClaims", async () => {
		const impl = fakeAuth({ claims: { sub: "u1" } });
		const built = impl(req(), ENV);
		const spy = built.supabase.auth.getClaims as ReturnType<typeof vi.fn>;
		const { user } = await getSessionUser(req("https://x/", "theme=paper"), ENV, () => built);
		expect(user).toBeNull();
		expect(spy).not.toHaveBeenCalled();
	});

	it("throwing client degrades to null, never throws", async () => {
		const { user } = await getSessionUser(
			req("https://x/", "sb-proj-auth-token=jwt"),
			ENV,
			fakeAuth({ throws: true }),
		);
		expect(user).toBeNull();
	});
});

describe("H6 rotation commit (D5 — the silent-sign-out killer)", () => {
	it("cookies written during getClaims ride the response EVEN when degrading to null", async () => {
		const rotated = ["sb-proj-auth-token.0=new; Path=/; HttpOnly", "sb-proj-auth-token.1=new2; Path=/; HttpOnly"];
		const { user, headers } = await getSessionUser(
			req("https://x/", "sb-proj-auth-token=expired"),
			ENV,
			fakeAuth({ throws: true, setCookies: rotated }),
		);
		expect(user).toBeNull();
		expect(headers.getSetCookie()).toEqual(rotated);
	});

	it("and on the happy refresh path", async () => {
		const rotated = ["sb-proj-auth-token=new; Path=/; HttpOnly"];
		const { user, headers } = await getSessionUser(
			req("https://x/", "sb-proj-auth-token=expired"),
			ENV,
			fakeAuth({ claims: { sub: "u1" }, setCookies: rotated }),
		);
		expect(user?.id).toBe("u1");
		expect(headers.getSetCookie()).toEqual(rotated);
	});
});

describe("hasAuthCookie", () => {
	it("matches chunked and unchunked sb auth cookies, not other sb- or lookalike cookies", () => {
		expect(hasAuthCookie(req("https://x/", "sb-proj-auth-token=v"))).toBe(true);
		expect(hasAuthCookie(req("https://x/", "a=1; sb-proj-auth-token.0=v"))).toBe(true);
		expect(hasAuthCookie(req("https://x/", "sb-proj-auth-token-code-verifier=v"))).toBe(true);
		expect(hasAuthCookie(req("https://x/", "theme=paper"))).toBe(false);
		expect(hasAuthCookie(req("https://x/"))).toBe(false);
	});
});

describe("clearAuthCookieHeaders (D6 — unconditional clearing)", () => {
	it("expires every sb-* cookie on the request, leaves others alone", () => {
		const headers = clearAuthCookieHeaders(
			req("https://x/", "sb-proj-auth-token.0=a; sb-proj-auth-token.1=b; theme=paper"),
			new Headers(),
		);
		const set = headers.getSetCookie();
		expect(set).toHaveLength(2);
		for (const c of set) expect(c).toContain("Max-Age=0");
		expect(set.join()).not.toContain("theme");
	});
});

describe("safeReturnTo (D7)", () => {
	it("allows same-origin paths, rejects everything else", () => {
		expect(safeReturnTo("/scripture/john/3?verse=16")).toBe("/scripture/john/3?verse=16");
		expect(safeReturnTo("https://evil.example/")).toBe("/");
		expect(safeReturnTo("//evil.example")).toBe("/");
		expect(safeReturnTo("/x:javascript")).toBe("/");
		expect(safeReturnTo(null)).toBe("/");
	});
});
