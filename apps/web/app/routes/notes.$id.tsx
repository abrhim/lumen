import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Link, data, redirect, useFetcher, useNavigate, useRevalidator } from "react-router";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { getSessionUser } from "~/lib/auth.server";
import {
	createNote,
	getNote,
	getNoteAnchors,
	softDeleteNote,
	syncNoteAnchors,
	updateNote,
} from "~/lib/notes.server";
import { notesEnabled } from "~/lib/notes-enabled";
import { renderNoteHtml } from "~/lib/notes-render.server";
import { canonicalizeNoteMarkdown, sanitizeWikilinkLabel } from "~/lib/notes-canonical.server";
import {
	deriveNoteTitle,
	extractWikilinkRefs,
	NOTE_BODY_MAX_BYTES,
	UNTITLED_NOTE,
} from "~/lib/notes-derive";
import { resolveLinkedCanon, type LinkedCanon, type LinkedItem } from "~/lib/notes-linked.server";
import { resolveAnchorRef, type AnchorRef } from "@lumen/scripture/notes-refs";
import { logEvent } from "~/lib/log.server";
import type { Route } from "./+types/notes.$id";

/**
 * personal-notes /notes/:id — read + edit + the `/notes/new` create
 * surface (A13). Contract pins:
 *  - signed-out → 302 /login?next=<same-origin-path> (A18), never content
 *  - `new` is the create surface: GET renders the editor, POST intent=create
 *    302s to the fresh note (CF-29)
 *  - non-uuid :id → 404 BEFORE any query (CF-27; no PG 22P02 500s)
 *  - absent / soft-deleted / another owner's note are ONE indistinguishable
 *    404 (RLS makes them so; F8)
 *  - update/delete are fetcher JSON (autosave cadence needs no-redirect);
 *    update is LWW with base-echo conditional → 409 + current row (CF-37)
 *  - EVERY outcome — 200/302/400/404/409/500 — carries session headers
 *    (CF-31, the B4 class)
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function loginRedirect(request: Request, headers: Headers): Response {
	const url = new URL(request.url);
	return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, { headers });
}

function json(body: unknown, status: number, headers: Headers): Response {
	const h = new Headers(headers);
	h.set("Content-Type", "application/json; charset=utf-8");
	h.set("Cache-Control", "private, no-store");
	return new Response(JSON.stringify(body), { status, headers: h });
}

export function meta({ data: loaderData }: Route.MetaArgs) {
	const title = loaderData?.mode === "read" ? loaderData.title : "New note";
	return [{ title: `${title} · Lumen` }];
}

/** B4 (CP-5): private bodies + rotation cookies — never cacheable
 * (SECURITY-3; covers the single-fetch .data variant per B17/OC-4). */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	const h = new Headers(loaderHeaders);
	h.set("Cache-Control", "private, no-store");
	return h;
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	// A16 kill switch: off = the pre-feature shape (this route never existed)
	if (!notesEnabled(context.cloudflare.env)) throw new Response(null, { status: 404 });
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	headers.set("Cache-Control", "private, no-store");
	if (!user) return loginRedirect(request, headers);

	if (params.id === "new") {
		// prefilled anchor from reader capture (A9): ?anchor=alma-32-21
		const anchorParam = new URL(request.url).searchParams.get("anchor");
		const anchor = anchorParam && resolveAnchorRef(anchorParam) ? anchorParam : null;
		return data(
			{ mode: "new" as const, note: null, title: null, html: null, anchor, linked: null },
			{ headers },
		);
	}

	if (!UUID_RE.test(params.id)) {
		throw new Response(null, { status: 404, headers });
	}

	const note = await getNote(request, context.cloudflare.env, params.id);
	if (!note) throw new Response(null, { status: 404, headers });

	const title = deriveNoteTitle(note.body_md);
	// A14/CF-45: the derived title owns the page h1 — when the first line IS
	// a heading, the title consumes it (never double-rendered), and the
	// remaining body headings demote one level.
	let bodyForRender = note.body_md;
	const firstLine = note.body_md.split("\n").find((l) => l.trim() !== "") ?? "";
	if (/^#{1,3}\s/.test(firstLine) && deriveNoteTitle(firstLine) === title) {
		bodyForRender = note.body_md.replace(firstLine, "").replace(/^\n+/, "");
	}

	// linked-canon rail + hover previews (Abram, 2026-07-30): anchors + body
	// wikilinks resolved through the read-only canon connection. Absence on
	// failure — the note itself must never depend on rail data.
	let linked: LinkedCanon | null = null;
	try {
		const anchors = await getNoteAnchors(request, context.cloudflare.env, note.id);
		const refs = [
			...new Set([...anchors.map((a) => a.ref_id), ...extractWikilinkRefs(note.body_md)]),
		];
		if (refs.length > 0) linked = await resolveLinkedCanon(context.db, refs);
	} catch {
		linked = null;
	}

	return data(
		{
			mode: "read" as const,
			note: { id: note.id, body_md: note.body_md, updated_at: note.updated_at },
			title,
			html: renderNoteHtml(bodyForRender, { demoteHeadings: true }),
			anchor: null,
			linked,
		},
		{ headers },
	);
}

/** A successful delete leaves nothing to revalidate — the loader would 404
 * before the client-side navigate to /notes runs (the delete-then-
 * revalidate trap). The client owns the exit navigation (CF-47). */
export function shouldRevalidate({
	actionResult,
	defaultShouldRevalidate,
}: {
	actionResult?: unknown;
	defaultShouldRevalidate: boolean;
}) {
	if (
		actionResult !== null &&
		typeof actionResult === "object" &&
		(actionResult as { deleted?: boolean }).deleted === true
	) {
		return false;
	}
	return defaultShouldRevalidate;
}

function readAnchors(form: FormData): { ok: true; anchors: AnchorRef[] } | { ok: false; ref: string } {
	const anchors: AnchorRef[] = [];
	for (const value of form.getAll("anchor")) {
		const raw = String(value);
		const resolved = resolveAnchorRef(raw);
		if (!resolved) {
			// allowlisted ref-bearing event (CF-49): an invalid ref from our own
			// insert paths means client/slug-map drift — a bug, not user garbage
			logEvent("note_anchor_invalid_ref", { ref_id: raw.slice(0, 160) });
			return { ok: false, ref: raw };
		}
		anchors.push(resolved);
	}
	return { ok: true, anchors };
}

export async function action({ request, params, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	if (!notesEnabled(env)) throw new Response(null, { status: 404 });
	const { user, headers } = await getSessionUser(request, env);
	if (!user) return json({ error: "Sign in required", code: "unauthenticated" }, 401, headers);

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return json({ error: "Invalid form body", code: "form_invalid" }, 400, headers);
	}
	const intent = String(form.get("intent") ?? "");

	try {
		switch (intent) {
			case "create": {
				if (params.id !== "new") {
					return json({ error: "Create posts to /notes/new", code: "intent_invalid" }, 400, headers);
				}
				const rawBody = String(form.get("body_md") ?? "");
				if (new TextEncoder().encode(rawBody).byteLength > NOTE_BODY_MAX_BYTES) {
					return json({ error: "Note is too large", code: "note_too_large" }, 400, headers);
				}
				const anchors = readAnchors(form);
				if (!anchors.ok) {
					return json({ error: "Unknown reference", code: "anchor_invalid" }, 400, headers);
				}
				// A2: every save path stores C(md)
				const note = await createNote(request, env, {
					body_md: canonicalizeNoteMarkdown(rawBody),
					anchors: anchors.anchors,
				});
				return redirect(`/notes/${note.id}`, { headers });
			}

			case "update": {
				if (!UUID_RE.test(params.id)) {
					return json({ error: "Not found", code: "not_found" }, 404, headers);
				}
				const rawBody = String(form.get("body_md") ?? "");
				if (new TextEncoder().encode(rawBody).byteLength > NOTE_BODY_MAX_BYTES) {
					return json({ error: "Note is too large", code: "note_too_large" }, 400, headers);
				}
				const base = String(form.get("base_updated_at") ?? "");
				if (base === "") {
					return json({ error: "base_updated_at required", code: "base_required" }, 400, headers);
				}
				const canonical = canonicalizeNoteMarkdown(rawBody);
				// A19 round-trip canary: the client compared C(loaded) to loaded on
				// open and reports once, hash-only — never a body in the log.
				if (form.get("roundtrip_ok") === "false") {
					const digest = await crypto.subtle.digest(
						"SHA-256",
						new TextEncoder().encode(canonical),
					);
					logEvent("note_roundtrip_violation", {
						note_id: params.id,
						body_sha256_16: [...new Uint8Array(digest)]
							.slice(0, 8)
							.map((b) => b.toString(16).padStart(2, "0"))
							.join(""),
						len_stored: Number(form.get("rt_len_stored")) || 0,
						len_reserialized: Number(form.get("rt_len_reserialized")) || 0,
						first_diff_offset: Number(form.get("rt_first_diff")) || 0,
					});
				}
				const result = await updateNote(request, env, {
					id: params.id,
					body_md: canonical,
					baseUpdatedAt: base,
				});
				if (result.ok) {
					// B3 (CP-3): the body is COMMITTED at this point — an anchor
					// failure must never surface as a whole-save 500 (the client
					// would keep a stale base and wedge into 409s). Anchors ride
					// every save, so a missed sync self-heals on the next one.
					let anchorsSynced = true;
					if (form.get("sync_anchors") === "1") {
						const anchors = readAnchors(form);
						if (anchors.ok) {
							try {
								await syncNoteAnchors(request, env, params.id, anchors.anchors);
							} catch {
								anchorsSynced = false; // note_write_failed already logged
							}
						} else {
							anchorsSynced = false; // note_anchor_invalid_ref already logged
						}
					}
					return json(
						{ ok: true, updated_at: result.note.updated_at, anchors_synced: anchorsSynced },
						200,
						headers,
					);
				}
				if (result.conflict) {
					return json(
						{
							error: "Note changed elsewhere — reload",
							code: "stale",
							current: { body_md: result.conflict.body_md, updated_at: result.conflict.updated_at },
						},
						409,
						headers,
					);
				}
				return json({ error: "Not found", code: "not_found" }, 404, headers);
			}

			// A9 reader capture: append `[[ref|label]]` + anchor row to an
			// existing note WITHOUT navigation. The response feeds the rail's
			// one-line gloss confirmation, which doubles as the undo window.
			case "append": {
				if (!UUID_RE.test(params.id)) {
					return json({ error: "Not found", code: "not_found" }, 404, headers);
				}
				const ref = String(form.get("anchor") ?? "");
				const resolved = resolveAnchorRef(ref);
				if (!resolved) {
					logEvent("note_anchor_invalid_ref", { ref_id: ref.slice(0, 160) });
					return json({ error: "Unknown reference", code: "anchor_invalid" }, 400, headers);
				}
				const label = sanitizeWikilinkLabel(String(form.get("label") ?? ""));
				const line = label !== "" && label !== ref ? `[[${ref}|${label}]]` : `[[${ref}]]`;
				const note = await getNote(request, env, params.id);
				if (!note) return json({ error: "Not found", code: "not_found" }, 404, headers);
				// stored bodies are canonical (end with exactly one \n); a canonical
				// paragraph append keeps C a fixed point — asserted by re-canonicalizing
				const body = canonicalizeNoteMarkdown(
					note.body_md === "" ? `${line}\n` : `${note.body_md}\n${line}\n`,
				);
				const result = await updateNote(request, env, {
					id: params.id,
					body_md: body,
					baseUpdatedAt: note.updated_at,
				});
				if (!result.ok) {
					return result.conflict
						? json({ error: "Note changed elsewhere", code: "stale" }, 409, headers)
						: json({ error: "Not found", code: "not_found" }, 404, headers);
				}
				// B3 (CP-3): body committed — anchor failure degrades, never 500s
				// (the wikilink is in the body; the row heals on the next save)
				let existed = true;
				try {
					const anchors = await getNoteAnchors(request, env, params.id);
					existed = anchors.some((a) => a.kind === resolved.kind && a.ref_id === resolved.ref);
					if (!existed) {
						await syncNoteAnchors(request, env, params.id, [
							...anchors.map((a) => ({ kind: a.kind, ref: a.ref_id })),
							resolved,
						]);
					}
				} catch {
					existed = true; // undo must not delete a row we can't confirm we made
				}
				return json(
					{
						ok: true,
						note_id: params.id,
						title: deriveNoteTitle(body),
						updated_at: result.note.updated_at,
						appended_line: line,
						anchor_was_new: !existed,
					},
					200,
					headers,
				);
			}

			// The undo half of the capture gloss: strip the exact appended
			// paragraph (byte-identical restore) and remove the anchor row if
			// the capture created it. 409 if anything else touched the note.
			case "append_undo": {
				if (!UUID_RE.test(params.id)) {
					return json({ error: "Not found", code: "not_found" }, 404, headers);
				}
				const line = String(form.get("appended_line") ?? "");
				const base = String(form.get("base_updated_at") ?? "");
				const ref = String(form.get("anchor") ?? "");
				const resolved = resolveAnchorRef(ref);
				if (line === "" || base === "" || !resolved || !line.includes(ref)) {
					return json({ error: "Invalid undo", code: "undo_invalid" }, 400, headers);
				}
				const note = await getNote(request, env, params.id);
				if (!note) return json({ error: "Not found", code: "not_found" }, 404, headers);
				if (note.updated_at !== base) {
					return json({ error: "Note changed since capture", code: "stale" }, 409, headers);
				}
				let prev: string | null = null;
				if (note.body_md === `${line}\n`) prev = "";
				else if (note.body_md.endsWith(`\n${line}\n`)) {
					prev = note.body_md.slice(0, -(line.length + 2));
				}
				if (prev === null) {
					return json({ error: "Note changed since capture", code: "stale" }, 409, headers);
				}
				const result = await updateNote(request, env, {
					id: params.id,
					body_md: prev,
					baseUpdatedAt: base,
				});
				if (!result.ok) {
					return json({ error: "Note changed since capture", code: "stale" }, 409, headers);
				}
				if (form.get("anchor_was_new") === "1") {
					const anchors = await getNoteAnchors(request, env, params.id);
					await syncNoteAnchors(
						request,
						env,
						params.id,
						anchors
							.filter((a) => !(a.kind === resolved.kind && a.ref_id === resolved.ref))
							.map((a) => ({ kind: a.kind, ref: a.ref_id })),
					);
				}
				return json({ ok: true, undone: true, updated_at: result.note.updated_at }, 200, headers);
			}

			case "delete": {
				if (!UUID_RE.test(params.id)) {
					return json({ error: "Not found", code: "not_found" }, 404, headers);
				}
				const deleted = await softDeleteNote(request, env, params.id);
				if (!deleted) return json({ error: "Not found", code: "not_found" }, 404, headers);
				// `deleted` marker gates shouldRevalidate above
				return json({ ok: true, deleted: true }, 200, headers);
			}

			default:
				return json({ error: "Unknown intent", code: "intent_unknown" }, 400, headers);
		}
	} catch (err) {
		// classified + logged at the data layer (note_write_failed); the
		// response stays generic and still carries session headers
		return json({ error: "The note could not be saved", code: "internal" }, 500, headers);
	}
}

/* ---------------------------------- UI ---------------------------------- */

const NoteEditor = lazy(() => import("~/components/editor/NoteEditor"));

/** Rail register rows in the reader's ruled idiom — whole row a door. */
function LinkedRegister({ label, items }: { label: string; items: LinkedItem[] }) {
	if (items.length === 0) return null;
	return (
		<div className="mt-[18px] first:mt-3">
			<h3 className="font-ui text-[13px] font-normal text-muted-foreground">{label}</h3>
			<ul className="mt-1 list-none">
				{items.map((item) => {
					const body = (
						<>
							<span className="block font-reading text-[14.5px] leading-[1.45] text-ink underline-offset-4 group-hover:underline group-hover:decoration-rule2">
								{item.title}
								{item.gloss ? (
									<span className="ml-2 font-ui text-[10.5px] text-muted-foreground">
										{item.gloss}
									</span>
								) : null}
							</span>
							{item.snippet ? (
								<span className="mt-0.5 line-clamp-2 block font-reading text-[13px] leading-relaxed text-muted-foreground">
									{item.snippet}
								</span>
							) : null}
						</>
					);
					return (
						<li key={item.ref} className="border-t border-rule first:border-t-0">
							{item.href ? (
								<Link to={item.href} className="group block py-2">
									{body}
								</Link>
							) : (
								<div className="py-2">{body}</div>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

export default function NotePage({ loaderData }: Route.ComponentProps) {
	const { mode, note, title, html, anchor, linked } = loaderData;
	const [editing, setEditing] = useState(mode === "new");
	// wikilink hover/focus hint (aria-hidden — links already carry composed
	// aria-labels; this is a sighted-reader enhancement)
	const [hint, setHint] = useState<{ ref: string; top: number; left: number } | null>(null);
	const showHintFor = (target: EventTarget | null) => {
		const el = (target as HTMLElement | null)?.closest?.("[data-ref]");
		const ref = el?.getAttribute("data-ref");
		if (el && ref && linked?.previews[ref]) {
			const rect = el.getBoundingClientRect();
			setHint({
				ref,
				top: rect.bottom + 8,
				left: Math.max(8, Math.min(rect.left, window.innerWidth - 336)),
			});
		} else {
			setHint(null);
		}
	};
	// belt: while a hint is open, ANY pointer entry outside a wikilink or
	// the hint itself dismisses it (delegated events over injected HTML
	// don't reliably cover every exit path)
	useEffect(() => {
		if (!hint) return;
		const onOver = (e: Event) => {
			const el = (e.target as HTMLElement | null)?.closest?.("[data-ref], .note-hint");
			if (!el) setHint(null);
		};
		document.addEventListener("pointerover", onOver, true);
		window.addEventListener("scroll", onOver, true);
		return () => {
			document.removeEventListener("pointerover", onOver, true);
			window.removeEventListener("scroll", onOver, true);
		};
	}, [hint !== null]);
	const deleteFetcher = useFetcher<{ ok?: boolean; deleted?: boolean }>();
	const revalidator = useRevalidator();
	const navigate = useNavigate();

	// A19/CF-47: post-confirm the user lands on /notes with focus on its h1
	// and an announcement — never a dead <body> focus (B5 class).
	useEffect(() => {
		if (deleteFetcher.state === "idle" && deleteFetcher.data?.ok === true) {
			navigate("/notes", { state: { deleted: true } });
		}
	}, [deleteFetcher.state, deleteFetcher.data, navigate]);

	// A9: this note becomes the reader capture's "last-touched" target
	useEffect(() => {
		if (!note) return;
		try {
			localStorage.setItem("lumen:last-note", JSON.stringify({ id: note.id, title }));
		} catch {
			// storage unavailable — capture degrades to "New note" only
		}
	}, [note?.id, title]);

	// live composing rail: the editor reports its ref-set on every change;
	// a short debounce resolves them through /api/notes-linked, so the rail
	// tracks typing rather than the autosave cadence (Abram)
	const linkedFetcher = useFetcher<LinkedCanon>();
	const liveRefsRef = useRef<string[] | null>(null);
	const [liveRefsKey, setLiveRefsKey] = useState<string | null>(null);
	const onRefsChange = (refs: string[]) => {
		liveRefsRef.current = refs;
		setLiveRefsKey(refs.join(" "));
	};
	useEffect(() => {
		if (liveRefsKey === null) return;
		const t = setTimeout(() => {
			const refs = liveRefsRef.current ?? [];
			if (refs.length > 0) {
				linkedFetcher.load(`/api/notes-linked?refs=${encodeURIComponent(refs.join(","))}`);
			}
		}, 400);
		return () => clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [liveRefsKey]);

	const isComposing = editing || mode === "new";
	const activeLinked =
		isComposing && linkedFetcher.data
			? liveRefsRef.current?.length === 0
				? null
				: linkedFetcher.data
			: linked;

	const hasRail =
		activeLinked !== null &&
		activeLinked.verses.length +
			activeLinked.chapters.length +
			activeLinked.entities.length +
			activeLinked.media.length >
			0;
	const preview = hint ? activeLinked?.previews[hint.ref] : null;

	// the linked rail rides BOTH postures (Abram): while composing it
	// refreshes as each autosave's revalidation resolves the fresh refs
	const rail = hasRail && activeLinked && (
		<aside className="mt-10 lg:mt-0">
			<section
				aria-label="Linked in this note"
				className="h-fit rounded-xl border border-rule bg-panel px-6 pb-[18px] pt-[20px] lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto"
			>
				<h2 className="font-display text-[19px] font-medium tracking-[-0.01em]">Linked</h2>
				<LinkedRegister label="Verses" items={activeLinked.verses} />
				<LinkedRegister label="Chapters" items={activeLinked.chapters} />
				<LinkedRegister label="People & topics" items={activeLinked.entities} />
				<LinkedRegister label="Heard in" items={activeLinked.media} />
			</section>
		</aside>
	);

	if (editing || mode === "new") {
		return (
			<main
				className={
					hasRail
						? "mx-auto px-6 py-12 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,42rem)_340px] lg:justify-center lg:gap-x-12"
						: "mx-auto max-w-2xl px-6 py-12"
				}
			>
				<div className={hasRail ? "mx-auto w-full max-w-2xl lg:mx-0 lg:max-w-none" : undefined}>
					<Suspense
						fallback={
							<p className="font-reading text-[17px] italic leading-relaxed text-muted-foreground">
								Opening the editor…
							</p>
						}
					>
						<NoteEditor
							noteId={note?.id ?? null}
							initialBody={note?.body_md ?? ""}
							initialUpdatedAt={note?.updated_at ?? null}
							prefillAnchor={anchor ?? null}
							onRefsChange={onRefsChange}
							onClose={() => {
								if (note) {
									setEditing(false);
									revalidator.revalidate();
								}
							}}
						/>
					</Suspense>
				</div>
				{rail}
			</main>
		);
	}

	return (
		<main
			className={
				hasRail
					? "mx-auto px-6 py-12 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,42rem)_340px] lg:justify-center lg:gap-x-12"
					: "mx-auto max-w-2xl px-6 py-12"
			}
		>
			<div className={hasRail ? "mx-auto w-full max-w-2xl lg:mx-0 lg:max-w-none" : undefined}>
			<div className="flex items-baseline justify-between gap-4">
				<h1
					className={`font-display text-2xl font-medium tracking-tight ${title === UNTITLED_NOTE ? "italic text-muted-foreground" : ""}`}
					tabIndex={-1}
				>
					{title}
				</h1>
				<div className="flex shrink-0 items-baseline gap-4">
					<button
						type="button"
						onClick={() => setEditing(true)}
						className="font-ui text-sm text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors duration-150 hover:text-ink"
					>
						Edit
					</button>
					<AlertDialog>
						<AlertDialogTrigger
							// B-U1 class: a pointer click must not leave the trigger focused
							onMouseDown={(e) => e.preventDefault()}
							className="font-ui text-sm text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors duration-150 hover:text-ink"
						>
							Delete
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogTitle>Delete this note?</AlertDialogTitle>
							<AlertDialogDescription>
								It disappears from your notes, the reader, and search. Deleted notes may be
								purged after 30 days.
							</AlertDialogDescription>
							<div className="mt-5 flex justify-end gap-3">
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									onClick={() => {
										if (!note) return;
										deleteFetcher.submit(
											{ intent: "delete" },
											{ method: "post", action: `/notes/${note.id}` },
										);
									}}
								>
									Delete note
								</AlertDialogAction>
							</div>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</div>

			{note ? (
				<time
					dateTime={note.updated_at}
					className="mt-1 block font-ui text-[11px] uppercase tracking-[0.14em] text-muted-foreground"
				>
					{new Intl.DateTimeFormat("en-GB", {
						day: "numeric",
						month: "short",
						year: "numeric",
					}).format(new Date(note.updated_at))}
				</time>
			) : null}

			{html ? (
				<article
					className="note-body mt-8 font-reading text-[17px] leading-relaxed text-ink"
					// server-rendered by the constrained, escaping renderer (D4/F6);
					// hover/focus hints delegate off the wikilinks' data-ref
					onMouseOver={(e) => showHintFor(e.target)}
					onMouseOut={(e) => showHintFor(e.relatedTarget)}
					onFocusCapture={(e) => showHintFor(e.target)}
					onBlurCapture={() => setHint(null)}
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			) : null}

			<nav className="mt-12 border-t border-rule pt-4">
				<Link
					to="/notes"
					className="font-ui text-sm text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors duration-150 hover:text-ink"
				>
					All notes
				</Link>
			</nav>
			{deleteFetcher.data ? null : null}
			</div>

			{rail}

			{preview && hint && (
				<div
					aria-hidden
					className="note-hint fixed z-40 w-80 rounded-md border border-rule2 bg-panel p-3 shadow-sm"
					style={{ top: hint.top, left: hint.left }}
				>
					<p className="font-reading text-[14px] font-medium leading-snug text-ink">
						{preview.title}
					</p>
					{preview.snippet ? (
						<p className="mt-1 font-reading text-[13px] leading-relaxed text-muted-foreground">
							{preview.snippet}
						</p>
					) : null}
				</div>
			)}
		</main>
	);
}
