import { describe, it, expect, vi, beforeEach } from "vitest";

// Route-level harness (H2–H4): mock the auth lib boundary, exercise the
// real loaders/actions. Shapes MUST match the real contract (CAPI-1).
const { signInWithOtp, verifyOtp, exchangeCodeForSession, signOut, commitHeaders, getSessionUser } =
	vi.hoisted(() => ({
		signInWithOtp: vi.fn(),
		verifyOtp: vi.fn(),
		exchangeCodeForSession: vi.fn(),
		signOut: vi.fn(),
		commitHeaders: vi.fn(() => new Headers({ "x-committed": "1" })),
		getSessionUser: vi.fn(async () => ({ user: null as unknown, headers: new Headers() })),
	}));

vi.mock("~/lib/auth.server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("~/lib/auth.server")>();
	return {
		...actual,
		getAuth: vi.fn(() => ({
			supabase: { auth: { signInWithOtp, verifyOtp, exchangeCodeForSession, signOut } },
			commitHeaders,
		})),
		getSessionUser,
	};
});

import { action as loginAction, loader as loginLoader } from "../login";
import { action as confirmAction, loader as confirmLoader } from "../auth.confirm";
import { action as logoutAction, loader as logoutLoader } from "../logout";

const ctx = { cloudflare: { env: {} } } as never;
const args = (request: Request) => ({ request, context: ctx, params: {} }) as never;

function postForm(url: string, fields: Record<string, string>) {
	const body = new URLSearchParams(fields);
	return new Request(url, {
		method: "POST",
		body,
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	getSessionUser.mockResolvedValue({ user: null, headers: new Headers() });
});

describe("H2 login action", () => {
	it("valid email → signInWithOtp with origin-derived emailRedirectTo, headers committed (D4)", async () => {
		signInWithOtp.mockResolvedValue({ error: null });
		const res = await loginAction(args(postForm("https://lumen.example/login", { email: " a@b.co " })));
		expect(signInWithOtp).toHaveBeenCalledWith({
			email: "a@b.co",
			options: { emailRedirectTo: "https://lumen.example/auth/confirm", shouldCreateUser: true },
		});
		expect(res.data).toMatchObject({ sent: true, email: "a@b.co" });
		expect(res.init?.headers).toBeDefined(); // verifier cookie rides the success response
	});

	it("invalid email → field error, otp NOT called", async () => {
		const res = await loginAction(args(postForm("https://x/login", { email: "not-an-email" })));
		expect(signInWithOtp).not.toHaveBeenCalled();
		expect(res.data.sent).toBe(false);
		expect(res.data.error).toMatch(/valid email/i);
	});

	it("supabase error → generic copy (no enumeration), 429 → honest rate-limit copy", async () => {
		signInWithOtp.mockResolvedValue({ error: { status: 500, message: "smtp exploded" } });
		const generic = await loginAction(args(postForm("https://x/login", { email: "a@b.co" })));
		expect(generic.data.error).not.toMatch(/smtp|exist|account/i);
		signInWithOtp.mockResolvedValue({ error: { status: 429, message: "rate limit" } });
		const limited = await loginAction(args(postForm("https://x/login", { email: "a@b.co" })));
		expect(limited.data.error).toMatch(/hour/i);
	});

	it("loader: signed-in users bounce to /", async () => {
		getSessionUser.mockResolvedValue({ user: { id: "u1", email: "a@b.co" }, headers: new Headers() });
		await expect(loginLoader(args(new Request("https://x/login")))).rejects.toMatchObject({ status: 302 });
	});
});

describe("H3 confirm route", () => {
	it("GET with token_hash → interstitial state (no verification on GET — scanner shield)", async () => {
		const res = await confirmLoader(args(new Request("https://x/auth/confirm?token_hash=th&type=email")));
		expect(res.data).toMatchObject({ state: "confirm", token_hash: "th", type: "email" });
		expect(verifyOtp).not.toHaveBeenCalled();
	});

	it("GET while already signed in → 'already' state, never a false failure", async () => {
		getSessionUser.mockResolvedValue({ user: { id: "u1", email: "a@b.co" }, headers: new Headers() });
		const res = await confirmLoader(args(new Request("https://x/auth/confirm?token_hash=th")));
		expect(res.data.state).toBe("already");
	});

	it("GET with Supabase error redirect (otp_expired in query) → expired error state", async () => {
		const res = await confirmLoader(
			args(new Request("https://x/auth/confirm?error=access_denied&error_code=otp_expired")),
		);
		expect(res.data).toMatchObject({ state: "error", reason: "expired" });
	});

	it("B4: cross-site POST is rejected 403 before verifyOtp runs (login-CSRF guard)", async () => {
		const request = postForm("https://x/auth/confirm", { token_hash: "th" });
		request.headers.set("Sec-Fetch-Site", "cross-site");
		const res = await confirmAction(args(request));
		expect(res.init?.status).toBe(403);
		expect(verifyOtp).not.toHaveBeenCalled();
	});

	it("B4: hostile Origin header (no Sec-Fetch-Site) is also rejected", async () => {
		const request = postForm("https://x/auth/confirm", { token_hash: "th" });
		request.headers.set("Origin", "https://evil.example");
		const res = await confirmAction(args(request));
		expect(res.init?.status).toBe(403);
		expect(verifyOtp).not.toHaveBeenCalled();
	});

	it("POST token_hash → verifyOtp, success redirects / with committed headers", async () => {
		verifyOtp.mockResolvedValue({ error: null });
		await expect(
			confirmAction(args(postForm("https://x/auth/confirm", { token_hash: "th", type: "email" }))),
		).rejects.toMatchObject({ status: 302 });
		expect(verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "th" });
	});

	it("POST code → exchangeCodeForSession; verifier-missing error names the different-browser case", async () => {
		exchangeCodeForSession.mockResolvedValue({
			error: { code: undefined, message: "code verifier missing" },
		});
		const res = await confirmAction(args(postForm("https://x/auth/confirm", { code: "abc" })));
		expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
		expect(res.data.error).toMatch(/different browser/i);
	});

	it("POST expired token → newest-email copy, no redirect loop (200 data)", async () => {
		verifyOtp.mockResolvedValue({ error: { code: "otp_expired", message: "expired" } });
		const res = await confirmAction(args(postForm("https://x/auth/confirm", { token_hash: "th" })));
		expect(res.data.error).toMatch(/newest email/i);
	});
});

describe("H4 logout route", () => {
	it("POST: signs out scope-local, clears sb cookies unconditionally, redirects to validated returnTo", async () => {
		signOut.mockResolvedValue({ error: null });
		const request = postForm("https://x/logout", { returnTo: "/scripture/john/3?verse=16" });
		request.headers.set("Cookie", "sb-proj-auth-token=v; theme=paper");
		const err = await logoutAction(args(request)).catch((e) => e);
		expect(err.status).toBe(302);
		expect(err.headers.get("Location")).toBe("/scripture/john/3?verse=16");
		expect(signOut).toHaveBeenCalledWith({ scope: "local" });
		expect(err.headers.getSetCookie().join()).toContain("Max-Age=0");
	});

	it("POST with hostile returnTo → /; signOut throwing still clears cookies (D6)", async () => {
		signOut.mockRejectedValue(new Error("gotrue down"));
		const request = postForm("https://x/logout", { returnTo: "https://evil.example" });
		request.headers.set("Cookie", "sb-proj-auth-token=v");
		const err = await logoutAction(args(request)).catch((e) => e);
		expect(err.status).toBe(302);
		expect(err.headers.get("Location")).toBe("/");
		expect(err.headers.getSetCookie().join()).toContain("Max-Age=0");
	});

	it("GET → redirect / without signOut", async () => {
		const err = await logoutLoader(args(new Request("https://x/logout"))).catch((e) => e);
		expect(err.status).toBe(302);
		expect(signOut).not.toHaveBeenCalled();
	});
});
