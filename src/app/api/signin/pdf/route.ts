import { createHash } from 'node:crypto';
import { fail, ok, requireApiUser, isUuid, isDate } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { finishedAtAwst } from '@/lib/pdf/finished-at';
import { SignInDoc, SIGNIN_CSS, type SignInPdfData } from '@/lib/signin/pdf';
import type { SignInRow } from '@/lib/signin/register';

export const maxDuration = 300;
export const runtime = 'nodejs';

/**
 * The day's attendance register as a PDF. Not a frozen document: the day is
 * still moving until the last person signs out, so this renders what the
 * register holds now and replaces the stored copy. The rows themselves are
 * frozen one by one as people sign out.
 */
export async function POST(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const url = new URL(request.url);
  const projectId = url.searchParams.get('project');
  const date = url.searchParams.get('date');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  if (!isDate(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    return fail('bad_request', 'date must be a real YYYY-MM-DD date.', 400);
  }

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, code, org:organisations!inner(name, code)')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return fail('not_found', 'That project is not on your account.', 404);
  const org = (Array.isArray(project.org) ? project.org[0] : project.org) as { name: string; code: string };

  const { data: rows, error } = await supabase
    .from('site_signins')
    .select('id, person_name, company, person_kind, inducted, signed_in_at, signed_in_on_device_at, signed_out_at, signed_out_on_device_at')
    .eq('project_id', projectId)
    .eq('signin_date', date)
    .order('signed_in_on_device_at');
  if (error) return fail('server_error', error.message, 500);
  const list = (rows ?? []) as SignInRow[];

  // The document's instant is the latest event on the day, never the clock.
  const latest = list
    .flatMap((r) => [r.signed_in_at, r.signed_out_at])
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);
  const instant = latest ? new Date(latest) : new Date(`${date}T00:00:00Z`);
  // One stored file per state of the register: a roll call printed during an
  // incident stays reproducible at its path after the gate moves on.
  const stateHash = createHash('sha256').update(JSON.stringify(list)).digest('hex');
  const data: SignInPdfData = {
    orgName: org.name,
    orgCode: org.code,
    projectName: project.name,
    projectCode: project.code,
    date,
    rows: list,
    printedAwst: finishedAtAwst(instant.toISOString(), null),
  };

  let pdf: Uint8Array;
  try {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = [
      '<!doctype html>',
      '<html lang="en-AU"><head><meta charset="utf-8">',
      `<title>Site attendance ${date}</title>`,
      `<style>${EMBEDDED_FONT_CSS}</style>`,
      `<style>${DOCKET_CSS}</style>`,
      `<style>${SIGNIN_CSS}</style>`,
      '</head><body>',
      renderToStaticMarkup(SignInDoc({ data })),
      '</body></html>',
    ].join('');
    pdf = await renderPdfDocument(html, {
      title: `Site attendance ${date} — ${project.name}`,
      author: org.name,
      subject: `${project.name} — site attendance register, ${date}`,
      keywords: [org.code, project.code, date, 'attendance'],
      instant,
      idSeed: stateHash,
      footerLeft: `${org.code}_${project.code} · ATTENDANCE · ${date}`,
    });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not render the register: ${err instanceof Error ? err.message : 'PDF rendering failed.'}`, 500);
  }

  const admin = createAdminClient();
  const objectPath = `${projectId}/signin/${date}-${stateHash.slice(0, 8)}.pdf`;
  const { error: uploadError } = await admin.storage
    .from('exports')
    .upload(objectPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false });
  if (uploadError && !/exists/i.test(uploadError.message)) {
    return fail('server_error', `Could not store the register: ${uploadError.message}`, 500);
  }
  const { data: link, error: linkError } = await admin.storage.from('exports').createSignedUrl(objectPath, 3600);
  if (linkError || !link) return fail('server_error', 'Stored but no link could be made.', 500);
  return ok({ url: link.signedUrl, path: objectPath, people: list.length, bytes: pdf.length });
}
