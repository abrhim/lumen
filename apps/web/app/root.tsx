import { Component, type ReactNode } from "react";
import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	data,
} from "react-router";
import { AppMenu } from "~/components/AppMenu";
import { SearchModal, SearchOrbAnchor } from "~/components/SearchModal";
import { getSessionUser } from "~/lib/auth.server";
import type { Route } from "./+types/root";
import "./app.css";

/** Session read for the whole app (plan D5: the SINGLE auth-read site).
 * getClaims verifies locally against cached JWKS (ES256 — probed); when the
 * token was refreshed mid-read the rotated cookies MUST ride this response,
 * even when user is null.
 *
 * INVARIANT (verified against react-router 7.9.6): a thrown `redirect()` from
 * ANY loader short-circuits and does NOT merge this root loader's Set-Cookie.
 * So EVERY route that throws a redirect must self-carry the session commit
 * headers on it — not just auth routes: login/confirm do, and the content
 * alias 301s in scripture.tsx/book.tsx do too (F3); logout is a resource
 * route where this loader never runs. Do not add a route that redirects while
 * relying on the root loader to persist a token rotation — the rotated cookie
 * would be dropped (an intermittent silent sign-out). */
export async function loader({ request, context }: Route.LoaderArgs) {
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	return data({ user }, { headers });
}

/** Applies the stored theme before first paint — no flash of wrong theme. */
const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("lumen-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export const links: Route.LinksFunction = () => [
	{ rel: "preconnect", href: "https://fonts.googleapis.com" },
	{
		rel: "preconnect",
		href: "https://fonts.gstatic.com",
		crossOrigin: "anonymous",
	},
	{
		rel: "stylesheet",
		href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Archivo:wght@500;600;700&display=swap",
	},
];

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
				<Meta />
				<Links />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

/** The universal menu replaces the former AccountChip + ThemeSelect cluster
 * (proto/podcast-ui). Signed-in presence stays chip-only in the fixed chrome
 * (plan D10); the signed-out invitation lives on the home header — the menu's
 * Sign in item is user-summoned, not ambient. */

/** Δ BRRU-3: a broken search chrome must never take the app shell with it.
 * The fallback is a plain-anchor orb to /search — degraded, still a door. This
 * class boundary catches CLIENT render throws only; the SSR path is made safe
 * by SearchModal rendering the same static anchor server-side (B19). */
class SearchChromeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	render() {
		if (this.state.failed) {
			return <SearchOrbAnchor />;
		}
		return this.props.children;
	}
}

export default function App() {
	return (
		<>
			<div className="fixed right-4 top-4 z-40 flex items-center gap-2">
				<SearchChromeBoundary>
					<SearchModal />
				</SearchChromeBoundary>
				<AppMenu />
			</div>
			<Outlet />
		</>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let message = "Oops!";
	let details = "An unexpected error occurred.";
	let stack: string | undefined;

	if (isRouteErrorResponse(error)) {
		message = error.status === 404 ? "404" : "Error";
		details =
			error.status === 404
				? typeof error.data === "string" && error.data
					? error.data
					: "The requested page could not be found."
				: error.statusText || details;
	} else if (import.meta.env.DEV && error && error instanceof Error) {
		details = error.message;
		stack = error.stack;
	}

	return (
		<main className="pt-16 p-4 container mx-auto">
			<h1 className="font-display text-3xl">{message}</h1>
			<p className="mt-2 text-muted-foreground">{details}</p>
			<p className="mt-4">
				<a href="/" className="text-primary underline">
					Back to the library
				</a>
			</p>
			{stack && (
				<pre className="w-full p-4 overflow-x-auto">
					<code>{stack}</code>
				</pre>
			)}
		</main>
	);
}
