import { Suspense, lazy, useEffect, useId, useRef, useState } from "react";
import {
	Await,
	Link,
	data,
	isRouteErrorResponse,
	useFetcher,
	useNavigate,
	useNavigation,
	useNavigationType,
} from "react-router";
import { ArrowLeftIcon, HeadphonesIcon, ImageIcon, LightbulbIcon, Link2Icon, NotebookPenIcon, UsersIcon, XIcon } from "lucide-react";
import { sql } from "drizzle-orm";
import {
	parseReference,
	buildVerseId,
	getVersesByChapter,
	getChapterSummary,
	getVerseConnections,
	getNeighborhood,
	getPublicCollectionIds,
	getChapterArt,
	getChapterNumbers,
	getGraphIdPointer,
	chapterUnit,
	getCrossReferences,
	groupCrossRefs,
	getWordTags,
	tokenize,
	BIBLE_BOOK_IDS,
	type CrossRefCard,
	type WordTagRow,
	type NeighborhoodResult,
	type VerseConnectionsResult,
	type VerseEntityRef,
} from "@lumen/scripture";
import { Skeleton } from "~/components/ui/skeleton";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "~/components/ui/sheet";
import { useIsMobile } from "~/hooks/use-mobile";
import { ArtImage } from "~/components/ArtImage";
import { toArtItem, pickArtStack, artTransitionName, type ArtItem, type ArtworkRow } from "~/lib/art";
import { strongsLanguage, primaryEntry, wordGroupPositions } from "~/lib/word-study";
import { cachedJson } from "../lib/cache.server";
import { getSessionUser, hasAuthCookie } from "../lib/auth.server";
import { getChapterNoteAnchors } from "../lib/notes.server";
import { notesEnabled } from "../lib/notes-enabled";
import { stripNoteMarkdownLine, UNTITLED_NOTE } from "../lib/notes-derive";
import { logEvent } from "../lib/log.server";
import type { Route } from "./+types/scripture";

const CONNECTIONS_TTL_SECONDS = 7 * 24 * 60 * 60; // scripture graph is immutable between ingests

// The overlay (d3 + dialog) loads only when a graph is opened.
const GraphOverlay = lazy(() => import("~/components/graph/GraphOverlay"));

// Stable stand-in while an optimistic first open waits for the loader's promise.
const PENDING_FOREVER = new Promise<never>(() => {});

interface VerseRow {
	id: string;
	verse_number: number;
	text: string;
	reference: string;
}

// Art types + toArtItem (now carrying fame, API-1) live in ~/lib/art;
// the shared ArtImage (thumb→full fallback) in ~/components/ArtImage.

/** Resolved shape of the streamed panel promise — degradation is a value, not a rejection.
 * Cross-references left this payload for the critical path (Postgres) with the
 * OpenBible swap; only the Neo4j-backed entity chips still stream. */
type VersePanelData =
	| {
			degraded: false;
			principles: VerseEntityRef[];
			people: VerseEntityRef[];
	  }
	| { degraded: true };

/** Critical-path cross-references (OpenBible for Bible verses, curated
 * fallback for BoM/D&C/PGP). Degradation is a value — never throws (COR-6). */
interface CrossRefsPanel {
	degraded: boolean;
	cards: CrossRefCard[];
	totals: { outgoing: number; incoming: number };
	/** true when served from the curated fallback collection (chip + copy differ) */
	curated: boolean;
}

/** Word-study tags for the selected Bible verse — degradation is a value (strongs FM-6). */
interface WordTagsPanel {
	degraded: boolean;
	tags: WordTagRow[];
}

async function loadWordTags(
	db: Route.LoaderArgs["context"]["db"],
	bookId: string,
	chapter: number,
	verse: number,
): Promise<WordTagsPanel> {
	const verseId = buildVerseId(bookId, chapter, verse);
	const startedAt = Date.now();
	try {
		const tags = await getWordTags(db, verseId);
		return { degraded: false, tags };
	} catch (error) {
		logEvent("wordtags_degraded", {
			name: error instanceof Error ? error.name : "unknown",
			message: error instanceof Error ? error.message : String(error),
			book: bookId,
			chapter,
			verse,
			elapsedMs: Date.now() - startedAt,
		});
		return { degraded: true, tags: [] };
	}
}

const LEGACY_CROSSREF_COLLECTION = "phase-b";

/** book id of a verse id: "ether-12-27" → "ether" */
const bookOfVerseId = (verseId: string) => verseId.replace(/-\d+-\d+$/, "");

async function loadCrossRefs(
	db: Route.LoaderArgs["context"]["db"],
	bookId: string,
	chapter: number,
	verse: number,
): Promise<CrossRefsPanel> {
	const verseId = buildVerseId(bookId, chapter, verse);
	const curated = !BIBLE_BOOK_IDS.has(bookId);
	const startedAt = Date.now();
	try {
		if (curated) {
			// BoM/D&C/PGP: the curated collection is the only verse↔verse source
			const { refs, totals } = await getCrossReferences(db, verseId, {
				collectionId: LEGACY_CROSSREF_COLLECTION,
				limitPerDirection: 200,
			});
			return { degraded: false, cards: groupCrossRefs(refs), totals, curated };
		}

		// Bible verses: OpenBible plus curated CROSS-CANON links (Abram's call —
		// the old Neo4j panel had no collection filter, so Bible↔BoM bridges like
		// 1 Cor 1:27 → Ether 12:27 were visible; keep them, drop the curated
		// set's noisy Bible↔Bible refs that OpenBible replaces).
		// generous limit: the accordion shows everything on expand ("see all");
		// worst hub-verse fan-out in the corpus is ~2k rows, typical <150
		const [openbible, legacy] = await Promise.all([
			getCrossReferences(db, verseId, { collectionId: "openbible", limitPerDirection: 200 }),
			getCrossReferences(db, verseId, { collectionId: LEGACY_CROSSREF_COLLECTION, limitPerDirection: 200 }),
		]);
		const crossCanon = legacy.refs.filter((r) => !BIBLE_BOOK_IDS.has(bookOfVerseId(r.verse_id)));
		const cards = groupCrossRefs([...openbible.refs, ...crossCanon]);
		const totals = {
			outgoing: openbible.totals.outgoing + crossCanon.filter((r) => r.direction === "outgoing").length,
			incoming: openbible.totals.incoming + crossCanon.filter((r) => r.direction === "incoming").length,
		};
		if (cards.length === 0) {
			// a Bible verse with zero refs is rare — distinguishable from a bug (OBS-7)
			logEvent("crossref_empty", { verse: verseId });
		}
		return { degraded: false, cards, totals, curated };
	} catch (error) {
		logEvent("crossref_degraded", {
			name: error instanceof Error ? error.name : "unknown",
			message: error instanceof Error ? error.message : String(error),
			book: bookId,
			chapter,
			verse,
			elapsedMs: Date.now() - startedAt,
		});
		return { degraded: true, cards: [], totals: { outgoing: 0, incoming: 0 }, curated };
	}
}

/** Media (podcast) moments that discuss the selected verse — the collection
 * flowing back into the reader. Degradation is a value, never throws. */
interface MediaMoment {
	episodeId: string;
	episodeName: string;
	t: number;
}
interface MediaRefsPanel {
	degraded: boolean;
	moments: MediaMoment[];
}

/** Gated at the loader (showUnshaken): results only reach the client when the
 * collection is public or in local dev — the public flip stays the deliberate
 * reveal. Query placement (shared queries.ts vs web-local) revisits when a
 * second show lands; web-local until then. */
async function loadMediaRefs(
	db: Route.LoaderArgs["context"]["db"],
	bookId: string,
	chapter: number,
	verse: number,
): Promise<MediaRefsPanel> {
	const verseId = buildVerseId(bookId, chapter, verse);
	const startedAt = Date.now();
	try {
		const rows = (await db.execute(sql`
			SELECT g.from_id AS episode_id, ep.name, g.metadata
			FROM lumen.edges g
			JOIN lumen.entities ep ON ep.id = g.from_id
			WHERE g.to_id = ${verseId}
				AND g.rel_type = 'DISCUSSES'
				AND g.source = 'unshaken-extraction'`)) as {
			episode_id: string;
			name: string;
			metadata: unknown;
		}[];
		const moments: MediaMoment[] = [];
		for (const r of rows) {
			// postgres.js trap: jsonb can arrive as a string, numerics as strings
			const meta =
				typeof r.metadata === "string"
					? (JSON.parse(r.metadata) as { mentions?: { t: number }[] })
					: (r.metadata as { mentions?: { t: number }[] });
			for (const m of meta?.mentions ?? []) {
				moments.push({
					episodeId: String(r.episode_id),
					episodeName: String(r.name),
					t: Number(m.t),
				});
			}
		}
		moments.sort((a, b) => a.t - b.t);
		return { degraded: false, moments };
	} catch (error) {
		logEvent("mediarefs_degraded", {
			name: error instanceof Error ? error.name : "unknown",
			message: error instanceof Error ? error.message : String(error),
			book: bookId,
			chapter,
			verse,
			elapsedMs: Date.now() - startedAt,
		});
		return { degraded: true, moments: [] };
	}
}

/** Per-verse depth signals for the margin dots: which KINDS of reference
 * exist behind each verse (not the data itself). Spike (dots experiment) —
 * degradation is null, the chapter renders dotless. */
type VerseSignals = Record<
	number,
	{ principles?: boolean; people?: boolean; xrefs?: boolean; media?: boolean }
>;

async function loadVerseSignals(
	db: Route.LoaderArgs["context"]["db"],
	bookId: string,
	chapter: number,
): Promise<VerseSignals | null> {
	// Over-generate candidate ids (longest chapter in the canon is Psalm 119's
	// 176 verses) so this query needs no dependency on the verses fetch and
	// stays inside the loader's parallel window.
	const ids = Array.from({ length: 176 }, (_, i) => buildVerseId(bookId, chapter, i + 1));
	try {
		const rows = (await db.execute(sql`
			SELECT 'entity' AS kind, from_id AS vid, rel_type FROM lumen.edges
				WHERE from_id IN ${ids} AND source = 'anthropic-batch'
					AND rel_type IN ('MENTIONS','TEACHES')
				GROUP BY 2, 3
			UNION ALL
			SELECT 'media', to_id, rel_type FROM lumen.edges
				WHERE to_id IN ${ids} AND source = 'unshaken-extraction'
				GROUP BY 2, 3
			UNION ALL
			SELECT 'xref', from_id, 'CROSS_REF' FROM lumen.edges
				WHERE from_id IN ${ids} AND rel_type = 'CROSS_REF' GROUP BY 2
			UNION ALL
			SELECT 'xref', to_id, 'CROSS_REF' FROM lumen.edges
				WHERE to_id IN ${ids} AND rel_type = 'CROSS_REF' GROUP BY 2`)) as {
			kind: string;
			vid: string;
			rel_type: string;
		}[];
		const signals: VerseSignals = {};
		for (const r of rows) {
			const n = Number(r.vid.match(/-(\d+)$/)?.[1]);
			if (!Number.isFinite(n)) continue;
			const s = (signals[n] ??= {});
			if (r.kind === "entity") {
				if (r.rel_type === "TEACHES") s.principles = true;
				else s.people = true;
			} else if (r.kind === "media") s.media = true;
			else s.xrefs = true;
		}
		return signals;
	} catch (error) {
		logEvent("verse_signals_degraded", {
			name: error instanceof Error ? error.name : "unknown",
			message: error instanceof Error ? error.message : String(error),
			book: bookId,
			chapter,
		});
		return null;
	}
}

/** personal-notes A5 — the chapter's note anchors, shaped for the rail. */
interface ChapterNoteAnchor {
	note_id: string;
	kind: "verse" | "chapter";
	ref_id: string;
	title: string;
}

/**
 * personal-notes A5 (CF-5): degraded-as-value, self-contained
 * session→PostgREST chain with a hard 750ms abort — never a throw, joined
 * into the loader's existing parallel window as a SEPARATE additive field
 * (verseSignals stays untouched: the media-gate mutates that object in
 * place). Signed-out cost is zero via hasAuthCookie; the failure event
 * carries no userId and no verse list. SSR'd with the chapter, never
 * streamed. Known accepted regression: this route is no longer session-free
 * on its signed-in hot path — getSessionUser is request-memoized, and an
 * expired-token inline refresh here rides the root loader's headers.
 */
async function loadChapterNoteAnchors(
	request: Request,
	env: Route.LoaderArgs["context"]["cloudflare"]["env"],
	bookId: string,
	chapter: number,
): Promise<{ canCapture: boolean; anchors: ChapterNoteAnchor[] | null; headers: Headers }> {
	if (!notesEnabled(env) || !hasAuthCookie(request)) {
		return { canCapture: false, anchors: null, headers: new Headers() };
	}
	// B7 (CP-8): this session read can mint rotation Set-Cookies, and on a
	// chapter→chapter CLIENT nav the root loader does NOT re-run — so the
	// rotation must ride THIS loader's response or the refresh token goes
	// stale and the family gets revoked (silent sign-out, the B4 class).
	let sessionHeaders = new Headers();
	try {
		const { user, headers } = await getSessionUser(request, env);
		sessionHeaders = headers;
		if (!user) return { canCapture: false, anchors: null, headers: sessionHeaders };
		const rows = await getChapterNoteAnchors(
			request,
			env,
			bookId,
			chapter,
			AbortSignal.timeout(750),
		);
		return {
			canCapture: true,
			anchors: rows
				.filter((r) => r.kind === "verse" || r.kind === "chapter")
				.map((r) => ({
					note_id: r.note_id,
					kind: r.kind as "verse" | "chapter",
					ref_id: r.ref_id,
					title: stripNoteMarkdownLine(r.notes?.title_line ?? "") || UNTITLED_NOTE,
				})),
			headers: sessionHeaders,
		};
	} catch (error) {
		logEvent("note_anchors_degraded", {
			name: error instanceof Error ? error.name : "unknown",
			message: error instanceof Error ? error.message.slice(0, 200) : String(error),
			book: bookId,
			chapter,
		});
		// signed-in but degraded: the capture verbs still print (they are the
		// feature's scent — CF-20); the register quietly doesn't.
		return { canCapture: true, anchors: null, headers: sessionHeaders };
	}
}

/** seconds → "1:23:45" / "8:58" for media moment rows */
function fmtTimestamp(s: number) {
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = Math.floor(s % 60);
	return h > 0
		? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
		: `${m}:${String(ss).padStart(2, "0")}`;
}

/** One owner for the ?word grammar (1-based word position within the selected verse). */
function parseWordParam(search: string): number | null {
	const raw = new URLSearchParams(search).get("word");
	if (raw === null || !/^\d+$/.test(raw)) return null;
	const n = parseInt(raw, 10);
	return n > 0 ? n : null;
}

/** One owner for the ?verse grammar — the loader and the optimistic client parse share it. */
function parseVerseParam(search: string): number | null {
	const raw = new URLSearchParams(search).get("verse");
	if (raw === null || !/^\d+$/.test(raw)) return null;
	const n = parseInt(raw, 10);
	return n > 0 ? n : null;
}

/** Resolved shape of the streamed graph promise — degradation is a value, not a
 * rejection. Echoes the request (entityId/depth) so the overlay can tell a
 * freshly-resolved graph from a held-over stale one during transitions. */
export type GraphPanelData =
	| { degraded: false; neighborhood: NeighborhoodResult; entityId: string; depth: 1 | 2 | 3 }
	| { degraded: true; entityId: string; depth: 1 | 2 | 3 };

const GRAPH_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;

const GRAPH_NOT_FOUND: NeighborhoodResult = {
	found: false,
	center: null,
	nodes: [],
	edges: [],
	truncated: { shown: 0, total: 0 },
};

/** Depth clamps (unlike ?verse's treat-as-absent): the picker always needs a renderable value. */
function clampDepth(raw: string | null): 1 | 2 | 3 {
	if (raw === null || !/^\d+$/.test(raw)) return 1;
	return Math.min(3, Math.max(1, parseInt(raw, 10))) as 1 | 2 | 3;
}

/**
 * Never rejects — turbo-stream aborts and Neo4j failures both resolve degraded.
 * Cache discipline (B9): only `found:true` results earn the 7-day KV entry —
 * junk ids must not consume the KV write budget (free tier: 1,000 writes/day).
 * Logging happens at origin fetches only, never on cache hits (B19).
 */
async function loadGraph(
	context: Route.LoaderArgs["context"],
	entityId: string,
	depth: 1 | 2 | 3,
	collections: string[] | undefined,
): Promise<GraphPanelData> {
	const startedAt = Date.now();
	const collKey = (collections ?? []).slice().sort().join(",");
	// v2: D&C+PGP spine sync landed 2026-07-21 (3,995 verses + edges) — version
	// bump invalidates entries cached against the truncated graph (API-6:
	// orphaned v1 entries self-evict via TTL, no purge step).
	const cacheKey = `graph:v2:${entityId}:${depth}:${collKey}`;
	try {
		if (context.cache) {
			try {
				const hit = await context.cache.get(cacheKey);
				if (hit != null) {
					return { degraded: false, neighborhood: JSON.parse(hit) as NeighborhoodResult, entityId, depth };
				}
			} catch (error) {
				logEvent("kv_cache_error", {
					op: "get",
					key: cacheKey,
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}

		const queryOpts = {
			depth,
			collections: collections && collections.length > 0 ? collections : undefined,
		};
		let neighborhood = await getNeighborhood(context.neo4j, entityId, queryOpts);
		if (!neighborhood.found) {
			// resolveGraphId fallback (DATA-1/DATA-2): collision-namespaced ids
			// (`person:moses-1`) and renamed entities carry the id their graph
			// mirror still uses in metadata.neo4j_id. Only misses pay the PG
			// lookup — the found path stays Neo4j+KV only.
			const pointer = await getGraphIdPointer(context.db, entityId).catch(() => null);
			if (pointer !== null && pointer !== entityId) {
				neighborhood = await getNeighborhood(context.neo4j, pointer, queryOpts);
			}
		}
		const elapsedMs = Date.now() - startedAt;

		if (!neighborhood.found) {
			logEvent("graph_not_found", { entityId, depth, collections: collKey, elapsedMs });
		} else {
			if (neighborhood.truncated.shown < neighborhood.truncated.total) {
				logEvent("graph_truncated", {
					entityId,
					depth,
					shown: neighborhood.truncated.shown,
					total: neighborhood.truncated.total,
					elapsedMs,
				});
			}
			if (context.cache) {
				try {
					await context.cache.put(cacheKey, JSON.stringify(neighborhood), {
						expirationTtl: CONNECTIONS_TTL_SECONDS,
					});
				} catch (error) {
					logEvent("kv_cache_error", {
						op: "put",
						key: cacheKey,
						message: error instanceof Error ? error.message : String(error),
					});
				}
			}
		}
		return { degraded: false, neighborhood, entityId, depth };
	} catch (error) {
		logEvent("graph_degraded", {
			name: error instanceof Error ? error.name : "unknown",
			message: error instanceof Error ? error.message : String(error),
			entityId,
			depth,
			collections: collKey,
			elapsedMs: Date.now() - startedAt,
		});
		return { degraded: true, entityId, depth };
	}
}

/** Never rejects: failures resolve to `{degraded: true}` so the streamed panel can't crash the page. */
async function loadConnections(
	context: Route.LoaderArgs["context"],
	bookId: string,
	chapter: number,
	verse: number,
): Promise<VersePanelData> {
	const verseId = buildVerseId(bookId, chapter, verse);
	try {
		// v2: payload shape changed when cross-references moved to Postgres.
		// v3: D&C+PGP spine sync landed 2026-07-21 — entries cached against the
		// truncated graph must not serve for 7 more days. Orphaned older
		// entries self-evict via the TTL — no purge step (API-6).
		const result = await cachedJson<VerseConnectionsResult>(
			context.cache,
			`vconn:v3:${verseId}`,
			CONNECTIONS_TTL_SECONDS,
			() => getVerseConnections(context.neo4j, verseId),
		);
		return {
			degraded: false,
			principles: result.principles,
			people: result.people,
		};
	} catch (error) {
		logEvent("neo4j_degraded", {
			name: error instanceof Error ? error.name : "unknown",
			message: error instanceof Error ? error.message : String(error),
			book: bookId,
			chapter,
			verse,
		});
		return { degraded: true };
	}
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
	const rawBook = params.book ?? "";
	const rawChapter = params.chapter ?? "";
	const url = new URL(request.url);

	// "dc" parses as a volume, but D&C is a single-book volume and carries a
	// bookId — accept it here alongside plain book slugs.
	const parsed = parseReference(rawBook);
	const isBookish = parsed.level === "book" || parsed.level === "volume";
	if (!isBookish || !parsed.bookId) {
		logEvent("scripture_404", { cause: "unknown_book", book: rawBook });
		throw new Response(`Unknown book "${rawBook}".`, { status: 404 });
	}
	const bookId = parsed.bookId;

	if (!/^\d+$/.test(rawChapter)) {
		logEvent("scripture_404", { cause: "invalid_chapter", book: bookId, chapter: rawChapter });
		throw new Response(`"${rawChapter}" is not a valid chapter number.`, { status: 404 });
	}
	const chapter = parseInt(rawChapter, 10);

	// API-1: one canonical URL per chapter — aliases (1ne, "1 nephi") redirect.
	// The 301 must SELF-CARRY the session commit headers (F3): a thrown
	// redirect short-circuits the root loader's Set-Cookie (root.tsx
	// invariant), so a mid-read token rotation would otherwise be dropped —
	// an intermittent silent sign-out on the first post-expiry hit to a
	// non-canonical URL. Signed-out requests skip all auth work inside
	// getSessionUser (hasAuthCookie short-circuit), so this costs nothing
	// for most traffic.
	if (rawBook !== bookId) {
		const { headers } = await getSessionUser(request, context.cloudflare.env);
		headers.set("Location", `/scripture/${bookId}/${chapter}${url.search}`);
		// the rotated auth Set-Cookie this 301 may carry must never be cached and
		// replayed to another visitor of this alias (SECURITY-3)
		headers.set("Cache-Control", "private, no-store");
		throw new Response(null, { status: 301, headers });
	}

	// Kick off the graph fetch before the Postgres round trip — they're
	// independent, and the panel shouldn't pay both latencies in sequence.
	// Deliberately not awaited: React Router streams the promise, so the
	// chapter renders immediately and the panel fills in when Neo4j answers.
	const requestedVerse = parseVerseParam(url.search);
	const pendingConnections =
		requestedVerse !== null ? loadConnections(context, bookId, chapter, requestedVerse) : null;

	// An invalid-charset id still opens the overlay in its not-found state
	// (contract: "Invalid/unknown entityId → overlay not-found") — it just
	// never touches Neo4j or KV (B8/B9).
	const rawGraphId = url.searchParams.get("graph");
	const graphId = rawGraphId !== null ? rawGraphId.slice(0, 128) : null;
	const graphIdValid = rawGraphId !== null && GRAPH_ID_RE.test(rawGraphId);
	const graphDepth = clampDepth(url.searchParams.get("depth"));

	// Public collection ids resolve in the critical path (COR-2): the Postgres
	// connection closes via waitUntil once the handler returns, so deferred
	// promises must never touch it. Cheap (5 rows), parallel, graph loads only.
	const [verses, summary, publicCollections, artRows, chapterRows, crossRefsRaw, wordTagsRaw, mediaRefsRaw, verseSignals, noteCapture] = await Promise.all([
		getVersesByChapter(context.db, bookId, chapter) as Promise<VerseRow[]>,
		getChapterSummary(context.db, bookId, chapter) as Promise<{ description?: string } | null>,
		// always fetched now (cheap, 8 rows): the graph filter AND the media-
		// surface gates (Unshaken refs section + media dots) read from it
		(getPublicCollectionIds(context.db) as Promise<string[]>).catch(() => undefined),
		// art is an enhancement — its failure must never break the chapter,
		// but it must not vanish silently either (CUO-3)
		(getChapterArt(context.db, bookId, chapter) as Promise<ArtworkRow[]>).catch(
			(error) => {
				logEvent("art_gallery_degraded", {
					name: error instanceof Error ? error.name : "unknown",
					message: error instanceof Error ? error.message : String(error),
					book: bookId,
					chapter,
					view: "chapter",
				});
				return [] as ArtworkRow[];
			},
		),
		// real prev/next bounds (FM-10), folded into the same round-trip window (PERF-2);
		// on failure fall back to "next exists" so navigation is never over-restricted
		(getChapterNumbers(context.db, bookId) as Promise<{ chapter_number: number }[]>).catch(
			() => [] as { chapter_number: number }[],
		),
		// cross-references share the same parallel window (PERF-1: added
		// wall-clock ≈ 0) and MUST stay in the critical path — the PG
		// connection is gone once the handler returns (COR-2). Never throws.
		requestedVerse !== null
			? loadCrossRefs(context.db, bookId, chapter, requestedVerse)
			: Promise.resolve(null),
		// word-study tags: Bible verses only (no tags exist elsewhere); 7th
		// parallel query vs pool max:5 → worst case one extra queued RT (PO-1)
		requestedVerse !== null && BIBLE_BOOK_IDS.has(bookId)
			? loadWordTags(context.db, bookId, chapter, requestedVerse)
			: Promise.resolve(null),
		// media (podcast) moments discussing the verse; same critical-path rule
		// as cross-refs (COR-2), never throws; 8th query → one more queued RT
		requestedVerse !== null
			? loadMediaRefs(context.db, bookId, chapter, requestedVerse)
			: Promise.resolve(null),
		// per-verse margin-dot signals (dots experiment); never throws
		loadVerseSignals(context.db, bookId, chapter),
		// personal-notes A5: the user's anchors for this chapter (PostgREST,
		// not db.execute — CPERF-6 counts it separately); degraded-as-value
		loadChapterNoteAnchors(request, context.cloudflare.env, bookId, chapter),
	] as const);

	if (verses.length === 0) {
		logEvent("scripture_404", { cause: "empty_chapter", book: bookId, chapter });
		throw new Response(`${bookId} has no chapter ${chapter}.`, { status: 404 });
	}

	// A ?verse that isn't in this chapter is treated as no selection.
	const selectedVerse =
		requestedVerse !== null && verses.some((v) => v.verse_number === requestedVerse)
			? requestedVerse
			: null;
	const connections = selectedVerse !== null ? pendingConnections : null;
	const crossRefs = selectedVerse !== null ? crossRefsRaw : null;
	const wordTags = selectedVerse !== null ? wordTagsRaw : null;
	// Media surfaces are fail-closed on collection visibility: hidden until the
	// deliberate public flip (or local dev). The reader stays session-free on
	// its hot path, so no admin-preview here — preview lives on /media and
	// /collections, which do check the entitlement.
	const showUnshaken = import.meta.env.DEV || (publicCollections ?? []).includes("unshaken");
	const mediaRefs = selectedVerse !== null && showUnshaken ? mediaRefsRaw : null;
	if (!showUnshaken && verseSignals) {
		for (const s of Object.values(verseSignals)) delete s.media;
	}
	const selectedWord = selectedVerse !== null ? parseWordParam(url.search) : null;

	// Streamed like connections; uses only Neo4j + KV, safe after the handler returns.
	const graph: Promise<GraphPanelData> | null =
		graphId === null
			? null
			: graphIdValid
				? loadGraph(context, graphId, graphDepth, publicCollections)
				: Promise.resolve({
						degraded: false,
						neighborhood: GRAPH_NOT_FOUND,
						entityId: graphId,
						depth: graphDepth,
					});

	// "1 Nephi 3:1" → "1 Nephi 3"
	const reference = verses[0].reference.replace(/:\d+$/, "");

	// B7 (CP-8): the anchors leg's session read can rotate tokens, and on a
	// chapter→chapter client nav the root loader does not re-run — the
	// rotation Set-Cookie must ride THIS response (data() carries it on the
	// single-fetch path; the headers export forwards it on documents).
	return data({
		bookId,
		chapter,
		reference,
		summary: summary?.description ?? null,
		verses: verses.map((v) => ({
			id: v.id,
			verse_number: v.verse_number,
			text: v.text,
			reference: v.reference,
		})),
		selectedVerse,
		selectedWord,
		connections,
		crossRefs,
		wordTags,
		mediaRefs,
		verseSignals,
		// A5: separate additive fields — never merged into verseSignals
		noteAnchors: noteCapture.anchors,
		canCapture: noteCapture.canCapture,
		graphId,
		graphDepth,
		graph,
		art: (artRows ?? []).map(toArtItem),
		maxChapter: chapterRows.length > 0 ? Math.max(...chapterRows.map((c) => c.chapter_number)) : null,
	}, { headers: noteCapture.headers });
}

/** B7: forward loader headers (rotation Set-Cookie) to document responses. */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: data ? `${data.reference} · Lintel` : "Lintel" }];
}

export default function Scripture({ loaderData }: Route.ComponentProps) {
	const { bookId, chapter, reference, summary, verses, selectedVerse, selectedWord, connections, crossRefs, wordTags, mediaRefs, verseSignals, noteAnchors, canCapture, graphId, graphDepth, graph, art, maxChapter } =
		loaderData;
	// A15: which verses carry the user's note dot (verse-kind anchors only)
	const notedVerses = new Set<number>();
	for (const a of noteAnchors ?? []) {
		if (a.kind !== "verse") continue;
		const n = Number(a.ref_id.match(/-(\d+)$/)?.[1]);
		if (Number.isFinite(n)) notedVerses.add(n);
	}
	const unit = chapterUnit(bookId);
	const navigation = useNavigation();
	const navigationType = useNavigationType();
	const navigate = useNavigate();
	const isMobile = useIsMobile();

	const chapterUrl = `/scripture/${bookId}/${chapter}`;
	// Bible chapters get the in-body word-study layer (BoM/D&C have no tags)
	const isBibleBook = BIBLE_BOOK_IDS.has(bookId);
	// "1 Nephi 3" → "1 Nephi" for the breadcrumb link
	const bookName = reference.replace(/\s+\d+$/, "");
	// History back when there is history; otherwise up to the chapter grid.
	const goBack = () => {
		if (typeof window !== "undefined" && ((window.history.state?.idx as number) ?? 0) > 0) {
			navigate(-1);
		} else {
			navigate(`/scripture/${bookId}`);
		}
	};

	// Optimistic selection: a same-chapter ?verse navigation moves the highlight
	// and opens the panel skeleton before the server responds. Shares the loader's
	// grammar AND its membership rule, so the optimistic state never disagrees
	// with what the server will decide.
	const navHere =
		navigation.location && navigation.location.pathname === chapterUrl
			? navigation.location
			: null;
	const validVerse = (search: string) => {
		const n = parseVerseParam(search);
		return n !== null && verses.some((v) => v.verse_number === n) ? n : null;
	};
	const activeVerse = navHere ? validVerse(navHere.search) : selectedVerse;
	const isPending = navHere !== null && activeVerse !== selectedVerse;
	const selected =
		activeVerse !== null ? verses.find((v) => v.verse_number === activeVerse) : undefined;
	// The word selection needs the SAME optimistic treatment: the sheet must
	// know a word tap is in flight or it flashes open for the round-trip, then
	// closes when the loader's selectedWord lands (mobile drawer flicker).
	const activeWord = navHere
		? validVerse(navHere.search) !== null
			? parseWordParam(navHere.search)
			: null
		: selectedWord;

	// Cross-reference jumps record their target here (a ref, not location.state:
	// state persists on history entries and would replay the scroll on back/forward).
	const scrollIntent = useRef<number | null>(null);
	const onCrossRefNavigate = (verse: number) => {
		scrollIntent.current = verse;
	};

	// Replaces the old #vN hash: on a fresh document load or chapter change,
	// bring the selected verse into view (centered, not jammed to the top).
	// Skipped on back/forward — the browser restores its own position — and
	// when a cross-ref jump owns the scroll.
	const chapterKey = `${bookId}/${chapter}`;
	const seenChapter = useRef<string | null>(null);
	useEffect(() => {
		if (seenChapter.current === chapterKey) return;
		const isFirstRender = seenChapter.current === null;
		seenChapter.current = chapterKey;
		if (scrollIntent.current !== null) return;
		if (!isFirstRender && navigationType === "POP") return;
		if (selectedVerse !== null) scrollVerseIntoView(selectedVerse, "auto");
	}, [chapterKey, selectedVerse, navigationType]);

	// Consume the cross-ref scroll intent once its navigation settles.
	useEffect(() => {
		if (navigation.state !== "idle" || scrollIntent.current === null) return;
		if (selectedVerse === scrollIntent.current) {
			scrollVerseIntoView(selectedVerse, "smooth");
		}
		scrollIntent.current = null;
	}, [navigation.state, selectedVerse]);

	// The sheet renders the last selection during its exit animation so it
	// doesn't blank out (and keep its accessible title) while closing.
	const lastSelectedRef = useRef(selected);
	if (selected) lastSelectedRef.current = selected;
	const sheetVerse = selected ?? lastSelectedRef.current;

	// ---- graph overlay wiring ----
	// Optimistic like verse selection: the overlay opens (skeleton) the moment a
	// ?graph navigation starts; recenter/depth changes dim the current graph.
	let pendingGraph: { id: string; depth: 1 | 2 | 3 } | null | undefined;
	if (navHere !== null) {
		const p = new URLSearchParams(navHere.search);
		const g = p.get("graph");
		pendingGraph = g !== null ? { id: g, depth: clampDepth(p.get("depth")) } : null;
	}
	const effectiveGraphId = pendingGraph !== undefined ? (pendingGraph?.id ?? null) : graphId;
	const effectiveDepth = pendingGraph !== undefined ? (pendingGraph?.depth ?? 1) : graphDepth;
	const graphNavPending =
		pendingGraph !== undefined &&
		(pendingGraph?.id !== graphId || (pendingGraph !== null && pendingGraph.depth !== graphDepth));

	const graphUrl = (id: string, depth: 1 | 2 | 3) => {
		const q = new URLSearchParams();
		if (selectedVerse !== null) q.set("verse", String(selectedVerse));
		q.set("graph", id);
		q.set("depth", String(depth));
		return `${chapterUrl}?${q.toString()}`;
	};
	// Focus returns to whichever control opened the overlay (B16/UX-10).
	const graphInvoker = useRef<HTMLElement | null>(null);
	const openGraph = (id: string, depth: 1 | 2 | 3 = 1) => {
		if (document.activeElement instanceof HTMLElement && graphInvoker.current === null) {
			graphInvoker.current = document.activeElement;
		}
		navigate(graphUrl(id, depth), { preventScrollReset: true });
	};
	const closeGraph = () => {
		navigate(selectedVerse !== null ? `${chapterUrl}?verse=${selectedVerse}` : chapterUrl, {
			preventScrollReset: true,
		});
		// consumed by the overlay's onCloseAutoFocus; reset for the next open
		queueMicrotask(() => {
			graphInvoker.current = null;
		});
	};
	const readVerse = (t: { book: string; chapter: number; verse: number }) => {
		scrollIntent.current = t.verse;
		navigate(`/scripture/${t.book}/${t.chapter}?verse=${t.verse}`, { preventScrollReset: true });
	};

	// Verse-anchored artworks for the selected verse (chapter-level refs stay in the strip)
	const verseArt =
		activeVerse === null
			? []
			: art.filter((a) =>
					a.refs.some(
						(r) =>
							r.book_id === bookId &&
							r.chapter === chapter &&
							r.verse_start !== null &&
							activeVerse >= r.verse_start &&
							activeVerse <= (r.verse_end ?? r.verse_start),
					),
				);

	// A9/A15: the rail's personal layer — register rows for this verse (plus
	// chapter-anchored notes), deduped per note; null when nothing may print.
	const noteRowsFor = (verse: VerseRow) => {
		if (noteAnchors === null) return [];
		const seen = new Set<string>();
		const rows: Array<{ note_id: string; title: string; gloss: string }> = [];
		for (const a of noteAnchors) {
			const match = (a.kind === "verse" && a.ref_id === verse.id) || a.kind === "chapter";
			if (!match || seen.has(a.note_id)) continue;
			seen.add(a.note_id);
			rows.push({
				note_id: a.note_id,
				title: a.title,
				gloss: a.kind === "verse" ? "this verse" : "this chapter",
			});
		}
		return rows;
	};

	const panelFor = (verse: VerseRow) => (
		<PanelBody
			// key: disclosure state (cross-refs "see all") must not leak across verses
			key={verse.id}
			verseText={verse.text}
			isPending={isPending}
			connections={connections}
			crossRefs={crossRefs}
			mediaRefs={mediaRefs}
			art={verseArt}
			onCrossRefNavigate={onCrossRefNavigate}
			noteRows={noteRowsFor(verse)}
			canCapture={canCapture}
			// B32: signed-in with a failed anchors leg — the loader's degraded
			// shape is {canCapture: true, anchors: null} (A5/CP-8 wrapper).
			notesDegraded={canCapture && noteAnchors === null}
			captureVerseId={verse.id}
			captureVerseRef={verse.reference}
		/>
	);

	// The graph affordance is a plain word (doctrine 8: no pictographic icons;
	// typographic marks and quiet sans words carry the chrome).
	const graphButton = (entityId: string, label: string) => (
		<button
			type="button"
			onClick={() => openGraph(entityId)}
			aria-label={label}
			className="font-ui text-[11px] font-semibold text-muted-foreground transition-colors duration-150 hover:text-ink"
		>
			Graph
		</button>
	);

	return (
		<div
			className="mx-auto px-4 pt-[72px] pb-14 lg:px-6"
			data-plate={selected ? "wide" : "column"}
		>
			{/* Balance (Abram's call, overruling the earlier widths-stay ruling):
			    the column + rail center as ONE unit (the plate's geometry), and the
			    header lives inside the text column so the title, summary, and navs
			    share the verse text's left edge instead of the page's. */}
			<div
				className={
					selected
						? "mx-auto max-w-[45rem] lg:grid lg:max-w-none lg:grid-cols-[minmax(0,45rem)_380px] lg:justify-center lg:gap-x-14 lg:gap-y-10"
						: "mx-auto max-w-[45rem]"
				}
			>
			<header className="pl-10 pr-4 lg:col-start-1 lg:pl-14">
				<div className="relative mt-2 flex items-center gap-3">
					{/* the back arrow hangs in the gutter, like the verse numbers */}
					<button
						type="button"
						onClick={goBack}
						aria-label="Back"
						className="absolute -left-9 top-1/2 -translate-y-1/2 p-2 text-muted-foreground transition-colors duration-150 hover:text-ink lg:-left-11"
					>
						<ArrowLeftIcon className="size-5" aria-hidden="true" />
					</button>
					<h1 className="font-display text-[34px] font-medium tracking-[-0.01em]">
						{/* the book name doubles as a breadcrumb to the chapter grid */}
						<Link
							to={`/scripture/${bookId}`}
							className="underline-offset-4 hover:underline hover:decoration-rule2"
						>
							{bookName}
						</Link>{" "}
						{chapter}
					</h1>
					{/* the summary node is the semantically rich chapter center: it FEATURES
					    principles/people/places and COVERS the verses (bare chapter nodes
					    carry only structural CONTAINS edges) */}
					{graphButton(`summary-${bookId}-${chapter}`, `Open the local graph for ${reference}`)}
				</div>
				{/* Plate II: the chapter summary is a plain italic-serif paragraph
				    directly under the h1 — no card, no rule, no kicker label. */}
				{summary && (
					<section aria-label="Chapter summary">
						{/* heading-nav is the dominant SR navigation mode; the visual design
						    carries no label, so the heading is screen-reader-only */}
						<h2 className="sr-only">Chapter summary</h2>
						<ChapterSummary text={summary} />
					</section>
				)}
				<nav
					aria-label={`${unit} navigation`}
					className="mt-4 flex gap-4 font-ui text-xs text-muted-foreground"
				>
					{chapter > 1 && (
						<Link
							to={`/scripture/${bookId}/${chapter - 1}`}
							className="transition-colors duration-150 hover:text-ink"
						>
							‹&nbsp; {bookName} {chapter - 1}
						</Link>
					)}
					{(maxChapter === null || chapter < maxChapter) && (
						<Link
							to={`/scripture/${bookId}/${chapter + 1}`}
							className="transition-colors duration-150 hover:text-ink"
						>
							{bookName} {chapter + 1} &nbsp;›
						</Link>
					)}
				</nav>
			</header>

			{/* Chapter art rides the reading flow at every width (Abram,
			    2026-07-31): below the summary, above the text. Prints nothing
			    when a chapter has none. */}
			<ChapterArtStack
				art={art}
				reference={reference}
				galleryUrl={`/scripture/${bookId}/${chapter}/art${selectedVerse !== null ? `?verse=${selectedVerse}` : ""}`}
				className="ml-10 mt-6 lg:col-start-1 lg:ml-14"
			/>

				<main className="mt-8 lg:col-start-1 lg:row-start-2">
					<ol className="max-w-prose list-none">
						{verses.map((verse) => {
							const isActive = verse.verse_number === activeVerse;
							// a selected word always renders a card — tagged or not (an
							// untagged word must not be a dead tap, especially on mobile)
							const showWordCard =
								isActive && selectedWord !== null && wordTags !== null && !wordTags.degraded;
							const wordTag = showWordCard
								? wordTags!.tags.find((t) => t.position === selectedWord)
								: undefined;
							// the selected word's whole original-language group ("to be
							// taxed" is ONE Greek word) highlights together
							const wordGroup =
								wordTag && selectedWord !== null
									? wordGroupPositions(wordTags!.tags, selectedWord)
									: undefined;
							// Depth affordance (§6a.1): any signal deepens the verse
							// number's ink and adds a hairline tick — weight + tick
							// carry it at every width, never color alone.
							const signals = verseSignals?.[verse.verse_number];
							const hasNote = notedVerses.has(verse.verse_number);
							const hasDepth =
								hasNote || (signals !== undefined && Object.values(signals).some(Boolean));
							return (
								<li key={verse.id} id={`v${verse.verse_number}`}>
									<Link
										to={isActive ? chapterUrl : `${chapterUrl}?verse=${verse.verse_number}`}
										preventScrollReset
										viewTransition
										aria-current={isActive ? "true" : undefined}
										onClick={(e) => {
											// Abram's click rules: an active text selection never
											// navigates; a WORD click opens word study (and selects
											// the verse); anything else is a plain verse select.
											const sel = window.getSelection();
											if (sel && !sel.isCollapsed) {
												e.preventDefault();
												return;
											}
											const span = (e.target as HTMLElement).closest?.("[data-wpos]");
											if (span && isBibleBook) {
												e.preventDefault();
												navigate(
													`${chapterUrl}?verse=${verse.verse_number}&word=${span.getAttribute("data-wpos")}`,
													{ preventScrollReset: true },
												);
											}
										}}
										className={`group relative block rounded-lg py-[9px] pl-10 pr-4 font-reading text-[20px] leading-relaxed text-ink outline-none transition-[box-shadow,background-color] duration-150 hover:bg-sel/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selbar/60 lg:pl-14 ${
											isActive ? "bg-sel" : ""
										} ${signals || hasNote ? "lg:rounded-r-none lg:hover:rounded-r-none" : ""}`}
									>
										{/* ONE gutter container owns the number AND the mobile dot
										    stack (Abram: siblings drifted off-axis) — a centered
										    column below lg, the right-aligned number column at lg. */}
										<span className="absolute left-2 top-3 flex w-6 flex-col items-center lg:left-4 lg:w-7 lg:items-end">
										<span
											className={`font-ui text-xs font-semibold transition-colors duration-150 ${
												isActive
													? "text-selbar"
													: hasDepth
														? "text-muted-foreground"
														: "text-faint"
											} ${hasDepth ? "underline decoration-faint/50 decoration-1 underline-offset-4" : ""}`}
										>
											{verse.verse_number}
										</span>
										{/* §6a.2 amended (Abram): the mobile gutter speaks the full color
										    legend — typed dots stack VERTICALLY under the number (4px dots,
										    tight rhythm: a 4-kind stack runs ~23px, inside a one-line row). */}
										{hasDepth && (
											<span
												aria-hidden
												className={`mt-[6px] flex flex-col items-center gap-[2.5px] rounded-[6px] p-[3px] transition-[background-color,box-shadow] duration-150 group-hover:bg-paper lg:hidden ${
													isActive
														? "bg-paper ring-1 ring-selbar/40 group-hover:ring-0"
														: ""
												}`}
											>
												{/* A15 (gate-ratified): the note RING takes the first slot;
												    the stack clamps at 4 visible — never scrolls, never "+1".
												    Hollow form = "yours vs canon" without color (CF-21). */}
												{(
													[
														hasNote && (
															<span
																key="note"
																className="box-border size-[5px] rounded-full border-[1.5px] border-dot-note bg-transparent"
															/>
														),
														signals?.principles && (
															<span key="t" className="size-[4px] rounded-full bg-dot-teaches" />
														),
														signals?.people && (
															<span key="m" className="size-[4px] rounded-full bg-dot-mentions" />
														),
														signals?.xrefs && (
															<span key="x" className="size-[4px] rounded-full bg-dot-xref" />
														),
														signals?.media && (
															<span key="a" className="size-[4px] rounded-full bg-dot-media" />
														),
													].filter(Boolean) as React.ReactNode[]
												).slice(0, 4)}
											</span>
										)}
										</span>
										{isBibleBook ? <VerseWords text={verse.text} highlight={wordGroup} /> : verse.text}
										{/* Margin dots (spike): one per KIND of reference behind the
										    verse — stable order, first text line, outside the prose.
										    Hinting, not data: no counts, no labels. */}
										{(signals || hasNote) && (
											<span
												aria-hidden
												className={`absolute bottom-0 left-full top-0 hidden w-[72px] rounded-r-lg transition-colors duration-150 group-hover:bg-sel/40 lg:block ${
													isActive ? "bg-sel" : "bg-transparent"
												}`}
											/>
										)}
										{(signals || hasNote) && (
											<span
												aria-hidden
												className={`absolute left-[calc(100%+10px)] top-[1.15rem] hidden items-center gap-[5px] rounded-full px-[6px] py-[5px] -my-[5px] -mx-[6px] transition-[background-color,box-shadow] duration-150 group-hover:bg-paper lg:flex ${
													isActive
														? "bg-paper ring-1 ring-selbar/40 group-hover:ring-0"
														: ""
												}`}
											>
												{/* A15: ring first — the personal layer leads the cluster */}
												{hasNote && (
													<span className="box-border size-[6px] rounded-full border-[1.5px] border-dot-note bg-transparent" />
												)}
												{signals?.principles && <span className="size-[5px] rounded-full bg-dot-teaches" />}
												{signals?.people && <span className="size-[5px] rounded-full bg-dot-mentions" />}
												{signals?.xrefs && <span className="size-[5px] rounded-full bg-dot-xref" />}
												{signals?.media && <span className="size-[5px] rounded-full bg-dot-media" />}
											</span>
										)}
										{/* CF-21: SR parity — the dots are aria-hidden, so the noted
										    verse says so in its accessible name */}
										{hasNote && <span className="sr-only">, your note</span>}
									</Link>
									{showWordCard && (
										<InlineWordCard
											// on mobile ?verse alone means "drawer open", so the X
											// clears the verse too — close must not summon the sheet
											tag={wordTag ?? null}
											closeUrl={
												isMobile ? chapterUrl : `${chapterUrl}?verse=${verse.verse_number}`
											}
											detailUrl={
												isMobile ? `${chapterUrl}?verse=${verse.verse_number}` : undefined
											}
										/>
									)}
								</li>
							);
						})}
					</ol>

					{/* The page-turn lives where the reading ends (navigation.md §4):
					    in-content foot nav, never a bar. Mirrors the header's real
					    bounds; aligned to the verse text edges (pl-14 = the gutter). */}
					<nav
						aria-label={`${unit} navigation`}
						className="mt-10 flex max-w-prose justify-between border-t border-rule pl-14 pr-4 pt-4 font-ui text-xs text-muted-foreground"
					>
						{chapter > 1 ? (
							<Link
								to={`/scripture/${bookId}/${chapter - 1}`}
								className="transition-colors duration-150 hover:text-ink"
							>
								‹ {bookName} {chapter - 1}
							</Link>
						) : (
							<span aria-hidden="true" />
						)}
						{(maxChapter === null || chapter < maxChapter) && (
							<Link
								to={`/scripture/${bookId}/${chapter + 1}`}
								className="transition-colors duration-150 hover:text-ink"
							>
								{bookName} {chapter + 1} ›
							</Link>
						)}
					</nav>
				</main>

				{/* Desktop rail — always mounted (on desktop) so selecting a verse never
				    reflows the text column. Unmounted on mobile after hydration so the
				    panel isn't reconciled twice; the CSS classes keep it hidden on
				    mobile before hydration. */}
				{!isMobile && selected !== undefined && (
					/* Empty rail aligns with the first verse (grid row 3, matching main's
					   mt-8); a selection promotes it to the column top. The move animates
					   via the view transition the verse links opt into (Abram's call);
					   reduced-motion is stilled by the existing ::view-transition rules. */
					<div
						className={`hidden lg:col-start-2 lg:block ${selected ? "lg:row-start-1 lg:row-span-2" : "lg:row-start-2 lg:mt-8"}`}
						style={{ viewTransitionName: "verse-rail" }}
					>
						<section
							aria-label="Verse connections"
							className="h-fit rounded-xl border border-rule bg-panel px-6 pb-[18px] pt-[22px] lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto"
						>
						{selected ? (
							<>
								<div className="flex items-baseline justify-between gap-3">
									<h2 className="font-display text-[21px] font-medium tracking-[-0.01em]">{selected.reference}</h2>
									<span className="flex items-center gap-2">
										{graphButton(selected.id, `Open the local graph for ${selected.reference}`)}
										<Link
											to={chapterUrl}
											preventScrollReset
											viewTransition
											aria-label="Close verse panel"
											className="-m-2 p-2 font-reading text-lg leading-none text-muted-foreground transition-colors duration-150 hover:text-ink"
										>
											<span aria-hidden="true">×</span>
										</Link>
									</span>
								</div>
								{panelFor(selected)}
							</>
						) : null}
						</section>
					</div>
				)}
			</div>

			{/* Mobile — the rail becomes a bottom sheet so connections are reachable without
			    scrolling past the chapter. Mounted conditionally (not hidden with CSS): the
			    sheet portals to <body>, so a `lg:hidden` wrapper wouldn't contain it and the
			    modal would open on desktop too, blocking the page behind its overlay. */}
			{isMobile && (
				<Sheet
					// mutually exclusive with the graph overlay (UX-1): one dialog, one Esc
					// target — and a WORD tap renders the inline card instead (the sheet
					// would cover it); its "Full verse detail" link drops ?word to open this
					open={selected !== undefined && activeWord === null && effectiveGraphId === null}
					onOpenChange={(open) => {
						if (!open) navigate(chapterUrl, { preventScrollReset: true });
					}}
				>
					<SheetContent
						side="bottom"
						showCloseButton={false}
						className="max-h-[75dvh] overflow-y-auto rounded-t-2xl border-rule bg-panel p-5 pb-8"
					>
						{sheetVerse && (
							<>
								<SheetHeader className="p-0 text-left">
									{/* the rail's head idiom, in the sheet container (one anatomy,
									    two containers): reference left; Graph + × words/marks right */}
									<div className="flex items-baseline justify-between gap-3">
										<SheetTitle className="font-display text-[21px] font-medium tracking-[-0.01em] text-ink">
											{sheetVerse.reference}
										</SheetTitle>
										<span className="flex items-center gap-3">
											{graphButton(sheetVerse.id, `Open the local graph for ${sheetVerse.reference}`)}
											<SheetClose
												aria-label="Close verse panel"
												className="-m-2 p-2 font-reading text-lg leading-none text-muted-foreground transition-colors duration-150 hover:text-ink"
											>
												<span aria-hidden="true">×</span>
											</SheetClose>
										</span>
									</div>
									<SheetDescription className="sr-only">
										Connections for {sheetVerse.reference}
									</SheetDescription>
								</SheetHeader>
								{panelFor(sheetVerse)}
							</>
						)}
					</SheetContent>
				</Sheet>
			)}

			{effectiveGraphId !== null && (
				<Suspense fallback={null}>
					<GraphOverlay
						entityId={effectiveGraphId}
						depth={effectiveDepth}
						graph={graph ?? PENDING_FOREVER}
						isPending={graphNavPending}
						invoker={graphInvoker}
						onNavigate={openGraph}
						onClose={closeGraph}
						onReadVerse={readVerse}
					/>
				</Suspense>
			)}
		</div>
	);
}

/** The chapter summary wearing the doorway device (navigation.md §3): real
 * summaries run ~110 words, and unclamped they invert the page's hierarchy —
 * the apparatus louder than the text. Clamped to ~3 lines with the fade;
 * clicking discloses in place (never navigation). Short summaries render
 * plain. Focus discipline: expansion unmounts the button, so focus moves to
 * the revealed paragraph (the see-all lesson). */
function ChapterSummary({ text }: { text: string }) {
	const [expanded, setExpanded] = useState(false);
	const expandedRef = useRef<HTMLParagraphElement>(null);
	useEffect(() => {
		if (expanded) expandedRef.current?.focus();
	}, [expanded]);
	const cls = "mt-3.5 max-w-[58ch] font-reading text-[15px] italic leading-relaxed text-muted-foreground";
	if (text.length <= 220 || expanded) {
		return (
			<p ref={expandedRef} tabIndex={expanded ? -1 : undefined} className={`${cls} outline-none`}>
				{text}
			</p>
		);
	}
	return (
		<button
			type="button"
			aria-expanded="false"
			onClick={() => setExpanded(true)}
			className={`${cls} relative block max-h-[4.6em] cursor-pointer overflow-hidden text-left after:absolute after:inset-x-0 after:bottom-0 after:h-8 after:bg-gradient-to-b after:from-transparent after:to-background`}
		>
			{text}
		</button>
	);
}

function scrollVerseIntoView(verseNumber: number, behavior: ScrollBehavior) {
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	document.getElementById(`v${verseNumber}`)?.scrollIntoView({
		block: "center",
		behavior: reduced ? "auto" : behavior,
	});
}

/** Compact stack of the chapter's top artworks — ONE ≥44px button (amendment 1):
 * overlapping images are decorative (aria-hidden), the button navigates to the
 * chapter gallery, and the whole affordance is static (no fan animation). */
function ChapterArtStack({
	art,
	reference,
	galleryUrl,
	variant = "chip",
	className = "",
}: {
	art: ArtItem[];
	reference: string;
	galleryUrl: string;
	/** chip: compact inline affordance (mobile header). card: a distinct
	 * full-width card — the ENTIRE card is the link (Abram's rail design). */
	variant?: "chip" | "card";
	className?: string;
}) {
	if (art.length === 0) return null;
	const { stack, more } = pickArtStack(art, 5);
	// loader caps at 24; the gallery shows the true count
	const countLabel = `${art.length}${art.length >= 24 ? "+" : ""}`;
	const variantClasses =
		variant === "card"
			? "flex w-full rounded-xl border border-rule bg-panel p-4"
			: "inline-flex rounded-lg border border-rule2 bg-panel py-1.5 pl-1.5 pr-4";
	return (
		<Link
			to={galleryUrl}
			viewTransition
			aria-label={`View ${countLabel} artworks for ${reference}`}
			className={`group min-h-11 items-center gap-3 transition-colors duration-150 hover:border-primary ${variantClasses} ${className}`}
		>
			<span aria-hidden="true" className="flex items-center">
				{stack.map((a, i) => (
					<span
						key={a.id}
						className={`block h-14 w-14 overflow-hidden rounded-md border-2 border-panel shadow-sm ${i > 0 ? "-ml-5" : ""}`}
						// shared-element morph: this thumb glides to its gallery
						// position during the navigation (Abram's design)
						style={{ zIndex: stack.length - i, viewTransitionName: artTransitionName(a.id) }}
					>
						<ArtImage art={a} className="h-full w-full object-cover" />
					</span>
				))}
			</span>
			<span className="font-ui text-xs font-semibold text-ink group-hover:text-primary">
				Art · {countLabel}
				{more > 0 && <span className="ml-1 font-normal text-muted-foreground">view all</span>}
			</span>
		</Link>
	);
}

interface AppendResponse {
	ok?: boolean;
	undone?: boolean;
	note_id?: string;
	title?: string;
	updated_at?: string;
	appended_line?: string;
	anchor_was_new?: boolean;
	code?: string;
}

/**
 * personal-notes A9 — the rail's capture verbs. Capture is a rail act,
 * composition is a route act: `Add to note` appends to the last-touched
 * note via fetcher (no navigation; the one-line gloss confirmation IS the
 * undo window — no toast); `New note` navigates with the anchor prefilled
 * and Back restores `?verse=`. No last-touched note → only `New note`
 * prints. Last-touched lives in localStorage, written by the note page.
 */
function NoteCaptureVerbs({ verseId, verseRef }: { verseId: string; verseRef: string }) {
	const fetcher = useFetcher<AppendResponse>();
	const [last, setLast] = useState<{ id: string; title: string } | null>(null);
	useEffect(() => {
		try {
			const raw = localStorage.getItem("lumen:last-note");
			if (raw) {
				const parsed = JSON.parse(raw) as { id?: string; title?: string };
				if (typeof parsed.id === "string") {
					setLast({ id: parsed.id, title: parsed.title ?? "your note" });
				}
			}
		} catch {
			// storage unavailable → the New-note door still prints
		}
	}, []);

	const appended =
		fetcher.state === "idle" && fetcher.data?.ok === true && fetcher.data.undone !== true;
	const failed = fetcher.state === "idle" && fetcher.data !== undefined && fetcher.data.ok !== true;
	// B34 (CP-37): a 404 means the last-touched note is GONE (deleted) — a
	// permanent state, not a transient save failure.
	const lastNoteGone = failed && fetcher.data?.code === "not_found";

	// B34: invalidate the stale pointer so every later capture on every verse
	// degrades cleanly to the New-note door instead of 404ing forever.
	useEffect(() => {
		if (!lastNoteGone) return;
		try {
			localStorage.removeItem("lumen:last-note");
		} catch {
			// storage unavailable — dropping local state still un-wedges this page
		}
		setLast(null);
	}, [lastNoteGone]);

	// B37 (CP-40): the buttons unmount when the gloss replaces them (and vice
	// versa) — a keyboard-driven capture must hand focus across the swap, the
	// same B5 discipline this file keeps for "See all"/"Show fewer".
	const openLinkRef = useRef<HTMLAnchorElement>(null);
	const addBtnRef = useRef<HTMLButtonElement>(null);
	const newLinkRef = useRef<HTMLAnchorElement>(null);
	const keyboardCaptureRef = useRef(false);
	const prevAppendedRef = useRef(false);
	useEffect(() => {
		const was = prevAppendedRef.current;
		prevAppendedRef.current = appended;
		if (!keyboardCaptureRef.current) return;
		if (appended && !was) {
			// append landed: the gloss's "open" link is the focus target
			openLinkRef.current?.focus();
		} else if (!appended && was) {
			// undo landed: symmetric handoff back to the re-printed verb
			keyboardCaptureRef.current = false;
			(addBtnRef.current ?? newLinkRef.current)?.focus();
		}
	}, [appended]);
	// B34+B37: when the 404 unmounts "Add to note" under a keyboard user,
	// land on the New-note door instead of <body>.
	useEffect(() => {
		if (!lastNoteGone || !keyboardCaptureRef.current) return;
		keyboardCaptureRef.current = false;
		newLinkRef.current?.focus();
	}, [lastNoteGone]);

	const verbClass =
		"font-ui text-[11px] font-semibold text-muted-foreground transition-colors duration-150 hover:text-ink";

	return (
		<div className="mt-2">
			<div aria-live="polite">
				{appended && fetcher.data?.note_id ? (
					<p className="font-ui text-[11px] text-muted-foreground">
						Added to “{fetcher.data.title}” —{" "}
						<Link
							ref={openLinkRef}
							to={`/notes/${fetcher.data.note_id}`}
							className="underline decoration-dotted underline-offset-2 hover:text-ink"
						>
							open
						</Link>{" "}
						·{" "}
						<button
							type="button"
							className="underline decoration-dotted underline-offset-2 hover:text-ink"
							onClick={(e) => {
								keyboardCaptureRef.current = e.detail === 0;
								const d = fetcher.data!;
								fetcher.submit(
									{
										intent: "append_undo",
										anchor: verseId,
										appended_line: d.appended_line ?? "",
										base_updated_at: d.updated_at ?? "",
										anchor_was_new: d.anchor_was_new ? "1" : "0",
									},
									{ method: "post", action: `/notes/${d.note_id}` },
								);
							}}
						>
							undo
						</button>
					</p>
				) : null}
				{failed ? (
					<p className="font-ui text-[11px] text-muted-foreground">
						{/* B34: honest copy — "try again" was a lie for a deleted note */}
						{lastNoteGone ? "That note is gone — start a new one." : "That didn’t save — try again."}
					</p>
				) : null}
			</div>
			{!appended && (
				<p className="flex gap-4">
					{last !== null && (
						<button
							ref={addBtnRef}
							type="button"
							className={verbClass}
							onClick={(e) => {
								keyboardCaptureRef.current = e.detail === 0;
								fetcher.submit(
									{ intent: "append", anchor: verseId, label: verseRef },
									{ method: "post", action: `/notes/${last.id}` },
								);
							}}
						>
							{fetcher.state !== "idle" ? "Adding…" : "Add to note"}
						</button>
					)}
					<Link ref={newLinkRef} to={`/notes/new?anchor=${verseId}`} className={verbClass}>
						New note
					</Link>
				</p>
			)}
		</div>
	);
}

function PanelBody({
	verseText,
	isPending,
	connections,
	crossRefs,
	mediaRefs,
	art,
	onCrossRefNavigate,
	noteRows,
	canCapture,
	notesDegraded,
	captureVerseId,
	captureVerseRef,
}: {
	verseText: string;
	isPending: boolean;
	connections: Promise<VersePanelData> | null;
	crossRefs: CrossRefsPanel | null;
	mediaRefs: MediaRefsPanel | null;
	art: ArtItem[];
	onCrossRefNavigate: (verse: number) => void;
	noteRows: Array<{ note_id: string; title: string; gloss: string }>;
	canCapture: boolean;
	/** B32: the anchors leg failed signed-in (canCapture true, anchors null) —
	 * the register must say so instead of silently printing capture verbs. */
	notesDegraded: boolean;
	captureVerseId: string;
	captureVerseRef: string;
}) {
	return (
		<>
			{/* the verse itself rides the pane ONLY on mobile — the sheet covers
			    the page there; on desktop the verse sits beside the rail. Roman,
			    not italic (Abram: italics too hard to read at this size). */}
			<blockquote className="mt-3 border-l-2 border-rule2 pl-3 font-reading text-[15px] leading-relaxed text-muted-foreground lg:hidden">
				{verseText}
			</blockquote>
			{/* personal-notes A15 (gate-ratified): the personal register leads,
			    above art. Rows print only when notes exist; the capture VERBS are
			    affordances exempt from the print-nothing law — they are the scent
			    (CF-20). Signed-out: neither prints (noteRows empty, canCapture
			    false — F2). */}
			{(noteRows.length > 0 || canCapture) && (
				<div className="mt-[18px]">
					{noteRows.length > 0 && (
						<>
							<h3 className="flex items-center gap-2 font-ui text-[13px] font-normal text-muted-foreground">
								<NotebookPenIcon aria-hidden="true" strokeWidth={1.75} className="size-[13px]" />
								Your notes
							</h3>
							<ul className="mt-1 list-none">
								{noteRows.slice(0, 20).map((r) => (
									<li key={r.note_id} className="border-t border-rule first:border-t-0">
										<Link
											to={`/notes/${r.note_id}`}
											className="group flex items-baseline justify-between gap-3 py-2"
										>
											<span className="min-w-0">
												<span className="block truncate font-reading text-[14.5px] leading-[1.45] text-ink underline-offset-4 group-hover:underline group-hover:decoration-rule2">
													{r.title}
												</span>
												<span className="block truncate font-ui text-[11px] text-muted-foreground">
													{r.gloss}
												</span>
											</span>
										</Link>
									</li>
								))}
							</ul>
							{noteRows.length > 20 && (
								<Link
									to="/notes"
									className="mt-1 block font-ui text-[11px] font-semibold text-muted-foreground transition-colors duration-150 hover:text-ink"
								>
									See all →
								</Link>
							)}
						</>
					)}
					{/* B32 (rail): a degraded anchors leg otherwise prints ONLY capture
					    verbs — indistinguishable from "no notes here". One quiet line;
					    the print-nothing rules are untouched (signed-out: canCapture
					    false; healthy empty: notesDegraded false). */}
					{notesDegraded && (
						<p className="font-ui text-[11px] text-muted-foreground">
							Your notes are unavailable right now.
						</p>
					)}
					{canCapture && <NoteCaptureVerbs verseId={captureVerseId} verseRef={captureVerseRef} />}
				</div>
			)}
			{art.length > 0 && (
				<div className="mt-[18px]">
					<h3 className="flex items-center gap-2 font-ui text-[13px] font-normal text-muted-foreground">
						<ImageIcon aria-hidden="true" strokeWidth={1.75} className="size-[13px]" />
						Art · {art.length}
					</h3>
					<ul className="mt-2 flex list-none gap-2 overflow-x-auto">
						{art.slice(0, 6).map((a) => {
							// sanitized at construction; skip the anchor when neither
							// field yields a URL (no href="" same-page trap, CSC-1)
							const href = a.sourceUrl || a.image;
							const thumb = (
								<ArtImage art={a} className="h-20 w-28 rounded-md border border-rule2 object-cover" />
							);
							return (
								<li key={a.id} className="shrink-0">
									{href ? (
										<a href={href} target="_blank" rel="noreferrer" title={`${a.title}${a.artist ? ` — ${a.artist}` : ""}`}>
											{thumb}
										</a>
									) : (
										thumb
									)}
								</li>
							);
						})}
					</ul>
				</div>
			)}
			{/* Panel order (Abram's call): principles/people first, citations below.
			    The streamed chips block keeps a reserved-shape skeleton so its
			    resolve nudges the accordion headers below as little as possible;
			    the accordion defaults collapsed, so the whole detail view stays
			    scannable and citations expand to the full list on demand. */}
			{isPending || connections === null ? (
				<EntityChipsSkeleton />
			) : (
				<Suspense fallback={<EntityChipsSkeleton />}>
					{/* errorElement: the server maps failures to {degraded:true}, but the
					    stream itself can still reject client-side — turbo-stream aborts
					    (server streamTimeout) and navigations cancelling in-flight deferred
					    data. Without it those rejections would take down the whole page.
					    Degradation is a value the UI prints as ABSENCE (Plate II·b) —
					    the errorElement renders nothing, it only contains the rejection. */}
					<Await resolve={connections} errorElement={<></>}>
						{(panel) => <Connections panel={panel} />}
					</Await>
				</Suspense>
			)}
			{/* Media moments after the entity rows, before citations (panel-order
			    amendment: "who teaches this verse" reads with the entities). */}
			{!isPending && mediaRefs !== null && !mediaRefs.degraded && mediaRefs.moments.length > 0 && (
				<div className="mt-[18px]">
					<h3 className="flex items-center gap-2 font-ui text-[13px] font-normal text-muted-foreground">
						<HeadphonesIcon aria-hidden="true" strokeWidth={1.75} className="size-[13px]" />
						Heard in
					</h3>
					{/* Plate II·b quiet ruled rows — RefRow's chip idiom stays the
					    media-page treatment; inside this rail every register is ruled.
					    ▸ is a licensed player glyph (doctrine 8). */}
					<ul className="mt-1 list-none">
						{mediaRefs.moments.map((m) => (
							<li key={`${m.episodeId}-${m.t}`} className="border-t border-rule first:border-t-0">
								<Link
									to={`/media/${m.episodeId}?t=${Math.floor(m.t)}`}
									aria-label={`Play ${m.episodeName} from ${fmtTimestamp(m.t)}`}
									className="group flex items-baseline justify-between gap-3 py-2"
								>
									<span className="min-w-0">
										<span className="block truncate font-reading text-[14.5px] leading-[1.45] text-ink underline-offset-4 group-hover:underline group-hover:decoration-rule2">
											{m.episodeName.replace(/^Come Follow Me - /, "")}
										</span>
										<span className="block truncate font-ui text-[11px] text-muted-foreground">
											Unshaken · discusses this verse
										</span>
									</span>
									<span className="shrink-0 font-ui text-[10.5px] tabular-nums text-muted-foreground">
										▸ {fmtTimestamp(m.t)}
									</span>
								</Link>
							</li>
						))}
					</ul>
				</div>
			)}
			{isPending || crossRefs === null ? (
				<CrossRefsSkeleton />
			) : (
				<CrossRefsSection panel={crossRefs} onNavigate={onCrossRefNavigate} />
			)}
		</>
	);
}
/** Bible verse text as word-boundary spans (client-side, SAME tokenizer as
 * the ingest — offsets agree by construction). Spans carry data-wpos for the
 * verse Link's click router; hover underline is CSS, hover-capable only.
 * `highlight` marks the selected word's whole same-Strong's run — several
 * English words often render ONE original word ("to be taxed" ← ἀπογράφω). */
function VerseWords({ text, highlight }: { text: string; highlight?: ReadonlySet<number> }) {
	const tokens = tokenize(text);
	const parts: React.ReactNode[] = [];
	let cursor = 0;
	for (const t of tokens) {
		if (t.char_start > cursor) parts.push(text.slice(cursor, t.char_start));
		parts.push(
			<span
				key={t.position}
				data-wpos={t.position}
				className={highlight?.has(t.position) ? "rounded-[3px] bg-selbar/20" : undefined}
			>
				{text.slice(t.char_start, t.char_end)}
			</span>,
		);
		cursor = t.char_end;
	}
	if (cursor < text.length) parts.push(text.slice(cursor));
	return <>{parts}</>;
}

/** The terse in-body word card (Abram's design): language, original script,
 * transliteration, one-line meaning, Details → the word page. Renders below
 * the tapped verse; the chapter gently slides down (reduced-motion: instant).
 * `tag: null` = an untagged word — still a card, never a dead tap. `detailUrl`
 * (mobile, where the word tap suppresses the verse sheet) escalates to the
 * full verse detail by dropping ?word from the URL. */
function InlineWordCard({
	tag,
	closeUrl,
	detailUrl,
}: {
	tag: WordTagRow | null;
	closeUrl: string;
	detailUrl?: string;
}) {
	const cardRef = useRef<HTMLDivElement>(null);
	// tapping a word near the viewport's bottom edge renders the card out of
	// view — nudge minimally ('nearest': a no-op when already visible)
	useEffect(() => {
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		cardRef.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
	}, [tag?.position]);
	// lead with the content word, not a tag-along function word — "taxing" is
	// [G3588 ὁ, G582 ἀπογραφή] and the article's gloss reads as no definition
	const primary = tag ? primaryEntry(tag.entries) : undefined;
	// `!tag ||` is redundant at runtime (tag null ⇒ primary undefined) but
	// narrows `tag` for the entries-count line below (pre-existing TS18047)
	if (!tag || !primary) {
		return (
			<div
				ref={cardRef}
				className="my-1 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200 motion-safe:ease-out"
			>
				<div className="rounded-lg border border-rule2 bg-panel p-3">
					<div className="flex items-baseline justify-between gap-3">
						<p className="font-reading text-sm text-muted-foreground">
							No original-language data recorded for this word.
						</p>
						<Link
							to={closeUrl}
							preventScrollReset
							aria-label="Close word study"
							className="-m-1 p-1 text-muted-foreground transition-colors duration-150 hover:text-ink"
						>
							<XIcon className="size-3.5" aria-hidden="true" />
						</Link>
					</div>
					{detailUrl && (
						<Link
							to={detailUrl}
							preventScrollReset
							className="mt-2 inline-block font-ui text-[11px] font-semibold text-primary hover:underline"
						>
							Full verse detail →
						</Link>
					)}
				</div>
			</div>
		);
	}
	const lang = strongsLanguage(primary.strongs_no);
	return (
		<div
			ref={cardRef}
			className="my-1 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200 motion-safe:ease-out"
		>
			<div className="rounded-lg border border-rule2 bg-panel p-3">
				<div className="flex items-baseline justify-between gap-3">
					<p className="font-ui text-xs text-ink">
						<span className="mr-2 rounded border border-rule2 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
							{lang}
						</span>
						{primary.original && (
							<span className="mr-2 font-reading text-base" dir={lang === "Hebrew" ? "rtl" : "ltr"}>
								{primary.original}
							</span>
						)}
						{primary.translit && <span className="mr-1.5 font-semibold italic">{primary.translit}</span>}
						<span className="text-faint">{primary.strongs_no}</span>
					</p>
					<Link
						to={closeUrl}
						preventScrollReset
						aria-label="Close word study"
						className="-m-1 p-1 text-muted-foreground transition-colors duration-150 hover:text-ink"
					>
						<XIcon className="size-3.5" aria-hidden="true" />
					</Link>
				</div>
				{primary.gloss && (
					<p className="mt-1 font-reading text-[15px] text-ink">{primary.gloss}</p>
				)}
				{tag.entries.length > 1 && (
					<p className="mt-0.5 font-ui text-[10px] text-faint">
						+{tag.entries.length - 1} more sense{tag.entries.length > 2 ? "s" : ""} on the detail page
					</p>
				)}
				<div className="mt-2 flex gap-4">
					<Link
						to={`/word/${primary.strongs_no}`}
						className="font-ui text-[11px] font-semibold text-primary hover:underline"
					>
						Details →
					</Link>
					{detailUrl && (
						<Link
							to={detailUrl}
							preventScrollReset
							className="font-ui text-[11px] font-semibold text-primary hover:underline"
						>
							Full verse detail →
						</Link>
					)}
				</div>
			</div>
		</div>
	);
}

/** Skeleton for the synchronous cross-ref block (only shown while a same-chapter
 * verse navigation is pending — the data itself arrives with the loader).
 * Shaped like the at-rest register — a label, three ruled rows, the see-all
 * row — so the pending→resolved swap moves layout as little as possible (CUX-2). */
function CrossRefsSkeleton() {
	return (
		<div aria-busy="true">
			<span className="sr-only">Loading cross-references…</span>
			<div className="mt-5" aria-hidden="true">
				<Skeleton className="h-4 w-32" />
				<div className="mt-2 space-y-2">
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-5 w-24" />
				</div>
			</div>
		</div>
	);
}

/** aria-busy scopes to ONLY the still-streaming entity block (A11Y-2) —
 * the already-rendered cross-ref rows are never inside a busy region. */
function EntityChipsSkeleton() {
	return (
		<div aria-busy="true">
			<span className="sr-only">Loading principles and people…</span>
			<div className="mt-5 space-y-5" aria-hidden="true">
				<div>
					<Skeleton className="h-4 w-20" />
					<div className="mt-2 space-y-2">
						<Skeleton className="h-6 w-full" />
						<Skeleton className="h-6 w-3/4" />
					</div>
				</div>
			</div>
		</div>
	);
}

/** One "Cross-references" register (Plate II·b): at rest the top three ruled
 * rows and a "See all N →" door; disclosed IN PLACE via controlled state —
 * the URL, the back button, and the chapter column are untouched. Esc folds
 * the disclosure (before anything else closes) and returns focus to the
 * trigger. Degraded or empty renders NOTHING — degradation is a value the
 * UI prints as absence. */
function CrossRefsSection({
	panel,
	onNavigate,
}: {
	panel: CrossRefsPanel;
	onNavigate: (verse: number) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const seeAllRef = useRef<HTMLButtonElement>(null);
	const showFewerRef = useRef<HTMLButtonElement>(null);
	const restoreFocus = useRef(false);
	const disclosureId = useId();
	// Focus returns to the "See all" trigger AFTER the collapsed tree renders it again.
	useEffect(() => {
		if (!expanded && restoreFocus.current) {
			restoreFocus.current = false;
			seeAllRef.current?.focus();
		}
	}, [expanded]);
	// Symmetric on expand: activating "See all" unmounts the focused trigger, so
	// without this focus drops to <body> (desktop: Esc never reaches our
	// onKeyDown) or gets recaptured by the mobile Sheet's FocusScope (Esc then
	// closes the WHOLE sheet — inverting doctrine 6). Keeping focus on "Show
	// fewer" keeps keydowns bubbling through this register's div. Expansion is
	// only ever user-initiated (state starts false; PanelBody keys this per
	// verse), so focusing here never steals focus on mount.
	useEffect(() => {
		if (expanded) showFewerRef.current?.focus();
	}, [expanded]);

	if (panel.degraded) return null;
	const { cards } = panel;
	if (cards.length === 0) return null;

	// groupCrossRefs already vote-sorted the cards; filtering preserves that order.
	const references = cards.filter((c) => c.direction === "outgoing");
	const referencedBy = cards.filter((c) => c.direction === "incoming");
	// The door's N is the RENDERED card count (plate semantics: "See all 14" =
	// 3 + 11 disclosed rows). The SQL totals are pre-dedup/pre-limit and can
	// overstate on hub verses; truncation is disclosed by the group sublabels.
	const total = references.length + referencedBy.length;
	// Truncation is disclosed, not silent — but only when rows were actually cut
	// by the loader's 200/direction limit: the SQL total counts pre-dedup rows,
	// so "N of M" with untruncated cards would misread duplicates as hidden refs.
	const groupCount = (rendered: number, sqlTotal: number) =>
		rendered >= 200 && sqlTotal > rendered ? `${rendered} of ${sqlTotal}` : `${rendered}`;
	const collapse = () => {
		restoreFocus.current = true;
		setExpanded(false);
	};

	const credit = !panel.curated && (
		<p className="mt-1.5 font-ui text-[10px] text-faint">
			Cross-references:{" "}
			<a
				href="https://www.openbible.info/labs/cross-references/"
				target="_blank"
				rel="noreferrer"
				className="underline hover:text-ink"
			>
				openbible.info
			</a>{" "}
			(
			<a
				href="https://creativecommons.org/licenses/by/4.0/"
				target="_blank"
				rel="noreferrer"
				className="underline hover:text-ink"
			>
				CC BY 4.0
			</a>
			, adapted — ranges expanded)
		</p>
	);

	return (
		<div
			className="mt-5"
			onKeyDown={(e) => {
				// Esc folds the disclosure first (doctrine 6: innermost thing closes);
				// respect handlers deeper in the tree that already consumed the key.
				if (expanded && e.key === "Escape" && !e.defaultPrevented) {
					e.preventDefault();
					collapse();
				}
			}}
		>
			<h3 className="flex items-center gap-2 font-ui text-[13px] font-normal text-muted-foreground">
				<Link2Icon aria-hidden="true" strokeWidth={1.75} className="size-[13px]" />
				{/* the disclosed state carries the count (plate: "Cross-references · 14") */}
				{expanded ? `Cross-references · ${total}` : "Cross-references"}
				{panel.curated && (
					// curated provenance as a quiet sans word, never a bordered chip
					<span className="ml-1 font-ui text-[11px] font-normal text-faint">curated</span>
				)}
			</h3>
			{!expanded ? (
				<ul className="mt-1 list-none">
					{cards.slice(0, 3).map((x) => (
						<CrossRefRow
							key={`${x.direction}-${x.verse_id}`}
							card={x}
							onNavigate={onNavigate}
							className="border-t border-rule first:border-t-0"
						/>
					))}
					{cards.length > 3 && (
						<li className="border-t border-rule">
							<button
								ref={seeAllRef}
								type="button"
								aria-expanded={false}
								onClick={() => setExpanded(true)}
								className="flex w-full py-2 text-left font-ui text-[11.5px] font-semibold text-muted-foreground transition-colors duration-150 hover:text-ink"
							>
								See all {total} →
							</button>
						</li>
					)}
				</ul>
			) : (
				<div className="mt-1" id={disclosureId}>
					<button
						ref={showFewerRef}
						type="button"
						aria-expanded={true}
						aria-controls={disclosureId}
						onClick={collapse}
						className="flex w-full py-2 text-left font-ui text-[11.5px] font-semibold text-muted-foreground transition-colors duration-150 hover:text-ink"
					>
						Show fewer ↑
					</button>
					{references.length > 0 && (
						<>
							{/* the sublabel carries direction for the whole group, so the
							    rows below drop their per-row "cites ·" gloss (Plate II·b) */}
							<span className="block border-t border-rule pb-0.5 pt-3 font-ui text-[10.5px] font-medium text-muted-foreground">
								Cites · {groupCount(references.length, panel.totals.outgoing)}
							</span>
							<ul className="list-none">
								{references.map((x) => (
									<CrossRefRow
										key={`${x.direction}-${x.verse_id}`}
										card={x}
										onNavigate={onNavigate}
										showDirection={false}
										className="border-t border-rule"
									/>
								))}
							</ul>
						</>
					)}
					{referencedBy.length > 0 && (
						<>
							<span className="block border-t border-rule pb-0.5 pt-3 font-ui text-[10.5px] font-medium text-muted-foreground">
								Cited by · {groupCount(referencedBy.length, panel.totals.incoming)}
							</span>
							<ul className="list-none">
								{referencedBy.map((x) => (
									<CrossRefRow
										key={`${x.direction}-${x.verse_id}`}
										card={x}
										onNavigate={onNavigate}
										showDirection={false}
										className="border-t border-rule"
									/>
								))}
							</ul>
						</>
					)}
				</div>
			)}
			{credit}
		</div>
	);
}

function Connections({ panel }: { panel: VersePanelData }) {
	// degraded renders as absence (Plate II·b) — never an error box
	if (panel.degraded) return null;
	if (panel.principles.length === 0 && panel.people.length === 0) return null;

	return (
		// the live region belongs HERE — this is the block that arrives late
		// (streamed via Await); the cross-ref rows below render synchronously (CUX-1)
		<div
			aria-live="polite"
			className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200 motion-safe:ease-out"
		>
			<EntityRows title="Teaches" labelIcon={<LightbulbIcon aria-hidden="true" strokeWidth={1.75} className="size-[13px]" />} dotClass="bg-dot-teaches" chips={panel.principles} nodeType="principles" />
			<EntityRows title="Mentions" labelIcon={<UsersIcon aria-hidden="true" strokeWidth={1.75} className="size-[13px]" />} dotClass="bg-dot-mentions" chips={panel.people} nodeType="people" />
		</div>
	);
}

/** Typed ruled rows (Plate II·b): full-width, hairline-ruled between rows,
 * a 5px type dot and the serif name. Each row is a door to the node page. */
function EntityRows({
	title,
	labelIcon,
	dotClass,
	chips,
	nodeType,
}: {
	title: string;
	/** small lucide mark in the register's dot color — the label reads as a
	 * header, not another row (Abram's ruling; rows keep the dots) */
	labelIcon: React.ReactNode;
	dotClass: string;
	chips: VerseEntityRef[];
	/** Typed node-page slug (the type is the slug); rows navigate to the node
	 * page — the graph is an opt-in view THERE, not the row's destination. */
	nodeType: "principles" | "people";
}) {
	if (chips.length === 0) return null;
	return (
		<div className="mt-[18px]">
			<h3 className="flex items-center gap-2 font-ui text-[13px] font-normal text-muted-foreground">
				{labelIcon}
				{title}
			</h3>
			<ul className="mt-1 list-none">
				{chips.map((c) => (
					<li key={c.id} className="border-t border-rule first:border-t-0">
						<Link
							to={`/${nodeType}/${encodeURIComponent(c.id)}`}
							aria-label={`About ${c.name}`}
							className="group flex items-baseline gap-2 py-2"
						>
							<span aria-hidden className={`relative -top-[3px] size-[5px] shrink-0 rounded-full ${dotClass}`} />
							<span className="font-reading text-[14.5px] leading-[1.45] text-ink underline-offset-4 group-hover:underline group-hover:decoration-rule2">
								{c.name}
							</span>
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}

/** "1-ne-3-7" → link target, via the package's own verse-id grammar (bad ids → null → unlinked card). */
function verseIdToTarget(verseId: string): { href: string; verse: number } | null {
	const parsed = parseReference(verseId);
	if (parsed.level !== "verse" || !parsed.bookId || !parsed.chapter || !parsed.verse) return null;
	return {
		href: `/scripture/${parsed.bookId}/${parsed.chapter}?verse=${parsed.verse}`,
		verse: parsed.verse,
	};
}

/** Per-source provenance words, lowercased to fit the quiet gloss register.
 * The old panel deliberately distinguished AI-suggested from human-curated —
 * collapsing them to one word would mislabel machine suggestions as
 * human-curated (a trust-signal inversion). Keep that distinction. */
const CURATED_SOURCE_WORDS: Record<string, string> = {
	"anthropic-batch": "AI-suggested",
	curated: "curated",
	"lds-doc-project": "LDS Documentation Project",
};

/** One ruled reference row: the serif reference (the accessible name carries
 * the full range, A11Y-3) over a one-line sans gloss built from the card —
 * direction ("cites ·" / "cited by ·") unless the surrounding group sublabel
 * already carries it (Plate II·b disclosed state), curated provenance where
 * the source isn't OpenBible, and the target's text. */
function CrossRefRow({
	card,
	onNavigate,
	showDirection = true,
	className = "",
}: {
	card: CrossRefCard;
	onNavigate: (verse: number) => void;
	showDirection?: boolean;
	className?: string;
}) {
	const target = verseIdToTarget(card.verse_id);
	const gloss = card.direction === "outgoing" ? "cites" : "cited by";
	// provenance stays visible on curated-source rows (trust signal kept from
	// the old panel) — as a quiet word in the gloss, never a bordered chip
	const sourceWord =
		card.source !== null && card.source !== "openbible"
			? (CURATED_SOURCE_WORDS[card.source] ?? card.source)
			: null;
	const body = (
		<>
			<span className="block font-reading text-[14.5px] leading-[1.45] text-ink underline-offset-4 group-hover:underline group-hover:decoration-rule2">
				{card.label}
			</span>
			<span className="block truncate font-ui text-[11px] text-muted-foreground">
				{showDirection ? `${gloss} · ` : ""}
				{sourceWord ? `${sourceWord} · ` : ""}
				{card.text}
			</span>
		</>
	);
	return (
		<li className={className}>
			{target ? (
				<Link
					to={target.href}
					preventScrollReset
					onClick={() => onNavigate(target.verse)}
					className="group block py-2"
				>
					{body}
				</Link>
			) : (
				<div className="py-2">{body}</div>
			)}
		</li>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	const is404 = isRouteErrorResponse(error) && error.status === 404;
	const detail =
		isRouteErrorResponse(error) && typeof error.data === "string" && error.data
			? error.data
			: "Something went wrong loading this chapter.";
	return (
		<main className="mx-auto max-w-2xl px-6 py-16">
			<h1 className="font-display text-3xl font-medium">{is404 ? "Not found" : "Error"}</h1>
			<p className="mt-3 font-reading text-muted-foreground">{detail}</p>
			<p className="mt-6">
				<a href="/" className="font-ui text-sm font-semibold text-primary underline">
					← Back to the library
				</a>
			</p>
		</main>
	);
}
