import { createHash } from 'node:crypto';
import { fail, forbidUnlessSees, requireApiUser, isUuid } from '@/lib/api';
import type { Membership } from '@/lib/auth';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { perthToday } from '@/lib/push/decide';
import { addDays, dmy, fmtHours, readWeek } from '@/lib/timesheets/model';
import { loadCompanyWeek } from '@/lib/weekly/company-load';
import { loadTimesheet } from '@/lib/timesheets/load';
import { timesheetTableHtml, TIMESHEET_PDF_CSS } from '@/lib/timesheets/html';

export const maxDuration = 300;
export const runtime = 'nodejs';
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v: number) => (v ? fmtHours(v) : '·');

/**
 * The company's weekly report as a PDF (README R108): the same loader as the screen, every job the caller may open
 * the weekly on. Returned directly; nothing stored. The instant is the week's Monday, so the same week from the same
 * diaries prints the same bytes.
 */
export async function GET(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  const forbidden = await forbidUnlessSees(supabase, user.id, projectId, 'company_weekly');
  if (forbidden) return forbidden;

  const { data: rows, error } = await supabase
    .from('project_members')
    .select('project_id, role, screens, finance, project:projects!inner(id, name, code, active, next_entry_seq, org:organisations!inner(id, name, code))')
    .eq('user_id', user.id);
  if (error) return fail('server_error', error.message, 500);
  const memberships = (rows ?? []) as unknown as Membership[];
  const here = memberships.find((m) => m.project_id === projectId);
  if (!here) return fail('not_found', 'That project is not on your account.', 404);
  const org = here.project.org;
  const start = readWeek(url.searchParams.get('week') ?? undefined, perthToday());
  const end = addDays(start, 6);
  const ours = memberships.filter((m) => m.project.org.id === org.id);
  const data = await loadCompanyWeek(supabase, ours, start, end);
  const pay = await loadTimesheet(supabase, start, { projectIds: ours.filter((m) => m.project.active).map((m) => m.project_id) });
  const t = data.totals;

  const html = ['<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">', `<title>Weekly report, all jobs — ${esc(dmy(start))}</title>`,
    `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`,
    `<style>${TIMESHEET_PDF_CSS}</style>`,
    '<style>.cw table{font-size:8.5pt} .cw td.n,.cw th.n{text-align:right;white-space:nowrap} .cw .sub{display:block;font-size:6.5pt;color:#666} .cw tfoot td{font-weight:700;border-top:1.5px solid #000} .cw .warn{color:#8a5a00} .cw h2{font-size:11pt;margin:5mm 0 1mm} .cw ul{margin:0 0 2mm;padding-left:5mm} .cw li{font-size:8.5pt}</style>',
    '</head><body><div class="docket cw">',
    `<header class="head"><div class="head__left"><p class="lbl"><img class="brandmark" src="${LOGO_DATA_URI}" alt="" /> ${esc(org.name)}</p><h1>Weekly report — all jobs</h1><p class="lbl">${esc(dmy(start))} to ${esc(dmy(end))}</p></div>`,
    `<div class="head__right"><p class="lbl">${t.jobs} job${t.jobs === 1 ? '' : 's'} · ${t.people} people</p><p class="lbl">${esc(fmtHours(t.labourHours))} h labour</p></div></header>`,
    '<section class="sect"><table><thead><tr><th>Job</th><th class="n">Diaries</th><th class="n">Labour h</th><th class="n">People</th><th class="n">Plant h</th><th class="n">Concrete m³</th><th class="n">Delays h</th><th class="n">Variations</th><th class="n">Dayworks h</th><th class="n">Rain mm</th></tr></thead><tbody>',
    ...data.jobs.map((j) => `<tr><td><b>${esc(j.code)}</b><span class="sub">${esc(j.name)}</span></td>` +
      `<td class="n${j.workingDaysRecorded < j.workingDays ? ' warn' : ''}">${j.notStarted ? 'not started' : `${j.workingDaysRecorded}/${j.workingDays}`}${j.restDaysWorked ? ` +${j.restDaysWorked}` : ''}${j.unsignedDays.length ? `<span class="sub">${j.unsignedDays.length} not signed</span>` : ''}</td>` +
      `<td class="n">${esc(n(j.labourHours))}${j.overtimeHours ? `<span class="sub">${esc(fmtHours(j.overtimeHours))} OT</span>` : ''}</td>` +
      `<td class="n">${j.people.length || '·'}</td><td class="n">${esc(n(j.plantHours))}</td><td class="n">${esc(n(j.concreteM3))}</td>` +
      `<td class="n">${esc(n(j.delayHours))}${j.topDelay ? `<span class="sub">${esc(j.topDelay)}</span>` : ''}</td>` +
      `<td class="n">${j.variations || '·'}${j.variationsUnnumbered ? `<span class="sub warn">${j.variationsUnnumbered} no number</span>` : ''}</td>` +
      `<td class="n">${esc(n(j.dayworkHours))}${j.dayworksWithoutDocket ? `<span class="sub warn">${j.dayworksWithoutDocket} no docket</span>` : ''}</td>` +
      `<td class="n">${esc(n(j.rainMm))}</td></tr>`),
    `</tbody><tfoot><tr><td>All ${t.jobs}</td><td class="n">${t.workingDaysMissing ? `${t.workingDaysMissing} missing` : 'all in'}</td><td class="n">${esc(n(t.labourHours))}</td><td class="n">${t.people || '·'}</td><td class="n">${esc(n(t.plantHours))}</td><td class="n">${esc(n(t.concreteM3))}</td><td class="n">${esc(n(t.delayHours))}</td><td class="n">${t.variations || '·'}</td><td class="n">${esc(n(t.dayworkHours))}</td><td></td></tr></tfoot></table>`,
    `<p class="src">Each figure is the job's own weekly report, added up; days not signed yet are included and counted. People counts one person on two jobs once.</p>`,
    '<h2>Needs attention</h2>',
    data.attention.length ? `<ul>${data.attention.map((a) => `<li><b>${esc(a.code)}</b> ${esc(a.text)}</li>`).join('')}</ul>` : '<p class="src">Nothing: every working day has a signed diary, every variation a number, every daywork a docket.</p>',
    ...data.failed.map((f) => `<p class="src warn">${esc(f.code)} ${esc(f.name)} could not be read: ${esc(f.message)}</p>`),
    '<h2>Hours for pay — everyone, every job</h2>',
    `<div class="ts">${pay.sheet.people.length ? timesheetTableHtml(pay.sheet, pay.pendingCorrections) : '<p class="src">No labour recorded in any diary this week.</p>'}</div>`,
    ...data.jobs.map((j) => [
      `<h2>${esc(j.code)} · ${esc(j.name)}</h2>`,
      `<p class="src">${j.notStarted ? 'Not started — no start date and no diary yet' : `${j.workingDaysRecorded} of ${j.workingDays} working days recorded`}${j.unsignedDays.length ? ` · not signed: ${esc(j.unsignedDays.map((d) => dmy(d).slice(0, 5)).join(', '))}` : ''} · ${esc(fmtHours(j.labourHours))} h labour, ${j.people.length} people</p>`,
      j.done.length ? `<p class="lbl">Work done</p><ul>${j.done.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '',
      j.delays.length ? `<p class="lbl">Delays</p><ul>${j.delays.map((d) => `<li>${esc(dmy(d.date).slice(0, 5))} ${esc(d.cause)}${d.hours != null ? ` — ${esc(fmtHours(d.hours))} h` : ''}</li>`).join('')}</ul>` : '',
      j.variationRows.length ? `<p class="lbl">Variations</p><ul>${j.variationRows.map((v) => `<li>${esc(dmy(v.date).slice(0, 5))} ${esc(v.number ?? 'No number')} — ${esc(v.description)}</li>`).join('')}</ul>` : '',
    ].join('')),
    '</section></div></body></html>'].join('');

  try {
    const pdf = await renderPdfDocument(html, {
      title: `Weekly report, all jobs — ${dmy(start)}`, author: org.name, subject: `${org.name} — all jobs, week of ${start}`, keywords: [org.code, 'weekly', 'company', start],
      instant: new Date(`${start}T00:00:00Z`), idSeed: createHash('sha256').update(html).digest('hex'), footerLeft: `${org.code} · ALL JOBS · week of ${dmy(start)}`,
    });
    return new Response(Buffer.from(pdf), { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${org.code}_all-jobs_${start}.pdf"`, 'cache-control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not render the report: ${err instanceof Error ? err.message : 'PDF rendering failed.'}`, 500);
  }
}
