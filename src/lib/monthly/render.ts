import { PDFDocument } from 'pdf-lib';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { renderPdfDocument, withFixedId } from '@/lib/pdf/render';
import { MonthlyCover, COVER_CSS, monthTitle } from './cover';
import type { MonthData } from './bundle';

/** Cover page HTML — same skeleton and dress as every other document here. */
async function buildCoverHtml(data: MonthData): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const markup = renderToStaticMarkup(MonthlyCover({ data }));
  return [
    '<!doctype html>',
    '<html lang="en-AU"><head><meta charset="utf-8">',
    `<title>Monthly bundle ${data.month}</title>`,
    `<style>${EMBEDDED_FONT_CSS}</style>`,
    `<style>${DOCKET_CSS}</style>`,
    `<style>${COVER_CSS}</style>`,
    '</head><body>',
    markup,
    '</body></html>',
  ].join('');
}

/** The archive's instant: the last signing it contains. Data-derived, as always. */
function bundleInstant(data: MonthData): Date {
  const latest = data.entries
    .map((e) => (e.signed_at ? Date.parse(e.signed_at) : Number.NaN))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  return new Date(latest ?? Date.parse(`${data.end}T00:00:00Z`));
}

/**
 * Cover first, then each daily docket in date order, as one document.
 *
 * The daily PDFs come in as bytes — already-rendered, byte-stable artifacts —
 * and are merged unchanged. The bundle's own /ID derives from the entries'
 * content hashes: same signed month, same identifier.
 */
export async function renderMonthlyBundle(
  data: MonthData,
  dailyPdfs: Uint8Array[],
): Promise<Uint8Array> {
  const cover = await renderPdfDocument(await buildCoverHtml(data), {
    title: `Monthly bundle ${data.project.code} ${data.month}`,
    author: data.project.name,
    subject: `${data.project.name} — site diary, ${monthTitle(data.month)}`,
    keywords: [data.project.orgCode, data.project.code, data.month],
    instant: bundleInstant(data),
    idSeed: data.entries.map((e) => e.content_hash ?? e.id).join(''),
    footerLeft: `${data.project.orgCode}_${data.project.code} · MONTHLY BUNDLE · ${data.month}`,
  });

  const merged = await PDFDocument.create();
  for (const source of [cover, ...dailyPdfs]) {
    const doc = await PDFDocument.load(source, { updateMetadata: false });
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }

  const at = bundleInstant(data);
  merged.setTitle(`Monthly bundle ${data.project.code} ${data.month}`);
  merged.setAuthor(data.project.name);
  merged.setSubject(`${data.project.name} — site diary, ${monthTitle(data.month)}`);
  merged.setKeywords([data.project.orgCode, data.project.code, data.month]);
  merged.setProducer('Site Diary');
  merged.setCreator('Site Diary');
  merged.setCreationDate(at);
  merged.setModificationDate(at);

  const bytes = await merged.save({ useObjectStreams: false });
  return withFixedId(bytes, data.entries.map((e) => e.content_hash ?? e.id).join(''));
}
