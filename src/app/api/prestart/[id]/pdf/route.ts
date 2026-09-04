import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { PrestartDoc, PRESTART_CSS, type PrestartPdfData } from '@/lib/prestart/pdf';
import { readChecklist } from '@/lib/prestart/checklist';

export const maxDuration = 300;
export const runtime = 'nodejs';

/**
 * The finished prestart as one branded PDF. Reuses the stored copy — a
 * finished prestart is immutable, so its document is too.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad prestart id.', 400);

  const { data: row } = await supabase
    .from('prestarts')
    .select(
      `id, project_id, prestart_date, supervisor_name, work_planned, hazards, plant, permits, notes,
       checklist, completed_at,
       project:projects!inner(name, code, org:organisations!inner(name, code)),
       prestart_attendees(attendee_name, fit_for_work, signature_path, created_at)`,
    )
    .eq('id', id)
    .maybeSingle();
  if (!row) return fail('not_found', 'That prestart is not on any of your projects.', 404);
  if (!row.completed_at) {
    return fail('bad_request', 'Finish the prestart first — the PDF is the frozen record.', 409);
  }

  const admin = createAdminClient();
  const objectPath = `${row.project_id}/prestart/${row.prestart_date}-${row.id}.pdf`;
  const existing = await admin.storage.from('exports').download(objectPath);
  if (existing.data) {
    const { data: link } = await admin.storage.from('exports').createSignedUrl(objectPath, 3600);
    if (link) return ok({ url: link.signedUrl, path: objectPath, reused: true });
  }

  const project = Array.isArray(row.project) ? row.project[0] : row.project;
  const org = Array.isArray(project.org) ? project.org[0] : project.org;

  const attendees: PrestartPdfData['attendees'] = [];
  const rows = (
    row.prestart_attendees as Array<{
      attendee_name: string;
      fit_for_work: boolean;
      signature_path: string;
      created_at: string;
    }>
  ).sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const a of rows) {
    const { data } = await admin.storage.from('entry-photos').download(a.signature_path);
    if (!data) continue;
    const bytes = Buffer.from(await data.arrayBuffer());
    attendees.push({
      name: a.attendee_name,
      fit: a.fit_for_work,
      src: `data:image/png;base64,${bytes.toString('base64')}`,
    });
  }

  const completed = new Date(Date.parse(row.completed_at) + 480 * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const completedAtAwst = `${completed.getUTCFullYear()}-${pad(completed.getUTCMonth() + 1)}-${pad(completed.getUTCDate())} ${pad(completed.getUTCHours())}:${pad(completed.getUTCMinutes())} AWST`;

  const data: PrestartPdfData = {
    orgName: org.name,
    orgCode: org.code,
    projectName: project.name,
    projectCode: project.code,
    date: row.prestart_date,
    supervisor: row.supervisor_name,
    workPlanned: row.work_planned,
    hazards: row.hazards,
    plant: row.plant ?? null,
    permits: row.permits ?? null,
    notes: row.notes ?? null,
    checklist: readChecklist(row.checklist),
    completedAtAwst,
    attendees,
  };

  let pdf: Uint8Array;
  try {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = [
      '<!doctype html>',
      '<html lang="en-AU"><head><meta charset="utf-8">',
      `<title>Prestart ${row.prestart_date}</title>`,
      `<style>${EMBEDDED_FONT_CSS}</style>`,
      `<style>${DOCKET_CSS}</style>`,
      `<style>${PRESTART_CSS}</style>`,
      '</head><body>',
      renderToStaticMarkup(PrestartDoc({ data })),
      '</body></html>',
    ].join('');
    pdf = await renderPdfDocument(html, {
      title: `Prestart ${row.prestart_date} — ${project.name}`,
      author: org.name,
      subject: `${project.name} — daily prestart, ${row.prestart_date}`,
      keywords: [org.code, project.code, row.prestart_date, 'prestart'],
      instant: new Date(row.completed_at),
      idSeed: row.id.replace(/-/g, ''),
      footerLeft: `${org.code}_${project.code} · PRESTART · ${row.prestart_date}`,
    });
  } catch (error) {
    if (error instanceof BrowserUnavailableError) return fail('server_error', error.message, 501);
    const message = error instanceof Error ? error.message : 'PDF rendering failed.';
    return fail('server_error', `Could not render the prestart: ${message}`, 500);
  }

  const { error: uploadError } = await admin.storage
    .from('exports')
    .upload(objectPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false });
  if (uploadError && !/exists/i.test(uploadError.message)) {
    return fail('server_error', `Could not store the prestart PDF: ${uploadError.message}`, 500);
  }
  const { data: link, error: linkError } = await admin.storage
    .from('exports')
    .createSignedUrl(objectPath, 3600);
  if (linkError || !link) return fail('server_error', 'Stored but no link could be made.', 500);

  return ok({ url: link.signedUrl, path: objectPath, attendees: attendees.length, bytes: pdf.length });
}
