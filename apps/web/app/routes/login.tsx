import { useEffect, useRef, useState } from "react";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/login";
import { getAuth, getSessionUser } from "~/lib/auth.server";

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Sign in — Lumen" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	if (user) throw redirect("/", { headers });
	return data(null, { headers });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function action({ request, context }: Route.ActionArgs) {
	const form = await request.formData();
	const email = String(form.get("email") ?? "").trim();
	if (!EMAIL_RE.test(email)) {
		return data({ sent: false as const, email, error: "Enter a valid email address." });
	}
	const { supabase, commitHeaders } = getAuth(request, context.cloudflare.env);
	const origin = new URL(request.url).origin;
	const { error } = await supabase.auth.signInWithOtp({
		email,
		options: { emailRedirectTo: `${origin}/auth/confirm`, shouldCreateUser: true },
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
				email,
				error: rateLimited
					? "The mailer only sends about two emails an hour and it's at its limit. Try again a little later."
					: "The sign-in link couldn't be sent right now. Try again in a moment.",
			},
			{ headers },
		);
	}
	return data({ sent: true as const, email, error: null }, { headers });
}

const RESEND_SECONDS = 60;

export default function Login({ actionData }: Route.ComponentProps) {
	const navigation = useNavigation();
	const pending = navigation.state === "submitting";
	const sent = actionData?.sent === true;

	// resend guard: the built-in mailer is small, and each resend supersedes
	// the previous link — don't invite hammering (plan D10)
	const [cooldown, setCooldown] = useState(0);
	const sentAt = useRef<string | null>(null);
	useEffect(() => {
		if (sent && sentAt.current !== actionData.email) {
			sentAt.current = actionData.email;
			setCooldown(RESEND_SECONDS);
		}
	}, [sent, actionData]);
	useEffect(() => {
		if (cooldown <= 0) return;
		const t = setInterval(() => setCooldown((c) => c - 1), 1000);
		return () => clearInterval(t);
	}, [cooldown > 0]);

	return (
		<main className="mx-auto max-w-md px-6 py-16">
			<Link
				to="/"
				className="font-ui text-[11px] font-semibold uppercase tracking-[0.22em] text-faint transition-colors duration-150 hover:text-ink"
			>
				Lumen
			</Link>
			<h1 className="mt-3 font-display text-3xl font-medium tracking-tight">Sign in</h1>

			{/* pre-mounted live region — announcements only work if the container
			    exists before the content arrives */}
			<div aria-live="polite">
				{sent ? (
					<div className="mt-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
						<p className="font-reading text-[17px] leading-relaxed text-ink">
							Check your email. A sign-in link is on its way to{" "}
							<strong className="font-semibold">{actionData.email}</strong> — open it in this
							browser.
						</p>
						<p className="mt-3 font-reading text-sm leading-relaxed text-muted-foreground">
							If you request another link, only the newest email works.
						</p>
						<Form method="post" className="mt-6">
							<input type="hidden" name="email" value={actionData.email} />
							<button
								type="submit"
								disabled={cooldown > 0 || pending}
								className="min-h-11 rounded-md border border-rule2 px-4 font-ui text-sm font-semibold text-ink transition-colors duration-150 hover:border-primary disabled:cursor-default disabled:opacity-50"
							>
								{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend the link"}
							</button>
						</Form>
					</div>
				) : null}
			</div>

			{!sent && (
				<Form method="post" className="mt-6">
					<label
						htmlFor="email"
						className="font-ui text-xs font-semibold uppercase tracking-wide text-muted-foreground"
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
						className="mt-1.5 block h-11 w-full rounded-md border border-rule2 bg-surface px-3 font-reading text-base text-ink outline-none transition-colors duration-150 focus-visible:border-primary"
					/>
					{/* reserved slot — errors never shift the layout */}
					<p className="mt-1.5 min-h-6 font-ui text-sm text-destructive" role="alert">
						{actionData?.error ?? ""}
					</p>
					<button
						type="submit"
						disabled={pending}
						className="min-h-11 w-full rounded-md bg-primary px-4 font-ui text-sm font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
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
