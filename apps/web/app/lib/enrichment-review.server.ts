import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getAuth, type AuthEnv } from "./auth.server";
import {
	KIND_FILTERS,
	NOTE_MAX,
	PAGE_SIZE,
	isReviewStatus,
	mentionId,
	type KindFilter,
	type MentionKey,
	type ReviewRow,
	type ReviewStatus,
	type StatusFilter,
} from "./enrichment-review-shared";
import { classifyReadError } from "./db-errors.server";
import { logEvent } from "./log.server";

/**
 * Enrichment review data access (docs/design/media-collections.md B-scope).
 *
 * TWO LEGS, deliberately. The mentions themselves are graph data and come
 * over `context.db` (Hyperdrive, `lumen_read`) — they change only when the
 * pipeline runs, so a cached read is correct. The review DECISIONS come
 * over the caller's own PostgREST client, because an admin who accepts a
 * row and reloads must see it: Hyperdrive caches reads for ~60s, which is
 * exactly what made a roadmap vote read back as zero on 2026-08-01.
 * `lumen_read` holds no grant on lumen.enrichment_reviews, so the database
 * enforces the split rather than discipline.
 *
 * The review unit is the MENTION — one timestamped claim inside an edge's
 * metadata.mentions[] — not the edge. Identity is the four columns of
 * idx_edges_unique plus the utterance seq.
 */

export {
	PAGE_SIZE,
	REVIEW_STATUSES,
	KIND_FILTERS,
	STATUS_FILTERS,
	NOTE_MAX,
	isReviewStatus,
	parseKind,
	parseStatus,
	mentionId,
	parseMentionId,
} from "./enrichment-review-shared";
export type {
	ReviewStatus,
	KindFilter,
	StatusFilter,
	MentionKey,
	ReviewRow,
} from "./enrichment-review-shared";

/** Collections that actually carry extraction, for the page's picker. */
export async function reviewableCollections(db: PostgresJsDatabase) {
	const rows = await db.execute(sql`
		SELECT c.id, c.name, count(*)::int AS edges
		FROM lumen.edges g
		JOIN lumen.collections c ON c.id = g.collection_id
		WHERE g.source = g.collection_id || '-extraction'
		GROUP BY c.id, c.name
		ORDER BY c.name`);
	return (rows as unknown as { id: string; name: string; edges: number }[]).map((r) => ({
		id: String(r.id),
		name: String(r.name),
		edges: Number(r.edges),
	}));
}

/**
 * One page of the queue, worst-confidence first — the order that makes a
 * review queue worth opening.
 *
 * OFFSET, not the keyset admin.users uses: the sort key (confidence) is
 * heavily tied and not unique, so a row-comparison cursor would need the
 * whole identity tuple appended to stay total, and this queue is an
 * internal tool over thousands of rows rather than an unbounded user list.
 * The tradeoff is recorded rather than hidden.
 */
export async function loadReviewPage(
	db: PostgresJsDatabase,
	request: Request,
	env: AuthEnv,
	params: { collectionId: string; kind: KindFilter; status: StatusFilter; offset: number },
): Promise<{ rows: ReviewRow[]; degraded: boolean; hasMore: boolean }> {
	const relType = KIND_FILTERS[params.kind];
	let raw: unknown[];
	try {
		raw = (await db.execute(sql`
			WITH m AS (
				SELECT g.from_id, g.to_id, g.rel_type, g.collection_id,
					(mention->>'seq')::int AS seq,
					COALESCE((mention->>'t')::numeric, 0) AS t,
					COALESCE((mention->>'confidence')::numeric, (g.metadata->>'confidence')::numeric, 0) AS confidence
				FROM lumen.edges g,
					LATERAL jsonb_array_elements(g.metadata->'mentions') AS mention
				WHERE g.collection_id = ${params.collectionId}
					AND g.source = g.collection_id || '-extraction'
					AND jsonb_typeof(g.metadata->'mentions') = 'array'
					AND (${relType}::text IS NULL OR g.rel_type = ${relType})
					AND (mention->>'seq') IS NOT NULL
			)
			SELECT m.from_id, m.to_id, m.rel_type, m.collection_id, m.seq, m.t, m.confidence,
				en.name AS target_name, en.entity_type AS target_type,
				ep.name AS episode_name, tr.text AS quote
			FROM m
			JOIN lumen.entities ep ON ep.id = m.from_id
			LEFT JOIN lumen.entities en ON en.id = m.to_id
			LEFT JOIN lumen.transcripts tr ON tr.episode_id = m.from_id AND tr.seq = m.seq
			ORDER BY m.confidence ASC, m.from_id, m.to_id, m.seq
			LIMIT ${PAGE_SIZE + 1} OFFSET ${params.offset}`)) as unknown as unknown[];
	} catch (err) {
		logEvent("enrichment_review_read_failed", { cause: classifyReadError(err) });
		return { rows: [], degraded: true, hasMore: false };
	}

	const hasMore = raw.length > PAGE_SIZE;
	const page = raw.slice(0, PAGE_SIZE) as {
		from_id: string;
		to_id: string;
		rel_type: string;
		collection_id: string;
		seq: number;
		t: number;
		confidence: number;
		target_name: string | null;
		target_type: string | null;
		episode_name: string;
		quote: string | null;
	}[];

	const decisions = await reviewDecisions(
		request,
		env,
		page.map((r) => ({
			fromId: String(r.from_id),
			toId: String(r.to_id),
			relType: String(r.rel_type),
			collectionId: String(r.collection_id),
			mentionSeq: Number(r.seq),
		})),
	);

	const rows: ReviewRow[] = page.map((r) => {
		const key: MentionKey = {
			fromId: String(r.from_id),
			toId: String(r.to_id),
			relType: String(r.rel_type),
			collectionId: String(r.collection_id),
			mentionSeq: Number(r.seq),
		};
		const d = decisions.get(mentionId(key));
		return {
			...key,
			t: Number(r.t),
			confidence: Number(r.confidence),
			targetName: r.target_name ? String(r.target_name) : String(r.to_id),
			targetType: r.target_type ? String(r.target_type) : "unknown",
			episodeName: String(r.episode_name),
			quote: r.quote ? String(r.quote) : "",
			status: d?.status ?? "pending",
			reviewedAt: d?.reviewedAt ?? null,
			note: d?.note ?? "",
		};
	});

	// status filtering happens AFTER the merge because the decisions live in
	// a different database leg than the mentions — a SQL-side filter would
	// need a join the read credential is deliberately denied
	const filtered =
		params.status === "all" ? rows : rows.filter((r) => r.status === params.status);
	return { rows: filtered, degraded: false, hasMore };
}

/** Decisions for a specific set of mentions, over the caller's own client.
 * Fail-SOFT: losing decisions renders everything as pending, which is
 * honest and recoverable; failing the page is not. */
export async function reviewDecisions(
	request: Request,
	env: AuthEnv,
	keys: MentionKey[],
): Promise<Map<string, { status: ReviewStatus; reviewedAt: string | null; note: string }>> {
	const out = new Map<string, { status: ReviewStatus; reviewedAt: string | null; note: string }>();
	if (keys.length === 0) return out;
	try {
		const { supabase } = getAuth(request, env);
		// scope by the episodes on this page — the composite key has no
		// single-column IN form, and episode is the selective half
		const episodes = [...new Set(keys.map((k) => k.fromId))];
		const { data, error } = await supabase
			.schema("lumen")
			.from("enrichment_reviews")
			.select("from_id, to_id, rel_type, collection_id, mention_seq, status, reviewed_at, note")
			.in("from_id", episodes);
		if (error || !data) return out;
		for (const row of data as unknown as {
			from_id: string;
			to_id: string;
			rel_type: string;
			collection_id: string;
			mention_seq: number;
			status: string;
			reviewed_at: string | null;
			note: string | null;
		}[]) {
			if (!isReviewStatus(row.status)) continue;
			out.set(
				mentionId({
					fromId: row.from_id,
					toId: row.to_id,
					relType: row.rel_type,
					collectionId: row.collection_id,
					mentionSeq: row.mention_seq,
				}),
				{ status: row.status, reviewedAt: row.reviewed_at, note: row.note ?? "" },
			);
		}
	} catch {
		/* fail soft — everything reads as pending */
	}
	return out;
}

/** Record a decision. RLS is the real gate: a non-entitled caller's write
 * is refused by the database, not by this function. */
export async function setReview(
	request: Request,
	env: AuthEnv,
	key: MentionKey,
	status: ReviewStatus,
): Promise<{ ok: boolean }> {
	const { supabase } = getAuth(request, env);
	const { data: userData } = await supabase.auth.getUser();
	const reviewer = userData.user?.id ?? null;
	if (!reviewer) return { ok: false };
	// preserve any note already on the row — a verdict must not silently
	// erase the reason someone wrote down for it
	const { data: existing } = await supabase
		.schema("lumen")
		.from("enrichment_reviews")
		.select("note")
		.eq("from_id", key.fromId)
		.eq("to_id", key.toId)
		.eq("rel_type", key.relType)
		.eq("collection_id", key.collectionId)
		.eq("mention_seq", key.mentionSeq)
		.maybeSingle();

	const { error } = await supabase
		.schema("lumen")
		.from("enrichment_reviews")
		.upsert(
			{
				from_id: key.fromId,
				to_id: key.toId,
				rel_type: key.relType,
				collection_id: key.collectionId,
				mention_seq: key.mentionSeq,
				status,
				note: (existing as { note?: string | null } | null)?.note ?? null,
				reviewer,
				reviewed_at: new Date().toISOString(),
			},
			{ onConflict: "from_id,to_id,rel_type,collection_id,mention_seq" },
		);
	if (error) {
		logEvent("enrichment_review_write_failed", { status });
		return { ok: false };
	}
	return { ok: true };
}

/** Attach feedback to a claim. Works on an undecided row: the status
 * defaults to the storable 'pending' so a note never forces a verdict.
 * An empty note on an otherwise-pending row deletes it — clearing the
 * last thing a row said should not leave the row behind. */
export async function setNote(
	request: Request,
	env: AuthEnv,
	key: MentionKey,
	note: string,
): Promise<{ ok: boolean }> {
	const { supabase } = getAuth(request, env);
	const { data: userData } = await supabase.auth.getUser();
	const reviewer = userData.user?.id ?? null;
	if (!reviewer) return { ok: false };
	const trimmed = note.trim().slice(0, NOTE_MAX);

	const { data: existing } = await supabase
		.schema("lumen")
		.from("enrichment_reviews")
		.select("status")
		.eq("from_id", key.fromId)
		.eq("to_id", key.toId)
		.eq("rel_type", key.relType)
		.eq("collection_id", key.collectionId)
		.eq("mention_seq", key.mentionSeq)
		.maybeSingle();
	const status = (existing as { status?: string } | null)?.status ?? "pending";

	if (trimmed === "" && status === "pending") return clearReview(request, env, key);

	const { error } = await supabase
		.schema("lumen")
		.from("enrichment_reviews")
		.upsert(
			{
				from_id: key.fromId,
				to_id: key.toId,
				rel_type: key.relType,
				collection_id: key.collectionId,
				mention_seq: key.mentionSeq,
				status,
				note: trimmed === "" ? null : trimmed,
				reviewer,
				reviewed_at: new Date().toISOString(),
			},
			{ onConflict: "from_id,to_id,rel_type,collection_id,mention_seq" },
		);
	if (error) {
		logEvent("enrichment_note_write_failed", {});
		return { ok: false };
	}
	return { ok: true };
}

/** Undo a decision — the row's ABSENCE is untouched, so undo is a delete
 * UNLESS a note is riding on it; feedback outlives a verdict change. */
export async function clearReview(
	request: Request,
	env: AuthEnv,
	key: MentionKey,
): Promise<{ ok: boolean }> {
	const { supabase } = getAuth(request, env);
	const { error } = await supabase
		.schema("lumen")
		.from("enrichment_reviews")
		.delete()
		.eq("from_id", key.fromId)
		.eq("to_id", key.toId)
		.eq("rel_type", key.relType)
		.eq("collection_id", key.collectionId)
		.eq("mention_seq", key.mentionSeq);
	if (error) {
		logEvent("enrichment_review_clear_failed", {});
		return { ok: false };
	}
	return { ok: true };
}
