import { useEffect, useState } from "react";
import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

const THEMES = ["paper", "parchment", "linen", "ink"] as const;

/** Applies the stored theme before first paint — no flash of wrong theme. */
const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("lumen-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

function ThemeSelect() {
	const [theme, setTheme] = useState<string>("paper");
	useEffect(() => {
		setTheme(document.documentElement.dataset.theme ?? "paper");
	}, []);
	return (
		<select
			aria-label="Theme"
			value={theme}
			onChange={(e) => {
				const next = e.target.value;
				setTheme(next);
				document.documentElement.dataset.theme = next;
				try {
					localStorage.setItem("lumen-theme", next);
				} catch {
					/* private mode */
				}
			}}
			className="fixed right-4 top-4 z-40 rounded-md border border-rule2 bg-surface px-2 py-1 font-ui text-xs font-semibold text-muted-foreground shadow-sm transition-colors duration-150 hover:text-ink"
		>
			{THEMES.map((t) => (
				<option key={t} value={t}>
					{t}
				</option>
			))}
		</select>
	);
}

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

export default function App() {
	return (
		<>
			<ThemeSelect />
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
