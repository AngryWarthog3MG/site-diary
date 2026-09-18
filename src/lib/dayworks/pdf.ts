import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { fmtDate } from '@/lib/pdf/dates';
import { scheduleLines } from './schedule';
import type { DayworksScheduleData } from './load';
import type { DayworkPhotos } from './photos';

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
    `<header class="head"><div class="head__left"><p class="lbl"><img class="brandmark" src="${LOGO_DATA_URI}" alt="" /> ${esc(meta.orgName)}</p><h1>Dayworks schedule</h1><p class="mono sub">${esc(meta.projectName)} · ${esc(meta.orgCode)}_${esc(meta.projectCode)} · ${esc(meta.periodLabel)}</p></div><div class="head__right"><p class="lbl">Total daywork hours</p><p class="serial mono">${hrs(t.hours)}${t.hoursNotRecorded ? '*' : ''}</p>${t.hoursNotRecorded ? `<p class="lbl">* ${t.hoursNotRecorded} item${t.hoursNotRecorded === 1 ? '' : 's'} without hours not counted</p>` : ''}</div></header>`,
    `<div class="tiles"><div class="tile"><span class="lbl">Works completed</span><b>${t.items}</b>${t.days} day${t.days === 1 ? '' : 's'}</div><div class="tile"><span class="lbl">Hours</span><b>${hrs(t.hours)}</b>${t.hoursNotRecorded ? `<span class="amber">${t.hoursNotRecorded} without hours</span>` : 'all recorded'}</div><div class="tile"><span class="lbl">Dockets</span><b>${t.docketed}</b>${t.toChase ? `<span class="amber">${t.toChase} to chase</span>` : 'all docketed'}</div></div>`,
    '<section class="sect"><table><colgroup><col class="c-date"><col><col class="c-lab"><col class="c-plant"><col class="c-mat"><col class="c-dock"><col class="c-hrs"></colgroup><thead><tr><th>Date</th><th>Works completed</th><th>Labour</th><th>Plant</th><th>Materials</th><th>Docket</th><th class="n">Hours</th></tr></thead><tbody>',
    body,
    s.weeks.length ? `<tr class="tot"><td colspan="6">Total — ${t.items} item${t.items === 1 ? '' : 's'} of work over ${t.days} day${t.days === 1 ? '' : 's'}</td><td class="n">${hrs(t.hours)}</td></tr>` : '',
    '</tbody></table>',
    s.truncated ? '<p class="src amber">More than 1,000 dayworks in this period — only the first 1,000 are shown and totalled. Choose a shorter period.</p>' : '',
    `<p class="src">From signed diary entries only; a corrected day is counted once. Hours are totalled only where recorded${t.hoursNotRecorded ? ` — ${t.hoursNotRecorded} item${t.hoursNotRecorded === 1 ? ' has' : 's have'} no hours and ${t.hoursNotRecorded === 1 ? 'is' : 'are'} not counted` : ''}.${s.unsignedItems ? ` ${s.unsignedItems} more daywork${s.unsignedItems === 1 ? ' is' : 's are'} on ${s.unsignedDays} day${s.unsignedDays === 1 ? '' : 's'} not yet signed and not included.` : ''} Each line can be checked against its signed daily docket. Printed ${esc(fmtDate(meta.today))}.</p>`,
    '</section></div></body></html>',
  ].join('');
}

/**
 * The client sign-off sheet: the same dayworks, itemised with everything
 * recorded against each and the photographs taken on it, and a block for the
 * head contractor to sign.
 *
 * What it is NOT: agreement on rates or value. A signature here acknowledges
 * the labour, plant and materials expended on the dates shown — which is what
 * a dayworks sheet is for, and what a claim months later has to stand on.
 * Rates and entitlement are the contract's business, and the sheet says so.
 *
 * Every figure comes from a signed diary entry. Nothing here is generated
 * text, an item with no hours prints "Not recorded" rather than a zero, and a
 * day with a correction waiting is not on it — only the signed record is.
 */
export function dayworksSignoffHtml(
  s: DayworksScheduleData,
  photos: DayworkPhotos,
  meta: { orgName: string; orgCode: string; projectName: string; projectCode: string; periodLabel: string; today: string; clientName: string | null; preparedBy: string },
): string {
  const t = s.totals;
  const lines = scheduleLines(s);
  const client = meta.clientName?.trim() || 'the head contractor';

  const rows = lines.map((l, i) => {
    const n = i + 1;
    const pics = photos.byItem.get(n)?.length ?? 0;
    return `<tr><td class="n mono">${n}</td><td class="mono d">${esc(fmtDate(l.date))}</td><td>${esc(l.works)}</td><td>${esc(l.labour ?? '—')}</td><td>${esc(l.plant ?? '—')}</td><td>${esc(l.materials ?? '—')}</td><td class="mono${l.docket ? '' : ' amber'}">${esc(l.docket ?? 'To chase')}</td><td class="mono c">${pics || '—'}</td><td class="n mono${l.hours == null ? ' amber' : ''}">${l.hours == null ? 'Not recorded' : hrs(l.hours)}</td></tr>`;
  }).join('');

  const plates = lines.map((l, i) => {
    const n = i + 1;
    const pics = photos.byItem.get(n) ?? [];
    if (pics.length === 0) return '';
    return [
      `<div class="dwp__item"><p class="dwp__head mono">Item ${n} · ${esc(fmtDate(l.date))} · ${esc(l.works)}</p>`,
      '<div class="photos__grid">',
      pics.map((src) => `<figure><img src="${src}" alt="Item ${n}" data-shrink="1000" /></figure>`).join(''),
      '</div></div>',
    ].join('');
  }).join('');

  const sign = (role: string, who: string) => `<div class="dws__box"><p class="lbl">${esc(role)}</p><p class="dws__who">${esc(who)}</p><div class="dws__line"><span class="lbl">Name</span></div><div class="dws__line"><span class="lbl">Position</span></div><div class="dws__line dws__line--tall"><span class="lbl">Signature</span></div><div class="dws__line"><span class="lbl">Date</span></div></div>`;

  return [
    '<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">',
    `<title>Dayworks sign-off — ${esc(meta.projectName)}</title>`,
    `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`,
    '<style>.dw table{width:100%;table-layout:fixed;border-collapse:collapse}.dw col.c-no{width:8mm}.dw col.c-date{width:20mm}.dw col.c-lab{width:26mm}.dw col.c-plant{width:24mm}.dw col.c-mat{width:20mm}.dw col.c-dock{width:20mm}.dw col.c-pic{width:12mm}.dw col.c-hrs{width:16mm}.dw td.d{white-space:nowrap}.dw td,.dw th{font-size:8pt;vertical-align:top;overflow-wrap:break-word}.dw td.n,.dw th.n{text-align:right;white-space:nowrap}.dw td.c,.dw th.c{text-align:center}.dw tr.tot td{border-top:1pt solid #16211F;font-weight:700;font-size:9pt}.dw .amber{color:#9A6A09}'
    + '.dws{break-inside:avoid;margin-top:6mm}.dws__dec{border:0.4pt solid #C9D3CE;border-radius:2mm;padding:3mm 4mm;font-size:8.5pt;line-height:1.45}.dws__grid{display:grid;grid-template-columns:1fr 1fr;gap:6mm;margin-top:4mm}.dws__box{border:0.4pt solid #C9D3CE;border-radius:2mm;padding:3mm 4mm}.dws__who{margin:0 0 2mm;font-weight:700;font-size:9pt}.dws__line{border-bottom:0.6pt solid #16211F;height:9mm;margin-top:3mm;position:relative}.dws__line--tall{height:16mm}.dws__line .lbl{position:absolute;bottom:0.6mm;left:0;font-size:6.5pt}'
    + '.dwp{break-before:page}.dwp__item{break-inside:avoid;margin-top:4mm}.dwp__head{margin:0 0 1.5mm;font-size:8.5pt;font-weight:700;color:#16211F}.dwp .photos__grid{grid-template-columns:1fr 1fr 1fr;gap:3.5mm}.dwp img{height:48mm;width:100%;object-fit:cover;border-radius:1.5mm}</style>',
    '</head><body><div class="docket dw">',
    `<header class="head"><div class="head__left"><p class="lbl"><img class="brandmark" src="${LOGO_DATA_URI}" alt="" /> ${esc(meta.orgName)}</p><h1>Dayworks sheet for sign-off</h1><p class="mono sub">${esc(meta.projectName)} · ${esc(meta.orgCode)}_${esc(meta.projectCode)} · ${esc(meta.periodLabel)}</p></div><div class="head__right"><p class="lbl">Total daywork hours</p><p class="serial mono">${hrs(t.hours)}${t.hoursNotRecorded ? '*' : ''}</p><p class="lbl">${t.items} item${t.items === 1 ? '' : 's'} over ${t.days} day${t.days === 1 ? '' : 's'}</p></div></header>`,
    lines.length === 0
      ? '<section class="sect"><p class="src">No dayworks on signed days in this period.</p></section>'
      : [
        '<section class="sect"><table><colgroup><col class="c-no"><col class="c-date"><col><col class="c-lab"><col class="c-plant"><col class="c-mat"><col class="c-dock"><col class="c-pic"><col class="c-hrs"></colgroup>',
        '<thead><tr><th class="n">#</th><th>Date</th><th>Works completed</th><th>Labour</th><th>Plant</th><th>Materials</th><th>Docket</th><th class="c">Pics</th><th class="n">Hours</th></tr></thead><tbody>',
        rows,
        `<tr class="tot"><td colspan="8">Total — ${t.items} item${t.items === 1 ? '' : 's'} of work over ${t.days} day${t.days === 1 ? '' : 's'}</td><td class="n">${hrs(t.hours)}</td></tr>`,
        '</tbody></table>',
        t.hoursNotRecorded ? `<p class="src amber">* ${t.hoursNotRecorded} item${t.hoursNotRecorded === 1 ? ' has' : 's have'} no hours recorded and ${t.hoursNotRecorded === 1 ? 'is' : 'are'} not in the total.</p>` : '',
        s.truncated ? '<p class="src amber">More than 1,000 dayworks in this period — only the first 1,000 are on this sheet. Choose a shorter period.</p>' : '',
        '</section>',
      ].join(''),
    `<section class="sect dws"><div class="dws__dec"><p><strong>For signature by ${esc(client)}.</strong> The ${t.items} item${t.items === 1 ? '' : 's'} of work listed above ${t.items === 1 ? 'was' : 'were'} carried out on the dates shown, with the labour, plant and materials recorded against ${t.items === 1 ? 'it' : 'each'}${photos.total > 0 ? `, and the ${photos.total} photograph${photos.total === 1 ? '' : 's'} attached ${photos.total === 1 ? 'was' : 'were'} taken on site on ${t.days === 1 ? 'the day' : 'those days'}` : ''}.</p><p>Signing acknowledges the labour, plant and materials expended. Rates, entitlement and value are dealt with under the contract.</p></div><div class="dws__grid">${sign(`Signed for ${client}`, '')}${sign(`Signed for ${meta.orgName}`, meta.preparedBy)}</div></section>`,
    `<p class="src">Every line is taken from a signed diary entry and can be checked against its daily docket, which carries its own serial and content hash. A corrected day is counted once.${s.unsignedItems ? ` ${s.unsignedItems} further daywork${s.unsignedItems === 1 ? ' is' : 's are'} on ${s.unsignedDays} day${s.unsignedDays === 1 ? '' : 's'} not yet signed and ${s.unsignedItems === 1 ? 'is' : 'are'} not on this sheet.` : ''}${photos.omitted ? ` ${photos.omitted} further photograph${photos.omitted === 1 ? ' is' : 's are'} in the daily dockets.` : ''} Prepared ${esc(fmtDate(meta.today))}.</p>`,
    plates ? `<section class="sect dwp"><h2>Photographs</h2>${plates}</section>` : '',
    '</div></body></html>',
  ].join('');
}
