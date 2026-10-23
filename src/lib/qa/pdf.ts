import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';
import { recordState, STATE_LABEL, type ItemState, type Signoff } from './model';
import type { QaRecordRow, QaTemplateRow } from './load';

const TICK = '<svg class="qa-tick" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M2.5 8.5 6.2 12 13.5 4" fill="none" stroke="#16211F" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type HeaderField = { key: string; label: string; type: string; unit?: string };
type Item = { id: string; text: string; value_type?: string; value_label?: string };
type Section = { title: string; items: Item[] };
type Column = { key: string; label: string; type: string; unit?: string };
type HoldPoint = { id: string; after_item: string; text: string; parties: string[] };
type Spec = {
  header_fields?: HeaderField[]; sections?: Section[]; columns?: Column[]; sub_register?: { heading?: string; columns: Column[] }; signoffs?: Array<Signoff & { hold_point?: string }>;
  answer_labels?: Record<ItemState, string>; hold_points?: HoldPoint[]; item_columns?: string[]; register_heading?: string; comments_heading?: string; signoff_note?: string;
};

export interface QaPdfMeta {
  orgName: string; orgCode: string; projectName: string; projectCode: string; today: string;
  /** Signature images by signature_path, and photographs by path, as data URIs — handed to the renderer one at a time (README R84). */
  images: Record<string, string>;
}

/**
 * One inspection and test record as the paper form it replaces (README R166): the boxed header with the mark, the
 * record details, every question with its answer ticked and its comment, the hold point blocks with the signatures as
 * drawn, the register's loads, the comments, the photographs. Nothing generated: every word is the template's or the
 * crew's. Returned on demand, never stored; the record itself is the file.
 */
export function qaRecordHtml(template: QaTemplateRow, record: QaRecordRow, meta: QaPdfMeta): { html: string; images: Record<string, string> } {
  const spec = template.spec as unknown as Spec;
  const labels = spec.answer_labels ?? { ok: 'OK', gap: 'Gap', na: 'N/A' };
  const state = recordState(spec, record);
  const header = record.header ?? {};
  const byItem = new Map(record.items.map((i) => [i.item_id, i]));
  const signed = new Map(record.signoffs.map((s) => [s.party, s]));
  const images: Record<string, string> = {};
  const key = (prefix: string, path: string) => { const k = `${prefix}-${Object.keys(images).length}`; if (meta.images[path]) images[k] = meta.images[path]; return meta.images[path] ? k : null; };

  const headerRows = (spec.header_fields ?? []).map((f) => {
    const v = header[f.key];
    return `<div class="qa-h"><span class="lbl">${esc(f.label)}</span><span class="qa-h__v">${v == null || v === '' ? '—' : esc(f.type === 'date' ? fmtDate(String(v)) : String(v))}${v != null && v !== '' && f.unit ? ` ${esc(f.unit)}` : ''}</span></div>`;
  }).join('');

  const signBlock = (party: string, def: Signoff | undefined) => {
    const s = signed.get(party);
    const k = s ? key('sig', s.signature_path) : null;
    return `<div class="qa-sig${s ? ' qa-sig--done' : ''}"><p class="qa-sig__party">${esc(party)}${def?.is_release ? ' <span class="qa-rel">release</span>' : ''}${def && !def.required ? ' <span class="qa-opt">if applicable</span>' : ''}</p>`
      + (s ? `${k ? `<img class="qa-sig__img" data-photo="${k}" alt="" />` : '<p class="qa-sig__none">Signature on file</p>'}<p class="qa-sig__by">${esc(s.signer_name)} · ${esc(fmtPerthDate(s.signed_at))}</p>` : '<p class="qa-sig__none">Not signed</p>')
      + '</div>';
  };
  const holdPoints = spec.hold_points ?? [];
  const signoffDefs = spec.signoffs ?? [];
  const inHold = new Set(holdPoints.flatMap((h) => h.parties));

  const photoKeys = record.photo_paths.map((p) => key('ph', p)).filter((k): k is string => Boolean(k));
  const sections = (spec.sections ?? []).map((sec) => {
    const rows = sec.items.map((it) => {
      const r = byItem.get(it.id);
      // A drawn tick: the embedded faces carry no ✓ glyph, and a missing glyph prints as a box.
      const tick = (st: ItemState) => `<td class="c">${r?.state === st ? TICK : ''}</td>`;
      const hps = holdPoints.filter((h) => h.after_item === it.id);
      return `<tr class="${r?.state === 'gap' ? 'qa-gap' : ''}"><td class="mono c">${esc(it.id)}</td><td>${esc(it.text)}</td>${tick('ok')}${tick('gap')}${tick('na')}<td>${esc(r?.value ?? '')}</td></tr>`
        + hps.map((hp) => `<tr class="qa-hp"><td colspan="6"><p class="qa-hp__text">${esc(hp.id)} · ${esc(hp.text)}</p><div class="qa-sigs">${hp.parties.map((p) => signBlock(p, signoffDefs.find((d) => d.party === p))).join('')}</div></td></tr>`).join('');
    }).join('');
    return `<tr class="qa-sec"><td colspan="6">${esc(sec.title)}</td></tr>${rows}`;
  }).join('');

  const subKeys = new Set((spec.sub_register?.columns ?? []).map((c) => c.key));
  const regTable = (heading: string, cols: Column[], rows: Array<Record<string, unknown>>) => `<section class="sect"><p class="lbl">${esc(heading)}</p><table class="qa-reg"><thead><tr><th>#</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((row, i) => `<tr><td class="mono c">${i + 1}</td>${cols.map((c) => `<td>${esc(c.type === 'date' && row[c.key] ? fmtDate(String(row[c.key])) : (row[c.key] ?? ''))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length + 1}" class="nil">Nothing recorded</td></tr>`}</tbody></table></section>`;
  const mainRows = record.rows.filter((r) => !Object.keys(r).some((k) => subKeys.has(k)));
  const subRows = record.rows.filter((r) => Object.keys(r).some((k) => subKeys.has(k)));
  const register = (spec.columns?.length ? regTable(spec.register_heading ?? 'Register', spec.columns, mainRows) : '') + (spec.sub_register ? regTable(spec.sub_register.heading ?? 'Register', spec.sub_register.columns, subRows) : '');
  const loose = signoffDefs.filter((s) => !inHold.has(s.party));

  const html = [
    '<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">',
    `<title>${esc(template.title)} — ${esc(record.lot_or_element ?? record.id)}</title>`,
    `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`,
    '<style>.qa .qa-hdr{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5mm 4mm;margin:1mm 0 2mm}.qa .qa-h{border-bottom:0.4pt solid #C9D3CE;padding:1mm 0}.qa .qa-h__v{display:block;font-size:9pt}'
    + '.qa table.qa-items,.qa table.qa-reg{width:100%;border-collapse:collapse;table-layout:fixed}.qa .qa-items td,.qa .qa-items th,.qa .qa-reg td,.qa .qa-reg th{font-size:8pt;vertical-align:top;border:0.4pt solid #C9D3CE;padding:1.2mm 1.6mm}.qa .qa-items th,.qa .qa-reg th{background:#EEF3F0;text-align:left;font-size:7pt;letter-spacing:.04em;text-transform:uppercase}.qa .c{text-align:center}.qa .qa-tick{display:inline-block;vertical-align:middle}.qa .qa-items col.c-no{width:9mm}.qa .qa-items col.c-t{width:11mm}.qa .qa-items col.c-cm{width:48mm}.qa tr.qa-sec td{background:#E3EBE6;font-weight:700;font-size:8pt}.qa tr.qa-gap td{background:#FFF4F2}'
    + '.qa tr.qa-hp td{background:#FFF8E8;border-color:#D9A21B}.qa .qa-hp__text{margin:0 0 1.5mm;font-weight:700;color:#7A5204}.qa .qa-sigs{display:grid;grid-template-columns:repeat(3,1fr);gap:2mm}.qa .qa-sig{border:0.4pt solid #C9D3CE;border-radius:1.5mm;padding:1.5mm 2mm;background:#fff;min-height:16mm}.qa .qa-sig--done{border-color:#1F5C33}.qa .qa-sig__party{margin:0;font-weight:700;font-size:7.5pt}.qa .qa-sig__img{display:block;height:10mm;max-width:100%;object-fit:contain;margin:1mm 0}.qa .qa-sig__by{margin:0;font-size:7pt}.qa .qa-sig__none{margin:1mm 0 0;font-size:7pt;color:#9A6A09}.qa .qa-rel,.qa .qa-opt{font-weight:400;font-size:6.5pt;color:#555}'
    + '.qa .qa-pics{display:block;font-size:6.5pt;color:#555}.qa .qa-plate{break-inside:avoid;margin-top:3mm}.qa .qa-plate__head{margin:0 0 1mm;font-size:8pt;font-weight:700}.qa .photos__grid{grid-template-columns:1fr 1fr 1fr;gap:3mm}.qa .photos__grid img{height:46mm;width:100%;object-fit:cover;border-radius:1.5mm;background:#EEF3F0}.qa .qa-comments{min-height:14mm;border:0.4pt solid #C9D3CE;border-radius:1.5mm;padding:2mm;font-size:8.5pt;white-space:pre-wrap}.qa .nil{color:#777;font-style:italic}</style>',
    '</head><body><div class="docket qa">',
    `<header class="head"><div class="head__left"><p class="lbl"><img class="brandmark" src="${LOGO_DATA_URI}" alt="" /> ${esc(meta.orgName)}</p><h1>${esc(template.title)}</h1><p class="mono sub">${esc(template.code)} · Rev ${esc(template.revision)} · ${esc(meta.projectName)} · ${esc(meta.orgCode)}_${esc(meta.projectCode)}</p></div><div class="head__right"><p class="lbl">Pour / lot</p><p class="serial mono">${esc(record.lot_or_element ?? '—')}</p><p class="lbl">${esc(STATE_LABEL[state])}</p></div></header>`,
    headerRows ? `<section class="sect"><p class="lbl">Record details</p><div class="qa-hdr">${headerRows}</div></section>` : '',
    sections ? `<section class="sect"><table class="qa-items"><colgroup><col class="c-no"><col><col class="c-t"><col class="c-t"><col class="c-t"><col class="c-cm"></colgroup><thead><tr><th class="c">No.</th><th>Question</th><th class="c">${esc(labels.ok)}</th><th class="c">${esc(labels.gap)}</th><th class="c">${esc(labels.na)}</th><th>Comment / result</th></tr></thead><tbody>${sections}</tbody></table></section>` : '',
    register,
    `<section class="sect"><p class="lbl">${esc(spec.comments_heading ?? 'Comments')}</p><div class="qa-comments">${esc(record.comments ?? '')}</div></section>`,
    loose.length ? `<section class="sect"><p class="lbl">Sign-off</p><div class="qa-sigs">${loose.map((s) => signBlock(s.party, s)).join('')}</div></section>` : '',
    photoKeys.length ? `<section class="sect"><p class="lbl">Photographs · ${photoKeys.length}</p><div class="photos__grid">${photoKeys.map((k) => `<figure><img data-photo="${k}" alt="" /></figure>`).join('')}</div></section>` : '',
    `<p class="src">Record ${esc(record.id)} · ${esc(STATE_LABEL[state])}${record.gap_count ? ` · ${record.gap_count} gap${record.gap_count === 1 ? '' : 's'}` : ''}${record.completed_at ? ` · signed by every required party ${esc(fmtPerthDate(record.completed_at))}` : ''}${record.voided_at ? ` · VOIDED ${esc(fmtPerthDate(record.voided_at))}: ${esc(record.void_reason ?? '')}` : ''} · last saved ${esc(fmtPerthDate(record.updated_at))} · printed ${esc(fmtDate(meta.today))}. Signatures as drawn on the device; a sign-off once made is never changed.</p>`,
    '</div></body></html>',
  ].join('');
  return { html, images };
}
