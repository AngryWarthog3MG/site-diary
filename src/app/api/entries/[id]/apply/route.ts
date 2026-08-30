import { fail, ok, requireApiUser, isUuid, readJson } from '@/lib/api';
import { ReviewPayload } from '@/lib/review/schema';

/**
 * Commit what the supervisor confirmed on the review screen.
 *
 * This is the point brief non-negotiable #1 is about — up to here the model's
 * output has been a proposal sitting in `entry_extractions`; this is where a
 * person turns it into the record.
 *
 * The write itself is a single database function, so it is one transaction: a
 * failure halfway cannot leave a draft with this morning's labour deleted and
 * this afternoon's not yet written.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const { id: entryId } = await context.params;
  if (!isUuid(entryId)) return fail('bad_request', 'Bad entry id.', 400);

  const body = await readJson(request);
  const parsed = ReviewPayload.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(
      'bad_request',
      `${first.path.join('.') || 'payload'}: ${first.message}`,
      400,
    );
  }

  const { data, error } = await supabase.rpc('apply_entry_review', {
    p_entry_id: entryId,
    p_payload: parsed.data,
  });

  if (error) {
    if (error.code === '42501') {
      return fail('forbidden', 'That entry is not an open draft of yours.', 403);
    }
    return fail('server_error', error.message, 500);
  }

  // The proposal has served its purpose. Kept, not deleted — when a number is
  // disputed, what the model suggested against what the supervisor confirmed
  // is the interesting comparison.
  await supabase
    .from('entry_extractions')
    .update({
      status: 'applied',
      applied_at: new Date().toISOString(),
      applied_by: user.id,
    })
    .eq('entry_id', entryId)
    .eq('status', 'pending');

  return ok({ review: data });
}
