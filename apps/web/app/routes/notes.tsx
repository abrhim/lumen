import { Link, data, redirect } from "react-router";
import { getSessionUser } from "~/lib/auth.server";
import { listNotes } from "~/lib/notes.server";
import { deriveNoteTitle, deriveNoteSnippet, UNTITLED_NOTE } from "~/lib/notes-derive";
import type { Route } from "./+types/notes";

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Your notes · Lumen" }];
}

/**
 * personal-notes /notes index (A13/A18). Signed-out gate is a REDIRECT, not
 * 404-concealment — notes' existence is public; the divergence from
 * admin.users is a ratified decision (A18). The redirect carries a
 * same-origin `next` so login can return the reader to where they were.
 * Every outcome carries session rotation headers (CF-31, the B4 class).
 */

export function loginRedirect(request: Request, headers: Headers): Response {
	const url = new URL(request.url);
	return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, { headers });
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	if (!user) return loginRedirect(request, headers);
	const notes = await listNotes(request, context.cloudflare.env);
	return data(
		{
			notes: notes.map((n) => ({
				id: n.id,
				title: deriveNoteTitle(n.body_md),
				snippet: deriveNoteSnippet(n.body_md),
				updated_at: n.updated_at,
			})),
		},
		{ headers },
	);
}

const updatedFmt = new Intl.DateTimeFormat("en-GB", {
	day: "numeric",
	month: "short",
	year: "numeric",
});

export default function NotesIndex({ loaderData }: Route.ComponentProps) {
	const { notes } = loaderData;
	return (
		<main className="mx-auto max-w-2xl px-6 py-12">
			<h1 className="font-display text-2xl font-medium tracking-tight" tabIndex={-1}>
				Your notes
			</h1>

			{notes.length === 0 ? (
				// A9/CF-20: empty /notes speaks once in type — one italic line and a
				// plain door. No empty-state card, no illustration.
				<div className="mt-10">
					<p className="font-reading text-[17px] italic leading-relaxed text-muted-foreground">
						Nothing written yet.
					</p>
					<Link
						to="/notes/new"
						className="mt-2 inline-block font-reading text-[17px] leading-relaxed text-ink underline decoration-dotted underline-offset-4 transition-colors duration-150 hover:decoration-solid"
					>
						Begin a note
					</Link>
				</div>
			) : (
				<>
					<div className="mt-6">
						<Link
							to="/notes/new"
							className="font-ui text-sm text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors duration-150 hover:text-ink"
						>
							New note
						</Link>
					</div>
					<ul className="mt-6 divide-y divide-rule">
						{notes.map((note) => (
							<li key={note.id}>
								<Link
									to={`/notes/${note.id}`}
									className="group block py-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
								>
									<span
										className={`font-reading text-[17px] leading-snug text-ink group-hover:underline group-hover:decoration-dotted group-hover:underline-offset-4 ${note.title === UNTITLED_NOTE ? "italic text-muted-foreground" : ""}`}
									>
										{note.title}
									</span>
									{note.snippet ? (
										<span className="mt-1 block font-reading text-sm leading-relaxed text-muted-foreground">
											{note.snippet}
										</span>
									) : null}
									<time
										dateTime={note.updated_at}
										className="mt-1 block font-ui text-[11px] uppercase tracking-[0.14em] text-faint"
									>
										{updatedFmt.format(new Date(note.updated_at))}
									</time>
								</Link>
							</li>
						))}
					</ul>
				</>
			)}
		</main>
	);
}
