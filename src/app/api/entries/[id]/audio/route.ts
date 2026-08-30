import { fail, ok, readJson, requireApiUser, isUuid } from '@/lib/api';

/**
 * Register an uploaded recording against a draft entry.
 *
 * The blob itself goes straight from the phone to Supabase Storage under the
 * caller's own RLS — this route only records that it arrived. Split in two on
 * purpose: once the segment row exists the recording is safe, and
 * transcription can fail and be retried without risking the audio.
 *
 * `clientRef` is the offline queue's local id. The unique index on
 * (entry_id, client_ref) means a phone that resends because it never saw the
 * first response gets the same segment back, not a duplicate.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const { id: entryId } = await context.params;
  if (!isUuid(entryId)) {
    return fail('bad_request', 'Bad entry id.', 400);
  }

  const body = await readJson(request);
  const clientRef = body?.clientRef;
  const storagePath = body?.storagePath;
  const mimeType = typeof body?.mimeType === 'string' ? body.mimeType : null;
  const durationMs = typeof body?.durationMs === 'number' ? Math.round(body.durationMs) : null;
  const recordedAt = typeof body?.recordedAt === 'string' ? body.recordedAt : null;

  if (typeof clientRef !== 'string' || clientRef.length < 6 || clientRef.length > 100) {
    return fail('bad_request', 'clientRef is required.', 400);
  }
  if (typeof storagePath !== 'string' || !storagePath) {
    return fail('bad_request', 'storagePath is required.', 400);
  }

  const { data: entry, error: entryError } = await supabase
    .from('entries')
    .select('id, project_id, status, author_id')
    .eq('id', entryId)
    .maybeSingle();

  if (entryError) return fail('server_error', entryError.message, 500);
  if (!entry) return fail('not_found', 'That entry is not on any of your projects.', 404);
  if (entry.status === 'signed') {
    return fail('entry_signed', 'That entry is signed. Recordings cannot be added to it.', 409);
  }
  if (entry.author_id !== user.id) {
    return fail('forbidden', 'That entry belongs to another supervisor.', 403);
  }

  // The storage policies already scope writes by project and draft ownership;
  // this stops a valid path for one entry being registered against another.
  const expectedPrefix = `${entry.project_id}/${entry.id}/`;
  if (!storagePath.startsWith(expectedPrefix) || storagePath.includes('..')) {
    return fail('bad_request', 'storagePath does not belong to this entry.', 400);
  }

  const { error: upsertError } = await supabase.from('entry_audio').upsert(
    {
      entry_id: entry.id,
      url: storagePath,
      mime_type: mimeType,
      duration_ms: durationMs,
      recorded_at: recordedAt,
      client_ref: clientRef,
    },
    { onConflict: 'entry_id,client_ref', ignoreDuplicates: true },
  );

  if (upsertError) return fail('server_error', upsertError.message, 500);

  const { data: segment, error: selectError } = await supabase
    .from('entry_audio')
    .select('id, seq, transcript_status')
    .eq('entry_id', entry.id)
    .eq('client_ref', clientRef)
    .single();

  if (selectError) return fail('server_error', selectError.message, 500);

  return ok({
    segmentId: segment.id,
    seq: segment.seq,
    transcriptStatus: segment.transcript_status,
  });
}
