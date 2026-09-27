import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { fail, forbidUnlessSees, isDate, isUuid, requireApiUser } from '@/lib/api';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { isRestDay } from '@/lib/calendar';
import { prestartPdf, PrestartDocError } from '@/lib/prestart/document';

export const maxDuration = 300;
export const runtime = 'nodejs';

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const awst = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

/**
 * The week's prestarts in one PDF (README R109): a cover listing every day — who ran it, how many signed on, when it
 * was finished, which page it starts on, and the working days with none — then each finished prestart exactly as its
 * own PDF prints it (the stored copy, or rendered once and stored by the same builder). A prestart not finished is
 * named on the cover and left out: its PDF is the frozen record, and it has none yet.
 */
export async function GET(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project');
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  if (!isDate(start) || !isDate(end) || end < start) return fail('bad_request', 'start and end must be YYYY-MM-DD, start first.', 400);
  if ((Date.parse(end) - Date.parse(start)) / 86_400_000 > 31) return fail('bad_request', 'At most a month of prestarts in one PDF.', 400);
  for (const screen of ['weekly', 'prestart'] as const) {
    const forbidden = await forbidUnlessSees(supabase, user.id, projectId, screen);
    if (forbidden) return forbidden;
  }

  const { data: project } = await supabase.from('projects').select('name, code, org:organisations!inner(name, code)').eq('id', projectId).maybeSingle();
  if (!project) return fail('not_found', 'That project is not on your account.', 404);
  const org = (Array.isArray(project.org) ? project.org[0] : project.org) as { name: string; code: string };
  const { data: rows, error } = await supabase
    .from('prestarts')
    .select('id, prestart_date, supervisor_name, completed_at, prestart_attendees(count)')
    .eq('project_id', projectId).gte('prestart_date', start).lte('prestart_date', end)
    .order('prestart_date').order('created_at');
  if (error) return fail('server_error', error.message, 500);
  type Row = { id: string; prestart_date: string; supervisor_name: string | null; completed_at: string | null; prestart_attendees: Array<{ count: number }> };
  const list = (rows ?? []) as unknown as Row[];

  // Each finished prestart's own PDF, one at a time (Chromium is heavy; stored copies cost nothing).
  const docs: Array<{ row: Row; bytes: Uint8Array; pages: number }> = [];
  try {
    for (const r of list.filter((x) => x.completed_at)) {
      const doc = await prestartPdf(supabase, r.id);
      const pages = (await PDFDocument.load(doc.bytes, { updateMetadata: false })).getPageCount();
      docs.push({ row: r, bytes: doc.bytes, pages });
    }
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    if (err instanceof PrestartDocError) return fail('server_error', err.message, err.status);
    return fail('server_error', `Could not build the week's prestarts: ${err instanceof Error ? err.message : 'PDF rendering failed.'}`, 500);
  }

  // The cover: every day of the range, what happened, and where to turn to.
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  let page = 2;
  const startsAt = new Map<string, number>();
  for (const d of docs) { startsAt.set(d.row.id, page); page += d.pages; }
  const lines: string[] = [];
  for (const day of days) {
    const today = list.filter((r) => r.prestart_date === day);
    const dow = DAY[new Date(`${day}T00:00:00Z`).getUTCDay()];
    if (today.length === 0) {
      if (!isRestDay(day)) lines.push(`<tr><td>${dow} ${esc(dmy(day))}</td><td colspan="4" class="none">No prestart recorded</td></tr>`);
      continue;
    }
    for (const r of today) {
      const count = r.prestart_attendees?.[0]?.count ?? 0;
      lines.push(r.completed_at
        ? `<tr><td>${dow} ${esc(dmy(day))}</td><td>${esc(r.supervisor_name ?? '—')}</td><td class="n">${count}</td><td>${esc(awst(r.completed_at))} AWST</td><td class="n">${startsAt.get(r.id)}</td></tr>`
        : `<tr><td>${dow} ${esc(dmy(day))}</td><td>${esc(r.supervisor_name ?? '—')}</td><td class="n">${count}</td><td class="none">Not finished — not in this PDF</td><td></td></tr>`);
    }
  }
  const finished = docs.length;
  const signedOn = docs.reduce((n, d) => n + (d.row.prestart_attendees?.[0]?.count ?? 0), 0);
  const html = ['<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">', `<title>Prestarts ${esc(project.code)} ${esc(dmy(start))}</title>`,
    `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`,
    '<style>.pw table{font-size:9pt} .pw td.n,.pw th.n{text-align:right} .pw td.none{color:#8a5a00}</style>',
    '</head><body><div class="docket pw">',
    `<header class="head"><div class="head__left"><p class="lbl"><img class="brandmark" src="${LOGO_DATA_URI}" alt="" /> ${esc(org.name)}</p><h1>Prestarts</h1><p class="lbl">${esc(project.name)} · ${esc(dmy(start))} to ${esc(dmy(end))}</p></div>`,
    `<div class="head__right"><p class="lbl">${finished} prestart${finished === 1 ? '' : 's'}</p><p class="lbl">${signedOn} sign-on${signedOn === 1 ? '' : 's'}</p></div></header>`,
    '<section class="sect"><table><thead><tr><th>Day</th><th>Run by</th><th class="n">Signed on</th><th>Finished</th><th class="n">Page</th></tr></thead><tbody>',
    lines.join('') || '<tr><td colspan="5" class="none">No prestarts in this range.</td></tr>',
    '</tbody></table>',
    `<p class="src">Each prestart follows exactly as its own PDF prints it: the record as finished, with the crew's signatures. Working days with no prestart are listed; weekends only when one was run.</p>`,
    '</section></div></body></html>'].join('');

  try {
    const cover = await renderPdfDocument(html, {
      title: `Prestarts ${project.code} ${start} to ${end}`, author: org.name, subject: `${project.name} — prestarts, ${start} to ${end}`,
      keywords: [org.code, project.code, 'prestarts', start],
      instant: new Date(`${start}T00:00:00Z`),
      idSeed: createHash('sha256').update(`${projectId}${start}${end}${docs.map((d) => d.row.id).join('')}`).digest('hex'),
      footerLeft: `${org.code}_${project.code} · PRESTARTS · ${dmy(start)} to ${dmy(end)}`,
    });
    const merged = await PDFDocument.create();
    for (const source of [cover, ...docs.map((d) => d.bytes)]) {
      const doc = await PDFDocument.load(source, { updateMetadata: false });
      for (const p of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(p);
    }
    merged.setTitle(`Prestarts ${project.code} ${start} to ${end}`);
    merged.setAuthor(org.name);
    merged.setProducer('Kooboolong IMS');
    const bytes = await merged.save();
    return new Response(Buffer.from(bytes), { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${org.code}_${project.code}_prestarts_${start}.pdf"`, 'cache-control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not bind the prestarts: ${err instanceof Error ? err.message : 'PDF rendering failed.'}`, 500);
  }
}
