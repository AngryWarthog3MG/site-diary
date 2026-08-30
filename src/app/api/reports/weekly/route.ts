import { fail, ok, requireApiUser, isUuid, isDate } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadWeeklyData, WeeklyLoadError } from '@/lib/weekly/load';
import { generateNarrative } from '@/lib/weekly/narrative';
import { renderWeeklyPdf } from '@/lib/weekly/render';
import { BrowserUnavailableError } from '@/lib/pdf/render';

// Chromium plus a narrative call — the slowest route in the app.
export const maxDuration = 180;
export const runtime = 'nodejs';

const EXPORTS_BUCKET = 'exports';
const LINK_TTL_SECONDS = 60 * 60;

/**
 * Generate the weekly PDF (§6), store it, hand back a shareable link.
 *
 * Reads run under the caller's RLS through the diary views, so the report can
 * only ever contain signed, non-superseded entries from their own projects.
 * The narrative is generated fresh each time — a week's report changes as its
 * entries do, so unlike the daily docket there is no immutable file to reuse —
 * and if the narrative fails its no-invented-numbers check twice, the report
 * ships without commentary rather than with a made-up figure.
 */
export async function POST(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const url = new URL(request.url);
  const projectId = url.searchParams.get('project');
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');

  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  if (!isDate(start) || !isDate(end)) {
    return fail('bad_request', 'start and end must be YYYY-MM-DD dates.', 400);
  }

  // Membership check and project identity in one query, under the caller's RLS.
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, code, org:organisations!inner(code)')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return fail('not_found', 'That project is not on your account.', 404);
  const orgCode = (Array.isArray(project.org) ? project.org[0] : project.org)?.code as string;

  let data;
  try {
    data = await loadWeeklyData(
      supabase,
      { id: project.id, name: project.name, code: project.code, orgCode },
      start,
      end,
    );
  } catch (error) {
    if (error instanceof WeeklyLoadError) return fail('bad_request', error.message, 400);
    throw error;
  }

  if (data.entries.length === 0) {
    return fail(
      'not_found',
      'No signed entries in that range. The weekly report only reports the signed record.',
      404,
    );
  }

  const { result: narrative, rejected } = await generateNarrative(data);
  const narrativeNote = rejected
    ? 'Commentary was withheld: the draft referenced figures not present in the record.'
    : narrative
      ? undefined
      : 'Commentary could not be generated for this report.';

  let pdf: Uint8Array;
  try {
    pdf = await renderWeeklyPdf({
      data,
      narrative: narrative?.narrative ?? null,
      narrativeNote,
    });
  } catch (error) {
    if (error instanceof BrowserUnavailableError) return fail('server_error', error.message, 501);
    const message = error instanceof Error ? error.message : 'PDF rendering failed.';
    return fail('server_error', `Could not render the weekly PDF: ${message}`, 500);
  }

  const admin = createAdminClient();
  const objectPath = `${project.id}/weekly/${start}_${end}.pdf`;
  const { error: uploadError } = await admin.storage
    .from(EXPORTS_BUCKET)
    .upload(objectPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: true });
  if (uploadError) {
    return fail('server_error', `Could not store the weekly PDF: ${uploadError.message}`, 500);
  }

  const { data: link, error: linkError } = await admin.storage
    .from(EXPORTS_BUCKET)
    .createSignedUrl(objectPath, LINK_TTL_SECONDS);
  if (linkError || !link) {
    return fail('server_error', 'The PDF was stored but no link could be made.', 500);
  }

  return ok({
    url: link.signedUrl,
    path: objectPath,
    entries: data.counts.entryCount,
    commentary: narrative != null,
    bytes: pdf.length,
  });
}
