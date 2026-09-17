import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { fmtDate } from '@/lib/pdf/dates';
import type { DayworksScheduleData } from './load';

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hrs = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, '')}`;

/** The schedule as a printable A4 document: the same content as the screen, no AI text. */
export function dayworksScheduleHtml(s: DayworksScheduleData, meta: { orgName: string; orgCode: string; projectName: string; projectCode: string; periodLabel: string; today: string }): string {
  const t = s.totals;
  const body = s.weeks.length === 0
    ? '<p class="src">No dayworks on signed days in this period.</p>'
    : s.weeks.map((w) => [
      `<tr class="wk"><td colspan="6">Week ${esc(fmtDate(w.start))} to ${esc(fmtDate(w.end))}</td><td class="n">${hrs(w.hours)}${w.hoursNotRecorded ? ` <span class="amber">+${w.hoursNotRecorded} not recorded</span>` : ''}</td></tr>`,
      ...w.lines.map((l) => `<tr><td class="mono d">${esc(fmtDate(l.date))}</td><td>${esc(l.works)}</td><td>${esc(l.labour ?? '—')}</td><td>${esc(l.plant ?? '—')}</td><td>${esc(l.materials ?? '—')}</td><td class="mono${l.docket ? '' : ' amber'}">${esc(l.docket ?? 'To chase')}</td><td class="n mono${l.hours == null ? ' amber' : ''}">${l.hours == null ? 'Not recorded' : hrs(l.hours)}</td></tr>`),
    ].join('')).join('');
  return [
    '<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">',
    `<title>Dayworks schedule — ${esc(meta.projectName)}</title>`,
    `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`,
    '<style>.dw table{width:100%;table-layout:fixed;border-collapse:collapse}.dw col.c-date{width:22mm}.dw col.c-lab{width:26mm}.dw col.c-plant{width:22mm}.dw col.c-mat{width:18mm}.dw col.c-dock{width:24mm}.dw col.c-hrs{width:16mm}.dw td.d{white-space:nowrap}.dw td.n,.dw th.n{padding-left:1.6mm}.dw td,.dw th{overflow-wrap:break-word}.dw td,.dw th{font-size:8pt;vertical-align:top}.dw td.n,.dw th.n{text-align:right;white-space:nowrap}.dw tr.wk td{background:#EEF3F0;font-weight:700;font-size:8pt}.dw tr.tot td{border-top:1pt solid #16211F;font-weight:700;font-size:9pt}.dw .amber{color:#9A6A09}.dw .tiles{display:flex;gap:4mm;margin:2mm 0 4mm}.dw .tile{border:0.4pt solid #C9D3CE;border-radius:2mm;padding:2mm 3mm;min-width:32mm}.dw .tile b{display:block;font-size:14pt}</style>',
    '</head><body><div class="docket dw">',
    `<header class="head"><div class="head__left"><p class="lbl"><img class="brandmark" src="${LOGO_DATA_URI}" alt="" /> ${esc(meta.orgName)}</p><h1>Dayworks schedule</h1><p class="mono sub">${esc(meta.projectName)} · ${esc(meta.orgCode)}_${esc(meta.projectCode)} · ${esc(meta.periodLabel)}</p></div><div class="head__right"><p class="lbl">Total daywork hours</p><p class="serial mono">${hrs(t.hours)}</p></div></header>`,
    `<div class="tiles"><div class="tile"><span class="lbl">Works completed</span><b>${t.items}</b>${t.days} day${t.days === 1 ? '' : 's'}</div><div class="tile"><span class="lbl">Hours</span><b>${hrs(t.hours)}</b>${t.hoursNotRecorded ? `<span class="amber">${t.hoursNotRecorded} without hours</span>` : 'all recorded'}</div><div class="tile"><span class="lbl">Dockets</span><b>${t.docketed}</b>${t.toChase ? `<span class="amber">${t.toChase} to chase</span>` : 'all docketed'}</div></div>`,
    '<section class="sect"><table><colgroup><col class="c-date"><col><col class="c-lab"><col class="c-plant"><col class="c-mat"><col class="c-dock"><col class="c-hrs"></colgroup><thead><tr><th>Date</th><th>Works completed</th><th>Labour</th><th>Plant</th><th>Materials</th><th>Docket</th><th class="n">Hours</th></tr></thead><tbody>',
    body,
    s.weeks.length ? `<tr class="tot"><td colspan="6">Total — ${t.items} item${t.items === 1 ? '' : 's'} of work over ${t.days} day${t.days === 1 ? '' : 's'}</td><td class="n">${hrs(t.hours)}</td></tr>` : '',
    '</tbody></table>',
    `<p class="src">From signed diary entries only; a corrected day is counted once. Hours are totalled only where recorded${t.hoursNotRecorded ? ` — ${t.hoursNotRecorded} item${t.hoursNotRecorded === 1 ? ' has' : 's have'} no hours and ${t.hoursNotRecorded === 1 ? 'is' : 'are'} not counted` : ''}.${s.unsignedItems ? ` ${s.unsignedItems} more daywork${s.unsignedItems === 1 ? ' is' : 's are'} on ${s.unsignedDays} day${s.unsignedDays === 1 ? '' : 's'} not yet signed and not included.` : ''} Each line can be checked against its signed daily docket. Printed ${esc(fmtDate(meta.today))}.</p>`,
    '</section></div></body></html>',
  ].join('');
}
