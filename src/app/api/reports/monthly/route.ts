import { roleOn } from '@/lib/api-role';
import { canExportReports } from '@/lib/roles';
import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { MonthlyLoadError } from '@/lib/monthly/bundle';
import { generateMonthlyBundle } from '@/lib/monthly/generate';
import { BrowserUnavailableError } from '@/lib/pdf/render';

// Potentially a whole month of dockets; most are reused from storage, but a
// backlog of never-exported entries can mean many renders in one request.
export const maxDuration = 300;
export const runtime = 'nodejs';

const LINK_TTL_SECONDS = 60 * 60;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The monthly bundle: a cover index and every signed docket in the month,
 * bound in as many parts as keep each file under the storage limit (README
 * R71). Reads run under the caller's RLS; the building and storing is
 * `generateMonthlyBundle`, the same code the first-of-month email uses.
 */
export async function POST(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const url = new URL(request.url);
  const projectId = url.searchParams.get('project');
  const month = url.searchParams.get('month');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  if (!month || !MONTH_RE.test(month)) {
    return fail('bad_request', 'month must be YYYY-MM.', 400);
  }

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, code, org:organisations!inner(code)')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return fail('not_found', 'That project is not on your account.', 404);
  const role = await roleOn(supabase, projectId, user.id);
  if (!role || !canExportReports(role)) return fail('forbidden', 'Your role on this job does not include exports.', 403);
  const orgCode = (Array.isArray(project.org) ? project.org[0] : project.org)?.code as string;

  let generation;
  try {
    generation = await generateMonthlyBundle(
      supabase,
      { id: project.id, name: project.name, code: project.code, orgCode },
      month,
    );
  } catch (error) {
    if (error instanceof MonthlyLoadError) return fail('bad_request', error.message, 400);
    if (error instanceof BrowserUnavailableError) return fail('server_error', error.message, 501);
    const message = error instanceof Error ? error.message : 'Bundling failed.';
    return fail('server_error', `Could not build the monthly bundle: ${message}`, 500);
  }
  if ('empty' in generation) {
    return fail('not_found', 'No signed entries in that month — nothing to bundle.', 404);
  }

  const admin = createAdminClient();
  const volumes = [];
  for (const volume of generation.volumes) {
    const { data: link, error: linkError } = await admin.storage
      .from('exports')
      .createSignedUrl(volume.objectPath, LINK_TTL_SECONDS);
    if (linkError || !link) {
      return fail('server_error', `Part ${volume.part} was stored but no link could be made.`, 500);
    }
    volumes.push({ part: volume.part, of: volume.of, url: link.signedUrl, path: volume.objectPath, bytes: volume.bytes, from: volume.from, to: volume.to, entries: volume.entryNos.length });
  }

  return ok({
    url: volumes[0].url,
    path: volumes[0].path,
    volumes,
    entries: generation.data.entries.length,
    bytes: volumes.reduce((sum, v) => sum + v.bytes, 0),
  });
}
