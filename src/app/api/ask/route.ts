import { fail, ok, readJson, requireApiUser, isUuid } from '@/lib/api';
import { ask, AskError } from '@/lib/query/ask';

export const maxDuration = 120;

/**
 * The Ask endpoint (brief §5, §7.5).
 *
 * Runs entirely under the caller's own RLS: the generated SQL, the full-text
 * search and the row cap all sit behind it. A PM sees their projects, and a
 * question about a project they are not on returns nothing rather than an
 * error that tells them it exists.
 */
export async function POST(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const body = await readJson(request);
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  const projectId = typeof body?.projectId === 'string' ? body.projectId : null;

  if (!question) return fail('bad_request', 'Ask a question first.', 400);
  if (question.length > 1000) {
    return fail('bad_request', 'That question is too long. Try a shorter one.', 400);
  }
  if (projectId && !isUuid(projectId)) {
    return fail('bad_request', 'Bad project id.', 400);
  }

  let projectName: string | null = null;
  if (projectId) {
    const { data } = await supabase
      .from('projects')
      .select('name')
      .eq('id', projectId)
      .maybeSingle();
    if (!data) return fail('forbidden', 'You are not on that project.', 403);
    projectName = data.name as string;
  }

  try {
    return ok(await ask(supabase, question, { projectId, projectName }));
  } catch (error) {
    if (error instanceof AskError) {
      return fail('server_error', error.message, 422, { sql: error.sql });
    }
    return fail('server_error', 'That question could not be answered.', 500);
  }
}
