import { after } from 'next/server';
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
export const maxDuration = 300;

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

  // One transaction: the payload on the screen is applied and the status
  // moves in the same call, so no autosave still in flight can land between
  // the two. The database does the rest — gaps, serial, signature, hash.
  const { data: state, error: signError } = await supabase.rpc('sign_entry', {
    p_entry_id: entryId,
    p_payload: parsed.data,
  });

  if (signError) {
    if (signError.code === '42501' || /not an open draft/.test(signError.message)) {
      return fail('forbidden', 'That entry is not an open draft you can sign.', 403);
    }
    if (signError.message.includes('blocking gaps remain')) {
      return fail('bad_request', signError.message.replace(/^.*blocking gaps remain: /, 'Still to do: '), 409);
    }
    if (signError.message.includes('is signed and cannot be modified')) {
      return fail('entry_signed', 'That entry has already been signed.', 409);
    }
    return fail('server_error', signError.message, 500);
  }
  const { data: signed } = await supabase
    .from('entries')
    .select('id, entry_no, content_hash, signed_at, signed_by, entry_date')
    .eq('id', entryId)
    .single();
  void state;

  await supabase
    .from('entry_extractions')
    .update({ status: 'applied', applied_at: new Date().toISOString(), applied_by: user.id })
    .eq('entry_id', entryId)
    .eq('status', 'pending');

  // The export renders NOW, after the response, while the signing is still
  // warm — so sharing, emailing and bundling never wait on Chromium again.
  // Best effort: the ops backfill sweeps any signing this misses.
  after(async () => {
    try {
      const [{ loadDocketEntry }, { collectPhotos, collectSignatures }, { renderDailyPdf }, { createAdminClient }] =
        await Promise.all([
          import('@/lib/pdf/load'),
          import('@/lib/pdf/photos'),
          import('@/lib/pdf/render'),
          import('@/lib/supabase/admin'),
        ]);
      const entry = await loadDocketEntry(supabase, entryId);
      if (!entry) return;
      const pdf = await renderDailyPdf({
        entry,
        photos: await collectPhotos(supabase, entry),
        signatures: await collectSignatures(supabase, entry),
      });
      await createAdminClient()
        .storage.from('exports')
        .upload(`${entry.project_id}/${entry.entry_no}.pdf`, Buffer.from(pdf), {
          contentType: 'application/pdf',
          upsert: false,
        });
    } catch (error) {
      console.error(`sign-time export render failed for ${entryId}:`, error);
    }
  });

  return ok({ entry: signed });
}
