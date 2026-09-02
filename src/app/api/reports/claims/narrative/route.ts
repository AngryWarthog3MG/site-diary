import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { loadClaimsData, ClaimsLoadError } from '@/lib/claims/load';
import { draftClaimNarrative } from '@/lib/claims/narrative';

export const maxDuration = 120;
export const runtime = 'nodejs';

/**
 * Draft a claim skeleton from the register. Costs a model call, so it runs
 * on demand only; the output is labelled a draft and never stored — the
 * signed entries remain the record, the draft is a working document.
 */
export async function POST(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const url = new URL(request.url);
  const projectId = url.searchParams.get('project');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, code, org:organisations!inner(code)')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return fail('not_found', 'That project is not on your account.', 404);
  const orgCode = (Array.isArray(project.org) ? project.org[0] : project.org)?.code as string;

  let data;
  try {
    data = await loadClaimsData(supabase, {
      id: project.id,
      name: project.name,
      code: project.code,
      orgCode,
    });
  } catch (error) {
    if (error instanceof ClaimsLoadError) return fail('bad_request', error.message, 400);
    throw error;
  }
  if (data.delays.rows.length + data.variations.rows.length + data.dayworks.rows.length === 0) {
    return fail('not_found', 'Nothing on the claims register yet.', 404);
  }

  const { draft, rejected, failure } = await draftClaimNarrative(data);
  if (!draft) {
    if (failure) console.error(`claim narrative failed for ${project.code}: ${failure}`);
    return fail(
      'server_error',
      rejected
        ? 'The draft referenced figures not on the register and was withheld. Try again.'
        : 'The draft could not be generated. Try again.',
      502,
    );
  }
  return ok({ draft });
}
