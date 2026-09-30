/**
 * A register as the inside of a page: the head, the counts, each section's
 * table. Pure strings, so the three registers print the same way and a fourth
 * costs a row builder and nothing else (README R117).
 */
import type { Cell, RegisterDoc } from './model.ts';
import { fmtDay } from './model.ts';

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const REGISTER_CSS = [
  '.reg table{font-size:8pt;width:100%;border-collapse:collapse;table-layout:auto}',
  '.reg th{font-size:7pt;text-align:left;vertical-align:bottom}',
  '.reg td{vertical-align:top;padding-top:1.2mm;padding-bottom:1.2mm}',
  '.reg tr{break-inside:avoid}',
  '.reg .sub2{display:block;font-size:6.8pt;color:#555;margin-top:0.3mm}',
  '.reg td.bad{color:#9A2B2B;font-weight:700} .reg td.bad .sub2{color:#9A2B2B;font-weight:400}',
  '.reg td.warn{color:#8A5A00;font-weight:600} .reg td.warn .sub2{color:#8A5A00;font-weight:400}',
  '.reg .counts{margin:0 0 1mm;font-size:8.5pt}',
  '.reg .basis{font-size:7pt;color:#555;margin:2mm 0 0}',
  '.reg .empty{font-size:9pt;padding:3mm 0;color:#333}',
  '.reg h2{font-size:9.5pt;margin:0 0 1.5mm;text-transform:uppercase;letter-spacing:0.04em}',
].join(' ');

export interface RegisterHead {
  orgName: string;
  /** What the register covers: the company, or a job within it. */
  scope: string;
  /** ISO day the register was printed for. */
  asOf: string;
  logo: string;
}

const cell = (c: Cell) =>
  `<td class="${c.tone === 'bad' ? 'bad' : c.tone === 'warn' ? 'warn' : ''}">${esc(c.text)}${c.sub && c.sub.trim() ? `<span class="sub2">${esc(c.sub)}</span>` : ''}</td>`;

export function registerBodyHtml(doc: RegisterDoc, head: RegisterHead): string {
  return [
    '<div class="docket reg">',
    `<header class="head"><div class="head__left"><p class="lbl"><img class="brandmark" src="${head.logo}" alt="" /> ${esc(head.orgName)}</p><h1>${esc(doc.title)}</h1><p class="mono sub">${esc(head.scope)}</p></div>`,
    `<div class="head__right"><p class="lbl">As of</p><p class="mono">${esc(fmtDay(head.asOf))}</p></div></header>`,
    '<section class="sect">',
    ...doc.summary.map((line) => `<p class="counts">${esc(line)}</p>`),
    `<p class="basis">${esc(doc.basis)}</p>`,
    '</section>',
    ...doc.sections.map((s) => [
      '<section class="sect">',
      `<h2>${esc(s.heading)}${s.rows.length ? ` · ${s.rows.length}` : ''}</h2>`,
      s.rows.length === 0
        ? `<p class="empty">${esc(s.empty)}</p>`
        : `<table><thead><tr>${s.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table>`,
      '</section>',
    ].join('')),
    `<section class="sect"><p class="src">Printed from the register as it stood on ${esc(fmtDay(head.asOf))}. Red is overdue, missing or lapsed; amber falls due within the warning period.</p></section>`,
    '</div>',
  ].join('');
}
