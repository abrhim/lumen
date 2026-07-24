import { Suspense, lazy, useEffect, useId, useRef, useState } from "react";
import {
	Await,
	Link,
	isRouteErrorResponse,
	useNavigate,
	useNavigation,
	useNavigationType,
} from "react-router";
import { ArrowLeftIcon, XIcon } from "lucide-react";
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
import { getSessionUser } from "../lib/auth.server";
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
	const [verses, summary, publicCollections, artRows, chapterRows, crossRefsRaw, wordTagsRaw, mediaRefsRaw, verseSignals] = await Promise.all([
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
	]);

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

	return {
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
		graphId,
		graphDepth,
		graph,
		art: (artRows ?? []).map(toArtItem),
		maxChapter: chapterRows.length > 0 ? Math.max(...chapterRows.map((c) => c.chapter_number)) : null,
	};
}

export function meta({ data }: Route.MetaArgs) {
	return [{ title: data ? `${data.reference} · Lumen` : "Lumen" }];
}

export default function Scripture({ loaderData }: Route.ComponentProps) {
	const { bookId, chapter, reference, summary, verses, selectedVerse, selectedWord, connections, crossRefs, wordTags, mediaRefs, verseSignals, graphId, graphDepth, graph, art, maxChapter } =
		loaderData;
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
		<div className="mx-auto px-4 pt-[72px] pb-14 lg:px-6">
			{/* Balance (Abram's call, overruling the earlier widths-stay ruling):
			    the column + rail center as ONE unit (the plate's geometry), and the
			    header lives inside the text column so the title, summary, and navs
			    share the verse text's left edge instead of the page's. */}
			<div className="mx-auto max-w-[45rem] lg:grid lg:max-w-none lg:grid-cols-[minmax(0,45rem)_380px] lg:justify-center lg:gap-10">
			<header className="pl-10 pr-4 lg:col-start-1 lg:pl-14">
				<p className="font-ui text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">
					<Link to="/" className="hover:text-ink">
						Lumen
					</Link>
				</p>
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

			{/* Mobile only — desktop's stack lives at the top of the verse-detail
			    rail (Abram's placement call); mobile has no rail, so discovery
			    stays near the header. */}
			<ChapterArtStack
				art={art}
				reference={reference}
				galleryUrl={`/scripture/${bookId}/${chapter}/art${selectedVerse !== null ? `?verse=${selectedVerse}` : ""}`}
				className="mt-6 lg:hidden"
			/>

				<main className="mt-8 lg:col-start-1">
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
							const hasDepth = signals !== undefined && Object.values(signals).some(Boolean);
							return (
								<li key={verse.id} id={`v${verse.verse_number}`}>
									<Link
										to={isActive ? chapterUrl : `${chapterUrl}?verse=${verse.verse_number}`}
										preventScrollReset
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
										className={`relative block rounded-lg py-[9px] pl-10 pr-4 font-reading text-[20px] leading-relaxed text-ink transition-[box-shadow,background-color] duration-150 hover:ring-1 hover:ring-inset hover:ring-selbar/35 lg:pl-14 ${
											isActive ? "bg-sel" : ""
										}`}
									>
										<span
											className={`absolute left-2 top-3 w-6 text-right font-ui text-xs font-semibold transition-colors duration-150 lg:left-4 lg:w-7 ${
												isActive
													? "text-selbar"
													: hasDepth
														? "text-muted-foreground"
														: "text-faint"
											} ${hasDepth ? "underline decoration-faint/50 decoration-1 underline-offset-4" : ""}`}
										>
											{verse.verse_number}
										</span>
										{/* §6a.2 — mobile single gutter dot: below lg one neutral
										    dot under the number says "depth exists" (the typed
										    spread stays desktop-only in the margin). */}
										{hasDepth && (
											<span
												aria-hidden
												className="absolute left-2 top-8 flex w-6 justify-end lg:hidden"
											>
												<span className="size-[4.5px] rounded-full bg-faint/60" />
											</span>
										)}
										{isBibleBook ? <VerseWords text={verse.text} highlight={wordGroup} /> : verse.text}
										{/* Margin dots (spike): one per KIND of reference behind the
										    verse — stable order, first text line, outside the prose.
										    Hinting, not data: no counts, no labels. */}
										{signals && (
											<span
												aria-hidden
												className="absolute -right-[26px] top-[1.15rem] hidden items-center gap-[5px] lg:flex"
											>
												{signals.principles && <span className="size-[5px] rounded-full bg-selbar/70" />}
												{signals.people && <span className="size-[5px] rounded-full bg-people/70" />}
												{signals.xrefs && <span className="size-[5px] rounded-full bg-faint/55" />}
												{signals.media && <span className="size-[5px] rounded-full bg-primary/70" />}
											</span>
										)}
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
				{!isMobile && (
					<div className="hidden lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:block">
						{/* a DISTINCT card above the verse detail — the whole card is
						    the link to the chapter gallery (Abram's design) */}
						<ChapterArtStack
							art={art}
							reference={reference}
							galleryUrl={`/scripture/${bookId}/${chapter}/art${selectedVerse !== null ? `?verse=${selectedVerse}` : ""}`}
							variant="card"
							className="mb-4"
						/>
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
											aria-label="Close verse panel"
											className="-m-2 p-2 font-reading text-lg leading-none text-muted-foreground transition-colors duration-150 hover:text-ink"
										>
											<span aria-hidden="true">×</span>
										</Link>
									</span>
								</div>
								{panelFor(selected)}
							</>
						) : (
							<p className="font-reading text-sm italic leading-relaxed text-faint">
								Select a verse to see the principles it teaches, the people it mentions, and its
								cross-references.
							</p>
						)}
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

function PanelBody({
	verseText,
	isPending,
	connections,
	crossRefs,
	mediaRefs,
	art,
	onCrossRefNavigate,
}: {
	verseText: string;
	isPending: boolean;
	connections: Promise<VersePanelData> | null;
	crossRefs: CrossRefsPanel | null;
	mediaRefs: MediaRefsPanel | null;
	art: ArtItem[];
	onCrossRefNavigate: (verse: number) => void;
}) {
	return (
		<>
			<blockquote className="mt-3 border-l-2 border-rule2 pl-3 font-reading text-sm italic leading-relaxed text-muted-foreground">
				{verseText}
			</blockquote>
			{art.length > 0 && (
				<div className="mt-[18px]">
					<h3 className="font-reading text-sm font-normal italic text-muted-foreground">
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
					<h3 className="font-reading text-sm font-normal italic text-muted-foreground">Heard in</h3>
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
						<p className="font-reading text-sm italic text-muted-foreground">
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
			<h3 className="font-reading text-sm font-normal italic text-muted-foreground">
				{/* the disclosed state carries the count (plate: "Cross-references · 14") */}
				{expanded ? `Cross-references · ${total}` : "Cross-references"}
				{panel.curated && (
					// curated provenance as a quiet sans word, never a bordered chip
					<span className="ml-2 font-ui text-[11px] not-italic text-muted-foreground">curated</span>
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
							<span className="block border-t border-rule pb-0.5 pt-3 font-reading text-[12.5px] italic text-muted-foreground">
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
							<span className="block border-t border-rule pb-0.5 pt-3 font-reading text-[12.5px] italic text-muted-foreground">
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
			<EntityRows title="Teaches" dotClass="bg-selbar/70" chips={panel.principles} nodeType="principles" />
			<EntityRows title="Mentions" dotClass="bg-people/70" chips={panel.people} nodeType="people" />
		</div>
	);
}

/** Typed ruled rows (Plate II·b): full-width, hairline-ruled between rows,
 * a 5px type dot and the serif name. Each row is a door to the node page. */
function EntityRows({
	title,
	dotClass,
	chips,
	nodeType,
}: {
	title: string;
	dotClass: string;
	chips: VerseEntityRef[];
	/** Typed node-page slug (the type is the slug); rows navigate to the node
	 * page — the graph is an opt-in view THERE, not the row's destination. */
	nodeType: "principles" | "people";
}) {
	if (chips.length === 0) return null;
	return (
		<div className="mt-[18px]">
			<h3 className="font-reading text-sm font-normal italic text-muted-foreground">{title}</h3>
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
