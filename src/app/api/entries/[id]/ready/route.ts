import { fail, ok, requireApiUser, isUuid, readJson } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { canEditEntry } from '@/lib/entries/access';
import { sendPush, PushConfigError } from '@/lib/push/send';
import { fmtDate } from '@/lib/pdf/dates';

/**
 * Hand the day over for the closer's sign-off (README R126). The payload on the screen has already been applied by
 * the screen's own save; this stamps the hand-over — the database records when and by whom — and tells the person
 * who closes the day, on their phone, that it is waiting. Nothing here signs anything.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad entry id.', 400);
  const body = (await readJson(request)) as { note?: unknown } | null;
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : null;

  const { data: entry } = await supabase
    .from('entries')
    .select('id, project_id, author_id, entry_date, status, project:projects!inner(code, day_closer_id)')
    .eq('id', id)
    .maybeSingle();
  if (!entry) return fail('not_found', 'That entry is not on your account.', 404);
  if (entry.status === 'signed') return fail('entry_signed', 'That day is already signed.', 409);
  if (!(await canEditEntry(supabase, user.id, entry))) return fail('forbidden', 'You do not work on this day.', 403);
  const project = (Array.isArray(entry.project) ? entry.project[0] : entry.project) as { code: string; day_closer_id: string | null };

  const { data: stamped, error } = await supabase.from('entries').update({ ready_at: new Date().toISOString(), ready_note: note }).eq('id', id).select('ready_at');
  if (error) return fail('server_error', error.message, 500);
  if (!stamped || stamped.length === 0) return fail('forbidden', 'The day could not be handed over from this account.', 403);

  // Tell the closer, when the job names one and it is somebody else.
  let push: 'sent' | 'no_device' | 'failed' | 'not_needed' = 'not_needed';
  const closer = project.day_closer_id;
  if (closer && closer !== user.id) {
    const admin = createAdminClient();
    const [{ data: subs }, { data: me }] = await Promise.all([
      admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', closer),
      admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    ]);
    push = 'no_device';
    let delivered = 0;
    try {
      for (const s of subs ?? []) {
        const outcome = await sendPush(s as { endpoint: string; p256dh: string; auth: string }, {
          title: 'Ready for your sign-off',
          body: `${project.code} · diary ${fmtDate(entry.entry_date)} — handed over by ${(me?.full_name as string | null) ?? 'the supervisor'}${note ? `: ${note}` : ''}`,
          url: `/entries/${id}/review?project=${entry.project_id}`,
          tag: `ready-${id}`,
        });
        if (outcome === 'sent') delivered += 1;
        if (outcome === 'gone') await admin.from('push_subscriptions').delete().eq('id', s.id);
      }
      if ((subs ?? []).length) push = delivered > 0 ? 'sent' : 'failed';
    } catch (err) {
      push = err instanceof PushConfigError ? 'failed' : 'failed';
    }
  }
  return ok({ readyAt: stamped[0].ready_at, push });
}
