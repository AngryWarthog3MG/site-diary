import { fail, ok, readJson, requireApiUser, isUuid } from '@/lib/api';
import { buildKeyterms } from '@/lib/transcription/glossary';
import { grantLiveToken, listenParams, DEEPGRAM_MODEL } from '@/lib/transcription/deepgram';

/**
 * Mint a short-lived Deepgram token for the live transcript on the recording
 * screen, plus the query string to open the socket with.
 *
 * The live stream is a convenience — it is what makes the section chips light
 * up while the supervisor is still talking. It is never the record: the stored
 * transcript always comes from the batch pass over the complete file.
 *
 * 60 seconds is plenty: the token only has to survive the handshake, and the
 * socket stays open afterwards regardless.
 */
export async function POST(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const body = await readJson(request);
  const projectId = body?.projectId;
  if (!isUuid(projectId)) return fail('bad_request', 'projectId is required.', 400);

  // The browser streams linear16 off its AudioContext, whose rate it does not
  // get to choose reliably — so it tells us, and we tell Deepgram.
  const sampleRate = typeof body?.sampleRate === 'number' ? body.sampleRate : 0;
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
    return fail('bad_request', 'sampleRate must be between 8000 and 96000.', 400);
  }

  // RLS does the membership check: a non-member simply gets no row back.
  const { data: project, error } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .maybeSingle();

  if (error) return fail('server_error', error.message, 500);
  if (!project) return fail('forbidden', 'You are not on that project.', 403);

  const { data: projectTerms } = await supabase.rpc('project_keyterms', {
    p_project_id: projectId,
  });
  const keyterms = buildKeyterms((projectTerms as string[] | null) ?? []);

  try {
    const { accessToken, expiresIn } = await grantLiveToken(60);

    const params = listenParams(keyterms, { sampleRate });
    params.set('interim_results', 'true');
    params.set('endpointing', '400');
    params.delete('paragraphs'); // streaming has no paragraph pass

    return ok({
      accessToken,
      expiresIn,
      model: DEEPGRAM_MODEL,
      // The browser appends access_token itself so the JWT never sits in a log line here.
      query: params.toString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not start live transcription.';
    return fail('server_error', message, 502);
  }
}
