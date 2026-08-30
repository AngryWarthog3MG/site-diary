import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { buildKeyterms } from '@/lib/transcription/glossary';
import { transcribeAudio, TranscriptionError } from '@/lib/transcription/deepgram';

// A 90-second recording turns around in a few seconds, but a phone draining a
// backlog can hand over several at once.
export const maxDuration = 120;

/**
 * Transcribe every segment of an entry that has not been transcribed yet.
 *
 * Safe to call repeatedly — that is how the offline queue retries. Segments
 * already `done` are left alone; `failed` ones are attempted again.
 *
 * Runs entirely under the caller's own RLS: the audio is downloaded with their
 * session, the transcript is written to their own draft. The Deepgram key is
 * the only thing that stays on the server.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const { id: entryId } = await context.params;
  if (!isUuid(entryId)) return fail('bad_request', 'Bad entry id.', 400);

  const { data: entry, error: entryError } = await supabase
    .from('entries')
    .select('id, project_id, status, author_id')
    .eq('id', entryId)
    .maybeSingle();

  if (entryError) return fail('server_error', entryError.message, 500);
  if (!entry) return fail('not_found', 'That entry is not on any of your projects.', 404);
  if (entry.status === 'signed') {
    return fail('entry_signed', 'That entry is signed and cannot be re-transcribed.', 409);
  }
  if (entry.author_id !== user.id) {
    return fail('forbidden', 'That entry belongs to another supervisor.', 403);
  }

  const { data: segments, error: segmentsError } = await supabase
    .from('entry_audio')
    .select('id, seq, url, mime_type, transcript_status')
    .eq('entry_id', entry.id)
    .in('transcript_status', ['pending', 'processing', 'failed'])
    .order('seq');

  if (segmentsError) return fail('server_error', segmentsError.message, 500);
  if (!segments?.length) {
    return ok({ transcribed: 0, failed: 0, message: 'Nothing left to transcribe.' });
  }

  // One vocabulary lookup for the whole batch.
  const { data: projectTerms } = await supabase.rpc('project_keyterms', {
    p_project_id: entry.project_id,
  });
  const keyterms = buildKeyterms((projectTerms as string[] | null) ?? []);

  let transcribed = 0;
  let failed = 0;

  for (const segment of segments) {
    await supabase
      .from('entry_audio')
      .update({ transcript_status: 'processing', transcript_error: null })
      .eq('id', segment.id);

    try {
      const { data: file, error: downloadError } = await supabase.storage
        .from('entry-audio')
        .download(segment.url);

      if (downloadError || !file) {
        throw new TranscriptionError(downloadError?.message ?? 'Audio file is missing.');
      }

      const result = await transcribeAudio(
        await file.arrayBuffer(),
        segment.mime_type,
        keyterms,
      );

      await supabase
        .from('entry_audio')
        .update({
          transcript: result.transcript,
          transcript_status: 'done',
          transcript_provider: result.provider,
          transcript_error: null,
          transcribed_at: new Date().toISOString(),
        })
        .eq('id', segment.id);

      transcribed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transcription failed.';
      await supabase
        .from('entry_audio')
        .update({ transcript_status: 'failed', transcript_error: message.slice(0, 500) })
        .eq('id', segment.id);
      failed += 1;
    }
  }

  const { data: refreshed } = await supabase
    .from('entries')
    .select('transcript_raw')
    .eq('id', entry.id)
    .single();

  return ok({
    transcribed,
    failed,
    transcript: refreshed?.transcript_raw ?? null,
  });
}
