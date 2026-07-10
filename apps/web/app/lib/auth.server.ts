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

/** True when the request carries any Supabase auth cookie — signed-out
 * visitors (most traffic) skip all auth work in the root loader. */
export function hasAuthCookie(request: Request): boolean {
	return /(?:^|;\s*)sb-[^=;]*auth-token[^=;]*=/.test(request.headers.get("Cookie") ?? "");
}

/**
 * Root-loader session read (plan D5). Local ES256 verification via cached
 * JWKS on the happy path; when the access token is expired, getClaims
 * refreshes inline and the rotated cookies land in `headers` — which the
 * caller MUST attach even when `user` is null. Never throws; NO timeout
 * (abandoning a mid-flight refresh after rotation revokes the session).
 */
export async function getSessionUser(
	request: Request,
	env: AuthEnv,
	getAuthImpl: (request: Request, env: AuthEnv) => RequestAuth = getAuth,
): Promise<{ user: SessionUser | null; headers: Headers }> {
	const started = Date.now();
	const { supabase, commitHeaders } = getAuthImpl(request, env);
	if (!hasAuthCookie(request)) return { user: null, headers: commitHeaders() };
	try {
		const { data, error } = await supabase.auth.getClaims();
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
		return { user: null, headers: commitHeaders() };
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

/** logout returnTo guard (plan D7): same-origin PATH only. */
export function safeReturnTo(value: FormDataEntryValue | null): string {
	if (typeof value !== "string") return "/";
	if (!value.startsWith("/") || value.startsWith("//") || value.includes(":")) return "/";
	return value;
}
