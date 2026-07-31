import { useEffect, useState } from "react";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/login";
import { getAuth, getSessionUser, safeReturnTo } from "~/lib/auth.server";

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Sign in — candlestick.study" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	// B5 (A18): already signed in → honor the gate's return trip
	if (user) {
		throw redirect(safeReturnTo(new URL(request.url).searchParams.get("next")), { headers });
	}
	return data(null, { headers });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function action({ request, context }: Route.ActionArgs) {
	const form = await request.formData();
	const email = String(form.get("email") ?? "").trim();
	// resend failures must NOT collapse the success state — the earlier link
	// still works, so the UI stays on "check your email" and errs inline
	const isResend = form.get("intent") === "resend";
	if (!EMAIL_RE.test(email)) {
		return data({ sent: false as const, isResend, email, error: "Enter a valid email address." });
	}
	const { supabase, commitHeaders } = getAuth(request, context.cloudflare.env);
	const url = new URL(request.url);
	const origin = url.origin;
	// B5 (A18): the Form posts to the current URL, so ?next= survives the
	// submit — thread it into the email link's confirm destination
	const next = safeReturnTo(url.searchParams.get("next"));
	const confirmPath =
		next !== "/" ? `/auth/confirm?next=${encodeURIComponent(next)}` : "/auth/confirm";
	const { error } = await supabase.auth.signInWithOtp({
		email,
		options: { emailRedirectTo: `${origin}${confirmPath}`, shouldCreateUser: true },
	});
	// The PKCE code-verifier cookie is written during signInWithOtp — it MUST
	// ride this response or the link fails even on this device (plan D4).
	const headers = commitHeaders();
	if (error) {
		// Rate limits are not enumeration — be honest about the small mailer
		// (plan D10); everything else stays generic.
		const rateLimited = error.status === 429;
		return data(
			{
				sent: false as const,
				isResend,
				email,
				error: rateLimited
					? "The mailer only sends about two emails an hour and it's at its limit. Try again a little later."
					: "The sign-in link couldn't be sent right now. Try again in a moment.",
			},
			{ headers },
		);
	}
	return data({ sent: true as const, isResend, email, error: null }, { headers });
}

const RESEND_SECONDS = 60;

export default function Login({ actionData }: Route.ComponentProps) {
	const navigation = useNavigation();
	const pending = navigation.state === "submitting";
	const sent = actionData?.sent === true;
	// a failed RESEND keeps the success layout — the earlier link still works
	const failedResend = actionData?.sent === false && actionData.isResend;
	const showSuccess = sent || failedResend;
	const successEmail = actionData?.email ?? "";

	// resend guard: the built-in mailer is small, and each resend supersedes
	// the previous link — don't invite hammering (plan D10). Re-arm on every
	// send: RR returns a fresh actionData object per submit (incl. same-email
	// resends), so keying on its identity restarts the countdown each time.
	const [cooldown, setCooldown] = useState(0);
	useEffect(() => {
		if (sent) setCooldown(RESEND_SECONDS);
	}, [sent, actionData]);
	useEffect(() => {
		if (cooldown <= 0) return;
		const t = setInterval(() => setCooldown((c) => c - 1), 1000);
		return () => clearInterval(t);
	}, [cooldown > 0]);

	return (
		<main className="mx-auto max-w-2xl px-6 py-12">
			<h1 className="mt-3 font-display text-3xl font-medium tracking-tight">Sign in</h1>

			{/* pre-mounted live region — announcements only work if the container
			    exists before the content arrives */}
			<div aria-live="polite">
				{showSuccess ? (
					<div className="mt-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
						<p className="font-reading text-[17px] leading-relaxed text-ink">
							Check your email. A sign-in link is on its way to{" "}
							<strong className="font-semibold">{successEmail}</strong> — open it in this
							browser.
						</p>
						<p className="mt-3 font-reading text-sm leading-relaxed text-muted-foreground">
							If you request another link, only the newest email works.
						</p>
						<Form method="post" className="mt-6">
							<input type="hidden" name="email" value={successEmail} />
							<input type="hidden" name="intent" value="resend" />
							<button
								type="submit"
								disabled={cooldown > 0 || pending}
								className="min-h-11 rounded-md border border-rule2 px-4 font-ui text-sm font-semibold text-ink outline-none transition-colors duration-150 hover:border-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50"
							>
								{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend the link"}
							</button>
						</Form>
						{/* failed resend errs here, inside the kept success layout — the
						    earlier link still works */}
						<p className="mt-2 min-h-6 font-ui text-sm text-destructive" role="alert">
							{failedResend ? actionData.error : ""}
						</p>
					</div>
				) : null}
			</div>

			{!showSuccess && (
				<Form method="post" className="mt-6">
					<label
						htmlFor="email"
						className="font-ui text-xs font-normal text-muted-foreground"
					>
						Email
					</label>
					<input
						id="email"
						name="email"
						type="email"
						required
						autoComplete="email"
						autoCapitalize="none"
						spellCheck={false}
						defaultValue={actionData?.email ?? ""}
						aria-invalid={actionData?.error ? true : undefined}
						aria-describedby="email-error"
						className="mt-1.5 block h-11 w-full rounded-md border border-rule2 bg-surface px-3 font-reading text-base text-ink outline-none transition-colors duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
					/>
					{/* reserved slot — errors never shift the layout */}
					<p id="email-error" className="mt-1.5 min-h-6 font-ui text-sm text-destructive" role="alert">
						{actionData?.error ?? ""}
					</p>
					<button
						type="submit"
						disabled={pending}
						className="min-h-11 w-full rounded-md bg-primary px-4 font-ui text-sm font-semibold text-primary-foreground outline-none transition-opacity duration-150 hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
					>
						{pending ? "Sending…" : "Email me a sign-in link"}
					</button>
					<p className="mt-4 font-reading text-sm leading-relaxed text-muted-foreground">
						No password — a link signs you in. Your email is used only to send it.
					</p>
				</Form>
			)}
		</main>
	);
}
