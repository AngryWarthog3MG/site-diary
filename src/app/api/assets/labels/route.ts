import { createHash } from 'node:crypto';
import { fail } from '@/lib/api';
import { loadAssetRegister } from '@/lib/assets/load';
import { CLASS_LABEL } from '@/lib/assets/model';
import { registerContext } from '@/lib/registers/respond';
import { readIds } from '@/lib/registers/select';
import { siteUrl } from '@/lib/site-url';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';

export const maxDuration = 300;
export const runtime = 'nodejs';

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A sheet of labels is a sheet, not the register: more than this is a mistake in the address. */
const MAX_LABELS = 120;

/**
 * QR labels for the chosen assets (README R186): a grid of 70 × 42 mm labels, each the asset's
 * name, number and class, its barcode if it has one, and a QR code that opens the asset's page
 * — so a scan on site lands on what is due, who has it and where to record the check. Stuck on
 * an extinguisher, a lead, a sling, a cab. Returned inline; nothing stored.
 */
export async function GET(request: Request) {
  const { ctx, response } = await registerContext(request, 'assets');
  if (!ctx) return response;
  const ids = readIds(new URL(request.url).searchParams.get('ids'));
  if (!ids || ids.size === 0) return fail('bad_request', 'Tick the assets to print labels for.', 400);
  const data = await loadAssetRegister(ctx.supabase, ctx.org.id, ctx.today);
  const chosen = data.verdicts.filter((v) => ids.has(v.asset.id.toLowerCase())).slice(0, MAX_LABELS);
  if (chosen.length === 0) return fail('not_found', 'None of those assets are on the register.', 404);
  const QRCode = await import('qrcode');
  const base = siteUrl();
  const cells: string[] = [];
  for (const v of chosen) {
    const a = v.asset;
    const url = `${base}/assets/${a.id}`;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
    cells.push([
      '<div class="lab">',
      `<div class="lab__qr">${svg}</div>`,
      '<div class="lab__txt">',
      `<p class="lab__name">${esc(a.name)}</p>`,
      `<p class="lab__no">${esc(a.asset_no ?? '')}${a.asset_no && a.barcode ? ' · ' : ''}${esc(a.barcode ?? '')}</p>`,
      `<p class="lab__cls">${esc(CLASS_LABEL[a.asset_class])}${a.serial_no ? ` · S/N ${esc(a.serial_no)}` : ''}</p>`,
      `<p class="lab__org">${esc(ctx.org.name)} · scan for what is due</p>`,
      '</div></div>',
    ].join(''));
  }
  const html = [
    '<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">', `<title>Asset labels — ${esc(ctx.org.name)}</title>`,
    `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`,
    '<style>@page{ size:A4; margin:12mm 10mm; } .sheet{ display:grid; grid-template-columns:repeat(2, 1fr); gap:4mm 6mm; } ',
    '.lab{ display:flex; gap:3mm; align-items:center; height:42mm; padding:3mm; border:0.3mm dashed #9aa3a0; border-radius:2mm; break-inside:avoid; } ',
    '.lab__qr{ width:34mm; height:34mm; flex:none; } .lab__qr svg{ width:100%; height:100%; display:block; } ',
    '.lab__txt{ min-width:0; flex:1; } .lab__txt p{ margin:0 0 1mm; line-height:1.2; overflow:hidden; } ',
    '.lab__name{ font-size:12pt; font-weight:700; } .lab__no{ font-size:11pt; font-family:ui-monospace, Menlo, monospace; } ',
    '.lab__cls{ font-size:8.5pt; color:#3a4542; } .lab__org{ font-size:7.5pt; color:#5A6469; }</style>',
    '</head><body><div class="sheet">', cells.join(''), '</div></body></html>',
  ].join('');
  try {
    const pdf = await renderPdfDocument(html, {
      title: `Asset labels — ${ctx.org.name}`, author: ctx.org.name, subject: `${chosen.length} asset labels`, keywords: [ctx.org.code, 'assets', 'labels'],
      instant: new Date(`${ctx.today}T00:00:00Z`), idSeed: createHash('sha256').update(html).digest('hex'), footerLeft: `${ctx.org.code} · ASSET LABELS · ${ctx.today}`,
    });
    return new Response(Buffer.from(pdf), { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${ctx.org.code}_asset_labels_${ctx.today}.pdf"`, 'cache-control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not render the labels: ${err instanceof Error ? err.message.split('\n')[0] : 'PDF rendering failed.'}`, 500);
  }
}
