import { createHash } from 'node:crypto';
import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { finishedAtAwst } from '@/lib/pdf/finished-at';
import { InspectionDoc, INSPECTION_CSS, type InspectionPdfData } from '@/lib/inspections/pdf';
import { readItems, type InspectionKind } from '@/lib/inspections/model';

export const maxDuration = 300;
export const runtime = 'nodejs';

/** A signed inspection with its actions and photos, stored per state. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;
  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad inspection id.', 400);
  const { data: r } = await supabase
    .from('inspections')
    .select('*, project:projects!inner(name, code, org:organisations!inner(name, code)), inspection_actions(item_key, action, owner_name, due_on, done_at, done_note, created_at)')
    .eq('id', id)
    .maybeSingle();
  if (!r) return fail('not_found', 'That inspection is not on any of your projects.', 404);
  if (!r.completed_at) return fail('bad_request', 'Sign the inspection first — the PDF is the frozen record.', 409);
  const project = Array.isArray(r.project) ? r.project[0] : r.project;
  const org = Array.isArray(project.org) ? project.org[0] : project.org;
  const admin = createAdminClient();
  const actions = ((r.inspection_actions ?? []) as Array<{ item_key: string | null; action: string; owner_name: string | null; due_on: string | null; done_at: string | null; done_note: string | null; created_at: string }>)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const stateHash = createHash('sha256').update(JSON.stringify({ c: r.completed_at, a: actions })).digest('hex');
  const objectPath = `${r.project_id}/inspection/${r.id}-${stateHash.slice(0, 8)}.pdf`;
  const existing = await admin.storage.from('exports').download(objectPath);
  if (existing.data) {
    const { data: link } = await admin.storage.from('exports').createSignedUrl(objectPath, 3600);
    if (link) return ok({ url: link.signedUrl, path: objectPath, reused: true });
  }
  const dataUri = async (path: string) => {
    const { data } = await admin.storage.from('entry-photos').download(path);
    if (!data) return null;
    const bytes = Buffer.from(await data.arrayBuffer());
    return `data:${data.type || 'image/jpeg'};base64,${bytes.toString('base64')}`;
  };
  const items: InspectionPdfData['items'] = [];
  for (const i of readItems(r.items)) {
    const photos: Array<{ src: string }> = [];
    for (const p of i.photo_urls) { const src = await dataUri(p); if (src) photos.push({ src }); }
    items.push({ ...i, photos });
  }
  const signature = r.signature_path ? await dataUri(r.signature_path as string) : null;
  const latest = [r.completed_at as string, ...actions.map((a) => a.done_at), ...actions.map((a) => a.created_at)].filter((v): v is string => Boolean(v)).sort().at(-1);
  const instant = new Date(latest ?? (r.completed_at as string));
  const data: InspectionPdfData = {
    orgName: org.name, orgCode: org.code, projectName: project.name, projectCode: project.code,
    template_name: r.template_name, kind: r.kind as InspectionKind, date: r.inspection_date, area: r.area, inspector: r.inspector_name,
    items, summary: r.summary, completedAwst: finishedAtAwst(r.completed_at as string, r.completed_on_device_at as string | null),
    actions: actions.map((a) => ({ item_key: a.item_key, action: a.action, owner: a.owner_name, due: a.due_on, done_at: a.done_at, done_note: a.done_note })),
    signature, printedAwst: finishedAtAwst(instant.toISOString(), null),
  };
  let pdf: Uint8Array;
  try {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = ['<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">', `<title>Inspection ${r.inspection_date}</title>`,
      `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`, `<style>${INSPECTION_CSS}</style>`, '</head><body>',
      renderToStaticMarkup(InspectionDoc({ data })), '</body></html>'].join('');
    pdf = await renderPdfDocument(html, {
      title: `${r.template_name} ${r.inspection_date} — ${project.name}`, author: org.name,
      subject: `${project.name} — inspection, ${r.inspection_date}`, keywords: [org.code, project.code, r.inspection_date, 'inspection'],
      instant, idSeed: stateHash, footerLeft: `${org.code}_${project.code} · INSPECTION · ${r.inspection_date}`,
    });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not render the inspection: ${err instanceof Error ? err.message : 'PDF rendering failed.'}`, 500);
  }
  const { error: uploadError } = await admin.storage.from('exports').upload(objectPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false });
  if (uploadError && !/exists/i.test(uploadError.message)) return fail('server_error', `Could not store the PDF: ${uploadError.message}`, 500);
  const { data: link, error: linkError } = await admin.storage.from('exports').createSignedUrl(objectPath, 3600);
  if (linkError || !link) return fail('server_error', 'Stored but no link could be made.', 500);
  return ok({ url: link.signedUrl, path: objectPath, bytes: pdf.length });
}
