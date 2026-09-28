/**
 * The timesheet as printed (README R103, R107): the table and its notes, for the Timesheets PDF and the all-jobs
 * weekly PDF (R109) — one printing of the hours a person is paid for. Wrap it in an element with class "ts".
 */
import { DAY_LABELS, dm, fmtHours, type Timesheet } from './model';

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const TIMESHEET_PDF_CSS = '.ts table{font-size:8.5pt} .ts td.n,.ts th.n{text-align:right;white-space:nowrap} .ts .sub{display:block;font-size:6.5pt;color:#666} .ts td.u{color:#8a5a00} .ts td.x{color:#9a2b2b;font-weight:700} .ts tfoot td{font-weight:700;border-top:1.5px solid #000} .ts td.name{font-weight:600}';

export function timesheetTableHtml(sheet: Timesheet, pendingCorrections: number): string {
  const cell = (h: number | null, ot: number) => `${fmtHours(h)}${ot ? ` +${fmtHours(ot)}` : ''}`;
  return (
    sheet.people.length === 0 ? `<p class="src">No labour recorded in any diary for this week.</p>` : [
      '<table><thead><tr><th>Person</th>',
      ...sheet.days.map((d, i) => `<th class="n">${DAY_LABELS[i]}<span class="sub">${esc(dm(d))}</span></th>`),
      '<th class="n">Total</th><th>Jobs</th></tr></thead><tbody>',
      ...sheet.people.map((p) => {
        const multi = Object.keys(p.byJob).length > 1;
        return `<tr><td class="name">${esc(p.name)}${p.roles.length ? `<span class="sub">${esc(p.roles.join(' / '))}</span>` : ''}</td>` +
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
    ].join('')
  );
}
