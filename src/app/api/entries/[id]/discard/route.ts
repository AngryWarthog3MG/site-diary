import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/**
 * Bin a draft.
 *
 * Only ever a draft, and only the author's own — the delete runs under the
 * caller's RLS, and a signed entry is refused by policy and trigger both.
 * Child rows cascade; the files the draft owned (photos, audio) are removed
 * afterwards so a binned day leaves nothing behind. A signed record is never
 * touched by any of this: a correction that is binned simply stops
 * existing, and the entry it pointed at stays exactly as it was.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad entry id.', 400);

  const { data: entry } = await supabase
    .from('entries')
    .select('id, project_id, status, author_id, entry_audio(url), photos(url)')
    .eq('id', id)
    .maybeSingle();
  if (!entry) return fail('not_found', 'That entry is not on any of your projects.', 404);
  if (entry.status === 'signed') {
    return fail('bad_request', 'A signed day cannot be binned. Record a correction instead.', 409);
  }
  if (entry.author_id !== user.id) {
    return fail('forbidden', 'Only the person who started this draft can bin it.', 403);
  }

  const audio = ((entry.entry_audio ?? []) as Array<{ url: string | null }>).map((r) => r.url).filter(Boolean) as string[];
  const photos = ((entry.photos ?? []) as Array<{ url: string | null }>).map((r) => r.url).filter(Boolean) as string[];

  const { error: deleteError, count } = await supabase
    .from('entries')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('status', 'draft');
  if (deleteError) return fail('server_error', deleteError.message, 500);
  if (!count) return fail('forbidden', 'This draft could not be binned.', 403);

  // The draft's files, best effort — the record is already gone.
  const admin = createAdminClient();
  if (audio.length) await admin.storage.from('entry-audio').remove(audio).catch(() => {});
  const { data: folder } = await admin.storage.from('entry-photos').list(`${entry.project_id}/${id}`);
  const paths = [
    ...photos,
    ...((folder ?? []).map((f) => `${entry.project_id}/${id}/${f.name}`)),
  ];
  if (paths.length) await admin.storage.from('entry-photos').remove([...new Set(paths)]).catch(() => {});

  return ok({ binned: id });
}
