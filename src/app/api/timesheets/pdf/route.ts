import { createHash } from 'node:crypto';
import { fail, forbidUnlessSees, requireApiUser, isUuid } from '@/lib/api';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { perthToday } from '@/lib/push/decide';
import { loadTimesheet } from '@/lib/timesheets/load';
import { DAY_LABELS, dm, dmy, fmtHours, readWeek } from '@/lib/timesheets/model';

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

  const cell = (h: number | null, ot: number) => `${fmtHours(h)}${ot ? ` +${fmtHours(ot)}` : ''}`;
  const html = ['<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">', `<title>Timesheet — week of ${esc(dmy(monday))}</title>`,
    `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`,
    '<style>.ts table{font-size:8.5pt} .ts td.n,.ts th.n{text-align:right;white-space:nowrap} .ts .sub{display:block;font-size:6.5pt;color:#666} .ts td.u{color:#8a5a00} .ts td.x{color:#9a2b2b;font-weight:700} .ts tfoot td{font-weight:700;border-top:1.5px solid #000} .ts td.name{font-weight:600}</style>',
    '</head><body><div class="docket ts">',
    `<header class="head"><div class="head__left"><p class="lbl"><img class="brandmark" src="${LOGO_DATA_URI}" alt="" /> ${esc(org.name)}</p><h1>Timesheet</h1><p class="lbl">Week of ${esc(dmy(monday))} to ${esc(dmy(sheet.to))} · all jobs</p></div>`,
    `<div class="head__right"><p class="lbl">${sheet.people.length} ${sheet.people.length === 1 ? 'person' : 'people'} · ${sheet.jobs.length} ${sheet.jobs.length === 1 ? 'job' : 'jobs'}</p><p class="lbl">${esc(fmtHours(sheet.total))} h${sheet.overtime ? ` + ${esc(fmtHours(sheet.overtime))} h overtime` : ''}</p></div></header>`,
    '<section class="sect">',
    sheet.people.length === 0 ? `<p class="src">No labour recorded in any diary for this week.</p>` : [
      '<table><thead><tr><th>Person</th>',
      ...sheet.days.map((d, i) => `<th class="n">${DAY_LABELS[i]}<span class="sub">${esc(dm(d))}</span></th>`),
      '<th class="n">Total</th><th>Jobs</th></tr></thead><tbody>',
      ...sheet.people.map((p) => {
        const multi = Object.keys(p.byJob).length > 1;
        return `<tr><td class="name">${esc(p.name)}${p.roles.length ? `<span class="sub">${esc(p.roles.join(' / '))}</span>` : ''}${p.aka.length ? `<span class="sub">also written ${esc(p.aka.join(', '))}</span>` : ''}</td>` +
          sheet.days.map((d) => {
            const c = p.days[d];
            if (!c) return '<td class="n">·</td>';
            return `<td class="n${c.unsigned ? ' u' : ''}${c.clash ? ' x' : ''}">${esc(cell(c.hours, c.overtime))}${multi ? `<span class="sub">${esc(c.jobs.join(' + '))}</span>` : ''}${c.unsigned ? '<span class="sub">not signed</span>' : ''}${c.clash ? '<span class="sub">two jobs at once</span>' : ''}</td>`;
          }).join('') +
          `<td class="n"><b>${esc(fmtHours(p.total))}</b>${p.overtime ? `<span class="sub">+${esc(fmtHours(p.overtime))} OT</span>` : ''}</td>` +
          `<td>${esc(Object.entries(p.byJob).map(([code, h]) => `${code} ${fmtHours(h)}`).join(' · ') || '—')}</td></tr>`;
      }),
      '</tbody><tfoot><tr><td>All</td>',
      ...sheet.days.map((d) => `<td class="n">${sheet.dayTotals[d] ? esc(fmtHours(sheet.dayTotals[d])) : '·'}</td>`),
      `<td class="n">${esc(fmtHours(sheet.total))}</td><td>${esc(sheet.jobs.map((j) => `${j.code} ${fmtHours(j.hours)}`).join(' · '))}</td></tr></tfoot></table>`,
      `<p class="src">Hours as the diaries recorded them; — is a row with no hours recorded, never 0. A day not signed yet is marked in amber and stands as recorded so far.${sheet.clashes ? ` ${sheet.clashes} day${sheet.clashes === 1 ? '' : 's'} in red have someone on two jobs at the same time — check both diaries before paying.` : ''} Names the office has combined are added up as one person.${pendingCorrections ? ` ${pendingCorrections} correction${pendingCorrections === 1 ? '' : 's'} not signed yet — the original counts until it is.` : ''}</p>`,
      ...sheet.jobs.map((j) => `<p class="src"><b>${esc(j.code)}</b> ${esc(j.name)} — ${esc(fmtHours(j.hours))} h, ${j.people} ${j.people === 1 ? 'person' : 'people'}</p>`),
    ].join(''),
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
