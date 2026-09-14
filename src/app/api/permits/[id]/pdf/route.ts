import { createHash } from 'node:crypto';
import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { finishedAtAwst } from '@/lib/pdf/finished-at';
import { PermitDoc, PERMIT_CSS, type PermitPdfData } from '@/lib/permits/pdf';
import { readControls, type PermitKind, type PermitStatus } from '@/lib/permits/model';

export const maxDuration = 300;
export const runtime = 'nodejs';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;
  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad permit id.', 400);
  const { data: r } = await supabase.from('permits').select('*, project:projects!inner(name, code, org:organisations!inner(name, code)), swms:swms(title, version, kind)').eq('id', id).maybeSingle();
  if (!r) return fail('not_found', 'That permit is not on any of your projects.', 404);
  if (r.status === 'open') return fail('bad_request', 'The permit is not issued yet.', 409);
  const project = Array.isArray(r.project) ? r.project[0] : r.project;
  const org = Array.isArray(project.org) ? project.org[0] : project.org;
  const swms = (Array.isArray(r.swms) ? r.swms[0] : r.swms) as { title: string; version: number; kind: string } | null;
  const admin = createAdminClient();
  const stateHash = createHash('sha256').update(JSON.stringify({ s: r.status, c: r.closed_at, i: r.issued_at })).digest('hex');
  const objectPath = `${r.project_id}/permit/${r.id}-${stateHash.slice(0, 8)}.pdf`;
  const existing = await admin.storage.from('exports').download(objectPath);
  if (existing.data) {
    const { data: link } = await admin.storage.from('exports').createSignedUrl(objectPath, 3600);
    if (link) return ok({ url: link.signedUrl, path: objectPath, reused: true });
  }
  const dataUri = async (path: string | null) => {
    if (!path) return null;
    const { data } = await admin.storage.from('entry-photos').download(path);
    if (!data) return null;
    return `data:image/png;base64,${Buffer.from(await data.arrayBuffer()).toString('base64')}`;
  };
  const instant = new Date((r.closed_at as string | null) ?? (r.issued_at as string));
  const data: PermitPdfData = {
    orgName: org.name, orgCode: org.code, projectName: project.name, projectCode: project.code,
    seq: r.seq, kind: r.kind as PermitKind, title: r.title, location: r.location, valid_from: r.valid_from, valid_to: r.valid_to, status: r.status as PermitStatus,
    swms: swms ? `${swms.kind.toUpperCase()} v${swms.version} · ${swms.title}` : null, plant: r.plant, workers: r.workers ?? [], controls: readControls(r.controls), conditions: r.conditions,
    issuer_name: r.issuer_name, holder_name: r.holder_name, issuerSig: await dataUri(r.issuer_signature_path), holderSig: await dataUri(r.holder_signature_path),
    issuedAwst: r.issued_at ? finishedAtAwst(r.issued_at, r.issued_on_device_at) : null,
    closeout: r.closeout_checks ? readControls(r.closeout_checks) : null, closeout_note: r.closeout_note, closeoutSig: await dataUri(r.closeout_signature_path),
    closedAwst: r.closed_at ? finishedAtAwst(r.closed_at, r.closed_on_device_at) : null, cancel_reason: r.cancel_reason, printedAwst: finishedAtAwst(instant.toISOString(), null),
  };
  let pdf: Uint8Array;
  try {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = ['<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">', `<title>Permit ${r.seq}</title>`,
      `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`, `<style>${PERMIT_CSS}</style>`, '</head><body>',
      renderToStaticMarkup(PermitDoc({ data })), '</body></html>'].join('');
    pdf = await renderPdfDocument(html, {
      title: `Permit PTW-${r.seq} — ${project.name}`, author: org.name, subject: `${project.name} — permit to work`, keywords: [org.code, project.code, 'permit', String(r.kind)],
      instant, idSeed: stateHash, footerLeft: `${org.code}_${project.code} · PERMIT · PTW-${String(r.seq).padStart(3, '0')}`,
    });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not render the permit: ${err instanceof Error ? err.message : 'PDF rendering failed.'}`, 500);
  }
  const { error: uploadError } = await admin.storage.from('exports').upload(objectPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false });
  if (uploadError && !/exists/i.test(uploadError.message)) return fail('server_error', `Could not store the PDF: ${uploadError.message}`, 500);
  const { data: link, error: linkError } = await admin.storage.from('exports').createSignedUrl(objectPath, 3600);
  if (linkError || !link) return fail('server_error', 'Stored but no link could be made.', 500);
  return ok({ url: link.signedUrl, path: objectPath, bytes: pdf.length });
}
