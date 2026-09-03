import { PDFDocument } from 'pdf-lib';
import type { Browser } from 'playwright-core';
import { DailyDocket, type PhotoImage } from './docket';
import type { SignatureImage } from './photos';
import { DOCKET_CSS } from './styles';
import { EMBEDDED_FONT_CSS } from './fonts';
import { LOGO_DATA_URI } from './logo';
import type { DocketEntry } from './load';

/**
 * Rendering the daily PDF.
 *
 * Chromium via Playwright over an HTML template, as §2 requires — not a
 * JavaScript PDF builder, and the same template the screen uses.
 *
 * §2.3 asks for something harder than it sounds: regenerating the same entry a
 * year later must produce a byte-identical document. Three things stand in the
 * way, and each is dealt with here:
 *
 *   1. Fonts fetched over the network. Embedded as base64 instead, so the
 *      render touches nothing outside this process.
 *   2. Timestamps. Chromium stamps CreationDate and ModDate with the wall
 *      clock, so two renders of the same entry differ in bytes within seconds.
 *      Both are rewritten to an instant derived from the entry itself.
 *   3. The document /ID, which Chromium derives from those timestamps.
 *      Rewritten from the content hash for the same reason.
 *
 * What remains outside our control is the Chromium build: a different version
 * may lay text out differently. That is a real limit on the guarantee and is
 * documented rather than papered over — pin the Playwright version alongside
 * the archive if the documents must match forever.
 */

export interface RenderInput {
  entry: DocketEntry;
  photos: PhotoImage[];
  signatures?: SignatureImage[];
}

/**
 * Imported at call time, not at module scope: Next refuses a static
 * `react-dom/server` import anywhere in a route's graph, and this only ever
 * runs on the server anyway.
 */
export async function buildDocketHtml({ entry, photos, signatures }: RenderInput): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const markup = renderToStaticMarkup(DailyDocket({ entry, photos, signatures: signatures ?? [] }));
  return [
    '<!doctype html>',
    '<html lang="en-AU"><head><meta charset="utf-8">',
    `<title>${entry.entry_no ?? 'Daily diary'}</title>`,
    `<style>${EMBEDDED_FONT_CSS}</style>`,
    `<style>${DOCKET_CSS}</style>`,
    '</head><body>',
    markup,
    '</body></html>',
  ].join('');
}

/**
 * A fixed instant for the document's metadata.
 *
 * Derived from the entry, never from the clock: a signed entry uses its own
 * signing time, so the PDF says when the record was made rather than when this
 * particular copy of it was printed.
 */
function metadataInstant(entry: DocketEntry): Date {
  const signed = entry.signed_at ? Date.parse(entry.signed_at) : Number.NaN;
  if (Number.isFinite(signed)) return new Date(signed);
  // An unsigned draft has no such moment. Anchor to its date at midnight UTC.
  const date = Date.parse(`${entry.entry_date}T00:00:00Z`);
  return new Date(Number.isFinite(date) ? date : 0);
}

/** Thrown when the host has no browser to render with, as distinct from a render that failed. */
export class BrowserUnavailableError extends Error {
  constructor(cause: string) {
    super(
      'No browser is available to render PDFs on this host. ' +
        'A stock serverless function cannot hold Chromium; generation needs ' +
        '@sparticuz/chromium with playwright-core, or a container. ' +
        `(${cause})`,
    );
    this.name = 'BrowserUnavailableError';
  }
}

let shared: Browser | null = null;

/**
 * Launch a browser, wherever this happens to be running.
 *
 * A serverless function cannot hold a normal Chromium install — the whole
 * bundle has to fit in a couple of hundred megabytes — so on Vercel this uses
 * @sparticuz/chromium, a build packed for exactly that, driven through
 * playwright-core. Locally it uses the full Playwright install, which is also
 * what the determinism check runs against.
 *
 * Worth knowing: those are two different Chromium builds, so a PDF rendered on
 * a laptop and the same entry rendered in production are not byte-identical to
 * each other. §2.3 asks that regenerating an entry reproduces its document,
 * and that still holds — generation only ever happens in production, against
 * one pinned build. The local path exists for the test, not for the record.
 */
async function launch(): Promise<Browser> {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const [{ default: packed }, { chromium }] = await Promise.all([
      import('@sparticuz/chromium'),
      import('playwright-core'),
    ]);
    return chromium.launch({
      args: [...packed.args, '--font-render-hinting=none'],
      executablePath: await packed.executablePath(),
      headless: true,
    });
  }

  const { chromium } = await import('playwright');
  return chromium.launch({ args: ['--font-render-hinting=none'] });
}

async function browser(): Promise<Browser> {
  if (shared?.isConnected()) return shared;
  try {
    shared = await launch();
  } catch (error) {
    throw new BrowserUnavailableError(error instanceof Error ? error.message : String(error));
  }
  return shared;
}

export async function closeBrowser(): Promise<void> {
  await shared?.close();
  shared = null;
}

/**
 * Everything the generic renderer needs to know about a document, so the
 * weekly report can share the exact pipeline the daily docket proved out —
 * embedded fonts, footer, metadata pinned to a data-derived instant, /ID
 * derived from content rather than the clock.
 */
export interface DocumentMeta {
  title: string;
  author: string;
  subject: string;
  keywords: string[];
  /** Data-derived, never the wall clock. */
  instant: Date;
  /** Hex-ish seed for the trailer /ID; same record, same identifier. */
  idSeed: string;
  footerLeft: string;
}

export async function renderPdfDocument(html: string, meta: DocumentMeta): Promise<Uint8Array> {
  const page = await (await browser()).newPage();

  try {
    await page.setContent(html, { waitUntil: 'load' });
    // Everything is embedded, so this resolves immediately — but laying out
    // before the faces are ready would silently produce a fallback-font PDF.
    await page.evaluate(() => document.fonts.ready);

    const raw = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '14mm', right: '14mm', bottom: '16mm', left: '14mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: footer(meta.footerLeft),
      tagged: false,
    });

    return normalise(raw, meta);
  } finally {
    await page.close();
  }
}

export async function renderDailyPdf(input: RenderInput): Promise<Uint8Array> {
  const { entry } = input;
  const html = await buildDocketHtml(input);
  return renderPdfDocument(html, {
    title: entry.entry_no ?? `Daily diary ${entry.entry_date}`,
    author: entry.author_name,
    subject: `${entry.project_name} — daily site diary ${entry.entry_date}`,
    keywords: [entry.org_code, entry.project_code, entry.entry_date],
    instant: metadataInstant(entry),
    idSeed: entry.content_hash ?? `${entry.id}:${entry.entry_date}`,
    footerLeft: `${entry.org_code}_${entry.project_code} · ${entry.entry_no ?? 'DRAFT'} · ${entry.entry_date}`,
  });
}

/**
 * The running footer, on every page of every document this pipeline makes.
 *
 * The mark belongs here rather than only in the page-1 header because pages
 * get separated: a claim bundle lifts the photograph sheet out, a solicitor
 * scans page 3 alone, and an unbranded sheet has nothing on it saying whose
 * record it is. Every page now carries the frog, the document reference and
 * its place in the document.
 */
function footer(left: string): string {
  return (
    `<div style="width:100%;padding:0 14mm;font-family:sans-serif;font-size:7pt;` +
    `color:#5A6469;display:flex;align-items:center;justify-content:space-between;">` +
    `<span style="display:flex;align-items:center;gap:1.5mm;">` +
    `<img src="${LOGO_DATA_URI}" style="height:4mm;width:auto;display:block;">` +
    `<span>${escapeHtml(left)}</span>` +
    `</span>` +
    `<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>` +
    `</div>`
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/**
 * Strip the wall clock out of the document.
 *
 * Chromium writes CreationDate, ModDate and a /ID derived from them. Left
 * alone, two renders of an unchanged entry differ — which would make the §10
 * byte-identical test fail for reasons that have nothing to do with the record.
 */
async function normalise(raw: Uint8Array, meta: DocumentMeta): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(raw, { updateMetadata: false });

  pdf.setTitle(meta.title);
  pdf.setAuthor(meta.author);
  pdf.setSubject(meta.subject);
  pdf.setKeywords(meta.keywords);
  pdf.setProducer('Site Diary');
  pdf.setCreator('Site Diary');
  pdf.setCreationDate(meta.instant);
  pdf.setModificationDate(meta.instant);

  const bytes = await pdf.save({ useObjectStreams: false });
  return withFixedId(bytes, meta.idSeed);
}

/**
 * Replace the trailer's /ID with one derived from the record.
 *
 * pdf-lib carries through whatever /ID it was given, and Chromium's is a
 * function of the clock. The content hash is the natural replacement: same
 * record, same identifier.
 */
export function withFixedId(bytes: Uint8Array, idSeed: string): Uint8Array {
  const seed = idSeed
    .replace(/[^0-9a-f]/gi, '')
    .padEnd(32, '0')
    .slice(0, 32)
    .toUpperCase();

  const text = Buffer.from(bytes).toString('latin1');
  const replaced = text.replace(
    /\/ID\s*\[\s*<[^>]*>\s*<[^>]*>\s*\]/g,
    `/ID [ <${seed}> <${seed}> ]`,
  );

  return replaced === text ? bytes : new Uint8Array(Buffer.from(replaced, 'latin1'));
}
