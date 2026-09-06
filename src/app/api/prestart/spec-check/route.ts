import { fail, ok, readJson, requireApiUser, isUuid } from '@/lib/api';
import { prestartSpec } from '@/lib/documents/prestart-spec';

export const maxDuration = 90;

/**
 * What the specification requires for the work planned at a prestart.
 * Read only here; the form stores what the supervisor keeps.
 */
export async function POST(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;
  const body = await readJson(request);
  const projectId = typeof body?.projectId === 'string' ? body.projectId : '';
  const work = typeof body?.work === 'string' ? body.work.trim().slice(0, 2000) : '';
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  if (!work) return fail('bad_request', 'Say what is on today first.', 400);
  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).maybeSingle();
  if (!project) return fail('not_found', 'That project is not one of yours.', 404);
  try {
    return ok(await prestartSpec(supabase, projectId, work));
  } catch (error) {
    return fail('server_error', error instanceof Error ? error.message : 'The spec lookup failed.', 500);
  }
}
