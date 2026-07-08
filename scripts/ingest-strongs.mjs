// Strong's concordance ingest (strongs feature): CrossWire KJV2006 per-word
// tags aligned DETERMINISTICALLY onto lumen.words + STEPBible lexicons.
//   node --import tsx scripts/ingest-strongs.mjs [--dry-run]
//
// Sources are VENDORED under data/strongs/ (no network at admin-DSN time):
//   kjvfull.xml — CrossWire KJV2006 ("use this text for any purpose", see
//   data/strongs/README.md for the verbatim grant); TBESH/TBESG — CC BY 4.0.
//
// COUPLING (SC-3): word_tags FKs lumen.words ON DELETE CASCADE — a re-run of
// ingest-words.mjs cascades tags away; re-run THIS script afterwards.
// Exit codes: 0 success, 1 fatal/cap-abort.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { assertSessionMode, scrub } from './migrate-canon-spine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const XML_FILE = join(ROOT, 'data/strongs/kjvfull.xml');
const LEXICONS = [
  { file: join(ROOT, 'data/strongs/TBESH.txt'), lang: 'hebrew' },
  { file: join(ROOT, 'data/strongs/TBESG.txt'), lang: 'greek' },
];
const BATCH_SIZE = 5000; // ~160 batches over ~790k rows; est. 3–6 min (PO-4)
const SKIP_CAP = 0.01; // whole-run skipped-verse ratio over Bible verses

// KJV2006 OSIS book codes → our slugs (Bible-only; matches osis-map values)
const OSIS_BOOKS = {
  Gen: 'gen', Exod: 'ex', Lev: 'lev', Num: 'num', Deut: 'deut', Josh: 'josh',
  Judg: 'judg', Ruth: 'ruth', '1Sam': '1-sam', '2Sam': '2-sam', '1Kgs': '1-kgs',
  '2Kgs': '2-kgs', '1Chr': '1-chr', '2Chr': '2-chr', Ezra: 'ezra', Neh: 'neh',
  Esth: 'esth', Job: 'job', Ps: 'ps', Prov: 'prov', Eccl: 'eccl', Song: 'song',
  Isa: 'isa', Jer: 'jer', Lam: 'lam', Ezek: 'ezek', Dan: 'dan', Hos: 'hosea',
  Joel: 'joel', Amos: 'amos', Obad: 'obad', Jonah: 'jonah', Mic: 'micah',
  Nah: 'nahum', Hab: 'hab', Zeph: 'zeph', Hag: 'hag', Zech: 'zech', Mal: 'mal',
  Matt: 'matt', Mark: 'mark', Luke: 'luke', John: 'john', Acts: 'acts',
  Rom: 'rom', '1Cor': '1-cor', '2Cor': '2-cor', Gal: 'gal', Eph: 'eph',
  Phil: 'philip', Col: 'col', '1Thess': '1-thes', '2Thess': '2-thes',
  '1Tim': '1-tim', '2Tim': '2-tim', Titus: 'titus', Phlm: 'philem', Heb: 'heb',
  Jas: 'james', '1Pet': '1-pet', '2Pet': '2-pet', '1John': '1-jn',
  '2John': '2-jn', '3John': '3-jn', Jude: 'jude', Rev: 'rev',
};

/** 'strong:H07225' | 'H0430' | 'h1254a' → canonical 'H7225'/'H430'/'H1254A'; null if unparseable. */
export function normalizeStrongs(raw) {
  const m = String(raw).trim().match(/^(?:strong:)?([HGhg])0*(\d+)([A-Za-z]?)$/);
  if (!m) return null;
  return `${m[1].toUpperCase()}${m[2]}${m[3].toUpperCase()}`;
}

/**
 * Extract tagged spans from ONE verse's raw OSIS content (between sID/eID
 * milestones). Amendment 1 hardening:
 * - nested markup inside <w> (divineName/seg — 18.7% of verses) is STRIPPED
 *   to its text, never read as empty;
 * - tagged <w> nested inside <transChange> is extracted (34 live cases);
 *   bare transChange text carries no tags (correct: translator-supplied);
 * - empty/self-closed <w/> (untranslated originals) are skipped;
 * - <q>/<note>/<milestone> and all other elements are ignored — only <w>
 *   boundaries matter; <q> balance is never tracked.
 * Notes (<note>...</note>) are removed FIRST: study notes contain their own
 * <w> tags that are not verse text.
 */
export function parseVerseSpans(verseXml) {
  const spans = [];
  const withoutNotes = verseXml.replace(/<note[\s\S]*?<\/note>/g, '');
  const wRe = /<w\s([^>]*?)(?:\/>|>([\s\S]*?)<\/w>)/g;
  let m;
  while ((m = wRe.exec(withoutNotes)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    if (inner === undefined) continue; // self-closed <w/>
    // KJV2006 joins compound names with EN DASH (Baal–hanan) and keeps
    // ligatures (Cæsar, Judæa); our corpus is ASCII (hyphens, 'ae') —
    // normalize or ~1,700 verses fail alignment (measured classes)
    const text = inner
      .replace(/<[^>]+>/g, '')
      .replace(/[–—]/g, '-')
      .replace(/æ/g, 'ae')
      .replace(/Æ/g, 'Ae')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const lemmaAttr = attrs.match(/lemma="([^"]*)"/)?.[1] ?? '';
    const strongs = lemmaAttr
      .split(/\s+/)
      .map(normalizeStrongs)
      .filter(Boolean);
    if (strongs.length === 0) continue; // e.g. lemma.TR-only tokens
    const morph = attrs.match(/morph="([^"]*)"/)?.[1] ?? null;
    spans.push({ text, strongs, morph });
  }
  return spans;
}

/**
 * Known 1769↔modernized spelling equivalences between CrossWire's KJV text
 * and our (lds-doc-project) KJV corpus, measured from the live mismatch
 * histogram. Keys are KJV2006 normalized tokens; values are our corpus forms.
 * Matching stays DETERMINISTIC: exact equality OR an entry in this table.
 */
export const SPELLING_EQUIV = {
  enquire: 'inquire', enquired: 'inquired', enquirest: 'inquirest', enquiry: 'inquiry',
  vail: 'veil', vails: 'veils',
  jubile: 'jubilee',
  intreat: 'entreat', intreated: 'entreated', intreaties: 'entreaties', intreaty: 'entreaty',
  bason: 'basin', basons: 'basins',
  stedfast: 'steadfast', stedfastly: 'steadfastly', stedfastness: 'steadfastness',
  rereward: 'rearward',
  cloke: 'cloak', plaister: 'plaster', morter: 'mortar',
  graffed: 'grafted', graff: 'graft', spunge: 'sponge', cieled: 'ceiled',
  cieling: 'ceiling',
};

const tokensMatch = (a, b) => a === b || SPELLING_EQUIV[a] === b;

/**
 * Deterministic sequential alignment (amendment: art-retro "instance-level"):
 * tokenize each span with OUR tokenizer and consume the verse's words in
 * order. Words between spans (transChange etc.) are skipped untagged. ANY
 * mismatch abandons the whole verse (FM-3) — never a partial guess.
 * Returns { ok, tags: [{word_id, position, strongs, morph}] }.
 */
export function alignSpansToWords(spans, words) {
  const tags = [];
  let wi = 0;
  for (const span of spans) {
    const tokens = tokenizerMod.tokenize(span.text);
    if (tokens.length === 0) continue;
    // scan forward for the span's first token (untagged gap words allowed)
    let start = wi;
    while (start < words.length && !tokensMatch(tokens[0].normalized, words[start].normalized)) start++;
    if (start >= words.length) return { ok: false, tags: [] };
    // walk the span: 1:1 matches, plus the deterministic JOIN rule — two
    // source tokens whose concatenation equals ONE of our words ("can not"
    // ↔ "cannot"; measured split-word class), consuming both for that word
    const matched = [];
    let ti = 0;
    let widx = start;
    while (ti < tokens.length) {
      if (widx >= words.length) return { ok: false, tags: [] };
      const w = words[widx];
      if (tokensMatch(tokens[ti].normalized, w.normalized)) {
        matched.push(w);
        ti += 1; widx += 1;
      } else if (
        ti + 1 < tokens.length &&
        tokens[ti].normalized + tokens[ti + 1].normalized === w.normalized
      ) {
        matched.push(w);
        ti += 2; widx += 1;
      } else {
        return { ok: false, tags: [] };
      }
    }
    for (const w of matched) {
      tags.push({ word_id: w.id, position: w.position, strongs: span.strongs, morph: span.morph });
    }
    wi = widx;
  }
  return { ok: true, tags };
}

/** Whole-run cap over Bible verses; boundary exclusive (FM-5). */
export function skipCapVerdict(skipped, total, cap) {
  const ratio = total === 0 ? 0 : skipped / total;
  return { ratio: Number(ratio.toFixed(5)), pass: ratio < cap };
}

/** Lexicon TSV row → {strongs_no, translit, gloss, definition-as-plain-text}. */
export function parseLexiconLine(line) {
  const cols = line.split('\t');
  if (cols.length < 8) return null;
  const strongs_no = normalizeStrongs(cols[0]);
  if (!strongs_no) return null;
  const plain = (s) =>
    s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/[ \t]+/g, ' ').trim();
  return {
    strongs_no,
    translit: cols[4]?.trim() || null,
    gloss: plain(cols[6] ?? '') || null,
    definition: plain(cols[7] ?? '') || null,
  };
}

// tokenizer injected (tsx-transpiled TS; tests provide it, main() imports it)
let tokenizerMod = null;
export function _setTokenizer(m) { tokenizerMod = m; }

const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const t0 = Date.now();
  log('strongs_ingest_start', { startedAt: new Date().toISOString(), dryRun });

  let sql;
  try {
    tokenizerMod = await import(join(ROOT, 'packages/scripture/src/tokenize.ts'));
    const envPath = join(ROOT, '.env');
    if (!existsSync(envPath)) throw new Error('repo-root .env with admin DATABASE_URL required');
    const url = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
    if (!url) throw new Error('DATABASE_URL not found in repo-root .env');
    if (/:6543\b/.test(url)) throw new Error('session-mode connection required (port 5432)');
    const require = createRequire(import.meta.url);
    const postgres = require('postgres');
    sql = postgres(url, { prepare: false, max: 1 });
  } catch (err) {
    log('strongs_ingest_fatal', { message: scrub(err.message) });
    process.exit(1);
  }

  let exitCode = 0;
  try {
    await assertSessionMode(sql);

    // ---- parse the XML into per-verse spans ----
    const xml = readFileSync(XML_FILE, 'utf8');
    const verseRe = /<verse osisID="([^"]+)" sID="[^"]*"\/>([\s\S]*?)<verse eID="/g;
    const spansByVerse = new Map();
    let vm;
    while ((vm = verseRe.exec(xml)) !== null) {
      const [book, chapter, verse] = vm[1].split('.');
      const slug = OSIS_BOOKS[book];
      if (!slug) continue;
      const spans = parseVerseSpans(vm[2]);
      if (spans.length > 0) spansByVerse.set(`${slug}-${chapter}-${verse}`, spans);
    }
    log('source_loaded', { versesWithSpans: spansByVerse.size, xmlBytes: xml.length });

    // ---- our words, Bible verses only ----
    const bibleWords = await sql`
      SELECT w.verse_id, w.id, w.position, w.normalized
      FROM lumen.words w
      JOIN lumen.verses v ON v.id = w.verse_id
      JOIN lumen.chapters c ON c.id = v.chapter_id
      JOIN lumen.books b ON b.id = c.book_id
      WHERE b.volume_id IN ('ot', 'nt')
      ORDER BY w.verse_id, w.position`;
    const wordsByVerse = new Map();
    for (const w of bibleWords) {
      if (!wordsByVerse.has(w.verse_id)) wordsByVerse.set(w.verse_id, []);
      wordsByVerse.get(w.verse_id).push(w);
    }
    log('words_loaded', { bibleVerses: wordsByVerse.size, words: bibleWords.length });

    // ---- align ----
    const rows = [];
    const skippedVerses = [];
    for (const [verseId, words] of wordsByVerse) {
      const spans = spansByVerse.get(verseId);
      if (!spans) { skippedVerses.push(`${verseId} (no spans in source)`); continue; }
      const { ok, tags } = alignSpansToWords(spans, words);
      if (!ok) { skippedVerses.push(`${verseId} (alignment)`); continue; }
      for (const t of tags) rows.push({ word_id: t.word_id, strongs: t.strongs, morph: t.morph });
    }
    const verdict = skipCapVerdict(skippedVerses.length, wordsByVerse.size, SKIP_CAP);
    log('strongs_alignment_skipped', {
      count: skippedVerses.length, ratio: verdict.ratio, pass: verdict.pass,
      sample: skippedVerses.slice(0, 10),
    });
    if (!verdict.pass) throw new Error(`skipped-verse ratio ${(verdict.ratio * 100).toFixed(2)}% breaches the ${SKIP_CAP * 100}% cap`);
    const coverage = rows.length / bibleWords.length;
    log('strongs_coverage', { taggedWords: rows.length, bibleWords: bibleWords.length, ratio: Number(coverage.toFixed(4)) });

    // ---- lexicons ----
    const lexRows = [];
    for (const { file, lang } of LEXICONS) {
      const lines = readFileSync(file, 'utf8').split('\n');
      let n = 0;
      for (const line of lines) {
        const row = parseLexiconLine(line);
        if (row) { lexRows.push({ ...row, lang }); n++; }
      }
      log('strongs_lexicon_loaded', { lang, entries: n });
    }
    // last-write-wins de-dup on strongs_no (files can repeat base entries)
    const lexByNo = new Map(lexRows.map((r) => [r.strongs_no, r]));

    // ---- ONE transaction ----
    let deletedTags = 0;
    await sql.begin(async (tx) => {
      await tx.unsafe(`
        CREATE TABLE IF NOT EXISTS lumen.word_tags (
          word_id TEXT PRIMARY KEY REFERENCES lumen.words(id) ON DELETE CASCADE,
          strongs TEXT[] NOT NULL,
          morph TEXT
        );
        CREATE TABLE IF NOT EXISTS lumen.strongs_lexicon (
          strongs_no TEXT PRIMARY KEY,
          lang TEXT NOT NULL,
          translit TEXT,
          gloss TEXT,
          definition TEXT
        );
        ALTER TABLE lumen.word_tags ENABLE ROW LEVEL SECURITY;
        ALTER TABLE lumen.strongs_lexicon ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS word_tags_read ON lumen.word_tags;
        DROP POLICY IF EXISTS strongs_lexicon_read ON lumen.strongs_lexicon;
        CREATE POLICY word_tags_read ON lumen.word_tags FOR SELECT USING (true);
        CREATE POLICY strongs_lexicon_read ON lumen.strongs_lexicon FOR SELECT USING (true);
        GRANT SELECT ON lumen.word_tags, lumen.strongs_lexicon TO lumen_read;
      `);

      deletedTags = (await tx`DELETE FROM lumen.word_tags`).count;
      await tx`DELETE FROM lumen.strongs_lexicon`;

      let inserted = 0;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        await tx`
          INSERT INTO lumen.word_tags (word_id, strongs, morph)
          SELECT r.word_id, r.strongs, r.morph
          FROM jsonb_to_recordset(${tx.json(batch)}) AS r(word_id text, strongs text[], morph text)`;
        inserted += batch.length;
      }
      const lexArr = [...lexByNo.values()];
      for (let i = 0; i < lexArr.length; i += BATCH_SIZE) {
        const batch = lexArr.slice(i, i + BATCH_SIZE);
        await tx`
          INSERT INTO lumen.strongs_lexicon (strongs_no, lang, translit, gloss, definition)
          SELECT r.strongs_no, r.lang, r.translit, r.gloss, r.definition
          FROM jsonb_to_recordset(${tx.json(batch)}) AS r(strongs_no text, lang text, translit text, gloss text, definition text)`;
      }

      // GIN built AFTER the bulk load (PO-2 / CPERF-7 precedent)
      await tx`CREATE INDEX IF NOT EXISTS idx_word_tags_strongs ON lumen.word_tags USING gin (strongs)`;

      const [orph] = await tx`
        SELECT count(*)::int AS n FROM lumen.word_tags t
        WHERE NOT EXISTS (SELECT 1 FROM lumen.words w WHERE w.id = t.word_id)`;
      log('invariant_check', { name: 'strongs_zero_orphan_words', expected: 0, actual: orph.n, pass: orph.n === 0 });
      if (orph.n !== 0) throw new Error('invariant failed: strongs_zero_orphan_words');

      await tx`
        INSERT INTO lumen.migration_state (key, value)
        VALUES ('strongs-ingest', ${tx.json({ at: new Date().toISOString(), inserted, deleted: deletedTags, lexicon: lexByNo.size, coverage: Number(coverage.toFixed(4)) })})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()`;

      if (dryRun) throw new Error('DRY_RUN_ROLLBACK');
    }).catch((e) => {
      if (e.message === 'DRY_RUN_ROLLBACK') log('dry_run_rollback', { note: 'all checks passed, nothing committed' });
      else throw e;
    });

    log('strongs_ingest_done', { dryRun, deleted: deletedTags, inserted: rows.length, lexicon: lexByNo.size, elapsedMs: Date.now() - t0 });
  } catch (err) {
    exitCode = 1;
    log('strongs_ingest_fatal', { message: scrub(err.message), elapsedMs: Date.now() - t0 });
  } finally {
    await sql.end();
    process.exit(exitCode);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
