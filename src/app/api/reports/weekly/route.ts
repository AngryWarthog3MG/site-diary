import { fail, ok, requireApiUser, isUuid, isDate } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { WeeklyLoadError } from '@/lib/weekly/load';
import { generateWeeklyReport } from '@/lib/weekly/generate';
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

  let generation;
  try {
    generation = await generateWeeklyReport(
      supabase,
      { id: project.id, name: project.name, code: project.code, orgCode },
      start,
      end,
    );
  } catch (error) {
    if (error instanceof WeeklyLoadError) return fail('bad_request', error.message, 400);
    if (error instanceof BrowserUnavailableError) return fail('server_error', error.message, 501);
    const message = error instanceof Error ? error.message : 'Weekly generation failed.';
    return fail('server_error', message, 500);
  }
  if ('empty' in generation) {
    return fail(
      'not_found',
      'No signed entries in that range. The weekly report only reports the signed record.',
      404,
    );
  }
  if (generation.narrativeFailure) {
    console.error(`weekly narrative failed for ${project.code} ${start}..${end}: ${generation.narrativeFailure}`);
  }
  const objectPath = generation.objectPath;

  const admin = createAdminClient();
  const { data: link, error: linkError } = await admin.storage
    .from(EXPORTS_BUCKET)
    .createSignedUrl(objectPath, LINK_TTL_SECONDS);
  if (linkError || !link) {
    return fail('server_error', 'The PDF was stored but no link could be made.', 500);
  }

  return ok({
    url: link.signedUrl,
    path: objectPath,
    entries: generation.data.counts.entryCount,
    commentary: generation.commentary,
    bytes: generation.pdf.length,
  });
}
