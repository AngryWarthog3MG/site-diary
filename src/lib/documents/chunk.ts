/**
 * Turning a document's pages into search chunks. Pure and unit tested.
 *
 * A chunk is what the search returns and what the answering model reads, so
 * it has to be small enough that twelve of them fit in a prompt and large
 * enough that a clause is not cut mid-sentence. Overlap carries the sentence
 * that straddles a boundary into both neighbours.
 */

export interface PageText {
  page: number | null;
  text: string;
}

export interface Chunk {
  page: number | null;
  seq: number;
  text: string;
}

const TARGET = 1400;
const OVERLAP = 200;

/** Collapse the noise a PDF reader leaves: runs of spaces, stray hyphenation, blank lines. */
export function tidy(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/-\n(?=[a-z])/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function chunkPages(pages: readonly PageText[]): Chunk[] {
  const out: Chunk[] = [];
  let seq = 0;
  for (const page of pages) {
    const text = tidy(page.text);
    if (!text) continue;
    if (text.length <= TARGET) {
      out.push({ page: page.page, seq: seq++, text });
      continue;
    }
    let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + TARGET);
      if (end < text.length) {
        // Prefer to break at a paragraph, then a sentence, then a space.
        const window = text.slice(start, end);
        const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'));
        if (cut > TARGET * 0.5) end = start + cut + 1;
        else {
          const space = window.lastIndexOf(' ');
          if (space > TARGET * 0.5) end = start + space;
        }
      }
      const piece = text.slice(start, end).trim();
      if (piece) out.push({ page: page.page, seq: seq++, text: piece });
      if (end >= text.length) break;
      start = Math.max(end - OVERLAP, start + 1);
    }
  }
  return out;
}

/** A document whose reader found almost nothing per page was probably scanned. */
export function looksScanned(pages: readonly PageText[]): boolean {
  if (pages.length === 0) return true;
  const chars = pages.reduce((n, p) => n + tidy(p.text).length, 0);
  return chars / pages.length < 80;
}
