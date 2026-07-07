/**
 * OSIS ↔ Lumen slug mapping for the OpenBible cross-reference ingest.
 * Pure functions only — the ingest trusts these, so they carry the exhaustive
 * harness (osis-map.test.ts). OSIS refs look like `Gen.1.1`; ranges arrive as
 * two refs (`Ps.148.4`, `Ps.148.5`).
 *
 * Traps encoded here (verified against live book ids at plan time):
 * `Phil`→`philip` (NOT `philem`), `Phlm`→`philem`, `Hos`→`hosea`,
 * `Exod`→`ex`, `1John`→`1-jn`.
 */

export const OSIS_TO_SLUG: Record<string, string> = {
  // OT
  Gen: 'gen', Exod: 'ex', Lev: 'lev', Num: 'num', Deut: 'deut',
  Josh: 'josh', Judg: 'judg', Ruth: 'ruth',
  '1Sam': '1-sam', '2Sam': '2-sam', '1Kgs': '1-kgs', '2Kgs': '2-kgs',
  '1Chr': '1-chr', '2Chr': '2-chr', Ezra: 'ezra', Neh: 'neh', Esth: 'esth',
  Job: 'job', Ps: 'ps', Prov: 'prov', Eccl: 'eccl', Song: 'song',
  Isa: 'isa', Jer: 'jer', Lam: 'lam', Ezek: 'ezek', Dan: 'dan',
  Hos: 'hosea', Joel: 'joel', Amos: 'amos', Obad: 'obad', Jonah: 'jonah',
  Mic: 'micah', Nah: 'nahum', Hab: 'hab', Zeph: 'zeph', Hag: 'hag',
  Zech: 'zech', Mal: 'mal',
  // NT
  Matt: 'matt', Mark: 'mark', Luke: 'luke', John: 'john', Acts: 'acts',
  Rom: 'rom', '1Cor': '1-cor', '2Cor': '2-cor', Gal: 'gal', Eph: 'eph',
  Phil: 'philip', Col: 'col', '1Thess': '1-thes', '2Thess': '2-thes',
  '1Tim': '1-tim', '2Tim': '2-tim', Titus: 'titus', Phlm: 'philem',
  Heb: 'heb', Jas: 'james', '1Pet': '1-pet', '2Pet': '2-pet',
  '1John': '1-jn', '2John': '2-jn', '3John': '3-jn', Jude: 'jude', Rev: 'rev',
};

/** The 66 Bible book ids — the volumes OpenBible covers. Everything else
 * (BoM/D&C/PGP) falls back to the curated collection in the reader. */
export const BIBLE_BOOK_IDS: ReadonlySet<string> = new Set(Object.values(OSIS_TO_SLUG));

const REF_RE = /^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$/;

/** `Gen.1.1` → `gen-1-1`; null for unknown codes or malformed refs. */
export function parseOsisRef(ref: string): string | null {
  const m = REF_RE.exec(ref);
  if (!m) return null;
  const slug = OSIS_TO_SLUG[m[1]];
  if (!slug) return null;
  return `${slug}-${Number(m[2])}-${Number(m[3])}`;
}

/**
 * Expand an inclusive OSIS range into per-verse ids.
 * - `verseCount(chapterId)` → verse count of that chapter, or null if unknown.
 * - `nextChapter(chapterId)` → the following chapter id in canonical order
 *   (crossing book boundaries), or null at the end of the canon. Optional:
 *   without it, same-book ranges still work by numeric chapter increment; the
 *   18 cross-BOOK ranges in the source (e.g. `Lev.27.34-Num.1.1`, COR-4)
 *   require it.
 * Returns null (never throws) for unknown refs/chapters, inverted ranges, or
 * runaway walks (> 200 chapters).
 */
export function expandOsisRange(
  startRef: string,
  endRef: string,
  verseCount: (chapterId: string) => number | null,
  nextChapter?: (chapterId: string) => string | null,
): string[] | null {
  const start = splitRef(startRef);
  const end = splitRef(endRef);
  if (!start || !end) return null;

  const ids: string[] = [];
  let { book, chapter } = start;
  let verse = start.verse;
  for (let hops = 0; hops <= 200; hops++) {
    const chapterId = `${book}-${chapter}`;
    const count = verseCount(chapterId);
    if (count === null) return null;
    const atEndChapter = book === end.book && chapter === end.chapter;
    const last = atEndChapter ? end.verse : count;
    if (last < verse || last > count) return null; // inverted or out-of-chapter
    for (let v = verse; v <= last; v++) ids.push(`${book}-${chapter}-${v}`);
    if (atEndChapter) return ids;

    const next = nextChapter
      ? nextChapter(chapterId)
      : `${book}-${chapter + 1}`;
    if (!next) return null;
    const parts = next.match(/^(.*)-(\d+)$/);
    if (!parts) return null;
    book = parts[1];
    chapter = Number(parts[2]);
    verse = 1;
  }
  return null;
}

function splitRef(ref: string) {
  const m = REF_RE.exec(ref);
  if (!m) return null;
  const book = OSIS_TO_SLUG[m[1]];
  if (!book) return null;
  return { book, chapter: Number(m[2]), verse: Number(m[3]) };
}
