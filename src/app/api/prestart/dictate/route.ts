import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { canRunTalks } from '@/lib/roles';
import type { MemberRole } from '@/types/database';
import { buildKeyterms } from '@/lib/transcription/glossary';
import { explainModelError } from '@/lib/model-error';
import { TranscriptionError } from '@/lib/transcription/deepgram';
import { dictatePrestart } from '@/lib/prestart/dictate';

export const maxDuration = 120;

/** A briefing under ten minutes; anything longer is a toolbox talk. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Turn a spoken prestart briefing into the form's fields. Nothing is stored
 * here — the form shows the result for the supervisor to edit and save.
 * Only a role that runs prestarts may call it.
 */
export async function POST(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail('bad_request', 'Send the recording as a form upload.', 400);
  }
  const projectId = form.get('projectId');
  const audio = form.get('audio');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  if (!(audio instanceof Blob) || audio.size === 0) return fail('bad_request', 'No recording was sent.', 400);
  if (audio.size > MAX_BYTES) return fail('bad_request', 'That recording is too long for a prestart.', 400);

  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) return fail('not_found', 'That project is not one of yours.', 404);
  if (!canRunTalks(membership.role as MemberRole)) {
    return fail('forbidden', 'Prestarts are run by the supervisor or leading hand.', 403);
  }

  const { data: terms } = await supabase.rpc('project_keyterms', { p_project_id: projectId });
  const keyterms = buildKeyterms((terms as string[] | null) ?? []);

  try {
    const result = await dictatePrestart(await audio.arrayBuffer(), audio.type || null, keyterms);
    if (!result.transcript) {
      return fail('bad_request', 'Nothing was heard in that recording. Try again a little closer to the phone.', 422);
    }
    return ok(result);
  } catch (error) {
    if (error instanceof TranscriptionError) {
      return fail('server_error', 'The recording could not be turned into words just now. Nothing is lost; try again in a minute.', 503);
    }
    const plain = explainModelError(error);
    return fail('server_error', plain.message, plain.retryable ? 503 : 422);
  }
}
