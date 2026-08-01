import { getAuth, safeReturnTo } from "~/lib/auth.server";
import type { Route } from "./+types/auth.callback";

/**
 * Google sign-in, leg 2 (task #17): exchanges the one-time code for a
 * session. The session cookies ride the commit headers on this redirect
 * (D4/D5). Failures land back on /login with a plain error — never a
 * dead end. `next` is sanitized same-origin (the B5 posture).
 */
export async function loader({ request, context }: Route.LoaderArgs) {
	const { supabase, commitHeaders } = getAuth(request, context.cloudflare.env);
	const url = new URL(request.url);
	const next = safeReturnTo(url.searchParams.get("next"));
	const nextQs = next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
	const code = url.searchParams.get("code");

	let dest = next;
	if (!code) {
		dest = `/login${nextQs}${nextQs ? "&" : "?"}error=oauth`;
	} else {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (error) dest = `/login${nextQs}${nextQs ? "&" : "?"}error=oauth`;
	}

	const headers = commitHeaders();
	headers.set("Cache-Control", "private, no-store");
	headers.set("Location", dest);
	throw new Response(null, { status: 302, headers });
}
