import { createHash } from 'node:crypto';
import { fail, forbidUnlessSees, requireApiUser, isUuid } from '@/lib/api';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { perthToday } from '@/lib/push/decide';
import { loadTimesheet } from '@/lib/timesheets/load';
import { timesheetTableHtml, TIMESHEET_PDF_CSS } from '@/lib/timesheets/html';
import { dmy, fmtHours, readWeek } from '@/lib/timesheets/model';

export const maxDuration = 300;
export const runtime = 'nodejs';
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The week's company timesheet as a PDF (README R103): every job the caller is on,
 * one row per person. Rendered from the same loader as the screen; returned
 * directly, nothing stored. The instant is the week's Monday, so the same week
 * from the same diaries renders the same bytes.
 */
export async function GET(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  const forbidden = await forbidUnlessSees(supabase, user.id, projectId, 'timesheets');
  if (forbidden) return forbidden;
  const { data: project } = await supabase.from('projects').select('id, code, org:organisations!inner(id, name, code)').eq('id', projectId).maybeSingle();
  if (!project) return fail('not_found', 'That project is not on your account.', 404);
  const org = (Array.isArray(project.org) ? project.org[0] : project.org) as { id: string; name: string; code: string };
  const monday = readWeek(url.searchParams.get('week') ?? undefined, perthToday());
  const { sheet, pendingCorrections } = await loadTimesheet(supabase, monday);

  const html = ['<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">', `<title>Timesheet — week of ${esc(dmy(monday))}</title>`,
    `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`,
    `<style>${TIMESHEET_PDF_CSS}</style>`,
    '</head><body><div class="docket ts">',
    `<header class="head"><div class="head__left"><p class="lbl"><img class="brandmark" src="${LOGO_DATA_URI}" alt="" /> ${esc(org.name)}</p><h1>Timesheet</h1><p class="lbl">Week of ${esc(dmy(monday))} to ${esc(dmy(sheet.to))} · all jobs</p></div>`,
    `<div class="head__right"><p class="lbl">${sheet.people.length} ${sheet.people.length === 1 ? 'person' : 'people'} · ${sheet.jobs.length} ${sheet.jobs.length === 1 ? 'job' : 'jobs'}</p><p class="lbl">${esc(fmtHours(sheet.total))} h${sheet.overtime ? ` + ${esc(fmtHours(sheet.overtime))} h overtime` : ''}</p></div></header>`,
    '<section class="sect">',
    timesheetTableHtml(sheet, pendingCorrections),
    '</section></div></body></html>'].join('');

  try {
    const pdf = await renderPdfDocument(html, {
      title: `Timesheet — week of ${dmy(monday)}`, author: org.name, subject: `${org.name} — timesheet, week of ${monday}`, keywords: [org.code, 'timesheet', monday],
      instant: new Date(`${monday}T00:00:00Z`), idSeed: createHash('sha256').update(html).digest('hex'), footerLeft: `${org.code} · TIMESHEET · week of ${dmy(monday)}`,
    });
    return new Response(Buffer.from(pdf), { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${org.code}_timesheet_${monday}.pdf"`, 'cache-control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not render the timesheet: ${err instanceof Error ? err.message : 'PDF rendering failed.'}`, 500);
  }
}
