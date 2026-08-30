import { fail, ok, requireApiUser, isUuid, readJson } from '@/lib/api';
import { ReviewPayload } from '@/lib/review/schema';

/**
 * Sign the entry.
 *
 * Takes the payload too, and applies it first, so what the supervisor is
 * looking at when they press the button is exactly what gets signed — rather
 * than whatever happened to be saved last. Once signed the entry is immutable
 * for good, so "the screen said one thing and the record says another" is not
 * a gap worth leaving open.
 *
 * The database does the rest: it refuses the transition while blocking gaps
 * remain, issues the serial, sets the signature and computes the content hash.
 * None of that is decided here.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const { id: entryId } = await context.params;
  if (!isUuid(entryId)) return fail('bad_request', 'Bad entry id.', 400);

  const body = await readJson(request);
  const parsed = ReviewPayload.safeParse(body ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail('bad_request', `${first.path.join('.') || 'payload'}: ${first.message}`, 400);
  }

  const { error: applyError } = await supabase.rpc('apply_entry_review', {
    p_entry_id: entryId,
    p_payload: parsed.data,
  });

  if (applyError) {
    if (applyError.code === '42501') {
      return fail('forbidden', 'That entry is not an open draft of yours.', 403);
    }
    return fail('server_error', applyError.message, 500);
  }

  const { data: signed, error: signError } = await supabase
    .from('entries')
    .update({ status: 'signed' })
    .eq('id', entryId)
    .select('id, entry_no, content_hash, signed_at, signed_by, entry_date')
    .single();

  if (signError) {
    // The immutability trigger raises check_violation when gaps remain. Hand
    // the supervisor the reason rather than a database error.
    if (signError.message.includes('blocking gaps remain')) {
      return fail(
        'bad_request',
        signError.message.replace(/^.*blocking gaps remain: /, 'Still to do: '),
        409,
      );
    }
    if (signError.message.includes('is signed and cannot be modified')) {
      return fail('entry_signed', 'That entry has already been signed.', 409);
    }
    return fail('server_error', signError.message, 500);
  }

  await supabase
    .from('entry_extractions')
    .update({ status: 'applied', applied_at: new Date().toISOString(), applied_by: user.id })
    .eq('entry_id', entryId)
    .eq('status', 'pending');

  return ok({ entry: signed });
}
