/**
 * The words-table tokenizer (canon-spine). Contract:
 * - offsets round-trip: `text.slice(char_start, char_end) === surface`
 * - positions contiguous from 1; punctuation never tokenized
 * - word-internal apostrophes (straight/curly) and hyphens kept ("LORD’s", "Beth-el")
 * - `normalized` = lowercase, curly→straight apostrophe; `surface` verbatim
 * - deterministic; safe only for ingest-time canon text (not user input)
 *
 * Offsets exist so highlighting is a slice against verses.text — the client
 * never re-tokenizes. Worst tokenizer bug is a mis-highlight, never a misprint:
 * scripture is never reconstructed from tokens.
 */
export interface Token {
  position: number;
  surface: string;
  normalized: string;
  char_start: number;
  char_end: number;
}

const TOKEN_RE = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = new RegExp(TOKEN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const surface = m[0];
    tokens.push({
      position: tokens.length + 1,
      surface,
      normalized: surface.toLowerCase().replace(/’/g, "'"),
      char_start: m.index,
      char_end: m.index + surface.length,
    });
  }
  return tokens;
}
