import {
	createServerClient,
	parseCookieHeader,
	serializeCookieHeader,
	type CookieOptions,
} from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "./log.server";

/**
 * 100% SSR auth (plan D1 — Abram's directive): the ONLY Supabase auth client
 * in the app. Server-side per request, sessions in httpOnly cookies, no
 * createBrowserClient anywhere. Mirrors db.server.ts discipline: per-request
 * construction (Workers I/O isolation), DI factory for tests.
 */

export interface AuthEnv {
	SUPABASE_URL: string;
	SUPABASE_PUBLISHABLE_KEY: string;
}

export interface RequestAuth {
	supabase: SupabaseClient;
	/** Set-Cookie headers accumulated by the client (verifier writes, token
	 * rotations, sign-out clears). EVERY response on an auth path must carry
	 * these — a dropped rotation commit permanently kills the session (D5). */
	commitHeaders: () => Headers;
}

/** Cookie flags (plan D1): server-only session ⇒ httpOnly always; secure
 * follows the request protocol (localhost dev is http). ssr's own options
 * (maxAge, chunking) pass through. */
export function buildCookieOptions(options: CookieOptions, requestUrl: string): CookieOptions {
	return {
		...options,
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: new URL(requestUrl).protocol === "https:",
	};
}

export function makeGetAuth(createClient: typeof createServerClient) {
	return function getAuth(request: Request, env: AuthEnv): RequestAuth {
		const headers = new Headers();
		const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
			auth: {
				flowType: "pkce",
				// no timers on Workers; getClaims/getUser refresh inline when
				// the access token is expired (verified: auth-js __loadSession)
				autoRefreshToken: false,
				detectSessionInUrl: false,
			},
			cookies: {
				getAll() {
					return parseCookieHeader(request.headers.get("Cookie") ?? "").map((c) => ({
						name: c.name,
						value: c.value ?? "",
					}));
				},
				setAll(cookies) {
					for (const { name, value, options } of cookies) {
						headers.append(
							"Set-Cookie",
							serializeCookieHeader(name, value, buildCookieOptions(options, request.url)),
						);
					}
				},
			},
		});
		return { supabase, commitHeaders: () => headers };
	};
}

export const getAuth = makeGetAuth(createServerClient);

export interface SessionUser {
	id: string;
	email: string | null;
}

/** True when the request carries a Supabase SESSION cookie (`sb-*-auth-token`,
 * chunked or not) — signed-out visitors (most traffic) skip all auth work in
 * the root loader. Deliberately does NOT match `-auth-token-code-verifier`
 * (F5): a visitor stuck mid-login holds only the verifier cookie and must not
 * pay a getClaims round trip on every request (COR-2). */
export function hasAuthCookie(request: Request): boolean {
	return /(?:^|;\s*)sb-[^=;]*-auth-token(?:\.\d+)?=/.test(request.headers.get("Cookie") ?? "");
}

/** Per-request session memo (B9). Both the root loader and a content-alias
 * loader (book/scripture 301s, F3) read the session on the SAME request; without
 * this they each call getClaims and, on an expired access token, refresh the
 * SAME refresh token in parallel — benign under gotrue's default 10s
 * reuse-detection interval, but a tightened/zeroed interval could revoke the
 * session (the very silent sign-out F3 fixes). Keyed on the Request identity RR
 * shares across a navigation's loaders; degrades to today's behavior (two reads)
 * if the runtime ever passes distinct Request objects. Only the real path is
 * memoized — test fakes pass a custom impl and want a fresh evaluation. */
const sessionMemo = new WeakMap<Request, Promise<{ user: SessionUser | null; headers: Headers }>>();

/**
 * Root-loader session read (plan D5). Local ES256 verification via cached
 * JWKS on the happy path; when the access token is expired, getClaims
 * refreshes inline and the rotated cookies land in `headers` — which the
 * caller MUST attach even when `user` is null. Never throws; NO timeout
 * (abandoning a mid-flight refresh after rotation revokes the session).
 */
export function getSessionUser(
	request: Request,
	env: AuthEnv,
	getAuthImpl: (request: Request, env: AuthEnv) => RequestAuth = getAuth,
): Promise<{ user: SessionUser | null; headers: Headers }> {
	if (getAuthImpl === getAuth) {
		const cached = sessionMemo.get(request);
		if (cached) return cached;
	}
	const result = readSessionUser(request, env, getAuthImpl);
	if (getAuthImpl === getAuth) sessionMemo.set(request, result);
	return result;
}

async function readSessionUser(
	request: Request,
	env: AuthEnv,
	getAuthImpl: (request: Request, env: AuthEnv) => RequestAuth,
): Promise<{ user: SessionUser | null; headers: Headers }> {
	const started = Date.now();
	// captured before the throw-prone getClaims so a mid-refresh rotation's
	// Set-Cookie still rides the response even when we degrade to null (D5/H6);
	// stays null only if construction itself threw (empty env — B6)
	let commitHeaders: (() => Headers) | null = null;
	try {
		// construct INSIDE the try — createServerClient throws synchronously on
		// empty env, and the root loader runs on every request (D5 never-throw)
		const auth = getAuthImpl(request, env);
		commitHeaders = auth.commitHeaders;
		if (!hasAuthCookie(request)) return { user: null, headers: commitHeaders() };
		const { data, error } = await auth.supabase.auth.getClaims();
		if (error || !data?.claims?.sub) return { user: null, headers: commitHeaders() };
		return {
			user: {
				id: data.claims.sub,
				email: typeof data.claims.email === "string" ? data.claims.email : null,
			},
			headers: commitHeaders(),
		};
	} catch (err) {
		logEvent("auth_user_degraded", {
			message: err instanceof Error ? err.message : String(err),
			elapsedMs: Date.now() - started,
		});
		// preserve any cookies the client wrote before throwing; fresh Headers
		// only if construction itself failed
		return { user: null, headers: commitHeaders ? commitHeaders() : new Headers() };
	}
}

/** Expired Set-Cookie for every sb-* cookie on the request — sign-out must
 * clear unconditionally (plan D6: auth-js's dead-session path returns early
 * WITHOUT clearing). */
export function clearAuthCookieHeaders(request: Request, headers: Headers): Headers {
	for (const { name } of parseCookieHeader(request.headers.get("Cookie") ?? "")) {
		if (name.startsWith("sb-")) {
			headers.append(
				"Set-Cookie",
				serializeCookieHeader(name, "", {
					...buildCookieOptions({}, request.url),
					maxAge: 0,
				}),
			);
		}
	}
	return headers;
}

/** logout returnTo guard (plan D7): same-origin PATH only. Resolve-and-compare
 * against a throwaway origin — a char-class guard misses backslashes, which
 * browsers normalize to `/` in Location headers ("/\evil.com" → https://evil.com/,
 * a real open redirect). Anything that resolves off-origin collapses to "/". */
export function safeReturnTo(value: FormDataEntryValue | null): string {
	if (typeof value !== "string" || !value.startsWith("/")) return "/";
	try {
		const u = new URL(value, "http://localhost");
		return u.origin === "http://localhost" ? u.pathname + u.search + u.hash : "/";
	} catch {
		return "/";
	}
}
