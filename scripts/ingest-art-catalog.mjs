// Ingest the Learn of Christ art catalog (public-domain, scripture-anchored)
// into lumen.entities as entity_type 'artwork', collection 'art'.
//
//   node --import tsx scripts/ingest-art-catalog.mjs [path-to-export-dir]
//
// Idempotent (upsert by id). Metadata carries the image URLs (images stay at
// their public-domain hosts) plus scripture refs mapped to OUR book slugs;
// refs whose book can't be mapped are kept out of `refs` (logged per book).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT_DIR = process.argv[2] ?? join(process.env.HOME ?? '', 'Downloads/art-database-export');

const { parseReference } = await import(join(ROOT, 'packages/scripture/src/slug-map.ts'));

const require = createRequire(import.meta.url);
const postgres = require('postgres');
const pgUrl = readFileSync(join(ROOT, 'apps/web/.env'), 'utf8').match(/HYPERDRIVE=(.+)/)?.[1]?.trim();
if (!pgUrl) throw new Error('missing PG connection (apps/web/.env)');
const sql = postgres(pgUrl, { prepare: false });

const log = (event, data) => console.log(JSON.stringify({ event, ...data }));

const artworks = JSON.parse(readFileSync(join(EXPORT_DIR, 'artworks.json'), 'utf8'));
log('catalog_loaded', { artworks: artworks.length, exportDir: EXPORT_DIR });

const bookCache = new Map();
const unmappedBooks = new Map();
function mapBook(ref) {
  const key = (ref.book ?? ref.book_slug ?? '').toLowerCase().replace(/-/g, ' ');
  if (bookCache.has(key)) return bookCache.get(key);
  const parsed = parseReference(key);
  const bookId = (parsed.level === 'book' || parsed.level === 'volume') && parsed.bookId ? parsed.bookId : null;
  bookCache.set(key, bookId);
  return bookId;
}

const rows = [];
for (const a of artworks) {
  const refs = [];
  for (const r of a.scripture_refs ?? []) {
    const bookId = mapBook(r);
    if (bookId === null) {
      unmappedBooks.set(r.book ?? r.book_slug, (unmappedBooks.get(r.book ?? r.book_slug) ?? 0) + 1);
      continue;
    }
    if (typeof r.chapter !== 'number') continue;
    refs.push({
      book_id: bookId,
      chapter: r.chapter,
      verse_start: r.verse_start ?? null,
      verse_end: r.verse_end ?? null,
      is_primary: r.is_primary ?? false,
    });
  }
  rows.push({
    id: `art:${a.slug}`,
    name: a.title,
    description: [a.artist_name, a.year, a.medium].filter(Boolean).join(' · '),
    search: [a.title, a.artist_name, ...(a.biblical_theme ?? []), ...(a.biblical_character ?? [])].join(' '),
    metadata: {
      artist_name: a.artist_name,
      artist_slug: a.artist_slug,
      year: a.year ?? null,
      medium: a.medium ?? null,
      source: a.source,
      source_url: a.source_url,
      image_url: a.image_url,
      thumbnail_800_url: a.thumbnail_800_url ?? null,
      license: a.license,
      license_note: a.license_note ?? null,
      fame: a.fame ?? null,
      scenes: a.scenes ?? [],
      biblical_character: a.biblical_character ?? [],
      biblical_theme: a.biblical_theme ?? [],
      refs,
    },
  });
}
log('rows_prepared', {
  rows: rows.length,
  withRefs: rows.filter((r) => r.metadata.refs.length > 0).length,
  unmappedBooks: [...unmappedBooks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
});

await sql`
  INSERT INTO lumen.collections (id, name, description, tier, category, provenance, license, storage)
  VALUES ('art', 'Learn of Christ Art Catalog',
          'Public-domain Christian art indexed to scripture (learnofchrist.com export)',
          'app', 'art', 'curated', 'public-domain', 'link')
  ON CONFLICT (id) DO NOTHING`;

let upserted = 0;
for (let i = 0; i < rows.length; i += 500) {
  const batch = rows.slice(i, i + 500);
  await sql`
    INSERT INTO lumen.entities (id, entity_type, name, description, metadata, source, collection_id, search_vector)
    SELECT r.id, 'artwork', r.name, r.description, r.metadata, 'learnofchrist', 'art',
           to_tsvector('english', r.search)
    FROM jsonb_to_recordset(${sql.json(batch)}) AS r(id text, name text, description text, metadata jsonb, search text)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, description = EXCLUDED.description, metadata = EXCLUDED.metadata,
      source = EXCLUDED.source, collection_id = EXCLUDED.collection_id, search_vector = EXCLUDED.search_vector`;
  upserted += batch.length;
  log('batch_done', { upserted, of: rows.length });
}

const counts = await sql`
  SELECT count(*)::int AS total FROM lumen.entities WHERE entity_type = 'artwork'`;
log('ingest_done', { artworksInDb: counts[0].total });
await sql.end();
