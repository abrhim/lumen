/**
 * Lumen Phase A — Import public domain scripture data into Supabase.
 *
 * Creates the `lumen` schema with tables (verses, entities, collections,
 * edges, words), then imports from local source data:
 *   1. LDS canon (beandog/lds-scriptures SQLite)
 *   2. Strong's Concordance (openscriptures/strongs + MetaV)
 *   3. Nave's Topical Bible (BradyStephenson/bible-data)
 *   4. JST Inspired Version (awerkamp markdown)
 *
 * TSK cross-references are NOT imported here — they go to Neo4j in Phase C.
 *
 * Usage:
 *   npx tsx scripts/ingest-phase-a.ts --dry-run
 *   npx tsx scripts/ingest-phase-a.ts --write
 *   npx tsx scripts/ingest-phase-a.ts --write --step=canon
 *   npx tsx scripts/ingest-phase-a.ts --write --step=strongs
 *   npx tsx scripts/ingest-phase-a.ts --write --step=naves
 *   npx tsx scripts/ingest-phase-a.ts --write --step=jst
 *
 * Env vars (reads from root .env):
 *   DATABASE_URL (single connection string, preferred)
 *   — or individual: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL
 */

import Database from 'better-sqlite3';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';
import pg from 'pg';

// ── Paths ──────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(__dirname, '../data/sources');
const LDS_SQLITE = path.join(DATA_DIR, 'lds-scriptures/sqlite/lds-scriptures-sqlite.db');
const STRONGS_HEBREW = path.join(DATA_DIR, 'strongs/hebrew/strongs-hebrew-dictionary.js');
const STRONGS_GREEK = path.join(DATA_DIR, 'strongs/greek/strongs-greek-dictionary.js');
const METAV_STRONGS = path.join(DATA_DIR, 'metav/CSV/Strongs.csv');
const NAVES_CSV = path.join(DATA_DIR, 'bible-data/NavesTopicalDictionary.csv');
const JST_OT_DIR = path.join(DATA_DIR, 'jst-markdown/JST Old Testament');
const JST_NT_DIR = path.join(DATA_DIR, 'jst-markdown/JST New Testament');

// ── Volume ID mapping ──────────────────────────────────────────────────

const VOLUME_MAP: Record<number, string> = {
  1: 'ot',
  2: 'nt',
  3: 'bom',
  4: 'dc',
  5: 'pgp',
};

const VOLUME_NAMES: Record<string, string> = {
  ot: 'Old Testament',
  nt: 'New Testament',
  bom: 'Book of Mormon',
  dc: 'Doctrine and Covenants',
  pgp: 'Pearl of Great Price',
};

const VOLUME_ABBREV: Record<string, string> = {
  ot: 'OT',
  nt: 'NT',
  bom: 'BoM',
  dc: 'D&C',
  pgp: 'PGP',
};

const VOLUME_CANON: Record<string, string> = {
  ot: 'bible',
  nt: 'bible',
  bom: 'restoration',
  dc: 'restoration',
  pgp: 'restoration',
};

// ── Book slug generation ───────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/i, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function bookSlug(title: string): string {
  const map: Record<string, string> = {
    'Genesis': 'gen', 'Exodus': 'ex', 'Leviticus': 'lev', 'Numbers': 'num',
    'Deuteronomy': 'deut', 'Joshua': 'josh', 'Judges': 'judg', 'Ruth': 'ruth',
    '1 Samuel': '1-sam', '2 Samuel': '2-sam', '1 Kings': '1-kgs', '2 Kings': '2-kgs',
    '1 Chronicles': '1-chr', '2 Chronicles': '2-chr', 'Ezra': 'ezra', 'Nehemiah': 'neh',
    'Esther': 'esth', 'Job': 'job', 'Psalms': 'ps', 'Proverbs': 'prov',
    'Ecclesiastes': 'eccl', 'Song of Solomon': 'song', 'Isaiah': 'isa',
    'Jeremiah': 'jer', 'Lamentations': 'lam', 'Ezekiel': 'ezek', 'Daniel': 'dan',
    'Hosea': 'hosea', 'Joel': 'joel', 'Amos': 'amos', 'Obadiah': 'obad',
    'Jonah': 'jonah', 'Micah': 'micah', 'Nahum': 'nahum', 'Habakkuk': 'hab',
    'Zephaniah': 'zeph', 'Haggai': 'hag', 'Zechariah': 'zech', 'Malachi': 'mal',
    'Matthew': 'matt', 'Mark': 'mark', 'Luke': 'luke', 'John': 'john',
    'Acts': 'acts', 'Romans': 'rom', '1 Corinthians': '1-cor', '2 Corinthians': '2-cor',
    'Galatians': 'gal', 'Ephesians': 'eph', 'Philippians': 'philip', 'Colossians': 'col',
    '1 Thessalonians': '1-thes', '2 Thessalonians': '2-thes',
    '1 Timothy': '1-tim', '2 Timothy': '2-tim', 'Titus': 'titus', 'Philemon': 'philem',
    'Hebrews': 'heb', 'James': 'james', '1 Peter': '1-pet', '2 Peter': '2-pet',
    '1 John': '1-jn', '2 John': '2-jn', '3 John': '3-jn', 'Jude': 'jude',
    'Revelation': 'rev',
    '1 Nephi': '1-ne', '2 Nephi': '2-ne', 'Jacob': 'jacob', 'Enos': 'enos',
    'Jarom': 'jarom', 'Omni': 'omni', 'Words of Mormon': 'w-of-m',
    'Mosiah': 'mosiah', 'Alma': 'alma', 'Helaman': 'hel',
    '3 Nephi': '3-ne', '4 Nephi': '4-ne', 'Mormon': 'morm', 'Ether': 'ether',
    'Moroni': 'moroni',
    'Doctrine and Covenants': 'dc', 'Official Declaration': 'od',
    'Moses': 'moses', 'Abraham': 'abr',
    'Joseph Smith—Matthew': 'js-m', 'Joseph Smith—History': 'js-h',
    'Joseph Smith--Matthew': 'js-m', 'Joseph Smith--History': 'js-h',
    'Articles of Faith': 'a-of-f',
  };
  return map[title] || slugify(title);
}

// ── Verse ID generation ────────────────────────────────────────────────

function verseId(bSlug: string, chapter: number, verse: number): string {
  return `${bSlug}-${chapter}-${verse}`;
}

function chapterId(bSlug: string, chapter: number): string {
  return `${bSlug}-${chapter}`;
}

// ── Human-readable reference ───────────────────────────────────────────

function humanRef(bookTitle: string, chapter: number, verse: number): string {
  return `${bookTitle} ${chapter}:${verse}`;
}

// ── Schema DDL ─────────────────────────────────────────────────────────

const SCHEMA_DDL = `
-- Create schema
CREATE SCHEMA IF NOT EXISTS lumen;

-- Collections table (must come before entities for FK)
CREATE TABLE IF NOT EXISTS lumen.collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  tier TEXT NOT NULL,
  category TEXT NOT NULL,
  provenance TEXT NOT NULL,
  license TEXT NOT NULL,
  storage TEXT NOT NULL,
  owner_id UUID,
  public BOOLEAN DEFAULT true NOT NULL,
  toggleable BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Verses table
CREATE TABLE IF NOT EXISTS lumen.verses (
  id TEXT PRIMARY KEY,
  volume_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,
  verse_number INTEGER NOT NULL,
  text TEXT NOT NULL,
  reference TEXT NOT NULL,
  search_vector TSVECTOR
);

-- Words table
CREATE TABLE IF NOT EXISTS lumen.words (
  id TEXT PRIMARY KEY,
  verse_id TEXT NOT NULL REFERENCES lumen.verses(id),
  position INTEGER NOT NULL,
  surface_form TEXT NOT NULL,
  normalized TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Entities table
CREATE TABLE IF NOT EXISTS lumen.entities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  source TEXT,
  collection_id TEXT REFERENCES lumen.collections(id),
  search_vector TSVECTOR
);

-- Edges table
CREATE TABLE IF NOT EXISTS lumen.edges (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  rel_type TEXT NOT NULL,
  collection_id TEXT NOT NULL REFERENCES lumen.collections(id),
  metadata JSONB DEFAULT '{}' NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
`;

const SEED_COLLECTIONS_SQL = `
INSERT INTO lumen.collections (id, name, description, tier, category, provenance, license, storage)
VALUES
  ('canon', 'LDS Canon', 'Standard works scripture text', 'base', 'scripture', 'lds-doc-project', 'public-domain', 'pg'),
  ('strongs', 'Strong''s Concordance', 'Hebrew and Greek lexicon', 'base', 'reference', 'openscriptures', 'public-domain', 'pg'),
  ('naves', 'Nave''s Topical Bible', 'Topical index', 'base', 'reference', 'public-domain', 'public-domain', 'pg'),
  ('jst', 'JST Readings', 'Joseph Smith Translation', 'base', 'scripture', '1867-jst', 'public-domain', 'pg'),
  ('phase-b', 'Phase B AI Entities', 'AI-extracted entities and relationships', 'enrichment', 'ai-generated', 'anthropic-batch', 'proprietary', 'pg')
ON CONFLICT (id) DO NOTHING;
`;

// ── Postgres helpers ───────────────────────────────────────────────────

async function createSchema(pool: pg.Pool): Promise<void> {
  console.log('Creating lumen schema + tables...');
  await pool.query(SCHEMA_DDL);
  await pool.query(SEED_COLLECTIONS_SQL);
  console.log('  Schema ready, collections seeded.');
}

async function clearTable(pool: pg.Pool, table: string): Promise<void> {
  await pool.query(`DELETE FROM lumen.${table}`);
}

async function insertVerse(
  pool: pg.Pool,
  id: string,
  volumeId: string,
  bookId: string,
  chapterNumber: number,
  verseNumber: number,
  text: string,
  reference: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO lumen.verses (id, volume_id, book_id, chapter_number, verse_number, text, reference, search_vector)
     VALUES ($1, $2, $3, $4, $5, $6, $7, to_tsvector('english', $6))
     ON CONFLICT (id) DO UPDATE SET text = $6, reference = $7, search_vector = to_tsvector('english', $6)`,
    [id, volumeId, bookId, chapterNumber, verseNumber, text, reference],
  );
}

async function insertEntity(
  pool: pg.Pool,
  id: string,
  entityType: string,
  name: string,
  description: string | null,
  metadata: Record<string, unknown>,
  source: string,
  collectionId: string,
): Promise<void> {
  const searchText = [name, description].filter(Boolean).join(' ');
  await pool.query(
    `INSERT INTO lumen.entities (id, entity_type, name, description, metadata, source, collection_id, search_vector)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, to_tsvector('english', $8))
     ON CONFLICT (id) DO UPDATE SET
       name = $3, description = $4, metadata = $5::jsonb, source = $6,
       collection_id = $7, search_vector = to_tsvector('english', $8)`,
    [id, entityType, name, description, JSON.stringify(metadata), source, collectionId, searchText],
  );
}

// batch insert for performance
async function batchInsertVerses(
  pool: pg.Pool,
  verses: Array<{
    id: string; volumeId: string; bookId: string;
    chapterNumber: number; verseNumber: number; text: string; reference: string;
  }>,
): Promise<void> {
  const BATCH_SIZE = 500;
  for (let i = 0; i < verses.length; i += BATCH_SIZE) {
    const batch = verses.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders = batch.map((v, idx) => {
      const base = idx * 7;
      values.push(v.id, v.volumeId, v.bookId, v.chapterNumber, v.verseNumber, v.text, v.reference);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, to_tsvector('english', $${base + 6}))`;
    });
    await pool.query(
      `INSERT INTO lumen.verses (id, volume_id, book_id, chapter_number, verse_number, text, reference, search_vector)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, reference = EXCLUDED.reference, search_vector = EXCLUDED.search_vector`,
      values,
    );
    if ((i + BATCH_SIZE) % 5000 === 0 || i + BATCH_SIZE >= verses.length) {
      console.log(`    ${Math.min(i + BATCH_SIZE, verses.length)} / ${verses.length} verses`);
    }
  }
}

async function batchInsertEntities(
  pool: pg.Pool,
  entities: Array<{
    id: string; entityType: string; name: string;
    description: string | null; metadata: Record<string, unknown>; source: string;
    collectionId: string;
  }>,
): Promise<void> {
  const BATCH_SIZE = 500;
  for (let i = 0; i < entities.length; i += BATCH_SIZE) {
    const batch = entities.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders = batch.map((e, idx) => {
      const base = idx * 8;
      const searchText = [e.name, e.description].filter(Boolean).join(' ');
      values.push(e.id, e.entityType, e.name, e.description, JSON.stringify(e.metadata), e.source, e.collectionId, searchText);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}, $${base + 7}, to_tsvector('english', $${base + 8}))`;
    });
    await pool.query(
      `INSERT INTO lumen.entities (id, entity_type, name, description, metadata, source, collection_id, search_vector)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description,
         metadata = EXCLUDED.metadata, source = EXCLUDED.source,
         collection_id = EXCLUDED.collection_id,
         search_vector = EXCLUDED.search_vector`,
      values,
    );
    if ((i + BATCH_SIZE) % 5000 === 0 || i + BATCH_SIZE >= entities.length) {
      console.log(`    ${Math.min(i + BATCH_SIZE, entities.length)} / ${entities.length} entities`);
    }
  }
}

// ── Step 1: Import LDS canon ───────────────────────────────────────────

interface SqliteVerse {
  volume_id: number;
  book_id: number;
  chapter_id: number;
  verse_id: number;
  volume_title: string;
  book_title: string;
  volume_short_title: string;
  book_short_title: string;
  book_long_title: string;
  chapter_number: number;
  verse_number: number;
  scripture_text: string;
}

async function importCanon(pool: pg.Pool, dryRun: boolean): Promise<void> {
  console.log('\n=== Step 1: Import LDS Canon ===\n');

  const db = new Database(LDS_SQLITE, { readonly: true });

  // Read all data via the scriptures view
  const rows = db.prepare(`
    SELECT volume_id, book_id, chapter_id, verse_id,
           volume_title, book_title, volume_short_title, book_short_title,
           book_long_title, chapter_number, verse_number, scripture_text
    FROM scriptures
    ORDER BY volume_id, book_id, chapter_id, verse_id
  `).all() as SqliteVerse[];

  console.log(`  Found ${rows.length} verses in SQLite`);

  // Build volume entities
  const volumes = new Map<number, { title: string; shortTitle: string }>();
  const books = new Map<number, {
    title: string; longTitle: string; shortTitle: string;
    volumeId: number; chapters: Set<number>; verseCount: number;
  }>();
  const chapters = new Map<number, { bookId: number; chapterNumber: number; verseCount: number }>();

  for (const row of rows) {
    if (!volumes.has(row.volume_id)) {
      volumes.set(row.volume_id, { title: row.volume_title, shortTitle: row.volume_short_title });
    }
    if (!books.has(row.book_id)) {
      books.set(row.book_id, {
        title: row.book_title, longTitle: row.book_long_title || row.book_title,
        shortTitle: row.book_short_title, volumeId: row.volume_id,
        chapters: new Set(), verseCount: 0,
      });
    }
    const book = books.get(row.book_id)!;
    book.chapters.add(row.chapter_number);
    book.verseCount++;

    if (!chapters.has(row.chapter_id)) {
      chapters.set(row.chapter_id, { bookId: row.book_id, chapterNumber: row.chapter_number, verseCount: 0 });
    }
    chapters.get(row.chapter_id)!.verseCount++;
  }

  db.close();

  console.log(`  ${volumes.size} volumes, ${books.size} books, ${chapters.size} chapters`);

  if (dryRun) {
    console.log('  [DRY RUN] Would write:');
    console.log(`    ${rows.length} verses`);
    console.log(`    ${volumes.size} volume entities`);
    console.log(`    ${books.size} book entities`);
    console.log(`    ${chapters.size} chapter entities`);
    return;
  }

  // Write volumes
  const volumeEntities = [...volumes.entries()].map(([sqlId, v]) => {
    const vid = VOLUME_MAP[sqlId];
    return {
      id: vid,
      entityType: 'volume',
      name: v.title,
      description: v.title,
      metadata: {
        abbrev: VOLUME_ABBREV[vid],
        canon: VOLUME_CANON[vid],
        sort_order: sqlId,
      },
      source: 'lds-doc-project',
      collectionId: 'canon',
    };
  });

  console.log(`  Writing ${volumeEntities.length} volumes...`);
  await batchInsertEntities(pool, volumeEntities);

  // Write books
  let bookSortOrder = 0;
  const bookEntities = [...books.entries()].map(([_sqlId, b]) => {
    bookSortOrder++;
    const vid = VOLUME_MAP[b.volumeId];
    const bSlug = bookSlug(b.title);
    return {
      id: bSlug,
      entityType: 'book',
      name: b.title,
      description: b.longTitle,
      metadata: {
        volume_id: vid,
        abbrev: b.shortTitle,
        long_name: b.longTitle,
        sort_order: bookSortOrder,
        chapter_count: b.chapters.size,
      },
      source: 'lds-doc-project',
      collectionId: 'canon',
    };
  }).filter((b) => {
    // A book slug that equals a volume id (e.g. 'dc') would upsert over the
    // volume entity; the verses-derived fallback in getBooksByVolume covers it.
    if (Object.values(VOLUME_MAP).includes(b.id)) {
      console.log(`  Skipping book entity "${b.name}" (id "${b.id}" collides with volume id)`);
      return false;
    }
    return true;
  });

  console.log(`  Writing ${bookEntities.length} books...`);
  await batchInsertEntities(pool, bookEntities);

  // Write chapters
  const chapterEntities = [...chapters.entries()].map(([_sqlId, c]) => {
    const book = books.get(c.bookId)!;
    const bSlug = bookSlug(book.title);
    return {
      id: chapterId(bSlug, c.chapterNumber),
      entityType: 'chapter',
      name: `${book.title} ${c.chapterNumber}`,
      description: null,
      metadata: {
        book_id: bSlug,
        chapter_number: c.chapterNumber,
        verse_count: c.verseCount,
      },
      source: 'lds-doc-project',
      collectionId: 'canon',
    };
  });

  console.log(`  Writing ${chapterEntities.length} chapters...`);
  await batchInsertEntities(pool, chapterEntities);

  // Write verses
  const verseRows = rows.map((row) => {
    const bSlug = bookSlug(row.book_title);
    const vid = VOLUME_MAP[row.volume_id];
    return {
      id: verseId(bSlug, row.chapter_number, row.verse_number),
      volumeId: vid,
      bookId: bSlug,
      chapterNumber: row.chapter_number,
      verseNumber: row.verse_number,
      text: row.scripture_text,
      reference: humanRef(row.book_title, row.chapter_number, row.verse_number),
    };
  });

  console.log(`  Writing ${verseRows.length} verses...`);
  await batchInsertVerses(pool, verseRows);

  // Verify
  const verseCount = await pool.query('SELECT COUNT(*) AS cnt FROM lumen.verses');
  const entityCount = await pool.query('SELECT COUNT(*) AS cnt FROM lumen.entities');
  console.log(`  Verification: ${verseCount.rows[0].cnt} verses, ${entityCount.rows[0].cnt} entities`);
}

// ── Step 2: Import Strong's Concordance ────────────────────────────────

function parseStrongsJs(filePath: string): Record<string, any> {
  const raw = fs.readFileSync(filePath, 'utf-8');
  // The file is a JS object assignment: var defined = { ... };
  // Extract the JSON object
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`Cannot parse ${filePath}`);
  const jsonStr = raw.slice(start, end + 1);
  return JSON.parse(jsonStr);
}

async function importStrongs(pool: pg.Pool, dryRun: boolean): Promise<void> {
  console.log('\n=== Step 2: Import Strong\'s Concordance ===\n');

  // Parse Hebrew + Greek dictionaries
  const hebrew = parseStrongsJs(STRONGS_HEBREW);
  const greek = parseStrongsJs(STRONGS_GREEK);

  const hebrewCount = Object.keys(hebrew).length;
  const greekCount = Object.keys(greek).length;
  console.log(`  Hebrew entries: ${hebrewCount}`);
  console.log(`  Greek entries: ${greekCount}`);

  // Also load the MetaV Strongs.csv for KJV translations
  const metavRaw = fs.readFileSync(METAV_STRONGS, 'utf-8');
  const metavRows = parse(metavRaw, { columns: true, skip_empty_lines: true, bom: true }) as Array<{
    StrongsID: string; lemma: string; xlit: string; pronounce: string;
    description: string; PartOfSpeech: string; Language: string;
  }>;

  const metavMap = new Map<string, typeof metavRows[0]>();
  for (const row of metavRows) {
    metavMap.set(row.StrongsID, row);
  }
  console.log(`  MetaV supplemental entries: ${metavMap.size}`);

  const entities: Array<{
    id: string; entityType: string; name: string;
    description: string | null; metadata: Record<string, unknown>; source: string;
    collectionId: string;
  }> = [];

  // Process Hebrew
  for (const [id, entry] of Object.entries(hebrew)) {
    const metav = metavMap.get(id);
    entities.push({
      id: id.toUpperCase(),
      entityType: 'strongs_word',
      name: entry.lemma || entry.xlit || id,
      description: entry.strongs_def || entry.kjv_def || null,
      metadata: {
        language: 'hebrew',
        original_word: entry.lemma || null,
        transliteration: entry.xlit || entry.pron || null,
        pronunciation: entry.pron || null,
        derivation: entry.derivation || null,
        kjv_def: entry.kjv_def || null,
        part_of_speech: metav?.PartOfSpeech || null,
      },
      source: 'strongs',
      collectionId: 'strongs',
    });
  }

  // Process Greek
  for (const [id, entry] of Object.entries(greek)) {
    const metav = metavMap.get(id);
    entities.push({
      id: id.toUpperCase(),
      entityType: 'strongs_word',
      name: entry.lemma || entry.translit || id,
      description: entry.strongs_def || entry.kjv_def || null,
      metadata: {
        language: 'greek',
        original_word: entry.lemma || null,
        transliteration: entry.translit || null,
        derivation: entry.derivation || null,
        kjv_def: entry.kjv_def || null,
        part_of_speech: metav?.PartOfSpeech || null,
      },
      source: 'strongs',
      collectionId: 'strongs',
    });
  }

  console.log(`  Total Strong's entities: ${entities.length}`);

  if (dryRun) {
    console.log('  [DRY RUN] Would write entities to lumen.entities');
    return;
  }

  console.log('  Writing Strong\'s entries...');
  await batchInsertEntities(pool, entities);

  const count = await pool.query(
    `SELECT COUNT(*) AS cnt FROM lumen.entities WHERE entity_type = 'strongs_word'`,
  );
  console.log(`  Verification: ${count.rows[0].cnt} strongs_word entities`);
}

// ── Step 3: Import Nave's Topical Bible ────────────────────────────────

async function importNaves(pool: pg.Pool, dryRun: boolean): Promise<void> {
  console.log('\n=== Step 3: Import Nave\'s Topical Bible ===\n');

  const raw = fs.readFileSync(NAVES_CSV, 'utf-8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, bom: true }) as Array<{
    section: string; subject: string; entry: string;
  }>;

  console.log(`  Raw CSV rows: ${rows.length}`);

  // Group by subject to create one entity per topic
  const topics = new Map<string, { section: string; entries: string[] }>();
  for (const row of rows) {
    const key = row.subject.trim();
    if (!key) continue;
    if (!topics.has(key)) {
      topics.set(key, { section: row.section, entries: [] });
    }
    if (row.entry?.trim()) {
      topics.get(key)!.entries.push(row.entry.trim());
    }
  }

  console.log(`  Unique topics: ${topics.size}`);

  const entities = [...topics.entries()].map(([subject, data]) => {
    const topicSlug = slugify(subject);
    return {
      id: `naves-${topicSlug}`,
      entityType: 'naves_topic',
      name: subject,
      description: data.entries.join('\n').slice(0, 10000),
      metadata: {
        section: data.section,
        entry_count: data.entries.length,
      },
      source: 'naves',
      collectionId: 'naves',
    };
  });

  if (dryRun) {
    console.log(`  [DRY RUN] Would write ${entities.length} naves_topic entities`);
    console.log(`  Sample: ${entities[0]?.name} -> ${entities[0]?.id}`);
    return;
  }

  console.log(`  Writing ${entities.length} Nave's topics...`);
  await batchInsertEntities(pool, entities);

  const count = await pool.query(
    `SELECT COUNT(*) AS cnt FROM lumen.entities WHERE entity_type = 'naves_topic'`,
  );
  console.log(`  Verification: ${count.rows[0].cnt} naves_topic entities`);
}

// ── Step 4: Import JST (Inspired Version) ──────────────────────────────

function parseJstMarkdown(filePath: string): Array<{ verseNumber: number; text: string }> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const verses: Array<{ verseNumber: number; text: string }> = [];
  let currentVerse = 0;
  let currentText = '';

  for (const line of lines) {
    const verseMatch = line.match(/^## (\d+)\.\s*$/);
    if (verseMatch) {
      if (currentVerse > 0 && currentText.trim()) {
        verses.push({ verseNumber: currentVerse, text: currentText.trim() });
      }
      currentVerse = parseInt(verseMatch[1]);
      currentText = '';
    } else if (currentVerse > 0 && !line.startsWith('[[') && line.trim()) {
      currentText += (currentText ? ' ' : '') + line.trim();
    }
  }
  if (currentVerse > 0 && currentText.trim()) {
    verses.push({ verseNumber: currentVerse, text: currentText.trim() });
  }

  return verses;
}

// Map JST book directory names to standard book slugs
const JST_BOOK_DIR_MAP: Record<string, string> = {
  'Genesis': 'gen', 'Exodus': 'ex', 'Leviticus': 'lev', 'Numbers': 'num',
  'Deuteronomy': 'deut', 'Joshua': 'josh', 'Judges': 'judg', 'Ruth': 'ruth',
  '1Samuel': '1-sam', '2Samuel': '2-sam', '1Kings': '1-kgs', '2Kings': '2-kgs',
  '1Chronicles': '1-chr', '2Chronicles': '2-chr', 'Ezra': 'ezra', 'Nehemiah': 'neh',
  'Esther': 'esth', 'Job': 'job', 'Psalms': 'ps', 'Proverbs': 'prov',
  'Ecclesiastes': 'eccl', 'SongOfSolomon': 'song', 'Isaiah': 'isa',
  'Jeremiah': 'jer', 'Lamentations': 'lam', 'Ezekiel': 'ezek', 'Daniel': 'dan',
  'Hosea': 'hosea', 'Joel': 'joel', 'Amos': 'amos', 'Obadiah': 'obad',
  'Jonah': 'jonah', 'Micah': 'micah', 'Nahum': 'nahum', 'Habakkuk': 'hab',
  'Zephaniah': 'zeph', 'Haggai': 'hag', 'Zechariah': 'zech', 'Malachi': 'mal',
  'Matthew': 'matt', 'Mark': 'mark', 'Luke': 'luke', 'John': 'john',
  'Acts': 'acts', 'Romans': 'rom', '1Corinthians': '1-cor', '2Corinthians': '2-cor',
  'Galatians': 'gal', 'Ephesians': 'eph', 'Philippians': 'philip', 'Colossians': 'col',
  '1Thessalonians': '1-thes', '2Thessalonians': '2-thes',
  '1Timothy': '1-tim', '2Timothy': '2-tim', 'Titus': 'titus', 'Philemon': 'philem',
  'Hebrews': 'heb', 'James': 'james', '1Peter': '1-pet', '2Peter': '2-pet',
  '1John': '1-jn', '2John': '2-jn', '3John': '3-jn', 'Jude': 'jude',
  'Revelation': 'rev',
};

async function importJst(pool: pg.Pool, dryRun: boolean): Promise<void> {
  console.log('\n=== Step 4: Import JST (1867 Inspired Version) ===\n');

  const entities: Array<{
    id: string; entityType: string; name: string;
    description: string | null; metadata: Record<string, unknown>; source: string;
    collectionId: string;
  }> = [];

  let totalVerses = 0;

  for (const [testament, dir] of [['OT', JST_OT_DIR], ['NT', JST_NT_DIR]] as const) {
    if (!fs.existsSync(dir)) {
      console.log(`  Skipping ${testament} -- directory not found: ${dir}`);
      continue;
    }

    const bookDirs = fs.readdirSync(dir).filter(f =>
      fs.statSync(path.join(dir, f)).isDirectory()
    ).sort();

    for (const bookDir of bookDirs) {
      const bookPath = path.join(dir, bookDir);
      const mdFiles = fs.readdirSync(bookPath)
        .filter(f => f.endsWith('.md') && /\d+\.md$/.test(f))
        .sort((a, b) => {
          const numA = parseInt(a.match(/(\d+)\.md$/)?.[1] || '0');
          const numB = parseInt(b.match(/(\d+)\.md$/)?.[1] || '0');
          return numA - numB;
        });

      for (const mdFile of mdFiles) {
        // Extract book name and chapter from filename like "Genesis1.md"
        const fileMatch = mdFile.match(/^(.+?)(\d+)\.md$/);
        if (!fileMatch) continue;

        const rawBookName = fileMatch[1];
        const chapterNum = parseInt(fileMatch[2]);

        const bSlug = JST_BOOK_DIR_MAP[rawBookName];
        if (!bSlug) {
          console.log(`    Warning: unmapped JST book "${rawBookName}" in ${mdFile}`);
          continue;
        }

        const verses = parseJstMarkdown(path.join(bookPath, mdFile));
        totalVerses += verses.length;

        for (const verse of verses) {
          const kjvVerseId = verseId(bSlug, chapterNum, verse.verseNumber);
          entities.push({
            id: `jst-${kjvVerseId}`,
            entityType: 'jst_reading',
            name: `JST ${rawBookName} ${chapterNum}:${verse.verseNumber}`,
            description: verse.text,
            metadata: {
              verse_id: kjvVerseId,
              jst_text: verse.text,
              change_type: 'substitution',
              significance: 'moderate',
            },
            source: '1867-jst',
            collectionId: 'jst',
          });
        }
      }
    }
  }

  console.log(`  Total JST verses parsed: ${totalVerses}`);
  console.log(`  JST entities to write: ${entities.length}`);

  if (dryRun) {
    console.log('  [DRY RUN] Would write entities to lumen.entities');
    if (entities.length > 0) {
      console.log(`  Sample: ${entities[0].name} -> ${entities[0].id}`);
    }
    return;
  }

  console.log('  Writing JST readings...');
  await batchInsertEntities(pool, entities);

  const count = await pool.query(
    `SELECT COUNT(*) AS cnt FROM lumen.entities WHERE entity_type = 'jst_reading'`,
  );
  console.log(`  Verification: ${count.rows[0].cnt} jst_reading entities`);
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // TOMBSTONE (canon-spine, 2026-07-06): this script writes the PRE-SPINE
  // shapes (book/chapter entities, old verses columns) and must not run again.
  // Structure now lives in lumen.volumes/books/chapters — see
  // scripts/migrate-canon-spine.mjs and docs/design/canon-spine.md.
  console.error(JSON.stringify({ event: 'phase_a_frozen', see: 'docs/design/canon-spine.md' }));
  throw new Error('ingest-phase-a is frozen by the canon-spine migration');

  const args = process.argv.slice(2);
  const dryRun = !args.includes('--write');
  const stepFilter = args.find(a => a.startsWith('--step='))?.split('=')[1];

  if (dryRun) {
    console.log('+===========================================+');
    console.log('|  DRY RUN -- no data will be written       |');
    console.log('|  Use --write to actually import            |');
    console.log('+===========================================+');
  }

  // Load env from root .env
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match && !process.env[match[1].trim()]) {
        process.env[match[1].trim()] = match[2].trim();
      }
    }
    console.log(`Loaded env from ${envPath}`);
  }

  // Build pool config from DATABASE_URL or individual env vars
  let poolConfig: pg.PoolConfig;

  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    poolConfig = {
      host: url.hostname,
      port: parseInt(url.port || '5432'),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ''),
      ssl: { rejectUnauthorized: false },
      max: 5,
    };
  } else {
    poolConfig = {
      host: process.env.DB_HOST!,
      port: parseInt(process.env.DB_PORT || '5432'),
      user: process.env.DB_USER!,
      password: process.env.DB_PASSWORD!,
      database: process.env.DB_NAME || 'postgres',
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: 5,
    };
  }

  const pool = new pg.Pool(poolConfig);

  try {
    // Always create schema
    await createSchema(pool);

    const steps = stepFilter ? [stepFilter] : ['canon', 'strongs', 'naves', 'jst'];

    for (const step of steps) {
      switch (step) {
        case 'canon':
          await importCanon(pool, dryRun);
          break;
        case 'strongs':
          await importStrongs(pool, dryRun);
          break;
        case 'naves':
          await importNaves(pool, dryRun);
          break;
        case 'jst':
          await importJst(pool, dryRun);
          break;
        default:
          console.log(`Unknown step: ${step}`);
      }
    }

    // Final summary
    if (!dryRun) {
      console.log('\n=== Final Summary ===\n');
      const verseCt = await pool.query('SELECT COUNT(*) AS cnt FROM lumen.verses');
      const entityCt = await pool.query('SELECT COUNT(*) AS cnt FROM lumen.entities');
      const typeCounts = await pool.query(
        `SELECT entity_type, COUNT(*) AS cnt FROM lumen.entities GROUP BY entity_type ORDER BY entity_type`,
      );
      console.log(`  Total verses: ${verseCt.rows[0].cnt}`);
      console.log(`  Total entities: ${entityCt.rows[0].cnt}`);
      console.log('  By type:');
      for (const row of typeCounts.rows) {
        console.log(`    ${row.entity_type}: ${row.cnt}`);
      }
    }

    console.log('\nPhase A complete.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
