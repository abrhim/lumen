import { useEffect, useState } from "react";
import { Form, Link, data, useLocation } from "react-router";
import { getSessionUser } from "~/lib/auth.server";
import type { Route } from "./+types/me";

/**
 * Me — the settings route (Abram, 2026-07-31: a nav door named "Me" that
 * "opens a settings route that includes theme and other configurable
 * things"). Registers, words, no cards. Works signed-out (theme is a
 * device preference); the account register adapts. Type size joins here
 * with the Desk stroke (its ruling changes the base size too).
 */

const THEMES = ["paper", "parchment", "linen", "ink"] as const;
const THEME_SWATCH: Record<(typeof THEMES)[number], string> = {
	paper: "#fafaf7",
	parchment: "#f3ede1",
	linen: "#f3f6f7",
	ink: "#17181c",
};

export async function loader({ request, context }: Route.LoaderArgs) {
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	headers.set("Cache-Control", "private, no-store");
	return data({ email: user?.email ?? null }, { headers });
}

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Me — Lumen" }];
}

export default function Me({ loaderData }: Route.ComponentProps) {
	const { email } = loaderData;
	const location = useLocation();
	const [theme, setTheme] = useState<string>("paper");
	useEffect(() => {
		setTheme(document.documentElement.dataset.theme ?? "paper");
	}, []);
	const applyTheme = (next: (typeof THEMES)[number]) => {
		setTheme(next);
		document.documentElement.dataset.theme = next;
		try {
			localStorage.setItem("lumen-theme", next);
		} catch {
			/* private mode */
		}
	};

	return (
		<main className="mx-auto max-w-2xl px-6 py-12">
			<header className="border-b border-rule pb-6">
				<h1 className="font-display text-3xl font-medium tracking-tight">Me</h1>
				<p className="mt-2 font-reading italic text-muted-foreground">
					How Lumen reads, and who is reading.
				</p>
			</header>

			<section aria-labelledby="me-theme" className="mt-10">
				<h2
					id="me-theme"
					className="font-ui text-[11px] font-bold uppercase tracking-[0.14em] text-faint"
				>
					Theme
				</h2>
				<div role="radiogroup" aria-label="Theme" className="mt-4 flex flex-col gap-1">
					{THEMES.map((t) => (
						<button
							key={t}
							type="button"
							role="radio"
							aria-checked={theme === t}
							onClick={() => applyTheme(t)}
							className={`-mx-2 flex w-fit items-center gap-3 rounded-md px-2 py-2 font-ui text-sm capitalize outline-none transition-colors duration-150 hover:bg-sel focus-visible:bg-sel ${
								theme === t
									? "text-ink underline decoration-dotted underline-offset-4"
									: "text-muted-foreground"
							}`}
						>
							<span
								aria-hidden="true"
								className="size-4 rounded-full border border-rule2"
								style={{ backgroundColor: THEME_SWATCH[t] }}
							/>
							{t}
						</button>
					))}
				</div>
			</section>

			<section aria-labelledby="me-account" className="mt-10 border-t border-rule pt-6">
				<h2
					id="me-account"
					className="font-ui text-[11px] font-bold uppercase tracking-[0.14em] text-faint"
				>
					Account
				</h2>
				{email ? (
					<div className="mt-4 flex items-baseline justify-between gap-4">
						<p className="min-w-0 truncate font-reading text-[15px] text-ink">{email}</p>
						<Form method="post" action="/logout">
							<input type="hidden" name="returnTo" value={location.pathname} />
							<button
								type="submit"
								className="font-ui text-sm text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors duration-150 hover:text-ink"
							>
								Sign out
							</button>
						</Form>
					</div>
				) : (
					<p className="mt-4 font-reading text-[15px] text-muted-foreground">
						Reading as a guest —{" "}
						<Link
							to="/login?next=/me"
							className="text-ink underline decoration-dotted underline-offset-4 hover:text-primary"
						>
							sign in
						</Link>
						.
					</p>
				)}
			</section>
		</main>
	);
}
