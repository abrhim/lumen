import { useEffect, useRef, useState } from "react";
import { Link, data, redirect, useLocation } from "react-router";
import { getSessionUser } from "~/lib/auth.server";
import { notesEnabled } from "~/lib/notes-enabled";
import { listNotes } from "~/lib/notes.server";
import { deriveNoteTitle, UNTITLED_NOTE } from "~/lib/notes-derive";
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

/** B4 (CP-5): the most private bodies in the app — never heuristically
 * cacheable, and rotation Set-Cookies must never be replayed (SECURITY-3;
 * the B17/OC-4 single-fetch variant takes headers from THIS export). */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	const h = new Headers(loaderHeaders);
	h.set("Cache-Control", "private, no-store");
	return h;
}

export async function loader({ request, context }: Route.LoaderArgs) {
	// A16 kill switch: off = the pre-feature shape (this route never existed)
	if (!notesEnabled(context.cloudflare.env)) throw new Response(null, { status: 404 });
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	if (!user) {
		// guest posture (Abram, 2026-07-31): the section shows itself and
		// invites a first note — sign-in is required only at SAVE
		headers.set("Cache-Control", "private, no-store");
		return data({ notes: null }, { headers });
	}
	const notes = await listNotes(request, context.cloudflare.env);
	headers.set("Cache-Control", "private, no-store");
	// B22 (CP-23): the read ships `title_line` (bounded generated column), not
	// bodies — the same stripper still owns the derivation, so there is no
	// second title surface to drift. No snippet: deriving one would need the
	// body back (or the rejected `snippet_source` column), and the index reads
	// as a register of titles, which is the house idiom anyway.
	return data(
		{
			notes: notes.map((n) => ({
				id: n.id,
				title: deriveNoteTitle(n.title_line ?? ""),
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
	const location = useLocation();
	const h1Ref = useRef<HTMLHeadingElement>(null);
	const arrivedFromDelete = (location.state as { deleted?: boolean } | null)?.deleted === true;
	// B21 (CP-22): the region MOUNTS EMPTY and is filled in an effect. Text
	// that is already present when a live region is inserted is unreliably
	// spoken (frequently silent in VoiceOver/NVDA) — announcements are
	// mutations of an existing region, so the mutation has to happen after
	// the region exists.
	const [announcement, setAnnouncement] = useState("");

	// CF-47: after a delete confirm, focus lands here with an announcement
	useEffect(() => {
		if (!arrivedFromDelete) {
			setAnnouncement("");
			return;
		}
		h1Ref.current?.focus();
		const t = setTimeout(() => setAnnouncement("Note deleted"), 100);
		return () => clearTimeout(t);
	}, [arrivedFromDelete]);

	return (
		<main className="mx-auto max-w-2xl px-6 py-12">
			<h1
				ref={h1Ref}
				className="font-display text-3xl font-medium tracking-tight outline-none"
				tabIndex={-1}
			>
				Your notes
			</h1>
			<div aria-live="polite" className="sr-only">
				{announcement}
			</div>

			{notes === null ? (
				// guest posture: try first, sign in only to keep it
				<div className="mt-10">
					<p className="font-reading text-[17px] leading-relaxed text-muted-foreground">
						Write alongside the text — notes link verses, people, episodes, and
						each other.
					</p>
					<Link
						to="/notes/new"
						className="mt-2 inline-block font-reading text-[17px] leading-relaxed text-ink underline decoration-dotted underline-offset-4 transition-colors duration-150 hover:decoration-solid"
					>
						Try writing one
					</Link>
					<p className="mt-4 font-ui text-[12px] text-muted-foreground">
						Saving asks you to sign in; your draft survives the trip.
					</p>
				</div>
			) : notes.length === 0 ? (
				// A9/CF-20: empty /notes speaks once in type — one italic line and a
				// plain door. No empty-state card, no illustration.
				<div className="mt-10">
					<p className="font-reading text-[17px] leading-relaxed text-muted-foreground">
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
									<time
										dateTime={note.updated_at}
										className="mt-1 block font-ui text-[12px] text-muted-foreground"
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
