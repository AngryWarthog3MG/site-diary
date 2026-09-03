import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { ToolboxTalkDoc, TALK_CSS, type TalkPdfData } from '@/lib/toolbox/pdf';

export const maxDuration = 300;
export const runtime = 'nodejs';

/**
 * The completed talk as one branded PDF. Reuses the stored copy — a
 * completed talk is immutable, so its document is too.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad talk id.', 400);

  const { data: talk } = await supabase
    .from('toolbox_talks')
    .select(
      `id, project_id, talk_date, topic, summary, presenter_name, completed_at,
       project:projects!inner(name, code, org:organisations!inner(name, code)),
       toolbox_attendees(attendee_name, signature_path, created_at)`,
    )
    .eq('id', id)
    .maybeSingle();
  if (!talk) return fail('not_found', 'That talk is not on any of your projects.', 404);
  if (!talk.completed_at) {
    return fail('bad_request', 'Complete the talk first — the PDF is the frozen record.', 409);
  }

  const admin = createAdminClient();
  const objectPath = `${talk.project_id}/toolbox/${talk.talk_date}-${talk.id}.pdf`;
  const existing = await admin.storage.from('exports').download(objectPath);
  if (existing.data) {
    const { data: link } = await admin.storage.from('exports').createSignedUrl(objectPath, 3600);
    if (link) return ok({ url: link.signedUrl, path: objectPath, reused: true });
  }

  const project = Array.isArray(talk.project) ? talk.project[0] : talk.project;
  const org = Array.isArray(project.org) ? project.org[0] : project.org;

  const attendees: TalkPdfData['attendees'] = [];
  const rows = (talk.toolbox_attendees as Array<{ attendee_name: string; signature_path: string; created_at: string }>).sort(
    (a, b) => a.created_at.localeCompare(b.created_at),
  );
  for (const row of rows) {
    const { data } = await admin.storage.from('entry-photos').download(row.signature_path);
    if (!data) continue;
    const bytes = Buffer.from(await data.arrayBuffer());
    attendees.push({ name: row.attendee_name, src: `data:image/png;base64,${bytes.toString('base64')}` });
  }

  const completed = new Date(Date.parse(talk.completed_at) + 480 * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const completedAtAwst = `${completed.getUTCFullYear()}-${pad(completed.getUTCMonth() + 1)}-${pad(completed.getUTCDate())} ${pad(completed.getUTCHours())}:${pad(completed.getUTCMinutes())} AWST`;

  const data: TalkPdfData = {
    orgName: org.name,
    orgCode: org.code,
    projectName: project.name,
    projectCode: project.code,
    date: talk.talk_date,
    topic: talk.topic,
    summary: talk.summary,
    presenter: talk.presenter_name,
    completedAtAwst,
    attendees,
  };

  let pdf: Uint8Array;
  try {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = [
      '<!doctype html>',
      '<html lang="en-AU"><head><meta charset="utf-8">',
      `<title>Toolbox talk ${talk.talk_date}</title>`,
      `<style>${EMBEDDED_FONT_CSS}</style>`,
      `<style>${DOCKET_CSS}</style>`,
      `<style>${TALK_CSS}</style>`,
      '</head><body>',
      renderToStaticMarkup(ToolboxTalkDoc({ data })),
      '</body></html>',
    ].join('');
    pdf = await renderPdfDocument(html, {
      title: `Toolbox talk ${talk.talk_date} — ${talk.topic}`,
      author: org.name,
      subject: `${project.name} — toolbox talk, ${talk.talk_date}`,
      keywords: [org.code, project.code, talk.talk_date, 'toolbox'],
      instant: new Date(talk.completed_at),
      idSeed: talk.id.replace(/-/g, ''),
      footerLeft: `${org.code}_${project.code} · TOOLBOX · ${talk.talk_date}`,
    });
  } catch (error) {
    if (error instanceof BrowserUnavailableError) return fail('server_error', error.message, 501);
    const message = error instanceof Error ? error.message : 'PDF rendering failed.';
    return fail('server_error', `Could not render the talk: ${message}`, 500);
  }

  const { error: uploadError } = await admin.storage
    .from('exports')
    .upload(objectPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false });
  if (uploadError && !/exists/i.test(uploadError.message)) {
    return fail('server_error', `Could not store the talk PDF: ${uploadError.message}`, 500);
  }
  const { data: link, error: linkError } = await admin.storage
    .from('exports')
    .createSignedUrl(objectPath, 3600);
  if (linkError || !link) return fail('server_error', 'Stored but no link could be made.', 500);

  return ok({ url: link.signedUrl, path: objectPath, attendees: attendees.length, bytes: pdf.length });
}
