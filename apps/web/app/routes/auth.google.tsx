import { getAuth, safeReturnTo } from "~/lib/auth.server";
import type { Route } from "./+types/auth.google";

/**
 * Google sign-in, leg 1 (task #17): starts the PKCE flow server-side.
 * signInWithOAuth writes the code-verifier cookie through the ssr
 * client, so the commit headers MUST ride this redirect (the same D4/D5
 * invariant as OTP) — a dropped verifier makes the callback exchange
 * fail on this very device. The Google consent page then returns to
 * Supabase's /auth/v1/callback, which forwards to our /auth/callback
 * with a one-time code.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
	const { supabase, commitHeaders } = getAuth(request, context.cloudflare.env);
	const url = new URL(request.url);
	const next = safeReturnTo(url.searchParams.get("next"));
	const nextQs = next !== "/" ? `?next=${encodeURIComponent(next)}` : "";

	const { data, error } = await supabase.auth.signInWithOAuth({
		provider: "google",
		options: { redirectTo: `${url.origin}/auth/callback${nextQs}` },
	});

	const headers = commitHeaders();
	headers.set("Cache-Control", "private, no-store");
	headers.set(
		"Location",
		error || !data?.url ? `/login${nextQs}${nextQs ? "&" : "?"}error=oauth` : data.url,
	);
	throw new Response(null, { status: 302, headers });
}
