import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { DEFAULT_RULES, gateUrl } from '@/lib/gate/model';

export const maxDuration = 300;
export const runtime = 'nodejs';

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The A4 gate sign: the job, the QR code, the address in words, the rules. */
export async function POST(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;
  const projectId = new URL(request.url).searchParams.get('project');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  const { data: project } = await supabase.from('projects').select('id, name, code, org:organisations!inner(name, code)').eq('id', projectId).maybeSingle();
  if (!project) return fail('not_found', 'That project is not on your account.', 404);
  const { data: gate } = await supabase.from('gate_tokens').select('token, rules, created_at').eq('project_id', projectId).eq('active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!gate) return fail('not_found', 'Make a gate code first.', 404);
  const org = (Array.isArray(project.org) ? project.org[0] : project.org) as { name: string; code: string };
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kbsdailydiary.me';
  const url = gateUrl(gate.token as string, base);
  const QRCode = await import('qrcode');
  const svg = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  const rules = ((gate.rules as string | null) ?? DEFAULT_RULES).split('\n').filter(Boolean);
  const html = [
    '<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">', `<title>Gate sign — ${esc(project.name)}</title>`,
    `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`,
    `<style>.gate{ text-align:center; } .gate h1{ font-size:26pt; margin:6mm 0 2mm; } .gate .sub{ font-size:12pt; color:#5A6469; margin:0 0 8mm; } .gate .qr{ width:110mm; height:110mm; margin:0 auto; } .gate .qr svg{ width:100%; height:100%; } .gate .url{ font-size:12pt; margin:6mm 0 10mm; } .gate .rules{ text-align:left; margin:0 auto; max-width:150mm; font-size:10.5pt; line-height:1.5; } .gate .step{ font-size:13pt; font-weight:700; margin:0 0 3mm; }</style>`,
    '</head><body><div class="docket gate">',
    `<p class="lbl"><img class="brandmark" src="${LOGO_DATA_URI}" alt="" /> ${esc(org.name)}</p>`,
    `<h1>${esc(project.name)}</h1>`, `<p class="sub">Everyone signs in before going past this gate, and signs out when they leave.</p>`,
    `<p class="step">1. Scan &nbsp; 2. Your name &nbsp; 3. Read the rules and sign</p>`,
    `<div class="qr">${svg}</div>`,
    `<p class="url mono">${esc(url)}</p>`,
    `<div class="rules"><p class="lbl">Site rules</p><ol>${rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol></div>`,
    '</div></body></html>',
  ].join('');
  let pdf: Uint8Array;
  try {
    pdf = await renderPdfDocument(html, {
      title: `Gate sign — ${project.name}`, author: org.name, subject: `${project.name} — gate sign`, keywords: [org.code, project.code, 'gate'],
      instant: new Date(gate.created_at as string), idSeed: `gate:${gate.token}`, footerLeft: `${org.code}_${project.code} · GATE`,
    });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not render the sign: ${err instanceof Error ? err.message : 'PDF rendering failed.'}`, 500);
  }
  const admin = createAdminClient();
  const objectPath = `${projectId}/gate/sign-${String(gate.token).slice(0, 8)}.pdf`;
  const { error: uploadError } = await admin.storage.from('exports').upload(objectPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: true });
  if (uploadError) return fail('server_error', `Could not store the sign: ${uploadError.message}`, 500);
  const { data: link, error: linkError } = await admin.storage.from('exports').createSignedUrl(objectPath, 3600);
  if (linkError || !link) return fail('server_error', 'Stored but no link could be made.', 500);
  return ok({ url: link.signedUrl, path: objectPath, bytes: pdf.length });
}
