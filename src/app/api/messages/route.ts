import { fail, ok, readJson, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendPush, PushConfigError } from '@/lib/push/send';
import { pushOutcomeText } from '@/lib/messages/model';

export const runtime = 'nodejs';

/**
 * Send a message to one person (README R112): the row first — it is the record — then their phone, through every
 * device they have registered; the outcome is stamped on the row. The database's policy decides who may send (an
 * admin of the company, to someone on one of its jobs).
 */
export async function POST(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const body = await readJson(request);
  const recipientId = body?.recipientId;
  const projectId = body?.projectId ?? null;
  const orgId = body?.orgId;
  const text = String(body?.body ?? '').trim();
  if (!isUuid(recipientId) || !isUuid(orgId) || (projectId !== null && !isUuid(projectId))) return fail('bad_request', 'Bad ids.', 400);
  if (!text) return fail('bad_request', 'Write the message first.', 400);
  if (text.length > 2000) return fail('bad_request', 'Keep it under 2,000 characters.', 400);
  if (recipientId === user.id) return fail('bad_request', 'That is you.', 400);

  const { data: row, error } = await supabase
    .from('messages')
    .insert({ org_id: orgId, project_id: projectId, recipient_id: recipientId, body: text })
    .select('id, body, sent_at')
    .single();
  if (error) return fail(/row-level security/i.test(error.message) ? 'forbidden' : 'bad_request', /row-level security/i.test(error.message) ? 'Only an admin of the company sends messages.' : error.message, /row-level security/i.test(error.message) ? 403 : 400);

  // Their phone. The subscriptions are theirs, so the service role reads them.
  const admin = createAdminClient();
  const [{ data: subs }, { data: me }] = await Promise.all([
    admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', recipientId),
    admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
  ]);
  let result: 'sent' | 'no_device' | 'failed' = 'no_device';
  let delivered = 0;
  if (subs && subs.length > 0) {
    try {
      for (const s of subs) {
        const outcome = await sendPush(
          { endpoint: s.endpoint as string, p256dh: s.p256dh as string, auth: s.auth as string },
          { title: `Message from ${me?.full_name ?? 'the office'}`, body: text.length > 180 ? `${text.slice(0, 177)}…` : text, url: `/inbox?m=${row.id}`, tag: `message-${row.id}` },
        );
        if (outcome === 'sent') delivered += 1;
        if (outcome === 'gone') await admin.from('push_subscriptions').delete().eq('id', s.id);
      }
      result = delivered > 0 ? 'sent' : 'failed';
    } catch (err) {
      result = err instanceof PushConfigError ? 'failed' : 'failed';
    }
  }
  await admin.rpc('record_message_push', { p_id: row.id, p_result: result, p_devices: delivered });
  return ok({ id: row.id, sentAt: row.sent_at, push: result, devices: delivered, message: `Sent. ${pushOutcomeText(result, delivered)}.` });
}
