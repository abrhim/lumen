import { describe, it, expect } from 'vitest';
import { parseReference, buildVerseId, VOLUME_ID_LIST, RELATIONSHIP_TYPES } from '../slug-map';

describe('parseReference', () => {
  it('parses volume IDs', () => {
    expect(parseReference('bom')).toEqual({ level: 'volume', volumeId: 'bom', raw: 'bom' });
    expect(parseReference('OT')).toEqual({ level: 'volume', volumeId: 'ot', raw: 'OT' });
    expect(parseReference('pgp')).toEqual({ level: 'volume', volumeId: 'pgp', raw: 'pgp' });
  });

  it('carries bookId only for D&C, the single-book volume whose slug is also a book', () => {
    // multi-book volumes stay book-less
    expect(parseReference('bom').bookId).toBeUndefined();
    expect(parseReference('pgp').bookId).toBeUndefined();
  });

  it('parses book slugs', () => {
    expect(parseReference('1-ne')).toEqual({ level: 'book', bookId: '1-ne', raw: '1-ne' });
    expect(parseReference('gen')).toEqual({ level: 'book', bookId: 'gen', raw: 'gen' });
    expect(parseReference('alma')).toEqual({ level: 'book', bookId: 'alma', raw: 'alma' });
  });

  it('parses book names (case-insensitive)', () => {
    expect(parseReference('Genesis')).toEqual({ level: 'book', bookId: 'gen', raw: 'Genesis' });
    expect(parseReference('1 Nephi')).toEqual({ level: 'book', bookId: '1-ne', raw: '1 Nephi' });
    expect(parseReference('Revelation')).toEqual({ level: 'book', bookId: 'rev', raw: 'Revelation' });
  });

  it('parses slug-style chapter references', () => {
    expect(parseReference('1-ne-3')).toEqual({ level: 'chapter', bookId: '1-ne', chapter: 3, raw: '1-ne-3' });
    expect(parseReference('gen-1')).toEqual({ level: 'chapter', bookId: 'gen', chapter: 1, raw: 'gen-1' });
    expect(parseReference('alma-32')).toEqual({ level: 'chapter', bookId: 'alma', chapter: 32, raw: 'alma-32' });
  });

  it('parses slug-style verse references', () => {
    expect(parseReference('1-ne-3-7')).toEqual({ level: 'verse', bookId: '1-ne', chapter: 3, verse: 7, raw: '1-ne-3-7' });
    expect(parseReference('gen-1-1')).toEqual({ level: 'verse', bookId: 'gen', chapter: 1, verse: 1, raw: 'gen-1-1' });
    expect(parseReference('john-3-16')).toEqual({ level: 'verse', bookId: 'john', chapter: 3, verse: 16, raw: 'john-3-16' });
  });

  it('parses human-style chapter references', () => {
    expect(parseReference('1 Nephi 3')).toEqual({ level: 'chapter', bookId: '1-ne', chapter: 3, raw: '1 Nephi 3' });
    expect(parseReference('Genesis 22')).toEqual({ level: 'chapter', bookId: 'gen', chapter: 22, raw: 'Genesis 22' });
  });

  it('parses human-style verse references', () => {
    expect(parseReference('1 Nephi 3:7')).toEqual({ level: 'verse', bookId: '1-ne', chapter: 3, verse: 7, raw: '1 Nephi 3:7' });
    expect(parseReference('John 3:16')).toEqual({ level: 'verse', bookId: 'john', chapter: 3, verse: 16, raw: 'John 3:16' });
  });

  it('handles numbered book names with spaces', () => {
    expect(parseReference('2 Nephi 2:25')).toEqual({ level: 'verse', bookId: '2-ne', chapter: 2, verse: 25, raw: '2 Nephi 2:25' });
    expect(parseReference('3 Nephi 11')).toEqual({ level: 'chapter', bookId: '3-ne', chapter: 11, raw: '3 Nephi 11' });
    expect(parseReference('1 Corinthians 13:4')).toEqual({ level: 'verse', bookId: '1-cor', chapter: 13, verse: 4, raw: '1 Corinthians 13:4' });
  });

  it('handles D&C references (volume that is also a single book)', () => {
    expect(parseReference('dc')).toEqual({ level: 'volume', volumeId: 'dc', bookId: 'dc', raw: 'dc' });
  });

  it('falls back to unknown for unrecognized input', () => {
    expect(parseReference('something random')).toEqual({ level: 'unknown', raw: 'something random' });
  });

  it('trims whitespace', () => {
    expect(parseReference('  bom  ')).toEqual({ level: 'volume', volumeId: 'bom', raw: 'bom' });
  });

  it('handles multi-word book names', () => {
    expect(parseReference('words of mormon')).toEqual({ level: 'book', bookId: 'w-of-m', raw: 'words of mormon' });
    expect(parseReference('song of solomon')).toEqual({ level: 'book', bookId: 'song', raw: 'song of solomon' });
  });
});

describe('buildVerseId', () => {
  it('builds a verse ID from parts', () => {
    expect(buildVerseId('1-ne', 3, 7)).toBe('1-ne-3-7');
    expect(buildVerseId('john', 3, 16)).toBe('john-3-16');
  });
});

describe('constants', () => {
  it('exports VOLUME_ID_LIST', () => {
    expect(VOLUME_ID_LIST).toEqual(['ot', 'nt', 'bom', 'dc', 'pgp']);
  });

  it('exports RELATIONSHIP_TYPES — exhaustive, so silent drift fails loudly (CSC-2)', () => {
    expect([...RELATIONSHIP_TYPES].sort()).toEqual([
      'APPEARS_IN', 'CONTRASTS', 'COVERS', 'CROSS_REF', 'DEPICTS', 'EXTENDS',
      'FEATURES', 'HAS_JST', 'HAS_SUMMARY', 'HAS_SYMBOL', 'IN_BOOK',
      'IN_CHAPTER', 'IN_VOLUME', 'LOCATED_AT', 'MAPS_TO', 'MENTIONS',
      'PARALLELS', 'PARENT_OF', 'REFERENCES', 'SETTING_OF', 'SUMMARIZES',
      'TEACHES', 'TYPIFIES', 'USES_WORD',
    ]);
    expect(RELATIONSHIP_TYPES).toContain('TEACHES');
    expect(RELATIONSHIP_TYPES).toContain('CROSS_REF');
    expect(RELATIONSHIP_TYPES.length).toBeGreaterThan(5);
  });
});
