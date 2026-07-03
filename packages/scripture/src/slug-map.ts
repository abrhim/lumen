const VOLUME_IDS = ['ot', 'nt', 'bom', 'dc', 'pgp'] as const;

const BOOK_SLUGS: Record<string, string> = {
  'gen': 'gen', 'genesis': 'gen',
  'ex': 'ex', 'exodus': 'ex',
  'lev': 'lev', 'leviticus': 'lev',
  'num': 'num', 'numbers': 'num',
  'deut': 'deut', 'deuteronomy': 'deut',
  'josh': 'josh', 'joshua': 'josh',
  'judg': 'judg', 'judges': 'judg',
  'ruth': 'ruth',
  '1-sam': '1-sam', '1 samuel': '1-sam', '1 sam': '1-sam',
  '2-sam': '2-sam', '2 samuel': '2-sam', '2 sam': '2-sam',
  '1-kgs': '1-kgs', '1 kings': '1-kgs', '1 kgs': '1-kgs',
  '2-kgs': '2-kgs', '2 kings': '2-kgs', '2 kgs': '2-kgs',
  '1-chr': '1-chr', '1 chronicles': '1-chr', '1 chr': '1-chr',
  '2-chr': '2-chr', '2 chronicles': '2-chr', '2 chr': '2-chr',
  'ezra': 'ezra',
  'neh': 'neh', 'nehemiah': 'neh',
  'esth': 'esth', 'esther': 'esth',
  'job': 'job',
  'ps': 'ps', 'psalms': 'ps', 'psalm': 'ps',
  'prov': 'prov', 'proverbs': 'prov',
  'eccl': 'eccl', 'ecclesiastes': 'eccl',
  'song': 'song', 'song of solomon': 'song',
  'isa': 'isa', 'isaiah': 'isa',
  'jer': 'jer', 'jeremiah': 'jer',
  'lam': 'lam', 'lamentations': 'lam',
  'ezek': 'ezek', 'ezekiel': 'ezek',
  'dan': 'dan', 'daniel': 'dan',
  'hosea': 'hosea', 'hos': 'hosea',
  'joel': 'joel',
  'amos': 'amos',
  'obad': 'obad', 'obadiah': 'obad',
  'jonah': 'jonah',
  'micah': 'micah', 'mic': 'micah',
  'nahum': 'nahum', 'nah': 'nahum',
  'hab': 'hab', 'habakkuk': 'hab',
  'zeph': 'zeph', 'zephaniah': 'zeph',
  'hag': 'hag', 'haggai': 'hag',
  'zech': 'zech', 'zechariah': 'zech',
  'mal': 'mal', 'malachi': 'mal',
  'matt': 'matt', 'matthew': 'matt',
  'mark': 'mark',
  'luke': 'luke',
  'john': 'john',
  'acts': 'acts',
  'rom': 'rom', 'romans': 'rom',
  '1-cor': '1-cor', '1 corinthians': '1-cor', '1 cor': '1-cor',
  '2-cor': '2-cor', '2 corinthians': '2-cor', '2 cor': '2-cor',
  'gal': 'gal', 'galatians': 'gal',
  'eph': 'eph', 'ephesians': 'eph',
  'philip': 'philip', 'philippians': 'philip',
  'col': 'col', 'colossians': 'col',
  '1-thes': '1-thes', '1 thessalonians': '1-thes', '1 thes': '1-thes',
  '2-thes': '2-thes', '2 thessalonians': '2-thes', '2 thes': '2-thes',
  '1-tim': '1-tim', '1 timothy': '1-tim', '1 tim': '1-tim',
  '2-tim': '2-tim', '2 timothy': '2-tim', '2 tim': '2-tim',
  'titus': 'titus',
  'philem': 'philem', 'philemon': 'philem',
  'heb': 'heb', 'hebrews': 'heb',
  'james': 'james',
  '1-pet': '1-pet', '1 peter': '1-pet', '1 pet': '1-pet',
  '2-pet': '2-pet', '2 peter': '2-pet', '2 pet': '2-pet',
  '1-jn': '1-jn', '1 john': '1-jn', '1 jn': '1-jn',
  '2-jn': '2-jn', '2 john': '2-jn', '2 jn': '2-jn',
  '3-jn': '3-jn', '3 john': '3-jn', '3 jn': '3-jn',
  'jude': 'jude',
  'rev': 'rev', 'revelation': 'rev', 'revelations': 'rev',
  '1-ne': '1-ne', '1 nephi': '1-ne', '1 ne': '1-ne', '1ne': '1-ne',
  '2-ne': '2-ne', '2 nephi': '2-ne', '2 ne': '2-ne', '2ne': '2-ne',
  'jacob': 'jacob',
  'enos': 'enos',
  'jarom': 'jarom',
  'omni': 'omni',
  'w-of-m': 'w-of-m', 'words of mormon': 'w-of-m',
  'mosiah': 'mosiah',
  'alma': 'alma',
  'hel': 'hel', 'helaman': 'hel',
  '3-ne': '3-ne', '3 nephi': '3-ne', '3 ne': '3-ne', '3ne': '3-ne',
  '4-ne': '4-ne', '4 nephi': '4-ne', '4 ne': '4-ne', '4ne': '4-ne',
  'morm': 'morm', 'mormon': 'morm',
  'ether': 'ether',
  'moroni': 'moroni',
  'dc': 'dc', 'd&c': 'dc', 'doctrine and covenants': 'dc',
  'moses': 'moses',
  'abr': 'abr', 'abraham': 'abr',
  'js-m': 'js-m', 'joseph smith—matthew': 'js-m', 'joseph smith matthew': 'js-m', 'js matthew': 'js-m',
  'js-h': 'js-h', 'joseph smith—history': 'js-h', 'joseph smith history': 'js-h', 'js history': 'js-h',
  'a-of-f': 'a-of-f', 'articles of faith': 'a-of-f',
};

export type ReferenceLevel = 'volume' | 'book' | 'chapter' | 'verse' | 'human_ref' | 'unknown';

export interface ParsedReference {
  level: ReferenceLevel;
  volumeId?: string;
  bookId?: string;
  chapter?: number;
  verse?: number;
  raw: string;
}

export function parseReference(input: string): ParsedReference {
  const raw = input.trim();
  const lower = raw.toLowerCase();

  if (VOLUME_IDS.includes(lower as any)) {
    // D&C is a volume that is also a single book ("dc" appears in both
    // namespaces) — carry the bookId so book-shaped consumers can accept it.
    return { level: 'volume', volumeId: lower, bookId: BOOK_SLUGS[lower], raw };
  }

  if (BOOK_SLUGS[lower]) {
    return { level: 'book', bookId: BOOK_SLUGS[lower], raw };
  }

  const slugParts = lower.split('-');
  for (let i = slugParts.length - 1; i >= 1; i--) {
    const candidateBook = slugParts.slice(0, i).join('-');
    const rest = slugParts.slice(i);

    if (BOOK_SLUGS[candidateBook]) {
      const bookId = BOOK_SLUGS[candidateBook];
      if (rest.length === 1) {
        const ch = parseInt(rest[0], 10);
        if (!isNaN(ch) && ch > 0) {
          return { level: 'chapter', bookId, chapter: ch, raw };
        }
      }
      if (rest.length === 2) {
        const ch = parseInt(rest[0], 10);
        const v = parseInt(rest[1], 10);
        if (!isNaN(ch) && ch > 0 && !isNaN(v) && v > 0) {
          return { level: 'verse', bookId, chapter: ch, verse: v, raw };
        }
      }
    }
  }

  const humanMatch = lower.match(/^(.+?)\s+(\d+)(?::(\d+))?$/);
  if (humanMatch) {
    const bookName = humanMatch[1].trim();
    const chapter = parseInt(humanMatch[2], 10);
    const verse = humanMatch[3] ? parseInt(humanMatch[3], 10) : undefined;
    const bookId = BOOK_SLUGS[bookName];
    if (bookId) {
      if (verse !== undefined) {
        return { level: 'verse', bookId, chapter, verse, raw };
      }
      return { level: 'chapter', bookId, chapter, raw };
    }
  }

  return { level: 'unknown', raw };
}

export function buildVerseId(bookId: string, chapter: number, verse: number): string {
  return `${bookId}-${chapter}-${verse}`;
}

export const VOLUME_ID_LIST = [...VOLUME_IDS];

export const RELATIONSHIP_TYPES = [
  'TEACHES', 'CROSS_REF', 'MENTIONS', 'LOCATED_AT',
  'IN_CHAPTER', 'IN_BOOK', 'IN_VOLUME',
  'HAS_JST', 'HAS_SUMMARY', 'USES_WORD',
  'REFERENCES', 'MAPS_TO', 'PARENT_OF',
  // semantic verse relations confirmed live in the graph (graph-view feature)
  'PARALLELS', 'EXTENDS', 'CONTRASTS', 'TYPIFIES', 'HAS_SYMBOL', 'SETTING_OF',
  'SUMMARIZES', 'APPEARS_IN', 'FEATURES', 'COVERS',
] as const;
