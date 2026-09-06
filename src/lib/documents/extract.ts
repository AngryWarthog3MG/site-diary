import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';
import { looksScanned, type PageText } from './chunk';

/**
 * Getting the words out of a document.
 *
 * Typed PDFs read straight through. Word files likewise. A scanned PDF — the
 * reader finds nothing on its pages — and any photo of a page go through the
 * model with the page in front of it, which is the same path the docket
 * photos use. The output is text per page, nothing interpreted: the model is
 * told to transcribe, not summarise, and every page is labelled so the
 * citation can name it.
 */

export type ExtractMethod = 'pdf-text' | 'docx' | 'vision' | 'plain';

export interface Extraction {
  pages: PageText[];
  method: ExtractMethod;
  pageCount: number | null;
  /** Why the typed read was not used, when a PDF fell back to the model. */
  note?: string;
}

export const OCR_MODEL = process.env.ANTHROPIC_OCR_MODEL ?? 'claude-sonnet-4-6';

/** Pages per model call for a scanned PDF. Enough to be cheap, few enough to be reliable. */
const VISION_PAGES_PER_CALL = 8;
const MAX_VISION_PAGES = 120;

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');
  cached ??= new Anthropic();
  return cached;
}

const TRANSCRIBE_PROMPT =
  'Transcribe this document exactly, page by page. Output plain text. Start each page with a line ' +
  'of the form "=== PAGE N ===" where N is the page number as printed in the header or footer if ' +
  'there is one, otherwise the sequence number of the page within this file. Keep tables as lines ' +
  'of text with cells separated by " | ". Do not summarise, do not omit, do not add anything that ' +
  'is not on the page. If a page is blank, write "(blank)".';

async function pdfTextPages(buffer: Buffer): Promise<{ pages: PageText[]; pageCount: number }> {
  // pdf.js, the legacy build that runs in Node without a worker or a canvas.
  // Text items carry their position; a jump in y is a line break, which is
  // what keeps a clause on its own line and a table row together.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false }).promise;
  const pages: PageText[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    let out = '';
    for (const item of content.items as Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform?.[5] ?? null;
      if (lastY != null && y != null && Math.abs(y - lastY) > 2) out += '\n';
      else if (out && !out.endsWith('\n') && !out.endsWith(' ') && !item.str.startsWith(' ')) out += ' ';
      out += item.str;
      if (item.hasEOL) out += '\n';
      lastY = y;
    }
    pages.push({ page: i, text: out });
  }
  await doc.destroy();
  return { pages, pageCount: doc.numPages };
}

function parseTranscript(text: string, offset: number): PageText[] {
  const parts = text.split(/^=== PAGE (\d+) ===\s*$/m);
  if (parts.length < 3) return [{ page: offset + 1, text }];
  const pages: PageText[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const body = (parts[i + 1] ?? '').trim();
    if (body && body !== '(blank)') pages.push({ page: offset + Math.ceil((i + 1) / 2), text: body });
  }
  return pages;
}

async function transcribePdfSlice(bytes: Uint8Array, offset: number): Promise<PageText[]> {
  const response = await client().messages.create({
    model: OCR_MODEL,
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') },
          },
          { type: 'text', text: TRANSCRIBE_PROMPT },
        ],
      },
    ],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return parseTranscript(text, offset);
}

async function pdfVisionPages(buffer: Buffer): Promise<{ pages: PageText[]; pageCount: number }> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const total = src.getPageCount();
  if (total > MAX_VISION_PAGES) {
    throw new Error(`This scanned document has ${total} pages; the limit for reading scans is ${MAX_VISION_PAGES}.`);
  }
  const pages: PageText[] = [];
  for (let start = 0; start < total; start += VISION_PAGES_PER_CALL) {
    const end = Math.min(total, start + VISION_PAGES_PER_CALL);
    const slice = await PDFDocument.create();
    const copied = await slice.copyPages(src, Array.from({ length: end - start }, (_, i) => start + i));
    for (const p of copied) slice.addPage(p);
    const bytes = await slice.save();
    pages.push(...(await transcribePdfSlice(bytes, start)));
  }
  return { pages, pageCount: total };
}

async function imagePage(buffer: Buffer, mime: 'image/jpeg' | 'image/png' | 'image/webp'): Promise<PageText[]> {
  const response = await client().messages.create({
    model: OCR_MODEL,
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: buffer.toString('base64') } },
          { type: 'text', text: TRANSCRIBE_PROMPT },
        ],
      },
    ],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return parseTranscript(text, 0);
}

export async function extractText(buffer: Buffer, mime: string): Promise<Extraction> {
  if (mime === 'application/pdf') {
    let typed: { pages: PageText[]; pageCount: number } | null = null;
    let note: string | undefined;
    try {
      typed = await pdfTextPages(buffer);
    } catch (error) {
      typed = null;
      note = `Typed read failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (typed && !looksScanned(typed.pages)) {
      return { pages: typed.pages, method: 'pdf-text', pageCount: typed.pageCount };
    }
    if (typed) note = 'Pages carried almost no text; read as a scan.';
    const seen = await pdfVisionPages(buffer);
    return { pages: seen.pages, method: 'vision', pageCount: seen.pageCount, note };
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer });
    return { pages: [{ page: null, text: value }], method: 'docx', pageCount: null };
  }
  if (mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp') {
    return { pages: await imagePage(buffer, mime), method: 'vision', pageCount: 1 };
  }
  if (mime === 'text/plain') {
    return { pages: [{ page: null, text: buffer.toString('utf8') }], method: 'plain', pageCount: null };
  }
  throw new Error(`Cannot read ${mime}. Upload a PDF, Word document, photo or text file.`);
}
