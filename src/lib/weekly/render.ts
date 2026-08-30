import { createHash } from 'node:crypto';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { renderPdfDocument } from '@/lib/pdf/render';
import { WeeklyReport, WEEKLY_CSS, type WeeklyReportProps } from './report';
import type { WeeklyData } from './load';

/** The weekly report as a standalone HTML document — same skeleton as the docket. */
export async function buildWeeklyHtml(props: WeeklyReportProps): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const markup = renderToStaticMarkup(WeeklyReport(props));
  return [
    '<!doctype html>',
    '<html lang="en-AU"><head><meta charset="utf-8">',
    `<title>Weekly report ${props.data.start} to ${props.data.end}</title>`,
    `<style>${EMBEDDED_FONT_CSS}</style>`,
    `<style>${DOCKET_CSS}</style>`,
    `<style>${WEEKLY_CSS}</style>`,
    '</head><body>',
    markup,
    '</body></html>',
  ].join('');
}

/**
 * The metadata instant for a weekly report: the latest signing in the range.
 * Data-derived like the daily docket's — the PDF says when the record was
 * completed, not when this copy was printed.
 */
export function weeklyInstant(data: WeeklyData): Date {
  const latest = data.entries
    .map((e) => (e.signed_at ? Date.parse(e.signed_at) : Number.NaN))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  if (latest != null) return new Date(latest);
  const end = Date.parse(`${data.end}T00:00:00Z`);
  return new Date(Number.isFinite(end) ? end : 0);
}

export async function renderWeeklyPdf(props: WeeklyReportProps): Promise<Uint8Array> {
  const html = await buildWeeklyHtml(props);
  const { data } = props;
  return renderPdfDocument(html, {
    title: `Weekly report ${data.project.code} ${data.start} to ${data.end}`,
    author: data.project.name,
    subject: `${data.project.name} — weekly site report ${data.start} to ${data.end}`,
    keywords: [data.project.orgCode, data.project.code, data.start, data.end],
    instant: weeklyInstant(data),
    // The weekly artifact has no single content hash; hash what it renders so
    // an unchanged report keeps its identifier.
    idSeed: createHash('sha256').update(html).digest('hex'),
    footerLeft: `${data.project.orgCode}_${data.project.code} · WEEKLY · ${data.start} to ${data.end}`,
  });
}
