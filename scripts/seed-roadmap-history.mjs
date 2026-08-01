#!/usr/bin/env node
/**
 * Backfill the roadmap's Shipped list from the project's git history
 * (2026-08-01). Curated: one entry per user-visible capability, dated by
 * the commit that completed it — not one per commit. Idempotent.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let dsn = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;
if (!dsn) {
	try {
		dsn = readFileSync(join(ROOT, '.env'), 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
	} catch {}
}
if (!dsn) {
	console.error('seed-roadmap-history: DATABASE_URL required');
	process.exit(1);
}

/** [id, title, shipped_at] */
const SHIPPED = [
	['scripture-reader', 'Read any chapter, select a verse, and see its connections in a side panel', '2026-07-03'],
	['book-contents-pages', 'Book pages listing every chapter, linked from home and from the reader', '2026-07-03'],
	['connection-graph', 'A graph view of what a chapter or verse connects to, with force, radial, and list layouts', '2026-07-03'],
	['reading-themes', 'Four reading themes (paper, parchment, linen, ink) with a switcher on every page', '2026-07-03'],
	['chapter-art', 'Public-domain art on chapter and verse pages, with a gallery per chapter and a close-up view', '2026-07-07'],
	['cross-references', 'Cross-references on every verse, in both directions, with counts and a see-all view', '2026-07-07'],
	['word-study', "Strong's word study: tap a word in the text for its original-language entry, plus a page per word", '2026-07-09'],
	['email-sign-in', 'Accounts: sign in with a link emailed to you', '2026-07-10'],
	['podcast-episodes', 'Episode pages for the Unshaken podcast: full transcript, a player that follows along, and section links', '2026-07-21'],
	['episode-scripture-links', 'Verses, people, and principles discussed in an episode, linked at the timestamp where they come up', '2026-07-21'],
	['entity-pages', 'Pages for people, places, and principles, showing where they appear', '2026-07-21'],
	['dc-pgp-connections', 'Doctrine and Covenants and Pearl of Great Price verses join the connection graph', '2026-07-21'],
	['search', 'Search scripture, entities, art, words, and episode transcripts, from a page or with Cmd+K', '2026-07-22'],
	['chapter-foot-navigation', 'Previous and next chapter links at the foot of the reading, not just the header', '2026-07-23'],
	['reader-margin-dots', 'Redesigned chapter reader: typed dots in the margin show what each verse connects to', '2026-07-24'],
	['single-chapter-books', 'Books with one chapter open straight into the text instead of a contents page', '2026-07-31'],
	['reader-single-column', 'Chapter art moves into the reading flow, and the reader stays one column until a verse is selected', '2026-07-31'],
	['about-and-roadmap-pages', 'About and Roadmap pages', '2026-07-31'],
	['named-lintel', 'The app is named Lintel, with a mark, favicon, and masthead', '2026-07-31'],
	['custom-domain', 'The app has its own address, studylintel.com', '2026-07-31'],
	['roadmap-voting', 'Vote for roadmap features, up to ten presses each, and take a press back', '2026-08-01'],
	['privacy-policy', 'A privacy policy page', '2026-08-01'],
];

/** rows seeded before the backfill existed — the trigger stamped them with
 * the seed date, not the date they actually shipped */
const REDATE = [
	['personal-notes', '2026-07-30'],
	['guest-writing', '2026-07-31'],
	['global-nav', '2026-07-30'],
	['strongs-and-art', '2026-07-31'],
];

const client = new pg.Client({ connectionString: dsn });
await client.connect();
try {
	await client.query('BEGIN');
	for (const [id, title, shippedAt] of SHIPPED) {
		await client.query(
			`INSERT INTO lumen.roadmap_features (id, title, state, shipped_at)
			 VALUES ($1, $2, 'shipped', $3::date)
			 ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title,
			     state = 'shipped', shipped_at = EXCLUDED.shipped_at`,
			[id, title, shippedAt],
		);
	}
	for (const [id, shippedAt] of REDATE) {
		await client.query(
			`UPDATE lumen.roadmap_features SET shipped_at = $2::date WHERE id = $1`,
			[id, shippedAt],
		);
	}
	await client.query('COMMIT');
} catch (err) {
	await client.query('ROLLBACK');
	console.error('seed-roadmap-history: FAILED —', err.message);
	process.exit(1);
}

const { rows } = await client.query(
	`SELECT state, count(*)::int AS n FROM lumen.roadmap_features GROUP BY state ORDER BY state`,
);
console.log(rows.map((r) => `  ${r.state}: ${r.n}`).join('\n'));
const { rows: undated } = await client.query(
	`SELECT count(*)::int AS n FROM lumen.roadmap_features WHERE state = 'shipped' AND shipped_at IS NULL`,
);
await client.end();
if (undated[0].n > 0) {
	console.error(`seed-roadmap-history: ${undated[0].n} shipped row(s) without a date`);
	process.exit(1);
}
console.log('seed-roadmap-history: OK');
