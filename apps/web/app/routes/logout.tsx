import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { clearAuthCookieHeaders, getAuth, safeReturnTo } from "~/lib/auth.server";
import { logEvent } from "~/lib/log.server";

/** Resource route: POST-only sign-out (CSRF: POST + SameSite=Lax), redirects
 * back to where the reader was (plan D7). Cookies clear UNCONDITIONALLY even
 * if token revocation fails (plan D6). */

export async function action({ request, context }: Route.ActionArgs) {
	const form = await request.formData();
	const returnTo = safeReturnTo(form.get("returnTo"));
	const { supabase, commitHeaders } = getAuth(request, context.cloudflare.env);
	try {
		await supabase.auth.signOut({ scope: "local" });
	} catch (err) {
		logEvent("auth_signout_degraded", {
			message: err instanceof Error ? err.message : String(err),
		});
	}
	throw redirect(returnTo, {
		headers: clearAuthCookieHeaders(request, commitHeaders()),
	});
}

export async function loader(_args: Route.LoaderArgs) {
	throw redirect("/");
}
