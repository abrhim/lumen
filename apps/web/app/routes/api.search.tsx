import { sql } from "drizzle-orm";
import { searchAll, decodeSearchCursor, type SearchResponse } from "@lumen/scripture";
import { getSessionUser } from "~/lib/auth.server";
import { getCollectionAccessStrict } from "~/lib/collection-access.server";
import { mergeNotesGroup, searchNotesLeg, type NotesSearchGroup } from "~/lib/notes.server";
import { notesEnabled } from "~/lib/notes-enabled";
import { logSearchExecuted, logSearchFailed } from "~/lib/search-obs.server";
import { extractNotesScope, parseLimit, parseQ, parseScope } from "~/lib/search-request.server";
import type { Route } from "./+types/api.search";

/**
 * GET /api/search — typed federated search (search-endpoint plan v2,
 * decision 5). Resource route: JSON only, never HTML. Validation runs before
 * any session/db work; error bodies carry stable codes (H14). Every response
 * is `Cache-Control: private, no-store` — the body varies by session
 * visibility (SEC-4/API-3, house SECURITY-3 pattern).
 *
 * Id stability (decision 5, APIC-6): every result id is durable EXCEPT
 * moment ids, which re-key on M3 re-runs — clients deep-link moments via
 * payload episode_id + t_start_s, never the id.
 *
 * search-ui: optional `after` keyset cursor, valid only when scope is
 * exactly one group (F2). q/scope/limit validation and the OBS block are
 * shared with the /search page loader (Δ CU-6/UU-9, OU-6).
 */

// Δ SU-3: real cursors run ~120 chars encoded; anything past this is hostile
// and never reaches the decoder.
const AFTER_MAX = 256;

function json(
	body: unknown,
	status: number,
	extra?: Headers,
): Response {
	const headers = new Headers(extra);
	headers.set("Content-Type", "application/json; charset=utf-8");
	headers.set("Cache-Control", "private, no-store");
	return new Response(JSON.stringify(body), { status, headers });
}

function badRequest(code: string, message: string): Response {
	return json({ error: message, code }, 400);
}

function isCursorMismatch(err: unknown): boolean {
	return err instanceof Error && (err as { code?: unknown }).code === "cursor_mismatch";
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const url = new URL(request.url);

	// ── Validation first: no session read, no db work on garbage (H14). ──
	const qResult = parseQ(url.searchParams.get("q"));
	if (!qResult.ok) {
		return badRequest(qResult.code, qResult.message);
	}
	const q = qResult.value;

	// personal-notes A4 (CF-1/CF-7): `notes` is a route-layer key. The raw
	// scope splits first; parseScope's vocabulary (and its 400 bytes) stays
	// exactly the seven canon keys. When the ONLY problem with the scope is
	// `notes`, judgment defers until the session is known — signed-out
	// replays the frozen scope_unknown 400, signed-in runs the leg.
	const rawScope = url.searchParams.get("scope");
	const scopeResult = parseScope(rawScope);
	let scope = scopeResult.ok ? scopeResult.value : undefined;
	let deferredScopeError: { code: string; message: string } | null = null;
	let wantsNotes = false;
	let notesOnly = false;
	if (!scopeResult.ok) {
		const split = extractNotesScope(rawScope);
		const rest = split.wantsNotes ? parseScope(split.canonRaw) : null;
		if (rest?.ok) {
			deferredScopeError = { code: scopeResult.code, message: scopeResult.message };
			wantsNotes = true;
			notesOnly = split.notesOnly;
			scope = rest.value;
		} else {
			return badRequest(scopeResult.code, scopeResult.message);
		}
	}

	// While a scope ruling is deferred, later validation 400s hold too —
	// pre-feature order was scope → limit → cursor, and the signed-out bytes
	// for scope=notes&limit=garbage must stay scope_unknown, not limit_invalid.
	const limitResult = parseLimit(url.searchParams.get("limit"));
	if (!limitResult.ok && deferredScopeError === null) {
		return badRequest(limitResult.code, limitResult.message);
	}
	const limitPerGroup = limitResult.ok ? limitResult.value : 8;

	// ── Cursor validation (F2/F3/F4): same before-session doctrine. The raw
	// value is NEVER echoed (F3); rejections are deliberately unlogged
	// (ratified decision 10; OU-5 rejected). ──
	let after: string | undefined;
	const rawAfter = url.searchParams.get("after");
	// When the scope decision is deferred (signed-out must see the exact
	// pre-feature scope_unknown bytes), cursor validation waits too — the
	// pre-feature route rejected the scope BEFORE looking at the cursor.
	if (rawAfter !== null && deferredScopeError === null) {
		if (rawAfter.length > AFTER_MAX) {
			return badRequest("cursor_invalid", "invalid cursor");
		}
		// Keyset continuation only composes inside ONE group's ORDER BY, so
		// scope must isolate exactly one group — checked before decode so a
		// mis-scoped request reads as its own error, not a stale cursor.
		if (scope?.length !== 1) {
			return badRequest("cursor_scope", "after requires scope to be exactly one group");
		}
		try {
			// Pure comparison math, never a DB lookup (Δ SU-2 doctrine); the
			// validated raw value is what searchAll consumes.
			decodeSearchCursor(rawAfter, { q, scope: scope[0] });
		} catch (err) {
			return isCursorMismatch(err)
				? badRequest("cursor_mismatch", "cursor was minted for a different q or scope")
				: badRequest("cursor_invalid", "invalid cursor");
		}
		after = rawAfter;
	}

	// ── Visibility: the loader's job, never searchAll's (decision 6). ──
	// Session + visibility live INSIDE the try: a failure there (session-pool
	// exhaustion is a documented incident here) must exit through the same
	// JSON-500 + search_failed contract as a search failure, never a framework
	// 500. `headers` stays reachable in the catch so session-rotation
	// Set-Cookie survives on both paths.
	let headers: Headers | undefined;
	let visibility: "public" | "admin" = "public";
	try {
		const session = await getSessionUser(request, context.cloudflare.env);
		const user = session.user;
		headers = session.headers;

		// personal-notes A4/A16: the deferred scope ruling. Signed-out (or
		// kill-switched) requests naming `notes` get the pre-feature 400,
		// byte-identical — the vocabulary never leaked.
		const notesOn = notesEnabled(context.cloudflare.env);
		if (deferredScopeError && (!user || !notesOn)) {
			return json({ error: deferredScopeError.message, code: deferredScopeError.code }, 400, headers);
		}
		// Signed-in with a notes scope: the held-back validations fire now, in
		// the pre-feature order (limit, then cursor).
		if (!limitResult.ok) {
			return json({ error: limitResult.message, code: limitResult.code }, 400, headers);
		}
		// Cursor × notes is a defined 400 (CF-8): the notes leg is
		// recency-ordered PostgREST and can never consume a keyset cursor.
		if (wantsNotes && rawAfter !== null) {
			return json(
				{ error: "after requires scope to be exactly one group", code: "cursor_scope" },
				400,
				headers,
			);
		}

		// The notes leg runs signed-in only, in parallel with searchAll (no
		// data dependency), for unscoped searches and scopes naming notes.
		// It never throws — failure degrades inside searchNotesLeg (CF-4).
		const runNotesLeg = user !== null && notesOn && (rawScope === null || wantsNotes);
		const notesLegPromise: Promise<NotesSearchGroup | null> = runNotesLeg
			? searchNotesLeg(request, context.cloudflare.env, q, limitPerGroup)
			: Promise.resolve(null);

		let result: SearchResponse;
		if (notesOnly) {
			// A notes-only scope skips searchAll entirely — never searchAll([]),
			// which would search all seven groups (CF-7). Reference resolution
			// is forfeited on this path (documented).
			result = {
				query: q,
				reference: null,
				groups: [],
				meta: { perGroup: {}, totalMs: 0, mode: "none" },
			};
		} else {
			// B7: one visibility source with the Phase B surfaces — the strict
			// variant so a lookup failure hits this try's 500 contract instead
			// of silently searching nothing.
			const access = await getCollectionAccessStrict(context.db, user?.id ?? null);
			let visibleCollections = access.publicIds;
			if (access.entitled) {
				const rows = (await context.db.execute(
					sql`SELECT id FROM lumen.collections`,
				)) as Array<{ id: string }>;
				visibleCollections = rows.map((r) => r.id);
				visibility = "admin";
			}
			result = await searchAll(context.db, {
				q,
				visibleCollections,
				scope,
				limitPerGroup,
				after,
			});
		}

		const notesGroup = await notesLegPromise;
		// A resolvable chapter/verse reference short-circuits to navigation —
		// the notes group stays out of that response (A4).
		const shortCircuit =
			result.reference?.found === true &&
			(result.reference.level === "verse" || result.reference.level === "chapter");
		const groups = shortCircuit ? result.groups : mergeNotesGroup(result.groups, notesGroup);

		logSearchExecuted(result, {
			q,
			scope,
			visibility,
			userId: user?.id,
			after,
			surface: "api",
			// B14 (CP-15): a notes-only scope skipped the canon engine — mark it
			// so the event never reads as an unscoped search.
			...(notesOnly ? { notesOnly: true } : {}),
			// B42 (CP-45): on the reference short-circuit the notes group was
			// DROPPED from the response — the log must match what shipped, so the
			// discarded hits are marked skipped with hits: 0.
			...(notesGroup
				? {
						extraGroups: {
							notes: shortCircuit
								? { hits: 0, degraded: notesGroup.degraded === true, skipped: true }
								: { hits: notesGroup.results.length, degraded: notesGroup.degraded === true },
						},
					}
				: {}),
		});

		return json({ query: result.query, reference: result.reference, groups }, 200, headers);
	} catch (err) {
		logSearchFailed(err, { q, scope, visibility, after, surface: "api" });
		return json({ error: "Search failed", code: "internal" }, 500, headers);
	}
}

/**
 * B17/OC-4: the RR single-fetch `.data` variant — the ONLY variant the page's
 * fetchers hit — takes its headers from this export, NOT from the loader's
 * returned Response. Without it, session-varying (admin-entitled) bodies escape
 * the SECURITY-3 / F17 `private, no-store` mandate on the shipped UI path. The
 * `json()` helper still sets it on direct GETs of the raw route; this covers the
 * `.data` protocol responses (incl. the returned 400/500 error bodies).
 */
export function headers(): HeadersInit {
	return { "Cache-Control": "private, no-store" };
}
