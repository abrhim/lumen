import { Form, Link, data, redirect } from "react-router";
import type { EmailOtpType } from "@supabase/supabase-js";
import type { Route } from "./+types/auth.confirm";
import { getAuth, getSessionUser, safeReturnTo } from "~/lib/auth.server";

/**
 * Magic-link landing (plan D2/D3). Three arrival shapes:
 *  - ?token_hash=&type=   primary (after the email-template edit; cross-device)
 *  - ?code=               PKCE fallback (default template; same-device only)
 *  - ?error_code=         Supabase verify-failure redirects (e.g. otp_expired)
 * GET renders a POST interstitial — email scanners follow GETs and would burn
 * the one-time token; no auto-submit (scanners execute JS too).
 */

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Sign in — Lumen" }];
}

type ConfirmState =
	| { state: "already" }
	| { state: "confirm"; token_hash: string | null; type: string | null; code: string | null }
	| { state: "error"; reason: "expired" | "missing" };

export async function loader({ request, context }: Route.LoaderArgs) {
	const url = new URL(request.url);
	const token_hash = url.searchParams.get("token_hash");
	const code = url.searchParams.get("code");
	const errorCode = url.searchParams.get("error_code");

	// most common visitor to this page's error states: someone ALREADY signed
	// in who clicked the link again — never show them a false failure (D3)
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	if (user) return data({ state: "already" } satisfies ConfirmState, { headers });

	if (token_hash || code) {
		return data(
			{
				state: "confirm",
				token_hash,
				type: url.searchParams.get("type"),
				code,
			} satisfies ConfirmState,
			{ headers },
		);
	}
	return data(
		{ state: "error", reason: errorCode === "otp_expired" ? "expired" : "missing" } satisfies ConfirmState,
		{ headers },
	);
}

export async function action({ request, context }: Route.ActionArgs) {
	// verifyOtp mints a session with no cookie/verifier dependence, so a
	// cross-site auto-POST could sign a victim into an attacker's session
	// (login CSRF / fixation). Reject anything not same-origin (D14 gates
	// nothing today, but this is latent the moment per-user state ships).
	const site = request.headers.get("Sec-Fetch-Site");
	const origin = request.headers.get("Origin");
	const crossSite =
		(site && site !== "same-origin") ||
		(origin !== null && origin !== new URL(request.url).origin);
	if (crossSite) {
		return data({ error: "This request didn't come from Lumen. Start again from your email." }, { status: 403 });
	}
	const form = await request.formData();
	const token_hash = form.get("token_hash");
	const code = form.get("code");
	const { supabase, commitHeaders } = getAuth(request, context.cloudflare.env);

	// B5 (CP-6/A18): honor the login gate's return trip. safeReturnTo
	// resolve-and-compares (backslash-normalization open-redirect safe) and
	// collapses anything off-origin to "/".
	const next = safeReturnTo(new URL(request.url).searchParams.get("next"));

	if (typeof token_hash === "string" && token_hash) {
		const type = (typeof form.get("type") === "string" && form.get("type")
			? form.get("type")
			: "email") as EmailOtpType;
		const { error } = await supabase.auth.verifyOtp({ type, token_hash });
		if (!error) throw redirect(next, { headers: commitHeaders() });
		return data({ error: mapVerifyError(error.code, error.message) }, { headers: commitHeaders() });
	}

	if (typeof code === "string" && code) {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) throw redirect(next, { headers: commitHeaders() });
		return data({ error: mapVerifyError(error.code, error.message) }, { headers: commitHeaders() });
	}

	return data({ error: mapVerifyError(undefined, "missing token") }, { headers: commitHeaders() });
}

function mapVerifyError(code: string | undefined, message: string): string {
	if (/code verifier|verifier missing/i.test(message)) {
		return "This link was opened in a different browser than the one that requested it — some email apps open links in their own built-in browser. Request a new link here and open it directly.";
	}
	if (code === "otp_expired" || /expired|invalid/i.test(message)) {
		return "This link has expired or was already used. Request a new one — if you asked more than once, only the newest email works.";
	}
	return "This link couldn't sign you in. Request a fresh one below.";
}

export default function AuthConfirm({ loaderData, actionData }: Route.ComponentProps) {
	return (
		<main className="mx-auto max-w-2xl px-6 py-12">

			{loaderData.state === "already" ? (
				<>
					<h1 className="mt-3 font-display text-3xl font-medium tracking-tight">
						You're already signed in
					</h1>
					<Link
						to="/"
						className="mt-6 inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-ui text-sm font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-90"
					>
						Continue reading
					</Link>
				</>
			) : loaderData.state === "confirm" && !actionData?.error ? (
				<>
					<h1 className="mt-3 font-display text-3xl font-medium tracking-tight">
						Finish signing in
					</h1>
					<p className="mt-3 font-reading text-[17px] leading-relaxed text-ink">
						One tap to confirm it's you.
					</p>
					<Form method="post" className="mt-6">
						{loaderData.token_hash && (
							<input type="hidden" name="token_hash" value={loaderData.token_hash} />
						)}
						{loaderData.type && <input type="hidden" name="type" value={loaderData.type} />}
						{loaderData.code && <input type="hidden" name="code" value={loaderData.code} />}
						<button
							type="submit"
							className="min-h-11 w-full rounded-md bg-primary px-4 font-ui text-sm font-semibold text-primary-foreground outline-none transition-opacity duration-150 hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50"
						>
							Continue to sign in
						</button>
					</Form>
				</>
			) : (
				<>
					<h1 className="mt-3 font-display text-3xl font-medium tracking-tight">
						That link didn't work
					</h1>
					<p className="mt-3 font-reading text-[17px] leading-relaxed text-ink">
						{actionData?.error ??
							(loaderData.state === "error" && loaderData.reason === "expired"
								? "This link has expired or was already used. Request a new one — if you asked more than once, only the newest email works."
								: "This page needs a sign-in link from your email. Request one below.")}
					</p>
					<Link
						to="/login"
						className="mt-6 inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-ui text-sm font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-90"
					>
						Request a new link
					</Link>
				</>
			)}
		</main>
	);
}
