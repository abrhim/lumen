// Words-table population: tokenize every verse of every volume (gate Q4)
// into lumen.words via the canonical tokenizer.
//   node --import tsx scripts/ingest-words.mjs [--book <id>] [--dry-run]
//
// Requires the admin session-mode DATABASE_URL in repo-root .env (same as the
// spine migration). Idempotent: each batch runs DELETE+INSERT for its verses
// in one transaction; interrupted runs converge on re-run (FM-8).
// Exit codes: 0 success, 1 fatal, 2 partial (batch failures).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { assertSessionMode } from './migrate-canon-spine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ~75 verses/batch ≈ ~2,000 word rows/batch (PERF-5/MIG-7)
const VERSES_PER_BATCH = 75;

/** Pure batch planner — verse-count batches; re-planning a tail converges (FM-8). */
export function planWordBatches(verses, versesPerBatch) {
  const batches = [];
  for (let i = 0; i < verses.length; i += versesPerBatch) {
    batches.push(verses.slice(i, i + versesPerBatch));
  }
  return batches;
}

export function scrub(message) {
  return String(message)
    .replace(/\b(postgres(?:ql)?|https?):\/\/[^@\s]*@/gi, '$1://<redacted>@')
    .replace(/password=[^&\s]+/gi, 'password=<redacted>');
}

const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const bookFlag = process.argv.indexOf('--book');
  const onlyBook = bookFlag !== -1 ? process.argv[bookFlag + 1] : null;
  const t0 = Date.now();
  log('words_ingest_start', { startedAt: new Date().toISOString(), dryRun, onlyBook });

  const { tokenize } = await import(join(ROOT, 'packages/scripture/src/tokenize.ts'));
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) throw new Error('repo-root .env with admin DATABASE_URL required');
  const url = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
  if (!url) throw new Error('DATABASE_URL not found in repo-root .env');
  if (/:6543\b/.test(url)) throw new Error('session-mode connection required (port 5432)');

  const require = createRequire(import.meta.url);
  const postgres = require('postgres');
  const sql = postgres(url, { prepare: false, max: 1 });

  let exitCode = 0;
  try {
    await assertSessionMode(sql);

    if (onlyBook) {
      // unknown --book must fail loudly, not converge on a 0-verse success (CMIG-4)
      const known = await sql`SELECT 1 FROM lumen.books WHERE id = ${onlyBook}`;
      if (known.length === 0) throw new Error(`--book "${onlyBook}" not found in lumen.books`);
    }
    const books = onlyBook
      ? [{ id: onlyBook }]
      : await sql`SELECT id FROM lumen.books ORDER BY sort_order`;

    let totalTokens = 0;
    let totalVerses = 0;
    let batchesFailed = 0;
    const zeroTokenVerses = [];

    for (const book of books) {
      const bt = Date.now();
      const verses = await sql`
        SELECT v.id, v.text FROM lumen.verses v
        JOIN lumen.chapters c ON c.id = v.chapter_id
        WHERE c.book_id = ${book.id}
        ORDER BY v.id`;
      let bookTokens = 0;
      const perVerse = [];

      for (const batch of planWordBatches(verses, VERSES_PER_BATCH)) {
        const rows = [];
        for (const v of batch) {
          const tokens = tokenize(v.text);
          if (tokens.length === 0) zeroTokenVerses.push(v.id);
          perVerse.push(tokens.length);
          for (const t of tokens) {
            rows.push({
              id: `${v.id}-w${t.position}`,
              verse_id: v.id,
              position: t.position,
              surface: t.surface,
              normalized: t.normalized,
              char_start: t.char_start,
              char_end: t.char_end,
            });
          }
        }
        if (dryRun) { bookTokens += rows.length; continue; }
        try {
          // one transaction per batch: interrupted runs never leave a verse half-tokenized
          await sql.begin(async (tx) => {
            await tx`DELETE FROM lumen.words WHERE verse_id IN ${tx(batch.map((v) => v.id))}`;
            await tx`
              INSERT INTO lumen.words (id, verse_id, position, surface, normalized, char_start, char_end)
              SELECT r.id, r.verse_id, r.position, r.surface, r.normalized, r.char_start, r.char_end
              FROM jsonb_to_recordset(${tx.json(rows)})
                AS r(id text, verse_id text, position int, surface text, normalized text, char_start int, char_end int)`;
          });
          bookTokens += rows.length;
        } catch (err) {
          batchesFailed++;
          log('words_batch_failed', {
            book: book.id,
            verseRange: [batch[0].id, batch[batch.length - 1].id],
            verses: batch.length,
            message: scrub(err.message),
          });
        }
      }

      totalTokens += bookTokens;
      totalVerses += verses.length;
      perVerse.sort((a, b) => a - b);
      log('words_book_done', {
        book: book.id, verses: verses.length, tokens: bookTokens,
        tokensPerVerse: perVerse.length
          ? { min: perVerse[0], median: perVerse[Math.floor(perVerse.length / 2)], max: perVerse[perVerse.length - 1] }
          : null,
        elapsedMs: Date.now() - bt,
      });
    }

    if (batchesFailed > 0) exitCode = 2;

    // search index is built AFTER the bulk load, not live-maintained across it
    // (CPERF-7); only after a clean, full-corpus run
    if (!dryRun && !onlyBook && batchesFailed === 0) {
      const it = Date.now();
      await sql`CREATE INDEX IF NOT EXISTS idx_words_normalized ON lumen.words (normalized)`;
      log('words_index_built', { index: 'idx_words_normalized', elapsedMs: Date.now() - it });
    } else if (!dryRun) {
      log('words_index_skipped', { reason: onlyBook ? 'partial --book run' : 'batch failures' });
    }

    log('words_ingest_done', {
      dryRun, books: books.length, verses: totalVerses, tokens: totalTokens,
      zeroTokenVerses: { count: zeroTokenVerses.length, sample: zeroTokenVerses.slice(0, 10) },
      batchesFailed, elapsedMs: Date.now() - t0,
    });
  } catch (err) {
    exitCode = 1;
    log('words_ingest_fatal', { message: scrub(err.message) });
  } finally {
    await sql.end();
    process.exit(exitCode);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
