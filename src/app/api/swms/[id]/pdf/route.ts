import { createHash } from 'node:crypto';
import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { finishedAtAwst } from '@/lib/pdf/finished-at';
import { SwmsDoc, SWMS_CSS, type SwmsPdfData } from '@/lib/swms/pdf';
import { readSteps, type SwmsKind } from '@/lib/swms/model';

export const maxDuration = 300;
export const runtime = 'nodejs';

/**
 * A method statement in use (or retired) with its sign-ons, as one PDF. The
 * content of a version is frozen; the sign-on list grows, so each print is
 * stored under the state it captured and an identical state reuses its file.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;
  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad SWMS id.', 400);

  const { data: row } = await supabase
    .from('swms')
    .select('*, project:projects!inner(name, code, org:organisations!inner(name, code)), swms_signons(id, attendee_name, signature_path, signed_on_device_at)')
    .eq('id', id)
    .maybeSingle();
  if (!row) return fail('not_found', 'That SWMS is not on any of your projects.', 404);
  if (row.status === 'draft') return fail('bad_request', 'Put it into use first — a draft is not a document yet.', 409);

  const project = Array.isArray(row.project) ? row.project[0] : row.project;
  const org = Array.isArray(project.org) ? project.org[0] : project.org;
  const admin = createAdminClient();
  const signonRows = ((row.swms_signons ?? []) as Array<{ id: string; attendee_name: string; signature_path: string; signed_on_device_at: string }>)
    .sort((a, b) => a.signed_on_device_at.localeCompare(b.signed_on_device_at));
  const stateHash = createHash('sha256').update(JSON.stringify({ v: row.updated_at, s: signonRows.map((s) => s.id) })).digest('hex');
  const objectPath = `${row.project_id}/swms/${row.id}-v${row.version}-${stateHash.slice(0, 8)}.pdf`;
  const existing = await admin.storage.from('exports').download(objectPath);
  if (existing.data) {
    const { data: link } = await admin.storage.from('exports').createSignedUrl(objectPath, 3600);
    if (link) return ok({ url: link.signedUrl, path: objectPath, reused: true });
  }

  const signons: SwmsPdfData['signons'] = [];
  for (const s of signonRows) {
    const { data } = await admin.storage.from('entry-photos').download(s.signature_path);
    if (!data) continue;
    const bytes = Buffer.from(await data.arrayBuffer());
    signons.push({ name: s.attendee_name, src: `data:image/png;base64,${bytes.toString('base64')}`, date: s.signed_on_device_at });
  }
  const latest = [row.activated_at as string | null, ...signonRows.map((s) => s.signed_on_device_at)].filter((v): v is string => Boolean(v)).sort().at(-1);
  const instant = new Date(latest ?? (row.updated_at as string));

  const data: SwmsPdfData = {
    orgName: org.name, orgCode: org.code, projectName: project.name, projectCode: project.code,
    kind: row.kind as SwmsKind, title: row.title, version: row.version, status: row.status,
    activity: row.activity ?? null, hrcw: row.hrcw ?? [], ppe: row.ppe ?? [], permits: row.permits ?? null,
    plant: row.plant ?? null, legislation: row.legislation ?? null, prepared_by: row.prepared_by ?? null,
    reviewed_by: row.reviewed_by ?? null,
    activatedAwst: row.activated_at ? finishedAtAwst(row.activated_at as string, null) : null,
    steps: readSteps(row.steps), signons, printedAwst: finishedAtAwst(instant.toISOString(), null),
  };

  let pdf: Uint8Array;
  try {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = [
      '<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">',
      `<title>${data.kind.toUpperCase()} ${row.title}</title>`,
      `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`, `<style>${SWMS_CSS}</style>`,
      '</head><body>', renderToStaticMarkup(SwmsDoc({ data })), '</body></html>',
    ].join('');
    pdf = await renderPdfDocument(html, {
      title: `${data.kind.toUpperCase()} v${row.version} — ${row.title}`,
      author: org.name,
      subject: `${project.name} — ${data.kind.toUpperCase()}: ${row.title}`,
      keywords: [org.code, project.code, data.kind, `v${row.version}`],
      instant,
      idSeed: stateHash,
      footerLeft: `${org.code}_${project.code} · ${data.kind.toUpperCase()} v${row.version} · ${row.title.slice(0, 40)}`,
    });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not render the ${data.kind.toUpperCase()}: ${err instanceof Error ? err.message : 'PDF rendering failed.'}`, 500);
  }

  const { error: uploadError } = await admin.storage.from('exports').upload(objectPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false });
  if (uploadError && !/exists/i.test(uploadError.message)) return fail('server_error', `Could not store the PDF: ${uploadError.message}`, 500);
  const { data: link, error: linkError } = await admin.storage.from('exports').createSignedUrl(objectPath, 3600);
  if (linkError || !link) return fail('server_error', 'Stored but no link could be made.', 500);
  return ok({ url: link.signedUrl, path: objectPath, signons: signons.length, bytes: pdf.length });
}
