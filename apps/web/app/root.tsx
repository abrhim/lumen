import { useEffect, useState } from "react";
import {
	Form,
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	data,
	useLocation,
	useRouteLoaderData,
} from "react-router";
import { PaletteIcon } from "lucide-react";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { getSessionUser } from "~/lib/auth.server";
import type { Route } from "./+types/root";
import "./app.css";

/** Session read for the whole app (plan D5: the SINGLE auth-read site).
 * getClaims verifies locally against cached JWKS (ES256 — probed); when the
 * token was refreshed mid-read the rotated cookies MUST ride this response,
 * even when user is null. */
export async function loader({ request, context }: Route.LoaderArgs) {
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	return data({ user }, { headers });
}

const THEMES = ["paper", "parchment", "linen", "ink"] as const;

/** Applies the stored theme before first paint — no flash of wrong theme. */
const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("lumen-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

function ThemeSelect() {
	const [theme, setTheme] = useState<string>("paper");
	useEffect(() => {
		setTheme(document.documentElement.dataset.theme ?? "paper");
	}, []);
	return (
		<Select
			value={theme}
			onValueChange={(next) => {
				setTheme(next);
				document.documentElement.dataset.theme = next;
				try {
					localStorage.setItem("lumen-theme", next);
				} catch {
					/* private mode */
				}
			}}
		>
			<SelectTrigger
				aria-label="Theme"
				size="sm"
				// visual h-7 with a 44px hit box (after: overlay) — Emil touch rule
				className="relative bg-surface font-ui text-xs font-semibold text-muted-foreground shadow-sm after:absolute after:-inset-2 after:content-['']"
			>
				<PaletteIcon className="size-3.5" aria-hidden="true" />
				<SelectValue />
			</SelectTrigger>
			<SelectContent align="end" className="font-ui text-xs">
				{THEMES.map((t) => (
					<SelectItem key={t} value={t} className="capitalize">
						{t}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
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

/** Signed-in presence in the fixed chrome (plan D10): chip only — the
 * signed-out invitation lives on the home header, never over a chapter. */
function AccountChip() {
	const root = useRouteLoaderData<typeof loader>("root");
	const location = useLocation();
	const user = root?.user;
	if (!user) return null;
	const email = user.email ?? "Account";
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={`Account: ${email}`}
				className="relative flex size-7 items-center justify-center rounded-full border border-rule2 bg-panel2 font-ui text-xs font-semibold uppercase text-ink shadow-sm outline-none transition-colors duration-150 hover:border-primary focus-visible:border-primary after:absolute after:-inset-2 after:content-['']"
			>
				{email.slice(0, 1)}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="font-ui text-xs">
				<DropdownMenuLabel className="max-w-56 truncate font-normal text-muted-foreground">
					{email}
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<Form method="post" action="/logout">
					<input
						type="hidden"
						name="returnTo"
						value={location.pathname + location.search}
					/>
					<DropdownMenuItem asChild>
						<button type="submit" className="w-full cursor-pointer">
							Sign out
						</button>
					</DropdownMenuItem>
				</Form>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export default function App() {
	return (
		<>
			<div className="fixed right-4 top-4 z-40 flex items-center gap-2">
				<AccountChip />
				<ThemeSelect />
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
