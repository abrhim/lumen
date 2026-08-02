/**
 * Regenerates the local stack's seed from production.
 *
 * The corpus is ~2.6GB and 1.2M words — far too much to carry. This pulls a
 * BOUNDED slice sized to what the e2e suite actually reads, so the committed
 * seed stays a few MB and `supabase db reset` stays fast. The VM never needs
 * production credentials: the seed is committed, this script is not run there.
 *
 * Adding a spec that reads new rows? Widen SLICES here and regenerate.
 */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const { Client } = require("pg");

const dsn =
	process.env.DATABASE_URL ??
	readFileSync(join(ROOT, ".env"), "utf8")
		.match(/^DATABASE_URL=(.+)$/m)?.[1]
		?.trim();
if (!dsn) throw new Error("no DATABASE_URL (env or repo-root .env)");

/**
 * Chapters the specs read directly. Note these are row ids (`alma-32`), not
 * the slashed URL form (`/scripture/alma/32`) — the route splits book from
 * chapter, the key does not.
 */
const CHAPTERS = [
	"alma-32",
	"alma-33",
	"enos-1",
	"1-ne-3",
	"dc-4",
	// Strongs tagging only covers the KJV, so a Bible chapter has to be in the
	// slice or word_tags seeds empty and the word-level surfaces go untested.
	"gen-1",
];

/**
 * Insert order is load-bearing twice over: foreign keys, and the BEFORE
 * triggers on verses/entities that call lumen.kjv_delta — kjv_variants has to
 * be in place before the first verse lands or every search_vector comes out
 * missing its modern-English half.
 */
/**
 * The episode the /media specs land on: fewest lines, so the seed stays small.
 * Resolved once and reused, because transcripts.episode_id is an FK to
 * entities.id — the episode's entity has to be inside the entities slice or the
 * transcript rows have nothing to hang from.
 */
const EPISODE = `(select episode_id from lumen.transcripts group by episode_id order by count(*) asc, episode_id asc limit 1)`;

/** Entities specs name outright, so they cannot depend on the graph slice. */
const NAMED_ENTITIES = ["Rameumptom"];

const SEEDED_VERSES = `select id from lumen.verses where chapter_id = any($1)`;

/**
 * Edges are the whole point of the linked rail, and from_id/to_id are free text
 * with no FK — they reference verses, chapters and entities alike. Take the
 * edges that actually touch the seeded canon rather than an arbitrary slab, so
 * the graph the specs traverse is coherent with the verses they read.
 */
const EDGE_TOUCHES_SEED = `(
  from_id in (${SEEDED_VERSES}) or to_id in (${SEEDED_VERSES})
  or from_id = any($1) or to_id = any($1)
)`;
const EDGE_ENDPOINTS = `
  select from_id as id from lumen.edges where ${EDGE_TOUCHES_SEED}
  union
  select to_id from lumen.edges where ${EDGE_TOUCHES_SEED}`;

const SLICES = [
	["volumes", "select * from lumen.volumes", []],
	["books", "select * from lumen.books", []],
	["chapters", "select * from lumen.chapters", []],
	["kjv_variants", "select * from lumen.kjv_variants", []],
	["verses", `select * from lumen.verses where chapter_id = any($1)`, [CHAPTERS]],
	["words", `select * from lumen.words where verse_id in (${SEEDED_VERSES})`, [CHAPTERS]],
	[
		"word_tags",
		`select * from lumen.word_tags where word_id in (select w.id from lumen.words w join lumen.verses v on v.id = w.verse_id where v.chapter_id = any($1))`,
		[CHAPTERS],
	],
	// /strongs opens on the 1–100 range door. strongs_no is TEXT, so ordering by
	// it gives H1, H10, H100, H1000 — never a contiguous range. Compare the
	// numeric part instead.
	[
		"strongs_lexicon",
		`select * from lumen.strongs_lexicon
     where strongs_no ~ '^[HG][0-9]+$'
       and substring(strongs_no from 2)::int between 1 and 120`,
		[],
	],
	// collections first: entities.collection_id and edges.collection_id are FKs
	// to it, and /art shelves collections by book+chapter
	["collections", "select * from lumen.collections", []],
	[
		"entities",
		`select * from lumen.entities
     where id in (${EDGE_ENDPOINTS}) or name = any($2) or id = ${EPISODE}`,
		[CHAPTERS, NAMED_ENTITIES],
	],
	["edges", `select * from lumen.edges where ${EDGE_TOUCHES_SEED}`, [CHAPTERS]],
	// Scoped to raw edge endpoints, not to the seeded entities: nesting the
	// entities predicate inside this one expands EDGE_ENDPOINTS twice more and
	// times out against production. entity_degree has no FK, so the extra rows
	// for non-entity endpoints are inert.
	[
		"entity_degree",
		`select * from lumen.entity_degree where entity_id in (${EDGE_ENDPOINTS})`,
		[CHAPTERS],
	],
	// one full episode — enough that the /media specs run instead of skipping,
	// and transcripts are by far the heaviest thing in the slice
	["transcripts", `select * from lumen.transcripts where episode_id = ${EPISODE}`, []],
	// /search?q=faith — the suite's only full-text assertion
	[
		"search_index",
		`select * from lumen.search_index where tsv @@ plainto_tsquery('english','faith') limit 300`,
		[],
	],
	["roadmap_features", "select * from lumen.roadmap_features", []],
	["roles", "select * from lumen.roles", []],
];

const c = new Client({ connectionString: dsn });
await c.connect();

/** Postgres literal for a value node-pg handed back. */
const lit = (v, type) => {
	if (v === null || v === undefined) return "NULL";
	if (typeof v === "number") return String(v);
	if (typeof v === "boolean") return v ? "true" : "false";
	if (v instanceof Date) return `'${v.toISOString()}'`;
	if (Array.isArray(v)) return `'{${v.map((x) => `"${String(x).replace(/(["\\])/g, "\\$1")}"`).join(",")}}'`;
	if (typeof v === "object") return `${quote(JSON.stringify(v))}::jsonb`;
	// tsvector round-trips through its text form
	return type === "tsvector" ? `${quote(v)}::tsvector` : quote(v);
};
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

const out = [];
const w = (s = "") => out.push(s);
w("-- Seed for the lumen local stack — a bounded slice of production.");
w("-- Generated by scripts/dump-seed.mjs — do not hand-edit; regenerate.");
w("-- Runs automatically on `supabase db reset`.");
w("--");
w("-- Triggers stay live through this file on purpose: verses.search_vector and");
w("-- entities.search_vector are built by BEFORE triggers, so the rows below are");
w("-- inserted without them and Postgres fills them in — which is also why");
w("-- kjv_variants has to land before the first verse.");
w();

const counts = [];
for (const [table, sql, params] of SLICES) {
	const { rows, fields } = await c.query(sql, params);
	counts.push([table, rows.length]);
	if (!rows.length) {
		w(`-- ${table}: no rows matched the slice`);
		w();
		continue;
	}
	const meta = (
		await c.query(
			`select a.attname, format_type(a.atttypid, a.atttypmod) as t, a.attgenerated
       from pg_attribute a where a.attrelid = $1::regclass
       and a.attnum > 0 and not a.attisdropped`,
			[`lumen.${table}`],
		)
	).rows;
	const types = Object.fromEntries(meta.map((r) => [r.attname, r.t]));
	/**
	 * GENERATED ALWAYS ... STORED columns reject any supplied value outright
	 * (SQLSTATE 428C9) — transcripts.search_vector, notes.search, notes.title_line.
	 * Postgres recomputes them from the row, so they are dropped here rather
	 * than carried. Trigger-maintained columns (verses/entities.search_vector)
	 * are NOT generated and stay: the BEFORE trigger overwrites them anyway.
	 */
	const generated = new Set(meta.filter((r) => r.attgenerated !== "").map((r) => r.attname));
	const cols = fields.map((f) => f.name).filter((n) => !generated.has(n));
	w(`-- ${table} (${rows.length})`);
	// batch so a single statement never gets pathologically long
	for (let i = 0; i < rows.length; i += 200) {
		const batch = rows.slice(i, i + 200);
		w(`insert into lumen.${table} (${cols.join(", ")}) values`);
		w(
			batch
				.map((r) => `  (${cols.map((col) => lit(r[col], types[col])).join(", ")})`)
				.join(",\n"),
		);
		w("on conflict do nothing;");
	}
	w();
}

await c.end();

const path = join(ROOT, "supabase/seed.sql");
writeFileSync(path, `${out.join("\n")}\n`);
const mb = (statSync(path).size / 1024 / 1024).toFixed(2);
console.log(`wrote ${path} — ${mb} MB`);
for (const [t, n] of counts) console.log(`  ${String(n).padStart(6)}  ${t}`);
