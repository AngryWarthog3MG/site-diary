import { fail, ok, readJson, requireApiUser, isUuid } from '@/lib/api';

const MAX_TEXT_CHARS = 20_000;

/**
 * Append typed words to a draft entry's raw transcript.
 *
 * This is deliberately raw capture, not confirmed diary data. Extraction still
 * writes only a proposal, and the supervisor review remains the only path into
 * the record tables.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const { id: entryId } = await context.params;
  if (!isUuid(entryId)) {
    return fail('bad_request', 'Bad entry id.', 400);
  }

  const body = await readJson(request);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const clientRef = typeof body?.clientRef === 'string' && body.clientRef ? body.clientRef : null;
  const writtenAt = typeof body?.writtenAt === 'string' ? body.writtenAt : null;

  if (!text) {
    return fail('bad_request', 'Text is required.', 400);
  }
  if (!clientRef) {
    return fail('bad_request', 'clientRef is required so a retried note is not doubled.', 400);
  }
  if (text.length > MAX_TEXT_CHARS) {
    return fail('bad_request', `Text is too long. Keep each note under ${MAX_TEXT_CHARS} characters.`, 400);
  }

  const { data: entry, error: entryError } = await supabase
    .from('entries')
    .select('id, status, author_id')
    .eq('id', entryId)
    .maybeSingle();

  if (entryError) return fail('server_error', entryError.message, 500);
  if (!entry) return fail('not_found', 'That entry is not on any of your projects.', 404);
  if (entry.status === 'signed') {
    return fail('entry_signed', 'That entry is signed. Text cannot be added to it.', 409);
  }
  if (entry.author_id !== user.id) {
    return fail('forbidden', 'That entry belongs to another supervisor.', 403);
  }

  // A first-class segment, not a string append: transcript_raw is derived
  // (the audio rollup rebuilds it), so appending to it directly meant the
  // next voice recording erased the typed words. The unique (entry_id,
  // client_ref) key makes a retried request a no-op instead of a duplicate.
  const { error: insertError } = await supabase.from('entry_text').upsert(
    { entry_id: entry.id, client_ref: clientRef, body: text, written_at: writtenAt },
    { onConflict: 'entry_id,client_ref', ignoreDuplicates: true },
  );

  if (insertError) return fail('server_error', insertError.message, 500);

  return ok({ entryId: entry.id, characters: text.length });
}
